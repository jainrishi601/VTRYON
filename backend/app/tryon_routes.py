"""TRYON platform routes (/api/auth/*, /api/me/*, /api/tryon/*). Logic lives in app/tryon.py; main.py includes `router`.
Auth is a bearer token from signup/login; every /api/me route acts on that account's profile and shopper token."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app import sessions, tryon

router = APIRouter()


def _err(status: int, code: str, message: str):
    raise HTTPException(status, detail={"code": code, "message": message})


def _me(authorization: str | None) -> dict:
    tok = (authorization or "").removeprefix("Bearer ").strip()
    return tryon.from_auth(tok) or _err(401, "signed_out", "Log in to continue.")


class SignupIn(BaseModel):
    name: str = Field("", max_length=60)
    email: str = Field(max_length=120)
    password: str = Field(max_length=200)
    user_token: str | None = None  # the browser's widget token, so earlier taste carries over


class LoginIn(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=200)


class Sizes(BaseModel):
    region: str | None = None
    tops: str | None = None
    bottoms: str | None = None
    dresses: str | None = None
    footwear: str | None = None


class ProfileIn(BaseModel):
    goal: Literal["build", "utilise", "mindful"] | None = None
    gender: Literal["women", "men", "both"] | None = None
    profession: str | None = Field(None, max_length=60)
    age_range: str | None = Field(None, max_length=20)
    sizes: Sizes | None = None
    height_cm: int | None = Field(None, ge=100, le=230)
    weight_kg: int | None = Field(None, ge=30, le=250)
    colors: list[str] | None = None
    never: list[str] | None = None
    onboarded: bool | None = None
    step: int | None = None


class VoteIn(BaseModel):
    verdict: Literal["love", "like", "dislike"]


class PickFeedbackIn(BaseModel):
    kind: Literal["wore", "like", "dislike"]


class PlayIn(BaseModel):
    pair_id: str = Field(max_length=80)
    choice: Literal["a", "b", "both", "neither", "unsure"]


class WardrobePatch(BaseModel):
    name: str | None = Field(None, max_length=80)
    slot: str | None = None
    category: str | None = Field(None, max_length=30)
    color_family: str | None = None
    pattern: str | None = None
    fit: str | None = None
    formality: int | None = Field(None, ge=1, le=5)
    allow_styling: bool | None = None


# ------------------------------------------------------------------------------------------------------------- auth

@router.post("/api/auth/signup")
async def signup(body: SignupIn):
    try:
        auth, user = tryon.signup(body.name, body.email, body.password, body.user_token)
    except tryon.AuthError as e:
        _err(422, "signup_failed", str(e))
    return {"auth": auth, "user": user}


@router.post("/api/auth/login")
async def login(body: LoginIn):
    try:
        auth, user = tryon.login(body.email, body.password)
    except tryon.AuthError as e:
        _err(401, "login_failed", str(e))
    return {"auth": auth, "user": user}


@router.post("/api/auth/logout")
async def logout(authorization: str | None = Header(None)):
    tryon.logout((authorization or "").removeprefix("Bearer ").strip())
    return {"ok": True}


@router.get("/api/me")
async def me(authorization: str | None = Header(None)):
    return _me(authorization)


# ---------------------------------------------------------------------------------------------------------- profile

@router.get("/api/tryon/options")
async def options():
    return {"palette": tryon.palette_json(), "never": tryon.never_json(), "sizes": list(tryon.SIZES)}


@router.patch("/api/me/profile")
async def patch_profile(body: ProfileIn, authorization: str | None = Header(None)):
    u = _me(authorization)
    patch = body.model_dump(exclude_none=True)
    if body.sizes:
        patch["sizes"] = body.sizes.model_dump(exclude_none=True)
    return tryon.save_profile(u["id"], patch)


@router.post("/api/me/photo")
async def photo(request: Request, kind: Literal["selfie", "body"], authorization: str | None = Header(None)):
    u = _me(authorization)
    form = await request.form()
    f = form.get("file")
    if f is None or isinstance(f, str):
        _err(422, "photo_invalid", "Add a photo.")
    try:
        return tryon.set_photo(u["id"], kind, await f.read())
    except sessions.PhotoInvalid as e:
        _err(422, "photo_invalid", str(e))


@router.post("/api/me/colors/analyze")
async def analyze(authorization: str | None = Header(None)):
    return await tryon.analyze_colors(_me(authorization)["id"])


# ------------------------------------------------------------------------------------------------------------ vibes

@router.post("/api/me/vibes/start")
async def vibes_start(authorization: str | None = Header(None)):
    return {"vibes": tryon.start_vibes(_me(authorization)["id"])}


@router.get("/api/me/vibes")
async def vibes(authorization: str | None = Header(None)):
    return {"vibes": tryon.vibes(_me(authorization)["id"])}


@router.post("/api/me/vibes/{tile_id}")
async def vote(tile_id: str, body: VoteIn, authorization: str | None = Header(None)):
    try:
        return tryon.vote_vibe(_me(authorization)["id"], tile_id, body.verdict)
    except KeyError:
        _err(404, "tile_not_found", "That look is gone.")


# --------------------------------------------------------------------------------------------------------- wardrobe

@router.get("/api/me/wardrobe")
async def wardrobe(authorization: str | None = Header(None)):
    return {"items": tryon.wardrobe(_me(authorization)["user_token"])}


@router.post("/api/me/wardrobe")
async def add_wardrobe(request: Request, authorization: str | None = Header(None)):
    u = _me(authorization)
    form = await request.form()
    files = [f for f in form.getlist("file") if not isinstance(f, str)]
    if not files:
        _err(422, "photo_invalid", "Add at least one photo.")
    added, errors = [], []
    for f in files[:10]:
        try:
            added += await tryon.add_wardrobe_photo(u["user_token"], await f.read())
        except sessions.PhotoInvalid as e:
            errors.append(f"{f.filename}: {e}")
    if not added and errors:
        _err(422, "photo_invalid", errors[0])
    return {"items": added, "errors": errors}


@router.patch("/api/me/wardrobe/{wid}")
async def patch_wardrobe(wid: str, body: WardrobePatch, authorization: str | None = Header(None)):
    try:
        return tryon.update_wardrobe(_me(authorization)["user_token"], wid, body.model_dump(exclude_none=True))
    except KeyError:
        _err(404, "not_found", "That piece is gone.")


@router.delete("/api/me/wardrobe/{wid}")
async def delete_wardrobe(wid: str, authorization: str | None = Header(None)):
    tryon.delete_wardrobe(_me(authorization)["user_token"], wid)
    return {"ok": True}


# -------------------------------------------------------------------------------------------------------- style DNA

@router.get("/api/me/dna")
async def dna_page(authorization: str | None = Header(None)):
    return tryon.dna_page(_me(authorization)["id"])


@router.delete("/api/me/dna")
async def forget(kind: str, value: str, authorization: str | None = Header(None)):
    tryon.forget_attribute(_me(authorization)["id"], kind, value)
    return {"ok": True}


# ------------------------------------------------------------------------------------------- daily picks, style play

def _daily(u: dict, picks: list[dict]) -> dict:
    # wardrobe_items: how many pieces the shopper owns; the "Add my wardrobe" banner is for 0 only
    return {"day": tryon._today(), "picks": picks, "wardrobe_items": len(tryon.wardrobe(u["user_token"]))}


@router.get("/api/me/daily")
async def daily(authorization: str | None = Header(None)):
    u = _me(authorization)
    return _daily(u, await tryon.daily(u["id"]))  # rebuilt after any wardrobe add/edit/delete


@router.post("/api/me/daily/regenerate")
async def daily_regenerate(authorization: str | None = Header(None)):
    u = _me(authorization)
    return _daily(u, await tryon.daily(u["id"], regenerate=True))


@router.post("/api/me/daily/{look_id}/feedback")
async def daily_feedback(look_id: str, body: PickFeedbackIn, authorization: str | None = Header(None)):
    try:
        tryon.pick_feedback(_me(authorization)["id"], look_id, body.kind)
    except KeyError:
        _err(404, "not_found", "That pick is gone.")
    return {"ok": True}


@router.get("/api/me/play")
async def play(context: Literal["everyday", "office", "festive"] = "everyday", authorization: str | None = Header(None)):
    return {"pair": tryon.play_pair(_me(authorization)["id"], context)}


@router.post("/api/me/play")
async def play_vote(body: PlayIn, authorization: str | None = Header(None)):
    try:
        return tryon.play_vote(_me(authorization)["id"], body.pair_id, body.choice)
    except KeyError:
        _err(404, "not_found", "That pair is gone.")


@router.get("/api/me/looks")
async def my_looks(authorization: str | None = Header(None)):
    return {"looks": tryon.recent_looks(_me(authorization)["id"])}
