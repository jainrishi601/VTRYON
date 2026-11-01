"""TRYON platform (Part A): shopper accounts, the onboarding profile, colour analysis, vibe looks, the never list and
the wardrobe. A profile shares its `user_token` with the store widget, so everything here shapes the widget's Style
DNA, gender, photo and "Pairs best with" straight away."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import logging
import secrets

import anthropic
from PIL import Image, ImageOps

from app import catalog, config, dna, looks, scoring, sessions
from app.db import ex, new_id, now, q, q1

log = logging.getLogger("elara.tryon")

# ---------------------------------------------------------------------------------------------------------- accounts

class AuthError(Exception):
    pass


def _hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


def _session(user_id: str) -> str:
    tok = secrets.token_urlsafe(32)
    ex("insert into auth_sessions(token, user_id, created_at) values (?,?,?)", tok, user_id, now())
    return tok


def signup(name: str, email: str, password: str, user_token: str | None = None) -> tuple[str, dict]:
    """New account. Adopts the browser's widget token when it isn't already someone's, so earlier taste carries over."""
    email = email.strip().lower()
    if "@" not in email or len(password) < 6:
        raise AuthError("Use a real email and a password of at least 6 characters.")
    if q1("select 1 from users where email=?", email):
        raise AuthError("That email already has an account. Log in instead.")
    token = user_token if user_token and not q1("select 1 from users where user_token=?", user_token) else None
    token = token or secrets.token_urlsafe(18)[:24]
    salt = secrets.token_hex(16)
    uid = new_id("u_", 12)
    ex("insert into users(id, email, name, pw_salt, pw_hash, user_token, created_at) values (?,?,?,?,?,?,?)",
       uid, email, name.strip() or email.split("@")[0], salt, _hash(password, salt), token, now())
    ex("insert into profiles(user_id, data, updated_at) values (?,?,?)", uid, {}, now())
    return _session(uid), user(uid)


def login(email: str, password: str) -> tuple[str, dict]:
    u = q1("select * from users where email=?", email.strip().lower())
    if not u or not hmac.compare_digest(u["pw_hash"], _hash(password, u["pw_salt"])):
        raise AuthError("That email and password don't match.")
    return _session(u["id"]), user(u["id"])


def from_auth(token: str | None) -> dict | None:
    s = q1("select user_id from auth_sessions where token=?", token) if token else None
    return user(s["user_id"]) if s else None


def logout(token: str) -> None:
    ex("delete from auth_sessions where token=?", token)


def user(uid: str) -> dict | None:
    u = q1("select id, email, name, user_token, created_at from users where id=?", uid)
    if u:
        u["profile"] = profile(uid)
    return u


# ----------------------------------------------------------------------------------------------------------- profile

GOALS = ("build", "utilise", "mindful")
SIZES = ("XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL")


def profile(uid: str) -> dict:
    row = q1("select data from profiles where user_id=?", uid)
    return (row or {}).get("data") or {}


def save_profile(uid: str, patch: dict) -> dict:
    """Merge onboarding answers. Known keys only; facts the widget uses are mirrored into the shopper's DNA."""
    keep = {"goal", "gender", "profession", "age_range", "sizes", "height_cm", "weight_kg", "colors", "never",
            "onboarded", "step"}
    data = {**profile(uid), **{k: v for k, v in patch.items() if k in keep}}
    ex("insert into profiles(user_id, data, updated_at) values (?,?,?) on conflict(user_id) do update set "
       "data=excluded.data, updated_at=excluded.updated_at", uid, data, now())
    u = q1("select user_token from users where id=?", uid)
    tok = u["user_token"]
    if "colors" in patch:  # picked colours become colour likes (by catalogue colour family) in the DNA
        _replace_edges(tok, "picked_color", "color", {PALETTE[c]["family"] for c in patch["colors"] or [] if c in PALETTE},
                       0.6)
    if "never" in patch:
        _replace_edges(tok, "never", None, set(), 0)
        for v in patch["never"] or []:
            kind, _, value = str(v).partition(":")
            if kind in ("pattern", "category", "color") and value:
                dna.add_edge(tok, "never", kind, value, 0.0)
    return data


def _replace_edges(tok: str, edge_type: str, kind: str | None, values: set, weight: float) -> None:
    ex("delete from edges where user_token=? and type=? and scope is null", tok, edge_type)
    for v in values:
        dna.add_edge(tok, edge_type, kind, v, weight)


def for_token(user_token: str | None) -> dict | None:
    """The onboarding profile behind a widget token (None for a shopper without a TRYON account)."""
    u = q1("select id from users where user_token=?", user_token) if user_token else None
    return {**profile(u["id"]), "user_id": u["id"]} if u else None


# ----------------------------------------------------------------------------------------------------------- photos

def photo_session(uid: str) -> dict:
    """The TRYON-side session that owns this shopper's photo and vibe looks (the widget makes its own per chat)."""
    data = profile(uid)
    s = sessions.get_session(data.get("session_id") or "")
    if s:
        return s
    tok = q1("select user_token from users where id=?", uid)["user_token"]
    s, _, _ = sessions.create(tok)
    save_profile_raw(uid, {"session_id": s["id"]})
    return s


def save_profile_raw(uid: str, patch: dict) -> None:
    data = {**profile(uid), **patch}
    ex("update profiles set data=?, updated_at=? where user_id=?", data, now(), uid)


