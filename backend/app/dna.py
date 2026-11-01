"""Taste graph (AGENT_SPEC §6): user node -> attribute nodes (vibe/color/category/...) with weighted, scoped edges."""

from datetime import UTC, datetime

from app import catalog, config
from app.db import ex, now, q, q1

WEIGHTS = {"wore": 0.6, "tried_on": 0.3, "liked_outfit": 0.8, "disliked_outfit": -0.8, "added_to_cart": 1.0, "friend_liked": 0.3,
           "friend_disliked": -0.3, "swapped_out": -0.7, "swapped_in": 0.7}
VIBE_NOUN = {"minimal": "Minimal", "bold": "Statement", "classic": "Classic", "street": "Street", "boho": "Boho",
             "sporty": "Sport", "romantic": "Romantic", "edgy": "Edge"}
VIBE_ADJ = {"minimal": "Quiet", "bold": "Vivid", "classic": "Polished", "street": "Urban", "boho": "Free-spirited",
            "sporty": "Easy", "romantic": "Soft", "edgy": "Sharp"}
COLOR_ADJ = {"white": "Coastal", "ivory": "Coastal", "cream": "Coastal", "beige": "Sandstone", "sand": "Sandstone",
             "blue": "Coastal", "navy": "Nautical", "black": "Noir", "grey": "Slate", "brown": "Earthy",
             "green": "Garden", "olive": "Garden", "sage": "Garden", "pink": "Rosewater", "red": "Ember",
             "orange": "Sunset", "rust": "Sunset", "yellow": "Sunlit", "purple": "Twilight", "multi": "Painted"}
VIBE_TRAIT = {"minimal": "Clean lines", "bold": "Statement pieces", "classic": "Timeless cuts", "street": "Easy streetwear",
              "boho": "Flowing shapes", "sporty": "Active comfort", "romantic": "Soft details", "edgy": "Sharp contrasts"}


def _node(user_token: str, type_: str, key: str) -> int:
    ex("insert or ignore into nodes(user_token, type, key, attrs) values (?,?,?,?)", user_token, type_, key, {})
    return q1("select id from nodes where user_token=? and type=? and key=?", user_token, type_, key)["id"]


def add_edge(user_token, edge_type, attr_kind, value, weight, scope=None) -> None:
    if not user_token or not value:
        return
    u = _node(user_token, "user", user_token)
    a = _node(user_token, attr_kind, str(value).lower())
    ex("insert into edges(user_token, from_node, to_node, type, weight, scope, created_at) values (?,?,?,?,?,?,?)",
       user_token, u, a, edge_type, weight, scope, now())


def _edges(user_token, scope=None) -> list[dict]:
    return q("select e.*, n.type kind, n.key value from edges e join nodes n on n.id=e.to_node "
             "where e.user_token=? and e.scope is ? order by e.id", user_token, scope)


def taste_vector(user_token, scope=None) -> dict[str, float]:
    """Weighted sum with a 10% monthly decay; keys like 'vibe:minimal', 'color:white'. Never-edges are excluded."""
    t = datetime.now(UTC)
    v: dict[str, float] = {}
    for e in _edges(user_token, scope):
        if e["type"] == "never":
            continue
        months = (t - datetime.fromisoformat(e["created_at"])).days / 30
        k = f"{e['kind']}:{e['value']}"
        v[k] = v.get(k, 0) + e["weight"] * 0.9**months
    return {k: round(w, 3) for k, w in v.items() if abs(w) > 1e-6}


def never_list(user_token, scope=None) -> list[str]:
    return sorted({e["value"] for e in _edges(user_token, scope) if e["type"] == "never"})


def _top(d: dict, n: int, positive=True) -> list[str]:
    return [k for k, w in sorted(d.items(), key=lambda kv: (-kv[1], kv[0])) if (w > 0 if positive else True)][:n]


def summary(user_token, scope=None) -> dict:
    tv = taste_vector(user_token, scope)
    vibes = {k[5:]: w for k, w in tv.items() if k.startswith("vibe:")}
    colors = {k[6:]: w for k, w in tv.items() if k.startswith("color:")}
    top_v, top_c = _top(vibes, 2), _top(colors, 1)
    name = None
    if top_v:
        first = COLOR_ADJ.get(top_c[0]) if top_c else None
        first = first or (VIBE_ADJ[top_v[1]] if len(top_v) > 1 else "Quiet" if top_v[0] != "minimal" else "Pure")
        name = f"{first} {VIBE_NOUN.get(top_v[0], top_v[0].title())}"
    traits = [VIBE_TRAIT.get(v, v.title()) for v in top_v]
    if top_c:
        traits.append(f"Drawn to {top_c[0]}")
    disliked = [k for k, w in sorted(vibes.items(), key=lambda kv: kv[1]) if w < 0]
    if len(traits) < 3 and disliked:
        traits.append(f"Skips {disliked[0]}")
    return {"vibes": vibes, "colors": colors, "never": never_list(user_token, scope), "name": name, "traits": traits[:3]}


