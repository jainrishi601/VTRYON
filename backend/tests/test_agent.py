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


def new_session(brief=None, photo=False) -> str:
    s, _, _ = sessions.create()
    if brief:
        db.ex("update sessions set brief=? where id=?", brief, s["id"])
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
        inp = {"message": "m", "looks": [{"name": f"N{i}", "why": "w", "item_refs": refs, "over_budget": ob}
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


def test_sse_closes_after_renders_settle(app_client, monkeypatch):  # U-AG-3
    calls = []

    async def fake_run(steps, src, session_id=None, on_step=None):
        for i, _ in enumerate(steps):
            await asyncio.sleep(0.05)
            calls.append(i)
            if on_step:
                on_step(i + 1, None)
        return TryOnResult("/media/stub/x.jpg", "", f"k{len(calls)}", False, 0, 50), False

    monkeypatch.setattr(renders, "run", fake_run)
    sid = new_session(BEACH, photo=True)
    evs = events(app_client.post("/api/chat", json={"session_id": sid, "message": "beach looks please"}))
    kinds = [e for e, _ in evs]
    assert kinds[-1] == "done" and kinds.count("done") == 1
    ids = [lk["id"] for lk in next(d for e, d in evs if e == "looks")["looks"]]
    final = {}
    for e, d in evs:
        if e == "look":
            final[d["look"]["id"]] = d["look"]["render"]["status"]
    assert set(final) == set(ids) and set(final.values()) == {"ready"}
    assert kinds.index("looks") < kinds.index("look")
    assert any(e == "status" and d["id"] == "render" and d["state"] == "done" for e, d in evs)
    assert calls


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
        looks_ = [{"name": "Sunset Linen", "item_refs": [tops[0], bottoms[0]], "why": "w", "over_budget": True},
                  {"name": "Monsoon Ink", "item_refs": [tops[1], bottoms[1]] + ([tops[2]] if bad else []),
                   "why": "w", "over_budget": True}]
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
