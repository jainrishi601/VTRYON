"""U-CREW-1..6: crew create/reuse, join with and without a photo, comments/reactions, verdict, share image."""

import io

import pytest
from PIL import Image

from tests.conftest import new_session, wait

pytestmark = pytest.mark.usefixtures("fx_catalog")


def look(c, sid, pids=("wt1", "wb1")):
    return c.post("/api/tryon", json={"session_id": sid, "product_ids": list(pids)}).json()


def test_crew1_create_reuses_per_session(c):
    sid = new_session(c)
    a, b = look(c, sid), look(c, sid, ("wo0",))
    cr = c.post("/api/crews", json={"session_id": sid, "look_id": a["id"], "display_name": "Priya"}).json()
    assert len(cr["id"]) == 16 and cr["name"] == "Beach trip crew" and cr["share_url"].endswith(f"/?crew={cr['id']}")
    assert cr["members"] == [{"id": cr["members"][0]["id"], "display_name": "Priya", "avatar_url": "/media/models/w1.jpg",
                              "is_owner": True, "is_you": True}]
    again = c.post("/api/crews", json={"session_id": sid, "look_id": b["id"]}).json()
    assert again["id"] == cr["id"] and [cl["look"]["id"] for cl in again["looks"]] == [a["id"], b["id"]]
    assert len(again["members"]) == 1


def test_crew2_join_without_photo(c):
    sid = new_session(c)
    lk = look(c, sid)
    cid = c.post("/api/crews", json={"session_id": sid, "look_id": lk["id"]}).json()["id"]
    r = c.post(f"/api/crews/{cid}/join", json={"display_name": "Ananya"}).json()
    assert len(r["member_token"]) == 24
    me = next(m for m in r["crew"]["members"] if m["is_you"])
    assert me["display_name"] == "Ananya" and me["avatar_url"] is None and not me["is_owner"]
    assert [x["member_id"] for x in r["crew"]["looks"][0]["renders"]] != [me["id"]]
    assert c.post(f"/api/crews/{cid}/join", json={"display_name": ""}).status_code == 422
    assert c.get("/api/crews/nope").status_code == 404


def test_crew3_join_with_photo_queues_member_renders(c):
    sid = new_session(c)
    a, b = look(c, sid), look(c, sid, ("wo0",))
    cid = c.post("/api/crews", json={"session_id": sid, "look_id": a["id"]}).json()["id"]
    c.post("/api/crews", json={"session_id": sid, "look_id": b["id"]})
    buf = io.BytesIO()
    Image.new("RGB", (600, 900), "#123456").save(buf, "JPEG")
    r = c.post(f"/api/crews/{cid}/join", data={"display_name": "Meera"}, files={"file": ("m.jpg", buf.getvalue())}).json()
    tok = r["member_token"]
    mid = next(m["id"] for m in r["crew"]["members"] if m["is_you"])
    crew = wait(c, f"/api/crews/{cid}?member_token={tok}", lambda cr: all(
        any(x["member_id"] == mid and x["status"] == "ready" for x in cl["renders"]) for cl in cr["looks"]))
    for cl in crew["looks"]:
        mine = next(x for x in cl["renders"] if x["member_id"] == mid)
        assert mine["image_url"] != cl["look"]["render"]["image_url"]
    # a look added later also renders on Meera
    third = look(c, sid, ("wo1",))
    c.post(f"/api/crews/{cid}/looks", json={"member_token": tok, "look_id": third["id"]})
    wait(c, f"/api/crews/{cid}", lambda cr: len(cr["looks"]) == 3 and any(
        x["member_id"] == mid for x in cr["looks"][2]["renders"]))
    assert c.post(f"/api/crews/{cid}/looks", json={"member_token": "bad", "look_id": a["id"]}).status_code == 403


def test_crew4_5_comments_reactions_verdict(c):
    sid = new_session(c)
    lk = look(c, sid)
    cid = c.post("/api/crews", json={"session_id": sid, "look_id": lk["id"]}).json()["id"]
    toks = [c.post(f"/api/crews/{cid}/join", json={"display_name": n}).json()["member_token"]
            for n in ("Meera", "Ananya", "Riya")]
    post = lambda tok, **kw: c.post(f"/api/crews/{cid}/comments", json={"member_token": tok, "look_id": lk["id"], **kw})  # noqa: E731
    cm = post(toks[0], slot="bottom", text="the trousers are a yes", reaction="up").json()
    assert cm["display_name"] == "Meera" and cm["slot"] == "bottom" and cm["reaction"] == "up" and cm["created_at"]
    post(toks[1], slot="top", text="swap the top for the white one", reaction="swap")
    post(toks[1], reaction="up")
    post(toks[2], slot="top", reaction="down")
    assert post("bad", reaction="up").status_code == 403
    assert post(toks[0]).status_code == 422
    cl = c.get(f"/api/crews/{cid}").json()["looks"][0]
    assert cl["slot_counts"]["bottom"] == {"up": 1, "down": 0, "swap": 0, "comments": 1}
    assert cl["slot_counts"]["top"] == {"up": 0, "down": 1, "swap": 1, "comments": 1}
    assert cl["verdict"] == {"up": 2, "down": 1, "voters": 3, "label": "2 of 4 love it"}
    crew = c.get(f"/api/crews/{cid}").json()
    assert len(crew["comments"]) == 4 and crew["updated_at"] == crew["comments"][-1]["created_at"]
    tok = c.get(f"/api/session/{sid}").json()["user_token"]
    edges = c.get(f"/api/dna/{tok}").json()["edges"]
    assert {e["type"] for e in edges} >= {"friend_liked", "friend_disliked"}


@pytest.mark.parametrize("fmt,size", [("square", (1080, 1080)), ("story", (1080, 1920))])
def test_crew6_share_png(c, fmt, size):
    sid = new_session(c)
    lk = look(c, sid)
    wait(c, f"/api/looks/{lk['id']}", lambda r: r["render"]["status"] == "ready")
    cid = c.post("/api/crews", json={"session_id": sid, "look_id": lk["id"]}).json()["id"]
    r = c.get(f"/api/crews/{cid}/share.png", params={"look_id": lk["id"], "format": fmt})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    im = Image.open(io.BytesIO(r.content))
    assert im.format == "PNG" and im.size == size
    assert c.get(f"/api/crews/{cid}/share.png", params={"look_id": "lk_nope"}).status_code == 404
