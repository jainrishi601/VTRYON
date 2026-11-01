"""TRYON platform: accounts, onboarding profile -> DNA and widget, vibe looks, wardrobe tagging and pairing."""

import io
import time

import pytest
from PIL import Image

from app import config, dna, looks, sessions, tryon

pytestmark = pytest.mark.usefixtures("fx_catalog")


def jpg(size=(600, 900), color="#b9a58c") -> bytes:
    b = io.BytesIO()
    Image.new("RGB", size, color).save(b, "JPEG")
    return b.getvalue()


def signup(c, email="asha@example.com", **kw):
    r = c.post("/api/auth/signup", json={"name": "Asha", "email": email, "password": "secret12", **kw})
    assert r.status_code == 200, r.text
    return r.json()["auth"], r.json()["user"]


def H(auth):
    return {"Authorization": f"Bearer {auth}"}


def test_signup_login_and_token_carry_over(c):
    widget = c.post("/api/session", json={}).json()["user_token"]
    auth, user = signup(c, user_token=widget)
    assert user["user_token"] == widget  # taste from before signup carries over
    assert c.get("/api/me", headers=H(auth)).json()["email"] == "asha@example.com"
    assert c.post("/api/auth/signup", json={"email": "asha@example.com", "password": "secret12"}).status_code == 422
    assert c.post("/api/auth/login", json={"email": "asha@example.com", "password": "nope"}).status_code == 401
    auth2 = c.post("/api/auth/login", json={"email": "ASHA@example.com", "password": "secret12"}).json()["auth"]
    assert c.get("/api/me", headers=H(auth2)).status_code == 200
    assert c.get("/api/me").status_code == 401


def test_onboarding_answers_shape_dna_and_the_widget(c):
    auth, user = signup(c)
    tok = user["user_token"]
    r = c.patch("/api/me/profile", headers=H(auth), json={
        "goal": "build", "gender": "women", "sizes": {"region": "Asia", "tops": "M"}, "height_cm": 165,
        "colors": ["Navy", "Sage", "Ivory"], "never": ["pattern:floral", "category:shorts"]})
    assert r.json()["sizes"] == {"region": "Asia", "tops": "M"}
    tv = dna.taste_vector(tok)
    assert tv["color:blue"] > 0 and tv["color:green"] > 0 and tv["color:white"] > 0
    assert set(dna.never_list(tok)) == {"floral", "shorts"}
    assert c.post("/api/me/photo?kind=body", headers=H(auth), files={"file": ("b.jpg", jpg(), "image/jpeg")}).status_code == 200
    # a new widget chat starts with the gender (stated, so not asked again) and the full-body photo
    s, _, _ = sessions.create(tok)
    assert s["brief"]["gender"] == "women" and "gender" in sessions.confirmed(s)
    assert s["photo_url"].startswith("/media/photos/") and sessions.photo_gender(s) == "women"


def test_colours_without_a_key_start_from_neutrals(c, monkeypatch):
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    auth, _ = signup(c)
    c.post("/api/me/photo?kind=selfie", headers=H(auth), files={"file": ("s.jpg", jpg(), "image/jpeg")})
    r = c.post("/api/me/colors/analyze", headers=H(auth)).json()
    assert r["recommended"] == tryon.NEUTRAL_START and not r["analyzed"]
    assert all(x in tryon.PALETTE for x in r["recommended"])


def test_vibe_looks_render_on_the_body_photo_and_votes_teach_dna(c):
    auth, user = signup(c)
    c.patch("/api/me/profile", headers=H(auth), json={"gender": "women"})
    c.post("/api/me/photo?kind=body", headers=H(auth), files={"file": ("b.jpg", jpg(), "image/jpeg")})
    vibes = c.post("/api/me/vibes/start", headers=H(auth)).json()["vibes"]
    assert len(vibes) == len(config.VIBES) and len({v["vibe"] for v in vibes}) == len(config.VIBES)
    for _ in range(100):
        vs = c.get("/api/me/vibes", headers=H(auth)).json()["vibes"]
        if all(v["status"] != "pending" for v in vs):
            break
        time.sleep(0.03)
    assert all(v["rendered"] for v in vs)
    assert c.post("/api/me/vibes/start", headers=H(auth)).json()["vibes"][0]["id"] == vibes[0]["id"]  # idempotent
    boho = next(v for v in vs if v["vibe"] == "boho")
    edgy = next(v for v in vs if v["vibe"] == "edgy")
    c.post(f"/api/me/vibes/{boho['id']}", headers=H(auth), json={"verdict": "love"})
    c.post(f"/api/me/vibes/{edgy['id']}", headers=H(auth), json={"verdict": "dislike"})
    tv = dna.taste_vector(user["user_token"])
    assert tv["vibe:boho"] > 1 and tv["vibe:edgy"] < 0


