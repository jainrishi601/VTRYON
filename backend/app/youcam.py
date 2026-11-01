"""The ONLY module that talks to YouCam. Owns the render cache, budget cap, concurrency, retries and error copy."""

import asyncio
import hashlib
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx
from PIL import Image, ImageDraw

from app import config
from app.db import ex, now, q1

COPY = {
    "error_pose": "Step back so your whole body is visible, facing the camera.",
    "error_invalid_src": "Step back so your whole body is visible, facing the camera.",
    "error_multi_person": "Only you in the photo, please.",
    "error_no_face": "We need to see your face to keep it you.",
    "exceed_max_filesize": "That photo's size won't work. Try a JPG or PNG under 10 MB.",
    "error_below_min_image_size": "That photo's size won't work. Try a JPG or PNG under 10 MB.",
    "error_nsfw_content_detected": "We couldn't render this one. Try a different photo.",
}
GENERIC = "We couldn't render this one. Try another photo or a different piece."
PAUSED = "Live try-on is paused right now, so here are the pieces flat."
CAPPED = "You've reached this session's try-on limit. The looks are still yours to shop."


class RenderError(Exception):
    def __init__(self, code: str, user_message: str | None = None):
        super().__init__(code)
        self.code, self.user_message = code, user_message or COPY.get(code, GENERIC)


class VideoPending(RenderError):
    """The clip's task is still running at YouCam after this polling window. Not a failure: the look stays `pending`
    and the next poll resumes the same task_id (no new units)."""

    def __init__(self):
        super().__init__("pending", "Your clip is still being made. It can take a few minutes.")


class RenderUnavailable(RenderError):
    """Demo mode (or out of credit) and the render is not cached. No call was made."""

    def __init__(self):
        super().__init__("unavailable", PAUSED)


@dataclass
class Src:
    key: str  # cache identity: photo:<sha256> | model:<id> | <previous step's cache key>
    url: str | None = None
    path: Path | None = None
    file_id: str | None = None


@dataclass
class TryOnResult:
    url_local: str
    remote_url: str  # "" when the YouCam URL has (nearly) expired
    cache_key: str
    cached: bool
    units: int
    latency_ms: int


_transport: httpx.AsyncBaseTransport | None = None  # tests inject httpx.MockTransport
_credit_flip = False
_sems: dict = {}
_inflight: dict[str, asyncio.Task] = {}
_units_cache: tuple[float, int | None] = (0.0, None)


def demo_mode() -> bool:
    return config.YOUCAM_DEMO_MODE or _credit_flip or not config.YOUCAM_API_KEY


def cache_key(src_key: str, ref_url: str, category: str, change_shoes: bool = False) -> str:
    return hashlib.sha256(f"{src_key}|{ref_url}|{category}|{int(change_shoes)}".encode()).hexdigest()[:32]


def _client(auth=True) -> httpx.AsyncClient:
    headers = {"Authorization": f"Bearer {config.YOUCAM_API_KEY}"} if auth else {}
    return httpx.AsyncClient(base_url=config.YOUCAM_HOST, headers=headers, timeout=30, transport=_transport)


def _sem(name: str, n: int) -> asyncio.Semaphore:
    # ponytail: one dict entry per session, never pruned; fine for a demo-sized process
    k = (id(asyncio.get_running_loop()), name)
    return _sems.setdefault(k, asyncio.Semaphore(n))


def _fresh(row: dict | None) -> str:
    if not row or not row.get("result_url"):
        return ""
    age = (datetime.now(UTC) - datetime.fromisoformat(row["created_at"])).total_seconds()
    return row["result_url"] if age < config.RESULT_TTL_S else ""


def result_src(key: str, url_local: str) -> Src:
    """The Src for chaining onto a finished render (YouCam URL while fresh, else our local copy)."""
    row = q1("select result_url, created_at from renders where cache_key=?", key)
    return Src(key=key, url=_fresh(row) or None, path=config.media_path(url_local))


