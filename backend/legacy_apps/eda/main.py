
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
from io import BytesIO
from typing import Any, List, Dict
import json

app = FastAPI(
    title="Executive Delay Analytics EDA API",
    description="EDA backend with explicit Excel field mapping.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATE_COLUMNS = ["Date", "Production Date", "Shift Date", "Delay Date"]
START_COLUMNS = ["Start Time", "Start", "Delay Start", "From Time", "StartTime"]
END_COLUMNS = ["End Time", "End", "Delay End", "To Time", "EndTime"]
DURATION_COLUMNS = ["Duration", "Delay Duration", "Duration Min", "Duration Minutes", "Delay Minutes", "Minutes", "Downtime", "Delay Time", "Total Delay"]
AGENCY_COLUMNS = ["Agency", "Department", "Responsible Agency", "Owner", "Section", "Area", "Dept"]
CATEGORY_COLUMNS = ["Category", "Delay Category", "Delay Type", "Main Category", "Reason Group", "Major Reason"]
DETAIL_COLUMNS = ["Delay Details", "Delay Detail", "Delay", "Reason", "Delay Reason", "Reason Description", "Sub Reason", "Problem"]
UNIT_COLUMNS = ["Unit", "Line", "Area", "Shop", "Equipment", "Machine", "Asset", "Facility"]
SHIFT_COLUMNS = ["Shift", "Shift Name"]


def normalize_col(c: str) -> str:
    return str(c).strip().lower().replace("_", " ")


def find_column(df: pd.DataFrame, candidates: List[str]) -> str:
    normalized = {normalize_col(c): c for c in df.columns}
    for candidate in candidates:
        key = normalize_col(candidate)
        if key in normalized:
            return normalized[key]
    return ""


def read_file(upload: UploadFile) -> pd.DataFrame:
    name = upload.filename.lower()
    content = upload.file.read()
    try:
        if name.endswith(".xlsx") or name.endswith(".xls"):
            return pd.read_excel(BytesIO(content))
        if name.endswith(".csv"):
            return pd.read_csv(BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read file: {exc}")
    raise HTTPException(status_code=400, detail="Only .xlsx, .xls and .csv are supported.")


def clean_text(value: Any, default: str = "Unknown") -> str:
    if pd.isna(value):
        return default
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null", "nat", "{}"}:
        return default
    return text


def parse_duration_to_minutes(series: pd.Series) -> pd.Series:
    if series is None:
        return pd.Series(dtype=float)

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


def combine_datetime(df: pd.DataFrame, date_col: str = "", time_col: str = "") -> pd.Series:
    if date_col and time_col:
        return pd.to_datetime(
            df[date_col].astype(str).str.strip() + " " + df[time_col].astype(str).str.strip(),
            errors="coerce"
        )
    if time_col:
        return pd.to_datetime(df[time_col], errors="coerce")
    if date_col:
        return pd.to_datetime(df[date_col], errors="coerce")
    return pd.Series(pd.NaT, index=df.index)


def infer_shift(hour) -> str:
    if pd.isna(hour):
        return "Unknown"
    h = int(hour)
    if 6 <= h < 14:
        return "A"
    if 14 <= h < 22:
        return "B"
    return "C"


def safe_col(mapping: Dict[str, str], key: str) -> str:
    val = mapping.get(key, "") if mapping else ""
    return val if val and val != "__none__" else ""


def auto_mapping(df: pd.DataFrame) -> Dict[str, str]:
    return {
        "date": find_column(df, DATE_COLUMNS),
        "start_time": find_column(df, START_COLUMNS),
        "end_time": find_column(df, END_COLUMNS),
        "duration": find_column(df, DURATION_COLUMNS),
        "agency": find_column(df, AGENCY_COLUMNS),
        "category": find_column(df, CATEGORY_COLUMNS),
        "detail": find_column(df, DETAIL_COLUMNS),
        "unit": find_column(df, UNIT_COLUMNS),
        "shift": find_column(df, SHIFT_COLUMNS),
    }


def prepare_data(df: pd.DataFrame, mapping: Dict[str, str]) -> pd.DataFrame:
    w = df.copy()
    w["__row_id"] = range(1, len(w) + 1)

    date_col = safe_col(mapping, "date")
    start_col = safe_col(mapping, "start_time")
    end_col = safe_col(mapping, "end_time")
    duration_col = safe_col(mapping, "duration")
    agency_col = safe_col(mapping, "agency")
    category_col = safe_col(mapping, "category")
    detail_col = safe_col(mapping, "detail")
    unit_col = safe_col(mapping, "unit")
    shift_col = safe_col(mapping, "shift")

    w["__timestamp"] = combine_datetime(w, date_col, start_col)

    if duration_col:
        w["__duration_min"] = parse_duration_to_minutes(w[duration_col])
    elif start_col and end_col:
        start_ts = combine_datetime(w, date_col, start_col)
        end_ts = combine_datetime(w, date_col, end_col)
        dur = (end_ts - start_ts).dt.total_seconds() / 60
        dur = dur.where(dur >= 0, dur + 24 * 60)
        w["__duration_min"] = dur
    else:
        w["__duration_min"] = np.nan

    w["__duration_min"] = pd.to_numeric(w["__duration_min"], errors="coerce").clip(lower=0)
    w["__duration_min_filled"] = w["__duration_min"].fillna(0)

    w["__agency"] = w[agency_col].apply(clean_text) if agency_col else "Unknown"
    w["__category"] = w[category_col].apply(clean_text) if category_col else "Unknown"
    w["__detail"] = w[detail_col].apply(clean_text) if detail_col else "Unknown"
    w["__unit"] = w[unit_col].apply(clean_text) if unit_col else "Unknown"
    w["__shift"] = w[shift_col].apply(clean_text) if shift_col else w["__timestamp"].dt.hour.apply(infer_shift)

    w["__date"] = w["__timestamp"].dt.date.astype(str)
    w.loc[w["__timestamp"].isna(), "__date"] = "Unknown"
    w["__hour"] = w["__timestamp"].dt.hour
    w["__weekday"] = w["__timestamp"].dt.day_name().fillna("Unknown")
    return w


def top_dimension(df, column, top_n=15):
    g = (
        df.groupby(column, dropna=False)
        .agg(
            delay_count=("__row_id", "count"),
            total_duration_min=("__duration_min_filled", "sum"),
            avg_duration_min=("__duration_min_filled", "mean"),
        )
        .reset_index()
        .sort_values(["total_duration_min", "delay_count"], ascending=False)
        .head(top_n)
    )
    total_duration = float(df["__duration_min_filled"].sum())
    total_count = len(df)
    rows, cumulative = [], 0
    for _, r in g.iterrows():
        dur = float(r["total_duration_min"] or 0)
        cumulative += dur
        rows.append({
            "name": clean_text(r[column]),
            "delay_count": int(r["delay_count"]),
            "total_duration_min": round(dur, 2),
            "avg_duration_min": round(float(r["avg_duration_min"] or 0), 2),
            "duration_share": round(dur / total_duration, 4) if total_duration else 0,
            "count_share": round(float(r["delay_count"]) / total_count, 4) if total_count else 0,
            "cumulative_duration_share": round(cumulative / total_duration, 4) if total_duration else 0,
        })
    return rows


def trend(df, period):
    if df["__timestamp"].isna().all():
        return []
    temp = df.dropna(subset=["__timestamp"]).copy()
    if period == "M":
        temp["period"] = temp["__timestamp"].dt.to_period("M").astype(str)
    elif period == "W":
        temp["period"] = temp["__timestamp"].dt.to_period("W").astype(str)
    else:
        temp["period"] = temp["__timestamp"].dt.date.astype(str)
    g = (
        temp.groupby("period")
        .agg(delay_count=("__row_id", "count"), total_duration_min=("__duration_min_filled", "sum"), avg_duration_min=("__duration_min_filled", "mean"))
        .reset_index()
        .sort_values("period")
    )
    return [
        {
            "period": str(r["period"]),
            "delay_count": int(r["delay_count"]),
            "total_duration_min": round(float(r["total_duration_min"] or 0), 2),
            "avg_duration_min": round(float(r["avg_duration_min"] or 0), 2),
        }
        for _, r in g.iterrows()
    ]


def matrix(df, row_col, col_col, top_rows=10, top_cols=10):
    top_r = df.groupby(row_col)["__duration_min_filled"].sum().sort_values(ascending=False).head(top_rows).index
    top_c = df.groupby(col_col)["__duration_min_filled"].sum().sort_values(ascending=False).head(top_cols).index
    temp = df[df[row_col].isin(top_r) & df[col_col].isin(top_c)]
    pivot = pd.pivot_table(temp, index=row_col, columns=col_col, values="__duration_min_filled", aggfunc="sum", fill_value=0)
    rows = [clean_text(x) for x in pivot.index.tolist()]
    cols = [clean_text(x) for x in pivot.columns.tolist()]
    vals = []
    for ridx in pivot.index:
        for cidx in pivot.columns:
            vals.append({"row": clean_text(ridx), "column": clean_text(cidx), "value": round(float(pivot.loc[ridx, cidx]), 2)})
    return {"rows": rows, "columns": cols, "values": vals}


def duration_stats(df):
    s = df["__duration_min"].dropna()
    if len(s) == 0:
        return {}
    return {
        "min": round(float(s.min()), 2),
        "p25": round(float(s.quantile(.25)), 2),
        "median": round(float(s.median()), 2),
        "mean": round(float(s.mean()), 2),
        "p75": round(float(s.quantile(.75)), 2),
        "p90": round(float(s.quantile(.90)), 2),
        "p95": round(float(s.quantile(.95)), 2),
        "max": round(float(s.max()), 2),
        "std": round(float(s.std() or 0), 2),
    }


def histogram(df, bins=12):
    s = df["__duration_min"].dropna()
    if len(s) == 0:
        return []
    counts, edges = np.histogram(s, bins=bins)
    return [{"bin": f"{round(edges[i],1)}–{round(edges[i+1],1)}", "count": int(counts[i])} for i in range(len(counts))]


def detect_outliers(df):
    s = df["__duration_min"].dropna()
    if len(s) < 5:
        return []
    q1, q3 = s.quantile(.25), s.quantile(.75)
    threshold = q3 + 1.5 * (q3 - q1)
    out = df[df["__duration_min"] > threshold].sort_values("__duration_min", ascending=False).head(20)
    return [
        {
            "date": clean_text(r.get("__date")),
            "agency": clean_text(r.get("__agency")),
            "category": clean_text(r.get("__category")),
            "detail": clean_text(r.get("__detail")),
            "duration_min": round(float(r.get("__duration_min") or 0), 2),
            "threshold_min": round(float(threshold), 2),
        }
        for _, r in out.iterrows()
    ]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/columns")
async def columns(file: UploadFile = File(...)):
    df = read_file(file)
    mapping = auto_mapping(df)
    sample_rows = df.head(5).replace({np.nan: None}).to_dict(orient="records")
    return {
        "columns": [str(c) for c in df.columns],
        "auto_mapping": mapping,
        "sample_rows": sample_rows,
        "row_count": int(len(df)),
    }


@app.post("/eda")
async def eda(
    file: UploadFile = File(...),
    mapping_json: str = Form("{}"),
    top_n: int = Form(15),
):
    raw = read_file(file)
    try:
        incoming_mapping = json.loads(mapping_json or "{}")
    except Exception:
        incoming_mapping = {}

    mapping = auto_mapping(raw)
    mapping.update({k: v for k, v in incoming_mapping.items() if v and v != "__none__"})

    df = prepare_data(raw, mapping)

    total_duration = float(df["__duration_min_filled"].sum())
    delay_count = int(len(df))
    valid_duration = int(df["__duration_min"].notna().sum())

    hour_df = (
        df.dropna(subset=["__hour"])
        .groupby("__hour")
        .agg(delay_count=("__row_id", "count"), total_duration_min=("__duration_min_filled", "sum"), avg_duration_min=("__duration_min_filled", "mean"))
        .reset_index()
        .sort_values("__hour")
    )
    by_hour = [
        {"hour": int(r["__hour"]), "delay_count": int(r["delay_count"]), "total_duration_min": round(float(r["total_duration_min"]), 2), "avg_duration_min": round(float(r["avg_duration_min"]), 2)}
        for _, r in hour_df.iterrows()
    ]

    weekday_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    wk = (
        df[df["__weekday"] != "Unknown"]
        .groupby("__weekday")
        .agg(delay_count=("__row_id", "count"), total_duration_min=("__duration_min_filled", "sum"), avg_duration_min=("__duration_min_filled", "mean"))
        .reindex(weekday_order)
        .fillna(0)
        .reset_index()
    )
    by_weekday = [
        {"weekday": str(r["__weekday"]), "delay_count": int(r["delay_count"]), "total_duration_min": round(float(r["total_duration_min"]), 2), "avg_duration_min": round(float(r["avg_duration_min"]), 2)}
        for _, r in wk.iterrows()
    ]

    missing_by_column = []
    for col in raw.columns:
        missing = int(raw[col].isna().sum())
        if missing:
            missing_by_column.append({"column": str(col), "missing_count": missing, "missing_share": round(missing / len(raw), 4) if len(raw) else 0})
    missing_by_column = sorted(missing_by_column, key=lambda x: x["missing_count"], reverse=True)

    sorted_dur = df["__duration_min_filled"].sort_values(ascending=False)
    total = sorted_dur.sum()

    return {
        "kpis": {
            "total_records": delay_count,
            "total_duration_min": round(total_duration, 2),
            "total_duration_hr": round(total_duration / 60, 2),
            "avg_duration_min": round(total_duration / delay_count, 2) if delay_count else 0,
            "valid_duration_records": valid_duration,
            "missing_duration_records": int(delay_count - valid_duration),
            "unique_agencies": int(df["__agency"].nunique()),
            "unique_categories": int(df["__category"].nunique()),
            "unique_delay_details": int(df["__detail"].nunique()),
            "date_range": {
                "from": str(df["__timestamp"].min()) if df["__timestamp"].notna().any() else "",
                "to": str(df["__timestamp"].max()) if df["__timestamp"].notna().any() else "",
            }
        },
        "rankings": {
            "by_agency": top_dimension(df, "__agency", top_n),
            "by_category": top_dimension(df, "__category", top_n),
            "by_detail": top_dimension(df, "__detail", top_n),
            "by_unit": top_dimension(df, "__unit", top_n),
        },
        "trends": {
            "daily": trend(df, "D"),
            "weekly": trend(df, "W"),
            "monthly": trend(df, "M"),
            "by_hour": by_hour,
            "by_shift": top_dimension(df, "__shift", 10),
            "by_weekday": by_weekday,
        },
        "duration_analysis": {
            "stats": duration_stats(df),
            "histogram": histogram(df),
            "outliers": detect_outliers(df),
            "concentration": {
                "top_10_record_duration_share": round(float(sorted_dur.head(10).sum() / total), 4) if total else 0,
                "top_20_record_duration_share": round(float(sorted_dur.head(20).sum() / total), 4) if total else 0,
            }
        },
        "cross_analysis": {
            "agency_category_matrix": matrix(df, "__agency", "__category"),
            "shift_category_matrix": matrix(df, "__shift", "__category"),
            "agency_shift_matrix": matrix(df, "__agency", "__shift"),
        },
        "data_quality": {
            "mapping_used": mapping,
            "missing_by_column": missing_by_column,
            "invalid_timestamp_records": int(df["__timestamp"].isna().sum()),
            "missing_duration_records": int(df["__duration_min"].isna().sum()),
            "zero_duration_records": int((df["__duration_min_filled"] == 0).sum()),
        }
    }
