"""Seed the demo: returning shopper "Priya" and the "Goa trip crew" (Meera with a photo, Ananya without), two beach
looks with member renders, comments and reactions. Idempotent; renders come from the cache (run prerender.py first).

    uv run --project backend python scripts/seed_demo.py          # seeds if every render is cached, else prints cost
    uv run --project backend python scripts/seed_demo.py --yes    # also spends units on anything uncached
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app import catalog, config, crew, db, dna, looks, renders, sessions, youcam  # noqa: E402
from app.db import ex, now, q, q1  # noqa: E402

PRIYA = "demo-priya-token-000000000"
SID = "s_demopriya000000"
CREW = "goatripcrew2026x"
MEERA = ("m_demomeera", "demo-meera-token-00000000", "Meera", "w2")
ANANYA = ("m_demoananya", "demo-ananya-token-0000000", "Ananya", None)
BRIEF = {"for": "self", "gender": "women", "occasion": "Beach trip", "budget_max": 7000}


def demo_looks() -> list[dict]:
    rows = json.loads((config.DATA_DIR / "demo_looks.json").read_text())
    return [lk for lk in rows if lk["gender"] == "women" and lk["occasion"] == "beach"
            and lk["total"] <= BRIEF["budget_max"]][:2]


def uncached_calls(lks) -> int:
    n = 0
    for lk in lks:
        steps = renders.plan(looks.hydrate(lk["items"]))
        for mid in ("w1", MEERA[3]):
            n += sum(not youcam.is_cached(k) for k in renders.planned_keys(steps, f"model:{mid}"))
    return n


def member(mid, token, name, model_id, owner=False):
    if q1("select 1 from crew_members where id=?", mid):
        return
    url, key = sessions.model_photo(model_id) if model_id else (None, None)
    ex("insert into crew_members(id, crew_id, member_token, display_name, photo_url, src_url, is_owner, created_at) "
       "values (?,?,?,?,?,?,?,?)", mid, CREW, token, name, url, key, int(owner), now())


async def seed(lks) -> None:
    url, key = sessions.model_photo("w1")
    if not q1("select 1 from sessions where id=?", SID):
        ex("insert into sessions(id, user_token, store_id, brief, photo_url, src_url, sample_model_id, created_at) "
           "values (?,?,?,?,?,?,?,?)", SID, PRIYA, "northline", BRIEF, url, key, "w1", now())
    if not q("select 1 from edges where user_token=?", PRIYA):
        dna.pick(PRIYA, "minimal", "white", "heart")
        dna.pick(PRIYA, "boho", "beige", "heart")
        dna.add_edge(PRIYA, "liked_outfit", "vibe", "minimal", 0.8)
    if not q1("select 1 from crews where id=?", CREW):
        ex("insert into crews(id, name, occasion, owner_session_id, created_at) values (?,?,?,?,?)",
           CREW, "Goa trip crew", "Beach trip", SID, now())
    member("m_demopriya", PRIYA, "Priya", "w1", owner=True)
    member(*MEERA)
    member(*ANANYA)
    look_ids = [r["look_id"] for r in q("select look_id from crew_looks where crew_id=? order by added_at", CREW)]
    if not look_ids:
        for lk in lks:
            row = looks.create_look(SID, lk["name"], lk["why"], [(it["slot"], it["product_id"]) for it in lk["items"]])
            looks.start_render(row["id"], memory=False)
            crew.add_look(CREW, row["id"])  # queues Meera's render
            look_ids.append(row["id"])
    else:
        for lid in look_ids:
            looks.start_render(lid, memory=False)
    if not q1("select 1 from crew_comments where crew_id=?", CREW):
        a, b = look_ids[0], look_ids[-1]
        for tok, lid, slot, text, reaction in (
                (MEERA[1], a, "bottom", "the trousers are a yes", "up"),
                (ANANYA[1], a, "top", "swap the top for the white one", "swap"),
                (MEERA[1], a, None, None, "up"),
                (ANANYA[1], b, None, None, "up"),
                (MEERA[1], b, "top", "this colour on you though", "up")):
            crew.comment(CREW, tok, lid, slot, text, reaction)
    mine = [r["look_render_id"] for r in q("select look_render_id from crew_member_renders where crew_id=?", CREW)]
    async for lj in looks.wait_settled(look_ids + mine, timeout=240):
        print(f"  {lj['id']} {lj['name']:16} {lj['render']['status']:9} {lj['render']['error'] or ''}")
    c = crew.crew_json(CREW)
    print(f"Crew {c['name']}: {len(c['members'])} members, {len(c['looks'])} looks, {len(c['comments'])} comments, "
          f"verdicts {[cl['verdict']['label'] for cl in c['looks']]}")
    print(f"Priya: token {PRIYA}, DNA {dna.summary(PRIYA)['name']}. Open /?crew={CREW}")


def main(argv=sys.argv[1:]) -> None:
    db.init_db()
    catalog.load()
    lks = demo_looks()
    n = uncached_calls(lks)
    if n:
        print(f"{n} renders are not cached = {n * config.CLOTH_UNITS} units.")
        if "--yes" not in argv:
            return print("Run scripts/prerender.py --yes first, or re-run this with --yes to spend them.")
        config.YOUCAM_DEMO_MODE = False  # an explicit --yes is the go-ahead to spend
    asyncio.run(seed(lks))


if __name__ == "__main__":
    main()