def set_photo(uid: str, kind: str, data: bytes) -> dict:
    """kind: selfie (colour analysis) | body (try-on). Validated like the widget's photo."""
    url, key = sessions.save_photo(data)
    if kind == "selfie":
        save_profile_raw(uid, {"selfie_url": url})
    else:
        g = profile(uid).get("gender")
        s = photo_session(uid)
        ex("update sessions set photo_url=?, src_url=?, sample_model_id=null, photo_gender=? where id=?", url, key,
           g if g in ("women", "men") else None, s["id"])
        save_profile_raw(uid, {"body_url": url, "body_key": key})
    return profile(uid)


# ---------------------------------------------------------------------------------------------- colour analysis

# Named shades, each mapped to the catalogue colour family the DNA and the stylist search use.
PALETTE = {
    "Ivory": {"hex": "#F3EEDC", "family": "white"}, "White": {"hex": "#FFFFFF", "family": "white"},
    "Beige": {"hex": "#D9C7A7", "family": "beige"}, "Camel": {"hex": "#C19A6B", "family": "brown"},
    "Chocolate": {"hex": "#5A3A24", "family": "brown"}, "Olive": {"hex": "#6B7A3A", "family": "green"},
    "Sage": {"hex": "#9CAF88", "family": "green"}, "Forest": {"hex": "#2E5E3A", "family": "green"},
    "Mint": {"hex": "#A8E6CF", "family": "green"}, "Teal": {"hex": "#138A86", "family": "blue"},
    "Sky": {"hex": "#8EC5E8", "family": "blue"}, "Cobalt": {"hex": "#2156A5", "family": "blue"},
    "Navy": {"hex": "#1C2A4A", "family": "blue"}, "Grey": {"hex": "#8C8C8C", "family": "grey"},
    "Charcoal": {"hex": "#36393E", "family": "grey"}, "Black": {"hex": "#111111", "family": "black"},
    "Blush": {"hex": "#F2C4CE", "family": "pink"}, "Rose": {"hex": "#D77A8C", "family": "pink"},
    "Fuchsia": {"hex": "#C2185B", "family": "pink"}, "Red": {"hex": "#C62828", "family": "red"},
    "Burgundy": {"hex": "#7B1E2E", "family": "red"}, "Rust": {"hex": "#B7472A", "family": "orange"},
    "Coral": {"hex": "#F07B5E", "family": "orange"}, "Mustard": {"hex": "#D4A017", "family": "yellow"},
    "Lemon": {"hex": "#F4E04D", "family": "yellow"}, "Lilac": {"hex": "#B9A2D0", "family": "purple"},
    "Plum": {"hex": "#5E2B5C", "family": "purple"},
}
NEUTRAL_START = ["Ivory", "Beige", "Navy", "Olive", "Grey", "Black", "Camel", "Sky"]

_client: anthropic.AsyncAnthropic | None = None


def _ai() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY, max_retries=2, timeout=40)
    return _client


def _image_block(path, max_side=1568) -> dict:
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88)
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                        "data": base64.standard_b64encode(buf.getvalue()).decode()}}


async def _tool_call(prompt: str, image_path, tool: dict) -> dict | None:
    """One Claude vision call that should answer through `tool`. None when there's no key or it didn't."""
    if not config.ANTHROPIC_API_KEY:
        return None
    try:
        msg = await _ai().messages.create(
            model=config.AGENT_MODEL, max_tokens=4000, tools=[tool],
            messages=[{"role": "user", "content": [_image_block(image_path), {"type": "text", "text": prompt}]}])
    except Exception as e:  # never dead-end onboarding on a model error
        log.warning("tryon vision call failed: %r", e)
        return None
    use = next((b for b in msg.content if b.type == "tool_use" and b.name == tool["name"]), None)
    return dict(use.input) if use else None


PALETTE_TOOL = {
    "name": "report_palette", "strict": True,
    "description": "Report the person's colouring and the shades from the fixed list that flatter them most.",
    "input_schema": {"type": "object", "additionalProperties": False, "required": ["undertone", "summary", "recommended"],
                     "properties": {
                         "undertone": {"type": "string", "enum": ["warm", "cool", "neutral"]},
                         "summary": {"type": "string", "description": "One short sentence, second person, why these "
                                                                     "shades work (skin, hair, contrast). No emoji."},
                         "recommended": {"type": "array", "items": {"type": "string", "enum": list(PALETTE)},
                                         "description": "8-12 shades from the list, best first."}}},
}


async def analyze_colors(uid: str) -> dict:
    """Selfie (or the full-body photo) -> undertone and recommended shades. Claude picks from a fixed palette, so every
    shade maps to a catalogue colour family; without a key or a photo the shopper starts from easy neutrals."""
    data = profile(uid)
    url = data.get("selfie_url") or data.get("body_url")
    out = None
    if url:
        out = await _tool_call(
            "Look at this person's skin undertone, hair and eye colour and overall contrast. Then call report_palette "
            "with the shades from the list that would flatter them most in clothing, best first.",
            config.media_path(url), PALETTE_TOOL)
    rec = [c for c in (out or {}).get("recommended") or [] if c in PALETTE][:12] or NEUTRAL_START
    res = {"undertone": (out or {}).get("undertone"), "summary": (out or {}).get("summary") or
           ("Easy neutrals to start; add any shade you love." if not out else ""), "recommended": rec,
           "analyzed": bool(out)}
    save_profile_raw(uid, {"palette": res})
    return res


# ------------------------------------------------------------------------------------------------------ vibe looks

VIBE_LINE = {"minimal": "Clean lines, quiet colour", "bold": "Statement colour and print", "classic": "Timeless, polished",
             "street": "Easy, urban, relaxed", "boho": "Flowing, earthy, free", "sporty": "Active comfort",
             "romantic": "Soft details, gentle colour", "edgy": "Sharp contrast, darker tones"}


