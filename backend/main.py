from pathlib import Path
import importlib.util
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR = Path(__file__).resolve().parent
LEGACY_DIR = BASE_DIR / "legacy_apps"

app = FastAPI(title="Unified Delay Analytics API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_subapp(name: str, folder: str):
    module_path = LEGACY_DIR / folder / "main.py"
    spec = importlib.util.spec_from_file_location(f"legacy_{name}", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.app


MOUNTED_APPS = {
    "association": load_subapp("association", "association"),
    "box-survival": load_subapp("box_survival", "box_survival"),
    "eda": load_subapp("eda", "eda"),
    "sequential": load_subapp("sequential", "sequential"),
    "trend": load_subapp("trend", "trend"),
}

app.mount("/api/association", MOUNTED_APPS["association"])
app.mount("/api/box", MOUNTED_APPS["box-survival"])
app.mount("/api/eda", MOUNTED_APPS["eda"])
app.mount("/api/sequential", MOUNTED_APPS["sequential"])
app.mount("/api/trend", MOUNTED_APPS["trend"])


@app.get("/health")
def health():
    return {"status": "ok", "apps": list(MOUNTED_APPS.keys())}
