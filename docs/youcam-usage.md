# YouCam API usage

Every YouCam call goes through `backend/app/youcam.py`. Nothing else in the repo talks to YouCam.
Verified live against the hackathon key on 2026-11-01 (cloth-v4 full_body: 14 s, 2 units).

## Auth and host

- Host: `https://yce-api-01.makeupar.com`
- Header: `Authorization: Bearer $YOUCAM_API_KEY` (the `sk-...` key; the RSA public key in the console is for the legacy v1 flow and is NOT used)
- Balance: `GET /s2s/v1.0/client/credit` → `results[0].amount` (v2.0 path 404s)

## Endpoints we use

| API | Endpoint | Units | Used for |
|---|---|---|---|
| File upload | `POST /s2s/v2.0/file/cloth` body `{files:[{content_type,file_name,file_size}]}` → `data.files[0].file_id` + `requests[0].url` (S3 PUT with the returned headers) | 0 | User photo once per session; renders re-uploaded when used as `src` for a swap |
| Clothes VTO v4 | `POST /s2s/v2.0/task/cloth-v4` → `data.task_id`; poll `GET /s2s/v2.0/task/cloth-v4/{task_id}` until `data.task_status` is `success`/`error` | 2 | Single item, full look (layered), swap re-render, Style DNA tiles |
| Image → Video | `POST /s2s/v2.0/task/image-to-video/youcam` body `{src_file_url, resolution:"480", dst_duration:5, prompt}`; poll `GET .../image-to-video/youcam/{task_id}` | 1/s at 480p → 5 | "See it move": 5 s clip of a finished look. **Takes 5–8 min** (measured 11-01); poll ≤ 420 s, a retry resumes the same `task_id` (never pays twice) |
| AI Bag / Hat / Scarf (P2) | `/s2s/v2.0/task/bag` etc. (need `gender`) | see docs | Accessory slot |
| Background change (P2) | `/s2s/v2.0/task/background-change` | see docs | Crew group photo scene |

### cloth-v4 request

```json
{
  "src_file_id": "<user photo file_id>",        // or src_file_url
  "ref_file_url": "https://cdn/.../sku.jpg",    // or ref_file_id
  "garment_category": "upper_body",             // full_body | upper_body | lower_body | shoes | outer | auto
  "change_shoes": false,                        // only matters for full_body / lower_body
  "filter_multi_person": "off"
}
```

`outer` (v4 only) is what we use for the layer slot (jackets, overshirts).

## Hard rules learned from the docs

1. **Lower-body refs must be worn photos.** "For the lower body, only actual worn outfits are supported, not standalone product images." Every bottom in `data/products.json` needs an on-model `vto_ref_url`; flat-lay bottoms get `vto_ready=false`.
2. Ref images: single garment, front-facing, no composites (no top+bottom in one product shot).
3. Src image: one person, facing forward, standing, face visible, 512×384 min, long side ≤ 4096 px, < 10 MB, jpg/png.
4. Result URLs are signed S3 links valid **2 hours**. Download immediately into `backend/var/renders/` and serve our own copy.
5. Uploaded files and task ids live 30 days.
6. Rate limit: 250 req / 300 s per IP and per key (~5 QPS). Polling counts, so poll every 2 s, not faster.

## Render modes (PRD §11.1)

| Mode | src | ref | category | calls |
|---|---|---|---|---|
| Single item | user photo | product | by slot | 1 |
| One-piece look | user photo | dress/set | `full_body` | 1 |
| Separates look | user photo → result → result | bottom, then top, then layer | `lower_body` → `upper_body` → `outer` | 2–3 sequential |
| Swap | current render | new piece | that slot's category | 1 |
| Style DNA tile | sample/user photo | representative piece per vibe | `auto` / `full_body` | 4 parallel |
| Video | finished render | — | — | 1 |

Bottom first, then top, so the top's hem sits over the trousers.

## Wrapper behaviour

- Cache key = sha256(src identity, ref url, category, change_shoes). Hit → zero units, `cached: true`.
- Concurrency: 4 in flight per session, 8 globally (asyncio semaphores).
- 429 → back off 2 s / 4 s / 8 s. `InvalidParameters` → retry once with `auto`.
- `CreditInsufficiency` or `YOUCAM_DEMO_MODE=1` → serve only cached renders and flag `demo_mode` to the UI.
- Hard timeout 60 s per task. The UI shows the flat product collage after 45 s and swaps the render in if it arrives later.
- Every call is logged to the `renders` table (cache hit/miss, units, latency) and shown at `/admin/renders`.

## Error codes worth mapping to copy

| code | user copy |
|---|---|
| `error_pose`, `error_invalid_src` | "Step back so your whole body is visible, facing the camera." |
| `error_multi_person` | "Only you in the photo, please." |
| `error_no_face` | "We need to see your face to keep it you." |
| `exceed_max_filesize`, `error_below_min_image_size` | "That photo's size won't work. Try a JPG or PNG under 10 MB." |
| `error_nsfw_content_detected` | "We couldn't render this one. Try a different photo." |
| anything else | "We couldn't render this one. Try another photo or a different piece." |

## Budget

1,000 units on the key (2 units/try-on). Plan: ~100 renders for pre-rendered demo content (Style DNA tiles for 4 sample models, 12 scripted looks), ~150 for live judging, ~10 video clips, rest buffer. The per-session live cap is 20 renders.
