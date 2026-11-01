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
    b = (sess or {}).get("brief") or {}
    g = (b.get("recipient") or {}).get("gender") if b.get("for") == "other" else b.get("gender")
    return g or b.get("gender")


def create(user_token: str | None = None, store_id="northline") -> tuple[dict, bool, dict | None]:
    """Returns (session, returning, profile). A returning token carries over its last brief and photo."""
    token = user_token or secrets.token_urlsafe(18)[:24]
    last = q1("select * from sessions where user_token=? order by created_at desc limit 1", token)
    sid = new_id("s_", 16)
    ex("insert into sessions(id, user_token, store_id, brief, photo_url, src_url, sample_model_id, created_at) "
       "values (?,?,?,?,?,?,?,?)", sid, token, store_id, last and last["brief"], last and last["photo_url"],
       last and last["src_url"], last and last["sample_model_id"], now())
    returning = bool(last and last["brief"])
    profile = None
    if returning:
        profile = {"brief": last["brief"], "dna": dna.summary(token, scope(last)),
                   "last_occasion": (last["brief"] or {}).get("occasion")}
    return get_session(sid), returning, profile


def session_json(s: dict) -> dict:
    return {"id": s["id"], "user_token": s["user_token"], "brief": s["brief"], "photo_url": s["photo_url"],
            "sample_model_id": s["sample_model_id"], "dna": dna.summary(s["user_token"], scope(s))}


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
