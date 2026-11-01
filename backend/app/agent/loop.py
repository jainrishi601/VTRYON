"""One chat turn: Claude tool-use loop (≤4 rounds) → SSE-shaped events. Falls back to the deterministic composer
when there is no key or Claude fails, so a turn never dead-ends (CLAUDE.md rule 4)."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

import anthropic

from app import config, db, looks, scoring, sessions
from app.agent import context, fallback, tools
from app.agent.prompts import ASK_FIRST, FINAL_ROUND_NUDGE, REPAIR_NOTE, SYSTEM_PROMPT

log = logging.getLogger("elara.agent")

EFFORT = "low"
MAX_ROUNDS = 4
CALL_TIMEOUT = 25  # seconds per Claude call
RENDER_WAIT = 75
SYSTEM = [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]
TRACES: dict[str, list[dict]] = {}  # sid -> tool calls of the latest turn (evals + debugging); in-memory only

_client: anthropic.AsyncAnthropic | None = None

Event = tuple[str, dict]


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY, max_retries=2, timeout=CALL_TIMEOUT)
    return _client


def status(sid: str, label: str, state: str = "active") -> Event:
    return "status", {"id": sid, "label": label, "state": state}


class Out:
    """What the turn produced; persisted as the assistant message."""

    def __init__(self):
        self.text = ""
        self.look_ids: list[str] = []
        self.product_ids: list[str] = []
        self.try_next: list[str] = []
        self.clarify: dict | None = None
        self.summary = ""
        self.done = False  # a terminal answer has been delivered

    _gap = False

    def say(self, delta: str) -> Event:
        if self._gap:
            delta, self._gap = "\n\n" + delta.lstrip(), False
        self.text += delta
        return "text", {"delta": delta}

    def new_segment(self):
        """The next text starts a new paragraph (a later round or the present_looks message)."""
        self._gap = bool(self.text.strip())


def persist(t: context.Turn, out: Out) -> int:
    content = {"text": out.text.strip(), "look_ids": out.look_ids, "product_ids": out.product_ids,
               "try_next": out.try_next,
               "clarify": out.clarify, "ref_map": t.refs.by_ref, "summary": out.summary}
    return db.ex("insert into messages(session_id, role, content, created_at) values (?,?,?,?)",
                 t.sid, "assistant", content, db.now())


async def turn(sid: str, message: str, look_id: str | None = None, attachment_url: str | None = None,
               answers: list[dict] | None = None) -> AsyncIterator[Event]:
    """The whole turn as (event, data) pairs. Always ends with `done`.
    `answers` are question-card picks ({field, value}); they go into the brief before Claude sees the turn."""
    yield status("read", "Reading your message")
    if answers and sessions.get_session(sid):
        sessions.apply_answers(sid, answers)
    t = context.load(sid, message, look_id, attachment_url)
    if t is None:
        yield "error", {"message": "This chat has expired. Start a new chat to keep styling."}
        yield "done", {}
        return
    TRACES[sid] = t.trace
    if len(TRACES) > 200:
        TRACES.pop(next(iter(TRACES)))
    db.ex("insert into messages(session_id, role, content, created_at) values (?,?,?,?)", sid, "user",
          {"text": t.message, "look_id": look_id, "attachment_url": attachment_url, "answers": answers or None},
          db.now())
    yield status("read", "Reading your message", "done")
    out = Out()
    if config.ANTHROPIC_API_KEY:
        try:
            async for ev in _claude(t, out):
                yield ev
        except Exception as e:  # timeout, API error, refusal, empty or invalid output twice
            log.warning("agent turn failed, using fallback: %r", e)
            t.trace.append({"error": repr(e)})
            if not out.done:
                yield status("understand", "Understanding what you're looking for", "done")
    if not out.done:
        async for ev in _fallback(t, out):
            yield ev
    yield "done", {}


FALLBACK_QUESTIONS = {
    "gender": {"field": "gender", "question": "Should I shop women's or men's?",
               "options": [{"label": "Women", "value": "women"}, {"label": "Men", "value": "men"}]},
    "occasion": {"field": "occasion", "question": "What's the occasion?",
                 "options": [{"label": o, "value": o} for o in config.STORE["occasions"][:4]]},
}


async def _fallback(t: context.Turn, out: Out) -> AsyncIterator[Event]:
    """No Claude: never guess the wearer's gender or the occasion; ask for them with the card instead."""
    t.trace.append({"fallback": True})
    missing, ok = [], sessions.confirmed(t.session)
    if len(config.STORE["genders"]) > 1 and (t.target_gender not in ("women", "men", "both") or "gender" not in ok):
        missing.append("gender")
    if not (t.brief or {}).get("occasion"):
        missing.append("occasion")
    if missing:
        out.clarify = {"questions": [FALLBACK_QUESTIONS[k] for k in missing]}
        yield "clarify", out.clarify
        out.done = True
        persist(t, out)
        return
    yield status("style", "Styling your looks")
    msg, specs = fallback.compose(t)
    out.new_segment()
    yield out.say(msg)
    async for ev in _deliver(t, out, specs, parent=None, budget=t.budget):
        yield ev


