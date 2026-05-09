
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from io import BytesIO
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

app = FastAPI(
    title="Sequential Delay Mining API",
    description="Discovers ordered manufacturing delay chains from Excel/CSV delay logs.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DELAY_COLUMNS = [
    "Delay Details", "Delay Detail", "Delay", "Delay Category",
    "Category", "Reason", "Delay Reason", "Reason Description"
]

DATE_COLUMNS = ["Date", "Production Date", "Shift Date"]
START_COLUMNS = ["Start Time", "Start", "Delay Start", "From Time"]
AGENCY_COLUMNS = ["Agency", "Department", "Responsible Agency", "Owner"]
HEAT_COLUMNS = ["Heat No", "Heat", "Heat Number", "Heat ID", "Cast No", "Cast"]


def normalize_col(c: str) -> str:
    return str(c).strip().lower().replace("_", " ")


def find_column(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    normalized = {normalize_col(c): c for c in df.columns}
    for candidate in candidates:
        key = normalize_col(candidate)
        if key in normalized:
            return normalized[key]
    return None


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

    raise HTTPException(status_code=400, detail="Only .xlsx, .xls, and .csv files are supported.")


def build_timestamp(df: pd.DataFrame) -> pd.Series:
    date_col = find_column(df, DATE_COLUMNS)
    start_col = find_column(df, START_COLUMNS)

    if date_col and start_col:
        return pd.to_datetime(
            df[date_col].astype(str).str.strip() + " " + df[start_col].astype(str).str.strip(),
            errors="coerce",
        )

    if start_col:
        return pd.to_datetime(df[start_col], errors="coerce")

    return pd.Series(pd.date_range("2000-01-01", periods=len(df), freq="min"))


def clean_item(value: Any) -> Optional[str]:
    if pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    return text


def prepare_events(df: pd.DataFrame, delay_col: str, include_agency: bool) -> pd.DataFrame:
    working = df.copy()
    working["timestamp"] = build_timestamp(working)
    working = working.dropna(subset=["timestamp"])

    agency_col = find_column(working, AGENCY_COLUMNS)

    if include_agency and agency_col:
        working["delay_item"] = working.apply(
            lambda r: f"{clean_item(r[agency_col]) or 'Unknown Agency'} :: {clean_item(r[delay_col]) or 'Unknown Delay'}",
            axis=1,
        )
    else:
        working["delay_item"] = working[delay_col].apply(clean_item)

    working = working.dropna(subset=["delay_item"])
    working = working.sort_values("timestamp")
    return working


def create_sequences(events: pd.DataFrame, sequence_mode: str, window_minutes: int) -> List[List[str]]:
    heat_col = find_column(events, HEAT_COLUMNS)

    if sequence_mode == "heat" and heat_col:
        groups = events.groupby(heat_col)
    elif sequence_mode == "shift":
        temp = events.copy()
        hour = temp["timestamp"].dt.hour
        shift = pd.cut(
            hour,
            bins=[-1, 5, 13, 21, 23],
            labels=["C", "A", "B", "C"],
            ordered=False,
        )
        temp["sequence_group"] = temp["timestamp"].dt.date.astype(str) + " Shift-" + shift.astype(str)
        groups = temp.groupby("sequence_group")
    else:
        temp = events.copy()
        temp["sequence_group"] = temp["timestamp"].dt.floor(f"{window_minutes}min").astype(str)
        groups = temp.groupby("sequence_group")

    sequences = []
    for _, group in groups:
        ordered = group.sort_values("timestamp")["delay_item"].tolist()

        cleaned = []
        for item in ordered:
            if not cleaned or cleaned[-1] != item:
                cleaned.append(item)

        if len(cleaned) >= 2:
            sequences.append(cleaned)

    return sequences


def mine_sequential_patterns(
    sequences: List[List[str]],
    max_pattern_length: int,
    min_support_count: int,
    top_n: int,
) -> Dict[str, Any]:
    pattern_counter = Counter()
    transition_counter = Counter()
    antecedent_counter = Counter()

    for seq in sequences:
        for a, b in zip(seq, seq[1:]):
            transition_counter[(a, b)] += 1
            antecedent_counter[a] += 1

        for length in range(2, max_pattern_length + 1):
            for i in range(0, len(seq) - length + 1):
                pattern = tuple(seq[i:i + length])
                pattern_counter[pattern] += 1

    total_sequences = len(sequences)

    top_patterns = []
    for pattern, count in pattern_counter.most_common():
        if count < min_support_count:
            continue

        top_patterns.append({
            "sequence": " → ".join(pattern),
            "steps": list(pattern),
            "length": len(pattern),
            "count": count,
            "support": round(count / total_sequences, 4) if total_sequences else 0,
        })

        if len(top_patterns) >= top_n:
            break

    transitions = []
    for (a, b), count in transition_counter.items():
        probability = count / antecedent_counter[a] if antecedent_counter[a] else 0
        transitions.append({
            "from_delay": a,
            "to_delay": b,
            "count": count,
            "probability": round(probability, 4),
            "interpretation": f"After '{a}', '{b}' occurred next in {round(probability * 100, 1)}% of cases."
        })

    transitions = sorted(
        transitions,
        key=lambda x: (x["probability"], x["count"]),
        reverse=True
    )[:top_n]

    next_delay_prediction = defaultdict(list)
    for row in transitions:
        next_delay_prediction[row["from_delay"]].append({
            "next_delay": row["to_delay"],
            "probability": row["probability"],
            "count": row["count"],
        })

    return {
        "top_sequences": top_patterns,
        "transitions": transitions,
        "next_delay_prediction": dict(next_delay_prediction),
        "sequence_count": total_sequences,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/sequential-analyze")
async def sequential_analyze(
    file: UploadFile = File(...),
    delay_column: str = Form("auto"),
    sequence_mode: str = Form("time_window"),
    window_minutes: int = Form(120),
    max_pattern_length: int = Form(4),
    min_support_count: int = Form(2),
    include_agency: bool = Form(False),
):
    df = read_file(file)

    if df.empty:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if delay_column == "auto":
        delay_col = find_column(df, DELAY_COLUMNS)
    else:
        delay_col = delay_column if delay_column in df.columns else None

    if not delay_col:
        raise HTTPException(
            status_code=400,
            detail=f"Could not detect delay column. Available columns: {list(df.columns)}",
        )

    if window_minutes <= 0:
        raise HTTPException(status_code=400, detail="window_minutes must be greater than zero.")

    if max_pattern_length < 2:
        raise HTTPException(status_code=400, detail="max_pattern_length must be at least 2.")

    events = prepare_events(df, delay_col, include_agency)
    sequences = create_sequences(events, sequence_mode, window_minutes)

    mined = mine_sequential_patterns(
        sequences=sequences,
        max_pattern_length=max_pattern_length,
        min_support_count=min_support_count,
        top_n=50,
    )

    summary = {
        "rows_read": int(len(df)),
        "events_used": int(len(events)),
        "delay_column_used": delay_col,
        "sequence_mode": sequence_mode,
        "window_minutes": window_minutes,
        "sequences_analyzed": mined["sequence_count"],
        "top_sequences_found": len(mined["top_sequences"]),
        "transitions_found": len(mined["transitions"]),
    }

    return {
        "summary": summary,
        "top_sequences": mined["top_sequences"],
        "transitions": mined["transitions"],
        "next_delay_prediction": mined["next_delay_prediction"],
    }
