# Docker Build and Docker Hub Push

This app is packaged as two Docker images:

- `unified-delay-backend`: FastAPI API on port `8000`
- `unified-delay-frontend`: React static build served by Nginx on port `80`

The frontend container proxies `/api/*` to the backend service when run with Docker Compose.

## Prerequisites

Install Docker Desktop or Docker Engine, then log in:

```bash
docker login
```

## Run Locally With Compose

From the repo root:

```bash
docker compose up --build
```

Open:

```text
http://localhost:5173
```

Backend health check:

```text
http://localhost:8000/health
```

## Build Images For Docker Hub

Set your Docker Hub username and optional tag:

```bash
export DOCKERHUB_USERNAME=your-dockerhub-username
export TAG=latest
```

Build both images:

```bash
docker compose build
```

The images will be named:

```text
your-dockerhub-username/unified-delay-backend:latest
your-dockerhub-username/unified-delay-frontend:latest
```

## Push To Docker Hub

```bash
docker compose push
```

Or push individually:

```bash
docker push your-dockerhub-username/unified-delay-backend:latest
docker push your-dockerhub-username/unified-delay-frontend:latest
```

## Pull And Run Elsewhere

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

For easiest deployment, prefer `docker compose up` so the frontend can reach the backend by service name.
