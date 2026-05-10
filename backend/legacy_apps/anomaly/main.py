from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from io import BytesIO
from typing import Any, Dict, List
import json

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest


app = FastAPI(title="Delay Anomaly Advisor API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATE_COLUMNS = ["Date", "Production Date", "Shift Date", "Delay Date"]
DURATION_COLUMNS = ["Duration", "Delay Duration", "Duration Min", "Duration Minutes", "Delay Minutes", "Minutes", "Downtime", "Delay Time", "Total Delay"]
AGENCY_COLUMNS = ["Agency", "Department", "Responsible Agency", "Owner", "Section", "Area", "Dept"]
CATEGORY_COLUMNS = ["Category", "Delay Category", "Delay Type", "Main Category", "Reason Group", "Major Reason"]
DETAIL_COLUMNS = ["Delay Details", "Details of Delay", "Delay Detail", "Delay", "Reason", "Delay Reason", "Reason Description", "Problem"]


def normalize_col(value: str) -> str:
    return str(value).strip().lower().replace("_", " ")


def find_column(df: pd.DataFrame, candidates: List[str]) -> str:
    normalized = {normalize_col(c): c for c in df.columns}
    for candidate in candidates:
        key = normalize_col(candidate)
        if key in normalized:
            return normalized[key]
    for candidate in candidates:
        key = normalize_col(candidate)
        for column in df.columns:
            if key in normalize_col(column):
                return column
    return ""


def read_file(upload: UploadFile) -> pd.DataFrame:
    name = (upload.filename or "").lower()
    content = upload.file.read()
    try:
        if name.endswith((".xlsx", ".xls")):
            return pd.read_excel(BytesIO(content))
        if name.endswith(".csv"):
            return pd.read_csv(BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read file: {exc}")
    raise HTTPException(status_code=400, detail="Only .csv, .xlsx and .xls files are supported.")


def clean_text(value: Any, default: str = "Unknown") -> str:
    if pd.isna(value):
        return default
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null", "nat"}:
        return default
    return text


def parse_duration_to_minutes(series: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        s = pd.to_numeric(series, errors="coerce")
        valid = s.dropna()
        if len(valid) and valid.quantile(0.90) <= 2:
            return s * 24 * 60
        return s

    raw = series.astype(str).str.strip()
    td = pd.to_timedelta(raw, errors="coerce")
    mins = td.dt.total_seconds() / 60
    numeric = pd.to_numeric(raw, errors="coerce")
    return mins.fillna(numeric)


def parse_date(series: pd.Series) -> pd.Series:
    if series is None:
        return pd.Series(dtype=object)
    d1 = pd.to_datetime(series, errors="coerce", dayfirst=True)
    d2 = pd.to_datetime(series, errors="coerce")
    return d1.fillna(d2)


def auto_mapping(df: pd.DataFrame) -> Dict[str, str]:
    return {
        "date": find_column(df, DATE_COLUMNS),
        "duration": find_column(df, DURATION_COLUMNS),
        "agency": find_column(df, AGENCY_COLUMNS),
        "category": find_column(df, CATEGORY_COLUMNS),
        "detail": find_column(df, DETAIL_COLUMNS),
    }


def safe_col(mapping: Dict[str, str], key: str) -> str:
    value = mapping.get(key, "") if mapping else ""
    return value if value and value != "__none__" else ""


def prepare_data(df: pd.DataFrame, mapping: Dict[str, str]) -> pd.DataFrame:
    duration_col = safe_col(mapping, "duration")
    agency_col = safe_col(mapping, "agency")
    category_col = safe_col(mapping, "category")
    if not duration_col:
        raise HTTPException(status_code=400, detail="Please map a duration column.")
    if not agency_col:
        raise HTTPException(status_code=400, detail="Please map an agency column.")
    if not category_col:
        raise HTTPException(status_code=400, detail="Please map a category column.")

    date_col = safe_col(mapping, "date")
    detail_col = safe_col(mapping, "detail")
    work = pd.DataFrame({
        "row_number": range(1, len(df) + 1),
        "date": parse_date(df[date_col]) if date_col else pd.NaT,
        "duration_min": parse_duration_to_minutes(df[duration_col]),
        "agency": df[agency_col].apply(clean_text),
        "category": df[category_col].apply(clean_text),
        "detail": df[detail_col].apply(lambda value: clean_text(value, "")) if detail_col else "",
    })
    work = work.dropna(subset=["duration_min"])
    work = work[work["duration_min"] >= 0].copy()
    if work.empty:
        raise HTTPException(status_code=400, detail="No valid non-negative durations found.")
    return work


def combo_key(agency: Any, category: Any) -> str:
    return f"{clean_text(agency)}|||{clean_text(category)}"


def filter_exclusions(df: pd.DataFrame, excluded_combos: List[str]) -> pd.DataFrame:
    excluded = set(excluded_combos or [])
    if not excluded:
        return df
    keys = df.apply(lambda row: combo_key(row["agency"], row["category"]), axis=1)
    return df[~keys.isin(excluded)].copy()


def list_combos(df: pd.DataFrame) -> List[Dict[str, Any]]:
    rows = []
    for (agency, category), group in df.groupby(["agency", "category"], dropna=False):
        rows.append({
            "key": combo_key(agency, category),
            "agency": clean_text(agency),
            "category": clean_text(category),
            "combo": f"{clean_text(category)} | {clean_text(agency)}",
            "records": int(len(group)),
        })
    return sorted(rows, key=lambda item: (-item["records"], item["agency"], item["category"]))


def detect_anomalies(df: pd.DataFrame, min_group_size: int, contamination: float, excluded_combos: List[str]) -> Dict[str, Any]:
    excluded_set = set(excluded_combos or [])
    filtered = filter_exclusions(df, list(excluded_set))
    combo_rows = []
    anomaly_rows = []
    total_records = int(len(df))
    records_used = int(len(filtered))

    if filtered.empty:
        return {
            "summary": {
                "records_read": total_records,
                "records_used": 0,
                "records_excluded": total_records,
                "combos_analyzed": 0,
                "combos_excluded": len(excluded_set),
                "combos_with_anomalies": 0,
                "anomalies_found": 0,
                "min_group_size": min_group_size,
                "contamination": contamination,
                "model": "Isolation Forest",
            },
            "combo_summary": [],
            "anomalies": [],
        }

    for (agency, category), group in filtered.groupby(["agency", "category"], dropna=False):
        durations = group["duration_min"].astype(float)
        median = float(durations.median())
        max_duration = float(durations.max())
        threshold = float("nan")
        method = "Isolation Forest"
        anomalies = group.iloc[0:0].copy()
        scores = pd.Series(index=group.index, dtype=float)

        if len(group) >= min_group_size and durations.nunique() > 1:
            features = np.log1p(durations.to_numpy()).reshape(-1, 1)
            model = IsolationForest(
                n_estimators=200,
                contamination=contamination,
                random_state=42,
            )
            predictions = model.fit_predict(features)
            raw_scores = model.decision_function(features)
            scores = pd.Series(raw_scores, index=group.index)
            predicted_outlier = pd.Series(predictions == -1, index=group.index)
            high_duration = durations > median
            anomalies = group[predicted_outlier & high_duration].copy()
            if not anomalies.empty:
                threshold = float(anomalies["duration_min"].min())
        else:
            method = "insufficient history"

        combo_rows.append({
            "agency": clean_text(agency),
            "category": clean_text(category),
            "combo": f"{clean_text(category)} | {clean_text(agency)}",
            "records": int(len(group)),
            "anomalies": int(len(anomalies)),
            "anomaly_rate": round(float(len(anomalies) / len(group)), 4) if len(group) else 0,
            "median_duration_min": round(median, 2),
            "max_duration_min": round(max_duration, 2),
            "threshold_min": None if np.isnan(threshold) else round(float(threshold), 2),
            "method": method,
        })

        for _, row in anomalies.sort_values("duration_min", ascending=False).iterrows():
            score = scores.get(row.name)
            threshold_display = None if np.isnan(threshold) else round(float(threshold), 2)
            excess = None if np.isnan(threshold) else round(float(row["duration_min"] - threshold), 2)
            anomaly_rows.append({
                "row_number": int(row["row_number"]),
                "date": "" if pd.isna(row["date"]) else str(pd.to_datetime(row["date"]).date()),
                "agency": clean_text(row["agency"]),
                "category": clean_text(row["category"]),
                "combo": f"{clean_text(row['category'])} | {clean_text(row['agency'])}",
                "detail": clean_text(row["detail"], ""),
                "duration_min": round(float(row["duration_min"]), 2),
                "threshold_min": threshold_display,
                "excess_min": excess,
                "anomaly_score": None if pd.isna(score) else round(float(score), 4),
                "method": method,
            })

    combo_rows = sorted(combo_rows, key=lambda item: (item["anomalies"], item["max_duration_min"]), reverse=True)
    anomaly_rows = sorted(anomaly_rows, key=lambda item: item["duration_min"], reverse=True)
    return {
        "summary": {
            "records_read": total_records,
            "records_used": records_used,
            "records_excluded": total_records - records_used,
            "combos_analyzed": len(combo_rows),
            "combos_excluded": len(excluded_set),
            "combos_with_anomalies": sum(1 for row in combo_rows if row["anomalies"] > 0),
            "anomalies_found": len(anomaly_rows),
            "min_group_size": min_group_size,
            "contamination": contamination,
            "model": "Isolation Forest",
        },
        "combo_summary": combo_rows,
        "anomalies": anomaly_rows,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/columns")
async def columns(file: UploadFile = File(...)):
    df = read_file(file)
    return {
        "columns": [str(c) for c in df.columns],
        "auto_mapping": auto_mapping(df),
        "sample_rows": df.head(5).replace({np.nan: None}).to_dict(orient="records"),
        "row_count": int(len(df)),
    }


@app.post("/combos")
async def combos(file: UploadFile = File(...), mapping_json: str = Form("{}")):
    raw = read_file(file)
    try:
        incoming_mapping = json.loads(mapping_json or "{}")
    except Exception:
        incoming_mapping = {}
    mapping = auto_mapping(raw)
    mapping.update({k: v for k, v in incoming_mapping.items() if v and v != "__none__"})
    work = prepare_data(raw, mapping)
    return {"combos": list_combos(work), "mapping_used": mapping}


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    mapping_json: str = Form("{}"),
    min_group_size: int = Form(5),
    contamination: float = Form(0.1),
    excluded_combos_json: str = Form("[]"),
):
    raw = read_file(file)
    try:
        incoming_mapping = json.loads(mapping_json or "{}")
    except Exception:
        incoming_mapping = {}
    try:
        excluded_combos = json.loads(excluded_combos_json or "[]")
    except Exception:
        excluded_combos = []
    mapping = auto_mapping(raw)
    mapping.update({k: v for k, v in incoming_mapping.items() if v and v != "__none__"})
    work = prepare_data(raw, mapping)
    bounded_contamination = min(max(float(contamination), 0.01), 0.4)
    result = detect_anomalies(work, max(2, int(min_group_size)), bounded_contamination, excluded_combos)
    result["mapping_used"] = mapping
    return result