async def _deliver(t, out: Out, specs: list[dict], parent: str | None, budget: int | None,
                   minor: bool = False) -> AsyncIterator[Event]:
    """Persist looks, emit `looks`, start renders, stream `look` updates until settled."""
    if minor and not t.minor:  # Claude spotted a minor wearer the brief didn't flag: switch try-on off
        b = dict(t.brief or {})
        if b.get("for") == "other":
            b["recipient"] = {**(b.get("recipient") or {}), "age_range": "13-17"}
        else:
            b["age_range"] = "13-17"
        db.ex("update sessions set brief=? where id=?", b, t.sid)
    made = [looks.create_look(t.sid, s["name"], s["why"], s["items"], parent_look_id=parent, budget_max=budget,
                              tip=s.get("tip")) for s in specs]
    made = [m for m in made if m and m["items"]]
    out.look_ids = [m["id"] for m in made]
    out.summary = "; ".join(
        f"“{m['name']}” ({m['id']}): " + " + ".join(
            f"{it['product']['title']} ({t.refs.ref(it['product']['id'])})" for it in m["items"]) for m in made)
    out.done = True
    t.trace.append({"presented": [{"id": m["id"], "name": m["name"], "parent": m["parent_look_id"],
                                   "total": m["total"], "pids": [it["product"]["id"] for it in m["items"]]}
                                  for m in made]})
    mid = persist(t, out)
    yield status("style", "Styling your looks", "done")
    # Looks arrive flat; one renders only when the shopper taps Try on (saves units on looks nobody opens).
    # An edit of a look already on the shopper keeps it on: the child re-renders just the changed piece.
    for m in made:
        par = looks.look_json(m["parent_look_id"]) if m["parent_look_id"] else None
        if par and par["render"]["status"] == "ready":
            looks.start_render(m["id"], model_id=par.get("model_id"))
    yield "looks", {"looks": [looks.look_json(m["id"]) for m in made], "message_id": mid}
    if out.try_next:
        yield "suggest", {"items": out.try_next}
    rendering = [m["id"] for m in made if looks.look_json(m["id"])["render"]["status"] not in looks.TERMINAL]
    if rendering:
        yield status("render", "Updating it on you")
        async for lk in looks.wait_settled(rendering, timeout=RENDER_WAIT):
            yield "look", {"look": lk}
        yield status("render", "Updated on you", "done")


def apply_wearer(t: context.Turn, w: dict | None) -> None:
    """Save who Claude is dressing into the brief and this turn, so validation and renders use that gender."""
    w = w or {}
    for_ = w.get("for") if w.get("for") in ("self", "other") else None
    gender = w.get("gender") if w.get("gender") in ("women", "men") else None
    relation = (w.get("relation") or "").strip() or None
    occasion = (w.get("occasion") or "").strip() or None
    if for_ == "self":
        relation = None
    if not (for_ or gender or relation or occasion):
        return
    t.brief = sessions.update_brief(t.sid, for_=for_, relation=relation, gender_=gender, occasion=occasion)
    sessions.confirm(t.sid, [f for f, v in (("wearer", for_ or relation), ("gender", gender), ("occasion", occasion)) if v])
    t.session["brief"] = t.brief
    t.target_gender = sessions.gender(t.session)
    if t.brief.get("for") == "other" or t.brief.get("recipient"):  # (re)load: the recipient may be someone new
        t.profiles["recipient"] = context._profile(t.user_token, sessions.scope({"brief": {**t.brief, "for": "other"}}))
    context.use(t, "recipient" if t.brief.get("for") == "other" else "shopper")
    t.trace.append({"wearer": w, "brief": t.brief})


async def _products(t: context.Turn, out: Out, ps: list[dict], inp: dict) -> AsyncIterator[Event]:
    msg = (inp.get("message") or "").strip()
    if msg:
        out.new_segment()
        yield out.say(msg)
    out.product_ids = [p["id"] for p in ps]
    out.try_next = tools.clean_try_next(inp.get("try_next"))
    out.summary = "products: " + ", ".join(f"{p['title']} ({t.refs.ref(p['id'])})" for p in ps)
    out.done = True
    t.trace.append({"products": out.product_ids})
    mid = persist(t, out)
    yield status("style", "Picking pieces for you", "done")
    yield "products", {"products": product_cards(ps, t.taste), "message_id": mid}
    if out.try_next:
        yield "suggest", {"items": out.try_next}


