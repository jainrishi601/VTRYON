"""U-AG-1..3: fallback turn with no key, present_looks validator, SSE framing + close after renders settle."""

import asyncio
import json

import pytest

from app import catalog, config, db, renders, sessions
from app.agent import context, loop, tools
from app.youcam import TryOnResult


@pytest.fixture
def app_client(c, monkeypatch):
    """The real app (conftest `c`: fresh DB, RENDER_STUB) on the real catalogue, with no Anthropic key."""
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    catalog.load()
    return c


def new_session(brief=None, photo=False, confirmed=True) -> str:
    s, _, _ = sessions.create()
    if brief:
        db.ex("update sessions set brief=? where id=?", brief, s["id"])
        if confirmed:  # as if the shopper answered these on the card in this chat
            sessions.confirm(s["id"], sessions.BASICS)
    if photo:
        db.ex("update sessions set photo_url=?, src_url=? where id=?", "/media/models/w1.jpg", "model:w1", s["id"])
    return s["id"]


def events(resp) -> list[tuple[str, dict]]:
    out = []
    for frame in resp.text.split("\n\n"):
        if not frame.strip():
            continue
        lines = frame.split("\n")
        assert lines[0].startswith("event: ") and lines[1].startswith("data: "), frame
        out.append((lines[0][7:], json.loads(lines[1][6:])))
    return out


BEACH = {"for": "self", "gender": "women", "occasion": "Beach trip", "budget_max": 12000}


def test_fallback_turn_without_key(app_client):  # U-AG-1
    sid = new_session(BEACH)
    r = app_client.post("/api/chat", json={"session_id": sid, "message": "Goa beach trip, you know my budget."})
    assert r.headers["content-type"].startswith("text/event-stream")
    evs = events(r)
    kinds = [e for e, _ in evs]
    assert kinds[0] == "status" and kinds[-1] == "done"
    assert "text" in kinds and kinds.index("text") < kinds.index("looks")
    lks = next(d for e, d in evs if e == "looks")["looks"]
    assert 2 <= len(lks) <= 3
    for lk in lks:
        slots = {it["slot"] for it in lk["items"]}
        assert {"top", "bottom"} <= slots or "one_piece" in slots
        assert all(it["product"]["gender"] in ("women", "unisex") for it in lk["items"])
    # persisted for reload
    msgs = app_client.get(f"/api/session/{sid}/messages").json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"] and len(msgs[1]["looks"]) == len(lks)


def _turn(sid, never=(), budget=4000, gender="men"):
    t = context.Turn(sid=sid, message="x", budget=budget, target_gender=gender, never=list(never))
    return t


def _ref(t, pid):
    t.visible.add(pid)
    return t.refs.ref(pid)


def _pick(gender, slot, cheap=True, **kw):
    rows = [p for p in catalog.PRODUCTS.values() if p["gender"] == gender and p["slot"] == slot
            and all(p.get(k) == v for k, v in kw.items())]
    return sorted(rows, key=lambda p: p["price"] if cheap else -p["price"])[0]


def test_validator(app_client):  # U-AG-2
    t = _turn("s")
    top, top2, bottom = _pick("men", "top"), _pick("men", "top", cheap=False), _pick("men", "bottom")
    w_bottom = _pick("women", "bottom")
    r = {k: _ref(t, p["id"]) for k, p in [("top", top), ("top2", top2), ("bottom", bottom), ("wb", w_bottom)]}
    t.budget = top["price"] + bottom["price"]

    def check(*looks, **extra):
        inp = {"message": "m", "looks": [{"name": f"N{i}", "why": "Easy linen for the heat", "item_refs": refs, "over_budget": ob}
                                          for i, (refs, ob) in enumerate(looks)], "modifies_look_id": None,
               "budget_per_look": None, "wearer_is_minor": False, **extra}
        checked, errs = tools.validate(t, inp)
        return errs + [e for c in checked for e in c["errors"]]

    assert check(([r["top"], r["bottom"]], False)) == []
    assert any("not returned" in e for e in check(([r["top"], "c_999"], False)))
    assert any("slot top" in e for e in check(([r["top"], r["top2"], r["bottom"]], False)))
    assert any("incomplete" in e for e in check(([r["top"]], False)))
    assert any("over the" in e for e in check(([r["top2"], r["bottom"]], False)))
    assert check(([r["top2"], r["bottom"]], True)) == []  # acknowledged overage is accepted
    assert check(([r["top2"], r["bottom"]], False), budget_per_look=10**6) == []
    assert any("not men's" in e for e in check(([r["top"], r["wb"]], False)))
    t.never = [top["color_family"]]
    assert any("never list" in e for e in check(([r["top"], r["bottom"]], False)))
    t.never = []
    assert any("identical" in e for e in check(([r["top"], r["bottom"]], False), ([r["bottom"], r["top"]], False)))
    assert any("at most" in e for e in check(*[([r["top"], r["bottom"]], False)] * 4))


