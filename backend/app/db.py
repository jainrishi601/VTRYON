"""SQLite (stdlib). One shared autocommit connection; JSON columns are encoded/decoded here."""

import json
import secrets
import sqlite3
import string
from datetime import UTC, datetime

from app import config

SCHEMA = """
create table if not exists sessions(id text primary key, user_token text, store_id text, brief text, shopping_for text,
  photo_url text, src_url text /* source key: photo:<sha256> | model:<id> */, sample_model_id text, created_at text);
create index if not exists sessions_token on sessions(user_token);
create table if not exists looks(id text primary key, session_id text, name text, why text, items text, total integer,
  score integer, score_reason text, parent_look_id text, budget_max integer,
  render_status text default 'pending', render_url text, render_error text, render_steps_done integer default 0,
  render_steps_total integer default 0, render_key text, render_cached integer default 0,
  video_status text default 'none', video_url text, created_at text);
create index if not exists looks_session on looks(session_id);
create table if not exists renders(id integer primary key, cache_key text unique, src_key text, ref_url text,
  garment_category text, task_id text, status text, result_url text, local_path text, units integer default 0,
  latency_ms integer, cached_hits integer default 0, error text, session_id text, created_at text);
create table if not exists uploads(src_key text primary key, file_id text, created_at text);
create table if not exists nodes(id integer primary key, user_token text, type text, key text, attrs text,
  unique(user_token, type, key));
create table if not exists edges(id integer primary key, user_token text, from_node integer, to_node integer, type text,
  weight real, scope text, created_at text);
create index if not exists edges_token on edges(user_token);
create table if not exists messages(id integer primary key, session_id text, role text, content text, created_at text);
create index if not exists messages_session on messages(session_id);
create table if not exists tiles(id text primary key, session_id text, vibe text, product_id text, look_id text,
  created_at text);
create table if not exists crews(id text primary key, name text, occasion text, owner_session_id text, created_at text);
create table if not exists crew_members(id text primary key, crew_id text, member_token text, display_name text,
  photo_url text, src_url text, is_owner integer default 0, created_at text);
create table if not exists crew_looks(crew_id text, look_id text, added_at text, primary key(crew_id, look_id));
create table if not exists crew_member_renders(crew_id text, look_id text, member_id text, look_render_id text,
  primary key(crew_id, look_id, member_id));
create table if not exists crew_comments(id text primary key, crew_id text, look_id text, slot text, member_id text,
  text text, reaction text, created_at text);
"""
JSON_COLS = {"brief", "shopping_for", "items", "attrs", "content"}

_conn: sqlite3.Connection | None = None
_path = None


def conn() -> sqlite3.Connection:
    global _conn, _path
    if _conn is None or _path != config.DB_PATH:  # tests swap DB_PATH per test
        config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False, isolation_level=None)
        _conn.row_factory = sqlite3.Row
        _conn.execute("pragma journal_mode=wal")
        _path = config.DB_PATH
    return _conn


def init_db() -> None:
    conn().executescript(SCHEMA)
    for d in ("renders", "photos", "share", "videos", "stub", "thumbs"):
        (config.MEDIA_DIR / d).mkdir(parents=True, exist_ok=True)


def _enc(a):
    return json.dumps(a) if isinstance(a, dict | list | tuple) else a


def _row(r: sqlite3.Row) -> dict:
    d = dict(r)
    for k in JSON_COLS & d.keys():
        if isinstance(d[k], str):
            d[k] = json.loads(d[k])
    return d


def q(sql: str, *args) -> list[dict]:
    return [_row(r) for r in conn().execute(sql, [_enc(a) for a in args]).fetchall()]


def q1(sql: str, *args) -> dict | None:
    r = conn().execute(sql, [_enc(a) for a in args]).fetchone()
    return _row(r) if r else None


def ex(sql: str, *args) -> int:
    """Execute a write; returns lastrowid. dict/list args are stored as JSON text."""
    return conn().execute(sql, [_enc(a) for a in args]).lastrowid


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def new_id(prefix: str = "", n: int = 10) -> str:
    return prefix + "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(n))