def start_vibes(uid: str) -> list[dict]:
    """One look per vibe (8). With a full-body photo each renders on the shopper (2 units each, cached); without one the
    cards show the piece flat. Renders start here, in parallel."""
    s = photo_session(uid)
    data = profile(uid)
    g = data.get("gender") if data.get("gender") in ("women", "men") else "women"
    have = {t["vibe"]: t for t in q("select * from tiles where session_id=?", s["id"])}
    for vibe in config.VIBES:
        if vibe in have:
            continue
        p = dna.representative(vibe, g)
        if not p:
            continue
        lk = looks.create_look(s["id"], vibe.title(), VIBE_LINE.get(vibe, ""), [(p["slot"], p["id"])])
        ex("insert into tiles(id, session_id, vibe, product_id, look_id, created_at) values (?,?,?,?,?,?)",
           new_id("t_", 8), s["id"], vibe, p["id"], lk["id"], now())
        if data.get("body_url"):
            looks.start_render(lk["id"], memory=False)
    return vibes(uid)


def vibes(uid: str) -> list[dict]:
    s = photo_session(uid)
    out = []
    for t in looks.tiles_json(s["id"]):
        out.append({**t, "line": VIBE_LINE.get(t["vibe"], ""), "rendered": t["status"] == "ready",
                    "verdict": (profile(uid).get("vibe_votes") or {}).get(t["id"])})
    return out


def vote_vibe(uid: str, tile_id: str, verdict: str) -> dict:
    """love / like / dislike -> taste edges (love counts more than like)."""
    s = photo_session(uid)
    t = q1("select * from tiles where id=? and session_id=?", tile_id, s["id"])
    if not t:
        raise KeyError(tile_id)
    tok = s["user_token"]
    p = catalog.get(t["product_id"]) or {}
    dna.pick(tok, t["vibe"], p.get("color_family"), "cross" if verdict == "dislike" else "heart")
    if verdict == "love":
        dna.add_edge(tok, "loved", "vibe", t["vibe"], 0.8)
    votes = {**(profile(uid).get("vibe_votes") or {}), tile_id: verdict}
    save_profile_raw(uid, {"vibe_votes": votes})
    return {"dna": dna.summary(tok)}


# ------------------------------------------------------------------------------------------------------- never list

NEVER_OPTIONS = {
    "Patterns": [("pattern:floral", "Florals"), ("pattern:stripe", "Stripes"), ("pattern:check", "Checks"),
                 ("pattern:graphic", "Graphic prints"), ("pattern:polka", "Polka dots"), ("pattern:animal", "Animal print"),
                 ("pattern:colorblock", "Colour-block")],
    "Pieces": [("category:shorts", "Shorts"), ("category:skirt", "Skirts"), ("category:dress", "Dresses"),
               ("category:kurta", "Kurtas"), ("category:kaftan", "Kaftans"), ("category:camisole", "Camisoles"),
               ("category:tank_top", "Tank tops"), ("category:jumpsuit", "Jumpsuits")],
    "Colours": [(f"color:{f}", f.title()) for f in ("white", "beige", "black", "grey", "green", "red", "purple", "pink",
                                                     "brown", "yellow", "orange", "blue")],
}


# -------------------------------------------------------------------------------------------------------- wardrobe

WARDROBE_SLOTS = ["top", "bottom", "one_piece", "layer", "footwear", "bag", "accessory"]
ITEMS_TOOL = {
    "name": "report_items", "strict": True,
    "description": "Report every clothing item, shoe, bag and accessory visible in the photo, with its attributes.",
    "input_schema": {"type": "object", "additionalProperties": False, "required": ["items"], "properties": {"items": {
        "type": "array", "items": {"type": "object", "additionalProperties": False, "required": [
            "name", "slot", "category", "colors", "color_family", "pattern", "fabric", "vibes", "formality", "fit",
            "occasions", "season", "box"], "properties": {
            "name": {"type": "string", "description": "Short product-style name, e.g. \"Navy Linen Drawstring Trousers\"."},
            "slot": {"type": "string", "enum": WARDROBE_SLOTS},
            "category": {"type": "string", "description": "One lower-case word, e.g. shirt, trousers, dress, jacket."},
            "colors": {"type": "array", "items": {"type": "string"}, "description": "1-3 plain colour words."},
            "color_family": {"type": "string", "enum": ["white", "beige", "black", "grey", "green", "red", "purple",
                                                         "pink", "brown", "yellow", "orange", "blue"]},
            "pattern": {"type": "string", "enum": ["solid", "graphic", "floral", "stripe", "check", "textured",
                                                    "colorblock", "polka", "abstract", "animal"]},
            "fabric": {"type": "string", "description": "Best guess, e.g. cotton, linen, denim, leather; \"\" if unsure."},
            "vibes": {"type": "array", "items": {"type": "string", "enum": config.VIBES}, "description": "1-3 vibes."},
            "formality": {"type": "integer", "description": "1 loungewear ... 5 formal."},
            "fit": {"type": "string", "enum": ["relaxed", "regular", "fitted", "unknown"]},
            "occasions": {"type": "array", "items": {"type": "string"}, "description": "2-4, e.g. office, beach, date."},
            "season": {"type": "array", "items": {"type": "string", "enum": ["spring", "summer", "monsoon", "autumn",
                                                                             "winter"]}},
            "box": {"type": "array", "items": {"type": "number"}, "description": (
                "Where the item is in the photo as [x, y, width, height], each 0-1 of the image size; [] if it fills "
                "the photo.")}}}}}},
}


