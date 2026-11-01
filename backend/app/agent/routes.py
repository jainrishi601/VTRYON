"""POST /api/chat (SSE) and GET /api/session/{sid}/messages. main.py includes `router`."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app import db, looks
from app.agent import loop

log = logging.getLogger("elara.agent")
router = APIRouter()


class ChatIn(BaseModel):
    session_id: str
    message: str
    look_id: str | None = None
    attachment_url: str | None = None


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


async def _stream(body: ChatIn):
    try:
        async for ev, data in loop.turn(body.session_id, body.message, body.look_id, body.attachment_url):
            yield sse(ev, data)
    except Exception:  # last line of defence: the client always gets copy and a closed stream
        log.exception("chat stream crashed")
        yield sse("error", {"message": "Something went wrong on my side. Send that again and I'll pick it up."})
        yield sse("done", {})


@router.post("/api/chat")
async def chat(body: ChatIn):
    return StreamingResponse(_stream(body), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/api/session/{sid}/messages")
def messages(sid: str):
    out = []
    for m in db.q("select * from messages where session_id=? order by id", sid):
        c = m["content"] or {}
        row = {"role": m["role"], "text": c.get("text") or ""}
        if c.get("look_ids"):
            row["looks"] = [lk for i in c["look_ids"] if (lk := looks.look_json(i))]
        if c.get("clarify"):
            row["clarify"] = c["clarify"]
        if m["role"] == "user" and c.get("attachment_url"):
            row["attachment_url"] = c["attachment_url"]
        out.append(row)
    return {"messages": out}
