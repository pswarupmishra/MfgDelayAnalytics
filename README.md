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

Docker setup files are included for both services:

- `backend/Dockerfile` builds the FastAPI API and installs `backend/requirements.txt`, including `scikit-learn` for Anomaly Advisor.
- `frontend/Dockerfile` builds the React app and serves it with Nginx.
- `frontend/nginx.conf` proxies `/api/*` requests to the backend container.
- `docker-compose.yml` runs both containers together.

### Run Locally With Docker Compose

From the repo root:

```bash
docker compose up --build
```

Open the app:

```text
http://localhost:5173
```

Backend health check:

```text
http://localhost:8000/health
```

Stop the containers:

```bash
docker compose down
```

### Build Docker Images

Set your Docker Hub username and optional tag:

```bash
export DOCKERHUB_USERNAME=your-dockerhub-username
export TAG=latest
```

Build both images:

```bash
docker compose build
```

This creates:

```text
your-dockerhub-username/unified-delay-backend:latest
your-dockerhub-username/unified-delay-frontend:latest
```

### Push Images To Docker Hub

Log in once:

```bash
docker login
```

Push both images:

```bash
docker compose push
```

### Pull And Run Images Elsewhere

```bash
docker network create unified-delay-net

docker run -d --name unified-delay-backend \
  --network unified-delay-net \
  -p 8000:8000 \
  your-dockerhub-username/unified-delay-backend:latest

docker run -d --name unified-delay-frontend \
  --network unified-delay-net \
  -p 5173:80 \
  your-dockerhub-username/unified-delay-frontend:latest
```

For normal local use, prefer `docker compose up --build` because Compose automatically wires the frontend container to the backend service name. More image publishing notes are in [DOCKER.md](DOCKER.md).

## Notes

- Uploads are processed locally by the FastAPI backend.
- The Anomaly Advisor requires `scikit-learn` from `backend/requirements.txt`.
- If the backend runs on another host, set `VITE_API_ROOT` before starting the frontend.

```bash
VITE_API_ROOT=http://localhost:8000 npm run dev
```