def is_cached(key: str) -> bool:
    row = q1("select local_path from renders where cache_key=? and status='success'", key)
    return bool(row) and config.media_path(row["local_path"]).exists()


def _code(r: httpx.Response) -> str:
    try:
        b = r.json()
    except ValueError:
        return f"http_{r.status_code}"
    for k in ("error_code", "error", "message", "status"):
        if isinstance(b.get(k), str):
            return b[k]
    return f"http_{r.status_code}"


async def _send(c: httpx.AsyncClient, method: str, url: str, **kw) -> dict:
    """One request with 429 backoff. Non-2xx -> RenderError(code)."""
    global _credit_flip
    for wait in (*config.BACKOFF, None):
        r = await c.request(method, url, **kw)
        if r.status_code == 429 and wait is not None:
            await asyncio.sleep(wait)
            continue
        if r.status_code >= 400:
            code = _code(r)
            if "CreditInsufficiency" in r.text:
                _credit_flip = True
                raise RenderUnavailable()
            raise RenderError("InvalidParameters" if "InvalidParameters" in r.text else code)
        return r.json()
    raise RenderError("rate_limited")


def _result_url(data: dict) -> str:
    res = data.get("results") or {}
    if isinstance(res, list):
        res = res[0] if res else {}
    if isinstance(res, str):
        return res
    for k in ("url", "video_url", "result_url"):
        if isinstance(res.get(k), str):
            return res[k]
    return next((v for v in res.values() if isinstance(v, str) and v.startswith("http")), "")


async def _poll(c: httpx.AsyncClient, path: str) -> dict:
    while True:
        d = (await _send(c, "GET", path)).get("data", {})
        if d.get("task_status") == "success":
            return d
        if d.get("task_status") == "error":
            raise RenderError(str(d.get("error") or "task_error"))
        await asyncio.sleep(config.POLL_S)


async def _download(url: str, dest: Path) -> None:
    async with _client(auth=False) as c:
        r = await c.get(url)
        r.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)


async def upload(path: Path, feature: str = "cloth") -> str:
    """File API: register the file, then PUT the bytes to the signed URL. Returns file_id. 0 units.
    Non-cloth features fall back to the cloth file endpoint if their own one refuses."""
    path = Path(path)
    data = path.read_bytes()
    ctype = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    spec = {"files": [{"content_type": ctype, "file_name": path.name, "file_size": len(data)}]}
    async with _client() as c:
        try:
            d = (await _send(c, "POST", f"/s2s/v2.0/file/{feature}", json=spec)).get("data", {})
        except RenderError:
            if feature == "cloth":
                raise
            d = (await _send(c, "POST", "/s2s/v2.0/file/cloth", json=spec)).get("data", {})
    f = d["files"][0]
    req = (f.get("requests") or d.get("requests"))[0]
    async with _client(auth=False) as c:
        r = await c.put(req["url"], content=data, headers=req.get("headers") or {"Content-Type": ctype})
        r.raise_for_status()
    return f["file_id"]


async def _src_field(src: Src, feature: str = "cloth") -> dict:
    if src.url:
        return {"src_file_url": src.url}
    if src.file_id:
        return {"src_file_id": src.file_id}
    rel = _media_url(src.path)
    if config.PUBLIC_BASE_URL and rel:
        return {"src_file_url": config.public_url(rel)}
    ukey = src.key if feature == "cloth" else f"{feature}:{src.key}"  # file ids may be scoped per feature
    row = q1("select file_id from uploads where src_key=?", ukey)
    if row:
        return {"src_file_id": row["file_id"]}
    fid = await upload(src.path, feature)
    ex("insert or replace into uploads(src_key, file_id, created_at) values (?,?,?)", ukey, fid, now())
    return {"src_file_id": fid}


def _media_url(path: Path | None) -> str | None:
    if not path:
        return None
    p = Path(path).resolve()
    for base, prefix in ((config.MODELS_DIR.resolve(), "/media/models/"), (config.MEDIA_DIR.resolve(), "/media/")):
        if p.is_relative_to(base):
            return prefix + str(p.relative_to(base))
    return None