# Where each kind of piece sits on a person, as a vertical band (0 = top of the photo). A worn piece's crop is clipped
# to its band so a sweater crop doesn't carry the trouser waistband; small pieces with no usable box fall back to it.
BANDS = {"top": (0.0, 0.55), "layer": (0.0, 0.7), "bottom": (0.4, 1.0), "footwear": (0.82, 1.0)}
ACCESSORY_BANDS = [  # category words -> band, for a small piece whose box is missing or unusable
    (("earring", "hair", "clip", "pin", "headband", "hat", "cap", "sunglass", "glasses"), (0.0, 0.25)),
    (("necklace", "chain", "pendant", "choker", "scarf"), (0.1, 0.4)),
    (("belt",), (0.38, 0.62)),
]
SMALL = ("footwear", "accessory", "bag")


def crop_box(box, slot: str, category: str = "", others=()) -> tuple[float, float, float, float] | None:
    """The model's [x, y, w, h] (0-1) -> a padded crop (x0, y0, x1, y1), or None for 'use the whole photo'.
    Small pieces (shoes, jewellery, bags) never get the whole photo: a tiny box is padded generously, and a missing or
    broken box falls back to where that piece sits on a person. Worn pieces are clipped to their slot's band, and a
    top stops where the bottom below it starts. `others`: [(slot, box)] of the other pieces in the same photo."""
    small = slot in SMALL
    try:
        x, y, w, h = (float(v) for v in box)
        ok = 0 <= x < 1 and 0 <= y < 1 and 0.005 < w <= 1.05 and 0.005 < h <= 1.05
    except (TypeError, ValueError):
        ok = False
    if not ok:
        if not small:
            return None
        cat = (category or "").lower()
        band = next((b for words, b in ACCESSORY_BANDS if any(wd in cat for wd in words)), None)
        band = band or BANDS.get(slot) or (0.25, 0.85)
        return (0.0, band[0], 1.0, band[1])
    x1, y1 = min(1.0, x + w), min(1.0, y + h)
    if not small and w * h > 0.92:
        return None
    lo, hi = BANDS.get(slot, (0.0, 1.0))
    if slot in ("top", "layer"):  # stop above the waistband of a bottom detected below
        for s2, b2 in others:
            if s2 == "bottom" and len(b2 or []) == 4 and y < float(b2[1]) < y1:
                hi = min(hi, float(b2[1]) + 0.02)
    cy0, cy1 = max(y, lo), min(y1, hi)
    if cy1 - cy0 >= 0.5 * (y1 - y):  # a worn photo: clip to the band; a flat lay elsewhere keeps the box
        y, y1 = cy0, cy1
    # Padding scales with the piece: earrings get room to read, a dress doesn't swallow the room.
    px, py = max(0.02, 0.35 * (x1 - x)) if small else 0.03, max(0.02, 0.35 * (y1 - y)) if small else 0.03
    x0, y0, x1, y1 = max(0.0, x - px), max(0.0, y - py), min(1.0, x1 + px), min(1.0, y1 + py)
    if small:  # at least 12% of the frame each way, so a stud is still a picture
        (x0, x1), (y0, y1) = _grow(x0, x1), _grow(y0, y1)
    return (x0, y0, x1, y1)


def _grow(a: float, b: float, m: float = 0.12) -> tuple[float, float]:
    if b - a >= m:
        return a, b
    c = min(max((a + b) / 2, m / 2), 1 - m / 2)
    return c - m / 2, c + m / 2


