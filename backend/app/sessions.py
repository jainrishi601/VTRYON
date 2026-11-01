"""Sessions, the shopper photo (validation + storage), sample models."""

import hashlib
import io
import json
import secrets

from PIL import Image, ImageOps

from app import config, dna
from app.db import ex, new_id, now, q, q1
from app.youcam import Src


class PhotoInvalid(Exception):
    pass


def models() -> list[dict]:
    p = config.MODELS_DIR / "models.json"
    rows = json.loads(p.read_text()) if p.exists() else []
    return [{"id": m["id"], "gender": m["gender"], "label": m.get("label", m["id"]), "file": m["file"],
             "image_url": f"/media/models/{m['file']}"} for m in rows]


def model(model_id: str) -> dict | None:
    return next((m for m in models() if m["id"] == model_id), None)


def save_photo(data: bytes) -> tuple[str, str]:
    """Validate and store a shopper photo. Returns (photo_url, src_key). Raises PhotoInvalid with user copy."""
    if len(data) > 10 * 1024 * 1024:
        raise PhotoInvalid("That photo is over 10 MB. Try a smaller JPG or PNG.")
    try:
        im = Image.open(io.BytesIO(data))
        fmt = im.format
        im = ImageOps.exif_transpose(im).convert("RGB")
    except Exception:
        raise PhotoInvalid("That file isn't a photo we can use. Try a JPG or PNG.") from None
    if fmt not in ("JPEG", "PNG", "MPO"):
        raise PhotoInvalid("That file isn't a photo we can use. Try a JPG or PNG.")
    if min(im.size) < 384 or max(im.size) < 512:
        raise PhotoInvalid("That photo is too small. Try one at least 512 px tall.")
    if max(im.size) > 4096:
        im.thumbnail((4096, 4096))
    sha = hashlib.sha256(data).hexdigest()
    url = f"/media/photos/{sha}.jpg"
    dest = config.media_path(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        im.save(dest, "JPEG", quality=92)
    return url, f"photo:{sha}"


def model_photo(model_id: str) -> tuple[str, str]:
    m = model(model_id)
    if not m:
        raise PhotoInvalid("That sample model isn't available.")
    return m["image_url"], f"model:{model_id}"


def src_for(photo_url: str | None, src_key: str | None) -> Src | None:
    return Src(key=src_key, path=config.media_path(photo_url)) if photo_url and src_key else None


def get_session(sid: str) -> dict | None:
    s = q1("select * from sessions where id=?", sid)
    if s:
        s["brief"] = s["brief"] or None
    return s


def session_user_token(sid: str) -> str | None:
    s = q1("select user_token from sessions where id=?", sid)
    return s["user_token"] if s else None


def scope(sess: dict | None) -> str | None:
    """Recipient profiles scope taste edges so a gift doesn't bend the shopper's own DNA."""
    b = (sess or {}).get("brief") or {}
    if b.get("for") == "other":
        return f"recipient:{(b.get('recipient') or {}).get('relation') or 'someone'}".lower()
    return None


def gender(sess: dict | None) -> str | None:
    """The wearer's gender (women | men | both | None). For a gift that is the recipient's, never the shopper's."""
    b = (sess or {}).get("brief") or {}
    if b.get("for") == "other":
        return (b.get("recipient") or {}).get("gender")
    return b.get("gender")


def photo_gender(sess: dict | None) -> str | None:
    """Which clothes the session photo can wear: a sample model's own gender, else what the shopper told us."""
    s = sess or {}
    if (s.get("src_url") or "").startswith("model:"):
        m = model(s["src_url"][6:])
        return m["gender"] if m else None
    return s.get("photo_gender")


# Chip values for recipients whose gender is implied (the same table the onboarding chips use).
RELATION_GENDER = {"brother": "men", "boyfriend": "men", "husband": "men", "dad": "men", "father": "men",
                   "son": "men", "sister": "women", "girlfriend": "women", "wife": "women", "mum": "women",
                   "mom": "women", "mother": "women", "daughter": "women"}
_UNSET = object()


def update_brief(sid: str, *, for_: str | None = None, relation: str | None = None, gender_: str | None = None,
                 occasion: str | None = None, budget=_UNSET) -> dict:
    """Merge known facts into the session brief. None means 'no change'; budget=None means 'no limit'."""
    s = get_session(sid) or {}
    b = dict(s.get("brief") or {})
    b.setdefault("for", "self")
    if for_ == "self":
        b["for"] = "self"
    if for_ == "other" or relation:
        b["for"] = "other"
        rec = dict(b.get("recipient") or {})
        if relation:
            rel = relation.strip().lower()
            if rel != rec.get("relation"):  # a different person: their gender isn't known from the last one
                rec = {"relation": rel, **({"gender": RELATION_GENDER[rel]} if rel in RELATION_GENDER else {})}
        b["recipient"] = rec
    if gender_ in ("women", "men", "both"):
        if b["for"] == "other":
            if gender_ != "both":
                b["recipient"] = {**(b.get("recipient") or {}), "gender": gender_}
        else:
            b["gender"] = gender_
    if occasion and occasion.strip():
        b["occasion"] = occasion.strip()
    if budget is not _UNSET:
        b["budget_max"] = budget
    ex("update sessions set brief=? where id=?", b, sid)
    return b


BASICS = ("wearer", "gender", "occasion", "budget")


def confirm(sid: str, fields) -> None:
    """Mark brief fields as stated by the shopper in this chat. A carried-over brief (an earlier chat) starts
    unconfirmed, so Ava asks the basics again with the remembered value first, instead of assuming it."""
    s = get_session(sid) or {}
    have = set(s.get("confirmed") or [])
    new = have | {f for f in fields if f in BASICS}
    if new != have:
        ex("update sessions set confirmed=? where id=?", sorted(new), sid)


def confirmed(sess: dict | None) -> set[str]:
    return set((sess or {}).get("confirmed") or [])


def apply_answers(sid: str, answers: list[dict]) -> None:
    """Question-card answers arrive structured ({field, value}), so they land in the brief without guessing."""
    for a in answers or []:
        field, value = a.get("field"), str(a.get("value") or "").strip()
        if not value:
            continue
        confirm(sid, [field, "gender"] if field == "wearer" and value.lower() in RELATION_GENDER else [field])
        if field == "gender":
            update_brief(sid, gender_=value.lower())
        elif field == "occasion":
            update_brief(sid, occasion=value)
        elif field == "budget":
            digits = value.replace("₹", "").replace(",", "").strip()
            if value.lower() in ("none", "no limit", "any"):
                update_brief(sid, budget=None)
            elif digits.isdigit():
                update_brief(sid, budget=int(digits))
        elif field == "fit" and value.lower() in ("relaxed", "regular", "fitted"):
            s = get_session(sid) or {}
            ex("update sessions set brief=? where id=?", {**(s.get("brief") or {"for": "self"}), "fit": value.lower()},
               sid)
        # style / detail answers shape this one request; they travel in the message text, not the profile.
        elif field == "wearer":
            if value.lower() in ("self", "me", "myself"):
                update_brief(sid, for_="self")
            else:
                update_brief(sid, relation=value)


def create(user_token: str | None = None, store_id="northline") -> tuple[dict, bool, dict | None]:
    """Returns (session, returning, profile). A returning token carries over its last brief and photo."""
    token = user_token or secrets.token_urlsafe(18)[:24]
    last = q1("select * from sessions where user_token=? order by created_at desc limit 1", token)
    sid = new_id("s_", 16)
    ex("insert into sessions(id, user_token, store_id, brief, photo_url, src_url, sample_model_id, photo_gender, "
       "created_at) values (?,?,?,?,?,?,?,?,?)", sid, token, store_id, last and last["brief"],
       last and last["photo_url"], last and last["src_url"], last and last["sample_model_id"],
       last and last.get("photo_gender"), now())
    _seed_from_tryon(sid, token)
    returning = bool(last and last["brief"])
    profile = None
    if returning:
        profile = {"brief": last["brief"], "dna": dna.summary(token, scope(last)),
                   "last_occasion": (last["brief"] or {}).get("occasion")}
    return get_session(sid), returning, profile


def _seed_from_tryon(sid: str, token: str) -> None:
    """A shopper with a TRYON profile told us their gender and gave a full-body photo during onboarding: every new
    widget chat starts with both (gender counts as stated, so Ava doesn't ask it again)."""
    from app import tryon
    prof = tryon.for_token(token)
    if not prof:
        return
    s = get_session(sid) or {}
    b = dict(s.get("brief") or {"for": "self"})
    if prof.get("gender") in ("women", "men", "both") and not b.get("gender"):
        b["gender"] = prof["gender"]
        ex("update sessions set brief=? where id=?", b, sid)
    if b.get("gender") == prof.get("gender"):
        confirm(sid, ["gender"])
    if not s.get("photo_url") and prof.get("body_url") and prof.get("body_key"):
        g = prof.get("gender") if prof.get("gender") in ("women", "men") else None
        ex("update sessions set photo_url=?, src_url=?, photo_gender=? where id=?", prof["body_url"], prof["body_key"],
           g, sid)


def session_json(s: dict) -> dict:
    return {"id": s["id"], "user_token": s["user_token"], "brief": s["brief"], "photo_url": s["photo_url"],
            "sample_model_id": s["sample_model_id"], "photo_gender": photo_gender(s),
            "dna": dna.summary(s["user_token"], scope(s))}


def forget(user_token: str) -> None:
    """'Forget me': taste graph, sessions, looks, chat, photos and every render derived from those photos."""
    sess = q("select * from sessions where user_token=?", user_token)
    keys = {s["src_url"] for s in sess if (s["src_url"] or "").startswith("photo:")}
    keys |= {m["src_url"] for m in q("select src_url from crew_members where member_token=?", user_token)
             if (m["src_url"] or "").startswith("photo:")}
    frontier = set(keys)
    while frontier:  # chained renders use the previous step's cache key as their source
        rows = q(f"select cache_key, local_path from renders where src_key in ({','.join('?' * len(frontier))})",
                 *frontier)
        for r in rows:
            if r["local_path"]:
                config.media_path(r["local_path"]).unlink(missing_ok=True)
        frontier = {r["cache_key"] for r in rows} - keys
        keys |= frontier
    for k in keys:
        ex("delete from renders where cache_key=? or src_key=?", k, k)
        ex("delete from uploads where src_key=?", k)
        if k.startswith("photo:"):
            config.media_path(f"/media/photos/{k[6:]}.jpg").unlink(missing_ok=True)
    for s in sess:
        for lk in q("select id from looks where session_id=?", s["id"]):
            ex("delete from crew_looks where look_id=?", lk["id"])
        ex("delete from looks where session_id=?", s["id"])
        ex("delete from messages where session_id=?", s["id"])
        ex("delete from tiles where session_id=?", s["id"])
    ex("update crew_members set photo_url=null, src_url=null where member_token=?", user_token)
    ex("delete from sessions where user_token=?", user_token)
    ex("delete from edges where user_token=?", user_token)
    ex("delete from nodes where user_token=?", user_token)
