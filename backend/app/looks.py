"""Looks: persist, score, render in the background, swap, video. Render state lives in the `looks` row."""

import asyncio
import time
from collections.abc import AsyncIterator

from app import catalog, dna, renders, scoring, sessions, youcam
from app.db import ex, new_id, now, q, q1

NO_PHOTO = "Add a photo to see it on you"
MINOR = "Try-on is off for under-18s. You can still shop the look."
NOTHING = "None of these pieces can be tried on yet. Here they are flat."
TERMINAL = ("ready", "failed")
_tasks: set[asyncio.Task] = set()  # strong refs so background renders aren't garbage-collected
_running: set[str] = set()


def hydrate(items: list[dict]) -> list[dict]:
    """[{slot, product_id}] -> [{slot, product}], dropping anything no longer in the catalogue."""
    return [{"slot": it["slot"], "product": p} for it in items if (p := catalog.get(it["product_id"]))]


def _spawn(coro) -> None:
    t = asyncio.get_running_loop().create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


def create_look(session_id, name, why, items, parent_look_id=None, budget_max=None) -> dict:
    """items: [(slot, product_id)] or [{slot, product_id}]. Unknown ids are dropped (grounding is drop-only)."""
    sess = sessions.get_session(session_id) or {}
    brief = sess.get("brief") or {}
    pairs = [(it["slot"], it["product_id"]) if isinstance(it, dict) else tuple(it) for it in items]
    stored = [{"slot": s, "product_id": pid} for s, pid in pairs if catalog.get(pid)]
    hyd = hydrate(stored)
    budget = budget_max if budget_max is not None else brief.get("budget_max")
    sc = scoring.score_look(hyd, brief.get("occasion"),
                            dna.taste_vector(sess.get("user_token"), sessions.scope(sess)) if sess else None)
    lid = new_id("lk_")
    ex("insert into looks(id, session_id, name, why, items, total, score, score_reason, parent_look_id, budget_max, "
       "render_steps_total, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)", lid, session_id, name, why, stored,
       sum(it["product"]["price"] for it in hyd), sc["score"], sc["reason"], parent_look_id, budget,
       len(renders.plan(hyd)), now())
    return look_json(lid)


def look_json(look_id: str) -> dict | None:
    lk = q1("select * from looks where id=?", look_id)
    if not lk:
        return None
    sess = sessions.get_session(lk["session_id"]) or {}
    ready = lk["render_status"] == "ready"
    budget = lk["budget_max"]
    return {
        "id": lk["id"], "name": lk["name"], "why": lk["why"], "items": hydrate(lk["items"]), "total": lk["total"],
        "currency": "INR", "score": lk["score"], "score_band": scoring.band(lk["score"] or 0),
        "score_reason": lk["score_reason"], "budget_max": budget,
        "over_budget_by": lk["total"] - budget if budget and lk["total"] > budget else None,
        "parent_look_id": lk["parent_look_id"],
        "render": {"status": lk["render_status"], "image_url": lk["render_url"] if ready else None,
                   "steps_done": lk["render_steps_done"], "steps_total": lk["render_steps_total"],
                   "cached": bool(lk["render_cached"]), "error": lk["render_error"]},
        "video": {"status": lk["video_status"], "url": lk["video_url"] if lk["video_status"] == "ready" else None},
        "before_url": sess.get("photo_url"),
    }


def _is_minor(brief: dict) -> bool:
    for ar in ((brief.get("recipient") or {}).get("age_range") if brief.get("for") == "other" else None,
               brief.get("age_range")):
        digits = "".join(ch if ch.isdigit() else " " for ch in str(ar or "")).split()
        if digits and int(digits[0]) < 18:
            return True
    return False


def _fail(look_id: str, copy: str) -> None:
    ex("update looks set render_status='failed', render_error=? where id=?", copy, look_id)


def start_render(look_id: str, memory: bool = True) -> None:
    """Start (or retry) the look's render as a background task. No-op when ready or already running."""
    lk = q1("select * from looks where id=?", look_id)
    if not lk or lk["render_status"] == "ready" or look_id in _running:
        return
    sess = sessions.get_session(lk["session_id"]) or {}
    if _is_minor(sess.get("brief") or {}):
        return _fail(look_id, MINOR)
    if not sess.get("photo_url"):
        return _fail(look_id, NO_PHOTO)
    ex("update looks set render_status='pending', render_error=null, render_steps_done=0 where id=?", look_id)
    _running.add(look_id)
    _spawn(_render(look_id, memory))


