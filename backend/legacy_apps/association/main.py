
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import itertools
import math
from io import BytesIO
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Tuple

app = FastAPI(
    title="Delay Association Intelligence API",
    description="Market-basket-style delay co-occurrence and association-rule mining for manufacturing delay logs.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

COMMON_DELAY_COLUMNS = [
    "Delay Details",
    "Delay Detail",
    "Delay",
    "Delay Category",
    "Category",
    "Reason",
    "Reason Description",
    "Delay Reason",
]

DATE_COLUMNS = ["Date", "Production Date", "Shift Date"]
START_COLUMNS = ["Start Time", "Start", "Delay Start", "From Time"]
END_COLUMNS = ["End Time", "End", "Delay End", "To Time"]
AGENCY_COLUMNS = ["Agency", "Department", "Responsible Agency", "Owner"]


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
        date_part = df[date_col].astype(str).str.strip()
        time_part = df[start_col].astype(str).str.strip()
        return pd.to_datetime(date_part + " " + time_part, errors="coerce")

    if start_col:
        return pd.to_datetime(df[start_col], errors="coerce")

    # Fallback: row order becomes synthetic time
    return pd.Series(pd.date_range("2000-01-01", periods=len(df), freq="min"))


def clean_item(value: Any) -> Optional[str]:
    if pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    return text


def build_transactions(
    df: pd.DataFrame,
    delay_col: str,
    mode: str,
    window_minutes: int,
    include_agency: bool,
) -> Tuple[List[List[str]], pd.DataFrame]:
    working = df.copy()
    working["__timestamp"] = build_timestamp(working)
    working = working.dropna(subset=["__timestamp"])

    agency_col = find_column(working, AGENCY_COLUMNS)

    if include_agency and agency_col:
        working["__item"] = working.apply(
            lambda r: f"{clean_item(r[agency_col]) or 'Unknown Agency'} :: {clean_item(r[delay_col]) or 'Unknown Delay'}",
            axis=1,
        )
    else:
        working["__item"] = working[delay_col].apply(clean_item)

    working = working.dropna(subset=["__item"])

    if mode == "time_window":
        working["__basket"] = working["__timestamp"].dt.floor(f"{window_minutes}min").astype(str)
    elif mode == "shift":
        hour = working["__timestamp"].dt.hour
        shift = pd.cut(
            hour,
            bins=[-1, 5, 13, 21, 23],
            labels=["C", "A", "B", "C"],
            ordered=False,
        )
        working["__basket"] = working["__timestamp"].dt.date.astype(str) + " Shift-" + shift.astype(str)
    elif mode == "agency" and agency_col:
        working["__basket"] = working[agency_col].fillna("Unknown Agency").astype(str)
    else:
        working["__basket"] = working["__timestamp"].dt.floor(f"{window_minutes}min").astype(str)

    grouped = (
        working.groupby("__basket")["__item"]
        .apply(lambda x: sorted(set(x)))
        .reset_index(name="items")
    )

    transactions = grouped["items"].tolist()
    transactions = [t for t in transactions if len(t) >= 2]
    return transactions, working


def mine_rules(
    transactions: List[List[str]],
    min_support: float,
    min_confidence: float,
    top_n: int = 50,
) -> Dict[str, Any]:
    n_txn = len(transactions)
    if n_txn == 0:
        return {"rules": [], "frequent_pairs": [], "item_frequency": [], "transaction_count": 0}

    item_counts = Counter()
    pair_counts = Counter()

    for txn in transactions:
        unique_items = sorted(set(txn))
        item_counts.update(unique_items)
        for a, b in itertools.combinations(unique_items, 2):
            pair_counts[(a, b)] += 1

    rules = []
    pair_rows = []

    for (a, b), pair_count in pair_counts.items():
        support = pair_count / n_txn
        if support < min_support:
            continue

        conf_a_b = pair_count / item_counts[a]
        conf_b_a = pair_count / item_counts[b]
        lift_a_b = conf_a_b / (item_counts[b] / n_txn)
        lift_b_a = conf_b_a / (item_counts[a] / n_txn)

        pair_rows.append({
            "delay_a": a,
            "delay_b": b,
            "count": pair_count,
            "support": round(support, 4),
            "lift": round(max(lift_a_b, lift_b_a), 3),
        })

        if conf_a_b >= min_confidence:
            rules.append({
                "antecedent": a,
                "consequent": b,
                "count": pair_count,
                "support": round(support, 4),
                "confidence": round(conf_a_b, 4),
                "lift": round(lift_a_b, 3),
                "interpretation": f"When '{a}' occurs, '{b}' also occurs in {round(conf_a_b * 100, 1)}% of matching baskets.",
            })

        if conf_b_a >= min_confidence:
            rules.append({
                "antecedent": b,
                "consequent": a,
                "count": pair_count,
                "support": round(support, 4),
                "confidence": round(conf_b_a, 4),
                "lift": round(lift_b_a, 3),
                "interpretation": f"When '{b}' occurs, '{a}' also occurs in {round(conf_b_a * 100, 1)}% of matching baskets.",
            })

    rules = sorted(rules, key=lambda x: (x["lift"], x["confidence"], x["support"]), reverse=True)[:top_n]
    pair_rows = sorted(pair_rows, key=lambda x: (x["lift"], x["count"]), reverse=True)[:top_n]

    item_frequency = [
        {
            "delay": item,
            "count": count,
            "support": round(count / n_txn, 4),
        }
        for item, count in item_counts.most_common(top_n)
    ]

    return {
        "rules": rules,
        "frequent_pairs": pair_rows,
        "item_frequency": item_frequency,
        "transaction_count": n_txn,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze_delay_file(
    file: UploadFile = File(...),
    delay_column: str = Form("auto"),
    mode: str = Form("time_window"),
    window_minutes: int = Form(30),
    min_support: float = Form(0.03),
    min_confidence: float = Form(0.30),
    include_agency: bool = Form(False),
):
    df = read_file(file)
    if df.empty:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if delay_column == "auto":
        detected_delay_col = find_column(df, COMMON_DELAY_COLUMNS)
    else:
        detected_delay_col = delay_column if delay_column in df.columns else None

    if not detected_delay_col:
        raise HTTPException(
            status_code=400,
            detail=f"Could not detect delay column. Available columns: {list(df.columns)}",
        )

    if window_minutes <= 0:
        raise HTTPException(status_code=400, detail="window_minutes must be greater than zero.")

    transactions, working = build_transactions(
        df=df,
        delay_col=detected_delay_col,
        mode=mode,
        window_minutes=window_minutes,
        include_agency=include_agency,
    )

    mined = mine_rules(
        transactions=transactions,
        min_support=min_support,
        min_confidence=min_confidence,
        top_n=50,
    )

    summary = {
        "rows_read": int(len(df)),
        "rows_used": int(len(working)),
        "delay_column_used": detected_delay_col,
        "transaction_mode": mode,
        "window_minutes": window_minutes,
        "baskets_analyzed": mined["transaction_count"],
        "rules_found": len(mined["rules"]),
        "frequent_pairs_found": len(mined["frequent_pairs"]),
    }

    return {
        "summary": summary,
        "rules": mined["rules"],
        "frequent_pairs": mined["frequent_pairs"],
        "item_frequency": mined["item_frequency"],
    }
