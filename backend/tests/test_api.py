"""U-API-1..5 + DNA tiles over HTTP (RENDER_STUB=1, no network)."""

import io

import pytest
from PIL import Image

from app import config
from tests.conftest import new_session, wait

pytestmark = pytest.mark.usefixtures("fx_catalog")


def img(size=(600, 900), fmt="JPEG"):
    b = io.BytesIO()
    Image.new("RGB", size, "#a0a0a0").save(b, fmt)
    return b.getvalue()


def test_api1_status_and_store(c):
    s = c.get("/api/status").json()
    assert s["ok"] is True and s["catalog"]["count"] > 0 and s["youcam"] == {"units_left": None, "demo_mode": False}
    assert set(s["anthropic"]) == {"configured"}
    assert c.get("/api/store").json()["name"] == "Northline"
    assert c.get("/api/models").json()["models"][0] == {"id": "w1", "gender": "women", "label": "Model 1",
                                                        "image_url": "/media/models/w1.jpg"}
    r = c.get("/api/products", params={"gender": "women", "slot": "bottom", "max_price": 2000}).json()
    assert r["total"] == 2 and all(p["price"] <= 2000 for p in r["items"])
    assert c.get("/api/products/nope").json() == {"error": {"code": "product_not_found",
                                                            "message": "That piece isn't in the catalogue."}}


def test_api2_session_create_and_returning(c):
    r = c.post("/api/session", json={}).json()
    assert len(r["user_token"]) == 24 and r["returning"] is False and r["profile"] is None
    sid = r["session_id"]
    s = c.patch(f"/api/session/{sid}", json={"brief": {"for": "self", "occasion": "Beach trip", "budget_max": 4000}}).json()
    assert s["brief"] == {"for": "self", "occasion": "Beach trip", "budget_max": 4000}
    assert s["dna"] == {"vibes": {}, "colors": {}, "never": [], "name": None, "traits": []}
    again = c.post("/api/session", json={"user_token": r["user_token"]}).json()
    assert again["returning"] is True and again["session_id"] != sid
    assert again["profile"]["last_occasion"] == "Beach trip"
    assert c.get(f"/api/session/{again['session_id']}").json()["brief"]["occasion"] == "Beach trip"
    assert c.get("/api/session/nope").status_code == 404


def test_api3_photo_validation(c):
    sid = c.post("/api/session", json={}).json()["session_id"]

    def up(data, name="me.jpg"):
        return c.post(f"/api/session/{sid}/photo", files={"file": (name, data, "image/jpeg")})

    for data in (b"not an image", img((200, 300)), b"\xff" * (10 * 1024 * 1024 + 1)):
        r = up(data)
        assert r.status_code == 422 and r.json()["error"]["code"] == "photo_invalid"
    gif = io.BytesIO()
    Image.new("RGB", (600, 900)).save(gif, "GIF")
    assert up(gif.getvalue(), "x.gif").status_code == 422
    r = up(img((5000, 6000), "PNG"))
    assert r.status_code == 200 and r.json()["photo_url"].startswith("/media/photos/")
    assert max(Image.open(config.media_path(r.json()["photo_url"])).size) == 4096
    assert c.get(f"/api/session/{sid}").json()["photo_url"] == r.json()["photo_url"]


def test_api4_sample_model_photo(c):
    sid = c.post("/api/session", json={}).json()["session_id"]
    r = c.post(f"/api/session/{sid}/photo", json={"sample_model_id": "w1"})
    assert r.json() == {"photo_url": "/media/models/w1.jpg", "photo_gender": "women"}
    s = c.get(f"/api/session/{sid}").json()
    assert s["sample_model_id"] == "w1"
    assert c.post(f"/api/session/{sid}/photo", json={"sample_model_id": "zz"}).status_code == 422


