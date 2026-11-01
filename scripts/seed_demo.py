"""Seed the demo: returning shopper "Priya" and the "Goa trip crew" (Priya, Meera with a photo, Ananya without), three
beach looks with Meera's member renders, and comments with one reaction per friend per piece. Idempotent: every run
puts the crew back in exactly this state (extra members, looks and reactions from testing are removed). Renders come
from the cache (run prerender.py first); Priya finds the crew from her session (`crews` on POST /api/session).

    uv run --project backend python scripts/seed_demo.py          # seeds if every render is cached, else prints cost
    uv run --project backend python scripts/seed_demo.py --yes    # also spends units on anything uncached (max 20)
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
OWNER = ("m_demopriya", PRIYA, "Priya", "w1")
MEERA = ("m_demomeera", "demo-meera-token-00000000", "Meera", "w2")
ANANYA = ("m_demoananya", "demo-ananya-token-0000000", "Ananya", None)
BRIEF = {"for": "self", "gender": "women", "occasion": "Beach trip", "budget_max": 7000}
MAX_UNITS = 20
# (member, look index, slot, text, reaction): at most one reaction per member per piece, as the API enforces.
# Verdicts: look 1 "2 of 3 love it", look 2 "1 of 3 love it" (one wants changes), look 3 "2 of 3 love it".
COMMENTS = [
    (MEERA, 0, "bottom", "the trousers are a yes", "up"),
    (ANANYA, 0, "top", "swap the top for the white one", "swap"),
    (MEERA, 0, None, None, "up"),
    (ANANYA, 0, None, None, "up"),
    (MEERA, 1, "top", "this colour on you though", "up"),
    (ANANYA, 1, None, "a bit loud for the beach?", "down"),
    (MEERA, 2, None, "obsessed with this one", "up"),
    (ANANYA, 2, "one_piece", None, "up"),
]


def demo_looks() -> list[dict]:
    rows = json.loads((config.DATA_DIR / "demo_looks.json").read_text())
    return [lk for lk in rows if lk["gender"] == "women" and lk["occasion"] == "beach"
            and lk["total"] <= BRIEF["budget_max"]][:3]


def uncached_calls(lks) -> int:
    n = 0
    for lk in lks:
        steps = renders.plan(looks.hydrate(lk["items"]))
        for mid in (OWNER[3], MEERA[3]):
            n += sum(not youcam.is_cached(k) for k in renders.planned_keys(steps, f"model:{mid}"))
    return n


def member(mid, token, name, model_id, owner=False):
    url, key = sessions.model_photo(model_id) if model_id else (None, None)
    ex("insert into crew_members(id, crew_id, member_token, display_name, photo_url, src_url, is_owner, created_at) "
       "values (?,?,?,?,?,?,?,?) on conflict(id) do update set crew_id=excluded.crew_id, member_token=excluded."
       "member_token, display_name=excluded.display_name, photo_url=excluded.photo_url, src_url=excluded.src_url, "
       "is_owner=excluded.is_owner", mid, CREW, token, name, url, key, int(owner), now())


def reset_members() -> None:
    keep = (OWNER[0], MEERA[0], ANANYA[0])
    for m in q(f"select id, display_name from crew_members where crew_id=? and id not in ({','.join('?' * 3)})",
               CREW, *keep):
        print(f"  removing test member {m['display_name']}")
        for t in ("crew_member_renders", "crew_comments"):
            ex(f"delete from {t} where crew_id=? and member_id=?", CREW, m["id"])
        ex("delete from crew_members where id=?", m["id"])
    member(*OWNER, owner=True)
    member(*MEERA)
    member(*ANANYA)


def crew_looks(lks) -> list[str]:
    """One crew look per demo look (matched by name), in order; anything else added while testing is removed."""
    have = {r["name"]: r["look_id"] for r in q("select l.name, c.look_id from crew_looks c join looks l on "
                                               "l.id=c.look_id where c.crew_id=? order by c.added_at", CREW)}
    for name, lid in have.items():
        if name not in {lk["name"] for lk in lks}:
            print(f"  removing test look {name}")
            ex("delete from crew_looks where crew_id=? and look_id=?", CREW, lid)
            ex("delete from crew_comments where crew_id=? and look_id=?", CREW, lid)
    ids = []
    for lk in lks:
        lid = have.get(lk["name"]) or looks.create_look(
            SID, lk["name"], lk["why"], [(it["slot"], it["product_id"]) for it in lk["items"]])["id"]
        looks.start_render(lid, memory=False)
        crew.add_look(CREW, lid)  # idempotent; queues Meera's render if it's missing
        ids.append(lid)
    return ids


def reset_comments(look_ids) -> None:
    want = {(m[0], look_ids[i], slot, text, r) for m, i, slot, text, r in COMMENTS}
    got = {(c["member_id"], c["look_id"], c["slot"], c["text"], c["reaction"])
           for c in q("select * from crew_comments where crew_id=?", CREW)}
    if got == want:
        return
    print("  resetting comments and reactions")
    ex("delete from crew_comments where crew_id=?", CREW)
    for m, i, slot, text, r in COMMENTS:
        crew.comment(CREW, m[1], look_ids[i], slot, text, r)


async def seed(lks) -> None:
    url, key = sessions.model_photo(OWNER[3])
    if not q1("select 1 from sessions where id=?", SID):
        ex("insert into sessions(id, user_token, store_id, brief, photo_url, src_url, sample_model_id, created_at) "
           "values (?,?,?,?,?,?,?,?)", SID, PRIYA, "northline", BRIEF, url, key, OWNER[3], now())
    if not q("select 1 from edges where user_token=?", PRIYA):
        dna.pick(PRIYA, "minimal", "white", "heart")
        dna.pick(PRIYA, "boho", "beige", "heart")
        dna.add_edge(PRIYA, "liked_outfit", "vibe", "minimal", 0.8)
    if q1("select 1 from crews where id=?", CREW):
        ex("update crews set name='Goa trip crew', occasion='Beach trip', owner_session_id=? where id=?", SID, CREW)
    else:
        ex("insert into crews(id, name, occasion, owner_session_id, created_at) values (?,?,?,?,?)",
           CREW, "Goa trip crew", "Beach trip", SID, now())
    reset_members()
    look_ids = crew_looks(lks)
    reset_comments(look_ids)
    mine = [r["look_render_id"] for r in q("select look_render_id from crew_member_renders where crew_id=?", CREW)]
    for lid in mine:
        looks.start_render(lid, memory=False)  # retries one that failed earlier; a no-op when ready
    async for lj in looks.wait_settled(look_ids + mine, timeout=240):
        print(f"  {lj['id']} {lj['name']:16} {lj['render']['status']:9} {lj['render']['error'] or ''}")
    c = crew.crew_json(CREW)
    print(f"Crew {c['name']}: {len(c['members'])} members, {len(c['looks'])} looks, {len(c['comments'])} comments, "
          f"{sum(len(cl['renders']) - 1 for cl in c['looks'])} member renders")
    for cl in c["looks"]:
        print(f"  {cl['look']['name']:16} {cl['verdict']['label']:18} renders "
              f"{[r['status'] for r in cl['renders']]}")
    print(f"Priya: token {PRIYA}, DNA {dna.summary(PRIYA)['name']}, session crews "
          f"{[x['name'] for x in crew.for_token(PRIYA)]}. Open /?crew={CREW}")


def main(argv=sys.argv[1:]) -> None:
    db.init_db()
    catalog.load()
    lks = demo_looks()
    n = uncached_calls(lks)
    units = n * config.CLOTH_UNITS
    print(f"Plan: {len(lks)} looks on Priya ({OWNER[3]}) and Meera ({MEERA[3]}); {n} uncached renders = {units} units.")
    if units > MAX_UNITS:
        return print(f"That is over the {MAX_UNITS}-unit seed budget. Run scripts/prerender.py first.")
    if n:
        if "--yes" not in argv:
            return print("Re-run with --yes to spend them (or run scripts/prerender.py --yes first).")
        config.YOUCAM_DEMO_MODE = False  # an explicit --yes is the go-ahead to spend
    asyncio.run(seed(lks))


if __name__ == "__main__":
    main()