def _fake_renders(monkeypatch) -> list:
    calls = []

    async def fake_run(steps, src, session_id=None, on_step=None):
        for i, _ in enumerate(steps):
            calls.append(i)
            await asyncio.sleep(0.01)
            if on_step:
                on_step(i + 1, None)
        return TryOnResult("/media/stub/x.jpg", "", f"k{len(calls)}", False, 0, 50), False

    monkeypatch.setattr(renders, "run", fake_run)
    return calls


def test_looks_auto_render_when_a_photo_is_set(app_client, monkeypatch):  # U-AG-3, QA finding A
    calls = _fake_renders(monkeypatch)
    sid = new_session(BEACH, photo=True)
    evs = events(app_client.post("/api/chat", json={"session_id": sid, "message": "beach looks please"}))
    kinds = [e for e, _ in evs]
    assert kinds[-1] == "done" and kinds.count("done") == 1
    lks = next(d for e, d in evs if e == "looks")["looks"]
    assert {lk["render"]["status"] for lk in lks} <= {"pending", "rendering"} and len(lks) >= 2
    # the stream keeps sending `look` updates and closes only once every render settled
    final = {d["look"]["id"]: d["look"]["render"]["status"] for e, d in evs if e == "look"}
    assert final == {lk["id"]: "ready" for lk in lks} and calls
    assert kinds.index("looks") < kinds.index("look") < kinds.index("done")


def test_looks_arrive_flat_without_a_photo_then_render_on_a_picked_model(app_client, monkeypatch):
    calls = _fake_renders(monkeypatch)
    sid = new_session(BEACH)
    evs = events(app_client.post("/api/chat", json={"session_id": sid, "message": "beach looks please"}))
    lks = next(d for e, d in evs if e == "looks")["looks"]
    assert {lk["render"]["status"] for lk in lks} == {"idle"} and "look" not in [e for e, _ in evs] and not calls
    # the widget's "Pick a model" strip: set a sample model, then start every look
    assert app_client.post(f"/api/session/{sid}/photo", json={"sample_model_id": "w1"}).status_code == 200
    for lk in lks:
        assert app_client.post(f"/api/looks/{lk['id']}/render", json={}).status_code == 200
    for _ in range(100):
        if all(app_client.get(f"/api/looks/{lk['id']}").json()["render"]["status"] == "ready" for lk in lks):
            break
        asyncio.run(asyncio.sleep(0.02))
    assert all(app_client.get(f"/api/looks/{lk['id']}").json()["render"]["status"] == "ready" for lk in lks)


def test_a_mens_look_does_not_auto_render_on_a_womens_photo(app_client, monkeypatch):
    calls = _fake_renders(monkeypatch)
    sid = new_session({"for": "other", "recipient": {"relation": "brother", "gender": "men"},
                       "occasion": "Farewell", "budget_max": 20000}, photo=True)
    evs = events(app_client.post("/api/chat", json={"session_id": sid, "message": "farewell looks"}))
    lks = next(d for e, d in evs if e == "looks")["looks"]
    assert {lk["render"]["status"] for lk in lks} == {"idle"} and not calls


def test_unknown_session_gets_error_and_done(app_client):
    evs = events(app_client.post("/api/chat", json={"session_id": "nope", "message": "hi"}))
    assert [e for e, _ in evs][-2:] == ["error", "done"]


def test_trace_recorded(app_client):
    sid = new_session(BEACH)
    app_client.post("/api/chat", json={"session_id": sid, "message": "hi"})
    assert any(x.get("fallback") for x in loop.TRACES[sid])


# ---------- scripted Claude (no network): exercises the real loop, tools, validator and repair round ----------

from types import SimpleNamespace as NS  # noqa: E402


def _msg(*blocks, stop="tool_use"):
    return NS(content=list(blocks), stop_reason=stop, usage=NS(input_tokens=1, output_tokens=1,
                                                                cache_read_input_tokens=0))


def _use(i, name, **inp):
    return NS(type="tool_use", id=f"tu_{i}", name=name, input=inp)


