"""Per-turn context pack (AGENT_SPEC §1): the Turn state the tools share, and the user-turn text Claude sees.
Everything volatile lives here, after the cached system prompt + tools."""

from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass, field

from app import config, db, dna, looks, sessions
from app.agent.tools import Refs

HISTORY_N = 12
WARDROBE_N = 24
REACTION = {"up": "liked", "down": "disliked", "swap": "wants it swapped"}


def _d(x) -> dict:
    if x is None:
        return {}
    return x if isinstance(x, dict) else x.model_dump()


@dataclass
class Turn:
    sid: str
    message: str
    look_id: str | None = None
    attachment_url: str | None = None
    session: dict = field(default_factory=dict)
    brief: dict = field(default_factory=dict)
    user_token: str = ""
    scope: str | None = None
    target_gender: str | None = None  # women | men | both | None
    budget: int | None = None
    minor: bool = False
    never: list[str] = field(default_factory=list)
    taste: dict = field(default_factory=dict)
    dna: dict = field(default_factory=dict)
    # Both people's taste when a recipient exists: a gift must not bend the shopper's DNA, nor the reverse.
    profiles: dict = field(default_factory=dict)  # "shopper" | "recipient" -> {scope, dna, taste, never}
    refs: Refs = field(default_factory=Refs)
    rejected: set[str] = field(default_factory=set)
    current: list[dict] = field(default_factory=list)  # Look dicts on screen
    visible: set[str] = field(default_factory=set)  # product ids Claude may present this turn
    history: list[dict] = field(default_factory=list)
    crew: list[str] = field(default_factory=list)
    wardrobe: list[dict] = field(default_factory=list)  # the shopper's own pieces Claude may build a look around
    trace: list[dict] = field(default_factory=list)


def _assistant_rows(sid: str) -> list[dict]:
    return db.q("select * from messages where session_id=? and role='assistant' order by id desc limit 30", sid)


def _rejected(sid: str) -> set[str]:
    """Pieces swapped out of a look in this session (by the agent's edits or the swap drawer). Never re-shown."""
    out = set()
    for row in db.q("select c.items as ci, p.items as pi from looks c join looks p on p.id=c.parent_look_id "
                    "where c.session_id=?", sid):
        child = {it["slot"]: it["product_id"] for it in row["ci"] or []}
        for it in row["pi"] or []:
            if it["slot"] in child and child[it["slot"]] != it["product_id"]:
                out.add(it["product_id"])
    return out


def _crew(sid: str) -> list[str]:
    try:
        rows = db.q("select cc.text, cc.reaction, cc.slot, cm.display_name as who, l.name as look, l.items as items "
                    "from crew_comments cc join crew_members cm on cm.id=cc.member_id "
                    "join looks l on l.id=cc.look_id where l.session_id=? order by cc.created_at limit 20", sid)
    except Exception:  # crew tables absent in a stripped-down DB
        return []
    from app import catalog
    out = []
    for r in rows:
        piece = ""
        if r["slot"]:
            pid = next((it["product_id"] for it in r["items"] or [] if it["slot"] == r["slot"]), None)
            p = catalog.get(pid) if pid else None
            piece = f" ({r['slot']}: {p['title'] if p else r['slot']})"
        bits = [REACTION.get(r["reaction"] or "", "")] + ([f"“{r['text']}”"] if r["text"] else [])
        out.append(f"{r['who']} on “{r['look']}”{piece}: {' '.join(b for b in bits if b)}")
    return out


def _profile(token: str, scope: str | None) -> dict:
    return {"scope": scope, "dna": _d(dna.summary(token, scope=scope)), "taste": dict(dna.taste_vector(token, scope) or {}),
            "never": list(dna.never_list(token, scope) or [])}


def use(t: Turn, who: str) -> None:
    """Point the turn at one person's taste (shopper or recipient)."""
    pr = t.profiles.get(who) or t.profiles.get("shopper") or {}
    t.scope, t.dna, t.taste, t.never = pr.get("scope"), pr.get("dna") or {}, pr.get("taste") or {}, list(pr.get("never") or [])


