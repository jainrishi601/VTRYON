# Elara Commerce: agentic virtual try-on for any fashion store

An AI stylist widget that any e-commerce store adds with one script tag. The shopper describes the occasion in plain words. An agent builds complete outfits from that store's catalogue, and **YouCam AI Clothes Virtual Try-On renders every look on the shopper's own photo**. The shopper can swap any single piece (only that part re-renders), see a compatibility score, get friends' votes in a **Style Crew**, watch the look move, and send it all to the cart.

Built for the **YouCam API Skin AI & eCommerce VTO Hackathon**, eCommerce VTO track.

## What's inside

| | |
|---|---|
| **Demo store** | "Northline", a fictional resort label with about 500 real SKUs (women and men, INR) |
| **Widget** | React in a Shadow DOM, embedded with `<script src="/widget.js">` |
| **Agent** | Claude Sonnet 5.5 tool-use loop: intent → max one clarifying question → catalogue search → compose 2–3 looks → deterministic compatibility score → render |
| **YouCam APIs** | `cloth-v4` in four modes (single item, layered full look, slot-level swap on an existing render, Style DNA tiles), plus File API and AI Image-to-Video |
| **Social** | Style Crew: join by link, see the look on yourself, per-item threads and votes, share image |
| **Memory** | Style DNA taste graph, built from heart/cross picks, swaps, likes and cart |

## Quick start (about 10 minutes)

Prerequisites: Python ≥ 3.12 with [uv](https://docs.astral.sh/uv/), Node ≥ 20 with pnpm.

1. Clone the repo:
   ```bash
   git clone <repo-url> && cd VTRYON
   ```
2. Copy the env file:
   ```bash
   cp .env.example .env
   ```
3. Put your YouCam key in `.env`, in `YOUCAM_API_KEY`. Get one from the [YouCam API console](https://yce.makeupar.com/api-console).
4. Optionally add `ANTHROPIC_API_KEY`. Without it, a deterministic fallback composer answers instead of Claude.
5. Install backend dependencies:
   ```bash
   cd backend && uv sync && cd ..
   ```
6. Seed the demo shopper and the demo crew:
   ```bash
   uv run --project backend python scripts/seed_demo.py
   ```
7. Start the API:
   ```bash
   cd backend && uv run uvicorn app.main:app --port 8000
   ```
8. In a second terminal, start the web app:
   ```bash
   cd web && pnpm i && pnpm dev
   ```
9. Open <http://localhost:5173> and click **Style me**.
10. Judges: open <http://localhost:5173/#/judge> for the scripted prompts. API usage is at <http://localhost:8000/admin/renders>.

**Spend zero YouCam units:** set `YOUCAM_DEMO_MODE=1`. Only renders that are already cached are served.

**Pre-render the demo content (about 140 units):** run the command below. Without `--yes` it only prints the plan and the cost.

```bash
uv run --project backend python scripts/prerender.py --yes
```

## Embed on any store

```html
<script src="https://<host>/widget.js"
        data-store-id="northline"
        data-api="https://<host>"
        data-position="bottom-center"
        data-cart-adapter="custom"></script>
```

- **Cart adapters:**
  - `custom` calls `window.elaraAddToCart(items)`.
  - `shopify` posts to `/cart/add.js`.
- **Product feed:** JSON as in `data/products.json`. The required fields are `id, title, price, currency, image_url, gender, category`. Everything else is enriched at ingestion.

## Repo map

```
backend/   FastAPI: agent (Claude), YouCam wrapper, renders, scoring, taste graph, crew, SQLite
web/       Vite + React + Tailwind: Northline store + embeddable widget (Shadow DOM)
data/      products.json (enriched catalogue), demo_looks.json, sample models
scripts/   build_catalog.py, prerender.py, seed_demo.py, run_evals.py
e2e/       Playwright browser tests (desktop + mobile)
docs/      architecture, agent spec, design system, YouCam usage, test plan, tracker, demo script
```

## Docs

| Doc | What it covers |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Engineering rules and commands; read first |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and the full API contract |
| [docs/AGENT_SPEC.md](docs/AGENT_SPEC.md) | Agent behaviour, tools, scoring, taste graph, eval scenarios |
| [docs/youcam-usage.md](docs/youcam-usage.md) | Every YouCam endpoint used, and why |
| [docs/DESIGN.md](docs/DESIGN.md) | "Linen & Ink" design system |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Unit, agent-eval and browser test plan |
| [docs/TRACKER.md](docs/TRACKER.md) | Feature status and acceptance checks |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | The 2:45 video shot list |
| [docs/DEVPOST.md](docs/DEVPOST.md) | The submission text |

## Tests

Backend unit tests (no network):

```bash
cd backend && uv run pytest -q
```

Agent evals (live Claude; renders stubbed):

```bash
uv run --project backend python scripts/run_evals.py
```

Browser tests (desktop + mobile, demo mode):

```bash
pnpm --dir e2e test
```

## Privacy and safety

- Photos are used only for try-on. "Forget me" deletes the taste graph, photos and renders.
- Minors are never rendered.
- API keys stay on the server; the widget never sees them.

## Licence

MIT. The demo catalogue images belong to their original owner and are used for a non-commercial hackathon demo with brand names removed. The sample model photos are under the Pexels/Unsplash licence (see `data/models/models.json`).