def _crop(path, box, slot: str = "top", category: str = "", others=()) -> str | None:
    """Save the item's crop as its own wardrobe image (None: use the whole photo)."""
    cb = crop_box(box, slot, category, others)
    if not cb:
        return None
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    W, H = im.size
    c = im.crop((int(cb[0] * W), int(cb[1] * H), int(cb[2] * W), int(cb[3] * H)))
    buf = io.BytesIO()
    c.save(buf, "JPEG", quality=90)
    sha = hashlib.sha256(buf.getvalue()).hexdigest()
    url = f"/media/wardrobe/{sha}.jpg"
    dest = config.media_path(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(buf.getvalue())
    return url


async def add_wardrobe_photo(user_token: str, data: bytes) -> list[dict]:
    """A photo of one or more pieces -> wardrobe items Claude tagged in the catalogue's own fields (so the same
    compatibility score works on them). Without a key the piece is added untagged for the shopper to fill in."""
    url, _ = sessions.save_photo(data)
    path = config.media_path(url)
    out = await _tool_call(
        "This is a photo from someone's own wardrobe. Call report_items with every distinct clothing item, shoe, bag "
        "or accessory you can see, with its attributes. Skip the person; describe only what they wear or what is laid "
        "out.", path, ITEMS_TOOL)
    items = (out or {}).get("items") or [{"name": "New piece", "slot": "top", "category": "", "colors": [],
                                          "color_family": "", "pattern": "solid", "fabric": "", "vibes": [],
                                          "formality": 2, "fit": "unknown", "occasions": [], "season": [], "box": []}]
    made = []
    boxes = [(x.get("slot"), x.get("box")) for x in items]
    for it in items[:8]:
        slot = it.get("slot") if it.get("slot") in WARDROBE_SLOTS else "top"
        crop = len(items) > 1 or slot in SMALL  # one big piece alone in a photo is the photo
        img = (_crop(path, it.get("box"), slot, it.get("category") or "", [b for b in boxes if b[1] is not it.get("box")])
               if crop else None) or url
        wid = new_id("w_", 10)
        ex("insert into wardrobe(id, user_token, image_url, name, slot, category, colors, color_family, pattern, fabric, "
           "vibes, formality, fit, occasions, season, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", wid,
           user_token, img, (it.get("name") or "New piece")[:80], slot, (it.get("category") or "")[:30],
           [str(c)[:20] for c in it.get("colors") or []][:3], it.get("color_family") or "", it.get("pattern") or "solid",
           (it.get("fabric") or "")[:40], [v for v in it.get("vibes") or [] if v in config.VIBES][:3],
           max(1, min(5, int(it.get("formality") or 2))), it.get("fit") if it.get("fit") in ("relaxed", "regular",
                                                                                              "fitted") else None,
           [str(o)[:20] for o in it.get("occasions") or []][:4], it.get("season") or [], now())
        w = wardrobe_item(wid)
        for v in w["vibes"]:  # owning a piece is a quiet taste signal
            dna.add_edge(user_token, "owns", "vibe", v, 0.3)
        if w["color_family"]:
            dna.add_edge(user_token, "owns", "color", w["color_family"], 0.3)
        made.append(w)
    _wardrobe_changed(user_token)
    return made


def _wardrobe_changed(user_token: str) -> None:
    """Today's Daily Picks were built from the old wardrobe: drop them so the next GET builds them again."""
    ex("delete from daily_picks where user_id in (select id from users where user_token=?)", user_token)


def wardrobe_item(wid: str) -> dict | None:
    w = q1("select * from wardrobe where id=?", wid)
    if w:
        w["allow_styling"] = bool(w["allow_styling"])
        w["tagged"] = bool(w["category"] or w["vibes"])
    return w


def wardrobe(user_token: str) -> list[dict]:
    return [wardrobe_item(r["id"]) for r in q("select id from wardrobe where user_token=? order by created_at desc",
                                               user_token)]


def update_wardrobe(user_token: str, wid: str, patch: dict) -> dict:
    w = q1("select * from wardrobe where id=? and user_token=?", wid, user_token)
    if not w:
        raise KeyError(wid)
    fields = {"name", "slot", "category", "color_family", "pattern", "fabric", "fit", "formality", "allow_styling"}
    for k, v in patch.items():
        if k in fields:
            if k == "slot" and v not in WARDROBE_SLOTS:
                continue
            ex(f"update wardrobe set {k}=? where id=?", int(v) if k in ("allow_styling", "formality") else v, wid)
    _wardrobe_changed(user_token)
    return wardrobe_item(wid)


def delete_wardrobe(user_token: str, wid: str) -> None:
    ex("delete from wardrobe where id=? and user_token=?", wid, user_token)
    _wardrobe_changed(user_token)


def as_product(w: dict, gender: str | None) -> dict:
    """A wardrobe piece in the catalogue's shape, so scoring and the widget can treat it like any product."""
    return {"id": w["id"], "title": w["name"], "price": 0, "currency": "INR", "gender": gender or "unisex",
            "slot": w["slot"], "category": w["category"] or w["slot"], "colors": w["colors"] or [],
            "color_family": w["color_family"], "pattern": w["pattern"], "vibes": w["vibes"] or [],
            "formality": w["formality"] or 2, "fit": w["fit"], "occasions": w["occasions"] or [], "image_url": w["image_url"],
            "image_url_alt": None, "vto_ref_url": None, "vto_ready": False, "sizes_in_stock": [], "product_url": "",
            "owned": True, "statement_level": 2, "pairing": {"colors": [], "avoid": []}, "one_liner": "From your wardrobe",
            "description": "", "fabric": w["fabric"]}


def owned_pairs(user_token: str | None, items: list[dict], slot: str, occasion: str | None, taste: dict | None,
                gender: str | None, limit=2) -> list[dict]:
    """The shopper's own pieces for `slot`, scored with the rest of the look exactly like catalogue swaps."""
    if not user_token:
        return []
    rest = [it.get("product", it) for it in items if it.get("slot") != slot]
    current = {it.get("product", it).get("id") for it in items}
    out = []
    for w in wardrobe(user_token):
        if w["slot"] != slot or not w["allow_styling"] or not w["tagged"] or w["id"] in current:
            continue
        p = as_product(w, gender)
        s = scoring.score_look([*rest, p], occasion, taste)
        out.append({"product": p, "score": s["score"], "score_band": s["band"], "reason": "From your wardrobe",
                    "price_delta": 0, "owned": True})
    out.sort(key=lambda a: -a["score"])
    return out[:limit]


def wardrobe_line(user_token: str | None) -> str:
    """One line for the stylist's context: what the shopper already owns."""
    ws = [w for w in wardrobe(user_token) if w["allow_styling"] and w["tagged"]] if user_token else []
    if not ws:
        return ""
    by: dict[str, list[str]] = {}
    for w in ws:
        by.setdefault(w["slot"], []).append(w["name"])
    return "wardrobe (pieces the shopper owns; suggest pairing in words, never present them as products): " + "; ".join(
        f"{s}: {', '.join(n[:3])}{' +' + str(len(n) - 3) if len(n) > 3 else ''}" for s, n in by.items())


# ---------------------------------------------------------------------------------------------------- style DNA page

FACT_LABEL = {"gender": "Shops for", "profession": "Profession", "age_range": "Age", "goal": "Here to",
              "height_cm": "Height", "weight_kg": "Weight"}
GOAL_LABEL = {"build": "Build a new wardrobe", "utilise": "Get more from my wardrobe", "mindful": "Shop more mindfully"}


def dna_page(uid: str) -> dict:
    """Everything the Style DNA page shows: facts you told me, what I'm learning, the never list, your wardrobe,
    recent occasions, and the timeline."""
    u = q1("select user_token from users where id=?", uid)
    tok = u["user_token"]
    data = profile(uid)
    facts = []
    for k, label in FACT_LABEL.items():
        v = data.get(k)
        if v:
            v = {"women": "Women's", "men": "Men's", "both": "Women's and men's"}.get(v, v) if k == "gender" else v
            v = GOAL_LABEL.get(v, v) if k == "goal" else v
            facts.append({"key": k, "label": label, "value": f"{v} cm" if k == "height_cm" else f"{v} kg"
                          if k == "weight_kg" else str(v)})
    sz = data.get("sizes") or {}
    if any(sz.get(k) for k in ("tops", "bottoms", "dresses", "footwear")):
        facts.append({"key": "sizes", "label": "Sizes", "value": " · ".join(
            f"{k.title()} {sz[k]}" for k in ("tops", "bottoms", "dresses", "footwear") if sz.get(k))})
    if data.get("colors"):
        facts.append({"key": "colors", "label": "Colours you picked", "value": ", ".join(data["colors"][:8]),
                      "swatches": [PALETTE[c]["hex"] for c in data["colors"] if c in PALETTE]})
    tv = dna.taste_vector(tok)
    never = dna.never_list(tok)
    learning = [{"kind": k.split(":")[0], "value": k.split(":")[1], "weight": w}
                for k, w in sorted(tv.items(), key=lambda kv: -abs(kv[1])) if abs(w) >= 0.25][:14]
    rows = q("select e.type, e.weight, e.created_at, n.type kind, n.key value from edges e join nodes n "
             "on n.id=e.to_node where e.user_token=? and e.scope is null order by e.id desc limit 80", tok)
    occ = []
    for s in q("select brief from sessions where user_token=? order by created_at desc limit 20", tok):
        o = (s["brief"] or {}).get("occasion")
        if o and o not in occ:
            occ.append(o)
    ws = wardrobe(tok)
    counts: dict[str, int] = {}
    for w in ws:
        counts[w["slot"]] = counts.get(w["slot"], 0) + 1
    return {"name": dna.summary(tok).get("name"), "traits": dna.summary(tok).get("traits"), "facts": facts,
            "learning": learning, "never": never, "occasions": occ[:6], "wardrobe": counts,
            "palette": data.get("palette"), "timeline": rows}


def forget_attribute(uid: str, kind: str, value: str) -> None:
    tok = q1("select user_token from users where id=?", uid)["user_token"]
    ex("delete from edges where user_token=? and to_node in (select id from nodes where user_token=? and type=? and "
       "key=?)", tok, tok, kind, value)
    if kind in ("pattern", "category", "color"):
        data = profile(uid)
        if data.get("never"):
            save_profile_raw(uid, {"never": [n for n in data["never"] if n != f"{kind}:{value}"]})


def palette_json() -> list[dict]:
    return [{"name": k, **v} for k, v in PALETTE.items()]


def never_json() -> dict:
    return {g: [{"key": k, "label": lb} for k, lb in opts] for g, opts in NEVER_OPTIONS.items()}


def dumps(x) -> str:
    return json.dumps(x, ensure_ascii=False)


# ------------------------------------------------------------------------------------------------------ daily picks

import datetime as _dt  # noqa: E402
import random as _random  # noqa: E402
from itertools import product as _cartesian  # noqa: E402

PICKS = [  # kind, label, occasion for scoring, formality window, extra taste for the "trendy" one
    ("casual", "Casual pick", "everyday", (1, 2), ()),
    ("formal", "Formal pick", "office", (3, 4), ()),
    ("trendy", "Trendy pick", "party", (2, 4), ("bold", "street", "edgy")),
]
NEUTRAL_FAMILIES = {"white", "beige", "black", "grey", "brown", "blue"}


def _gender(uid: str) -> str:
    g = profile(uid).get("gender")
    return g if g in ("women", "men") else "women"


def _store_pool(tok: str, gender: str, slot: str, fwin: tuple[int, int], taste: dict, limit=18) -> list[dict]:
    never = {n.lower() for n in dna.never_list(tok)}
    c = [p for p in catalog.PRODUCTS.values()
         if p["slot"] == slot and catalog.gender_ok(p, gender) and p.get("vto_ready", True)
         and fwin[0] <= p.get("formality", 2) <= fwin[1] and not (never & catalog.attrs(p))]
    c.sort(key=lambda p: (-scoring.dna_score([p], taste), p["price"], p["id"]))
    return c[:limit]


def _compose(uid: str, rnd: _random.Random) -> list[dict]:
    """Three distinct outfits, wardrobe first: every owned piece is a candidate and scores a bonus; store pieces
    fill the slots the wardrobe can't. Scored with the same compatibility formula as the store stylist."""
    tok = q1("select user_token from users where id=?", uid)["user_token"]
    g = _gender(uid)
    taste = dna.taste_vector(tok)
    never = {n.lower() for n in dna.never_list(tok)}  # the never list holds for owned pieces too
    own = [p for w in wardrobe(tok) if w["allow_styling"] and w["tagged"]
           if not (never & catalog.attrs(p := as_product(w, g)))]
    extras = [p for p in own if p["slot"] in ("footwear", "bag", "accessory")]
    used: set[str] = set()
    out = []
    for kind, label, occasion, fwin0, lean in PICKS:
        def cands(slot, fwin):
            mine = [p for p in own if p["slot"] == slot and fwin[0] - 1 <= p["formality"] <= fwin[1] + 1]
            return mine + _store_pool(tok, g, slot, fwin, taste)
        combos: list[list[dict]] = []
        # A thin catalogue never drops a pick: widen the dress-level window until outfits exist.
        for fwin in (fwin0, (fwin0[0] - 1, fwin0[1] + 1), (1, 5)):
            combos = [list(c) for c in _cartesian(cands("top", fwin), cands("bottom", fwin))]
            if g == "women":
                combos += [[p] for p in cands("one_piece", fwin)]
            if any(not ({p["id"] for p in ps} & used) for ps in combos):
                break
        best, best_s = None, -1e9
        for ps in combos:
            if any(p["id"] in used for p in ps):
                continue
            s = scoring.score_look(ps, occasion, taste)["score"] + 7 * sum(1 for p in ps if p.get("owned"))
            if lean and any(v in lean for p in ps for v in p.get("vibes", [])):
                s += 8
            s += rnd.random() * 6  # Regenerate gives a different, still-good set
            if s > best_s:
                best, best_s = ps, s
        if not best:
            continue
        used |= {p["id"] for p in best}
        add: list[dict] = []
        for p in extras:  # up to two finishing pieces, one per slot: never two pairs of shoes
            if p["id"] not in used and p["slot"] not in {a["slot"] for a in add} and len(add) < 2:
                add.append(p)
        used |= {p["id"] for p in add}
        out.append({"kind": kind, "label": label, "occasion": occasion, "items": best + add})
    return out


NAMES_TOOL = {
    "name": "name_picks", "strict": True,
    "description": "Name each daily outfit and say in one line why it works.",
    "input_schema": {"type": "object", "additionalProperties": False, "required": ["picks"], "properties": {"picks": {
        "type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["name", "why", "tip"],
                                   "properties": {
                                       "name": {"type": "string", "description": "Two to three evocative words."},
                                       "why": {"type": "string", "description": "One concrete reason, <=24 words, second "
                                                                               "person, no prices, no emoji."},
                                       "tip": {"type": "string", "description": "One short finishing tip (shoes, "
                                                                               "jewellery, hair) or \"\"."}}}}}},
}


