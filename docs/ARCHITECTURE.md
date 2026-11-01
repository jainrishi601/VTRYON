# Architecture and API contract

This file is the contract between `backend/` and `web/`. Change it first, then the code.

## 1. Shape

```
Store page (web/src/store, "Northline")
  └─ <script src="/widget.js" data-store-id="northline" data-cart-adapter="custom">
       └─ Widget (React in Shadow DOM)  ── fetch / EventSource ──▶  FastAPI (backend/app)
                                                                      ├─ agent/   Claude loop (Sonnet 5.5) ── tools ─▶ catalog, scoring, dna
                                                                      ├─ renders  ─▶ youcam.py ─▶ YouCam cloth-v4 / image-to-video
                                                                      ├─ crew
                                                                      └─ SQLite (backend/var/elara.db) + backend/var/media/ (renders, photos, share images)
```

- **One backend process.** It serves `/api/*`, `/media/*` (our copies of photos and renders) and, in production, the built `web/dist` (store at `/`, widget at `/widget.js`).
- **Dev:** Vite on :5173 proxies `/api` and `/media` to :8000.
- **Catalogue:** `data/products.json` is loaded into memory at startup. It is about 500 rows, so retrieval is filter + score in Python. No vector DB.
- **Background work:** renders run as `asyncio` tasks in-process. State lives in the `looks` / `renders` tables, so polling works across reloads.
- **Realtime for Crew:** clients poll `GET /api/crews/{id}?since=` every 3 s (PRD-sanctioned fallback). No websocket.

## 2. Data

### 2.1 Product (`data/products.json` row, also the API `Product`)

```json
{
  "id": "nl-0042",
  "title": "Abe Shirt - Ivory",
  "description": "…",
  "price": 4290,
  "currency": "INR",
  "gender": "women | men | unisex",
  "slot": "top | bottom | one_piece | layer | bag | accessory",
  "category": "shirt",
  "colors": ["ivory"],
  "color_family": "white",
  "pattern": "solid",
  "vibes": ["minimal", "classic"],
  "formality": 2,
  "fit": "relaxed | regular | fitted",
  "occasions": ["beach", "brunch"],
  "statement_level": 2,
  "fabric": "cotton poplin",
  "one_liner": "A crisp, airy shirt that…",
  "pairing": {"colors": ["navy", "sand"], "avoid": ["…"]},
  "image_url": "https://cdn.shopify.com/…_1.jpg",
  "image_url_alt": "https://cdn.shopify.com/…_2.jpg",
  "vto_ref_url": "https://cdn.shopify.com/…_1.jpg",
  "vto_ready": true,
  "sizes_in_stock": ["S", "M", "L"],
  "default_size": "M",
  "product_url": "/p/nl-0042"
}
```

- `default_size` (added at load, `catalog.default_size`): M if in stock, else the nearest size in stock (the larger on a tie); bags and accessories are `"One Size"`. A look item's `size` refines it with the shopper's profile size (see `Look`). The cart should start on `item.size ?? product.default_size`, never on `sizes_in_stock[0]`.

- `vibes` ⊂ `minimal, bold, classic, street, boho, sporty, romantic, edgy` (the PRD taxonomy). They are mapped from the source `styleArchetypes` at ingestion.
- `formality` runs 1 (loungewear) to 5 (formal).

**Slot → YouCam `garment_category`**

| Slot | Category |
|---|---|
| top | `upper_body` |
| bottom | `lower_body` |
| one_piece | `full_body` |
| layer | `outer` |
| bag, accessory | not rendered in P0 |

### 2.2 SQLite tables (`app/db.py`, created on startup)

