"""Part B: the wearer's gender is captured, saved and enforced; the question card and product grid."""

import time

import pytest

from app import db, looks, sessions
from app.agent import context, loop, tools

pytestmark = pytest.mark.usefixtures("fx_catalog")


def _session(brief=None, model=None) -> str:
    s, _, _ = sessions.create()
    if brief is not None:
        db.ex("update sessions set brief=? where id=?", brief, s["id"])
    if model:
        db.ex("update sessions set photo_url=?, src_url=? where id=?", f"/media/models/{model}.jpg", f"model:{model}",
              s["id"])
    return s["id"]


def _status(lid, want=("ready", "failed")):
    for _ in range(100):
        lk = looks.look_json(lid)
        if lk["render"]["status"] in want:
            return lk
        time.sleep(0.02)
    return looks.look_json(lid)


def _render(c, lid, model_id=None):
    c.post(f"/api/looks/{lid}/render", json={"model_id": model_id} if model_id else {})
    return _status(lid)


def test_answers_fill_the_brief():
    sid = _session()
    sessions.apply_answers(sid, [{"field": "gender", "value": "men"}, {"field": "occasion", "value": "Beach party"}])
    b = sessions.get_session(sid)["brief"]
    assert b["gender"] == "men" and b["occasion"] == "Beach party" and b["for"] == "self"
    sessions.apply_answers(sid, [{"field": "budget", "value": "₹5,000"}])
    assert sessions.get_session(sid)["brief"]["budget_max"] == 5000
    sessions.apply_answers(sid, [{"field": "budget", "value": "none"}])
    assert sessions.get_session(sid)["brief"]["budget_max"] is None


def test_gift_uses_the_recipients_gender_not_the_shoppers():
    sid = _session({"for": "self", "gender": "women"})
    sessions.update_brief(sid, relation="Brother")
    s = sessions.get_session(sid)
    assert s["brief"]["for"] == "other" and sessions.gender(s) == "men"
    sessions.update_brief(sid, relation="friend")  # a different person: their gender is not known yet
    assert sessions.gender(sessions.get_session(sid)) is None
    sessions.update_brief(sid, for_="self")
    assert sessions.gender(sessions.get_session(sid)) == "women"  # the shopper's own gender is kept


def test_women_look_never_renders_on_a_mens_photo(c):
    sid = _session({"for": "self", "gender": "women"}, model="m1")
    lk = looks.create_look(sid, "Test", "", [("one_piece", "wo0")])
    assert lk["render"]["status"] == "idle" and lk["gender"] == "women"
    lk = _render(c, lk["id"])
    assert lk["render"]["status"] == "failed" and lk["render"]["code"] == "gender_mismatch"
    lk = _render(c, lk["id"], model_id="w1")  # a women's sample model, without replacing the shopper's photo
    assert lk["render"]["status"] == "ready" and lk["model_id"] == "w1"
    assert sessions.get_session(sid)["src_url"] == "model:m1" and lk["before_url"] == "/media/models/w1.jpg"


def test_uploaded_photo_gender_is_respected(c):
    sid = _session({"for": "self", "gender": "men"})
    db.ex("update sessions set photo_url=?, src_url=?, photo_gender='women' where id=?", "/media/models/w1.jpg",
          "photo:abc", sid)
    lk = looks.create_look(sid, "Test", "", [("top", "mt0"), ("bottom", "mb1")])
    assert _render(c, lk["id"])["render"]["code"] == "gender_mismatch"


def test_bag_swap_reuses_the_render(c):
    sid = _session({"for": "self", "gender": "women"}, model="w1")
    lk = looks.create_look(sid, "Test", "", [("top", "wt1"), ("bottom", "wb1")])
    parent = _render(c, lk["id"])
    assert parent["render"]["status"] == "ready"
    n = db.q1("select count(*) n from renders")["n"]
    child = c.post(f"/api/looks/{lk['id']}/swap", json={"slot": "bag", "product_id": "ub1"}).json()
    child = _status(child["id"])
    assert child["render"]["image_url"] == parent["render"]["image_url"]
    assert db.q1("select count(*) n from renders")["n"] == n  # no new YouCam call


def test_swap_on_a_flat_look_stays_flat():
    sid = _session({"for": "self", "gender": "women"}, model="w1")
    lk = looks.create_look(sid, "Test", "", [("top", "wt1"), ("bottom", "wb1")])
    assert looks.swap(lk["id"], "top", "wt2")["render"]["status"] == "idle"


def test_product_grid_validation():
    sid = _session({"for": "self", "gender": "men"})
    t = context.Turn(sid=sid, message="x", target_gender="men")
    refs = {}
    for pid in ("mt0", "mt1", "wt1"):
        t.visible.add(pid)
        refs[pid] = t.refs.ref(pid)
    ps, errs = tools.validate_products(t, {"product_refs": [refs["mt0"], refs["wt1"], refs["mt0"], "c_99", refs["mt1"]]})
    assert [p["id"] for p in ps] == ["mt0", "mt1"]
    assert any("not a men's piece" in e for e in errs) and any("c_99" in e for e in errs)
    t.never = ["white"]
    assert [p["id"] for p in tools.validate_products(t, {"product_refs": [refs["mt0"], refs["mt1"]]})[0]] == ["mt1"]


