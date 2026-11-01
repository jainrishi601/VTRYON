"""Style Crew: shared looks, member re-renders, per-item comments/reactions, verdicts, share image."""

import hashlib
import io
import secrets
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont, ImageOps

from app import config, dna, looks, sessions
from app.db import ex, new_id, now, q, q1


def _member(crew_id, token) -> dict | None:
    return q1("select * from crew_members where crew_id=? and member_token=?", crew_id, token) if token else None


def _add_member(crew_id, token, name, photo_url=None, src_key=None, is_owner=False) -> dict:
    mid = new_id("m_", 10)
    ex("insert into crew_members(id, crew_id, member_token, display_name, photo_url, src_url, is_owner, created_at) "
       "values (?,?,?,?,?,?,?,?)", mid, crew_id, token, name, photo_url, src_key, int(is_owner), now())
    return q1("select * from crew_members where id=?", mid)


def create_or_reuse(session_id: str, look_id: str, name: str | None = None, display_name: str | None = None) -> str:
    sess = sessions.get_session(session_id)
    crew = q1("select id from crews where owner_session_id=?", session_id)
    if crew:
        cid = crew["id"]
    else:
        cid = secrets.token_urlsafe(12)[:16]
        occ = (sess.get("brief") or {}).get("occasion") or ""
        ex("insert into crews(id, name, occasion, owner_session_id, created_at) values (?,?,?,?,?)",
           cid, name or (f"{occ} crew".strip().capitalize() if occ else "Style crew"), occ, session_id, now())
        _add_member(cid, sess["user_token"], display_name or "Host", sess["photo_url"], sess["src_url"], True)
    add_look(cid, look_id)
    return cid


def add_look(crew_id: str, look_id: str) -> None:
    ex("insert or ignore into crew_looks(crew_id, look_id, added_at) values (?,?,?)", crew_id, look_id, now())
    for m in q("select * from crew_members where crew_id=? and photo_url is not null", crew_id):
        _member_render(crew_id, look_id, m)


def join(crew_id: str, display_name: str, photo_url=None, src_key=None) -> dict:
    m = _add_member(crew_id, secrets.token_urlsafe(18)[:24], display_name.strip()[:40] or "Guest", photo_url, src_key)
    if photo_url:
        for cl in q("select look_id from crew_looks where crew_id=? order by added_at, rowid", crew_id):
            _member_render(crew_id, cl["look_id"], m)
    return m


def _member_render(crew_id, look_id, m) -> None:
    """Re-render a crew look on a member's photo, in a per-member session. Same photo + look = cache hit."""
    lk = q1("select * from looks where id=?", look_id)
    if not lk or q1("select 1 from crew_member_renders where crew_id=? and look_id=? and member_id=?",
                    crew_id, look_id, m["id"]):
        return
    owner = q1("select user_token from sessions where id=?", lk["session_id"])
    if owner and owner["user_token"] == m["member_token"]:
        return  # the look itself is already on this member's photo
    sid = f"m_{m['id']}"
    if not q1("select 1 from sessions where id=?", sid):
        ex("insert into sessions(id, user_token, store_id, photo_url, src_url, created_at) values (?,?,?,?,?,?)",
           sid, m["member_token"], "crew", m["photo_url"], m["src_url"], now())
    copy = looks.create_look(sid, lk["name"], lk["why"], lk["items"], budget_max=lk["budget_max"])
    ex("insert into crew_member_renders(crew_id, look_id, member_id, look_render_id) values (?,?,?,?)",
       crew_id, look_id, m["id"], copy["id"])
    looks.start_render(copy["id"], memory=False)


def comment(crew_id, member_token, look_id, slot=None, text=None, reaction=None) -> dict:
    m = _member(crew_id, member_token)
    if not m or not q1("select 1 from crew_looks where crew_id=? and look_id=?", crew_id, look_id):
        raise KeyError("not a member, or the look is not in this crew")
    cid = new_id("c_", 10)
    ex("insert into crew_comments(id, crew_id, look_id, slot, member_id, text, reaction, created_at) "
       "values (?,?,?,?,?,?,?,?)", cid, crew_id, look_id, slot, m["id"], (text or "").strip()[:500] or None,
       reaction, now())
    lk = q1("select * from looks where id=?", look_id)
    owner = sessions.get_session(lk["session_id"]) or {}
    if reaction in ("up", "down") and owner.get("user_token") != member_token:
        items = [it for it in looks.hydrate(lk["items"]) if slot is None or it["slot"] == slot]
        dna.record_look_event(owner["user_token"], items, "friend_liked" if reaction == "up" else "friend_disliked",
                              sessions.scope(owner))
    return _comment_json(q1("select c.*, m.display_name from crew_comments c join crew_members m on m.id=c.member_id "
                            "where c.id=?", cid))


