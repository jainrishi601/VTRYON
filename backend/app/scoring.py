"""Deterministic compatibility score (AGENT_SPEC §5). Pure functions over catalogue rows."""

import math
from itertools import combinations

from app import catalog

NEUTRALS = {"white", "ivory", "cream", "off-white", "beige", "sand", "khaki", "tan", "camel", "taupe", "nude", "black",
            "grey", "gray", "charcoal", "navy", "brown", "denim", "neutral", "silver", "gold", "metallic"}
HUES = {"red": 0, "maroon": 350, "burgundy": 345, "wine": 345, "coral": 15, "rust": 20, "terracotta": 20,
        "orange": 30, "mustard": 50, "yellow": 60, "olive": 85, "sage": 110, "green": 120, "mint": 150, "teal": 180,
        "turquoise": 175, "aqua": 185, "blue": 220, "indigo": 245, "lavender": 270, "lilac": 275, "purple": 285,
        "magenta": 310, "pink": 330, "rose": 340, "peach": 25, "fuchsia": 320}
WARM = {h for c, h in HUES.items() if h < 75 or h > 300}
OCCASION_TARGETS = [("beach", 1.5), ("resort", 1.5), ("pool", 1.5), ("vacation", 1.5), ("holiday", 1.5),
                    ("lounge", 1.5), ("everyday", 2), ("casual", 2), ("brunch", 2), ("travel", 2), ("date", 3),
                    ("dinner", 3), ("evening", 3), ("office", 3.5), ("work", 3.5), ("festival", 3.5),
                    ("festive", 3.5), ("party", 3.5), ("wedding", 4), ("formal", 4)]  # catalogue tops out at formality 4
WEIGHTS = {"color": 0.35, "formality": 0.25, "silhouette": 0.20, "dna": 0.20}


def occasion_target(occasion: str | None) -> float:
    o = (occasion or "").lower()  # lookup over the brief's occasion chips, not intent parsing
    return next((t for k, t in OCCASION_TARGETS if k in o), 2.5)


def band(score: int) -> str:
    return "great" if score >= 85 else "works" if score >= 70 else "bold"


def _products(items) -> list[dict]:
    return [it.get("product", it) for it in items]


def _pair(a: str, b: str) -> float:
    a, b = (a or "").lower(), (b or "").lower()
    if a in NEUTRALS or b in NEUTRALS:
        return 100
    if a not in HUES or b not in HUES:  # multi / print / unknown
        return 75
    d = abs(HUES[a] - HUES[b])
    d = min(d, 360 - d)
    if d <= 60:
        return 90
    if d >= 150:
        return 80
    return 45 if (HUES[a] in WARM) != (HUES[b] in WARM) else 60


def color_score(ps) -> float:
    pairs = list(combinations([p.get("color_family") for p in ps], 2))
    return sum(_pair(a, b) for a, b in pairs) / len(pairs) if pairs else 100


def formality_score(ps, occasion) -> float:
    f = [p.get("formality", 2) for p in ps]
    return max(0.0, min(100.0, 100 - 20 * (max(f) - min(f)) - 10 * abs(sum(f) / len(f) - occasion_target(occasion))))


def silhouette_score(ps) -> float:
    by = {p["slot"]: p for p in ps}
    if "one_piece" in by:
        return 90
    if "top" not in by or "bottom" not in by:
        return 85
    a, b = by["top"].get("fit"), by["bottom"].get("fit")
    if not a or not b:
        return 85
    if a == b:
        return 65
    return 100 if {a, b} == {"relaxed", "fitted"} else 85


def look_vector(ps) -> dict[str, float]:
    v: dict[str, float] = {}
    for p in ps:
        for x in p.get("vibes", []):
            v[f"vibe:{x}"] = v.get(f"vibe:{x}", 0) + 1
        if p.get("color_family"):
            v[f"color:{p['color_family']}"] = v.get(f"color:{p['color_family']}", 0) + 1
    return v


def dna_score(ps, taste) -> float:
    if not taste or not any(taste.values()):
        return 70
    lv = look_vector(ps)
    dot = sum(lv[k] * taste.get(k, 0) for k in lv)
    n = math.sqrt(sum(x * x for x in lv.values())) * math.sqrt(sum(x * x for x in taste.values()))
    return 50 + 50 * (dot / n if n else 0)


GOOD = {"color": "The colours sit together without competing", "formality": "Every piece sits at the same dress level",
        "silhouette": "Relaxed and fitted pieces balance each other", "dna": "Right in line with your Style DNA"}
TRADE = {"color": "though the colours compete a little", "formality": "though the pieces sit at different dress levels",
         "silhouette": "though both pieces share the same cut", "dna": "though it's a step outside your usual style"}