def test_wardrobe_untagged_without_a_key_then_pairs_once_tagged(c, monkeypatch):
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    auth, user = signup(c)
    c.patch("/api/me/profile", headers=H(auth), json={"gender": "women"})
    items = c.post("/api/me/wardrobe", headers=H(auth), files=[("file", ("w.jpg", jpg(), "image/jpeg"))]).json()["items"]
    assert len(items) == 1 and not items[0]["tagged"]
    w = c.patch(f"/api/me/wardrobe/{items[0]['id']}", headers=H(auth), json={
        "name": "My Navy Chinos", "slot": "bottom", "category": "chinos", "color_family": "blue", "formality": 2}).json()
    assert w["tagged"]
    # the widget's "Pairs best with" for a top lists the shopper's own chinos first
    s, _, _ = sessions.create(user["user_token"])
    lk = looks.create_look(s["id"], "Test", "", [("top", "wt1")])
    alts = c.get(f"/api/looks/{lk['id']}/alternatives?slot=bottom").json()["items"]
    assert alts[0]["owned"] and alts[0]["product"]["title"] == "My Navy Chinos" and alts[0]["score"] > 0
    assert not any(a.get("owned") for a in alts[1:])
    c.patch(f"/api/me/wardrobe/{w['id']}", headers=H(auth), json={"allow_styling": False})
    assert not any(a.get("owned") for a in c.get(f"/api/looks/{lk['id']}/alternatives?slot=bottom").json()["items"])


def test_wardrobe_photo_with_two_pieces_is_tagged_and_cropped(c, monkeypatch):
    async def fake(prompt, path, tool):
        assert tool["name"] == "report_items"
        base = {"category": "", "colors": ["navy"], "pattern": "solid", "fabric": "linen", "vibes": ["minimal"],
                "formality": 2, "fit": "relaxed", "occasions": ["office"], "season": ["summer"]}
        return {"items": [{**base, "name": "Navy Linen Shirt", "slot": "top", "category": "shirt", "color_family": "blue",
                           "box": [0.1, 0.05, 0.8, 0.45]},
                          {**base, "name": "Sand Trousers", "slot": "bottom", "category": "trousers",
                           "color_family": "beige", "box": [0.15, 0.5, 0.7, 0.48]}]}
    monkeypatch.setattr(tryon, "_tool_call", fake)
    auth, user = signup(c)
    items = c.post("/api/me/wardrobe", headers=H(auth), files=[("file", ("o.jpg", jpg(), "image/jpeg"))]).json()["items"]
    assert [i["slot"] for i in items] == ["top", "bottom"] and all(i["tagged"] for i in items)
    assert all(i["image_url"].startswith("/media/wardrobe/") for i in items)
    assert len(c.get("/api/me/wardrobe", headers=H(auth)).json()["items"]) == 2
    assert dna.taste_vector(user["user_token"])["vibe:minimal"] > 0  # owning pieces is a quiet signal
    page = c.get("/api/me/dna", headers=H(auth)).json()
    assert page["wardrobe"] == {"top": 1, "bottom": 1}
    assert "wardrobe (pieces the shopper owns" in tryon.wardrobe_line(user["user_token"])