def _comment_json(c) -> dict:
    return {k: c[k] for k in ("id", "look_id", "slot", "member_id", "display_name", "text", "reaction", "created_at")}


def _verdict(look_comments: list[dict], n_members: int) -> dict:
    votes = {}
    for c in look_comments:  # chronological: a member's look-level reaction wins; else net of their item reactions
        if c["reaction"] not in ("up", "down"):
            continue
        v = votes.setdefault(c["member_id"], {"look": None, "net": 0})
        if c["slot"] is None:
            v["look"] = c["reaction"]
        v["net"] += 1 if c["reaction"] == "up" else -1
    final = [v["look"] or ("up" if v["net"] > 0 else "down" if v["net"] < 0 else None) for v in votes.values()]
    up, down = final.count("up"), final.count("down")
    voters = up + down
    label = (f"{up} of {n_members} love it" if up else f"{down} of {n_members} want changes" if down
             else "No votes yet")
    return {"up": up, "down": down, "voters": voters, "label": label}


def crew_json(crew_id: str, member_token: str | None = None) -> dict | None:
    c = q1("select * from crews where id=?", crew_id)
    if not c:
        return None
    members = q("select * from crew_members where crew_id=? order by created_at, rowid", crew_id)
    comments = q("select c.*, m.display_name from crew_comments c join crew_members m on m.id=c.member_id "
                 "where c.crew_id=? order by c.created_at", crew_id)
    crew_looks = q("select * from crew_looks where crew_id=? order by added_at, rowid", crew_id)
    out_looks = []
    for cl in crew_looks:
        lj = looks.look_json(cl["look_id"])
        if not lj:
            continue
        owner = q1("select s.user_token from looks l join sessions s on s.id=l.session_id where l.id=?", lj["id"])
        rmap = {r["member_id"]: r["look_render_id"]
                for r in q("select * from crew_member_renders where crew_id=? and look_id=?", crew_id, lj["id"])}
        rs = []
        for m in members:
            if owner and m["member_token"] == owner["user_token"]:
                rs.append({"member_id": m["id"], "status": lj["render"]["status"], "image_url": lj["render"]["image_url"]})
            elif m["id"] in rmap and (mr := looks.look_json(rmap[m["id"]])):
                rs.append({"member_id": m["id"], "status": mr["render"]["status"], "image_url": mr["render"]["image_url"]})
        lc = [x for x in comments if x["look_id"] == lj["id"]]
        slots = {}
        for it in lj["items"]:
            sc = [x for x in lc if x["slot"] == it["slot"]]
            slots[it["slot"]] = {r: sum(x["reaction"] == r for x in sc) for r in ("up", "down", "swap")}
            slots[it["slot"]]["comments"] = sum(bool(x["text"]) for x in sc)
        out_looks.append({"look": lj, "renders": rs, "verdict": _verdict(lc, len(members)), "slot_counts": slots})
    stamps = [c["created_at"], *(m["created_at"] for m in members), *(x["created_at"] for x in comments),
              *(cl["added_at"] for cl in crew_looks)]
    return {"id": c["id"], "name": c["name"], "occasion": c["occasion"],
            "share_url": f"{config.PUBLIC_BASE_URL or 'http://localhost:5173'}/?crew={c['id']}",
            "members": [{"id": m["id"], "display_name": m["display_name"], "avatar_url": m["photo_url"],
                         "is_owner": bool(m["is_owner"]), "is_you": bool(member_token) and m["member_token"] == member_token}
                        for m in members],
            "looks": out_looks, "comments": [_comment_json(x) for x in comments], "updated_at": max(stamps)}


# Share image -----------------------------------------------------------------------------------------------------