def _reason(c: dict, ps, occasion) -> str:
    best = max(WEIGHTS, key=lambda k: (c[k], WEIGHTS[k]))
    good = GOOD[best]
    if best == "color" and all((p.get("color_family") or "").lower() in NEUTRALS for p in ps):
        good = "An easy neutral palette that pairs with anything"
    elif best == "silhouette" and any(p["slot"] == "one_piece" for p in ps):
        good = "One easy piece, nothing to coordinate"
    elif best == "formality" and occasion:
        good = f"Pitched right for {occasion.lower()}"
    worst = min(WEIGHTS, key=lambda k: c[k])
    if c[worst] < 60 and worst != best:
        trade = TRADE[worst]
        if worst == "formality" and len({p.get("formality") for p in ps}) == 1:
            f = ps[0].get("formality", 2)
            trade = f"though it reads {'dressier' if f > occasion_target(occasion) else 'more casual'} than the occasion"
        return f"{good}, {trade}"
    return good


def score_look(items: list[dict], occasion: str | None, taste: dict | None) -> dict:
    """items: products, or {slot, product} dicts."""
    ps = _products(items)
    if not ps:
        return {"score": 0, "band": "bold", "reason": "", "components": {}}
    c = {"color": color_score(ps), "formality": formality_score(ps, occasion), "silhouette": silhouette_score(ps),
         "dna": dna_score(ps, taste)}
    score = round(sum(c[k] * w for k, w in WEIGHTS.items()))
    return {"score": score, "band": band(score), "reason": _reason(c, ps, occasion),
            "components": {k: round(v) for k, v in c.items()}}


def _first_color(p: dict) -> str:
    return ((p.get("colors") or [p.get("color_family") or ""])[0] or "").lower()


def _swap_reason(cand: dict, rest: list[dict], c: dict, base: dict) -> str:
    """What this candidate changes: the component it improves most over the current piece, in plain words."""
    gains = {k: (c[k] - base.get(k, c[k])) * w for k, w in WEIGHTS.items()}
    k = max(WEIGHTS, key=lambda k: (gains[k], c[k] * WEIGHTS[k]))
    if gains[k] <= 0:
        k = max(WEIGHTS, key=lambda k: (c[k], WEIGHTS[k]))
    o = next((p for p in rest if p["slot"] in ("top", "bottom", "one_piece")), None)
    ocat = o and (o.get("category") or o["slot"]).replace("_", " ")
    text = {
        "color": f"{_first_color(cand).capitalize()} pairs cleanly with the {_first_color(o)} {ocat}" if o
        else "Keeps the palette easy",
        "silhouette": f"Its {cand.get('fit')} cut balances the {o.get('fit')} {ocat}"
        if o and cand.get("fit") and o.get("fit") and cand.get("fit") != o.get("fit") else "Keeps the proportions easy",
        "formality": f"Same dress level as the {ocat}, in {_first_color(cand)}" if o
        else "Right dress level for the occasion",
        "dna": "Closer to your Style DNA",
    }[k]
    worst = min(WEIGHTS, key=lambda x: c[x])
    return f"{text}, {TRADE[worst]}" if c[worst] < 60 and worst != k else text


def alternatives(items, slot, budget_max, occasion, taste, limit=6, exclude_ids=(), never=()) -> list[dict]:
    """Rank catalogue pieces for `slot` with the rest of the look fixed, within the remaining budget."""
    ps = _products(items)
    cur = next((p for p in ps if p["slot"] == slot), None)
    rest = [p for p in ps if p["slot"] != slot]
    gender = next((p["gender"] for p in ps if p.get("gender") not in (None, "unisex")), None)
    total = sum(p["price"] for p in ps)
    cap = budget_max - (total - (cur["price"] if cur else 0)) if budget_max else None
    never = {n.lower() for n in never}
    skip = {*exclude_ids, *(p["id"] for p in ps)}
    base = score_look(ps, occasion, taste)["components"]
    out = []
    for p in catalog.PRODUCTS.values():
        if (p["slot"] != slot or p["id"] in skip or not catalog.gender_ok(p, gender) or (cap is not None and p["price"] > cap)
                or never & catalog.attrs(p) or not p.get("vto_ready", True)):
            continue
        s = score_look([*rest, p], occasion, taste)
        out.append({"product": p, "score": s["score"], "score_band": s["band"],
                    "reason": _swap_reason(p, rest, s["components"], base),
                    "price_delta": p["price"] - (cur["price"] if cur else 0)})
    out.sort(key=lambda a: (-a["score"], a["product"]["price"], a["product"]["id"]))
    return out[:limit]
