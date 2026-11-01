"""U-CAT-1..3: data/products.json shape and coverage (plus demo_looks / models integrity).
Pure stdlib; reads the data files directly. Standalone from repo root:
    uv run --with pytest pytest backend/tests/test_catalog_data.py -q --noconftest"""

import json
import re
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data"
PRODUCTS = json.loads((DATA / "products.json").read_text())
BY_ID = {p["id"]: p for p in PRODUCTS}
VIBES = {"minimal", "bold", "classic", "street", "boho", "sporty", "romantic", "edgy"}
SLOTS = {"top", "bottom", "one_piece", "layer", "bag", "accessory"}
REQUIRED = ["id", "title", "description", "price", "currency", "gender", "slot", "category", "colors", "color_family",
            "pattern", "vibes", "formality", "fit", "occasions", "statement_level", "fabric", "one_liner", "pairing",
            "image_url", "image_url_alt", "vto_ref_url", "vto_ready", "sizes_in_stock", "product_url"]
BRAND = re.compile(r"nicobar|\bnico\w*|tssx|\w*xnb\b|pratap|singleton social|aparna chandra", re.I)


def test_u_cat_1_loads_and_fields_non_empty():
    assert len(PRODUCTS) >= 450
    assert len(BY_ID) == len(PRODUCTS), "duplicate ids"
    for p in PRODUCTS:
        for k in REQUIRED:
            assert k in p and p[k] not in (None, "", []), f"{p['id']} missing {k}"
        assert isinstance(p["price"], int) and p["price"] > 0 and p["currency"] == "INR"
        assert p["gender"] in {"women", "men", "unisex"}
        assert p["fit"] in {"relaxed", "regular", "fitted"}
        assert p["image_url"].startswith("https://") and p["vto_ref_url"].startswith("https://")
        assert p["product_url"] == f"/p/{p['id']}"
        assert re.fullmatch(r"nl-\d{4}", p["id"])


def test_u_cat_1_no_source_brand():
    raw = (DATA / "products.json").read_text()
    assert not BRAND.search(raw), BRAND.search(raw)


def test_u_cat_2_slot_vibes_formality():
    for p in PRODUCTS:
        assert p["slot"] in SLOTS
        assert p["vibes"] and set(p["vibes"]) <= VIBES, p["id"]
        assert 1 <= p["formality"] <= 5
        assert p["slot"] in {"bag", "accessory"} or p["gender"] != "unisex", "unisex apparel"


def test_u_cat_3_coverage():
    c = Counter((p["gender"], p["slot"]) for p in PRODUCTS)
    for g in ("women", "men"):
        assert c[(g, "top")] >= 40 and c[(g, "bottom")] >= 25, c
    assert c[("women", "one_piece")] >= 25, c


def test_demo_looks_reference_real_products():
    looks = json.loads((DATA / "demo_looks.json").read_text())
    assert len(looks) == 12
    for lk in looks:
        items = [BY_ID[i["product_id"]] for i in lk["items"]]
        assert all(p["gender"] == lk["gender"] and p["slot"] == i["slot"] for p, i in zip(items, lk["items"], strict=True))
        assert lk["total"] == sum(p["price"] for p in items)
        slots = sorted(i["slot"] for i in lk["items"])
        assert slots == ["one_piece"] or {"top", "bottom"} <= set(slots)
        assert len(lk["name"].split()) == 2 and len(lk["why"].split()) <= 25 and "!" not in lk["why"]


def test_models_files_exist():
    models = json.loads((DATA / "models" / "models.json").read_text())
    assert {m["gender"] for m in models} == {"women", "men"}
    for m in models:
        assert (DATA / "models" / m["file"]).is_file() and m["licence"] and m["source_url"]