async def _render(look_id: str, memory: bool) -> None:
    try:
        lk = q1("select * from looks where id=?", look_id)
        sess = sessions.get_session(lk["session_id"])
        src = sessions.src_for(sess["photo_url"], sess["src_url"])
        items = hydrate(lk["items"])
        steps = renders.plan(items)
        parent = q1("select * from looks where id=?", lk["parent_look_id"]) if lk["parent_look_id"] else None
        if parent and parent["render_status"] == "ready" and parent["render_key"] \
                and parent["session_id"] == lk["session_id"] \
                and (sp := renders.swap_plan(hydrate(parent["items"]), items)):
            steps, src = sp, youcam.result_src(parent["render_key"], parent["render_url"])
        if not steps:
            return _fail(look_id, NOTHING)
        ex("update looks set render_status='rendering', render_steps_total=?, render_steps_done=0 where id=?",
           len(steps), look_id)

        def on_step(n, _res):
            ex("update looks set render_steps_done=? where id=?", n, look_id)

        res, cached = await renders.run(steps, src, lk["session_id"], on_step)
        ex("update looks set render_status='ready', render_url=?, render_key=?, render_cached=?, render_error=null "
           "where id=?", res.url_local, res.cache_key, int(cached), look_id)
        if memory:
            dna.record_look_event(sess["user_token"], items, "tried_on", sessions.scope(sess))
    except youcam.RenderError as e:
        _fail(look_id, e.user_message)
    except Exception:
        _fail(look_id, youcam.GENERIC)
    finally:
        _running.discard(look_id)


async def wait_settled(look_ids: list[str], timeout: float = 75) -> AsyncIterator[dict]:
    """Yield Look JSON whenever a look's render status/steps change; stop when all are terminal or on timeout."""
    last = {lid: ("pending", 0) for lid in look_ids}
    end = time.monotonic() + timeout
    while True:
        pending = False
        for lid in look_ids:
            lj = look_json(lid)
            if not lj:
                continue
            sig = (lj["render"]["status"], lj["render"]["steps_done"])
            if sig != last[lid]:
                last[lid] = sig
                yield lj
            pending = pending or sig[0] not in TERMINAL
        if not pending or time.monotonic() > end:
            return
        await asyncio.sleep(0.4)


def swap(look_id: str, slot: str, product_id: str) -> dict:
    """A new look with one piece replaced (parent_look_id set) and a swap-mode render started."""
    lk = q1("select * from looks where id=?", look_id)
    new = catalog.get(product_id)
    if not lk or not new:
        raise KeyError("look or product not found")
    drop = {slot} | ({"top", "bottom"} if slot == "one_piece" else {"one_piece"} if slot in ("top", "bottom") else set())
    old = next((it for it in hydrate(lk["items"]) if it["slot"] == slot), None)
    items = [(it["slot"], it["product_id"]) for it in lk["items"] if it["slot"] not in drop] + [(slot, product_id)]
    child = create_look(lk["session_id"], lk["name"], lk["why"], items, parent_look_id=look_id,
                        budget_max=lk["budget_max"])
    sess = sessions.get_session(lk["session_id"]) or {}
    if old:
        dna.record_swap(sess.get("user_token"), old["product"], new, sessions.scope(sess))
    start_render(child["id"])
    return look_json(child["id"])


# Static framing: the first live clip (walk toward camera) cropped to the legs mid-clip.
VIDEO_PROMPT = ("Static camera, the whole body stays in frame from head to feet the entire time. "
                "The person does a slow, relaxed quarter turn and back, like checking an outfit in a fitting-room mirror. "
                "Keep the outfit, face and background exactly the same.")


def start_video(look_id: str) -> None:
    lk = q1("select * from looks where id=?", look_id)
    if not lk or lk["render_status"] != "ready" or lk["video_status"] in ("pending", "ready"):
        return
    ex("update looks set video_status='pending' where id=?", look_id)
    _spawn(_video(lk))


async def _video(lk: dict) -> None:
    try:
        url = await youcam.image_to_video(youcam.result_src(lk["render_key"], lk["render_url"]), VIDEO_PROMPT)
        ex("update looks set video_status='ready', video_url=? where id=?", url, lk["id"])
    except Exception:
        ex("update looks set video_status='failed' where id=?", lk["id"])


def feedback(look_id: str, kind: str) -> None:
    lk = q1("select * from looks where id=?", look_id)
    sess = sessions.get_session(lk["session_id"]) or {}
    ev = {"like": "liked_outfit", "dislike": "disliked_outfit", "cart": "added_to_cart"}[kind]
    dna.record_look_event(sess.get("user_token"), hydrate(lk["items"]), ev, sessions.scope(sess))


# Style DNA tiles: one single-piece look per vibe, rendered on the session photo.

def start_tiles(session_id: str) -> None:
    if q1("select 1 from tiles where session_id=?", session_id):
        return
    sess = sessions.get_session(session_id) or {}
    brief = sess.get("brief") or {}
    for vibe, p in dna.pick_tiles(brief.get("occasion"), sessions.gender(sess)):
        lk = create_look(session_id, vibe.title(), "", [(p["slot"], p["id"])])
        ex("insert into tiles(id, session_id, vibe, product_id, look_id, created_at) values (?,?,?,?,?,?)",
           new_id("t_", 8), session_id, vibe, p["id"], lk["id"], now())
        start_render(lk["id"], memory=False)


def tiles_json(session_id: str) -> list[dict]:
    out = []
    for t in q("select * from tiles where session_id=? order by rowid", session_id):
        p = catalog.get(t["product_id"])
        lk = q1("select render_status, render_url from looks where id=?", t["look_id"]) or {}
        st = {"ready": "ready", "failed": "failed"}.get(lk.get("render_status"), "pending")
        out.append({"id": t["id"], "vibe": t["vibe"], "product": p, "status": st,
                    "image_url": lk["render_url"] if st == "ready" else (p or {}).get("image_url") if st == "failed"
                    else None})
    return out