def _attrs_of(items) -> tuple[set, set]:
    ps = [it.get("product", it) for it in items]
    return {v for p in ps for v in p.get("vibes", [])}, {p["color_family"] for p in ps if p.get("color_family")}


def record_look_event(user_token, look_items: list[dict], kind: str, scope=None) -> None:
    """One edge per distinct vibe and colour family in the look."""
    w = WEIGHTS[kind]
    vibes, colors = _attrs_of(look_items)
    for v in vibes:
        add_edge(user_token, kind, "vibe", v, w, scope)
    for c in colors:
        add_edge(user_token, kind, "color", c, w, scope)


def record_swap(user_token, old: dict, new: dict, scope=None) -> None:
    """swapped_out/in on the distinguishing attributes only."""
    (ov, oc), (nv, nc) = _attrs_of([old]), _attrs_of([new])
    for v in ov - nv:
        add_edge(user_token, "swapped_out", "vibe", v, WEIGHTS["swapped_out"], scope)
    for c in oc - nc:
        add_edge(user_token, "swapped_out", "color", c, WEIGHTS["swapped_out"], scope)
    for v in nv - ov:
        add_edge(user_token, "swapped_in", "vibe", v, WEIGHTS["swapped_in"], scope)
    for c in nc - oc:
        add_edge(user_token, "swapped_in", "color", c, WEIGHTS["swapped_in"], scope)


def pick(user_token, vibe: str, color_family: str | None, verdict: str, scope=None) -> None:
    """DNA tile heart/cross: ±1 vibe, ±0.5 colour; two crosses on one vibe -> never."""
    s = 1 if verdict == "heart" else -1
    add_edge(user_token, verdict, "vibe", vibe, 1.0 * s, scope)
    add_edge(user_token, verdict, "color", color_family, 0.5 * s, scope)
    crosses = [e for e in _edges(user_token, scope) if e["type"] == "cross" and e["kind"] == "vibe" and e["value"] == vibe]
    if len(crosses) >= 2 and vibe not in never_list(user_token, scope):
        add_edge(user_token, "never", "vibe", vibe, 0, scope)


NEUTRALS = {"white", "ivory", "beige", "cream", "black", "grey", "gray", "navy", "brown", "denim", "neutral"}


def representative(vibe: str, gender: str) -> dict | None:
    """The tile piece for a vibe: fixed per (vibe, gender) so prerendered tiles always hit the cache."""
    slot = "one_piece" if gender == "women" else "top"
    c = [p for p in catalog.PRODUCTS.values()
         if p["slot"] == slot and p.get("gender") == gender and vibe in p.get("vibes", []) and p.get("vto_ready", True)]
    # purest first (vibe listed first, fewest vibes), then mid statement, then id for stability
    # a "minimal" tile in fuchsia read as a mislabel: minimal prefers a neutral colour family
    neutral = lambda p: vibe == "minimal" and p.get("color_family") not in NEUTRALS  # noqa: E731
    c.sort(key=lambda p: (neutral(p), p["vibes"].index(vibe), len(p["vibes"]), abs(p.get("statement_level", 2) - 2),
                          p["id"]))
    return c[0] if c else None


def pick_tiles(occasion: str | None, gender: str | None) -> list[tuple[str, dict]]:
    """4 distinct vibes most relevant to the occasion, each with its representative piece."""
    if not catalog.PRODUCTS:
        catalog.load()
    gender = gender if gender in ("women", "men") else "women"
    occ = (occasion or "").lower()
    rel = {v: 0 for v in config.VIBES}
    for p in catalog.PRODUCTS.values():
        if p.get("gender") in (gender, "unisex"):
            hit = any(o.lower() in occ or (occ and occ.split()[0] in o.lower()) for o in p.get("occasions", []))
            for v in p.get("vibes", []):
                if v in rel:
                    rel[v] += 3 if hit else 1
    out, seen = [], set()
    for v in sorted(rel, key=lambda v: (-rel[v], config.VIBES.index(v))):
        p = representative(v, gender)
        if p and p["id"] not in seen:
            out.append((v, p))
            seen.add(p["id"])
        if len(out) == 4:
            break
    return out


def export(user_token) -> dict:
    return {"summary": summary(user_token), "nodes": q("select * from nodes where user_token=?", user_token),
            "edges": q("select * from edges where user_token=? order by id", user_token)}