```
sessions(id, user_token, store_id, brief JSON, shopping_for JSON, photo_url, src_url, sample_model_id, photo_gender,
         confirmed JSON /* brief fields the shopper confirmed in this chat */, created_at)
      -- src_url holds the source cache identity (photo:<sha256> | model:<id>); crew members get a session "m_<member_id>"
looks(id, session_id, name, why, items JSON[{slot, product_id}], total, score, score_reason, parent_look_id, budget_max,
      render_status, render_url, render_error, render_steps_done, render_steps_total, render_key, render_cached,
      video_status, video_url, created_at)                           -- render_key = cache key of the final step
renders(id, cache_key UNIQUE, src_key, ref_url, garment_category, task_id, status, result_url, local_path,
        units, latency_ms, cached_hits, error, session_id, created_at) -- the YouCam cache + audit log (+ video rows)
uploads(src_key PK, file_id, created_at)                             -- File API ids, one upload per source
tiles(id, session_id, vibe, product_id, look_id, created_at)         -- Style DNA tiles; each is a one-piece look
nodes(id, user_token, type, key, attrs JSON)                         -- taste graph
edges(id, user_token, from_node, to_node, type, weight, scope, created_at)
messages(id, session_id, role, content JSON, created_at)             -- chat history (for follow-ups)
crews(id, name, occasion, owner_session_id, created_at)
crew_members(id, crew_id, member_token, display_name, photo_url, src_url, is_owner, created_at)
crew_looks(crew_id, look_id, added_at)
crew_member_renders(crew_id, look_id, member_id, look_render_id)     -- the same look re-rendered on a member
crew_comments(id, crew_id, look_id, slot, member_id, text, reaction, created_at)  -- reaction: up|down|swap|null
```

IDs:
- `crews.id`: 16-char URL-safe random.
- `looks.id`: `lk_` + 10 chars.
- `user_token`: 24-char random, stored by the widget in `localStorage['elara.token']`.

## 3. HTTP API (all JSON unless noted; errors `{"error": {"code", "message"}}` with a 4xx/5xx)

### Store and catalogue

| Method | Path | Response |
|---|---|---|
| GET | `/api/store` | `{id:"northline", name:"Northline", currency:"INR", genders:["women","men"], slots:["top","bottom","one_piece","layer","bag","accessory"], occasions:["Beach trip","Wedding","Office","Date night","Everyday","Festival"], budget:{min:2000,max:30000,step:500,default:7000}}` |
| GET | `/api/products?gender=&slot=&q=&vibe=&max_price=&offset=0&limit=24` | `{items:[Product], total}` |
| GET | `/api/products/{id}` | `Product` |
| GET | `/api/models` | `{models:[{id:"w1", gender:"women", label:"Model 1", image_url:"/media/models/w1.jpg"}]}` (4 sample models) |

### Session, onboarding, photo

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/session` | `{user_token?}` | `{session_id, user_token, returning:bool, profile: Profile\|null, crews: CrewRef[]}` |
| PATCH | `/api/session/{sid}` | `{brief: Brief}` | `Session` |
| POST | `/api/session/{sid}/photo` | multipart `file` (+ `photo_gender`: `women`\|`men`, which clothes the photo wears) **or** JSON `{sample_model_id}` | `{photo_url, photo_gender}`; 422 `{error:{code:"photo_invalid", message}}` when the check fails |
| GET | `/api/session/{sid}` | — | `Session` |

```ts
Brief   = { for: "self"|"other", recipient?: {relation?, gender?: "women"|"men", age_range?}, occasion: string,
            budget_max?: number|null, gender?: "women"|"men"|"both", profession?, age_range?, fit?: "relaxed"|"regular"|"fitted" }
Session = { id, user_token, brief: Brief|null, photo_url|null, sample_model_id|null,
            photo_gender: "women"|"men"|null /* a sample model's own gender, else what the shopper set */, dna: DnaSummary,
            crews: CrewRef[] /* the crews this shopper's token owns or joined, most recently active first */ }
