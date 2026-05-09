from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import math
import json
import re
from collections import Counter
from io import BytesIO
from typing import Any, Dict, List

import numpy as np
import pandas as pd


app = FastAPI(
    title="Delay Similarity Grouping API",
    description="Groups similar delay descriptions using local TF-IDF cosine similarity.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DESCRIPTION_COLUMNS = [
    "Delay Description",
    "Description",
    "Delay Details",
    "Delay Detail",
    "Delay",
    "Delay Reason",
    "Reason",
    "Reason Description",
    "Problem",
    "Remarks",
]
CATEGORY_COLUMNS = ["Category", "Delay Category", "Delay Type", "Main Category", "Reason Group", "Major Reason"]
AGENCY_COLUMNS = ["Agency", "Department", "Responsible Agency", "Owner", "Section", "Area", "Dept"]

STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
}


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
        if name.endswith(".xlsx") or name.endswith(".xls"):
            return pd.read_excel(BytesIO(content))
        if name.endswith(".csv"):
            return pd.read_csv(BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read file: {exc}")
    raise HTTPException(status_code=400, detail="Only .xlsx, .xls and .csv files are supported.")


def clean_text(value: Any, default: str = "") -> str:
    if pd.isna(value):
        return default
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null", "nat"}:
        return default
    return text


def auto_mapping(df: pd.DataFrame) -> Dict[str, str]:
    return {
        "description": find_column(df, DESCRIPTION_COLUMNS),
        "category": find_column(df, CATEGORY_COLUMNS),
        "agency": find_column(df, AGENCY_COLUMNS),
    }


def safe_col(mapping: Dict[str, str], key: str) -> str:
    value = mapping.get(key, "") if mapping else ""
    return value if value and value != "__none__" else ""


def tokenize(text: str) -> List[str]:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return [token for token in tokens if len(token) > 1 and token not in STOP_WORDS]


def build_documents(df: pd.DataFrame, mapping: Dict[str, str]) -> pd.DataFrame:
    description_col = safe_col(mapping, "description")
    category_col = safe_col(mapping, "category")
    agency_col = safe_col(mapping, "agency")
    if not description_col:
        raise HTTPException(status_code=400, detail="Please map a description column.")

    work = pd.DataFrame(
        {
            "row_number": range(1, len(df) + 1),
            "description": df[description_col].apply(clean_text),
            "category": df[category_col].apply(lambda value: clean_text(value, "Unknown")) if category_col else "Unknown",
            "agency": df[agency_col].apply(lambda value: clean_text(value, "Unknown")) if agency_col else "Unknown",
        }
    )
    work = work[work["description"].str.len() > 0].copy()
    if work.empty:
        raise HTTPException(status_code=400, detail="No usable delay descriptions found.")

    work["document"] = (
        (work["description"] + " ") * 3
        + (work["category"] + " ") * 2
        + (work["agency"] + " ") * 2
    )
    return work


def vectorize(documents: List[str]) -> np.ndarray:
    tokenized = [tokenize(doc) for doc in documents]
    vocab_counter = Counter(token for tokens in tokenized for token in set(tokens))
    vocab = [token for token, count in vocab_counter.items() if count >= 1]
    if not vocab:
        return np.zeros((len(documents), 1), dtype=float)

    index = {token: idx for idx, token in enumerate(vocab)}
    matrix = np.zeros((len(documents), len(vocab)), dtype=float)
    doc_count = len(documents)
    idf = np.zeros(len(vocab), dtype=float)
    for token, idx in index.items():
        idf[idx] = math.log((1 + doc_count) / (1 + vocab_counter[token])) + 1

    for row_idx, tokens in enumerate(tokenized):
        counts = Counter(tokens)
        total = sum(counts.values()) or 1
        for token, count in counts.items():
            col_idx = index.get(token)
            if col_idx is not None:
                matrix[row_idx, col_idx] = (count / total) * idf[col_idx]

    norms = np.linalg.norm(matrix, axis=1)
    norms[norms == 0] = 1
    return matrix / norms[:, None]


def cluster_vectors(vectors: np.ndarray, threshold: float) -> List[int]:
    assignments: List[int] = []
    centroids: List[np.ndarray] = []
    counts: List[int] = []

    for vector in vectors:
        if not centroids:
            assignments.append(0)
            centroids.append(vector.copy())
            counts.append(1)
            continue

        similarities = np.array([float(np.dot(vector, centroid)) for centroid in centroids])
        best_idx = int(similarities.argmax())
        if similarities[best_idx] >= threshold:
            assignments.append(best_idx)
            counts[best_idx] += 1
            centroids[best_idx] = ((centroids[best_idx] * (counts[best_idx] - 1)) + vector) / counts[best_idx]
            norm = np.linalg.norm(centroids[best_idx])
            if norm:
                centroids[best_idx] = centroids[best_idx] / norm
        else:
            assignments.append(len(centroids))
            centroids.append(vector.copy())
            counts.append(1)

    return assignments


def summarize_groups(work: pd.DataFrame, vectors: np.ndarray, assignments: List[int]) -> List[Dict[str, Any]]:
    work = work.copy()
    work["cluster"] = assignments
    rows = []

    for cluster_id, group in work.groupby("cluster"):
        indices = group.index.to_numpy()
        group_vectors = vectors[indices]
        centroid = group_vectors.mean(axis=0)
        norm = np.linalg.norm(centroid)
        if norm:
            centroid = centroid / norm
        similarities = np.einsum("ij,j->i", group_vectors, centroid)
        representative_pos = int(np.argmax(similarities))
        representative = group.iloc[representative_pos]
        category_counts = group["category"].value_counts()
        agency_counts = group["agency"].value_counts()

        rows.append(
            {
                "group_id": int(cluster_id) + 1,
                "count": int(len(group)),
                "avg_similarity": round(float(similarities.mean()), 3),
                "representative_description": clean_text(representative["description"], "Unknown"),
                "top_category": clean_text(category_counts.index[0], "Unknown") if len(category_counts) else "Unknown",
                "top_agency": clean_text(agency_counts.index[0], "Unknown") if len(agency_counts) else "Unknown",
                "categories": [
                    {"name": clean_text(name, "Unknown"), "count": int(count)}
                    for name, count in category_counts.head(5).items()
                ],
                "agencies": [
                    {"name": clean_text(name, "Unknown"), "count": int(count)}
                    for name, count in agency_counts.head(5).items()
                ],
                "sample_delays": [
                    {
                        "row_number": int(item["row_number"]),
                        "description": clean_text(item["description"], "Unknown"),
                        "category": clean_text(item["category"], "Unknown"),
                        "agency": clean_text(item["agency"], "Unknown"),
                    }
                    for _, item in group.head(6).iterrows()
                ],
            }
        )

    return sorted(rows, key=lambda item: (-item["count"], item["group_id"]))


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


@app.post("/group")
async def group_delays(
    file: UploadFile = File(...),
    mapping_json: str = Form("{}"),
    similarity_threshold: float = Form(0.58),
    max_rows: int = Form(5000),
):
    raw = read_file(file)
    try:
        incoming_mapping = json.loads(mapping_json or "{}")
    except Exception:
        incoming_mapping = {}

    mapping = auto_mapping(raw)
    mapping.update({k: v for k, v in incoming_mapping.items() if v and v != "__none__"})

    threshold = min(max(float(similarity_threshold), 0.1), 0.95)
    limit = min(max(int(max_rows), 1), 20000)
    work = build_documents(raw.head(limit), mapping)
    vectors = vectorize(work["document"].tolist())
    assignments = cluster_vectors(vectors, threshold)
    groups = summarize_groups(work.reset_index(drop=True), vectors, assignments)

    return {
        "summary": {
            "rows_read": int(len(raw)),
            "rows_used": int(len(work)),
            "groups_found": int(len(groups)),
            "similarity_threshold": round(threshold, 2),
            "rows_limited_to": limit,
            "method": "TF-IDF cosine nearest-centroid grouping",
        },
        "mapping_used": mapping,
        "groups": groups,
    }