SERIF = ["/System/Library/Fonts/NewYork.ttf", "/System/Library/Fonts/Supplemental/Georgia.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", "/usr/share/fonts/dejavu/DejaVuSerif.ttf"]
SANS = ["/System/Library/Fonts/HelveticaNeue.ttc", "/System/Library/Fonts/Helvetica.ttc",  # need the ₹ glyph
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"]
INK, MUTED, SURFACE, LINE = "#111111", "#6B6862", "#F6F4F0", "#E6E2DB"


def _font(cands, size):
    for f in cands:
        if Path(f).exists():
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                continue
    return ImageFont.load_default(size)


async def _image(url: str | None) -> Image.Image | None:
    """Our /media files directly; remote product images cached under media/thumbs. No network in stub mode."""
    if not url:
        return None
    try:
        if url.startswith("/media/"):
            return Image.open(config.media_path(url)).convert("RGB")
        if config.RENDER_STUB or not url.startswith("http"):
            return None
        dest = config.MEDIA_DIR / "thumbs" / (hashlib.sha256(url.encode()).hexdigest()[:24] + ".jpg")
        if not dest.exists():
            async with httpx.AsyncClient(timeout=6, follow_redirects=True) as c:
                r = await c.get(url)
                r.raise_for_status()
            im = Image.open(io.BytesIO(r.content)).convert("RGB")
            im.thumbnail((600, 800))
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.save(dest, "JPEG", quality=88)
        return Image.open(dest).convert("RGB")
    except Exception:
        return None


def _fit(im: Image.Image | None, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(im, size, centering=(0.5, 0.35)) if im else Image.new("RGB", size, LINE)


def _wrap(draw, text, font, width) -> list[str]:
    lines, cur = [], ""
    for w in text.split():
        t = f"{cur} {w}".strip()
        if draw.textlength(t, font=font) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    return [*lines, cur] if cur else lines


def _inr(n: int) -> str:
    s = str(int(n))
    if len(s) > 3:  # Indian grouping: 1,23,456
        head, tail = s[:-3], s[-3:]
        head = ",".join([head[max(0, i - 2):i] for i in range(len(head), 0, -2)][::-1])
        s = f"{head},{tail}"
    return f"₹{s}"


async def share_png(crew_id: str, look_id: str, fmt: str = "square") -> Path:
    c = q1("select * from crews where id=?", crew_id)
    lj = looks.look_json(look_id)
    stamp = f"{lj['render']['image_url']}|{lj['total']}|{lj['name']}"
    dest = config.MEDIA_DIR / "share" / f"{crew_id}_{look_id}_{fmt}_{hashlib.md5(stamp.encode()).hexdigest()[:8]}.png"
    if dest.exists():
        return dest
    W, H = (1080, 1920) if fmt == "story" else (1080, 1080)
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    render = await _image(lj["render"]["image_url"])
    thumbs = [await _image(it["product"].get("image_url")) for it in lj["items"]]
    if fmt == "story":
        hero_box, x0, y0, colw = (0, 0, W, 1100), 72, 1150, W - 144
    else:
        hero_box, x0, y0, colw = (0, 0, 560, H), 616, 150, W - 616 - 56
    hw, hh = hero_box[2] - hero_box[0], hero_box[3] - hero_box[1]
    if render and fmt == "story":  # whole figure, head to toe, on the surface tone
        d.rectangle(hero_box, fill=SURFACE)
        r = ImageOps.contain(render, (hw, hh))
        im.paste(r, ((hw - r.width) // 2, 0))
    elif render:
        im.paste(_fit(render, (hw, hh)), hero_box[:2])
    else:  # flat collage of the pieces
        n = max(1, len(thumbs))
        for i, t in enumerate(thumbs or [None]):
            im.paste(_fit(t, (hw, hh // n)), (0, i * (hh // n)))
    word = _font(SERIF, 34)
    if fmt == "story":
        d.text((x0, y0), "NORTHLINE", font=word, fill=INK)
        y = y0 + 70
    else:
        d.text((x0, 64), "NORTHLINE", font=word, fill=INK)
        y = y0
    title = _font(SERIF, 64)
    for line in _wrap(d, lj["name"] or "Your look", title, colw)[:2]:
        d.text((x0, y), line, font=title, fill=INK)
        y += 74
    small, body = _font(SANS, 22), _font(SANS, 28)
    d.text((x0, y + 4), f"{c['name']} · vote on it".upper(), font=small, fill=MUTED)
    y += 64
    tw = 120
    for it, t in zip(lj["items"], thumbs, strict=True):
        if y + tw * 1.25 > H - 180:
            break
        im.paste(_fit(t, (tw, int(tw * 1.25))), (x0, y))
        tx = x0 + tw + 24
        lines = _wrap(d, it["product"]["title"], body, colw - tw - 24)[:2]
        for i, line in enumerate(lines):
            d.text((tx, y + 8 + i * 36), line, font=body, fill=INK)
        d.text((tx, y + 20 + len(lines) * 36), _inr(it["product"]["price"]), font=body, fill=MUTED)
        y += int(tw * 1.25) + 24
    d.line((x0, y, x0 + colw, y), fill=LINE, width=2)
    d.text((x0, y + 20), f"Total {_inr(lj['total'])}", font=body, fill=INK)
    link = f"{config.PUBLIC_BASE_URL or 'localhost:5173'}/?crew={crew_id}".removeprefix("https://").removeprefix("http://")
    lf = _font(SANS, 22)
    while d.textlength(link, font=lf) > colw and lf.size > 12:
        lf = _font(SANS, lf.size - 1)
    d.text((x0, H - 80 if fmt == "square" else H - 110), link, font=lf, fill=MUTED)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", optimize=True)
    return dest
