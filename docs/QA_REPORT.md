# QA report: real-browser end-to-end pass (11-01, after pulling `a2f6724`)

**Testers**
- Saksham + Claude in the in-app browser: store, widget chat, try-on, swap, cart, Studio, mobile.
- A QA agent in Playwright: the TRYON platform, wardrobe, the Crew friend side, judge pages.

**Setup**
- Live mode: real Claude Sonnet 5.5 and real YouCam.
- Web on :5180 (port :5173 is taken by an unrelated local project). API on :8000.

**Automated baseline**
- Backend: 98 tests pass, ruff clean.
- Web: build OK.
- e2e: 30 passed, 6 skipped.
- Evals: 10/15. See §3; the drop is a spec conflict, not a crash.

## 1. Fixed during this pass

| # | Sev | Area | Bug | Fix |
|---|---|---|---|---|
| 1 | P0 | Agent | The model's internal note **"Retry broader."** was shown to the shopper at the top of a reply. Any prose Claude writes in a round that ends with a tool call was streamed live. | `loop.py` holds each round's prose. It is shown only if the round is a plain answer and dropped when the round calls tools. A failed call can also be retried cleanly now, because nothing was shown. |
| 2 | P0 | Agent / session | **A new chat inherited the last chat's gift recipient.** After "outfit for my brother", a new chat asking "mens linen shirt for office" was answered as "your brother's pick". | `sessions._carry`: a new chat starts `for: self`. The recipient and the recipient's gender are dropped; occasion and budget carry as unconfirmed hints. Test added. |
| 3 | P0 | Widget | **The question card answered the wrong question.** It swaps to question 2 instantly, so a second click or a double-tap lands on question 2's first option. Repro: Goa request → click "Women" twice → "Women · Boho" sent. Brother request → arrow then click → "Under ₹3,000" sent, and the vibe answer was lost. | The pick is highlighted for 260 ms, then the card advances with a fade. Clicks are ignored during that window. |
| 4 | P1 | Agent | Budget chips offered "Under ₹3,000" for outfits. The cheapest complete outfit is ₹4,250 (women) and ₹5,750 (men), so every look came back over budget. | Outfit bands are now Under ₹6,000 / ₹6–9k / ₹9–14k / No limit, with a price-floor note. The single-piece bands are separate. |
| 5 | P1 | Perf | Every product image loaded at full size from the Shopify CDN. The hero and grids took about 3 s to paint. | `catalog._sized` adds `width=800` to display images (about 3× lighter). `vto_ref_url` stays full-res for YouCam. |
| 6 | P2 | Evals | `run_evals.py` crashed on the new multi-question card shape. | `_card()` normalises both shapes. |

## 2. Open findings (not fixed yet)

