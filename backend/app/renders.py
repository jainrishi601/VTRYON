"""Look -> YouCam render plan (ARCHITECTURE §4): one-piece or bottom->top, then layer; swap = one call."""

from app import config, youcam
from app.youcam import Src, TryOnResult

SLOT_CATEGORY = {"top": "upper_body", "bottom": "lower_body", "one_piece": "full_body", "layer": "outer"}


def plan(items: list[dict]) -> list[dict]:
    """items: [{slot, product}]. Bags/accessories are not rendered; pieces without a usable VTO ref are skipped."""
    by = {it["slot"]: it["product"] for it in items}
    order = ["one_piece", "layer"] if "one_piece" in by else ["bottom", "top", "layer"]
    return [{"slot": s, "product": by[s], "category": SLOT_CATEGORY[s]}
            for s in order if s in by and by[s].get("vto_ready", True) and by[s].get("vto_ref_url")]


def swap_plan(parent_items: list[dict], items: list[dict]) -> list[dict] | None:
    """One step when exactly one top/bottom/layer changed; None means re-plan the whole look."""
    a = {it["slot"]: it["product"]["id"] for it in parent_items}
    b = {it["slot"]: it["product"]["id"] for it in items}
    changed = {s for s in a.keys() | b.keys() if a.get(s) != b.get(s)} - {"bag", "accessory"}
    if len(changed) != 1 or (s := changed.pop()) not in ("top", "bottom", "layer") or s not in b:
        return None
    return [st for st in plan(items) if st["slot"] == s] or None


def chain_src(res: TryOnResult) -> Src:
    return Src(key=res.cache_key, url=res.remote_url or None, path=config.media_path(res.url_local))


async def run(steps: list[dict], src: Src, session_id=None, on_step=None) -> tuple[TryOnResult, bool]:
    """Each step renders onto the previous result. Returns (final result, every step was cached)."""
    cur, res, cached = src, None, True
    for i, st in enumerate(steps):
        res = await youcam.try_on(cur, st["product"]["vto_ref_url"], st["category"], False, session_id)
        cached = cached and res.cached
        if on_step:
            on_step(i + 1, res)
        cur = chain_src(res)
    return res, cached


def planned_keys(steps: list[dict], src_key: str) -> list[str]:
    """Cache keys a plan will hit, computed without running it (for prerender/seed cost estimates)."""
    keys, cur = [], src_key
    for st in steps:
        cur = youcam.cache_key(cur, st["product"]["vto_ref_url"], st["category"], False)
        keys.append(cur)
    return keys