async def _name(picks: list[dict]) -> list[dict]:
    """Claude names the outfits and writes the why line; without a key the scoring reason stands in."""
    fallback = [{"name": " & ".join(dict.fromkeys(cap_word(p.get("color_family") or "") for p in pk["items"][:2]
                                                 if p.get("color_family"))) or pk["label"],
                 "why": scoring.score_look(pk["items"][:2], pk["occasion"], None)["reason"] + ".", "tip": ""}
                for pk in picks]
    if not config.ANTHROPIC_API_KEY or not picks:
        return fallback
    desc = "\n".join(f"{i + 1}. {pk['label']} ({pk['occasion']}): " + "; ".join(
        f"{p['title']}{' (their own)' if p.get('owned') else ''}" for p in pk["items"]) for i, pk in enumerate(picks))
    try:
        msg = await _ai().messages.create(model=config.AGENT_MODEL, max_tokens=1500, tools=[NAMES_TOOL], messages=[{
            "role": "user", "content": f"Today's outfits for a shopper, in order:\n{desc}\nCall name_picks with one entry "
                                       "per outfit, same order."}])
        use = next((b for b in msg.content if b.type == "tool_use"), None)
        got = (dict(use.input).get("picks") if use else None) or []
    except Exception as e:
        log.warning("daily pick naming failed: %r", e)
        got = []
    return [{**fb, **{k: v for k, v in (got[i] if i < len(got) else {}).items() if v}} for i, fb in enumerate(fallback)]