class FakeClaude:
    def __init__(self, script):
        self.script, self.calls = list(script), []
        self.beta = self.messages = self

    def stream(self, **kw):
        self.calls.append(kw)
        msg = self.script.pop(0)(kw)
        texts = [b.text for b in msg.content if b.type == "text"]

        class S:
            async def __aenter__(s):
                return s

            async def __aexit__(s, *a):
                return False

            async def __aiter__(s):
                for t in texts:
                    yield NS(type="text", text=t)

            async def get_final_message(s):
                return msg
        return S()


def _search(slot):
    return dict(slot=slot, gender="women", query="linen", colors=[], vibes=[], max_price=None, formality_min=None,
                formality_max=None, exclude_refs=[], limit=5)


def _results(kw):
    """tool_use id -> parsed search results from the last user message."""
    return {b["tool_use_id"]: json.loads(b["content"]) for b in kw["messages"][-1]["content"]
            if b.get("type") == "tool_result" and not b.get("is_error")}


def test_scripted_claude_search_repair_present(app_client, monkeypatch):
    def r1(kw):
        assert kw["tools"][0]["strict"] and kw["output_config"] == {"effort": "low"}
        assert "budget_tokens" not in kw["thinking"] and "tool_choice" not in kw
        return _msg(_use(1, "search_catalog", **_search("top")), _use(2, "search_catalog", **_search("bottom")))

    def present(kw, bad):
        res = _results(kw) if bad else state["res"]
        state["res"] = res
        tops, bottoms = [x["ref"] for x in res["tu_1"]["results"]], [x["ref"] for x in res["tu_2"]["results"]]
        looks_ = [{"name": "Sunset Linen", "item_refs": [tops[0], bottoms[0]], "why": "Easy linen for the heat", "over_budget": True},
                  {"name": "Monsoon Ink", "item_refs": [tops[1], bottoms[1]] + ([tops[2]] if bad else []),
                   "why": "Easy linen for the heat", "over_budget": True}]
        return _msg(_use(3 + bad, "present_looks", message="Two easy linen looks for you.", looks=looks_,
                         modifies_look_id=None, budget_per_look=None, wearer_is_minor=False))

    state = {}
    fake = FakeClaude([r1, lambda kw: present(kw, True), lambda kw: present(kw, False)])
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(loop, "_client", fake)
    sid = new_session(BEACH)
    evs = events(app_client.post("/api/chat", json={"session_id": sid, "message": "linen please"}))
    labels = [d["label"] for e, d in evs if e == "status" and d["state"] == "done"]
    assert any(lb.startswith("Found 5 tops") for lb in labels) and any("bottoms" in lb for lb in labels)
    assert "".join(d["delta"] for e, d in evs if e == "text") == "Two easy linen looks for you."
    lks = next(d for e, d in evs if e == "looks")["looks"]
    assert [lk["name"] for lk in lks] == ["Sunset Linen", "Monsoon Ink"]
    repair = fake.calls[2]["messages"][-1]["content"][0]
    assert repair["is_error"] and "slot top" in repair["content"]
    assert len(fake.calls) == 3 and not any(x.get("fallback") for x in loop.TRACES[sid])
    # the follow-up turn sees these looks with stable refs
    t = context.load(sid, "next")
    assert [lk["name"] for lk in t.current] == ["Sunset Linen", "Monsoon Ink"]
    assert "Sunset Linen" in context.current_block(t) and "Sunset Linen" in context.history_block(t)


def test_scripted_claude_talk_path(app_client, monkeypatch):
    fake = FakeClaude([lambda kw: _msg(NS(type="text", text="Tan leather sandals of your own work here."),
                                       stop="end_turn")])
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(loop, "_client", fake)
    sid = new_session(BEACH)
    evs = events(app_client.post("/api/chat", json={"session_id": sid, "message": "what shoes?"}))
    kinds = [e for e, _ in evs]
    assert "looks" not in kinds and "text" in kinds and kinds[-1] == "done"
    msgs = app_client.get(f"/api/session/{sid}/messages").json()["messages"]
    assert msgs[-1]["text"].startswith("Tan leather")


def test_claude_failure_falls_back(app_client, monkeypatch):
    def boom(kw):
        raise RuntimeError("model exploded")
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(loop, "_client", FakeClaude([boom]))
    sid = new_session(BEACH)
    evs = events(app_client.post("/api/chat", json={"session_id": sid, "message": "beach"}))
    kinds = [e for e, _ in evs]
    assert "looks" in kinds and kinds[-1] == "done"
    assert any(e == "status" and d["id"] == "understand" and d["state"] == "done" for e, d in evs)