def test_dna_page_and_forgetting(c):
    auth, user = signup(c)
    c.patch("/api/me/profile", headers=H(auth), json={"gender": "men", "goal": "mindful", "colors": ["Navy"],
                                                       "never": ["pattern:floral"]})
    page = c.get("/api/me/dna", headers=H(auth)).json()
    labels = {f["label"]: f["value"] for f in page["facts"]}
    assert labels["Shops for"] == "Men's" and labels["Here to"] == "Shop more mindfully"
    assert page["never"] == ["floral"] and any(x["value"] == "blue" for x in page["learning"])
    c.delete("/api/me/dna?kind=pattern&value=floral", headers=H(auth))
    assert dna.never_list(user["user_token"]) == [] and tryon.profile(user["id"])["never"] == []


def _own(c, auth, name, slot, family, category, formality=2):
    from app import db
    tryon_item = c.post("/api/me/wardrobe", headers=H(auth), files=[("file", ("w.jpg", jpg(), "image/jpeg"))]).json()["items"][0]
    c.patch(f"/api/me/wardrobe/{tryon_item['id']}", headers=H(auth), json={
        "name": name, "slot": slot, "category": category, "color_family": family, "formality": formality})
    db.ex("update wardrobe set vibes=? where id=?", ["minimal"], tryon_item["id"])
    return tryon_item["id"]


def test_daily_picks_are_wardrobe_first_and_learn_from_feedback(c, monkeypatch):
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    auth, user = signup(c)
    c.patch("/api/me/profile", headers=H(auth), json={"gender": "men"})
    jeans = _own(c, auth, "My Indigo Jeans", "bottom", "blue", "jeans")
    picks = c.get("/api/me/daily", headers=H(auth)).json()["picks"]
    assert [p["kind"] for p in picks] == ["casual", "formal", "trendy"]
    ids = [[it["product"]["id"] for it in p["look"]["items"]] for p in picks]
    assert any(jeans in x for x in ids)  # the shopper's own piece is used
    assert all(it["product"]["gender"] in ("men", "unisex") for p in picks for it in p["look"]["items"])
    assert len({i for x in ids for i in x}) == sum(len(x) for x in ids)  # no piece repeats across the three
    assert all(p["look"]["name"] and p["look"]["why"] for p in picks)
    assert c.get("/api/me/daily", headers=H(auth)).json()["picks"][0]["look"]["id"] == picks[0]["look"]["id"]  # cached
    first = picks[0]
    c.post(f"/api/me/daily/{first['look']['id']}/feedback", headers=H(auth), json={"kind": "wore"})
    assert c.get("/api/me/daily", headers=H(auth)).json()["picks"][0]["feedback"] == "wore"
    again = c.post("/api/me/daily/regenerate", headers=H(auth)).json()["picks"]
    assert len(again) == 3 and again[0]["look"]["id"] != first["look"]["id"]


def test_style_play_pairs_differ_in_one_way_and_teach_taste(c, fx_catalog):
    from tests.conftest import P
    for i, (col, pat, vibe, st) in enumerate([("white", "solid", "minimal", 1), ("beige", "solid", "classic", 2),
                                              ("red", "floral", "bold", 5), ("green", "graphic", "street", 4)]):
        p = P(f"pt{i}", "top", "men", col, [vibe], 2000 + i * 100, formality=3, occasions=("office", "casual"),
              category="shirt")
        p["pattern"], p["statement_level"] = pat, st
        fx_catalog[p["id"]] = p
    auth, user = signup(c)
    c.patch("/api/me/profile", headers=H(auth), json={"gender": "men"})
    pair = c.get("/api/me/play?context=office", headers=H(auth)).json()["pair"]
    assert pair and pair["a"]["product"]["id"] != pair["b"]["product"]["id"]
    assert pair["a"]["product"]["slot"] == pair["b"]["product"]["slot"] == "top"
    before = dna.taste_vector(user["user_token"])
    c.post("/api/me/play", headers=H(auth), json={"pair_id": pair["id"], "choice": "a"})
    after = dna.taste_vector(user["user_token"])
    liked = pair["a"]["product"]["vibes"][0]
    assert after.get(f"vibe:{liked}", 0) > before.get(f"vibe:{liked}", 0)
    nxt = c.get("/api/me/play?context=office", headers=H(auth)).json()["pair"]
    assert not nxt or {nxt["a"]["product"]["id"], nxt["b"]["product"]["id"]}.isdisjoint(
        {pair["a"]["product"]["id"], pair["b"]["product"]["id"]})  # never shown twice


