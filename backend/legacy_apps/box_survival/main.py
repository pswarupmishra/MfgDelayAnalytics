from __future__ import annotations

import io
import math
import uuid
from datetime import date, datetime, time
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Delay Analytics API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATASETS: Dict[str, pd.DataFrame] = {}

COLUMN_SYNONYMS = {
    "date": ["date", "delay date", "start date", "dt"],
    "duration": ["duration", "delay duration", "delay", "mins", "minutes", "duration_min"],
    "agency": ["agency", "department", "responsible agency", "owner"],
    "category": ["category", "delay category", "type", "class"],
}


def clean_name(value: Any) -> str:
    return str(value).strip()


def read_table_file(file_name: str, content: bytes) -> pd.DataFrame:
    name = file_name.lower()
    try:
        if name.endswith((".xlsx", ".xls")):
            return pd.read_excel(io.BytesIO(content))
        if name.endswith(".csv"):
            return pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read file: {exc}") from exc
    raise HTTPException(status_code=400, detail="Upload a .csv, .xlsx, or .xls file")


def normalize_dim(value: Any) -> str:
    if pd.isna(value) or str(value).strip() == "":
        return "(BLANK)"
    return str(value).strip().upper()


def auto_mapping(columns: List[str]) -> Dict[str, Optional[str]]:
    lower_to_original = {c.strip().lower(): c for c in columns}
    mapping: Dict[str, Optional[str]] = {}
    for field, aliases in COLUMN_SYNONYMS.items():
        found = None
        for alias in aliases:
            if alias.lower() in lower_to_original:
                found = lower_to_original[alias.lower()]
                break
        if not found:
            for col in columns:
                col_l = col.strip().lower()
                if any(alias in col_l for alias in aliases):
                    found = col
                    break
        mapping[field] = found
    return mapping


def parse_date_series(series: pd.Series) -> pd.Series:
    parsed = pd.to_datetime(series, errors="coerce", dayfirst=True)
    return parsed


def duration_to_minutes(value: Any) -> Optional[float]:
    if pd.isna(value):
        return None
    if isinstance(value, datetime):
        return value.hour * 60 + value.minute + value.second / 60
    if isinstance(value, time):
        return value.hour * 60 + value.minute + value.second / 60
    if isinstance(value, pd.Timedelta):
        return value.total_seconds() / 60
    if isinstance(value, (int, float, np.integer, np.floating)):
        if math.isnan(float(value)):
            return None
        # Excel time fraction: 0.25 means 6 hours. Plain values above 1 are treated as minutes.
        return float(value) * 24 * 60 if 0 < float(value) < 1 else float(value)
    text = str(value).strip()
    if not text:
        return None
    for fmt in ["%H:%M:%S", "%H:%M"]:
        try:
            t = datetime.strptime(text, fmt).time()
            return t.hour * 60 + t.minute + t.second / 60
        except ValueError:
            pass
    try:
        td = pd.to_timedelta(text)
        return td.total_seconds() / 60
    except Exception:
        pass
    try:
        return float(text)
    except ValueError:
        return None


