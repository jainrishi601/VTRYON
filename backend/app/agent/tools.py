"""Tool schemas (static, sorted, strict) and their executors. The model only ever sees opaque refs (c_N);
code maps them back to product ids and validates every look before anything reaches the shopper."""

from __future__ import annotations

from app import catalog, dna

SLOTS = ["top", "bottom", "one_piece", "layer", "bag", "accessory"]
VIBES = ["minimal", "bold", "classic", "street", "boho", "sporty", "romantic", "edgy"]
SLOT_PLURAL = {"top": "tops", "bottom": "bottoms", "one_piece": "one-pieces", "layer": "layers",
               "bag": "bags", "accessory": "accessories"}
MAX_LOOKS = 3


def _obj(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


_STR = {"type": "string"}
_STRS = {"type": "array", "items": {"type": "string"}}

TOOLS = [
    {
        "name": "ask_clarification",
        "description": (
            "Ask the shopper ONE short question with 2-4 tap-able chip answers, then end the turn. Call this only "
            "when the occasion is unknown, or the wearer's gender is unknown and can't be inferred, or the shopper "
            "implied a budget cap without a number. Never ask for anything <shopper> or the chat already answers."
        ),
        "strict": True,
        "input_schema": _obj({
            "question": {**_STR, "description": "One sentence, second person, no exclamation marks."},
            "chips": {**_STRS, "description": "2-4 short answers, e.g. [\"Women\", \"Men\", \"Show me both\"]."},
        }, ["question", "chips"]),
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
                    "over_budget": {"type": "boolean", "description": (
                        "true only when you deliberately show a look above the budget because nothing in budget "
                        "works, and your message says so.")},
                }, ["name", "item_refs", "why", "over_budget"]),
            },
            "modifies_look_id": {"type": ["string", "null"], "description": (
                "The lk_ id of the look being edited (follow-ups), else null.")},
            "budget_per_look": {"type": ["integer", "null"], "description": (
                "Per-look budget in rupees if the shopper stated a new one in this chat that replaces the brief's, "
                "else null.")},
            "wearer_is_minor": {"type": "boolean", "description": "true if the wearer is under 18."},
        }, ["message", "looks", "modifies_look_id", "budget_per_look", "wearer_is_minor"]),
    },
    {
        "name": "remember_preference",
        "description": (
            "Save a lasting taste preference the shopper stated explicitly, e.g. \"never show me yellow\" "
            "(kind=never, attribute=color, value=yellow), \"I hate prints\" (never, pattern, print), \"I love "
            "linen\" (like, fabric, linen). Not for one-off requests like \"in blue this time\". Non-terminal: "
            "continue the turn after calling it."
        ),
        "strict": True,
        "input_schema": _obj({
            "kind": {"type": "string", "enum": ["never", "like", "dislike"]},
            "attribute": {"type": "string", "enum": ["color", "vibe", "category", "fabric", "pattern"]},
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
            "query": {**_STR, "description": "Garment + colour + fabric in plain words, e.g. \"linen shirt sage\"."},
            "colors": {**_STRS, "description": "Colour words to prefer, e.g. [\"navy\", \"blue\"]. [] for any."},
            "vibes": {"type": "array", "items": {"type": "string", "enum": VIBES}, "description": "[] for any."},
            "max_price": {"type": ["integer", "null"], "description": "Max price of this piece in rupees."},
            "formality_min": {"type": ["integer", "null"], "description": "1-5"},
            "formality_max": {"type": ["integer", "null"], "description": "1-5"},
            "exclude_refs": {**_STRS, "description": "Refs to leave out (rejected or already used)."},
            "limit": {"type": ["integer", "null"], "description": "Default 10, max 15."},
        }, ["slot", "gender", "query", "colors", "vibes", "max_price", "formality_min", "formality_max",
            "exclude_refs", "limit"]),
    },
]
TERMINAL = {"present_looks", "ask_clarification"}


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
    items, note = catalog.search(
        inp["slot"], inp["gender"], query=inp.get("query") or "", colors=inp.get("colors") or None,
        vibes=inp.get("vibes") or None, max_price=inp.get("max_price"), formality_min=inp.get("formality_min"),
        formality_max=inp.get("formality_max"), exclude_ids=tuple(x for x in exclude if x), never=tuple(t.never),
        taste=t.taste, limit=limit,
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
    kind, attr, value = inp["kind"], inp["attribute"], str(inp["value"]).strip().lower()
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
            p = catalog.get(pid) if pid in t.visible else None
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