def test_recent_looks_are_the_stylists_not_onboarding(c):
    auth, user = signup(c)
    c.patch("/api/me/profile", headers=H(auth), json={"gender": "women"})
    c.post("/api/me/vibes/start", headers=H(auth))  # onboarding tiles live in the TRYON session
    s, _, _ = sessions.create(user["user_token"])  # a store chat
    lk = looks.create_look(s["id"], "Shore Linen", "", [("top", "wt1"), ("bottom", "wb1")])
    got = c.get("/api/me/looks", headers=H(auth)).json()["looks"]
    assert [x["id"] for x in got] == [lk["id"]]


def test_swap_in_a_piece_from_your_own_wardrobe(c):
    auth, user = signup(c)
    c.patch("/api/me/profile", headers=H(auth), json={"gender": "women"})
    c.post("/api/me/photo?kind=body", headers=H(auth), files={"file": ("b.jpg", jpg(), "image/jpeg")})
    mine = _own(c, auth, "My Blue Wide Jeans", "bottom", "blue", "jeans")
    s, _, _ = sessions.create(user["user_token"])  # a store chat: starts with the profile's photo
    lk = looks.create_look(s["id"], "Shore Linen", "", [("top", "wt1"), ("bottom", "wb1")])
    c.post(f"/api/looks/{lk['id']}/render", json={})
    for _ in range(100):
        if c.get(f"/api/looks/{lk['id']}").json()["render"]["status"] == "ready":
            break
        time.sleep(0.02)
    r = c.get(f"/api/looks/{lk['id']}/alternatives?slot=bottom").json()
    assert r["wardrobe"] == {"account": True, "owned": 1} and r["items"][0]["product"]["id"] == mine
    child = c.post(f"/api/looks/{lk['id']}/swap", json={"slot": "bottom", "product_id": mine}).json()
    bottom = next(it["product"] for it in child["items"] if it["slot"] == "bottom")
    assert bottom["id"] == mine and bottom["owned"] and bottom["price"] == 0
    assert child["total"] == next(it["product"]["price"] for it in child["items"] if it["slot"] == "top")
    for _ in range(100):
        st = c.get(f"/api/looks/{child['id']}").json()["render"]
        if st["status"] in ("ready", "failed"):
            break
        time.sleep(0.02)
    assert st["status"] == "ready"  # the store top re-renders on the photo; the owned jeans aren't drawn
    # nobody can swap in someone else's piece
    other_auth, _ = signup(c, email="zoe@example.com")
    theirs = _own(c, other_auth, "Zoe's Skirt", "bottom", "black", "skirt")
    assert c.post(f"/api/looks/{lk['id']}/swap", json={"slot": "bottom", "product_id": theirs}).status_code == 404


def test_alternatives_without_a_tryon_account_say_so(c):
    s, _, _ = sessions.create()
    lk = looks.create_look(s["id"], "Test", "", [("top", "wt1"), ("bottom", "wb1")])
    r = c.get(f"/api/looks/{lk['id']}/alternatives?slot=bottom").json()
    assert r["wardrobe"] == {"account": False, "owned": 0} and r["items"] and not any(a.get("owned") for a in r["items"])


def test_daily_picks_rebuild_when_the_wardrobe_changes(c, monkeypatch):
    """T3: picks made before the wardrobe existed are dropped on add/edit/delete; the next GET builds them again."""
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    auth, _ = signup(c)
    c.patch("/api/me/profile", headers=H(auth), json={"gender": "women"})
    before = c.get("/api/me/daily", headers=H(auth)).json()
    assert before["wardrobe_items"] == 0 and sum(p["owned"] for p in before["picks"]) == 0
    mine = _own(c, auth, "My Ivory Palazzos", "bottom", "white", "palazzo")
    after = c.get("/api/me/daily", headers=H(auth)).json()
    assert after["wardrobe_items"] == 1 and sum(p["owned"] for p in after["picks"]) >= 1
    assert after["picks"][0]["look"]["id"] != before["picks"][0]["look"]["id"]
    owned_pick = next(p for p in after["picks"] if p["owned"])
    assert owned_pick["look"]["undrawn_pieces"] == ["My Ivory Palazzos"]
    assert owned_pick["look"]["undrawn_note"] == (
        "Try-on shows the store pieces only, not your ivory palazzos.")
    c.patch(f"/api/me/wardrobe/{mine}", headers=H(auth), json={"allow_styling": False})
    assert sum(p["owned"] for p in c.get("/api/me/daily", headers=H(auth)).json()["picks"]) == 0
    c.delete(f"/api/me/wardrobe/{mine}", headers=H(auth))
    assert c.get("/api/me/daily", headers=H(auth)).json()["wardrobe_items"] == 0