def test_api5_tryon_builds_and_renders_a_look(c):
    sid = new_session(c)
    lk = c.post("/api/tryon", json={"session_id": sid, "product_ids": ["wt1", "wb1", "nope"]}).json()
    assert [it["slot"] for it in lk["items"]] == ["top", "bottom"] and lk["total"] == 3300
    assert lk["render"]["status"] in ("pending", "rendering") and lk["before_url"] == "/media/models/w1.jpg"
    assert lk["budget_max"] == 4000 and lk["over_budget_by"] is None and lk["score_band"] in ("great", "works", "bold")
    done = wait(c, f"/api/looks/{lk['id']}", lambda r: r["render"]["status"] == "ready")
    assert done["render"]["image_url"].startswith("/media/stub/") and done["render"]["steps_done"] == 2
    alts = c.get(f"/api/looks/{lk['id']}/alternatives", params={"slot": "bottom"}).json()
    assert alts["slot"] == "bottom" and all(a["product"]["price"] <= 2500 for a in alts["items"])
    sw = c.post(f"/api/looks/{lk['id']}/swap", json={"slot": "bottom", "product_id": alts["items"][0]["product"]["id"]})
    child = wait(c, f"/api/looks/{sw.json()['id']}", lambda r: r["render"]["status"] == "ready")
    assert child["parent_look_id"] == lk["id"] and child["render"]["steps_total"] == 1
    assert c.post(f"/api/looks/{lk['id']}/feedback", json={"kind": "cart"}).json() == {"ok": True}
    assert c.get(f"/api/session/{sid}").json()["dna"]["vibes"]["minimal"] == 0.9  # 0.3+0.3 tried, -0.7 swapped out, +1 cart
    v = c.post(f"/api/looks/{lk['id']}/video").json()
    assert v["video"]["status"] in ("pending", "ready", "failed")
    assert c.post("/api/tryon", json={"session_id": sid, "product_ids": ["nope"]}).status_code == 422


def test_dna_tiles_and_pick(c):
    sid = new_session(c)
    tiles = c.post(f"/api/session/{sid}/dna/tiles", json={}).json()["tiles"]
    assert len(tiles) == 4 and len({t["vibe"] for t in tiles}) == 4
    assert c.post(f"/api/session/{sid}/dna/tiles", json={}).json()["tiles"][0]["id"] == tiles[0]["id"]
    ready = wait(c, f"/api/session/{sid}/dna/tiles", lambda r: all(t["status"] == "ready" for t in r["tiles"]))
    assert all(t["image_url"] for t in ready["tiles"])
    t0, t1 = tiles[0], tiles[1]
    c.post(f"/api/session/{sid}/dna/pick", json={"tile_id": t0["id"], "verdict": "heart"})
    d = c.post(f"/api/session/{sid}/dna/pick", json={"tile_id": t1["id"], "verdict": "cross"}).json()["dna"]
    assert d["vibes"] == {t0["vibe"]: 1.0, t1["vibe"]: -1.0} and d["name"]


def test_tiles_without_photo_fall_back_to_product_image(c):
    sid = new_session(c, model=None)
    tiles = c.post(f"/api/session/{sid}/dna/tiles", json={}).json()["tiles"]
    assert all(t["status"] == "failed" and t["image_url"] == t["product"]["image_url"] for t in tiles)


def test_admin_and_dna_endpoints(c):
    assert c.get("/api/admin/renders").json()["totals"] == {"calls": 0, "cache_hits": 0, "units": 0}
    assert "YouCam API usage" in c.get("/admin/renders").text
    sid = new_session(c)
    tok = c.get(f"/api/session/{sid}").json()["user_token"]
    lk = c.post("/api/tryon", json={"session_id": sid, "product_ids": ["wo0"]}).json()
    c.post(f"/api/looks/{lk['id']}/feedback", json={"kind": "like"})
    assert c.get(f"/api/dna/{tok}").json()["edges"]
    assert c.delete(f"/api/dna/{tok}").json() == {"ok": True}
    assert c.get(f"/api/dna/{tok}").json()["edges"] == [] and c.get(f"/api/session/{sid}").status_code == 404