def load(sid: str, message: str, look_id: str | None = None, attachment_url: str | None = None) -> Turn | None:
    s = sessions.get_session(sid)
    if not s:
        return None
    s = _d(s)
    t = Turn(sid=sid, message=message.strip(), look_id=look_id, attachment_url=attachment_url, session=s)
    t.brief = _d(s.get("brief"))
    t.user_token = s.get("user_token") or ""
    b, rec = t.brief, _d(t.brief.get("recipient"))
    t.target_gender = sessions.gender(s)
    t.minor = (rec if b.get("for") == "other" else b).get("age_range") == "13-17"
    t.budget = b.get("budget_max") or None
    t.profiles = {"shopper": _profile(t.user_token, None)}
    if rec or b.get("for") == "other":  # same scope key the taste edges were written under
        t.profiles["recipient"] = _profile(t.user_token, sessions.scope({"brief": {**b, "for": "other"}}))
    use(t, "recipient" if b.get("for") == "other" and "recipient" in t.profiles else "shopper")

    rows = _assistant_rows(sid)
    t.refs = Refs(next((r["content"].get("ref_map") for r in rows if (r["content"] or {}).get("ref_map")), None))
    t.rejected = _rejected(sid)
    last_ids = next((r["content"].get("look_ids") for r in rows if (r["content"] or {}).get("look_ids")), []) or []
    ids = ([look_id] if look_id else []) + [i for i in last_ids if i != look_id]
    for lid in ids[:4]:
        try:
            lk = _d(looks.look_json(lid))
        except Exception:
            lk = {}
        if lk and lk.get("id"):
            t.current.append(lk)
            for it in lk.get("items") or []:
                t.visible.add(_d(it.get("product")).get("id"))
    if b.get("for") != "other":  # the shopper's own pieces get refs, so a look can be built around one (₹0, theirs)
        from app import tryon
        for w in [w for w in tryon.wardrobe(t.user_token) if w["allow_styling"] and w["tagged"]][:WARDROBE_N]:
            t.wardrobe.append(w)
            t.visible.add(w["id"])
    hist = db.q("select * from messages where session_id=? order by id desc limit ?", sid, HISTORY_N)
    t.history = list(reversed(hist))
    t.crew = _crew(sid)
    return t


def _money(n) -> str:
    return f"₹{int(n):,}"


def _weights(d: dict, n: int = 4) -> tuple[str, str]:
    items = sorted(((k, float(v)) for k, v in (d or {}).items() if v), key=lambda kv: -abs(kv[1]))
    likes = " ".join(f"{k}({v:+.1f})" for k, v in [kv for kv in items if kv[1] > 0][:n])
    dislikes = " ".join(f"{k}({v:+.1f})" for k, v in [kv for kv in items if kv[1] < 0][:n])
    return likes, dislikes


def shopper_block(t: Turn) -> str:
    b, rec = t.brief, _d(t.brief.get("recipient"))
    lines = []
    ok = sessions.confirmed(t.session)
    first_ask = not any((m["content"] or {}).get("look_ids") or (m["content"] or {}).get("product_ids")
                        for m in t.history if m["role"] == "assistant")
    if not b:
        lines.append("brief: nothing known yet (who it's for, gender, occasion and budget come from this chat). "
                     "Store sells women and men.")
    else:
        if b.get("for") == "other":
            who = ", ".join(str(x) for x in (rec.get("relation"), rec.get("gender"), rec.get("age_range")) if x)
            lines.append(f"for: other · recipient: {who or 'unspecified'}")
        else:
            extra = ", ".join(str(x) for x in (b.get("age_range"), b.get("profession")) if x)
            lines.append(f"for: self · gender: {b.get('gender') or 'unknown'}" + (f" · {extra}" if extra else ""))
        occ = b.get("occasion") or "unknown"
        bud = f"{_money(t.budget)} per look" if t.budget else "no limit set"
        lines.append(f"occasion: {occ} · budget_max: {bud}" + (f" · preferred fit: {b['fit']}" if b.get("fit") else ""))
    if b:
        src = {f: ("confirmed in this chat" if f in ok else "remembered from an earlier chat, NOT confirmed")
               for f in ("wearer", "gender", "occasion", "budget")}
        lines.append("basics: " + " · ".join(
            f"{f} {src[f]}" for f, have in (("wearer", b.get("for")), ("gender", b.get("gender") or rec.get("gender")),
                                             ("occasion", b.get("occasion")), ("budget", "budget_max" in b)) if have))
    lines.append("shown in this chat so far: " + ("nothing yet" if first_ask else "looks or products"))
    for who, pr in t.profiles.items():
        d = pr["dna"]
        label = "style_dna" if who == "shopper" else f"recipient_dna ({rec.get('relation')})"
        vl, vd = _weights(d.get("vibes"))
        cl, cd = _weights(d.get("colors"))
        if vl or vd or cl or cd or d.get("name"):
            parts = [f"name “{d['name']}”" if d.get("name") else "",
                     f"likes {vl}" if vl else "", f"dislikes {vd}" if vd else "",
                     f"colours liked {cl}" if cl else "", f"colours disliked {cd}" if cd else ""]
            lines.append(f"{label}: " + " · ".join(p for p in parts if p))
        else:
            lines.append(f"{label}: none yet")
        nv = pr["never"]
        lines.append(("never" if who == "shopper" else f"recipient_never ({rec.get('relation')})") + ": "
                     + (", ".join(nv) if nv else "nothing"))
    if t.crew:
        lines.append("crew_feedback: " + "; ".join(t.crew))
    if t.wardrobe:
        lines.append("wardrobe (pieces the shopper owns, usable in a look only when they name one or ask to style "
                     "around it): " + "; ".join(_owned_line(w, t) for w in t.wardrobe))
    if t.minor:
        lines.append("minor: the wearer is 13-17, so virtual try-on is off for these looks")
    pg = sessions.photo_gender(t.session)
    lines.append("photo: " + (f"on file, wears {pg}'s clothes (looks render on it automatically)"
                              if t.session.get("photo_url") and pg else
                              "on file (looks render on it automatically)" if t.session.get("photo_url") else
                              "none yet (cards show the pieces; the shopper can pick a model to see them on)"))
    return "<shopper>\n" + "\n".join(lines) + "\n</shopper>"


