# Unified Delay Analytics Workbench

This package combines the earlier separate delay analytics apps into one React + FastAPI application.

## Modules available from the left sidebar

1. Box Plot & Survival Analysis
2. Trend Advisor
3. Executive EDA Dashboard
4. Delay Association / Market Basket Analysis
5. Sequential Pattern Mining

## Run backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/Mac
# source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend health check:

```text
http://localhost:8000/health
```

## Run frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

## Notes

- Every module is available as a side-box tab.
- APIs are internally routed under these prefixes:
  - `/api/box`
  - `/api/trend`
  - `/api/eda`
  - `/api/association`
  - `/api/sequential`
- The frontend uses same-origin relative APIs by default. If the backend runs on another host, set `VITE_API_ROOT`, for example:

```bash
VITE_API_ROOT=http://localhost:8000 npm run dev
```

On Windows PowerShell:

```powershell
$env:VITE_API_ROOT="http://localhost:8000"; npm run dev
```
