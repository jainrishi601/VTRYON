# CLAUDE.md — Elara Commerce (YouCam VTO Hackathon)

Agentic AI-stylist widget for any fashion store. One script tag. The shopper describes an occasion, an agent builds outfits from the store catalogue, and **YouCam Clothes VTO renders them on the shopper's photo**. The shopper can swap one piece, see a compatibility score, share with a Style Crew and add the look to the cart.

**Deadline: 2 Nov 2026, 10:15 PM IST.** Feature freeze 3 PM IST on 2 Nov. Anything not working by then is cut, not finished on camera.

## Read first

| You are touching | Read |
|---|---|
| Anything | this file, then `docs/TRACKER.md` (what is done and what is next) |
| API / backend / frontend wiring | `docs/ARCHITECTURE.md` (**the contract**; change it before you change the code) |
| The chat agent, prompts, tools | `docs/AGENT_SPEC.md` |
| YouCam calls | `docs/youcam-usage.md` |
| UI | `docs/DESIGN.md` |
| Tests, evals, browser checks | `docs/TEST_PLAN.md` |
| Product scope / why | `PRD — Elara Commerce ... .pdf` (source of truth for scope), `docs/DECISIONS.md` (PRD §23 resolved) |
| Submission | `docs/DEMO_SCRIPT.md`, `docs/DEVPOST.md`, `README.md` |

## Layout

```
backend/            FastAPI app (Python 3.12+, uv). The brain + YouCam wrapper + SQLite.
  app/main.py       routes only; logic lives in modules below
  app/youcam.py     ONLY file that talks to YouCam
  app/agent/        Claude tool-use loop, tools, prompts
  app/catalog.py    in-memory catalogue + filtered retrieval
  app/scoring.py    deterministic compatibility score (pure functions)
  app/dna.py        taste graph (nodes/edges) + taste vector
  app/renders.py    look → YouCam render plan (layering, swap, cache)
  app/crew.py       Style Crew
  tests/            pytest; one file per module
web/                Vite + React + TS + Tailwind. Two entries:
  src/store/        demo store "Northline" (index.html)
  src/widget/       the embeddable widget, built to dist/widget.js, mounted in Shadow DOM
scripts/            build_catalog.py, prerender.py, seed_demo.py (one-off, idempotent)
data/               products.json (500 SKUs, pre-enriched), demo_looks.json, models/ (sample photos), seed.json
e2e/                Playwright browser tests
docs/               the documentation above
```

## Commands

```bash
# backend (from backend/)
uv sync
uv run uvicorn app.main:app --reload --port 8000
uv run pytest -q
uv run ruff check .

# web (from web/)
pnpm i
pnpm dev            # store on :5173, proxies /api and /media to :8000
pnpm build          # dist/ store + dist/widget.js

# data (from repo root)
uv run --project backend python scripts/build_catalog.py   # rebuilds data/products.json
uv run --project backend python scripts/prerender.py       # spends YouCam units; asks first
uv run --project backend python scripts/seed_demo.py       # demo crew + demo shopper

# e2e (from repo root)
pnpm --dir e2e test
```

Env vars live in `.env` at the repo root; `.env.example` lists them. The backend reads them via `app/config.py` and nowhere else.

## Non-negotiable rules

**Truth and data**
1. **The LLM supplies meaning, taste and words; the code supplies truth.** Prices, images, URLs, stock, totals, scores and render images come only from catalogue records and code. The model never writes a price or a product id into anything the user sees.
2. **The model sees opaque refs** (`c_12`), never SKU ids. Code mints the refs per turn and maps them back. An unknown ref is dropped, never guessed.
3. **Grounding is drop-only.** An invalid look is repaired once via a tool error, then dropped. Never invent a product to fill a slot. If a slot is empty, say what could not be found.
4. **Never dead-end a turn.** If Claude fails (timeout, invalid output twice, no key), the deterministic fallback composer answers. An empty reply is a bug.

**Agent behaviour**
5. **One question card per turn, two questions maximum.** Never re-ask what the brief, Style DNA or history already answers. See `AGENT_SPEC.md` §Clarifier.
5b. **Never render clothes on a photo of the other gender.** Looks start flat and render only on Try on; `looks.start_render` refuses a gender mismatch, and the try-on sheet offers a matching sample model instead.
6. **No regex or keyword tables over user text for meaning.** Claude does intent. (Lookup tables over *catalogue* fields at ingestion are fine.)

**YouCam**
7. **Every YouCam call goes through `app/youcam.py`**, which owns the cache, budget counter, concurrency limits and error mapping. Check the cache before spending a unit. Download results immediately (the URLs expire in 2 h).
8. **Credit safety.** Per-session live render cap is 20. `YOUCAM_DEMO_MODE=1` serves only cached renders. Never run a loop that spends units without printing the planned unit cost and asking first.

**Code style**
9. **Keys stay on the server.** The widget never sees YouCam or Anthropic keys. Never print, log or commit secrets. `.env` is gitignored; keep it that way.
10. **Ponytail style.** Fewest files and shortest working code: stdlib first, no new dependency for what 10 lines do, no abstractions with one implementation. Mark deliberate shortcuts with a `# ponytail:` comment naming the ceiling.
11. **Every external await has a timeout.** Fan-outs use `asyncio.gather(..., return_exceptions=True)`. A tool failure is returned to the model as data and costs one round, not the turn.
12. **Pydantic models at every IO boundary.** The API JSON shapes in `ARCHITECTURE.md` are the contract. If you change a shape, update the doc in the same change.

**UX**
13. **No raw errors in the UI.** Every failure has copy and a next action (see `youcam-usage.md` error map). A render failure shows the flat product collage plus "Retry try-on". Cards never block on images.
14. **Copy tone:** second person, short, stylist-like. No exclamation marks except the welcome line. Never "as an AI". No emoji in system copy. Name the looks ("Sunset Linen").
15. **No third-party brand on screen.** The store is "Northline". The ingestion script strips source brand names from titles and descriptions. Don't reintroduce them.

**Process**
16. **Tests before "done".** A feature is done when its tracker row's acceptance check passes: a unit test, an e2e step or a recorded manual check. Mark it in `docs/TRACKER.md` with the date.

## Things that will bite you

- **Lower-body references must be worn photos.** Every Nicobar image is on-model; keep it that way for any new data.
- **Separates render bottom first, then top, then layer.** Each step uses the previous result URL as `src_file_url`. Swap = one call on the current render.
- **Shadow DOM + Tailwind:** widget CSS is imported with `?inline` and injected into the shadow root. Global store CSS must not leak in, and widget CSS must not leak out. Fonts are loaded once on the host document, because `@font-face` does not work inside shadow roots.
- **SSE:** `/api/chat` streams `text/event-stream`. Render updates keep arriving after the agent's text is done, so the stream closes only when all renders for that turn have settled (or after a 75 s cap; the client then polls `GET /api/looks/{id}`).
- **Sonnet 5.5 rejects forced `tool_choice`.** Use `auto` + `strict: true` tools and steer via the prompt. Never send `budget_tokens`.
- **The catalogue has no footwear.** The agent must not mention shoes as store items, and must not render shoes (`change_shoes: false`).

## When to stop and ask the user

- Before spending more than 40 YouCam units in one go (prerender, bulk tests).
- Before deploying anywhere public or pushing to a remote.
- If a PRD P0 item looks infeasible.
