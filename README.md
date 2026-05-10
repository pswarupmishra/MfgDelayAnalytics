# Unified Delay Analytics Workbench

A React + FastAPI workbench for manufacturing delay analysis. The app combines several delay analytics tools into one left-sidebar experience and supports Excel/CSV uploads for each module.

## Modules

1. **Box Plot & Survival Analysis**
   - Duration distribution, box plot style review, and survival/Kaplan-style delay analysis.

2. **Trend Advisor**
   - Finds top increasing/decreasing delay trends by Agency + Category.
   - Shows trend tables with compact sparklines for frequency and duration patterns.

3. **Executive EDA Dashboard**
   - High-level exploratory delay analytics, metrics, summaries, and visual breakdowns.

4. **Delay Grouping**
   - Uploads Excel/CSV delay data.
   - Groups similar delay descriptions using text similarity across description, category, and agency.
   - Shows grouped delay grids and supporting charts.

5. **Anomaly Advisor**
   - Uses an Isolation Forest model to flag unusually long delays by Agency + Category combination.
   - Lets users exclude selected Agency/Category combinations before running anomaly detection.
   - Shows priority combos, model thresholds, marked anomaly rows, anomaly scores, and full combo summaries.

6. **Delay Association / Market Basket Analysis**
   - Finds associations between delay attributes using market-basket style rules.

7. **Sequential Pattern Mining**
   - Finds common delay sequences and recurring event patterns.

## Project Structure

```text
backend/
  main.py                    # FastAPI app mounting all module APIs
  legacy_apps/               # Individual analytics APIs
frontend/
  src/App.jsx                # Unified sidebar shell
  src/components/            # React module screens
DOCKER.md                    # Docker build/push notes
docker-compose.yml           # Local container orchestration
```

## Run Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Windows PowerShell:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend health check:

```text
http://localhost:8000/health
```

## Run Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The Vite dev server proxies `/api` requests to `http://127.0.0.1:8000`.

## API Prefixes

- `/api/box`
- `/api/trend`
- `/api/eda`
- `/api/grouping`
- `/api/anomaly`
- `/api/association`
- `/api/sequential`

## Docker

Docker setup files are included for backend, frontend, and compose-based local runs. See [DOCKER.md](DOCKER.md) for image build and Docker Hub push steps.

## Notes

- Uploads are processed locally by the FastAPI backend.
- The Anomaly Advisor requires `scikit-learn` from `backend/requirements.txt`.
- If the backend runs on another host, set `VITE_API_ROOT` before starting the frontend.

```bash
VITE_API_ROOT=http://localhost:8000 npm run dev
```