def _owned_line(w: dict, t: Turn) -> str:
    meta = ", ".join(str(x) for x in (w.get("color_family"), w.get("fabric"), w.get("formality") and
                                       f"formality {w['formality']}", w.get("fit")) if x)
    return f"{w['slot']} {t.refs.ref(w['id'])} {w['name']} [{meta}]"


def _item_line(it: dict, t: Turn) -> str:
    p = _d(it.get("product"))
    ref = t.refs.ref(p["id"])
    meta = ", ".join(str(x) for x in (p.get("color_family"), p.get("fabric"), f"formality {p.get('formality')}",
                                       p.get("fit"), p.get("gender")) if x)
    return f"{it['slot']} {ref} {p['title']} {_money(p['price'])} [{meta}]"


def current_block(t: Turn) -> str:
    if not t.current:
        return "<current_looks>\nnone\n</current_looks>"
    lines = []
    for i, lk in enumerate(t.current, 1):
        sel = " SELECTED" if lk["id"] == t.look_id else ""
        items = " · ".join(_item_line(it, t) for it in lk.get("items") or [])
        over = f" ({_money(lk['over_budget_by'])} over budget)" if lk.get("over_budget_by") else ""
        lines.append(f"L{i} “{lk.get('name')}” (look_id {lk['id']}){sel}: {items} · total "
                     f"{_money(lk.get('total') or 0)}{over}")
    return "<current_looks>\n" + "\n".join(lines) + "\n</current_looks>"


def history_block(t: Turn) -> str:
    lines = []
    for m in t.history:
        c = m["content"] or {}
        if m["role"] == "user":
            lines.append("Shopper: " + (c.get("text") or "") + (" [attached an image]" if c.get("attachment_url") else ""))
        else:
            s = "Ava: " + (c.get("text") or "").strip()
            if c.get("summary"):
                s += f" [showed {c['summary']}]"
            for q in (c.get("clarify") or {}).get("questions") or []:
                s += f" [asked: {q['question']} — options: {' / '.join(o['label'] for o in q['options'])}]"
            if (c.get("clarify") or {}).get("chips"):  # pre-card messages
                s += f" [asked: {c['clarify'].get('question', '')} — chips: {' / '.join(c['clarify']['chips'])}]"
            lines.append(s)
    return "<history>\n" + ("\n".join(lines) if lines else "(start of chat)") + "\n</history>"


def _image_block(url: str) -> dict | None:
    if url.startswith(("http://", "https://")):
        return {"type": "image", "source": {"type": "url", "url": url}}
    if url.startswith("/media/"):
        p = config.media_path(url)
        if p.exists() and p.stat().st_size < 5_000_000:
            mt = mimetypes.guess_type(p.name)[0] or "image/jpeg"
            data = base64.standard_b64encode(p.read_bytes()).decode()
            return {"type": "image", "source": {"type": "base64", "media_type": mt, "data": data}}
    return None


def user_content(t: Turn) -> list[dict]:
    from app.agent.prompts import IMAGE_NOTE
    blocks = []
    img = _image_block(t.attachment_url) if t.attachment_url else None
    if img:
        blocks.append(img)
    text = "\n".join([history_block(t), shopper_block(t), current_block(t)])
    msg = t.message + (f"\n({IMAGE_NOTE})" if img else "")
    blocks.append({"type": "text", "text": f"{text}\n<user_message>\n{msg}\n</user_message>"})
    return blocks
