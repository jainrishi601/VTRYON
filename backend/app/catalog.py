"""In-memory catalogue (data/products.json, ~500 rows) + filtered retrieval with a relaxation ladder."""

import json

from app import config

PRODUCTS: dict[str, dict] = {}


def load(path=None) -> None:
    p = path or config.DATA_DIR / "products.json"
    PRODUCTS.clear()
    if p.exists():
        PRODUCTS.update({r["id"]: {**_sized(r), "default_size": default_size(r)} for r in json.loads(p.read_text())})


def _sized(r: dict) -> dict:
    """Display images at 800px from the Shopify CDN (~3x lighter; grids load dozens). vto_ref_url stays full-res
    because YouCam renders from it."""
    for k in ("image_url", "image_url_alt"):
        u = r.get(k)
        if u and "cdn.shopify.com" in u and "width=" not in u:
            r[k] = u + ("&" if "?" in u else "?") + "width=800"
    return r


SIZE_ORDER = ("XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL")


def default_size(p: dict, wanted: str | None = None) -> str:
    """The size a cart line starts on: `wanted` (the shopper's profile size) or M, else the nearest size in stock
    (the larger one on a tie). Bags and accessories are One Size."""
    stock = p.get("sizes_in_stock") or []
    if p.get("slot") in ("bag", "accessory", "footwear") or stock == ["One Size"]:
        return "One Size"
    want = wanted if wanted in SIZE_ORDER else "M"
    if not stock or want in stock:
        return want
    rank = {s: i for i, s in enumerate(SIZE_ORDER)}
    return min(stock, key=lambda s: (abs(rank.get(s, 99) - rank[want]), -rank.get(s, 0)))


def get(pid: str) -> dict | None:
    if not PRODUCTS:
        load()  # the data agent may write products.json after startup
    return PRODUCTS.get(pid)


def gender_ok(p: dict, gender: str | None) -> bool:
    return not gender or gender == "both" or p.get("gender") in (gender, "unisex")


def attrs(p: dict) -> set[str]:
    """Every value a never-list or a taste key can match."""
    vals = [*p.get("colors", []), p.get("color_family"), *p.get("vibes", []), p.get("pattern"), p.get("category"),
            *(p.get("fabric") or "").split()]
    return {str(v).lower() for v in vals if v}


def _hay(p: dict) -> str:
    return " ".join([p.get("title", ""), p.get("category", ""), p.get("fabric") or "", p.get("pattern") or "",
                     p.get("color_family") or "", *p.get("colors", []), *p.get("vibes", [])]).lower()


def _tokens(query: str) -> list[str]:
    return [t.strip(".,!?") for t in query.lower().split() if len(t.strip(".,!?")) > 1]


def taste_bonus(p: dict, taste: dict | None) -> float:
    if not taste:
        return 0.0
    return sum(taste.get(f"vibe:{v}", 0) for v in p.get("vibes", [])) + taste.get(f"color:{p.get('color_family')}", 0)


def search(slot, gender, query="", colors=None, vibes=None, max_price=None, formality_min=None, formality_max=None,
           exclude_ids=(), never=(), taste=None, limit=12) -> tuple[list[dict], str]:
    """Hard filters (slot, gender, never, exclusions) are never relaxed. Soft filters relax in ladder order until
    there are at least 3 candidates: colours, vibes, formality ±1, price +25%."""
    if not PRODUCTS:
        load()
    never = {n.lower() for n in never or ()}
    base = [p for p in PRODUCTS.values() if p["slot"] == slot and gender_ok(p, gender) and p["id"] not in exclude_ids
            and not (never & attrs(p))]
    colors = {c.lower() for c in colors or ()}
    vibes = set(vibes or ())
    f = {"colors": colors, "vibes": vibes, "fmin": formality_min, "fmax": formality_max, "price": max_price}

    def match(p, f):
        return ((not f["colors"] or f["colors"] & {*map(str.lower, p.get("colors", [])), p.get("color_family")})
                and (not f["vibes"] or f["vibes"] & set(p.get("vibes", [])))
                and (f["fmin"] is None or p["formality"] >= f["fmin"])
                and (f["fmax"] is None or p["formality"] <= f["fmax"])
                and (f["price"] is None or p["price"] <= f["price"]))

    steps = [(dict(f), "")]
    if colors:
        f = {**f, "colors": set()}
        steps.append((f, "dropped the colour filter"))
    if vibes:
        f = {**f, "vibes": set()}
        steps.append((f, "dropped the vibe filter"))
    if formality_min is not None or formality_max is not None:
        f = {**f, "fmin": None if formality_min is None else formality_min - 1,
             "fmax": None if formality_max is None else formality_max + 1}
        steps.append((f, "widened formality by one step"))
    if max_price:
        f = {**f, "price": round(max_price * 1.25)}
        steps.append((f, f"relaxed price to ₹{f['price']:,}"))

    relaxed = []
    for flt, why in steps:
        hits = [p for p in base if match(p, flt)]
        if why:
            relaxed.append(why)
        if len(hits) >= 3 or flt is steps[-1][0]:
            break
    if relaxed and not hits:
        relaxed = []
    toks = _tokens(query)

    def rank(p):
        hay = _hay(p)
        return (3 * sum(t in hay for t in toks)
                + 2 * bool(colors & {*map(str.lower, p.get("colors", [])), p.get("color_family")})
                + 2 * bool(vibes & set(p.get("vibes", [])))
                + taste_bonus(p, taste) + 0.5 * bool(p.get("vto_ready", True)))

    hits.sort(key=lambda p: (-rank(p), p["price"], p["id"]))
    out = hits[:limit]
    note = f"{len(hits)} matches" + (f"; {', '.join(relaxed)} to find more" if relaxed else "")
    return out, (note if hits else "No matches in the catalogue for this slot")


def list_products(gender=None, slot=None, q="", vibe=None, max_price=None, offset=0, limit=24) -> tuple[list[dict], int]:
    if not PRODUCTS:
        load()
    toks = _tokens(q or "")
    rows = [p for p in PRODUCTS.values()
            if gender_ok(p, gender) and (not slot or p["slot"] == slot) and (not vibe or vibe in p.get("vibes", []))
            and (not max_price or p["price"] <= max_price) and all(t in _hay(p) for t in toks)]
    return rows[offset:offset + limit], len(rows)