def prepare_df(df: pd.DataFrame, mapping: Dict[str, str]) -> pd.DataFrame:
    missing = [k for k in ["date", "duration", "agency", "category"] if not mapping.get(k)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required mapping: {', '.join(missing)}")

    out = pd.DataFrame()
    out["date"] = parse_date_series(df[mapping["date"]])
    out["duration_min"] = df[mapping["duration"]].apply(duration_to_minutes)
    out["agency"] = df[mapping["agency"]].apply(normalize_dim)
    out["category"] = df[mapping["category"]].apply(normalize_dim)
    out["source_index"] = np.arange(len(df)) + 1

    detail_col = None
    for col in df.columns:
        if "detail" in str(col).lower() or "remark" in str(col).lower():
            detail_col = col
            break
    out["details"] = df[detail_col].astype(str) if detail_col else ""

    out = out.dropna(subset=["date", "duration_min"])
    out = out[out["duration_min"] > 0]
    return out


def box_stats(values: pd.Series) -> Dict[str, Any]:
    arr = np.array(values.dropna(), dtype=float)
    if arr.size == 0:
        return {}
    q1, median, q3 = np.percentile(arr, [25, 50, 75])
    iqr = q3 - q1
    lower_fence = q1 - 1.5 * iqr
    upper_fence = q3 + 1.5 * iqr
    whisker_low = float(np.min(arr[arr >= lower_fence])) if np.any(arr >= lower_fence) else float(np.min(arr))
    whisker_high = float(np.max(arr[arr <= upper_fence])) if np.any(arr <= upper_fence) else float(np.max(arr))
    outliers = arr[(arr < lower_fence) | (arr > upper_fence)]
    return {
        "count": int(arr.size),
        "min": float(np.min(arr)),
        "q1": float(q1),
        "median": float(median),
        "q3": float(q3),
        "max": float(np.max(arr)),
        "mean": float(np.mean(arr)),
        "whiskerLow": whisker_low,
        "whiskerHigh": whisker_high,
        "outliers": [float(x) for x in outliers[:50]],
    }


def period_key(dt: pd.Timestamp, period: str) -> str:
    if period == "day":
        return dt.strftime("%Y-%m-%d")
    if period == "week":
        iso = dt.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    if period == "month":
        return dt.strftime("%Y-%m")
    raise HTTPException(status_code=400, detail="period must be day, week, or month")


def km_survival(values: pd.Series) -> List[Dict[str, float]]:
    times = np.sort(np.array(values.dropna(), dtype=float))
    n = len(times)
    if n == 0:
        return []
    points = [{"time": 0.0, "survival": 1.0, "atRisk": n, "events": 0}]
    survival = 1.0
    for t in np.unique(times):
        at_risk = int(np.sum(times >= t))
        events = int(np.sum(times == t))
        survival *= (1 - events / at_risk)
        points.append({"time": float(t), "survival": float(survival), "atRisk": at_risk, "events": events})
    return points


class AnalyzeRequest(BaseModel):
    datasetId: str
    dateColumn: str
    durationColumn: str
    agencyColumn: str
    categoryColumn: str
    agency: Optional[str] = None
    category: Optional[str] = None
    period: str = "day"


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/upload")
async def upload(file: UploadFile = File(...)) -> Dict[str, Any]:
    content = await file.read()
    df = read_table_file(file.filename or "", content)
    df.columns = [clean_name(c) for c in df.columns]
    dataset_id = str(uuid.uuid4())
    DATASETS[dataset_id] = df
    mapping = auto_mapping(list(df.columns))
    preview = df.head(10).replace({np.nan: None}).astype(object).to_dict(orient="records")
    return {
        "datasetId": dataset_id,
        "filename": file.filename,
        "rows": int(len(df)),
        "columns": list(df.columns),
        "mapping": mapping,
        "preview": preview,
    }


@app.post("/metadata")
def metadata(req: AnalyzeRequest) -> Dict[str, Any]:
    if req.datasetId not in DATASETS:
        raise HTTPException(status_code=404, detail="Dataset not found. Please upload again.")
    mapping = {
        "date": req.dateColumn,
        "duration": req.durationColumn,
        "agency": req.agencyColumn,
        "category": req.categoryColumn,
    }
    prepared = prepare_df(DATASETS[req.datasetId], mapping)
    agencies = sorted(prepared["agency"].unique().tolist())
    categories = sorted(prepared["category"].unique().tolist(), key=lambda x: str(x))
    return {"agencies": agencies, "categories": categories, "validRows": int(len(prepared))}


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> Dict[str, Any]:
    if req.datasetId not in DATASETS:
        raise HTTPException(status_code=404, detail="Dataset not found. Please upload again.")
    mapping = {
        "date": req.dateColumn,
        "duration": req.durationColumn,
        "agency": req.agencyColumn,
        "category": req.categoryColumn,
    }
    df = prepare_df(DATASETS[req.datasetId], mapping)
    if req.agency:
        df = df[df["agency"] == normalize_dim(req.agency)]
    if req.category:
        df = df[df["category"] == normalize_dim(req.category)]
    if df.empty:
        return {"summary": {"count": 0}, "boxplot": [], "survival": [], "records": []}

    df = df.copy()
    df["period"] = df["date"].apply(lambda x: period_key(x, req.period))
    grouped = []
    for p, g in df.sort_values("date").groupby("period"):
        stats = box_stats(g["duration_min"])
        if stats:
            stats["period"] = p
            grouped.append(stats)

    durations = df["duration_min"].astype(float)
    summary = {
        "count": int(len(df)),
        "avgDuration": float(durations.mean()),
        "medianDuration": float(durations.median()),
        "p90Duration": float(np.percentile(durations, 90)),
        "maxDuration": float(durations.max()),
        "fromDate": df["date"].min().strftime("%Y-%m-%d"),
        "toDate": df["date"].max().strftime("%Y-%m-%d"),
    }
    records = df.sort_values("date", ascending=False).head(200).assign(
        date=lambda x: x["date"].dt.strftime("%Y-%m-%d")
    )[["date", "duration_min", "agency", "category", "details"]].to_dict(orient="records")
    return {"summary": summary, "boxplot": grouped, "survival": km_survival(durations), "records": records}
