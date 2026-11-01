"""Warm the YouCam cache for the demo: Style DNA tiles (every sample model x 8 vibes) and the 12 demo looks.

    uv run --project backend python scripts/prerender.py          # print the plan and its unit cost only
    uv run --project backend python scripts/prerender.py --yes    # spend the units (skips anything cached)
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app import catalog, config, db, dna, renders, sessions, youcam  # noqa: E402


def plan() -> list[tuple[str, str, list[dict]]]:
    """[(label, model_id, steps)]"""
    jobs = []
    for m in sessions.models():
        for v in config.VIBES:
            p = dna.representative(v, m["gender"])
            if p:
                jobs.append((f"tile {m['id']} {v}", m["id"], renders.plan([{"slot": p["slot"], "product": p}])))
    first = {g: next(m["id"] for m in sessions.models() if m["gender"] == g) for g in ("women", "men")}
    for lk in json.loads((config.DATA_DIR / "demo_looks.json").read_text()):
        items = [{"slot": it["slot"], "product": catalog.get(it["product_id"])} for it in lk["items"]]
        jobs.append((f"look {lk['id']} {lk['name']}", first[lk["gender"]], renders.plan(items)))
    return jobs


def uncached(jobs) -> int:
    return sum(not youcam.is_cached(k) for _, mid, steps in jobs for k in renders.planned_keys(steps, f"model:{mid}"))


async def run(jobs) -> None:
    async def one(label, mid, steps):
        url, key = sessions.model_photo(mid)
        try:
            res, cached = await renders.run(steps, sessions.src_for(url, key))
            print(f"  ok   {label:44} {'cached' if cached else 'live'}  {res.url_local}")
        except youcam.RenderError as e:
            print(f"  FAIL {label:44} {e.code}")

    await asyncio.gather(*(one(*j) for j in jobs), return_exceptions=True)


def main(argv=sys.argv[1:]) -> None:
    db.init_db()
    catalog.load()
    jobs = plan()
    calls = uncached(jobs)
    print(f"{len(jobs)} renders planned ({sum(len(s) for *_, s in jobs)} steps); "
          f"{calls} uncached calls = {calls * config.CLOTH_UNITS} units.")
    if not calls:
        return print("Everything is cached.")
    units = asyncio.run(youcam.units_left())
    if units is not None:
        print(f"Units left on the key: {units}")
    if "--yes" not in argv:
        return print("Dry run. Re-run with --yes to spend the units.")
    config.YOUCAM_DEMO_MODE = False  # an explicit --yes is the go-ahead to spend
    asyncio.run(run(jobs))
    print(f"Done. {uncached(jobs)} calls still uncached.")


if __name__ == "__main__":
    main()
