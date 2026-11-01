"""Every test gets a fresh SQLite DB + media dir, RENDER_STUB on, and no network.
Opt into the small fixture catalogue with `pytestmark = pytest.mark.usefixtures("fx_catalog")`."""

import json
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import catalog, config, db, youcam


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "elara.db")
    monkeypatch.setattr(config, "MEDIA_DIR", tmp_path / "media")
    monkeypatch.setattr(config, "RENDER_STUB", True)
    monkeypatch.setattr(config, "YOUCAM_DEMO_MODE", False)
    monkeypatch.setattr(config, "YOUCAM_API_KEY", "sk-test")
    monkeypatch.setattr(config, "PUBLIC_BASE_URL", "")
    monkeypatch.setattr(config, "POLL_S", 0)
    monkeypatch.setattr(config, "BACKOFF", (0, 0, 0))
    monkeypatch.setattr(youcam, "_credit_flip", False)
    monkeypatch.setattr(youcam, "_transport", None)
    models = tmp_path / "models"
    models.mkdir()
    for mid in ("w1", "m1"):
        Image.new("RGB", (600, 900), "#c9b8a6").save(models / f"{mid}.jpg")
    (models / "models.json").write_text(json.dumps(
        [{"id": "w1", "gender": "women", "label": "Model 1", "file": "w1.jpg"},
         {"id": "m1", "gender": "men", "label": "Model 2", "file": "m1.jpg"}]))
    monkeypatch.setattr(config, "MODELS_DIR", models)
    db.init_db()
    yield tmp_path


def P(pid, slot, gender, color, vibes, price, formality=2, fit="regular", occasions=("beach", "vacation"),
      category=None, title=None):
    return {"id": pid, "title": title or f"{color.title()} {category or slot}", "description": "", "price": price,
            "currency": "INR", "gender": gender, "slot": slot, "category": category or slot, "colors": [color],
            "color_family": color, "pattern": "solid", "vibes": list(vibes), "formality": formality, "fit": fit,
            "occasions": list(occasions), "statement_level": 2, "fabric": "linen", "one_liner": "An easy piece.",
            "pairing": {"colors": [], "avoid": []}, "image_url": f"https://img.test/{pid}.jpg",
            "image_url_alt": None, "vto_ref_url": f"https://img.test/{pid}_vto.jpg", "vto_ready": True,
            "sizes_in_stock": ["S", "M"], "product_url": f"/p/{pid}"}


FIXTURE = [
    P("wt1", "top", "women", "white", ["minimal"], 1500, fit="relaxed", category="shirt", title="Linen Shirt - White"),
    P("wt2", "top", "women", "yellow", ["bold"], 1800, fit="fitted", category="blouse"),
    P("wt3", "top", "women", "pink", ["romantic"], 2200, fit="fitted"),
    P("wt4", "top", "women", "black", ["edgy"], 2600, formality=3),
    P("wt5", "top", "women", "beige", ["classic", "minimal"], 3200, formality=3, fit="fitted"),
    P("wb1", "bottom", "women", "beige", ["minimal"], 1800, fit="fitted", category="trousers"),
    P("wb2", "bottom", "women", "blue", ["classic"], 2000, fit="relaxed", category="trousers"),
    P("wb3", "bottom", "women", "green", ["boho"], 2400, fit="relaxed", category="skirt"),
    P("wb4", "bottom", "women", "red", ["bold"], 3500, formality=3, category="skirt"),
    P("wb5", "bottom", "women", "black", ["minimal"], 5200, formality=4, fit="fitted"),
    P("wl1", "layer", "women", "brown", ["classic"], 3000, category="jacket"),
    *[P(f"wo{i}", "one_piece", "women", c, [v], 2500 + 100 * i, category="dress")
      for i, (v, c) in enumerate(zip(config.VIBES, ["white", "red", "blue", "black", "green", "grey", "pink", "black"],
                                     strict=True))],
    *[P(f"mt{i}", "top", "men", c, [v], 1500 + 100 * i, category="shirt")
      for i, (v, c) in enumerate(zip(config.VIBES, ["white", "red", "blue", "black", "green", "grey", "pink", "black"],
                                     strict=True))],
    P("mb1", "bottom", "men", "beige", ["minimal"], 2000, category="chinos"),
    P("mb2", "bottom", "men", "blue", ["street"], 2500, category="jeans", fit="relaxed"),
    P("ub1", "bag", "unisex", "brown", ["classic"], 1200, category="tote"),
]


@pytest.fixture
def fx_catalog(monkeypatch):
    monkeypatch.setattr(catalog, "PRODUCTS", {p["id"]: p for p in FIXTURE})
    return catalog.PRODUCTS


@pytest.fixture
def c():
    from app.main import app

    with TestClient(app) as client:
        yield client


def wait(c, path, done):
    for _ in range(50):
        r = c.get(path).json()
        if done(r):
            return r
        time.sleep(0.1)
    raise AssertionError(f"timed out: {r}")


def new_session(c, model="w1", brief=None):
    sid = c.post("/api/session", json={}).json()["session_id"]
    c.patch(f"/api/session/{sid}", json={"brief": brief or {"for": "self", "occasion": "Beach trip", "budget_max": 4000,
                                                             "gender": "women"}})
    if model:
        c.post(f"/api/session/{sid}/photo", json={"sample_model_id": model})
    return sid
