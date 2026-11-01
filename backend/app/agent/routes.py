"""POST /api/chat (SSE) and GET /api/session/{sid}/messages. main.py includes `router`."""

from __future__ import annotations

import json
import logging
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import catalog, db, dna, looks, sessions
from app.agent import loop

log = logging.getLogger("elara.agent")
router = APIRouter()


class Answer(BaseModel):
    field: Literal["wearer", "gender", "occasion", "budget", "style", "fit", "detail"]
    value: str = Field(max_length=80)


class ChatIn(BaseModel):
    session_id: str
    message: str
    look_id: str | None = None
    attachment_url: str | None = None
    answers: list[Answer] = Field(default_factory=list, max_length=2)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


async def _stream(body: ChatIn):
    try:
        async for ev, data in loop.turn(body.session_id, body.message, body.look_id, body.attachment_url,
                                        [a.model_dump() for a in body.answers]):
            yield sse(ev, data)
    except Exception:  # last line of defence: the client always gets copy and a closed stream
        log.exception("chat stream crashed")
        yield sse("error", {"message": "Something went wrong on my side. Send that again and I'll pick it up."})
        yield sse("done", {})


@router.post("/api/chat")
async def chat(body: ChatIn):
    return StreamingResponse(_stream(body), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def clarify_card(c: dict | None) -> dict | None:
    """Stored clarifications as the card shape; messages from before the card had one question with chips."""
    if not c:
        return None
    if c.get("questions"):
        return c
    chips = c.get("chips") or []
    return {"questions": [{"field": "occasion", "question": c.get("question") or "",
                           "options": [{"label": x, "value": x} for x in chips]}]} if chips else None


@router.get("/api/session/{sid}/messages")
def messages(sid: str):
    out = []
    s = sessions.get_session(sid) or {}
    taste = dna.taste_vector(s.get("user_token"), sessions.scope(s)) if s else None
    for m in db.q("select * from messages where session_id=? order by id", sid):
        c = m["content"] or {}
        row = {"role": m["role"], "text": c.get("text") or ""}
        if c.get("look_ids"):
            row["looks"] = [lk for i in c["look_ids"] if (lk := looks.look_json(i))]
        if c.get("product_ids"):
            row["products"] = loop.product_cards([p for i in c["product_ids"] if (p := catalog.get(i))], taste)
        if card := clarify_card(c.get("clarify")):
            row["clarify"] = card
        if c.get("try_next"):
            row["try_next"] = c["try_next"]
        if m["role"] == "user" and c.get("attachment_url"):
            row["attachment_url"] = c["attachment_url"]
        out.append(row)
    return {"messages": out}
