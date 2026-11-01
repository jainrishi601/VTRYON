"""U-SC-1..6: compatibility score components, bands, reasons, alternatives."""

import pytest

from app import catalog, scoring

pytestmark = pytest.mark.usefixtures("fx_catalog")
G = catalog.get


def test_sc1_neutral_pairs_with_anything():
    for c in ("yellow", "pink", "red", "green"):
        assert scoring.color_score([{"color_family": "white"}, {"color_family": c}]) >= 90
    assert scoring.color_score([{"color_family": "red"}, {"color_family": "green"}]) < 60


def test_sc2_formality_gap_penalises():
    same = scoring.formality_score([{"formality": 2}, {"formality": 2}], "Beach trip")
    gap = scoring.formality_score([{"formality": 1}, {"formality": 4}], "Beach trip")
    assert same > gap
    assert scoring.formality_score([{"formality": 4}], "Wedding") > scoring.formality_score([{"formality": 4}], "Beach")


def test_sc3_relaxed_fitted_beats_same_fit():
    t = {"slot": "top", "fit": "relaxed"}
    assert scoring.silhouette_score([t, {"slot": "bottom", "fit": "fitted"}]) > scoring.silhouette_score(
        [t, {"slot": "bottom", "fit": "relaxed"}])
    assert scoring.silhouette_score([{"slot": "one_piece"}]) == 90


def test_sc4_bands():
    assert [scoring.band(s) for s in (100, 85, 84, 70, 69, 0)] == ["great", "great", "works", "works", "bold", "bold"]
    s = scoring.score_look([G("wt1"), G("wb1")], "Beach trip", None)
    assert s["band"] == scoring.band(s["score"]) and 0 <= s["score"] <= 100


def test_sc5_reason_names_strongest_and_tradeoff():
    s = scoring.score_look([G("wt1"), G("wb1")], "Beach trip", None)  # white+beige, relaxed+fitted
    assert s["reason"].startswith("An easy neutral palette")
    clash = scoring.score_look([G("wt3"), G("wb2")], None, None)  # pink+blue: warm/cool clash
    assert clash["reason"] == "Relaxed and fitted pieces balance each other, though the colours compete a little"
    assert scoring.score_look([G("wo0")], None, None)["reason"]


def test_sc6_alternatives_respect_remaining_budget():
    look = [G("wt1"), G("wb1")]  # 1500 + 1800; budget 4000 leaves 2500 for the bottom
    alts = scoring.alternatives(look, "bottom", 4000, "Beach trip", None)
    assert alts and all(a["product"]["price"] <= 2500 for a in alts)
    assert all(a["product"]["slot"] == "bottom" and a["product"]["id"] != "wb1" for a in alts)
    assert [a["score"] for a in alts] == sorted((a["score"] for a in alts), reverse=True)
    assert alts[0]["price_delta"] == alts[0]["product"]["price"] - 1800
    assert len(scoring.alternatives(look, "bottom", None, None, None)) == 4  # all other women's bottoms


def test_dna_component_uses_taste():
    taste = {"vibe:minimal": 2.0, "color:white": 1.0}
    assert scoring.dna_score([G("wt1"), G("wb1")], taste) > scoring.dna_score([G("wt2"), G("wb4")], taste)
    assert scoring.dna_score([G("wt1")], None) == 70
