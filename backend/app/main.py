"""HTTP routes only (ARCHITECTURE §3). Logic lives in the modules."""

import html
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app import catalog, config, crew, dna, looks, scoring, sessions, youcam
from app import tryon as platform
from app.db import ex, init_db, q, q1


@asynccontextmanager
async def lifespan(_app):
    init_db()
    if not catalog.PRODUCTS:
        catalog.load()
    looks.resume_videos()  # clips still `pending` from before a restart keep polling their paid task
    yield


app = FastAPI(title="Drape", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def err(status: int, code: str, message: str):
    raise HTTPException(status, detail={"code": code, "message": message})


@app.exception_handler(HTTPException)
async def _http_err(_req, e: HTTPException):
    d = e.detail if isinstance(e.detail, dict) else {"code": f"http_{e.status_code}", "message": str(e.detail)}
    return JSONResponse({"error": d}, status_code=e.status_code)


@app.exception_handler(RequestValidationError)
async def _val_err(_req, e: RequestValidationError):
    return JSONResponse({"error": {"code": "invalid_request", "message": str(e.errors()[:3])}}, status_code=422)


# Models at the IO boundary ----------------------------------------------------------------------------------------

class Recipient(BaseModel):
    relation: str | None = None
    gender: Literal["women", "men"] | None = None
    age_range: str | None = None


class Brief(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    for_: Literal["self", "other"] = Field("self", alias="for")
    recipient: Recipient | None = None
    occasion: str | None = None
    budget_max: int | None = None
    gender: Literal["women", "men", "both"] | None = None
    profession: str | None = None
    age_range: str | None = None
    fit: Literal["relaxed", "regular", "fitted"] | None = None


class SessionIn(BaseModel):
    user_token: str | None = None


class BriefIn(BaseModel):
    brief: Brief


class SampleIn(BaseModel):
    sample_model_id: str


class PickIn(BaseModel):
    tile_id: str
    verdict: Literal["heart", "cross"]


class TryonIn(BaseModel):
    session_id: str
    product_ids: list[str]
    name: str | None = None
    model_id: str | None = None  # render on this sample model instead of the session photo


class RenderIn(BaseModel):
    model_id: str | None = None


class SwapIn(BaseModel):
    slot: Literal["top", "bottom", "one_piece", "layer", "bag", "accessory"]
    product_id: str


class FeedbackIn(BaseModel):
    kind: Literal["like", "dislike", "cart"]


class CrewIn(BaseModel):
    session_id: str
    look_id: str
    name: str | None = None
    display_name: str | None = None


class JoinIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=40)
    sample_model_id: str | None = None
    user_token: str | None = None  # the joiner's shopper token: membership keyed on it, so it shows in their session


class CrewLookIn(BaseModel):
    member_token: str
    look_id: str


class CommentIn(BaseModel):
    member_token: str
    look_id: str
    slot: str | None = None
    text: str | None = Field(None, max_length=500)
    reaction: Literal["up", "down", "swap"] | None = None


# Helpers ----------------------------------------------------------------------------------------------------------

def _session(sid: str) -> dict:
    return sessions.get_session(sid) or err(404, "session_not_found", "That session has expired. Start again.")


def _look(look_id: str) -> dict:
    return looks.look_json(look_id) or err(404, "look_not_found", "That look is no longer available.")


def _web(request: Request) -> str:
    """The web app origin for share links (WEB_URL, else the browser's Origin/Referer, else PUBLIC_BASE_URL)."""
    return config.web_url(request.headers.get("origin"), request.headers.get("referer"))


async def _photo_from(request: Request, json_model=SampleIn) -> tuple[dict, tuple[str, str] | None]:
    """Multipart `file` (+ other fields) or a JSON body with sample_model_id. Returns (fields, (photo_url, src_key))."""
    try:
        if request.headers.get("content-type", "").startswith("multipart/"):
            form = await request.form()
            fields = {k: v for k, v in form.items() if isinstance(v, str)}
            f = form.get("file")
            if f is None or isinstance(f, str):
                return fields, None
            return fields, sessions.save_photo(await f.read())
        body = json_model.model_validate(await request.json()).model_dump()
        mid = body.get("sample_model_id")
        return body, sessions.model_photo(mid) if mid else None
    except sessions.PhotoInvalid as e:
        err(422, "photo_invalid", str(e))
    except (ValidationError, ValueError):
        err(422, "invalid_request", "Send a photo file or a sample model id.")


# Store and catalogue ----------------------------------------------------------------------------------------------

@app.get("/api/store")
async def store():
    return config.STORE


@app.get("/api/products")
async def products(gender: str | None = None, slot: str | None = None, q: str = "", vibe: str | None = None,
                   max_price: int | None = None, offset: int = 0, limit: int = 24):
    items, total = catalog.list_products(gender, slot, q, vibe, max_price, offset, min(limit, 100))
    return {"items": items, "total": total}


@app.get("/api/products/{pid}")
async def product(pid: str):
    return catalog.get(pid) or err(404, "product_not_found", "That piece isn't in the catalogue.")


@app.get("/api/models")
async def models():
    return {"models": [{k: m[k] for k in ("id", "gender", "label", "image_url")} for m in sessions.models()]}


# Session ----------------------------------------------------------------------------------------------------------

@app.post("/api/session")
async def create_session(body: SessionIn):
    s, returning, profile = sessions.create(body.user_token)
    return {"session_id": s["id"], "user_token": s["user_token"], "returning": returning, "profile": profile,
            "crews": crew.for_token(s["user_token"])}


@app.get("/api/session/{sid}")
async def get_session(sid: str):
    return sessions.session_json(_session(sid))  # includes `crews`: the crews this shopper owns or joined


@app.patch("/api/session/{sid}")
async def patch_session(sid: str, body: BriefIn):
    _session(sid)
    b = body.brief.model_dump(by_alias=True, exclude_none=True)
    ex("update sessions set brief=? where id=?", b, sid)
    # The shopper filled these in themselves (onboarding form), so they count as confirmed for this chat.
    sessions.confirm(sid, [f for f, k in (("wearer", "for"), ("gender", "gender"), ("occasion", "occasion"),
                                          ("budget", "budget_max")) if k in b or (f == "gender" and b.get("recipient"))])
    return sessions.session_json(_session(sid))


@app.post("/api/session/{sid}/photo")
async def set_photo(sid: str, request: Request):
    _session(sid)
    fields, photo = await _photo_from(request)
    if not photo:
        err(422, "photo_invalid", "Add a photo or pick a sample model.")
    pg = fields.get("photo_gender") if fields.get("photo_gender") in ("women", "men") else None
    ex("update sessions set photo_url=?, src_url=?, sample_model_id=?, photo_gender=? where id=?", photo[0], photo[1],
       fields.get("sample_model_id") if photo[1].startswith("model:") else None, pg, sid)
    return {"photo_url": photo[0], "photo_gender": sessions.photo_gender(_session(sid))}


# Style DNA picker -------------------------------------------------------------------------------------------------

@app.post("/api/session/{sid}/dna/tiles")
async def start_tiles(sid: str):
    _session(sid)
    looks.start_tiles(sid)
    return {"tiles": looks.tiles_json(sid)}


@app.get("/api/session/{sid}/dna/tiles")
async def get_tiles(sid: str):
    _session(sid)
    return {"tiles": looks.tiles_json(sid)}


@app.post("/api/session/{sid}/dna/pick")
async def pick(sid: str, body: PickIn):
    s = _session(sid)
    t = q1("select * from tiles where id=? and session_id=?", body.tile_id, sid) or err(404, "tile_not_found", "That tile is gone.")
    p = catalog.get(t["product_id"]) or {}
    dna.pick(s["user_token"], t["vibe"], p.get("color_family"), body.verdict, sessions.scope(s))
    return {"dna": dna.summary(s["user_token"], sessions.scope(s))}


# Looks ------------------------------------------------------------------------------------------------------------

@app.get("/api/looks/{lid}")
async def get_look(lid: str):
    looks.resume_video(lid)  # a `pending` clip whose poller died (restart, timeout window) polls its task again
    return _look(lid)


@app.post("/api/looks/{lid}/render")
async def render_look(lid: str, body: RenderIn | None = None):
    _look(lid)
    looks.start_render(lid, model_id=body.model_id if body else None)
    return looks.look_json(lid)


@app.post("/api/tryon")
async def tryon(body: TryonIn):
    _session(body.session_id)
    by_slot = {p["slot"]: p for pid in body.product_ids if (p := catalog.get(pid))}
    if not by_slot:
        err(422, "no_products", "None of those pieces are in the catalogue.")
    ps = list(by_slot.values())
    why = ps[0].get("one_liner") or "" if len(ps) == 1 else "The pieces you picked, styled together."
    lk = looks.create_look(body.session_id, body.name or "Studio Pick", why, [(p["slot"], p["id"]) for p in ps])
    looks.start_render(lk["id"], model_id=body.model_id)
    return looks.look_json(lk["id"])


@app.get("/api/looks/{lid}/alternatives")
async def alternatives(lid: str, slot: str):
    lk = _look(lid)
    s = sessions.get_session(q1("select session_id from looks where id=?", lid)["session_id"]) or {}
    tok, sc = s.get("user_token"), sessions.scope(s)
    occasion, taste = (s.get("brief") or {}).get("occasion"), dna.taste_vector(tok, sc) if tok else None
    items = scoring.alternatives(lk["items"], slot, lk["budget_max"], occasion, taste,
                                 never=dna.never_list(tok, sc) if tok else ())
    # The shopper's own pieces (TRYON wardrobe) first, scored the same way; only for their own looks, not gifts.
    owned = platform.owned_pairs(tok, lk["items"], slot, occasion, taste, sessions.gender(s), limit=8) if not sc else []
    has = bool(not sc and tok and platform.for_token(tok))
    return {"slot": slot, "items": owned + items, "wardrobe": {"account": has, "owned": len(owned)}}


@app.post("/api/looks/{lid}/swap")
async def swap(lid: str, body: SwapIn):
    _look(lid)
    if body.product_id.startswith("w_"):  # swap in one of the shopper's own pieces: theirs only
        w = platform.wardrobe_item(body.product_id)
        s = sessions.get_session(q1("select session_id from looks where id=?", lid)["session_id"]) or {}
        if not w or w["user_token"] != s.get("user_token"):
            err(404, "product_not_found", "That piece isn't in your wardrobe.")
    else:
        catalog.get(body.product_id) or err(404, "product_not_found", "That piece isn't in the catalogue.")
    return looks.swap(lid, body.slot, body.product_id)


@app.post("/api/looks/{lid}/video")
async def video(lid: str):
    lk = _look(lid)
    if lk["render"]["status"] != "ready":
        err(409, "not_ready", "Try it on first, then we can set it in motion.")
    looks.start_video(lid)
    return looks.look_json(lid)


@app.post("/api/looks/{lid}/feedback")
async def feedback(lid: str, body: FeedbackIn):
    _look(lid)
    looks.feedback(lid, body.kind)
    return {"ok": True}


# Style Crew -------------------------------------------------------------------------------------------------------

def _crew(cid: str, token: str | None = None, request: Request | None = None) -> dict:
    return crew.crew_json(cid, token, _web(request) if request else None) or err(
        404, "crew_not_found", "That crew link has expired.")


@app.get("/api/crews")
async def my_crews(user_token: str):
    return {"crews": crew.for_token(user_token)}


@app.post("/api/crews")
async def create_crew(body: CrewIn, request: Request):
    s = _session(body.session_id)
    _look(body.look_id)
    cid = crew.create_or_reuse(body.session_id, body.look_id, body.name, body.display_name)
    return _crew(cid, s["user_token"], request)


@app.get("/api/crews/{cid}")
async def get_crew(cid: str, request: Request, member_token: str | None = None, since: str | None = None):
    return _crew(cid, member_token, request)  # ponytail: always the full state; `since` is accepted for the poller


@app.post("/api/crews/{cid}/join")
async def join_crew(cid: str, request: Request):
    _crew(cid)
    fields, photo = await _photo_from(request, JoinIn)
    name = (fields.get("display_name") or "").strip() or err(422, "invalid_request", "Add your name to join.")
    m = crew.join(cid, name, *(photo or (None, None)), user_token=(fields.get("user_token") or "").strip() or None)
    return {"member_token": m["member_token"], "crew": _crew(cid, m["member_token"], request)}


@app.post("/api/crews/{cid}/looks")
async def crew_add_look(cid: str, body: CrewLookIn, request: Request):
    _crew(cid)
    q1("select 1 from crew_members where crew_id=? and member_token=?", cid, body.member_token) or err(
        403, "not_a_member", "Join the crew to add looks.")
    _look(body.look_id)
    crew.add_look(cid, body.look_id)
    return _crew(cid, body.member_token, request)


@app.post("/api/crews/{cid}/comments")
async def crew_comment(cid: str, body: CommentIn):
    if not (body.text or "").strip() and not body.reaction:
        err(422, "invalid_request", "Say something or react.")
    try:
        return crew.comment(cid, body.member_token, body.look_id, body.slot, body.text, body.reaction)
    except KeyError:
        err(403, "not_a_member", "Join the crew to comment.")


@app.get("/api/crews/{cid}/share.png")
async def share_png(cid: str, look_id: str, request: Request, format: Literal["square", "story"] = "square"):
    _crew(cid)
    q1("select 1 from crew_looks where crew_id=? and look_id=?", cid, look_id) or err(
        404, "look_not_found", "That look isn't in this crew.")
    return FileResponse(await crew.share_png(cid, look_id, format, _web(request)), media_type="image/png")


# Taste graph and privacy ------------------------------------------------------------------------------------------

@app.get("/api/dna/{token}")
async def dna_export(token: str):
    return dna.export(token)


@app.delete("/api/dna/{token}")
async def dna_forget(token: str):
    sessions.forget(token)
    return {"ok": True}


# Ops --------------------------------------------------------------------------------------------------------------

@app.get("/api/status")
async def status():
    return {"ok": True, "youcam": {"units_left": await youcam.units_left(), "demo_mode": youcam.demo_mode()},
            "anthropic": {"configured": bool(config.ANTHROPIC_API_KEY)}, "catalog": {"count": len(catalog.PRODUCTS)}}


def _renders() -> dict:
    rows = q("select id, cache_key, src_key, garment_category, ref_url, task_id, status, units, latency_ms, cached_hits, "
             "error, local_path, created_at from renders order by id desc limit 500")
    t = q1("select count(task_id) calls, coalesce(sum(cached_hits),0) cache_hits, coalesce(sum(units),0) units "
           "from renders")
    return {"renders": rows, "totals": t}


def _thumb(r) -> str:
    u = r["local_path"] or ""
    return f'<a href="{u}"><img src="{u}" alt=""></a>' if r["status"] == "success" and u.endswith(".jpg") else ""


@app.get("/api/admin/renders")
async def admin_renders():
    return _renders()


@app.get("/admin/renders", response_class=HTMLResponse)
async def admin_renders_html():
    d = _renders()
    t = d["totals"]
    rows = "".join(
        f"<tr><td>{r['id']}</td><td>{html.escape(r['created_at'] or '')[:19].replace('T', ' ')}</td>"
        f"<td>{html.escape(r['garment_category'] or '')}</td><td>{html.escape((r['src_key'] or '')[:18])}</td>"
        f"<td class={html.escape(r['status'] or '')}>{html.escape(r['status'] or '')}</td><td>{r['units']}</td>"
        f"<td>{r['cached_hits']}</td><td>{(r['latency_ms'] or 0) / 1000:.1f}s</td>"
        f"<td>{html.escape(r['error'] or '')}</td>"
        f"<td>{_thumb(r)}</td></tr>"
        for r in d["renders"])
    return f"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>YouCam renders · Drape</title>
<style>body{{font:14px/1.4 -apple-system,Helvetica,sans-serif;color:#111;margin:32px;background:#fff}}
h1{{font:400 40px Georgia,serif;margin:0 0 8px}}.k{{display:flex;gap:16px;margin:16px 0 24px;flex-wrap:wrap}}
.k div{{background:#F6F4F0;border-radius:14px;padding:16px 20px;min-width:140px}}.k b{{display:block;font-size:28px;
font-variant-numeric:tabular-nums}}table{{border-collapse:collapse;width:100%}}td,th{{border-bottom:1px solid #E6E2DB;
padding:6px 8px;text-align:left;font-variant-numeric:tabular-nums}}th{{font-size:11px;letter-spacing:.08em;
text-transform:uppercase;color:#6B6862}}img{{height:56px}}.success{{color:#2F7A4F}}.error{{color:#B5532E}}</style>
<h1>YouCam API usage</h1><p style="color:#6B6862">Every Clothes VTO and Image-to-Video call, with cache hits.
Demo mode: {"on" if youcam.demo_mode() else "off"}.</p>
<div class=k><div><b>{t['calls']}</b>live calls</div><div><b>{t['cache_hits']}</b>cache hits</div>
<div><b>{t['units']}</b>units spent</div></div>
<table><tr><th>#</th><th>time (UTC)</th><th>category</th><th>source</th><th>status</th><th>units</th><th>hits</th>
<th>latency</th><th>error</th><th>result</th></tr>{rows}</table>"""


from app.tryon_routes import router as tryon_router  # noqa: E402

app.include_router(tryon_router)

try:
    from app.agent.routes import router as agent_router

    app.include_router(agent_router)
except ImportError:  # the agent package may not exist yet
    pass

app.mount("/media/models", StaticFiles(directory=config.MODELS_DIR, check_dir=False), name="models")
app.mount("/media", StaticFiles(directory=config.MEDIA_DIR, check_dir=False), name="media")
if config.WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=config.WEB_DIST, html=True), name="web")
