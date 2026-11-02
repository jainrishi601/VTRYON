# Tracker

Status: `todo` · `wip` · `done (date, how verified)` · `cut`. P0 = in the video, must ship.

The **Check** column is the acceptance test. A row is done only when its check passes.

Test ids map to `docs/TEST_PLAN.md`: `U-*` are unit tests, `E2E-*` are browser tests, `EV-*` are agent evals.

## 0. Foundations

| # | Item | P | Check | Status |
|---|---|---|---|---|
| F1 | Repo docs: CLAUDE.md, ARCHITECTURE, AGENT_SPEC, DESIGN, TEST_PLAN, youcam-usage | P0 | reviewed | done (11-01) |
| F2 | YouCam key verified, cloth-v4 single + layered (bottom→top) works | P0 | live call, 14 s/step | done (11-01, manual) |
| F3 | `.env.example`, `.gitignore` protects `.env` | P0 | `git check-ignore .env` | done (11-01) |
| F4 | `data/products.json` ~500 SKUs (women+men), brand-stripped, enriched, VTO refs on-model | P0 | U-CAT-1..3 | done (11-01, 6 tests pass; 500 SKUs, brand grep clean) |
| F5 | 4 sample models (2 women, 2 men), licensed, VTO-validated | P0 | each renders once | done (11-01, 4 live checks, 8 units; prefer m2 for men's trousers, m1 legs crossed) |

## 1. Backend

| # | Item | P | Check | Status |
|---|---|---|---|---|
| B1 | FastAPI skeleton, config, SQLite schema, `/api/status` | P0 | U-API-1 | done (11-01, U-API-1) |
| B2 | Catalogue load + `/api/products` filters + search relaxation ladder | P0 | U-CAT-4..6 | done (11-01, U-CAT-4..6) |
| B3 | `youcam.py`: upload, cloth-v4 task + poll, cache, budget, semaphores, error map, demo mode | P0 | U-YC-1..6 (mocked), 1 live smoke | done (11-01, U-YC-1..7 mocked + live smoke: 3 calls, 6 units) |
| B4 | `renders.py`: plan (one-piece / separates / layer), chain, swap-mode, persist to /media | P0 | U-RND-1..4 | done (11-01, U-RND-1..4 + live bottom→top chain) |
| B5 | Session + brief + photo upload (validation: type, size, dims) + sample model | P0 | U-API-2..4 | done (11-01, U-API-2..4) |
| B6 | Style DNA tiles (4 vibes by occasion, parallel renders) + pick → edges | P0 | U-DNA-1..3 | done (11-01, U-DNA-1..3 + tiles API test) |
| B7 | `scoring.py` compatibility score + bands + reasons + alternatives | P1 | U-SC-1..6 | done (11-01, U-SC-1..6) |
| B8 | Agent loop: context pack, tools, SSE events, follow-ups, remember_preference | P0 | EV-1..15 ≥ 13 pass | done (11-01, live Sonnet 5.5: evals 15/15 twice, p50 time-to-looks ~8.5 s; live browser follow-up checked) |
| B9 | Fallback composer (no key / Claude failure) | P0 | U-AG-1 | done (11-01, U-AG-1..3 + scripted fallback-on-failure test) |
| B10 | `/api/tryon` (Studio / single item) | P1 | U-API-5 | done (11-01, U-API-5 + live) |
| B11 | Swap: alternatives + swap render on the existing image | P0 | U-RND-3, E2E-5 | done backend (11-01, U-RND-3 + live swap = 1 call); E2E-5 waits on W9/W10 |
| B12 | Crew: create, join (name + optional photo), looks, comments/reactions, verdict, member renders | P1 | U-CREW-1..5 | done (11-01, U-CREW-1..5) |
| B13 | Share image PNG (square + story) with Pillow | P1 | U-CREW-6 | done (11-01, U-CREW-6 + visual check) |
| B14 | Image-to-video "See it move" | P2 | 1 live call, U-YC-7 mocked | done (11-01, live clip ok; YouCam i2v takes ~5–8 min; retry resumes same task) |
| B15 | Taste graph: edges on like/cart/swap/tried_on/friend; DNA summary + name; export / forget | P1 | U-DNA-4..6 | done (11-01, U-DNA-4..6) |
| B16 | `/admin/renders` page (API usage for judges) | P1 | E2E-11 | done backend (11-01, JSON + HTML); E2E-11 pending |
| B17 | Seed: demo crew "Goa trip crew" with 2 members, renders, comments; returning demo shopper | P0 | E2E-8 | done (11-01, seed_demo --yes: Goa trip crew 3 members/2 looks/5 comments, 8 units) |
| B18 | Prerender: DNA tiles for sample models + 12 demo looks (`data/demo_looks.json`) | P0 | `renders` rows exist; demo mode serves them | done (11-01, 40 renders prerendered, 94 units, 0 failures, visually checked) |

## 2. Widget and store

| # | Item | P | Check | Status |
|---|---|---|---|---|
| W1 | Vite app, store pages (home, listing, PDP, cart drawer), "Northline" brand | P0 | E2E-1 | done (11-01, E2E-1 desktop+mobile) |
| W2 | `widget.js` build: Shadow DOM mount, script-tag embed, theming hook, `Drape.open` | P0 | E2E-1 | done (11-01, E2E-1: real `<script src="/widget.js">`, shadow root, hostile host CSS ignored) |
| W3 | Launcher + product-card "Try on me" chip | P0 | E2E-1, E2E-6 | done (11-01, E2E-1, E2E-6) |
| W4 | Onboarding screen 1 (who / occasion / budget / optional) | P0 | E2E-2 | done (11-01, E2E-2) |
| W5 | Onboarding screen 2 (upload / camera / sample model, client checks, consent) | P0 | E2E-2 | done (11-01, E2E-2; client type/size/4096px downscale checks, camera via capture) |
| W6 | Style DNA picker 2×2 (skeletons, heart/cross, skip) | P0 | E2E-3 | done (11-01, E2E-3) |
| W7 | Chat: SSE client, status checklist, user/agent messages, clarify chips, composer, paperclip | P0 | E2E-4 | done (11-01, E2E-4; paperclip hidden: no attachment endpoint yet) |
| W8 | Outfit card (render states, pieces, total, why, score badge, actions) | P0 | E2E-4 | done (11-01, E2E-4) |
| W9 | Try-on viewer: before/after slider, hotspots, history strip | P0 | E2E-5 | done (11-01, E2E-5) |
| W10 | Swap drawer with scores and reasons | P0 | E2E-5 | done (11-01, E2E-5) |
| W11 | Add look to cart → store cart drawer | P0 | E2E-7 | done (11-01, E2E-7) |
| W12 | Studio tab: filters, grid, tray, Try on, "Ask the stylist" | P1 | E2E-6 | done (11-01, manual + screens spec; tray → Try on → viewer) |
| W13 | Crew tab: share sheet, join flow, look feed, per-item threads/reactions, verdict, polling | P1 | E2E-8, E2E-9 | done (11-01, E2E-8, E2E-9) |
| W14 | "See it move" video player on a look | P2 | manual | wip (UI + polling built; no live video call verified) |
| W15 | Returning user (token → skip onboarding + welcome back) | P1 | E2E-10 | done (11-01, E2E-10) |
| W16 | Mobile: 390 px full-screen panel, no horizontal scroll | P0 | E2E-12 | done (11-01, E2E-12 + store-page overflow test) |
| W17 | Footer: Download my style data / Forget me | P1 | manual | done (11-01, e2e "W17 Forget me"; download manual) |
| W18 | Judge guide page `/judge` + embed snippet page `/merchant` | P1 | manual | done (11-01, manual + screens) |

## 3. Quality and submission

| # | Item | P | Check | Status |
|---|---|---|---|---|
| Q1 | Unit tests green (`uv run pytest`) | P0 | CI-local | todo |
| Q2 | Agent evals ≥ 13/15 | P0 | `docs/eval-results.md` | done (11-01, 15/15 ×2, see docs/eval-results.md) |
| Q3 | Playwright e2e green on desktop + mobile viewport | P0 | `pnpm --dir e2e test` | done (11-01, 22/22 desktop+mobile, isolated DB, no unit spend) |
| Q4 | Design review pass (polish checklist in DESIGN.md §4) | P0 | screenshots in `docs/screens/` | wip (11-01: 34 screens captured; recapture after prerender for real renders) |
| Q5 | README: 10-step setup, env list, demo URLs, architecture diagram | P0 | fresh-clone run < 10 min | todo |
| Q6 | Hosted demo (needs the user's go-ahead) | P0 | public URL works for 48 h | todo |
| Q7 | Demo video 2:30–2:55 (script in `docs/DEMO_SCRIPT.md`) | P0 | uploaded | todo |
| Q8 | Devpost description + 8 screenshots | P0 | submitted | todo |

## 4. Part B: chat-first widget

| # | Item | P | Check | Status |
|---|---|---|---|---|
| PB1 | Chat first: no upfront form; question card (1–2 questions, Something else, Skip) fills the brief | P0 | E2E-2/3, test_answers_fill_the_brief | done (11-01) |
| PB2 | Wearer gender saved from answers / `wearer` and enforced; gifts keep the shopper's own gender and taste apart | P0 | test_gender.py (gift, taste apart, wearer update) | done (11-01) |
| PB3 | Product grid for "show me X" requests, ranked by Style DNA with a match % | P0 | E2E-15, test_product_grid_validation | done (11-01, live Claude) |
| PB4 | Looks arrive flat; render only on Try on (no units on unopened looks) | P0 | E2E-4, test_looks_arrive_flat_and_render_on_tap | done (11-01) |
| PB5 | Try-on sheet: photo once with consent, gender-filtered sample models; mismatch never renders, offers a matching model | P0 | E2E-13, test_women_look_never_renders_on_a_mens_photo | done (11-01) |
| PB6 | Tap one piece: renders alone, "Pairs best with" scored pieces, add one, try the full look | P0 | E2E-14 + manual live check | done (11-01) |
| PB7 | Swap on every piece; bag/accessory swaps reuse the render | P1 | test_bag_swap_reuses_the_render | done (11-01) |
| PB8 | Head-to-toe looks (shoes, hats, watches) | P1 | needs a catalogue with those slots | todo |
| PB9 | Pairing from the shopper's own wardrobe (TRYON platform, Part A) | P1 | — | todo |
| PB10 | Widget restyled to the Elara storefront look (centred modal, Outfit, cards, try-on dialog), live render progress, Claude-written tip + Try next | P0 | e2e 28/28 + manual check vs wearetala.joinelara.shop | done (11-01) |

## 5. Part A: TRYON platform (desktop web, `/tryon`)

| # | Item | P | Check | Status |
|---|---|---|---|---|
| PA1 | Email accounts; the account's shopper token is shared with the store widget | P0 | test_signup_login_and_token_carry_over | done (11-01) |
| PA2 | 8-step dark onboarding (goal, shop-for, photos, sizes, body, colours from selfie, vibe swipe on you, never list) | P0 | TRYON-1, test_onboarding_answers_shape_dna_and_the_widget | done (11-01, live: Claude palette, 7 vibe renders) |
| PA3 | Style DNA page: Overview, Style Map constellation, Style Play, Timeline | P0 | TRYON-1, test_dna_page_and_forgetting, test_style_play_* | done (11-01) |
| PA4 | Wardrobe: multi-piece photo tagging + crops, edit panel, "Allow in styling" | P0 | test_wardrobe_* | done (11-01, live: 3 pieces from one photo) |
| PA5 | Widget pairs with the wardrobe ("Yours" in Pairs best with), profile seeds gender + photo | P0 | test_wardrobe_untagged_without_a_key_then_pairs_once_tagged | done (11-01, live) |
| PA6 | Daily Picks: casual / formal / trendy, wardrobe first, Claude names, feedback, try on, regenerate | P0 | TRYON-1, test_daily_picks_* | done (11-01, live) |
| PA7 | Stylist page: opens the store stylist with the profile; recent looks | P1 | TRYON-1 | done (11-01) |
| PA8 | Swap drawer: "Shop new" or "From your wardrobe"; owned pieces cost 0, stay off the cart, aren't drawn | P0 | TRYON-2, test_swap_in_a_piece_from_your_own_wardrobe, test_alternatives_without_a_tryon_account_say_so | done (11-01) |

## Log

- 11-01 night — Full real-browser QA (docs/QA_REPORT.md) → fixes across agent (auto-render, ≤1 question, wardrobe-aware looks; evals 17/17 ×2, p50 ~9.5 s), backend (single-vote crew + ratio, owner crews from session, share origin, picks invalidation, crops, video resume ≤12 min, orphaned-render resume), widget/store (See-these-on-you strip, render-as-hero cards, models-first dialogs, Studio tap, mobile header, pressed states, scroll/motion, curated home, judge page), TRYON (Linen & Ink, mobile menu/sheet, owned-pieces notes, demo profile). Backend 112 tests, e2e 34 passed.

- 11-01 — Valid Anthropic key. Evals v1 10/15 → v2 15/15 (judge now separates app cards from Ava's words; 2 repair rounds; 'more formal' replaces one piece; minor note once). Live UI run: onboarding → cached DNA tiles → live agent looks + live renders → follow-up in blue. Known UI nits: DNA result panel covers bottom tile buttons on short viewports; crew polling continues after Forget me.

- 11-01 — Integration: backend 69 tests green, e2e 22/22, prerender + seed + live video done. Units left 873. Anthropic key in .env is a `sk-ant-usr` token (401) → agent runs on fallback until a Console API key is added.

- 11-01 — Data build done. ₹4,000 looks impossible in this catalogue → demo budget ₹7,000 (women) / ₹10,000 (men); docs updated. Units used so far ≈ 16.

- 11-01 00:40 — Key verified (1,000 units). cloth-v4 works; layered skirt→blouse on Nicobar refs looks clean. Catalogue = Nicobar export (pre-enriched, INR, women+men, on-model images, no footwear).
- 11-01 — Backend core (B1–B7, B10–B16) in; 66 unit tests green. Live smoke: Olive Shore (2 calls) + bottom swap (1 call) on w1 = 6 units; 980 left.
- 11-01 — Frontend: store + widget built; e2e 22/22 green (stub renders, fallback agent). Screens in docs/screens (re-run `SCREENS=1 pnpm --dir e2e screens` once the prerender cache is warm).
- 11-01 — Part B chat-first widget (PB1–PB7). Backend 80 tests, e2e 28 passed / 4 skipped (desktop + mobile). Live check on real keys: men's beach looks, shirt alone on m1 + pairs, full look, sister's dress on w1 via model override; 8 units.
- 11-01 — PB10: widget matches the Elara storefront UI; render shows live step + rotating status + progress bar. e2e 28 passed / 4 skipped; backend 80.
- 11-01 — Basics first: every new chat asks gender (+ budget or occasion) before the first looks; remembered values are offered first, not assumed. Backend 81, e2e 28/4 skipped. Live: fresh 'beach outfit' → Women/Men card + budget card; same-chat follow-up asked nothing; New chat asked again with Men first.
- 11-01 — Ask-first on every new request (enforced in the loop, not only the prompt). Live: 'shirts for men' → budget-per-shirt + style card → grid; 'beach outfit' in the same chat → budget-per-look + vibe card → looks; 'more colourful' → no card. Backend 83, e2e 28/4 skipped.
- 11-01 — Part A TRYON platform (PA1–PA7). Backend 93, e2e 29 passed / 5 skipped. Live: onboarding with Claude colour analysis and 7 vibe renders (14 units), wardrobe tagging, daily picks with a try-on, Style Play, stylist page.
- 11-01 — PA8 wardrobe swap. Fixed: widget kept a stale shopper token after a TRYON login on the same page (boot now re-reads it); live Claude rejected all-5-strict tools (grammar too large) and degraded every turn — remember_preference is no longer strict and a 400 now drops only what the API names. Backend 97, e2e 30 passed / 6 skipped.