def product_cards(ps: list[dict], taste: dict | None) -> list[dict]:
    """Grid cards: the product plus a Style DNA match (only when there is a DNA to match against)."""
    has = bool(taste and any(taste.values()))
    return [{"product": p, "match": round(scoring.dna_score([p], taste)) if has else None} for p in ps]


_dropped: set[str] = set()  # request features the API rejected this process: "strict" (tool grammar), "betas"


def _params(messages: list[dict]) -> dict:
    ts = tools.TOOLS if "strict" not in _dropped else [{k: v for k, v in x.items() if k != "strict"} for x in tools.TOOLS]
    p = dict(model=config.AGENT_MODEL, max_tokens=16000, system=SYSTEM, messages=messages, tools=ts,
             thinking={"type": "adaptive"}, output_config={"effort": EFFORT})
    if "betas" not in _dropped:
        p.update(cache_control={"type": "ephemeral"}, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    return p


def _drop_for(message: str) -> str | None:
    """Which feature to drop after a 400: the strict-tool grammar if that's what the API names, else the betas."""
    m = message.lower()
    first = "strict" if ("grammar" in m or "strict" in m) else "betas"
    return next((f for f in (first, "betas", "strict") if f not in _dropped), None)


async def _call(messages: list[dict], out: Out, first: list[bool]) -> AsyncIterator[Event | tuple[str, object]]:
    """One streamed Claude call. Yields text events live, then ("final", message). If the API rejects the request
    shape (400) before anything streamed, degrade once per level and retry: a demo must not die on a beta flag."""
    while True:
        streamed = False
        try:
            async with asyncio.timeout(CALL_TIMEOUT):
                async with client().beta.messages.stream(**_params(messages)) as stream:
                    out.new_segment()
                    async for ev in stream:
                        if first[0] and ev.type in ("text", "content_block_start"):
                            first[0] = False
                            yield status("understand", "Understanding what you're looking for", "done")
                        if ev.type == "text" and ev.text:
                            streamed = True
                            yield out.say(ev.text)
                    yield "final", await stream.get_final_message()
                    return
        except anthropic.BadRequestError as e:
            drop = None if streamed else _drop_for(e.message)
            if not drop:
                raise
            _dropped.add(drop)
            log.warning("Claude rejected the request (%s); retrying without %s", e.message, drop)


async def _claude(t: context.Turn, out: Out) -> AsyncIterator[Event]:
    messages = [{"role": "user", "content": context.user_content(t)}]
    yield status("understand", "Understanding what you're looking for")
    first, failures, repairs, n_search, gated = [True], 0, 0, 0, False
    best: tuple[list[dict], dict] | None = None  # valid looks from a failed present_looks, used if repair fails
    rnd = 0
    while rnd < MAX_ROUNDS:
        rnd += 1
        final = None
        text_before = len(out.text)
        try:
            async for ev in _call(messages, out, first):
                if ev[0] == "final":
                    final = ev[1]
                else:
                    yield ev
        except (anthropic.APIError, TimeoutError) as e:
            failures += 1
            t.trace.append({"call_error": repr(e)})
            if failures >= 2 or len(out.text) > text_before:
                raise
            rnd -= 1
            continue
        t.trace.append({"round": rnd, "stop": final.stop_reason, "usage": {
            "in": final.usage.input_tokens, "out": final.usage.output_tokens,
            "cache_read": getattr(final.usage, "cache_read_input_tokens", 0)}})
        if final.stop_reason == "refusal":
            raise RuntimeError("refusal")
        uses = [b for b in final.content if b.type == "tool_use"]
        if not uses:
            if not out.text.strip():
                raise RuntimeError("empty reply")
            out.done = True
            persist(t, out)  # TALK path
            return
        if final.stop_reason == "max_tokens":
            raise RuntimeError("truncated tool call")

        results: dict[str, dict] = {}
        searches = [u for u in uses if u.name == "search_catalog"]
        sids = {}
        for u in searches:
            n_search += 1
            sids[u.id] = f"search{n_search}"
            yield status(sids[u.id], f"Searching the catalogue for {u.input.get('query') or u.input.get('slot')}…")
        found = await asyncio.gather(*(asyncio.to_thread(tools.search, t, u.input) for u in searches),
                                     return_exceptions=True)
        for u, r in zip(searches, found, strict=True):
            if isinstance(r, Exception):
                results[u.id] = {"content": f"search failed: {r}", "is_error": True}
                yield status(sids[u.id], "Search hit a snag", "done")
            else:
                results[u.id] = {"content": _json(r[0])}
                yield status(sids[u.id], r[1], "done")
        for u in uses:
            if u.name == "remember_preference":
                try:
                    results[u.id] = {"content": _json(tools.remember(t, u.input))}
                except Exception as e:
                    results[u.id] = {"content": f"could not save: {e}", "is_error": True}

        present = next((u for u in uses if u.name == "present_looks"), None)
        grid = next((u for u in uses if u.name == "present_products"), None)
        clarify = next((u for u in uses if u.name == "ask_clarification"), None)
        # A new request is answered with a question card first (CLAUDE.md rule 5). Enforced here, not just asked.
        shown = present or grid
        if shown and not clarify and shown.input.get("request") == "new" and not t.after_card and not gated \
                and rnd < MAX_ROUNDS - 1:
            gated = True
            results[shown.id] = {"content": _json({"ok": False, "errors": [ASK_FIRST]}), "is_error": True}
            t.trace.append({"gate": "ask_first"})
            present = grid = None
        if grid and not present:
            inp = grid.input
            t.trace.append({"tool": "present_products", "input": inp})
            apply_wearer(t, inp.get("wearer"))
            if not repairs:
                yield status("style", "Picking pieces for you")
            ps, errs = tools.validate_products(t, inp)
            if len(ps) < 2 and errs and repairs < 2 and rnd < MAX_ROUNDS - 1:
                repairs += 1
                results[grid.id] = {"content": _json({"ok": False, "errors": errs, "note": REPAIR_NOTE}),
                                    "is_error": True}
                t.trace.append({"repair": errs})
            elif ps:
                async for ev in _products(t, out, ps, inp):
                    yield ev
                return
            else:
                raise RuntimeError(f"no valid products: {errs}")
        elif present:
            inp = present.input
            t.trace.append({"tool": "present_looks", "input": inp})
            apply_wearer(t, inp.get("wearer"))
            if not repairs:
                yield status("style", "Styling your looks")
            checked, errs = tools.validate(t, inp)
            look_errs = [e for c in checked for e in c["errors"]]
            valid = [c for c in checked if not c["errors"]]
            # ponytail: 2 repair rounds max — one wasn't always enough (E3 dropped 2 of 3 looks once).
            if (errs or look_errs) and repairs < 2 and rnd < MAX_ROUNDS - 1:
                repairs += 1
                best = (valid, inp) if valid else best
                results[present.id] = {"content": _json({"ok": False, "errors": errs + look_errs,
                                                         "note": REPAIR_NOTE}), "is_error": True}
                t.trace.append({"repair": errs + look_errs})
                log.info("present_looks repair: %s", errs + look_errs)
            else:
                if errs or look_errs:
                    log.info("present_looks dropping invalid looks after repair: %s", errs + look_errs)
                if not valid and best:
                    valid, inp = best
                if not valid:
                    raise RuntimeError(f"no valid looks: {errs + look_errs}")
                async for ev in _present(t, out, valid, inp):
                    yield ev
                return
        elif clarify:
            q = clarify.input
            t.trace.append({"tool": "ask_clarification", "input": q})
            out.clarify = tools.clean_clarify(q)
            if not out.clarify:
                raise RuntimeError("empty clarification")
            yield "clarify", out.clarify
            out.done = True
            persist(t, out)
            return

        for u in uses:  # every tool_use needs a result, even ones we ignored
            results.setdefault(u.id, {"content": "ignored: end the turn with present_looks or a reply",
                                      "is_error": True})
        blocks = [{"type": "tool_result", "tool_use_id": u.id, **results[u.id]} for u in uses]
        if rnd == MAX_ROUNDS - 1:
            blocks.append({"type": "text", "text": FINAL_ROUND_NUDGE})
        messages += [{"role": "assistant", "content": final.content}, {"role": "user", "content": blocks}]
    if best:
        async for ev in _present(t, out, *best):
            yield ev
        return
    raise RuntimeError("no terminal tool after max rounds")


async def _present(t, out: Out, valid: list[dict], inp: dict) -> AsyncIterator[Event]:
    msg = (inp.get("message") or "").strip()
    if msg:
        out.new_segment()
        yield out.say(msg)
    parent = inp.get("modifies_look_id")
    if parent not in {lk["id"] for lk in t.current}:
        parent = None
    budget = inp.get("budget_per_look") or t.budget
    specs = [{"name": c["spec"]["name"].strip(), "why": c["spec"]["why"].strip(), "tip": c["spec"].get("tip") or "",
              "items": [(slot, p["id"]) for slot, p in c["items"]]} for c in valid]
    out.try_next = tools.clean_try_next(inp.get("try_next"))
    async for ev in _deliver(t, out, specs, parent, budget, minor=bool(inp.get("wearer_is_minor"))):
        yield ev


def _json(x) -> str:
    return json.dumps(x, ensure_ascii=False, separators=(",", ":"))
