# Decisions log (resolves PRD §23)

| # | Decision | Chosen | Why / evidence |
|---|---|---|---|
| 1 | Product name | **Elara Commerce**; store "Northline"; stylist "Ava" | PRD default; fictional store avoids trademarks in the video |
| 2 | Units per Clothes VTO call | **2 units** (verified; balance 1000 → 998 after one cloth-v4 call) | Budget ≈ 450 renders on one key |
| 3 | cloth-v3 vs v4 | **cloth-v4** | Works on the hackathon key (14 s); adds `outer` for layers and `filter_multi_person` |
| 4 | Catalogue source | **Nicobar export from Elara-B2B** (`catalog-export/`), about 500 SKUs, brand stripped | Already enriched (vibes, formality, fit, colour, pairing), INR, women+men, plain-background on-model images; no scraping needed |
| 5 | Two submissions (student track) | **Open: needs the team.** Code supports theming via `theme.ts` + dataset swap | Rules check pending |
| 6 | Full-look rendering | **Layered** (bottom → top → layer, chaining the result URL as `src`) | Tested 11-01: skirt then blouse came out clean |
| 7 | Footwear | **None**: the catalogue has no footwear; `change_shoes: false` always | The shopper's own shoes stay in the photo |
| 8 | Style DNA tiles | Pre-rendered for sample models; live for uploaded photos | Saves units, instant for judges |
| 9 | Group photo | **P2 / cut by default**; replaced by "See it move" (Image-to-Video) as the extra YouCam capability | One API call, stronger video moment |
| 10 | LLM | **Claude Sonnet 5.5** (agent), Haiku 4.5 (eval judge) | User choice; tool-use + strict schemas |

## Stack decisions

| Area | Chosen | Rejected and why |
|---|---|---|
| Backend | Python FastAPI (one process) | Node per PRD; the team's agent stack (Elara) is Python |
| DB | SQLite (stdlib) | Supabase/Postgres: judges must run locally in 10 min with zero services |
| Retrieval | In-memory filter + score over 500 rows | pgvector: unnecessary at this size |
| Crew realtime | 3 s polling | Supabase Realtime: extra service; the PRD sanctions polling |
| Widget isolation | Shadow DOM + inline CSS | The iframe used by the existing Elara B2B widget: heavier, postMessage plumbing |
| Agent framework | Plain Claude tool-use loop | LangGraph etc.: Elara evaluated and rejected them |
| Group photo | Cut | Needs bg-removal + bg-change + compositing; low value per hour |

## Learned from YouCam docs (constraints that shaped the design)

- **Lower-body references must be worn photos.** That drove the choice of on-model catalogue images.
- **Result URLs expire in 2 h.** We download every result immediately.
- **Rate limit 250 req / 300 s.** We poll every 2 s and cap concurrency at 8.

## Still open (ask the user)

- Hosting provider and permission to deploy publicly.
- `ANTHROPIC_API_KEY`.
- The student-track second submission (name, theme, store).

## Catalogue reality (11-01, data build)
- 500 SKUs: women 105 tops / 63 bottoms / 80 one-pieces / 20 layers / 25 bags+acc; men 110 tops / 65 bottoms / 22 layers; unisex 10 bags+acc.
- **The PRD's ₹4,000 beach budget is not achievable.** The cheapest top+bottom is ₹5,250 and the cheapest dress ₹4,700. **Demo defaults: women beach ₹7,000; men smart-casual ₹10,000.** The budget slider defaults to ₹7,000.
- No formality-5 items exist, so the wedding target 4.5 is met by formality-4 pieces (scoring handles it).
- Product ids (`nl-0001`…) depend on the selection. Rebuilding the catalogue can shift them; `test_catalog_data.py` guards `demo_looks.json`.
- Sample models: w1 (YouCam demo asset), w2, m1, m2 (Unsplash Licence). All four were validated with a live upper-body render.
