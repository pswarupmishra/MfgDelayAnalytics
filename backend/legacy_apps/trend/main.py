from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
from io import BytesIO
from datetime import datetime
import uuid

app = FastAPI(title="Trend Advisor API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

STORE = {}


def read_table_file(file: UploadFile) -> pd.DataFrame:
    name = (file.filename or "").lower()
    content = file.file.read()
    try:
        if name.endswith((".xlsx", ".xls")):
            return pd.read_excel(BytesIO(content))
        if name.endswith(".csv"):
            return pd.read_csv(BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}") from e
    raise HTTPException(status_code=400, detail="Only .csv, .xlsx, and .xls files are supported.")


class Mapping(BaseModel):
    file_id: str
    date_col: str
    duration_col: str
    agency_col: str
    category_col: str
    top_n: int = 3


def clean_duration(series: pd.Series) -> pd.Series:
    """Convert Excel duration values into minutes."""
    s = series.copy()
    if pd.api.types.is_timedelta64_dtype(s):
        return s.dt.total_seconds() / 60
    if pd.api.types.is_datetime64_any_dtype(s):
        return s.dt.hour * 60 + s.dt.minute + s.dt.second / 60

    numeric = pd.to_numeric(s, errors="coerce")
    # Excel time fraction: values between 0 and 1 are fractions of a day.
    if numeric.notna().sum() and numeric.dropna().between(0, 1).mean() > 0.6:
        return numeric * 24 * 60
    # If values are normal numbers, assume minutes.
    if numeric.notna().sum() >= max(1, len(s) * 0.5):
        return numeric

    clock = s.astype(str).str.strip()
    if clock.str.match(r"^\d{1,2}:\d{2}(:\d{2})?$").any():
        def parse_clock(value):
            text = str(value).strip()
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    parsed = datetime.strptime(text, fmt).time()
                    return parsed.hour * 60 + parsed.minute + parsed.second / 60
                except ValueError:
                    pass
            return np.nan

        parsed_clock = clock.apply(parse_clock)
        if parsed_clock.notna().sum() >= max(1, len(s) * 0.5):
            return parsed_clock

    td = pd.to_timedelta(s.astype(str), errors="coerce")
    return td.dt.total_seconds() / 60


def parse_date(series: pd.Series) -> pd.Series:
    # Handles 25-03-2026 style and normal Excel dates.
    d1 = pd.to_datetime(series, errors="coerce", dayfirst=True)
    d2 = pd.to_datetime(series, errors="coerce")
    return d1.fillna(d2).dt.date


def direction_from_slope(slope, mean_val):
    if not np.isfinite(slope) or mean_val == 0:
        return "Stable"
    pct_daily = slope / max(abs(mean_val), 1e-9)
    if pct_daily > 0.03:
        return "Increasing"
    if pct_daily < -0.03:
        return "Decreasing"
    return "Stable"


def json_safe(value):
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [json_safe(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value) if np.isfinite(value) else None
    if pd.isna(value):
        return None
    return value


def trend_stats(daily: pd.DataFrame, metric: str):
    rows = []
    for (agency, category), g in daily.groupby(["agency", "category"]):
        g = g.sort_values("date")
        y = g[metric].astype(float).to_numpy()
        x = np.arange(len(y), dtype=float)
        if len(y) >= 2 and np.nanstd(y) > 0:
            slope, intercept = np.polyfit(x, y, 1)
            pred = intercept + slope * x
            ss_res = float(np.sum((y - pred) ** 2))
            ss_tot = float(np.sum((y - np.mean(y)) ** 2))
            r2 = 1 - ss_res / ss_tot if ss_tot else 0.0
        else:
            slope, r2 = 0.0, 0.0
        mean_val = float(np.mean(y)) if len(y) else 0.0
        first = float(y[0]) if len(y) else 0.0
        last = float(y[-1]) if len(y) else 0.0
        pct_change = ((last - first) / first * 100) if first else None
        rows.append({
            "agency": str(agency),
            "category": str(category),
            "combo": f"{category} | {agency}",
            "days": int(len(g)),
            "total": float(np.sum(y)),
            "average_per_day": mean_val,
            "slope_per_day": float(slope),
            "r2": float(r2),
            "first_day_value": first,
            "last_day_value": last,
            "pct_change": None if pct_change is None or not np.isfinite(pct_change) else float(pct_change),
            "direction": direction_from_slope(float(slope), mean_val),
        })
    return pd.DataFrame(rows)

@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    df = read_table_file(file)
    file_id = str(uuid.uuid4())
    STORE[file_id] = df
    lower = {c.lower().strip(): c for c in df.columns}
    suggested = {
        "date_col": lower.get("date", df.columns[0]),
        "duration_col": lower.get("duration", df.columns[0]),
        "agency_col": lower.get("agency", df.columns[0]),
        "category_col": lower.get("category", df.columns[0]),
    }
    return {"file_id": file_id, "columns": list(df.columns), "rows": len(df), "suggested_mapping": suggested}

@app.post("/analyze")
def analyze(mapping: Mapping):
    if mapping.file_id not in STORE:
        raise HTTPException(status_code=404, detail="File not found. Upload again.")
    df = STORE[mapping.file_id].copy()
    needed = [mapping.date_col, mapping.duration_col, mapping.agency_col, mapping.category_col]
    for c in needed:
        if c not in df.columns:
            raise HTTPException(status_code=400, detail=f"Column not found: {c}")

    work = pd.DataFrame({
        "date": parse_date(df[mapping.date_col]),
        "duration_min": clean_duration(df[mapping.duration_col]),
        "agency": df[mapping.agency_col].astype(str).str.strip().replace({"": "Unknown", "nan": "Unknown", "NaN": "Unknown"}),
        "category": df[mapping.category_col].astype(str).str.strip().replace({"": "Unknown", "nan": "Unknown", "NaN": "Unknown"}),
    }).dropna(subset=["date", "duration_min"])
    work = work[work["duration_min"] >= 0]
    if work.empty:
        raise HTTPException(status_code=400, detail="No valid rows after cleaning date and duration.")

    # Ensure missing days appear as zero for each combo, so trend is truly daily.
    min_d, max_d = pd.to_datetime(work["date"]).min(), pd.to_datetime(work["date"]).max()
    all_dates = pd.date_range(min_d, max_d, freq="D").date
    daily_raw = work.groupby(["date", "agency", "category"], as_index=False).agg(
        frequency=("duration_min", "size"),
        duration=("duration_min", "sum"),
        avg_duration=("duration_min", "mean"),
    )
    combos = daily_raw[["agency", "category"]].drop_duplicates()
    grid = combos.merge(pd.DataFrame({"date": all_dates}), how="cross")
    daily = grid.merge(daily_raw, on=["date", "agency", "category"], how="left").fillna({"frequency":0, "duration":0, "avg_duration":0})

    freq_stats = trend_stats(daily, "frequency").sort_values(["total", "slope_per_day"], ascending=[False, False])
    dur_stats = trend_stats(daily, "duration").sort_values(["total", "slope_per_day"], ascending=[False, False])
    n = max(1, min(mapping.top_n, 10))
    top_freq = freq_stats.head(n)
    top_dur = dur_stats.head(n)

    def series_for(top_df, metric):
        out = []
        for _, r in top_df.iterrows():
            g = daily[(daily["agency"] == r["agency"]) & (daily["category"] == r["category"])].sort_values("date")
            y = g[metric].astype(float).tolist()
            x = [str(v) for v in g["date"].tolist()]
            trend_y = []
            if len(y) >= 2:
                slope, intercept = np.polyfit(np.arange(len(y)), np.array(y), 1)
                trend_y = (intercept + slope * np.arange(len(y))).clip(min=0).tolist()
            out.append({
                "combo": r["combo"], "agency": r["agency"], "category": r["category"],
                "dates": x, "values": y, "trend": trend_y,
                "summary": r.to_dict()
            })
        return out

    return json_safe({
        "records_used": int(len(work)),
        "date_min": str(min_d.date()),
        "date_max": str(max_d.date()),
        "top_frequency": series_for(top_freq, "frequency"),
        "top_duration": series_for(top_dur, "duration"),
        "frequency_table": top_freq.to_dict(orient="records"),
        "duration_table": top_dur.to_dict(orient="records"),
    })
