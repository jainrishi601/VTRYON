"""U-DNA-1..6: tiles, heart/cross weights, never, stable name, export, forget."""

import pytest

from app import config, dna, sessions
from app.db import q

pytestmark = pytest.mark.usefixtures("fx_catalog")
T = "tok-dna-000000000000000"


def test_dna1_four_distinct_vibes():
    for occ, g, slot in (("Beach trip", "women", "one_piece"), ("Wedding", "men", "top"), (None, None, "one_piece")):
        tiles = dna.pick_tiles(occ, g)
        assert len(tiles) == 4 and len({v for v, _ in tiles}) == 4 and len({p["id"] for _, p in tiles}) == 4
        assert all(v in p["vibes"] and p["slot"] == slot for v, p in tiles)
    assert dna.representative("boho", "women")["id"] == dna.representative("boho", "women")["id"] == "wo4"


def test_dna2_heart_and_cross_weights():
    dna.pick(T, "minimal", "white", "heart")
    dna.pick(T, "bold", "red", "cross")
    tv = dna.taste_vector(T)
    assert tv == {"vibe:minimal": 1.0, "color:white": 0.5, "vibe:bold": -1.0, "color:red": -0.5}
    dna.record_look_event(T, [{"slot": "top", "product": {"vibes": ["minimal"], "color_family": "white"}}], "tried_on")
    assert dna.taste_vector(T)["vibe:minimal"] == 1.3


def test_dna3_two_crosses_make_never():
    dna.pick(T, "edgy", "black", "cross")
    assert dna.never_list(T) == []
    dna.pick(T, "edgy", "black", "cross")
    assert dna.never_list(T) == ["edgy"] and dna.summary(T)["never"] == ["edgy"]


def test_dna4_summary_name_stable_and_scoped():
    for v in ("minimal", "boho", "minimal"):
        dna.pick(T, v, "white", "heart")
    s = dna.summary(T)
    assert s["name"] == "Coastal Minimal" == dna.summary(T)["name"]
    assert s["traits"][:2] == ["Clean lines", "Flowing shapes"] and len(s["traits"]) == 3
    assert dna.summary(T, scope="recipient:brother") == {"vibes": {}, "colors": {}, "never": [], "name": None,
                                                         "traits": []}
    assert dna.summary("nobody")["name"] is None


def test_dna5_export_lists_edges():
    dna.pick(T, "classic", "blue", "heart")
    out = dna.export(T)
    assert len(out["edges"]) == 2 and {n["key"] for n in out["nodes"]} == {T, "classic", "blue"}
    assert out["summary"]["vibes"] == {"classic": 1.0}


def test_dna6_forget_deletes_everything():
    s, _, _ = sessions.create(T)
    url, key = sessions.save_photo(_jpeg())
    from app.db import ex
    ex("update sessions set photo_url=?, src_url=? where id=?", url, key, s["id"])
    ex("insert into renders(cache_key, src_key, status, local_path) values ('k1', ?, 'success', '/media/renders/k1.jpg')",
       key)
    ex("insert into renders(cache_key, src_key, status, local_path) values ('k2', 'k1', 'success', '/media/renders/k2.jpg')")
    ex("insert into renders(cache_key, src_key, status) values ('other', 'model:w1', 'success')")
    for k in ("k1", "k2"):
        config.media_path(f"/media/renders/{k}.jpg").write_bytes(b"x")
    dna.pick(T, "minimal", "white", "heart")
    sessions.forget(T)
    assert not q("select * from edges where user_token=?", T) and not q("select * from sessions where user_token=?", T)
    assert [r["cache_key"] for r in q("select cache_key from renders")] == ["other"]
    assert not config.media_path(url).exists() and not config.media_path("/media/renders/k2.jpg").exists()


def _jpeg():
    import io

    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (600, 900), "#abcdef").save(b, "JPEG")
    return b.getvalue()