CrewRef = { id, name, occasion, is_owner: boolean, looks: number, updated_at }
Profile = { brief: Brief|null, dna: DnaSummary, last_occasion: string|null }
DnaSummary = { vibes: {[vibe]: number}, colors: {[color]: number}, never: string[], name: string|null, traits: string[] }
```

### Style DNA picker

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/session/{sid}/dna/tiles` | `{}` | `{tiles: Tile[]}` (renders start immediately, 4 in parallel) |
| GET | `/api/session/{sid}/dna/tiles` | — | `{tiles: Tile[]}` (poll every 1.5 s until all are `ready` or `failed`) |
| POST | `/api/session/{sid}/dna/pick` | `{tile_id, verdict:"heart"\|"cross"}` | `{dna: DnaSummary}` |

`Tile = { id, vibe, product: Product, status: "pending"|"ready"|"failed", image_url|null }`.

The fallback `image_url` is `product.image_url` when the render fails.

### Chat (SSE)

`POST /api/chat` with body `{session_id, message, look_id?, attachment_url?, answers?: [{field, value}]}`. `answers` are question-card picks (`field`: `wearer`\|`gender`\|`occasion`\|`budget`, max 2); they are merged into the brief before Claude sees the turn. The response is `text/event-stream`. Each event is `event: <type>\ndata: <json>\n\n`.

| event | data | meaning |
|---|---|---|
| `status` | `{id, label, state:"active"\|"done"}` | Status checklist line. `label` carries real numbers ("Found 14 linen pieces under ₹7,000"). |
| `text` | `{delta}` | Streamed agent prose. |
| `clarify` | `{questions: [{field, question, options:[{label, value}]}]}` | One question card, 1–2 questions. The widget adds "Something else" and Skip. The turn ends after this. |
| `products` | `{products: [{product: Product, match: number\|null}], message_id}` | A product grid (a request for a kind of piece). `match` is the Style DNA match, null for a cold-start shopper. |
| `looks` | `{looks: Look[], message_id}` | Outfit cards, flat (`render.status: "idle"`): a look renders only when the shopper taps Try on. An edit of a look already on the shopper re-renders the changed piece. |
| `suggest` | `{items: [string]}` | "Try next" follow-ups (2–3, written by Claude) shown under the answer. |
| `look` | `{look: Look}` | Update to one look (render progress, ready or failed). |
| `error` | `{message}` | User-safe copy. |
| `done` | `{}` | Stream end. |

**Stream closing rule.** The stream closes once the answer is out; if the turn edited a look that was already on the shopper, it waits for that re-render (75 s cap). The client polls `GET /api/looks/{id}` for anything still rendering.

`GET /api/session/{sid}/messages` returns `{messages: [{role, text, looks?: Look[], products?, clarify?, try_next?, attachment_url?}]}` and is used to restore chat on reload.

