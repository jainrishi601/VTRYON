# Test plan

Three layers: **unit** (pytest, no network), **agent evals** (live Claude, scripted scenarios), **browser e2e** (Playwright against the running app). Plus a short **live YouCam smoke** that spends units deliberately.

**Rules**
- Unit tests never hit YouCam or Anthropic. They mock with `httpx.MockTransport` / a fake client.
- Any test that spends YouCam units is marked `@pytest.mark.live` and skipped by default.
- E2E runs with `YOUCAM_DEMO_MODE=1` + the prerendered cache, so it costs 0 units and is deterministic. One e2e (`E2E-LIVE`) runs live on demand.

## 1. Unit (backend/tests)

| id | file | asserts |
|---|---|---|
| U-CAT-1 | test_catalog.py | products.json loads; ≥450 rows; required fields non-empty; no row contains the source brand name |
| U-CAT-2 | ″ | every row has `slot` in the allowed set and `vibes` ⊂ taxonomy; formality 1–5 |
| U-CAT-3 | ″ | women and men each have ≥40 tops and ≥25 bottoms; women have ≥25 one-pieces |
| U-CAT-4 | ″ | `search(slot, gender, max_price)` honours hard filters (gender, slot never relaxed) |
| U-CAT-5 | ″ | the relaxation ladder returns results and a `note` when exact filters give 0 |
| U-CAT-6 | ″ | `never` filter excludes those colours/vibes |
| U-YC-1 | test_youcam.py | the task body for each slot → correct `garment_category`, `change_shoes:false` |
| U-YC-2 | ″ | polling: running → success returns the url; error returns a mapped user copy |
| U-YC-3 | ″ | cache hit returns `cached=True` and makes 0 HTTP calls |
| U-YC-4 | ″ | 429 → backoff and retry; `CreditInsufficiency` → demo mode on |
| U-YC-5 | ″ | `InvalidParameters` → one retry with `auto` |
| U-YC-6 | ″ | demo mode with no cached entry → raises `RenderUnavailable` (no call) |
| U-YC-7 | ″ | image-to-video body shape and poll |
| U-RND-1 | test_renders.py | plan(one_piece) = [full_body]; plan(top+bottom) = [lower_body, upper_body]; plan(+layer) appends outer |
| U-RND-2 | ″ | the chain passes the previous result as src; cache keys chain |
| U-RND-3 | ″ | a swap of the bottom on a ready look = 1 step with src = the parent render |
| U-RND-4 | ″ | a failure mid-chain → look `failed` with copy; partial result not shown as final |
| U-SC-1..6 | test_scoring.py | neutral+anything ≥ 90 colour; formality gap penalises; relaxed+fitted > same fit; bands at 85/70; reason mentions the strongest component; alternatives respect the remaining budget |
| U-DNA-1..6 | test_dna.py | tiles pick 4 distinct vibes for the occasion; heart/cross update weights; two crosses → never; summary name stable; export lists edges; forget deletes |
| U-API-1..5 | test_api.py | status; session create/returning; photo validation rejects >10 MB / non-image / tiny; sample-model photo; tryon builds a look |
| U-AG-1 | test_agent.py | with no API key, `/api/chat` streams status → looks → done via the fallback |
| U-AG-2 | ″ | present_looks validator: unknown ref, two tops, over budget, wrong gender → errors |
| U-AG-3 | ″ | SSE event framing; the stream closes after renders settle (fake renderer) |
| U-CREW-1..6 | test_crew.py | create reuses the crew per session; join without photo; join with photo queues member renders; comment/reaction counts per slot; verdict label; share.png returns 1080×1080 PNG |

## 2. Agent evals (live Claude)

Scenarios E1–E15 are defined in `docs/AGENT_SPEC.md` §7.
- **Data:** `backend/tests/evals/scenarios.yaml`.
- **Runner:** `uv run --project backend python scripts/run_evals.py [--only E3]`.
- **How it runs:** each scenario seeds a session, posts to `/api/chat` in-process (TestClient), collects SSE events, and runs code assertions. Tone and pronoun checks use a Haiku judge returning `{pass, why}`.
- **Renders:** stubbed (`RENDER_STUB=1`), so evals spend 0 YouCam units.
- **Output:** `docs/eval-results.md` table: id, pass/fail, latency to first event, latency to looks, notes.
- **Bar:** ≥13/15 and p50 time-to-looks < 12 s.

## 3. Browser e2e (Playwright, `e2e/`)

Run against `uvicorn` + `vite preview` with `YOUCAM_DEMO_MODE=1`, `RENDER_STUB=0` (cached renders) and `AGENT_MODE=live|fallback`. Viewports: desktop 1440×900 and mobile 390×844.

| id | flow | asserts |
|---|---|---|
| E2E-1 | Store loads; launcher visible; widget mounts in a shadow root; store CSS doesn't change widget fonts | `document.querySelector('#elara-root').shadowRoot` exists; launcher text "Style me" |
| E2E-2 | Onboarding: Me → Beach trip → budget 7000 → Continue → sample model → Continue | lands on the DNA picker; occasion is required (Continue disabled without it) |
| E2E-3 | DNA picker: 4 tiles render (cached); heart 2 → Continue | the DNA name chip appears; the chat opener is auto-sent |
| E2E-4 | Chat: the opener streams status lines, then 2–3 outfit cards with totals ≤ budget; renders resolve | each card shows an image or a fallback collage within 20 s |
| E2E-5 | Open viewer → before/after slider moves → tap the bottom hotspot → swap drawer shows 4–6 tiles with score badges → pick one → a new render, history strip has 2 | |
| E2E-6 | Product card "Try on me" → the widget opens with that product rendered | |
| E2E-7 | "Add look to bag" → the store cart drawer opens with N items and the right subtotal | |
| E2E-8 | Open `/?crew=<seeded id>` in a fresh context → join as "Riya" without a photo → comment "trousers yes" on the bottom → the owner context sees the comment within 5 s | |
| E2E-9 | Owner: Share with Crew → the share sheet shows a preview image + copy link | |
| E2E-10 | Reload with a token → onboarding is skipped → "Welcome back" | |
| E2E-11 | `/admin/renders` lists calls with cache hit/miss and units | |
| E2E-12 | Mobile 390 px: the panel is full-screen, the composer is pinned, no horizontal scroll (`scrollWidth <= innerWidth`) | |
| E2E-LIVE | (on demand, ~12 units) upload a real photo → DNA tiles live → one chat look live → swap live | |

On failure, screenshots go to `e2e/test-results/`. On success, a full happy-path screenshot set goes to `docs/screens/` for Devpost.

## 4. Manual checklist before recording

- [ ] `/api/status` shows units left ≥ 150 and anthropic configured
- [ ] cache warm for every scripted demo prompt (run the demo once)
- [ ] the second browser profile joins the crew from the link
- [ ] the phone viewport looks right (the real phone segment)
- [ ] no third-party brand text visible anywhere (grep the UI and data for the source brand)