def test_a_pick_never_has_two_pairs_of_shoes(c, monkeypatch):
    """T4: finishing pieces are one per slot."""
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    auth, _ = signup(c)
    c.patch("/api/me/profile", headers=H(auth), json={"gender": "women"})
    for n in ("Tan Sandals", "White Sneakers", "Black Heels"):
        _own(c, auth, n, "footwear", "brown", "sandals")
    _own(c, auth, "Gold Hoops", "accessory", "yellow", "earrings")
    for p in c.get("/api/me/daily", headers=H(auth)).json()["picks"]:
        slots = [it["slot"] for it in p["look"]["items"]]
        assert slots.count("footwear") <= 1 and slots.count("accessory") <= 1


def test_crop_boxes_for_small_and_worn_pieces():
    """T4: tiny pieces get a padded crop (never the whole photo), a missing box falls back to where the piece sits,
    a top stops at the trousers' waistband, and a flat-lay box outside the band is kept."""
    cb = tryon.crop_box
    e = cb([0.45, 0.12, 0.03, 0.03], "accessory", "earrings")  # a stud
    assert e and e[2] - e[0] >= 0.119 and e[3] - e[1] >= 0.119 and e[0] < 0.45 < 0.48 < e[2]
    assert cb([], "accessory", "hairpin") == (0.0, 0.0, 1.0, 0.25)
    assert cb(None, "footwear", "sandals") == (0.0, 0.82, 1.0, 1.0)
    assert cb([0, 0, 1, 1], "footwear") is not None  # small pieces never use the whole photo
    assert cb([], "top") is None and cb([0, 0, 1, 1], "top") is None  # a big piece alone may
    top = cb([0.2, 0.1, 0.6, 0.55], "top", "sweater", [("bottom", [0.2, 0.5, 0.6, 0.45])])
    assert top[3] <= 0.52 + 0.03 + 1e-9  # stops at the waistband (+ padding), not at 0.65
    flat = cb([0.1, 0.6, 0.5, 0.35], "top", "sweater")  # a flat lay with the sweater low in the frame
    assert flat[1] < 0.6 and flat[3] > 0.9


def test_look_items_carry_a_default_size(c):
    """I: profile size when known, else M, else the nearest in stock; bags One Size."""
    from app import catalog
    assert catalog.default_size({"slot": "bottom", "sizes_in_stock": ["XS", "S", "L", "XL"]}) == "L"
    assert catalog.default_size({"slot": "top", "sizes_in_stock": ["XS", "S", "M"]}, "XL") == "M"
    assert catalog.default_size({"slot": "bag", "sizes_in_stock": ["One Size"]}) == "One Size"
    auth, user = signup(c)
    c.patch("/api/me/profile", headers=H(auth), json={"gender": "women", "sizes": {"tops": "S", "bottoms": "L"}})
    s, _, _ = sessions.create(user["user_token"])
    lk = looks.create_look(s["id"], "Shore Linen", "", [("top", "wt1"), ("bottom", "wb1"), ("bag", "ub1")])
    assert {it["slot"]: it["size"] for it in lk["items"]} == {"top": "S", "bottom": "M", "bag": "One Size"}
    anon, _, _ = sessions.create()
    lk = looks.create_look(anon["id"], "Shore Linen", "", [("top", "wt1")])
    assert lk["items"][0]["size"] == "M" and lk["undrawn_pieces"] == [] and lk["undrawn_note"] is None
