"""Deterministic composer: used when there is no ANTHROPIC_API_KEY or Claude fails. Brief + DNA → retrieval →
best-scoring distinct combos within budget. The ONE place backend-authored chat copy is allowed."""

from __future__ import annotations

from itertools import product as cartesian

from app import catalog, scoring

MESSAGE = "Here are a few looks to start with, picked for your occasion and budget. Tell me what to change."
MESSAGE_NONE = "I couldn't find pieces that fit this brief in the catalogue. Try a different occasion or budget."

NAMES = {
    "white": ["Coastal Ivory", "Clean Slate"], "beige": ["Sandstone Ease", "Desert Calm"],
    "black": ["Midnight Edit", "Ink Hour"], "grey": ["Slate Quiet", "Stone Hour"],
    "blue": ["Monsoon Blue", "Harbour Ink"], "green": ["Garden Hour", "Sage Story"],
    "red": ["Ember Night", "Rust Bloom"], "pink": ["Rose Hour", "Petal Ease"],
    "purple": ["Twilight Plum", "Dusk Bloom"], "yellow": ["Sunlit Day", "Marigold Ease"],
    "brown": ["Earth Tone", "Cocoa Calm"], "orange": ["Sunset Linen", "Saffron Day"],
}
SPARE = ["Easy Edit", "Weekend Story", "Quiet Hour", "Open Road"]


def _name(p: dict, used: set[str]) -> str:
    for n in NAMES.get(p.get("color_family") or "", []) + SPARE:
        if n not in used:
            used.add(n)
            return n
    return f"Look {len(used) + 1}"


def compose(t) -> tuple[str, list[dict]]:
    """Returns (message, [{name, why, items:[(slot, product_id)]}]) — up to 3 looks."""
    b = t.brief or {}
    gender = t.target_gender if t.target_gender in ("women", "men") else "women"
    occasion = b.get("occasion") or "everyday"
    target = scoring.occasion_target(occasion)
    fmin, fmax = max(1, round(target - 1)), min(5, round(target + 1))
    budget = t.budget
    excl = tuple(t.rejected)

    def find(slot, limit=8):
        return catalog.search(slot, gender, query=occasion, max_price=budget, formality_min=fmin, formality_max=fmax,
                              exclude_ids=excl, never=tuple(t.never), taste=t.taste, limit=limit)[0]

    def fits(ps):
        return not budget or sum(p["price"] for p in ps) <= budget

    def rank(ps):
        return (fits(ps), scoring.score_look(ps, occasion, t.taste)["score"], -sum(p["price"] for p in ps))

    combos = sorted(([a, c] for a, c in cartesian(find("top"), find("bottom"))), key=rank, reverse=True)
    singles = sorted(([p] for p in find("one_piece", 4)), key=rank, reverse=True) if gender == "women" else []
    picked = []
    if singles:
        picked.append(singles[0])
    for c in combos:
        if len(picked) >= 3:
            break
        if not {p["id"] for p in c} & {p["id"] for ps in picked for p in ps}:
            picked.append(c)
    names: set[str] = set()
    looks = []
    for ps in picked:
        s = scoring.score_look(ps, occasion, t.taste)
        looks.append({"name": _name(ps[0], names), "why": s["reason"] + ".",
                      "items": [(p["slot"], p["id"]) for p in ps]})
    return (MESSAGE if looks else MESSAGE_NONE), looks