def test_clarify_card_is_capped_and_cleaned():
    def q(f, n):
        return {"field": f, "question": "Q?", "options": [{"label": f"o{i}", "value": f"v{i}"} for i in range(n)]}

    card = tools.clean_clarify({"questions": [q("gender", 2), q("bogus", 3), q("occasion", 6), q("budget", 3)]})
    assert [x["field"] for x in card["questions"]] == ["gender", "occasion"]
    assert len(card["questions"][1]["options"]) == 4
    assert tools.clean_clarify({"questions": [q("gender", 1)]}) is None


def test_fallback_asks_gender_instead_of_guessing(c, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    sid = _session({"for": "self", "occasion": "Beach trip"})
    from tests.test_agent import events
    evs = events(c.post("/api/chat", json={"session_id": sid, "message": "beach looks"}))
    card = next(d for e, d in evs if e == "clarify")
    assert [q["field"] for q in card["questions"]] == ["gender"] and "looks" not in [e for e, _ in evs]
    evs = events(c.post("/api/chat", json={"session_id": sid, "message": "Men",
                                           "answers": [{"field": "gender", "value": "men"}]}))
    lks = next(d for e, d in evs if e == "looks")["looks"]
    assert lks and all(it["product"]["gender"] in ("men", "unisex") for lk in lks for it in lk["items"])


def test_wearer_update_changes_validation_gender():
    sid = _session({"for": "self", "gender": "women"})
    t = context.load(sid, "a farewell outfit for my brother")
    loop.apply_wearer(t, {"for": "other", "relation": "brother", "gender": "men", "occasion": "Farewell"})
    assert t.target_gender == "men" and sessions.get_session(sid)["brief"]["occasion"] == "Farewell"


def test_gift_taste_and_shopper_taste_stay_apart():
    from app import dna
    sid = _session({"for": "other", "gender": "men", "recipient": {"relation": "sister", "gender": "women"}})
    tok = sessions.get_session(sid)["user_token"]
    dna.add_edge(tok, "heart", "color", "beige", 1.0)  # the shopper's own taste
    dna.add_edge(tok, "tried_on", "color", "black", 1.0, scope="recipient:sister")
    t = context.load(sid, "now some casual shirts for me")
    assert "color:black" in t.taste and "color:beige" not in t.taste  # the turn starts on the recipient
    block = context.shopper_block(t)
    assert "style_dna:" in block and "recipient_dna (sister):" in block
    loop.apply_wearer(t, {"for": "self", "relation": "", "gender": "men", "occasion": ""})
    assert "color:beige" in t.taste and "color:black" not in t.taste and t.target_gender == "men"
    hits, _ = tools.search(t, {"slot": "top", "gender": "men", "for_whom": "recipient", "query": "shirt", "colors": [],
                               "vibes": [], "max_price": None, "formality_min": None, "formality_max": None,
                               "exclude_refs": [], "limit": 3})
    assert hits["count"] > 0


def test_a_new_chat_confirms_remembered_basics(c, monkeypatch):
    """Gender remembered from an earlier chat is asked again (not assumed) before the first looks of a new chat."""
    from app import config
    from tests.test_agent import events
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    first, _, _ = sessions.create()
    tok = first["user_token"]
    sessions.apply_answers(first["id"], [{"field": "gender", "value": "women"}, {"field": "occasion", "value": "Beach"}])
    nxt, returning, _ = sessions.create(tok)  # "New chat": the brief carries over, unconfirmed
    assert returning and nxt["brief"]["gender"] == "women" and not sessions.confirmed(nxt)
    t = context.load(nxt["id"], "beach outfit")
    block = context.shopper_block(t)
    assert "gender remembered from an earlier chat, NOT confirmed" in block and "shown in this chat so far: nothing yet" in block
    evs = events(c.post("/api/chat", json={"session_id": nxt["id"], "message": "beach outfit"}))
    card = next(d for e, d in evs if e == "clarify")
    assert card["questions"][0]["field"] == "gender"
    evs = events(c.post("/api/chat", json={"session_id": nxt["id"], "message": "Women",
                                           "answers": [{"field": "gender", "value": "women"}]}))
    assert "looks" in [e for e, _ in evs] and "gender" in sessions.confirmed(sessions.get_session(nxt["id"]))



def test_card_accepts_sharpening_questions():
    card = tools.clean_clarify({"questions": [
        {"field": "detail", "question": "What's your office dress code?",
         "options": [{"label": "Formal", "value": "Formal"}, {"label": "Smart casual", "value": "Smart casual"}]},
        {"field": "fit", "question": "Which fit?",
         "options": [{"label": "Relaxed", "value": "relaxed"}, {"label": "Fitted", "value": "fitted"}]}]})
    assert [q["field"] for q in card["questions"]] == ["detail", "fit"]
    sid = _session({"for": "self", "gender": "men"})
    sessions.apply_answers(sid, [{"field": "fit", "value": "relaxed"}, {"field": "detail", "value": "Formal"}])
    assert sessions.get_session(sid)["brief"]["fit"] == "relaxed"  # fit is saved; the dress code rides in the message