def test_a_card_carries_one_question(app_client, monkeypatch):
    """At most one question per turn (AGENT_SPEC §3): a second question Claude adds is dropped."""
    def ask(kw):
        assert "request" not in kw["tools"][1]["input_schema"]["properties"]  # the old ask-first gate is gone
        return _msg(_use(1, "ask_clarification", questions=[
            {"field": "gender", "question": "Should I shop women's or men's?", "options": [
                {"label": "Women", "value": "women"}, {"label": "Men", "value": "men"}]},
            {"field": "budget", "question": "Budget per look?", "options": [
                {"label": "Under ₹6,000", "value": "6000"}, {"label": "No limit", "value": "none"}]}]))

    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(loop, "_client", FakeClaude([ask]))
    sid = new_session()
    evs = events(app_client.post("/api/chat", json={"session_id": sid, "message": "something for a wedding"}))
    card = next(d for e, d in evs if e == "clarify")
    assert [q["field"] for q in card["questions"]] == ["gender"]


def test_a_look_can_be_built_around_an_owned_piece(app_client, monkeypatch):
    """QA T1: a wardrobe piece the shopper names goes into the look by ref: ₹0, theirs, not drawn by YouCam."""
    sid = new_session(BEACH, photo=True)
    tok = sessions.get_session(sid)["user_token"]
    db.ex("insert into wardrobe(id, user_token, image_url, name, slot, category, colors, color_family, fabric, vibes, "
          "formality, fit, allow_styling, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,1,?)", "w_palazzo", tok,
          "/media/wardrobe/x.jpg", "Ivory palazzo trousers", "bottom", "palazzo", ["ivory"], "ivory", "linen",
          ["minimal"], 2, "relaxed", db.now())
    top = _pick("women", "top")

    def search(kw):
        block = kw["messages"][0]["content"][-1]["text"]
        state["own"] = next(w.split()[1] for w in block.split("wardrobe")[1].split(": ", 1)[1].split("; "))
        return _msg(_use(1, "search_catalog", **{**_search("top"), "for_whom": "shopper", "query": top["title"]}))

    def present(kw):
        tref = next(x["ref"] for x in _results(kw)["tu_1"]["results"] if x["title"] == top["title"])
        return _msg(_use(2, "present_looks", message="Built around your palazzos.", looks=[
            {"name": "Ivory Brunch", "item_refs": [tref, state["own"]], "why": "Easy linen for the heat", "tip": "", "over_budget": False}],
            modifies_look_id=None, budget_per_look=None, wearer_is_minor=False, try_next=[],
            wearer={"for": "self", "relation": "", "gender": "women", "occasion": "Brunch"}))

    state = {}
    _fake_renders(monkeypatch)
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(loop, "_client", FakeClaude([search, present]))
    evs = events(app_client.post("/api/chat", json={"session_id": sid, "message": "brunch look around my palazzos"}))
    lk = next(d for e, d in evs if e == "looks")["looks"][0]
    own = next(it["product"] for it in lk["items"] if it["slot"] == "bottom")
    assert own["id"] == "w_palazzo" and own["owned"] and own["price"] == 0 and lk["total"] == top["price"]
    assert [st["slot"] for st in renders.plan(lk["items"])] == ["top"]  # the owned piece isn't drawn


def test_a_rejected_request_drops_only_what_the_api_names(monkeypatch):
    from app.agent import loop
    monkeypatch.setattr(loop, "_dropped", set())
    assert loop._drop_for("The compiled grammar is too large; reduce the number of strict tools.") == "strict"
    assert "strict" in loop._params([])["tools"][0]  # nothing dropped yet: caching and strict stay on
    loop._dropped.add("strict")
    assert loop._drop_for("unknown beta") == "betas"
    loop._dropped.add("betas")
    assert loop._drop_for("anything") is None  # nothing left to drop: the turn falls back


def test_remember_preference_checks_its_own_input():
    from app.agent import tools
    assert not tools.remember(None, {"kind": "love", "attribute": "color", "value": "red"})["ok"]
    assert not tools.remember(None, {"kind": "never", "attribute": "color", "value": " "})["ok"]
    assert not next(t for t in tools.TOOLS if t["name"] == "remember_preference").get("strict")


def test_a_turn_finishes_after_the_client_disconnects(app_client):
    """A page reload mid-turn must not lose the reply: the turn runs on and persists it."""
    from app.agent import routes
    sid = new_session(BEACH)

    async def go():
        gen = routes._stream(routes.ChatIn(session_id=sid, message="beach looks"))
        await gen.__anext__()  # first status frame, then the client goes away
        await gen.aclose()
        await asyncio.gather(*routes._turns)

    asyncio.run(go())
    msgs = app_client.get(f"/api/session/{sid}/messages").json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"] and msgs[1]["looks"]