def cap_word(s: str) -> str:
    return s[:1].upper() + s[1:]


def _today() -> str:
    return _dt.date.today().isoformat()


async def daily(uid: str, regenerate: bool = False) -> list[dict]:
    """Today's three picks (made once a day, or again on Regenerate)."""
    day = _today()
    rows = q("select * from daily_picks where user_id=? and day=? order by rowid", uid, day)
    if rows and not regenerate:
        return [_pick_json(r) for r in rows]
    rnd_n = (max((r["round"] for r in rows), default=-1) + 1) if rows else 0
    picks = _compose(uid, _random.Random(f"{uid}:{day}:{rnd_n}"))
    names = await _name(picks)
    s = photo_session(uid)
    ex("delete from daily_picks where user_id=? and day=?", uid, day)
    for pk, nm in zip(picks, names, strict=True):
        lk = looks.create_look(s["id"], nm["name"], nm["why"], [(p["slot"], p["id"]) for p in pk["items"]],
                               tip=nm.get("tip"))
        ex("insert into daily_picks(user_id, day, kind, look_id, round, created_at) values (?,?,?,?,?,?)", uid, day,
           pk["kind"], lk["id"], rnd_n, now())
    return [_pick_json(r) for r in q("select * from daily_picks where user_id=? and day=? order by rowid", uid, day)]


def _pick_json(r: dict) -> dict:
    lk = looks.look_json(r["look_id"])
    label = next((lb for k, lb, *_ in PICKS if k == r["kind"]), r["kind"])
    store = [it for it in lk["items"] if not it["product"].get("owned")]
    return {"kind": r["kind"], "label": label, "feedback": r["feedback"], "look": lk,
            "owned": sum(1 for it in lk["items"] if it["product"].get("owned")),
            "can_try": any(it["slot"] in ("top", "bottom", "one_piece", "layer") for it in store)}


def pick_feedback(uid: str, look_id: str, kind: str) -> None:
    """Wore this / like / dislike on a daily pick -> taste edges on its vibes and colours."""
    r = q1("select * from daily_picks where user_id=? and look_id=?", uid, look_id)
    if not r:
        raise KeyError(look_id)
    tok = q1("select user_token from users where id=?", uid)["user_token"]
    ev = {"wore": "wore", "like": "liked_outfit", "dislike": "disliked_outfit"}[kind]
    dna.record_look_event(tok, looks.hydrate(q1("select items from looks where id=?", look_id)["items"]), ev)
    ex("update daily_picks set feedback=? where user_id=? and look_id=?", kind, uid, look_id)


