"""Agent evals E1-E15 (AGENT_SPEC §7, TEST_PLAN §2). In-process, renders stubbed, 0 YouCam units.

    uv run --project backend python scripts/run_evals.py [--only E3,E5] [--note "prompt v2"] [--no-judge]

Each scenario seeds a fresh session (brief, DNA, current looks, crew, photo), drives the real /api/chat SSE generator
turn by turn, then runs code assertions plus a Haiku judge for tone/pronoun rubrics. Writes docs/eval-results.md.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["RENDER_STUB"] = "1"
os.environ.setdefault("ELARA_DB_PATH", str(Path(tempfile.mkdtemp(prefix="elara-evals-")) / "elara.db"))

import anthropic  # noqa: E402
import yaml  # noqa: E402

from app import catalog, config, db, dna, looks, sessions  # noqa: E402
from app.agent import loop, routes  # noqa: E402

SCENARIOS = ROOT / "backend" / "tests" / "evals" / "scenarios.yaml"
RESULTS = ROOT / "docs" / "eval-results.md"
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


# ---------- seeding ----------

def seed(sc: dict) -> tuple[str, dict]:
    s, _, _ = sessions.create()
    sid = s["id"]
    if sc.get("brief"):
        db.ex("update sessions set brief=? where id=?", sc["brief"], sid)
    if sc.get("photo"):
        url, key = sessions.model_photo(sc["photo"])
        db.ex("update sessions set photo_url=?, src_url=?, sample_model_id=? where id=?", url, key, sc["photo"], sid)
    sess = sessions.get_session(sid)
    for edge_type, kind, value, w in sc.get("dna") or []:
        dna.add_edge(sess["user_token"], edge_type, kind, value, w, scope=sessions.scope(sess))
    seeded = {}
    if sc.get("looks"):
        for lk in sc["looks"]:
            made = looks.create_look(sid, lk["name"], "", [(catalog.get(p)["slot"], p) for p in lk["items"]])
            seeded[lk["key"]] = made
        db.ex("insert into messages(session_id, role, content, created_at) values (?,?,?,?)", sid, "user",
              {"text": "show me some looks"}, db.now())
        summary = "; ".join(f"“{m['name']}” ({m['id']}): " + " + ".join(it["product"]["title"]
                            for it in m["items"]) for m in seeded.values())
        db.ex("insert into messages(session_id, role, content, created_at) values (?,?,?,?)", sid, "assistant",
              {"text": "Here are a few looks to start with.", "look_ids": [m["id"] for m in seeded.values()],
               "summary": summary}, db.now())
    crew = sc.get("crew")
    if crew:
        cid = db.new_id("", 16)
        db.ex("insert into crews(id, name, occasion, owner_session_id, created_at) values (?,?,?,?,?)", cid,
              crew["name"], (sc.get("brief") or {}).get("occasion"), sid, db.now())
        mids = {}
        for name in crew["members"]:
            mids[name] = db.new_id("m_", 8)
            db.ex("insert into crew_members(id, crew_id, member_token, display_name, is_owner, created_at) "
                  "values (?,?,?,?,0,?)", mids[name], cid, db.new_id("", 24), name, db.now())
        for m in seeded.values():
            db.ex("insert into crew_looks(crew_id, look_id, added_at) values (?,?,?)", cid, m["id"], db.now())
        for c in crew["comments"]:
            db.ex("insert into crew_comments(id, crew_id, look_id, slot, member_id, text, reaction, created_at) "
                  "values (?,?,?,?,?,?,?,?)", db.new_id("c_", 10), cid, seeded[c["look"]]["id"], c.get("slot"),
                  mids[c["member"]], c.get("text"), c.get("reaction"), db.now())
    return sid, seeded


# ---------- running ----------

async def run_turn(sid: str, text: str, look_id: str | None, attachment: str | None) -> dict:
    t0 = time.monotonic()
    evs = []
    body = routes.ChatIn(session_id=sid, message=text, look_id=look_id, attachment_url=attachment)
    async for frame in routes._stream(body):
        lines = frame.strip().split("\n")
        evs.append((lines[0][7:], json.loads(lines[1][6:]), time.monotonic() - t0))
    first = lambda k: next((ts for e, _, ts in evs if e == k), None)  # noqa: E731
    lk = next((d for e, d, _ in evs if e == "looks"), None)
    final_looks = {}
    for e, d, _ in evs:
        if e == "looks":
            final_looks = {x["id"]: x for x in d["looks"]}
        elif e == "look":
            final_looks[d["look"]["id"]] = d["look"]
    return {
        "events": evs, "text": "".join(d["delta"] for e, d, _ in evs if e == "text"),
        "looks": [final_looks[x["id"]] for x in lk["looks"]] if lk else [],
        "clarifies": [_card(d) for e, d, _ in evs if e == "clarify"],
        "errors": [d for e, d, _ in evs if e == "error"],
        "t_first": first("status"), "t_text": first("text"), "t_looks": first("looks"), "t_total": time.monotonic() - t0,
        "trace": list(loop.TRACES.get(sid, [])),
    }


# ---------- assertions ----------

def _card(d: dict) -> dict:
    """The question card ({questions:[{question, options:[{label}]}]}) as one {question, chips} for the checks."""
    if "questions" not in d:
        return d
    qs = d["questions"]
    return {"question": " / ".join(q["question"] for q in qs),
            "chips": [o["label"] for q in qs for o in q.get("options") or []],
            "fields": [q.get("field") for q in qs]}


def mean_formality(lk: dict) -> float:
    f = [it["product"]["formality"] for it in lk["items"]]
    return sum(f) / len(f) if f else 0


def pids(lk: dict) -> set[str]:
    return {it["product"]["id"] for it in lk["items"]}


def check(exp: dict, last: dict, turns: list[dict], seeded: dict) -> list[str]:
    """Returns failure strings ([] = pass)."""
    f = []
    lks, text = last["looks"], last["text"]
    if "one_of" in exp:
        alts = [check(alt, last, turns, seeded) for alt in exp["one_of"]]
        if all(alts):
            f.append("none of: " + " | ".join("; ".join(a) for a in alts))
    if "looks" in exp:
        lo, hi = exp["looks"]
        if not lo <= len(lks) <= hi:
            f.append(f"expected {lo}-{hi} looks, got {len(lks)}")
    if exp.get("no_looks") and lks:
        f.append(f"expected no looks, got {len(lks)}")
    if exp.get("clarify") is True and len(last["clarifies"]) != 1:
        f.append(f"expected exactly one clarify, got {len(last['clarifies'])}")
    if exp.get("clarify") is False and last["clarifies"]:
        f.append(f"unexpected clarify: {last['clarifies'][0]['question']}")
    chips = [c.lower() for q in last["clarifies"] for c in q["chips"]]
    for want in exp.get("chips_all") or []:
        if not any(want.lower() in c for c in chips):
            f.append(f"chip '{want}' missing from {chips}")
    if exp.get("chips_any") and not any(w.lower() in c for w in exp["chips_any"] for c in chips):
        f.append(f"no chip matches {exp['chips_any']}: {chips}")
    if exp.get("wearer"):
        bad = [it["product"]["title"] for lk in lks for it in lk["items"]
               if it["product"]["gender"] not in (exp["wearer"], "unisex")]
        if bad:
            f.append(f"not {exp['wearer']}'s: {bad}")
    if "max_total" in exp:
        over = [(lk["name"], lk["total"]) for lk in lks if lk["total"] > exp["max_total"]]
        if over:
            f.append(f"over {exp['max_total']}: {over}")
    if "max_total_or_overage" in exp:
        cap = exp["max_total_or_overage"]
        bad = [(lk["name"], lk["total"], lk["budget_max"]) for lk in lks
               if lk["total"] > cap and not (lk["budget_max"] and lk["budget_max"] <= cap and lk["over_budget_by"])]
        if bad:
            f.append(f"over {cap} without stated overage: {bad}")
    if exp.get("tool_called"):
        called = [x.get("tool") for tr in turns for x in tr["trace"]]
        if exp["tool_called"] not in called:
            f.append(f"{exp['tool_called']} not called ({called})")
    if exp.get("no_color"):
        ban = set(exp["no_color"])
        bad = [it["product"]["title"] for lk in lks for it in lk["items"]
               if ban & ({it["product"]["color_family"]} | set(it["product"]["colors"]))]
        if bad:
            f.append(f"banned colours shown: {bad}")
    if exp.get("parent"):
        want = seeded[exp["parent"]]["id"]
        if not lks or any(lk["parent_look_id"] != want for lk in lks[:1]):
            f.append(f"first look parent {[lk['parent_look_id'] for lk in lks]} != {want}")
    first = lks[0] if lks else None
    if exp.get("formality_up") and first:
        a, b = mean_formality(seeded[exp["formality_up"]]), mean_formality(first)
        if not b > a:
            f.append(f"formality {a:.2f} -> {b:.2f} did not rise")
    if exp.get("keeps_piece") and first and not pids(first) & pids(seeded[exp["keeps_piece"]]):
        f.append("no piece kept from the edited look")
    if exp.get("keeps_all") and first and not pids(seeded[exp["keeps_all"]]) <= pids(first):
        f.append("scope-lock broken: a tray piece was dropped")
    if exp.get("adds_slot") and first and exp["adds_slot"] not in {it["slot"] for it in first["items"]}:
        f.append(f"no {exp['adds_slot']} added")
    if exp.get("changed_color") and first:
        base = pids(seeded[exp.get("parent") or next(iter(seeded))])
        changed = [it["product"] for it in first["items"] if it["product"]["id"] not in base]
        if not any(p["color_family"] in exp["changed_color"] for p in changed):
            f.append(f"no changed piece in {exp['changed_color']}: {[p['title'] for p in changed]}")
    if exp.get("query_any"):
        qs = [x["input"].get("query", "").lower() for x in last["trace"] if x.get("tool") == "search_catalog"]
        if not any(w in q for w in exp["query_any"] for q in qs):
            f.append(f"no query mentions {exp['query_any']}: {qs}")
    if exp.get("text_any") and not any(w.lower() in text.lower() for w in exp["text_any"]):
        f.append(f"text lacks {exp['text_any']}")
    if exp.get("minor_no_render"):
        bad = [lk["name"] for lk in lks if lk["render"]["status"] != "failed" or lk["render"]["error"] != looks.MINOR]
        if bad or not lks:
            f.append(f"try-on not skipped for minor: {bad or 'no looks'}")
    return f


def voice(turns: list[dict]) -> list[str]:
    f = []
    for tr in turns:
        txt = tr["text"] + " ".join(q["question"] for q in tr["clarifies"]) + " ".join(
            lk["why"] or "" for lk in tr["looks"])
        if "!" in txt:
            f.append("exclamation mark in copy")
        if EMOJI.search(txt):
            f.append("emoji in copy")
        if "as an ai" in txt.lower():
            f.append("'as an AI'")
        if not (tr["text"].strip() or tr["clarifies"]):
            f.append("empty reply")
        if tr["errors"]:
            f.append(f"error event {tr['errors']}")
        if any(x.get("fallback") for x in tr["trace"]) and config.ANTHROPIC_API_KEY:
            f.append("fell back to the deterministic composer: " + "; ".join(
                str(x.get("error") or x.get("call_error")) for x in tr["trace"] if "error" in x or "call_error" in x))
        for lk in tr["looks"]:
            if len(lk["name"].split()) != 2:
                f.append(f"look name not two words: {lk['name']}")
    return sorted(set(f))


JUDGE_SCHEMA = {"type": "object", "properties": {"pass": {"type": "boolean"}, "why": {"type": "string"}},
                "required": ["pass", "why"], "additionalProperties": False}


async def judge(client, sc: dict, turns: list[dict]) -> tuple[bool, str]:
    convo = []
    for msg, tr in zip(sc["turns"], turns, strict=True):
        convo.append(f"SHOPPER: {msg if isinstance(msg, str) else msg['text']}")
        convo.append(f"AVA: {tr['text'].strip() or '(no text)'}")
        for q in tr["clarifies"]:
            convo.append(f"AVA ASKS: {q['question']} chips={q['chips']}")
        for lk in tr["looks"]:
            items = ", ".join(f"{it['product']['title']} ({it['product']['gender']}, ₹{it['product']['price']:,})"
                              for it in lk["items"])
            over = f" OVER BUDGET by ₹{lk['over_budget_by']:,}" if lk["over_budget_by"] else ""
            convo.append(f"[APP CARD, drawn by the app from catalogue data — prices here are NOT Ava's words] "
                         f"“{lk['name']}” total ₹{lk['total']:,}{over}: {items}. "
                         f"Render: {lk['render']['status']} {lk['render']['error'] or ''}")
            convo.append(f"AVA (card note, her words): {lk['why']}")
    prompt = (f"You grade a fashion-store stylist chatbot (Ava). Context: {json.dumps(sc.get('brief') or 'no brief')}."
              f"\n\nTranscript:\n" + "\n".join(convo) + f"\n\nRubric: {sc['expect']['judge']}\n"
              "Only lines starting with AVA are Ava's words; APP CARD lines are UI and their prices are correct by design. "
              "Ava's own words should not state prices except an over-budget amount. Renders are stubbed in this test, "
              "so ignore render status unless the rubric is about rendering. "
              "Pass only if the rubric is clearly met. Reply as JSON.")
    r = await client.messages.create(model=config.JUDGE_MODEL, max_tokens=400,
                                     output_config={"format": {"type": "json_schema", "schema": JUDGE_SCHEMA}},
                                     messages=[{"role": "user", "content": prompt}])
    v = json.loads(next(b.text for b in r.content if b.type == "text"))
    return bool(v["pass"]), v["why"]


async def run_scenario(key: str, sc: dict, client, use_judge: bool, sem: asyncio.Semaphore) -> dict:
    async with sem:
        sid, seeded = seed(sc)
        turns = []
        for i, msg in enumerate(sc["turns"]):
            msg = {"text": msg} if isinstance(msg, str) else msg
            look_id = seeded[msg["look"]]["id"] if msg.get("look") else None
            att = sc.get("attachment") if i == len(sc["turns"]) - 1 else None
            turns.append(await run_turn(sid, msg["text"], look_id, att))
        last = turns[-1]
        fails = check(sc["expect"], last, turns, seeded) + voice(turns)
        jwhy = ""
        if use_judge and sc["expect"].get("judge") and client:
            try:
                ok, jwhy = await judge(client, sc, turns)
                if not ok:
                    fails.append(f"judge: {jwhy}")
            except Exception as e:  # a judge outage shouldn't fail the agent
                jwhy = f"judge error {e!r}"
        rounds = sum(1 for x in last["trace"] if "round" in x)
        return {"id": key, "title": sc["title"], "pass": not fails, "fails": fails, "judge": jwhy,
                "t_first": last["t_first"], "t_text": last["t_text"], "t_looks": last["t_looks"],
                "t_total": last["t_total"], "rounds": rounds, "text": last["text"].strip(),
                "looks": [f"{lk['name']} ₹{lk['total']:,}: " + " + ".join(it["product"]["title"] for it in lk["items"])
                          for lk in last["looks"]],
                "clarify": last["clarifies"][0] if last["clarifies"] else None,
                "queries": [x["input"].get("query") for t in turns for x in t["trace"] if x.get("tool") == "search_catalog"]}


def fmt(x):
    return "–" if x is None else f"{x:.1f}s"


def write(results: list[dict], note: str, full: bool) -> None:
    passed = sum(r["pass"] for r in results)
    ttl = [r["t_looks"] for r in results if r["t_looks"] is not None]
    p50 = statistics.median(ttl) if ttl else None
    mode = f"{config.AGENT_MODEL}, effort {loop.EFFORT}" if config.ANTHROPIC_API_KEY else "fallback (no API key)"
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    head = ["# Agent eval results\n", f"Latest run: {stamp} · {mode} · **{passed}/{len(results)} pass** · "
            f"p50 time-to-looks {fmt(p50)} · bar: ≥13/15 and p50 < 12 s\n",
            "| id | scenario | pass | first event | first text | looks at | total | rounds | notes |",
            "|---|---|---|---|---|---|---|---|---|"]
    for r in results:
        notes = "; ".join(r["fails"]).replace("|", "/")[:300] or (r["judge"] or "").replace("|", "/")[:160]
        head.append(f"| {r['id']} | {r['title']} | {'PASS' if r['pass'] else 'FAIL'} | {fmt(r['t_first'])} | "
                    f"{fmt(r['t_text'])} | {fmt(r['t_looks'])} | {fmt(r['t_total'])} | {r['rounds']} | {notes} |")
    detail = ["\n## Transcripts (latest run)\n"]
    for r in results:
        detail.append(f"**{r['id']}** — {r['text'] or '(no text)'}")
        if r["clarify"]:
            detail.append(f"  - asks: {r['clarify']['question']} {r['clarify']['chips']}")
        for lk in r["looks"]:
            detail.append(f"  - {lk}")
        if r["queries"]:
            detail.append(f"  - searches: {r['queries']}")
        detail.append("")
    hist = []
    if RESULTS.exists():
        old = RESULTS.read_text()
        if "## Iterations" in old:
            hist = [ln for ln in old.split("## Iterations", 1)[1].strip().splitlines()[2:] if ln.startswith("|")]
    if full:
        hist.append(f"| {stamp} | {mode} | {passed}/{len(results)} | {fmt(p50)} | {note} |")
    iters = ["\n## Iterations\n", "| when | mode | score | p50 time-to-looks | change |", "|---|---|---|---|---|", *hist]
    RESULTS.write_text("\n".join(head + detail + iters) + "\n")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--note", default="")
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument("--parallel", type=int, default=4)
    ap.add_argument("--fallback", action="store_true", help="ignore the API key: exercise the deterministic composer")
    a = ap.parse_args()
    if a.fallback:
        config.ANTHROPIC_API_KEY = ""
    db.init_db()
    catalog.load()
    scs = yaml.safe_load(SCENARIOS.read_text())
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    keys = [k for k in scs if not only or k in only]
    client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY) if config.ANTHROPIC_API_KEY else None
    sem = asyncio.Semaphore(a.parallel)
    results = await asyncio.gather(*(run_scenario(k, scs[k], client, not a.no_judge, sem) for k in keys))
    for r in results:
        print(f"{r['id']:4} {'PASS' if r['pass'] else 'FAIL'}  looks@{fmt(r['t_looks']):>6}  {r['title']}")
        for x in r["fails"]:
            print(f"       - {x}")
    print(f"\n{sum(r['pass'] for r in results)}/{len(results)} pass")
    write(results, a.note, full=not only)


if __name__ == "__main__":
    asyncio.run(main())
