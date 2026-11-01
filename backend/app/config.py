"""All configuration. Reads the repo-root .env (stdlib parse); real env vars win. Nothing else reads env."""

import os
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DATA_DIR = ROOT / "data"
MODELS_DIR = DATA_DIR / "models"
WEB_DIST = ROOT / "web" / "dist"


def _dotenv() -> dict[str, str]:
    p = ROOT / ".env"
    if not p.exists():
        return {}
    out = {}
    for line in p.read_text().splitlines():
        k, sep, v = line.strip().partition("=")
        if sep and not k.startswith("#"):
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


_FILE = _dotenv()


def env(key: str, default: str = "") -> str:
    return os.environ.get(key) or _FILE.get(key) or default


def flag(key: str) -> bool:
    return env(key).lower() in ("1", "true", "yes")


YOUCAM_API_KEY = env("YOUCAM_API_KEY")
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY")
PUBLIC_BASE_URL = env("PUBLIC_BASE_URL").rstrip("/")
WEB_URL = env("WEB_URL").rstrip("/")  # where shoppers open the store (share links); empty = derive per request
YOUCAM_DEMO_MODE = flag("YOUCAM_DEMO_MODE")
RENDER_STUB = flag("RENDER_STUB")

# Storage. Media lives next to the DB, so ELARA_DB_PATH=/tmp/x/elara.db puts media in /tmp/x/media.
DB_PATH = Path(env("ELARA_DB_PATH", str(BACKEND / "var" / "elara.db")))
MEDIA_DIR = DB_PATH.parent / "media"

# Models
AGENT_MODEL = "claude-sonnet-5-5"
JUDGE_MODEL = "claude-haiku-4-5"

# YouCam
YOUCAM_HOST = "https://yce-api-01.makeupar.com"
CLOTH_UNITS = 2
VIDEO_UNITS = 5
SESSION_RENDER_CAP = 20  # live (uncached) cloth-v4 calls per session
GLOBAL_CONCURRENCY = 8
SESSION_CONCURRENCY = 4
TASK_TIMEOUT = 60
VIDEO_TIMEOUT = 720  # one polling window; YouCam i2v took 277 s and >420 s live (11-01). After it the look stays
# `pending` and the next GET resumes polling the same paid task_id; only a real YouCam error marks it failed.
POLL_S = 2.0
BACKOFF = (2, 4, 8)
RESULT_TTL_S = 105 * 60  # YouCam result URLs live 2 h; treat them as stale a bit earlier

STORE = {
    "id": "northline",
    "name": "Northline",
    "currency": "INR",
    "genders": ["women", "men"],
    "slots": ["top", "bottom", "one_piece", "layer", "bag", "accessory"],
    "occasions": ["Beach trip", "Wedding", "Office", "Date night", "Everyday", "Festival"],
    "budget": {"min": 2000, "max": 30000, "step": 500, "default": 7000},
}
VIBES = ["minimal", "bold", "classic", "street", "boho", "sporty", "romantic", "edgy"]


def media_path(url: str) -> Path:
    """'/media/renders/x.jpg' -> the file on disk."""
    rel = url.removeprefix("/media/")
    if rel.startswith("models/"):
        return MODELS_DIR / rel.removeprefix("models/")
    return MEDIA_DIR / rel


def public_url(url: str) -> str | None:
    return f"{PUBLIC_BASE_URL}{url}" if PUBLIC_BASE_URL else None


def web_url(origin: str | None = None, referer: str | None = None) -> str:
    """The web app's origin for share links: WEB_URL, else the browser's Origin/Referer, else PUBLIC_BASE_URL,
    else the dev server."""
    for u in (WEB_URL, origin, referer):
        p = urlsplit(u or "")
        if p.scheme in ("http", "https") and p.netloc:
            return f"{p.scheme}://{p.netloc}"
    return PUBLIC_BASE_URL or "http://localhost:5180"