### Looks, try-on, swap, video

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/looks/{id}` | — | `Look` |
| POST | `/api/looks/{id}/render` | `{model_id?}` | `Look` (starts or retries the full-look render; a no-op if ready). `model_id` renders on that sample model and keeps the shopper's photo. A look whose gender differs from the photo's fails with `render.code: "gender_mismatch"` and never spends a unit. |
| POST | `/api/tryon` | `{session_id, product_ids:[...], name?, model_id?}` | `Look` (Studio, product cards, single-piece "See this on you": builds an ad-hoc look and starts the render) |
| GET | `/api/looks/{id}/alternatives?slot=bottom` | — | `{slot, items: Alternative[], wardrobe: {account, owned}}`: the shopper's own pieces first (`owned: true`, up to 8, not for gifts), then 4–6 store pieces ranked by score within the remaining budget. `wardrobe.account` says whether the shopper has a TRYON account (the drawer's empty-state copy). |
| POST | `/api/looks/{id}/swap` | `{slot, product_id}` | `Look` (a new look with `parent_look_id`; swap-mode render pending). `product_id` may be a catalogue id or the shopper's own `w_` wardrobe id (404 if it belongs to someone else); owned pieces cost 0 and aren't drawn, so only the store pieces re-render. |
| POST | `/api/looks/{id}/video` | `{}` | `Look` (`video.status` → `pending`). A clip can take 5–10 min. Each polling window is `VIDEO_TIMEOUT` (12 min); after it the look stays `pending` and `GET /api/looks/{id}` (or a restart) resumes polling the **same** YouCam task (no new units). Only a real YouCam error (task error, 4xx) sets `failed`. |
| POST | `/api/looks/{id}/feedback` | `{kind:"like"\|"dislike"\|"cart"}` | `{ok:true}` (writes taste edges) |

```ts
Look = { id, name, why, tip: string|null /* finishing tip for things the store doesn't sell */,
         items: [{slot, product: Product, size: string|null /* cart default: profile size for tops/bottoms/dresses,
                  else M, else nearest in stock; "One Size" for bags; null for owned pieces */}], total, currency:"INR",
         undrawn_pieces: string[] /* titles of the shopper's own (wardrobe) pieces in the look: never drawn on the
                                    render, which shows the store pieces only */,
         undrawn_note: string|null /* ready copy for that, e.g. "Try-on shows the store pieces only, not your
                                     Ivory Palazzo Trousers." */,
         score: number, score_band: "great"|"works"|"bold", score_reason: string,
         budget_max: number|null, over_budget_by: number|null, parent_look_id: string|null,
         gender: "women"|"men"|null /* unisex pieces don't count */, model_id: string|null,
         render: { status: "idle"|"pending"|"rendering"|"ready"|"failed", image_url: string|null, steps_done, steps_total,
                   cached: boolean, error: string|null /* user-safe copy */,
                   code: "no_photo"|"minor"|"gender_mismatch"|null /* why it didn't render, for the next step */ },
         video: { status: "none"|"pending"|"ready"|"failed", url: string|null },
         before_url: string|null /* the shopper photo, for the before/after slider */ }
