"""One chat turn: Claude tool-use loop (≤4 rounds) → SSE-shaped events. Falls back to the deterministic composer
when there is no key or Claude fails, so a turn never dead-ends (CLAUDE.md rule 4)."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator

import anthropic

from app import config, db, looks
from app.agent import context, fallback, tools
from app.agent.prompts import FINAL_ROUND_NUDGE, REPAIR_NOTE, SYSTEM_PROMPT

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
    content = {"text": out.text.strip(), "look_ids": out.look_ids, "clarify": out.clarify,
               "ref_map": t.refs.by_ref, "summary": out.summary}
    return db.ex("insert into messages(session_id, role, content, created_at) values (?,?,?,?)",
                 t.sid, "assistant", content, db.now())


async def turn(sid: str, message: str, look_id: str | None = None, attachment_url: str | None = None
               ) -> AsyncIterator[Event]:
    """The whole turn as (event, data) pairs. Always ends with `done`."""
    yield status("read", "Reading your message")
    t = context.load(sid, message, look_id, attachment_url)
    if t is None:
        yield "error", {"message": "This chat has expired. Start a new chat to keep styling."}
        yield "done", {}
        return
    TRACES[sid] = t.trace
    if len(TRACES) > 200:
        TRACES.pop(next(iter(TRACES)))
    db.ex("insert into messages(session_id, role, content, created_at) values (?,?,?,?)", sid, "user",
          {"text": t.message, "look_id": look_id, "attachment_url": attachment_url}, db.now())
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


async def _fallback(t: context.Turn, out: Out) -> AsyncIterator[Event]:
    t.trace.append({"fallback": True})
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
    made = [looks.create_look(t.sid, s["name"], s["why"], s["items"], parent_look_id=parent, budget_max=budget)
            for s in specs]
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
    for m in made:
        looks.start_render(m["id"])
    fresh = [looks.look_json(m["id"]) for m in made]
    yield "looks", {"looks": fresh, "message_id": mid}
    if not made:
        return
    yield status("render", "Rendering on you")
    t0 = time.monotonic()
    async for lk in looks.wait_settled(out.look_ids, timeout=RENDER_WAIT):
        yield "look", {"look": lk}
    done = [looks.look_json(i) for i in out.look_ids]
    ok = sum(1 for d in done if d and d["render"]["status"] == "ready")
    label = f"Rendered {ok} of {len(done)} on you in {time.monotonic() - t0:.1f}s" if ok else "Rendering on you"
    yield status("render", label, "done")


_degrade = 0  # 0: full request · 1: without beta extras (fallbacks, auto-cache) · 2: also without strict tools


def _params(messages: list[dict]) -> dict:
    p = dict(model=config.AGENT_MODEL, max_tokens=16000, system=SYSTEM, messages=messages,
             tools=tools.TOOLS if _degrade < 2 else [{k: v for k, v in x.items() if k != "strict"} for x in tools.TOOLS],
             thinking={"type": "adaptive"}, output_config={"effort": EFFORT})
    if _degrade < 1:
        p.update(cache_control={"type": "ephemeral"}, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    return p


async def _call(messages: list[dict], out: Out, first: list[bool]) -> AsyncIterator[Event | tuple[str, object]]:
    """One streamed Claude call. Yields text events live, then ("final", message). If the API rejects the request
    shape (400) before anything streamed, degrade once per level and retry: a demo must not die on a beta flag."""
    global _degrade
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
            if streamed or _degrade >= 2:
                raise
            _degrade += 1
            log.warning("Claude rejected the request (%s); retrying at degrade level %d", e.message, _degrade)


async def _claude(t: context.Turn, out: Out) -> AsyncIterator[Event]:
    messages = [{"role": "user", "content": context.user_content(t)}]
    yield status("understand", "Understanding what you're looking for")
    first, failures, repairs, n_search = [True], 0, 0, 0
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
        clarify = next((u for u in uses if u.name == "ask_clarification"), None)
        if present:
            inp = present.input
            t.trace.append({"tool": "present_looks", "input": inp})
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
            chips = [c.strip() for c in q.get("chips") or [] if c and c.strip()][:4]
            out.clarify = {"question": q["question"].strip(), "chips": chips}
            t.trace.append({"tool": "ask_clarification", "input": q})
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
    specs = [{"name": c["spec"]["name"].strip(), "why": c["spec"]["why"].strip(),
              "items": [(slot, p["id"]) for slot, p in c["items"]]} for c in valid]
    async for ev in _deliver(t, out, specs, parent, budget, minor=bool(inp.get("wearer_is_minor"))):
        yield ev


def _json(x) -> str:
    return json.dumps(x, ensure_ascii=False, separators=(",", ":"))