# ------------------------------------------------------------------------------------------------------- style play

PLAY_DIMENSIONS = {
    "surface": ("Surface detail", ("Minimal detail", "A clean finish with little ornament"),
                ("Expressive detail", "Texture, print or considered ornament"),
                lambda p: p.get("statement_level", 2) <= 2 and p.get("pattern") == "solid",
                lambda p: p.get("statement_level", 2) >= 4 or p.get("pattern") in ("floral", "graphic", "abstract", "animal")),
    "colour": ("Colour", ("Quiet neutrals", "Whites, sands, navies and greys"), ("Colour forward", "One clear, confident colour"),
               lambda p: p.get("color_family") in NEUTRAL_FAMILIES, lambda p: p.get("color_family") not in NEUTRAL_FAMILIES),
    "fit": ("Fit", ("Relaxed", "Easy, with room to move"), ("Fitted", "Close, sharp lines"),
            lambda p: p.get("fit") == "relaxed", lambda p: p.get("fit") == "fitted"),
    "mood": ("Mood", ("Classic", "Timeless and polished"), ("Street", "Easy, urban, off-duty"),
             lambda p: "classic" in p.get("vibes", []), lambda p: "street" in p.get("vibes", []) or "edgy" in p.get("vibes", [])),
}
PLAY_CONTEXTS = {"everyday": ((1, 3), {"casual", "everyday", "weekend", "brunch"}),
                 "office": ((2, 4), {"office", "smart_casual", "formal"}),
                 "festive": ((3, 5), {"festive", "wedding", "celebration", "ceremonial", "party"})}


def play_pair(uid: str, context: str) -> dict | None:
    """Two pieces from the same slot and context that differ in one visible way. Flat product photos: no renders."""
    data = profile(uid)
    tok = q1("select user_token from users where id=?", uid)["user_token"]
    g = _gender(uid)
    fwin, occs = PLAY_CONTEXTS.get(context, PLAY_CONTEXTS["everyday"])
    seen = set(data.get("play_seen") or [])
    never = {n.lower() for n in dna.never_list(tok)}
    n_done = len(data.get("play_votes") or [])
    rnd = _random.Random(f"{uid}:{n_done}:{context}")
    slots = ["one_piece", "top"] if g == "women" else ["top", "bottom"]
    dims = list(PLAY_DIMENSIONS)
    for k in range(len(dims) * len(slots)):
        dim = dims[(n_done + k) % len(dims)]
        slot = slots[(n_done + k // len(dims)) % len(slots)]
        label, a_lab, b_lab, is_a, is_b = PLAY_DIMENSIONS[dim]
        pool = [p for p in catalog.PRODUCTS.values()
                if p["slot"] == slot and p.get("gender") in (g, "unisex") and fwin[0] <= p.get("formality", 2) <= fwin[1]
                and p["id"] not in seen and not (never & catalog.attrs(p)) and set(p.get("occasions") or []) & occs]
        A = [p for p in pool if is_a(p)]
        B = [p for p in pool if is_b(p) and not is_a(p)]
        if not A or not B:
            continue
        a = rnd.choice(A)
        b = min(B, key=lambda p: (p["category"] != a["category"], abs(p.get("formality", 2) - a.get("formality", 2)),
                                   abs(p["price"] - a["price"]), p["id"]))
        return {"id": f"{dim}:{a['id']}:{b['id']}", "dimension": dim, "label": label, "context": context,
                "question": f"Which feels more like you for {'the office' if context == 'office' else context}?",
                "answered": n_done,
                "a": {"product": a, "title": a_lab[0], "sub": a_lab[1]}, "b": {"product": b, "title": b_lab[0], "sub": b_lab[1]}}
    return None


def play_vote(uid: str, pair_id: str, choice: str) -> dict:
    """a / b / both / neither / unsure -> light taste edges on the two pieces' vibes and colours."""
    dim, a_id, b_id = (pair_id.split(":") + ["", ""])[:3]
    a, b = catalog.get(a_id), catalog.get(b_id)
    if not a or not b or dim not in PLAY_DIMENSIONS:
        raise KeyError(pair_id)
    tok = q1("select user_token from users where id=?", uid)["user_token"]
    w = {"a": (0.5, -0.25), "b": (-0.25, 0.5), "both": (0.25, 0.25), "neither": (-0.25, -0.25)}.get(choice)
    if w:
        for p, wt in ((a, w[0]), (b, w[1])):
            for v in p.get("vibes", []):
                dna.add_edge(tok, "play", "vibe", v, wt)
            if p.get("color_family"):
                dna.add_edge(tok, "play", "color", p["color_family"], wt * 0.6)
    data = profile(uid)
    save_profile_raw(uid, {"play_seen": ((data.get("play_seen") or []) + [a_id, b_id])[-300:],
                           "play_votes": ((data.get("play_votes") or []) + [{"pair": pair_id, "choice": choice}])[-300:]})
    return {"dna": dna.summary(tok)}


def recent_looks(uid: str, limit=12) -> list[dict]:
    """Looks the shopper got from the store stylist (not onboarding tiles or daily picks)."""
    u = q1("select user_token from users where id=?", uid)
    ps = profile(uid).get("session_id") or ""
    rows = q("select l.id from looks l join sessions s on s.id=l.session_id where s.user_token=? and s.id<>? "
             "and not exists (select 1 from looks c where c.parent_look_id=l.id) "  # latest of each swap chain
             "order by l.created_at desc limit ?", u["user_token"], ps, limit)
    return [lk for r in rows if (lk := looks.look_json(r["id"]))]