| # | Sev | Area | Finding | Suggested fix |
|---|---|---|---|---|
| A | P0 | Product / judging | **Looks arrive as product thumbnails. Try-on runs only when the shopper taps it, and a photo is asked for at that moment.** The PRD's first principle is "Show, don't list: every recommendation is a picture of the shopper wearing it". The video beat "outfits rendered on you in under 60 s" now needs extra taps. | Once a photo (or sample model) is set, auto-render the first look of each turn (1 look ≈ 4 units), or offer a one-tap "Pick a model to see all looks on you". |
| B | P0 | Spec conflict | The new request card asks **2 questions** (e.g. budget + vibe for "farewell outfit for my brother, he's 20"). The PRD and AGENT_SPEC say at most one question, ask only what's needed, and the gifting beat should go straight to looks. Evals E3/E4/E12/E13 fail on this. | Team decision. Either restore the "≤1 question, skip when inferable" rule, or rewrite AGENT_SPEC §3 and the evals to the new card. Don't leave the docs and the behaviour disagreeing. |
| C | P1 | Try-on dialog | "No photo handy? Use a sample model" sits **below the fold**, under "Generate Try-On". Judges won't find it. Same in the gender-guard dialog ("Try them on a men's model below"). | Put the sample models first (top row), with upload second. |
| D | P1 | Studio | The bottom tray covers the "+" buttons on the last visible row, and tapping a tile does nothing. You can only add a piece through the small "+". | Tile tap = add (or open details). Add bottom padding equal to the tray height. |
| E | P1 | Mobile | The widget header truncates the brand to **"NOR…"** at 375 px. | Use a smaller wordmark or hide it under 400 px. Tabs keep priority. |
| F | P1 | Clarity | Every click on the card or Try on has a visible delay of about 1–2 s before the UI changes, with no pressed state. That invites double-clicks (the cause of #3). | Add a pressed/active state on option rows and buttons. |
| G | P2 | Copy | "1 pieces · ₹5,750" in the viewer. | Pluralise. |
| H | P2 | Copy | "Nothing in his size of budget fits". | Prompt or voice check. |
| I | P2 | Cart | Default sizes are inconsistent (top M, trousers XS). | Default to M (or the shopper's last size) for every piece. |
| J | P1 | Video | "See it move": the live clip took **more than 420 s and was marked failed** (an earlier clip took 277 s). A retry resumes the same paid task. The viewer shows only a spinner, with no "a few minutes" copy. | Keep it `pending` and keep polling up to about 12 min instead of failing. Show the "a few minutes" pill in the viewer. For the demo, prerender the clip. |
| K | P2 | Studio / swap | Tiles are oversized in the desktop modal: 2 columns at about 200 px wide, only 2 visible at a time. | 3 columns at ≥ 640 px. |
| L | P2 | Gender guard | The guard copy is white text over a white shirt render, and is hard to read. | Use a solid ink chip behind the text. |
| N | P2 | PDP | The PDP "See it on you" result is titled **"Studio Pick"** instead of the product name. It works (single-item render on the saved model in about 20 s). | Title it with the product name. |
| M | P2 | Launcher | On mobile, "Need help choosing?" wraps to 2 lines. | Shorter label ("Style me") under 400 px. |

## 3. Agent quality (live)

| Prompt | Result |
|---|---|
| "going to goa next week with friends, need something breezy, budget around 7k" | Card (gender + vibe), then 3 looks all ≤ ₹7k in 10.3 s. Strong names ("Dotted Drift", "Garden Cupro"), scores 76–88. |
| "college farewell outfit for my brother, he's 20, budget 10k" | No card. 3 men's looks, "for him", ₹7.2–9k, 15.1 s. |
| "mens linen shirt for office under 5000" | Product grid (correct: a product request gets pieces, not outfits) plus useful try-next chips. |
| follow-up chip "Only relaxed fits" | Filtered correctly in the same session (after fix #2, no more "brother"). |
| "love the kaftan but… in blue" (earlier run) | Noticed the shown kaftan was already navy and offered 2 lighter blues. |

Latency: first status under 1 s; looks in 10–17 s (target under 12 s p50).

## 4. What works well (judge positives)

- Live YouCam renders are clean: one-piece in about 30 s; a separates swap re-renders only the trousers.
- The before/after slider, hotspots and history strip all work.
- Cart handoff carries "Styled with Ava · <look>" provenance tags.
- The gender guard catches men's pieces on a women's photo and offers a men's model.
- Personalised suggestions on new chat ("Looks for the goa trip with friends").
- The full-screen mobile chat has no horizontal overflow.

## 5. TRYON platform, wardrobe ↔ widget, Crew, judge pages (QA agent, Playwright)

Units: 16 of the 29 units spent in this window came from this pass. Screenshots are in `.playwright-mcp/qa/` (gitignored).

**Caveat:** fixes were landing mid-test, so the backend restarted and Vite reloaded several times. Only findings reproducible in a fresh tab are listed.

| # | Sev | Area | Finding | Likely source |
|---|---|---|---|---|
| T1 | P1 | Stylist ↔ wardrobe | "Build a brunch look around my ivory palazzo trousers" returns 3 looks with a **store** ivory pant (₹3,000, Add to cart). Ava only says the shopper's palazzos "can stand in". It ends up selling her what she owns. | agent prompts / looks grounding (wardrobe refs) |
| T2 | P1 | Daily Picks | The card says the kurta goes with her palazzos and sandals. The render shows the body photo's own jeans and boots; the card crop hides the legs. There is no "your pieces aren't drawn" note. | Picks.tsx |
| T3 | P1 | Daily Picks | Picks are stale after adding 9 wardrobe pieces: they stay store-only, with an "Add my wardrobe" banner. Only Regenerate fixes it. | tryon.py daily cache not invalidated on wardrobe change |
| T4 | P1 | Wardrobe | Small or overlapping pieces (earrings, hairpin, sandals) are cropped to the whole photo. The sweater crop includes the trouser waistband. One pick has 2 footwear items. | tryon.py crop boxes / pick slot rules |
| T5 | P1 | Crew | Reactions stack: 4× "Love it" plus "Not this" from one friend all count. | crew.py: upsert one reaction per member per piece |
| T6 | P1 | Crew | The verdict bar is always 100% filled ("1 of 4", "2 of 5"), and per-item counts disagree with the headline. | widget Crew view |
| T7 | P1 | Crew | Owner token `demo-priya-token-000000000` in a fresh browser: the Crew tab is empty until `?crew=` is opened once. | widget Crew tab reads the crew id from localStorage, not from the session |
| T8 | P1 | Share | The share PNG footer link uses `localhost:5173`, while the app runs on :5180. | backend public URL (`PUBLIC_BASE_URL` fallback) |
| T9 | P1 | Judge page | Stale: it still describes the "black Style me pill bottom-right" and the onboarding-first flow. It doesn't mention TRYON, and nothing in the store links `/tryon`. | store/info.tsx |
| T10 | P1 | TRYON mobile | No navigation: only Daily Picks and Stylist. Wardrobe, DNA, profile and sign-out are unreachable. | tryon/App.tsx Shell |
| T11 | P1 | TRYON mobile | The wardrobe item panel (fixed 380 px) squeezes the grid to about 50 px. The page scrolls sideways and the close button is clipped. | Wardrobe.tsx ItemPanel |
| T12 | P1 | TRYON Stylist | Add to cart closes the widget with no confirmation, although the item is in the cart. | tryon/Stylist + cart adapter |
| T13 | P2 | TRYON | Sign-out leaves `elara.token`, `elara.avatar` and the cart in localStorage, so the store widget still greets the old shopper. There's no cross-account leak: a new signup gets a fresh token. | tryon/App.tsx signOut |
| T14 | P2 | Onboarding | The "Minimal · quiet colour" vibe shows a fuchsia dress. It asks a footwear size though no footwear is sold. Back drops unsaved height. "Skip all" stays after the photos are uploaded. The toggle knobs are black on a dark background. | none |
| T15 | P2 | Style DNA | 8 colour names for 11 swatches; Style Map labels truncated; the tab isn't in the URL (reload resets it); Style Play A/B pairs differ in everything, not "one visible difference". | none |
| T16 | P2 | Wardrobe | Delete has no confirm or undo. A rename is lost if you toggle "Allow in styling". Order flips on reload. "1 items". | none |
| T17 | P2 | Stylist | "Recent looks" shows the parent look, not the swapped one. An unknown `/tryon/*` route shows Picks. Login loses the intended destination. | none |
| T18 | P2 | Mobile widget | Header truncation (same as E). Footer links are 17 px tap targets. The crew join offers men's models for a women's crew. | none |

**Positives:**
- TRYON onboarding looks premium: the selfie palette reads in about 3 s, and 7 vibe renders are ready in about 15 s.
- File errors get clean copy.
- Claude wardrobe tagging finds 10 pieces in 3 photos in about 18 s.
- Style DNA edits are live.
- The wardrobe swap in the widget works ("saves ₹3,000"; only store pieces go to the cart).
- The shopper token is shared between TRYON and the widget ("Welcome back").
- Crew comments arrive in about 3 s, and WhatsApp, copy and PNG share all work.
- `/admin/renders` is a good judge artifact.

**Judge view:**
- **Design:** TRYON has a third palette (pink and orange) next to the black-and-white widget. Mobile TRYON is not demo-safe.
- **Idea:** "wardrobe + store" is strong, but T1/T2 undercut it on camera.
- **Tech:** T3/T5/T8 read as unfinished.

## 6. Recommended fix order before recording

1. Decide A (auto-render the first look) and B (1 vs 2 questions); then align AGENT_SPEC and the evals.
2. T1/T2: an owned piece named by the shopper goes into the look at ₹0, marked "Yours", and every render that skips owned pieces says so.
3. T5/T6/T7: one reaction per member per piece; the verdict bar sized by the vote ratio; the owner finds their crew from the session.
4. C: sample models first in the try-on dialog. T8/T9: the share URL port, and a judge page rewritten for the chat-first flow and TRYON, linked from the store.
5. E/T10/T11: mobile header and TRYON mobile navigation, or keep TRYON desktop-only in the video.
6. D/F: Studio tray padding plus tile tap; pressed states.