def _log(key, src_key, ref, cat, session_id, **cols) -> None:
    ex("insert into renders(cache_key, src_key, ref_url, garment_category, session_id, created_at) values (?,?,?,?,?,?) "
       "on conflict(cache_key) do nothing", key, src_key, ref, cat, session_id, now())
    sets = ", ".join(f"{k}=?" for k in cols)
    ex(f"update renders set {sets}, created_at=? where cache_key=?", *cols.values(), now(), key)


async def _stub(src: Src, key: str, category: str, ref_url: str) -> TryOnResult:
    """RENDER_STUB=1: no network, no DB. The source photo with a coloured band where the garment goes."""
    await asyncio.sleep(0.05)
    dest = config.MEDIA_DIR / "stub" / f"{key}.jpg"
    if not dest.exists():
        try:
            im = Image.open(src.path).convert("RGB")
        except Exception:
            im = Image.new("RGB", (768, 1024), "#E6E2DB")
        w, h = im.size
        y0, y1 = {"upper_body": (0.25, 0.55), "lower_body": (0.5, 0.9), "outer": (0.22, 0.6)}.get(category, (0.22, 0.9))
        hue = int(hashlib.md5(ref_url.encode()).hexdigest()[:6], 16)
        ImageDraw.Draw(im).rectangle((w * 0.25, h * y0, w * 0.75, h * y1), fill=f"#{hue:06x}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "JPEG", quality=80)
    return TryOnResult(f"/media/stub/{key}.jpg", "", key, False, 0, 50)


async def try_on(src: Src, ref_url: str, category: str, change_shoes=False, session_id=None) -> TryOnResult:
    key = cache_key(src.key, ref_url, category, change_shoes)
    t0 = time.monotonic()
    if config.RENDER_STUB:
        return await _stub(src, key, category, ref_url)
    row = q1("select * from renders where cache_key=? and status='success'", key)
    if row and config.media_path(row["local_path"]).exists():
        ex("update renders set cached_hits=cached_hits+1 where cache_key=?", key)
        return TryOnResult(row["local_path"], _fresh(row), key, True, 0, int((time.monotonic() - t0) * 1000))
    if demo_mode():
        raise RenderUnavailable()
    if session_id:
        n = q1("select count(*) n from renders where session_id=? and task_id is not null", session_id)["n"]
        if n >= config.SESSION_RENDER_CAP:
            raise RenderError("session_cap", CAPPED)
    if key not in _inflight:  # identical concurrent requests share one call
        _inflight[key] = asyncio.ensure_future(_cloth(src, ref_url, category, change_shoes, key, session_id))
        _inflight[key].add_done_callback(lambda _: _inflight.pop(key, None))
    return await asyncio.shield(_inflight[key])


async def _cloth(src, ref_url, category, change_shoes, key, session_id) -> TryOnResult:
    async with _sem("global", config.GLOBAL_CONCURRENCY), _sem(f"s:{session_id}", config.SESSION_CONCURRENCY):
        t0 = time.monotonic()
        try:
            async with asyncio.timeout(config.TASK_TIMEOUT), _client() as c:
                body = {**await _src_field(src), "ref_file_url": ref_url, "garment_category": category,
                        "change_shoes": change_shoes}
                try:
                    d = await _send(c, "POST", "/s2s/v2.0/task/cloth-v4", json=body)
                except RenderError as e:
                    if e.code != "InvalidParameters" or category == "auto":
                        raise
                    d = await _send(c, "POST", "/s2s/v2.0/task/cloth-v4", json={**body, "garment_category": "auto"})
                task_id = d["data"]["task_id"]
                _log(key, src.key, ref_url, category, session_id, task_id=task_id, status="running")
                remote = _result_url(await _poll(c, f"/s2s/v2.0/task/cloth-v4/{task_id}"))
                local = f"/media/renders/{key}.jpg"
                await _download(remote, config.media_path(local))
        except TimeoutError:
            _log(key, src.key, ref_url, category, session_id, status="error", error="timeout")
            raise RenderError("timeout") from None
        except RenderError as e:
            if not isinstance(e, RenderUnavailable):
                _log(key, src.key, ref_url, category, session_id, status="error", error=e.code)
            raise
        except httpx.HTTPError as e:
            _log(key, src.key, ref_url, category, session_id, status="error", error=type(e).__name__)
            raise RenderError("network") from e
        ms = int((time.monotonic() - t0) * 1000)
        _log(key, src.key, ref_url, category, session_id, status="success", result_url=remote, local_path=local,
             units=config.CLOTH_UNITS, latency_ms=ms, error=None)
        return TryOnResult(local, remote, key, False, config.CLOTH_UNITS, ms)


async def image_to_video(src: Src | str, prompt: str, src_key: str | None = None) -> str:
    """5 s 480p clip of a finished render. Cached in `renders` (category 'video'). Returns our /media URL.
    src: a URL, or a Src (fresh YouCam URL, else PUBLIC_BASE_URL, else the local file uploaded once per render)."""
    if isinstance(src, str):
        src = Src(key=src_key or src, url=src)
    src_key, src_url = src.key, src.url or src.key
    key = cache_key(src_key, prompt, "video")
    local = f"/media/videos/{key}.mp4"
    if config.RENDER_STUB:
        config.media_path(local).parent.mkdir(parents=True, exist_ok=True)
        config.media_path(local).write_bytes(b"")
        return local
    if is_cached(key):
        ex("update renders set cached_hits=cached_hits+1 where cache_key=?", key)
        return local
    # A task still running at YouCam (already paid for) is resumed, never paid for again. Only a real YouCam error
    # (task_status error, a 4xx) ends it; a timeout or a network blip leaves it running for the next poll.
    prev = q1("select task_id from renders where cache_key=? and task_id is not null and (status='running' or "
              "(status='error' and error in ('timeout','network')))", key)
    if demo_mode() and not (prev and config.YOUCAM_API_KEY):
        raise RenderUnavailable()
    t0 = time.monotonic()
    task_id = prev["task_id"] if prev else None
    try:
        async with asyncio.timeout(config.VIDEO_TIMEOUT), _client() as c:
            if not task_id:
                body = {**await _src_field(src, "image-to-video"), "resolution": "480", "dst_duration": 5, "prompt": prompt}
                d = await _send(c, "POST", "/s2s/v2.0/task/image-to-video/youcam", json=body)
                task_id = d["data"]["task_id"]
            _log(key, src_key, src_url, "video", None, task_id=task_id, status="running", error=None)
            remote = _result_url(await _poll(c, f"/s2s/v2.0/task/image-to-video/youcam/{task_id}"))
            await _download(remote, config.media_path(local))
    except TimeoutError:
        if task_id:
            raise VideoPending() from None
        raise RenderError("timeout", "The clip took too long. Try again in a minute.") from None
    except httpx.HTTPError as e:
        if task_id:
            raise VideoPending() from e
        raise RenderError("network") from e
    except RenderError as e:
        if task_id and e.code.startswith("http_5"):  # YouCam hiccup while polling: the task itself is fine
            raise VideoPending() from e
        if task_id and not isinstance(e, RenderUnavailable):
            _log(key, src_key, src_url, "video", None, status="error", error=e.code)
        raise
    _log(key, src_key, src_url, "video", None, status="success", result_url=remote, local_path=local,
         units=config.VIDEO_UNITS, latency_ms=int((time.monotonic() - t0) * 1000), error=None)
    return local


async def units_left() -> int | None:
    global _units_cache
    if config.RENDER_STUB or not config.YOUCAM_API_KEY:
        return None
    if time.monotonic() - _units_cache[0] < 60:
        return _units_cache[1]
    try:
        async with asyncio.timeout(5), _client() as c:
            b = (await c.get("/s2s/v1.0/client/credit")).json()
        res = b.get("results") or b.get("data", {}).get("results") or []
        n = int(res[0]["amount"])
    except Exception:
        n = None
    _units_cache = (time.monotonic(), n)
    return n
