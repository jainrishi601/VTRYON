"""Tool schemas (static, sorted, strict) and their executors. The model only ever sees opaque refs (c_N);
code maps them back to product ids and validates every look before anything reaches the shopper."""

from __future__ import annotations

from app import catalog, dna

SLOTS = ["top", "bottom", "one_piece", "layer", "bag", "accessory"]
VIBES = ["minimal", "bold", "classic", "street", "boho", "sporty", "romantic", "edgy"]
SLOT_PLURAL = {"top": "tops", "bottom": "bottoms", "one_piece": "one-pieces", "layer": "layers",
               "bag": "bags", "accessory": "accessories"}
MAX_LOOKS = 3
PREF_KINDS = ["never", "like", "dislike"]
PREF_ATTRS = ["color", "vibe", "category", "fabric", "pattern"]


def _obj(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


_STR = {"type": "string"}
_STRS = {"type": "array", "items": {"type": "string"}}
WEARER = _obj({
    "for": {"type": "string", "enum": ["self", "other", "unknown"]},
    "relation": {**_STR, "description": "For someone else: brother, sister, friend, partner...; else \"\"."},
    "gender": {"type": "string", "enum": ["women", "men", "unknown"], "description": "The WEARER's gender."},
    "occasion": {**_STR, "description": "The occasion if this turn states or changes it, else \"\"."},
}, ["for", "relation", "gender", "occasion"])
WEARER_DESC = ("Who you are dressing, as you understand it now (from <shopper> and this message). The app saves it, "
               "so later turns and try-ons use the right gender. Use \"unknown\" / \"\" only for what you don't know.")

TOOLS = [
    {
        "name": "ask_clarification",
        "description": (
            "Ask the shopper 1-2 short questions as ONE tap-able card, then end the turn. Use it at the start of "
            "every new request (see the system prompt) for what would most change what you show: who it's for, "
            "the wearer's gender, the occasion, a budget, or the one detail that sharpens this request (dress code, "
            "vibe, fit, colour). Never ask what <shopper> or the chat already answers. Most important first."
        ),
        "strict": True,
        "input_schema": _obj({
            "questions": {
                "type": "array",
                "description": "1 or 2 questions, never more.",
                "items": _obj({
                    "field": {"type": "string", "enum": ["wearer", "gender", "occasion", "budget", "style", "fit",
                                                          "detail"], "description": (
                        "What the answer fills in. Option values must follow it: wearer -> \"self\" or a relation "
                        "(\"brother\", \"friend\"); gender -> \"women\", \"men\" or \"both\"; occasion -> a "
                        "short occasion (\"Beach party\"); budget -> rupees per look (or per piece for a product "
                        "request) as digits (\"5000\") or \"none\"; fit -> \"relaxed\", \"regular\" or "
                        "\"fitted\"; style and detail -> the option's own short words (\"Smart casual\").")},
                    "question": {**_STR, "description": "One short sentence, second person, no exclamation marks."},
                    "options": {"type": "array", "description": "2-4 answers. The card adds \"Something else\".",
                                "items": _obj({"label": {**_STR, "description": "What the button says."},
                                               "value": {**_STR, "description": "Machine value per `field`."}},
                                              ["label", "value"])},
                }, ["field", "question", "options"]),
            },
        }, ["questions"]),
    },
    {
        "name": "present_looks",
        "description": (
            "Show outfit cards to the shopper and end the turn. Each look is top + bottom, or one one_piece, plus "
            "optionally a layer / bag / accessory; one item per slot; refs must come from search_catalog results "
            "this turn or from <current_looks>. The app validates every look (refs, slots, gender, budget, never "
            "list) and returns errors if something is wrong; fix them and call again once. Prices and totals are "
            "shown on the cards, so don't state them."
        ),
        "strict": True,
        "input_schema": _obj({
            "message": {**_STR, "description": "1-2 sentences to the shopper shown above the cards. No prices."},
            "looks": {
                "type": "array",
                "description": "1-3 looks. 2-3 distinct looks for a fresh request; 1 (maybe 2) when editing a look.",
                "items": _obj({
                    "name": {**_STR, "description": "Two evocative words, e.g. \"Sunset Linen\"."},
                    "item_refs": {**_STRS, "description": "Refs like c_3, one per slot."},
                    "why": {**_STR, "description": "One concrete reason it works, <=25 words, second person."},
                    "tip": {**_STR, "description": (
                        "One short finishing tip for something the store doesn't sell (footwear, jewellery, hair), "
                        "second person, <=18 words, e.g. \"Your own tan sandals keep it beach-easy.\"; or \"\".")},
                    "over_budget": {"type": "boolean", "description": (
                        "true only when you deliberately show a look above the budget because nothing in budget "
                        "works, and your message says so.")},
                }, ["name", "item_refs", "why", "tip", "over_budget"]),
            },
            "modifies_look_id": {"type": ["string", "null"], "description": (
                "The lk_ id of the look being edited (follow-ups), else null.")},
            "budget_per_look": {"type": ["integer", "null"], "description": (
                "Per-look budget in rupees if the shopper stated a new one in this chat that replaces the brief's, "
                "else null.")},
            "wearer_is_minor": {"type": "boolean", "description": "true if the wearer is under 18."},
            "wearer": {**WEARER, "description": WEARER_DESC},
            "try_next": {**_STRS, "description": (
                "2 short follow-ups the shopper might tap next, in the shopper's own voice and under 60 characters, "
                "e.g. \"Shorts instead of trousers in look 1\", \"Which one works for a sunset dinner?\".")},
            "request": {"type": "string", "enum": ["new", "new_fully_specified", "refinement"], "description": (
                "new: a new occasion, kind of piece or person (it must follow your question card); "
                "new_fully_specified: new, but this message already states who it's for, a budget and the key "
                "detail; refinement: a change to what is on screen.")},
        }, ["message", "looks", "modifies_look_id", "budget_per_look", "wearer_is_minor", "wearer", "try_next",
            "request"]),
    },
    {
        "name": "present_products",
        "description": (
            "Show a grid of single products (not outfits) and end the turn. Use it when the shopper asks for a kind "
            "of piece (\"casual shirts for the office\", \"show me some pants\", \"a white kurta\") rather than "
            "what to wear for an occasion. 4-8 refs from search_catalog this turn, best match first. The app checks "
            "every ref (gender, never list); the shopper can try any of them on or build a look around one."
        ),
        "strict": True,
        "input_schema": _obj({
            "message": {**_STR, "description": "1 sentence above the grid. No prices."},
            "product_refs": {**_STRS, "description": "4-8 refs like c_3, best first."},
            "wearer": {**WEARER, "description": WEARER_DESC},
            "try_next": {**_STRS, "description": (
                "2 short follow-ups the shopper might tap next, in the shopper's own voice and under 60 characters, "
                "e.g. \"Shorts instead of trousers in look 1\", \"Which one works for a sunset dinner?\".")},
            "request": {"type": "string", "enum": ["new", "new_fully_specified", "refinement"], "description": (
                "new: a new occasion, kind of piece or person (it must follow your question card); "
                "new_fully_specified: new, but this message already states who it's for, a budget and the key "
                "detail; refinement: a change to what is on screen.")},
        }, ["message", "product_refs", "wearer", "try_next", "request"]),
    },
    {
        "name": "remember_preference",
        "description": (
            "Save a lasting taste preference the shopper stated explicitly, e.g. \"never show me yellow\" "
            "(kind=never, attribute=color, value=yellow), \"I hate prints\" (never, pattern, print), \"I love "
            "linen\" (like, fabric, linen). Not for one-off requests like \"in blue this time\". Non-terminal: "
            "continue the turn after calling it."
        ),
        # ponytail: not strict. All five strict tools together exceed the API's compiled-grammar limit (any four
        # fit); this is the smallest, non-terminal one, and remember() checks its input itself.
        "input_schema": _obj({
            "kind": {"type": "string", "enum": PREF_KINDS},
            "attribute": {"type": "string", "enum": PREF_ATTRS},
            "value": {**_STR, "description": "Lower-case single value, e.g. \"yellow\", \"boho\", \"print\"."},
        }, ["kind", "attribute", "value"]),
    },
    {
        "name": "search_catalog",
        "description": (
            "Search the Northline catalogue for one slot. Returns up to `limit` candidates with refs and rich "
            "metadata (colours, fabric, formality 1-5, fit, statement_level 1-5, pairing hints), ranked by text "
            "match and the shopper's taste. The never list is always filtered out. If exact filters find too "
            "little, filters are relaxed (colours, then vibes, then formality, then price +25%) and `note` says "
            "so. Call several in parallel (e.g. tops and bottoms) in one step."
        ),
        "strict": True,
        "input_schema": _obj({
            "slot": {"type": "string", "enum": SLOTS},
            "gender": {"type": "string", "enum": ["women", "men"], "description": "The wearer's gender."},
            "for_whom": {"type": "string", "enum": ["shopper", "recipient"], "description": (
                "Whose Style DNA ranks the results: the shopper's own, or the recipient's when dressing them.")},
            "query": {**_STR, "description": "Garment + colour + fabric in plain words, e.g. \"linen shirt sage\"."},
            "colors": {**_STRS, "description": "Colour words to prefer, e.g. [\"navy\", \"blue\"]. [] for any."},
            "vibes": {"type": "array", "items": {"type": "string", "enum": VIBES}, "description": "[] for any."},
            "max_price": {"type": ["integer", "null"], "description": "Max price of this piece in rupees."},
            "formality_min": {"type": ["integer", "null"], "description": "1-5"},
            "formality_max": {"type": ["integer", "null"], "description": "1-5"},
            "exclude_refs": {**_STRS, "description": "Refs to leave out (rejected or already used)."},
            "limit": {"type": ["integer", "null"], "description": "Default 10, max 15."},
        }, ["slot", "gender", "for_whom", "query", "colors", "vibes", "max_price", "formality_min", "formality_max",
            "exclude_refs", "limit"]),
    },
]
TERMINAL = {"present_looks", "present_products", "ask_clarification"}
MAX_PRODUCTS = 8


def _piece(pid):
    from app import looks  # store product or the shopper's own wardrobe piece
    return looks.piece(pid) if pid else None


def pd(p) -> dict:
    """Product as a plain dict (catalog may hold dicts or pydantic models)."""
    return p if isinstance(p, dict) else p.model_dump()


class Refs:
    """Session-stable opaque refs. c_N <-> product id."""

    def __init__(self, by_ref: dict | None = None):
        self.by_ref: dict[str, str] = dict(by_ref or {})
        self.by_pid = {v: k for k, v in self.by_ref.items()}

    def ref(self, pid: str) -> str:
        if pid not in self.by_pid:
            r = f"c_{len(self.by_ref) + 1}"
            self.by_ref[r], self.by_pid[pid] = pid, r
        return self.by_pid[pid]

    def pid(self, ref: str) -> str | None:
        return self.by_ref.get(str(ref).strip())


def compact(p, ref: str) -> dict:
    p = pd(p)
    pairing = p.get("pairing") or {}
    return {
        "ref": ref, "title": p["title"], "slot": p["slot"], "gender": p["gender"], "price": p["price"],
        "colors": p.get("colors"), "color_family": p.get("color_family"), "pattern": p.get("pattern"),
        "fabric": p.get("fabric"), "vibes": p.get("vibes"), "formality": p.get("formality"), "fit": p.get("fit"),
        "statement_level": p.get("statement_level"), "occasions": (p.get("occasions") or [])[:5],
        "pairs_with": pairing.get("colors") or [], "avoid": pairing.get("avoid") or [],
        "one_liner": p.get("one_liner"),
    }


def search(t, inp: dict) -> tuple[dict, str]:
    """Run search_catalog. Returns (tool result, status label)."""
    exclude = {t.refs.pid(r) for r in inp.get("exclude_refs") or []} | t.rejected
    limit = max(1, min(int(inp.get("limit") or 10), 15))
    pr = (getattr(t, "profiles", None) or {}).get(inp.get("for_whom") or "")
    taste, never = (pr["taste"], pr["never"]) if pr else (t.taste, t.never)
    items, note = catalog.search(
        inp["slot"], inp["gender"], query=inp.get("query") or "", colors=inp.get("colors") or None,
        vibes=inp.get("vibes") or None, max_price=inp.get("max_price"), formality_min=inp.get("formality_min"),
        formality_max=inp.get("formality_max"), exclude_ids=tuple(x for x in exclude if x), never=tuple(never),
        taste=taste, limit=limit,
    )
    out = [compact(p, t.refs.ref(pd(p)["id"])) for p in items]
    t.visible |= {pd(p)["id"] for p in items}
    t.trace.append({"tool": "search_catalog", "input": inp, "n": len(out), "note": note,
                    "pids": [pd(p)["id"] for p in items]})
    label = f"Found {len(out)} {SLOT_PLURAL.get(inp['slot'], 'pieces')} for “{inp.get('query') or inp['slot']}”"
    if inp.get("max_price"):
        label += f" under ₹{int(inp['max_price']):,}"
    if not out:
        label = f"No {SLOT_PLURAL.get(inp['slot'], 'pieces')} found for “{inp.get('query')}”"
    return {"results": out, "count": len(out), "note": note or ""}, label


def remember(t, inp: dict) -> dict:
    kind, attr, value = inp.get("kind"), inp.get("attribute"), str(inp.get("value") or "").strip().lower()
    if kind not in PREF_KINDS or attr not in PREF_ATTRS or not value:
        return {"ok": False, "error": f"kind must be one of {PREF_KINDS}, attribute one of {PREF_ATTRS}, value non-empty"}
    weight = {"never": 0.0, "like": 1.0, "dislike": -1.0}[kind]
    dna.add_edge(t.user_token, kind, attr, value, weight, scope=t.scope)
    if kind == "never":
        t.never.append(value)
    t.trace.append({"tool": "remember_preference", "input": inp})
    return {"ok": True, "saved": f"{kind} {attr}={value}"}


def _never_hits(p: dict, never: list[str]) -> list[str]:
    a = catalog.attrs(p)
    return [n for n in never if n.lower() in a]


def validate(t, inp: dict) -> tuple[list[dict], list[str]]:
    """Check every look. Returns ([{spec, items:[(slot, product)], total, errors}], global errors)."""
    specs = inp.get("looks") or []
    errs = []
    if not specs:
        errs.append("No looks given. Present 1-3 looks.")
    if len(specs) > MAX_LOOKS:
        errs.append(f"Too many looks ({len(specs)}); present at most {MAX_LOOKS}.")
    budget = inp.get("budget_per_look") or t.budget
    gender = t.target_gender
    out, seen_sets, names = [], set(), set()
    for i, spec in enumerate(specs[:MAX_LOOKS], 1):
        e, items = [], []
        label = f"Look {i} “{spec.get('name', '')}”"
        for ref in spec.get("item_refs") or []:
            pid = t.refs.pid(ref)
            p = _piece(pid) if pid in t.visible else None  # an owned piece only if already on screen
            if not p:
                e.append(f"uses {ref}, which was not returned by search_catalog this turn or listed in "
                         "<current_looks>; use only those refs")
                continue
            items.append((ref, pd(p)))
        slots = [p["slot"] for _, p in items]
        for s in {s for s in slots if slots.count(s) > 1}:
            e.append(f"has {slots.count(s)} items in slot {s}; one per slot")
        has_base = ("top" in slots and "bottom" in slots) or "one_piece" in slots
        if "one_piece" in slots and ("top" in slots or "bottom" in slots):
            e.append("mixes a one_piece with a top/bottom; use one or the other")
        elif not has_base and items:
            missing = "a one_piece, or top + bottom" if not ({"top", "bottom"} & set(slots)) else (
                "a bottom" if "top" in slots else "a top")
            e.append(f"is incomplete: needs {missing}")
        genders = {p["gender"] for _, p in items} - {"unisex"}
        if gender in ("women", "men"):
            wrong = [r for r, p in items if p["gender"] not in (gender, "unisex")]
            if wrong:
                e.append(f"{', '.join(wrong)} are not {gender}'s pieces; the wearer shops {gender}")
        elif len(genders) > 1:
            e.append("mixes women's and men's pieces")
        for r, p in items:
            hits = _never_hits(p, t.never)
            if hits:
                e.append(f"{r} ({p['title']}) breaks the shopper's never list ({', '.join(hits)})")
            if p["id"] in t.rejected:
                e.append(f"{r} ({p['title']}) was rejected by the shopper earlier; don't show it again")
        total = sum(p["price"] for _, p in items)
        if budget and total > budget and not spec.get("over_budget") and not e:
            e.append(f"totals ₹{total:,}, ₹{total - budget:,} over the ₹{budget:,} per-look budget. "
                     "Search cheaper pieces (use max_price), or if nothing in budget works set over_budget=true "
                     f"and say in the message that it is ₹{total - budget:,} over")
        key = frozenset(p["id"] for _, p in items)
        if key and key in seen_sets:
            e.append("is identical to another look; make each look distinct")
        seen_sets.add(key)
        nm = (spec.get("name") or "").strip().lower()
        if nm in names:
            e.append("reuses another look's name")
        names.add(nm)
        out.append({"spec": spec, "items": [(p["slot"], p) for _, p in items], "total": total,
                    "errors": [f"{label} {x}" for x in e]})
    return out, errs


def validate_products(t, inp: dict) -> tuple[list[dict], list[str]]:
    """Check a product grid. Returns (valid products in order, errors). Duplicates are dropped silently."""
    gender = t.target_gender
    out, errs, seen = [], [], set()
    for ref in inp.get("product_refs") or []:
        pid = t.refs.pid(ref)
        p = pd(catalog.get(pid)) if pid in t.visible and catalog.get(pid) else None
        if not p:
            errs.append(f"{ref} was not returned by search_catalog this turn; use only those refs")
            continue
        if p["id"] in seen:
            continue
        if gender in ("women", "men") and p["gender"] not in (gender, "unisex"):
            errs.append(f"{ref} ({p['title']}) is not a {gender}'s piece; the wearer shops {gender}")
            continue
        hits = _never_hits(p, t.never)
        if hits:
            errs.append(f"{ref} ({p['title']}) breaks the shopper's never list ({', '.join(hits)})")
            continue
        seen.add(p["id"])
        out.append(p)
    if not out and not errs:
        errs.append("No products given. Present 4-8 refs.")
    return out[:MAX_PRODUCTS], errs


CLARIFY_FIELDS = {"wearer", "gender", "occasion", "budget", "style", "fit", "detail"}


def clean_try_next(xs) -> list[str]:
    """Follow-up chips: up to 3 short, distinct lines."""
    out = []
    for x in xs or []:
        x = " ".join(str(x).split())[:80]
        if x and x.lower() not in {o.lower() for o in out}:
            out.append(x)
    return out[:3]


def clean_clarify(inp: dict) -> dict | None:
    """The card the widget shows: at most 2 questions, 2-4 options each, known fields only."""
    qs = []
    for q in inp.get("questions") or []:
        opts = [{"label": o["label"].strip(), "value": str(o.get("value") or o["label"]).strip()}
                for o in q.get("options") or [] if (o.get("label") or "").strip()][:4]
        if q.get("field") in CLARIFY_FIELDS and (q.get("question") or "").strip() and len(opts) >= 2:
            qs.append({"field": q["field"], "question": q["question"].strip(), "options": opts})
    return {"questions": qs[:2]} if qs else None
