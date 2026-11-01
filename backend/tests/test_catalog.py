"""U-CAT-4..6: retrieval hard filters, relaxation ladder, never-list."""

import pytest

from app import catalog

pytestmark = pytest.mark.usefixtures("fx_catalog")


def test_cat4_hard_filters():
    out, _ = catalog.search("top", "men", max_price=1800)
    assert out and all(p["slot"] == "top" and p["gender"] in ("men", "unisex") and p["price"] <= 1800 for p in out)
    bags, _ = catalog.search("bag", "women")
    assert [p["id"] for p in bags] == ["ub1"]  # unisex counts for women


def test_cat5_relaxation_ladder():
    out, note = catalog.search("bottom", "women", colors=["purple"], vibes=["sporty"], max_price=2000)
    assert out and "dropped the colour filter" in note and all(p["slot"] == "bottom" for p in out)
    out, note = catalog.search("bottom", "women", max_price=1000)  # nothing under 1000, nothing under 1250
    assert out == [] and "No matches" in note
    out, note = catalog.search("bottom", "women", max_price=1500)
    assert [p["id"] for p in out] == ["wb1"] and "relaxed price to ₹1,875" in note
    exact, note = catalog.search("top", "women", query="linen shirt white")
    assert exact[0]["id"] == "wt1" and note == "5 matches"


def test_cat6_never_excludes():
    out, _ = catalog.search("top", "women", never=["yellow", "edgy"])
    ids = {p["id"] for p in out}
    assert "wt2" not in ids and "wt4" not in ids and "wt1" in ids


def test_list_products():
    items, total = catalog.list_products(gender="women", slot="bottom", q="trousers")
    assert total == 2 and {p["id"] for p in items} == {"wb1", "wb2"}
