"""Seed the TRYON demo profile: "Priya" (the same shopper token as the store demo and the Goa trip crew), onboarded,
with a finished Style DNA, the w1 sample model as her try-on photo, and an 8-piece wardrobe made from catalogue
images. Re-running restores it (wardrobe, profile, today's picks), so a demo that deleted pieces can be reset.

    uv run --project backend python scripts/seed_tryon_demo.py          # free: only cached renders start
    uv run --project backend python scripts/seed_tryon_demo.py --yes    # also renders today's picks (prints units)

Sign in at /tryon/login with "Try the demo profile" (or demo@tryon.style / tryon-demo).
"""

import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app import catalog, config, db, dna, looks, renders, sessions, tryon, youcam  # noqa: E402
from app.db import ex, new_id, q, q1  # noqa: E402

EMAIL, PASSWORD, NAME = "demo@tryon.style", "tryon-demo", "Priya"
PRIYA = "demo-priya-token-000000000"  # the store demo shopper (scripts/seed_demo.py): one person across both
MODEL = "w1"

# (catalogue id, the name she'd give it, category) - bottoms first so the picks pair store tops with her own bottoms.
WARDROBE = [
    ("nl-0125", "Ivory palazzos", "palazzos"),
    ("nl-0128", "Olive wide trousers", "trousers"),
    ("nl-0049", "Khaki cotton shirt", "shirt"),
    ("nl-0035", "Black jersey top", "t_shirt"),
    ("nl-0054", "Blue check necktie top", "blouse"),
    ("nl-0261", "Oatmeal overlay", "cardigan"),
    ("nl-0217", "Denim pocket dress", "dress"),
    ("nl-0283", "Striped shoulder bag", "shoulder_bag"),
]
PROFILE = {
    "goal": "utilise", "gender": "women", "profession": "Designer", "age_range": "25–34",
    "sizes": {"region": "India", "tops": "S", "bottoms": "M", "dresses": "S"}, "height_cm": 165, "weight_kg": 58,
    "colors": ["Ivory", "Beige", "Camel", "Olive", "Sage", "Navy", "Sky", "Rust"],
    "never": ["pattern:animal", "category:jumpsuit"], "onboarded": True, "step": 0,
}
PALETTE = {"undertone": "warm", "analyzed": True, "recommended": ["Ivory", "Beige", "Camel", "Olive", "Sage", "Rust"],
           "summary": "Warm, medium-deep colouring: earthy neutrals, olive and rust glow on you; icy pastels can wash "
                      "you out."}
VOTES = {"minimal": "love", "classic": "love", "boho": "like", "romantic": "like", "bold": "dislike",
         "street": "like", "sporty": "dislike", "edgy": "dislike"}


def account() -> str:
    u = q1("select id, user_token from users where email=?", EMAIL)
    if not u:
        tryon.signup(NAME, EMAIL, PASSWORD, user_token=PRIYA)
        u = q1("select id, user_token from users where email=?", EMAIL)
    return u["id"]


def photo(uid: str) -> None:
    url, key = sessions.model_photo(MODEL)
    s = tryon.photo_session(uid)
    ex("update sessions set photo_url=?, src_url=?, photo_gender='women' where id=?", url, key, s["id"])
    tryon.save_profile_raw(uid, {"body_url": url, "body_key": key, "selfie_url": url, "palette": PALETTE})


def vibes(uid: str) -> list[str]:
    """Vote every vibe tile; start only the tile renders that are cached for the sample model (0 units)."""
    started = []
    for t in tryon.vibes(uid):
        lid = q1("select look_id from tiles where id=?", t["id"])["look_id"]
        items = looks.hydrate(q1("select items from looks where id=?", lid)["items"])
        if t["status"] != "ready" and all(youcam.is_cached(k) for k in renders.planned_keys(renders.plan(items),
                                                                                             f"model:{MODEL}")):
            looks.start_render(lid, memory=False)
            started.append(lid)
        if t["vibe"] in VOTES:
            tryon.vote_vibe(uid, t["id"], VOTES[t["vibe"]])
    return started