Alternative = { product: Product, score, score_band, reason, price_delta }
```

### Style Crew

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/crews` | `{session_id, look_id, name?, display_name?}` | `Crew` (adds the look to the shopper's crew: this session's, else the newest crew their token owns, else a new one where the owner is a member named `display_name`, default "Host"; the owner's `member_token` is their `user_token`) |
| GET | `/api/crews?user_token=` | — | `{crews: CrewRef[]}` (same list as `Session.crews`) |
| GET | `/api/crews/{id}?member_token=&since=` | — | `Crew` (always the full state; `since` is accepted and ignored) |
| POST | `/api/crews/{id}/join` | `{display_name, sample_model_id?, user_token?}` or multipart `display_name`, `user_token?`, `file?` | `{member_token, crew: Crew}`; if a photo is given, every crew look starts rendering on the member. With `user_token` the membership is keyed on it (idempotent; `member_token` = `user_token`) so the crew shows in that shopper's `Session.crews`. |
| POST | `/api/crews/{id}/looks` | `{member_token, look_id}` | `Crew` |
| POST | `/api/crews/{id}/comments` | `{member_token, look_id, slot\|null, text?, reaction?: "up"\|"down"\|"swap"}` | `Comment`. Comments are many. Reactions are **one per member per piece** (`slot`; `null` = the whole look): a different reaction replaces the old one, the same reaction again without text toggles it off and returns `{…Comment, reaction: null, removed: true}`. |
| GET | `/api/crews/{id}/share.png?look_id=&format=square\|story` | — | PNG (1080×1080 or 1080×1920); the footer link uses the same web origin as `share_url` |

```ts
Crew = { id, name, occasion, share_url /* <web origin>/?crew=<id> */, members: Member[], looks: CrewLook[],
         comments: Comment[], updated_at }
Member = { id, display_name, avatar_url|null, is_owner, is_you }
CrewLook = { look: Look, renders: [{member_id, status, image_url|null}],
             verdict: {up, down, voters /* members who reacted to the look or a piece */, members /* M */,
                       ratio /* up / members, 0..1: size the bar by this */, label /* "2 of 3 love it" */},
             slot_counts: {[slot]: {up, down, swap /* members, one reaction each */, comments}},
             my_reactions: {[slot | "look"]: "up"|"down"|"swap"} /* the caller's (member_token) current reactions */ }
Comment = { id, look_id, slot|null, member_id, display_name, text|null, reaction|null, created_at }
```

### Taste graph and privacy

| Method | Path | Response |
|---|---|---|
| GET | `/api/dna/{user_token}` | `{summary: DnaSummary, nodes, edges}` (also "Download my style data") |
| DELETE | `/api/dna/{user_token}` | `{ok:true}` ("Forget me": deletes edges, sessions' photos and renders for that token) |

### Ops

| Method | Path | Response |
|---|---|---|
| GET | `/api/status` | `{ok, youcam:{units_left, demo_mode}, anthropic:{configured}, catalog:{count}}` |
| GET | `/api/admin/renders` | `{renders:[…], totals:{calls, cache_hits, units}}`, plus an HTML page at `/admin/renders` for judges |

### TRYON platform (`app/tryon.py`, `app/tryon_routes.py`; web: `/tryon/*`)

The shopper's own profile, shared with the store widget through the account's `user_token` (login sets the widget's
`elara.token`). Bearer auth on every `/api/me/*` route.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/signup` · `/api/auth/login` | `{name?, email, password, user_token?}` | `{auth, user}` (signup adopts the browser's widget token so earlier taste carries over) |
| GET | `/api/me` | — | `User` with `profile` |
| PATCH | `/api/me/profile` | goal, gender, profession, age_range, sizes, height_cm, weight_kg, colors, never, onboarded, step | profile (colours become colour likes; never items become never edges) |
| POST | `/api/me/photo?kind=selfie\|body` | multipart `file` | profile (body = the try-on photo; new widget chats start with it and the gender) |
| POST | `/api/me/colors/analyze` | — | `{undertone, summary, recommended[], analyzed}` (Claude vision on the selfie, fixed palette) |
| POST/GET | `/api/me/vibes/start` · `/api/me/vibes` | — | `{vibes:[…]}` one look per vibe, rendered on the body photo (2 units each, cached) |
| POST | `/api/me/vibes/{tile}` | `{verdict: love\|like\|dislike}` | `{dna}` |
| GET/POST | `/api/me/wardrobe` | multipart `file` (many) | `{items}`; Claude tags every piece in a photo in catalogue fields and crops each (`tryon.crop_box`: worn pieces clipped to their slot's band and a top stops at the bottom's waistband; shoes, jewellery and bags get a padded tight crop, or their usual band when the box is unusable, never the whole photo) |
| PATCH/DELETE | `/api/me/wardrobe/{id}` | name, slot, category, color_family, pattern, fit, formality, allow_styling | item |
| GET | `/api/me/dna` · DELETE `/api/me/dna?kind&value` | — | facts, learning, never, wardrobe counts, occasions, timeline |
| GET | `/api/me/daily` · POST `/api/me/daily/regenerate` | — | `{day, picks:[{kind, label, look, owned, can_try, feedback}], wardrobe_items}` casual / formal / trendy, wardrobe first. Today's picks are dropped on any wardrobe add/edit/delete, so the next GET rebuilds them. `wardrobe_items` = pieces owned: show "Add my wardrobe" only when it is 0. A pick has at most one finishing piece per slot (never two pairs of shoes). |
| POST | `/api/me/daily/{look}/feedback` | `{kind: wore\|like\|dislike}` | `{ok}` |
| GET/POST | `/api/me/play?context=` · `/api/me/play` | `{pair_id, choice: a\|b\|both\|neither\|unsure}` | an A/B pair differing in one dimension (surface, colour, fit, mood) / `{dna}` |
| GET | `/api/me/looks` | — | the stylist's recent looks for this shopper |

Wardrobe pieces (`w_` ids) can sit in looks (`looks.piece`); they never render (no VTO ref) and score like products.
The widget's `/api/looks/{id}/alternatives` lists the shopper's own pieces first (`owned: true`); the agent context
gets a one-line wardrobe summary.

## 4. Render pipeline (`app/renders.py`: plan/run; `app/looks.py`: look rows, background tasks, swap, tiles, video)

```
plan(look, src) ->
  one_piece present:  [full_body(one_piece)] + [outer(layer)?]
  else:               [lower_body(bottom), upper_body(top)] + [outer(layer)?]
run(plan): for step in plan: result = youcam.try_on(src=current, ref=step.ref, category) ; current = result.url
swap(look, slot, new_product):
  slot is bottom/top/layer and the parent render is ready -> 1 call with src = parent render url
  slot is one_piece (or the parent is not ready)           -> full re-plan
```

- **Source identity for the cache.**
  - A user photo uses `sha256(bytes)`.
  - A sample model uses `model:<id>`.
  - A chained step uses the cache key of the previous step.
- **Identical looks on the same photo** cost 0 units, including across crew members viewing the same look.
- **What `src` is passed as.** `src_file_url` is our public `/media` URL when `PUBLIC_BASE_URL` is set. Otherwise the file is uploaded via the File API once and the `file_id` is cached by `src_key`. A previous YouCam result URL is valid for 2 h, so chained steps pass it directly (after ~1 h 45 m the local copy is uploaded instead).
- **Session cap.** `SESSION_RENDER_CAP` (20) counts live cloth-v4 calls per session (cache hits are free). Over the cap, a look fails with copy.
- **No render** (status `failed` + copy, no call): no photo ("Add a photo to see it on you"), a minor in the brief (`age_range` under 18), or no piece with a VTO ref.
- **Video** needs a ready render. `src` is the render's YouCam URL while fresh, else the public `/media` URL, else our local copy uploaded once via `POST /s2s/v2.0/file/image-to-video` (falls back to `/file/cloth`) and sent as `src_file_id`; the `file_id` is cached in `uploads` as `image-to-video:<render_key>`.
- **Share links** (`Crew.share_url`, the share PNG footer) use the web app's origin: `WEB_URL` if set, else the request's `Origin`/`Referer`, else `PUBLIC_BASE_URL`, else `http://localhost:5180` (`config.web_url`).
- **`RENDER_STUB=1`**: no network and no `renders` rows; the result is the source photo with a coloured band, served from `/media/stub/`.

## 5. Agent turn (summary; details in `AGENT_SPEC.md`)

```
POST /api/chat
  → load session (brief, DNA, recipient, current looks, last 12 messages)
  → status "Reading your message"
  → apply question-card answers to the brief
  → Claude loop (≤4 tool rounds): search_catalog* → present_looks | present_products | ask_clarification | plain text
      search_catalog   → status "Searching the catalogue" → "Found N … under ₹X"
      present_looks    → save `wearer` to the brief → validate (refs, slots, gender, budget), score, persist → SSE `looks` (flat)
      present_products → save `wearer` → validate (refs, gender, never list) → SSE `products`
  → shopper taps Try on → photo check (gender, consent) → render tasks → polled `Look` updates
  → memory writer: tried_on edges (scoped to the recipient for gifts)
```

Without `ANTHROPIC_API_KEY`, or when Claude fails twice, `agent/fallback.py` composes looks deterministically from brief + retrieval + scoring, so a turn never dead-ends.

## 6. Widget embed

```html
<script src="https://<host>/widget.js" data-store-id="northline" data-api="https://<host>"
        data-position="bottom-center" data-cart-adapter="custom"></script>  <!-- or bottom-left / bottom-right -->
```

- `widget.js` creates `<div id="elara-root">`, attaches an open shadow root, injects compiled CSS, and mounts React.
- **Theming:** it reads `--brand-primary` / `--brand-font` from the host `:root` if present.
- **Cart adapter `custom`:** it calls `window.elaraAddToCart(items)` and the store opens its drawer. `shopify` posts to `/cart/add.js`.
- **Entry points:**
  - `window.Elara.open({tab?, productId?})`
  - `?crew=<id>` opens the Crew view
  - `?look=<id>` opens that look
  - elements with `[data-elara-tryon="<productId>"]` get a click handler