def wardrobe(tok: str) -> None:
    ex("delete from wardrobe where user_token=?", tok)
    t0 = datetime.now(UTC)
    for i, (pid, name, category) in enumerate(WARDROBE):
        p = catalog.get(pid)
        if not p:
            print(f"  skip {pid}: not in the catalogue")
            continue
        img = p["image_url"] + ("&" if "?" in p["image_url"] else "?") + "width=900"
        made = (t0 - timedelta(days=len(WARDROBE) - i)).isoformat(timespec="seconds")  # stable, oldest first
        ex("insert into wardrobe(id, user_token, image_url, name, slot, category, colors, color_family, pattern, fabric, "
           "vibes, formality, fit, occasions, season, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
           new_id("w_", 10), tok, img, name, p["slot"], category, p.get("colors") or [], p.get("color_family") or "",
           p.get("pattern") or "solid", (p.get("fabric") or "")[:40], (p.get("vibes") or [])[:3],
           p.get("formality") or 2, p.get("fit") if p.get("fit") in ("relaxed", "regular", "fitted") else None,
           (p.get("occasions") or [])[:4], ["summer", "monsoon"], made)
        for v in (p.get("vibes") or [])[:3]:
            dna.add_edge(tok, "owns", "vibe", v, 0.3)
        if p.get("color_family"):
            dna.add_edge(tok, "owns", "color", p["color_family"], 0.3)


async def picks(uid: str, spend: bool, waiting: list[str]) -> None:
    ex("delete from daily_picks where user_id=?", uid)
    out = await tryon.daily(uid)
    cost = 0
    for pk in out:
        lk = pk["look"]
        own = sum(1 for it in lk["items"] if it["product"].get("owned"))
        keys = renders.planned_keys(renders.plan(looks.hydrate(q1("select items from looks where id=?", lk["id"])["items"])),
                                    f"model:{MODEL}")
        n = sum(not youcam.is_cached(k) for k in keys)
        cost += n * config.CLOTH_UNITS
        print(f"  {pk['kind']:7} {lk['name']:22} {len(lk['items'])} pieces, {own} hers, {n} uncached render steps")
        if keys and (n == 0 or spend):
            looks.start_render(lk["id"], memory=False)
            waiting.append(lk["id"])
    if cost and not spend:
        print(f"  Rendering the uncached picks would cost {cost} units: re-run with --yes to spend them.")
    async for lj in looks.wait_settled(waiting, timeout=240):
        print(f"  {lj['id']} {lj['render']['status']} {lj['render']['error'] or ''}")


async def seed(spend: bool) -> None:
    uid = account()
    tok = q1("select user_token from users where id=?", uid)["user_token"]
    tryon.save_profile(uid, PROFILE)
    if not tryon.profile(uid).get("body_url"):
        tryon.start_vibes(uid)  # tiles before the photo, so start_vibes queues no paid renders
    photo(uid)
    waiting = vibes(uid)
    wardrobe(tok)
    for c in ("Ivory", "Olive"):  # a little learned taste beyond the vibes
        dna.add_edge(tok, "liked_outfit", "color", tryon.PALETTE[c]["family"], 0.6)
    await picks(uid, spend, waiting)
    print(f"{NAME}: {EMAIL} / {PASSWORD}, token {tok}, DNA {dna.summary(tok).get('name')}, "
          f"{len(q('select 1 from wardrobe where user_token=?', tok))} wardrobe pieces.")


def main(argv=sys.argv[1:]) -> None:
    db.init_db()
    catalog.load()
    spend = "--yes" in argv
    if spend:
        config.YOUCAM_DEMO_MODE = False
    asyncio.run(seed(spend))


if __name__ == "__main__":
    main()
