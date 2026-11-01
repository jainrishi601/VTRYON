# Design system: "Linen & Ink"

> **11-01 update: the widget follows the Elara storefront look** (as on wearetala.joinelara.shop). The store pages keep
> Linen & Ink; the widget now uses:
> - **Shell:** a centred modal (max 800 px wide, 90vh, 16 px radius, dimmed page), full screen on phones; a bottom-centre
>   "Need help choosing?" launcher pill.
> - **Type and colour:** one sans, **Outfit** (400–700), at 14 px body. Neutral greys: surface `#f5f5f5`, soft `#ebebeb`,
>   line `#e5e5e5`, muted `#737373`, ink `#0a0a0a`. Black pill actions; a pink→blue gradient hairline on the composer.
> - **Look card:** 16 px radius with a faint violet top glow; a black numbered circle, the name, the score and a select
>   circle; a grey "Why this works" pill that opens to the reason, a "Finish it" tip and the score reason; 112 px
>   square piece thumbnails with ↻ swap and ↗ product link; once tried on, the render sits beside the pieces; a footer
>   with Total, Try on (outline) and Add to cart (black).
> - **Status lines:** a filled check when done; a shimmer sweep on the active line. While a look renders, the box shows
>   the real step ("Piece 1 of 2 · Classic Shorts"), a rotating line of what the try-on is doing, and a progress bar.
> - **Try-on:** a centred dialog with the pieces, a large dashed photo dropzone, a consent box, and a full-width
>   Generate Try-On button, with gender-matched sample models below.
> - **After the answer:** "Try next" follow-up chips written by Claude.
>
> The tokens below describe the store pages.

Store: **Northline** (fictional resort/contemporary label; no third-party brand anywhere on screen).
Stylist name inside the widget: **Ava**. Product name: **Elara Commerce**.

Where this doc and the PRD disagree, the PRD wins. Known overrides are marked **[PRD]**.

## 1. Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFFFFF` | page, panel |
| `--surface` | `#F6F4F0` | skeletons, tracks, cards on white |
| `--ink` | `#111111` | text, primary pills |
| `--muted` | `#6B6862` | secondary text |
| `--line` | `#E6E2DB` | borders, dividers |
| `--accent` | `#B5532E` | resort highlight, max 3 uses per screen |
| `--ok` | `#2F7A4F` | success |
| `--warn` | `#B7791F` | warnings |

Dark mode: not built. Store and widget are light-only; a stated non-goal.

**Fonts** (Google Fonts):
- Display: **Instrument Serif**, 400 and italic. Only for headlines and look names.
- Body/UI: **Hanken Grotesk**, 400/500/600.

**Type scale:** 12/14/16/20/28/40/64/88.
- UI labels are 11px uppercase with `tracking-[0.08em]`.
- Prices are always `tabular-nums` and formatted with `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:0})`.

**Radius:** product imagery 0 · inputs 10 · widget cards 14 · sheets 20 (top corners) · pills 999.

**Spacing:** 4, 8, 12, 16, 24, 32, 48, 72, 96. The widget gutter is 24.

**Motion:**
- Easing `cubic-bezier(0.2,0,0,1)`.
- Durations: hover 150ms, sheets 240ms, panel slide 320ms, image crossfade 300ms.
- No bounce.
- Respect `prefers-reduced-motion`.

**Theming hook [PRD]:** the widget reads `--brand-primary` / `--brand-font` from the host page if present, and falls back to the tokens above.

## 2. Storefront (`web/` store pages)

**Header**
- 32px announcement bar (ink background, white 12px): "Complimentary shipping above ₹4,999 · Easy 15-day returns".
- 64px bar with a centred serif wordmark "NORTHLINE".
- Left links: Women, Men, Resort '26.
- Right: Search, Bag with count.
- Sticky, with a bottom border after 120px of scroll.

**Hero**
- 88vh, one on-model image.
- Bottom-left block: eyebrow "RESORT '26" and an 88px serif headline of at most 2 lines.
- Pills: "Shop Women" (white) and "Style me with AI" (outline), which opens the widget.

**Category rail**
- Horizontal 4:5 tiles, 240px wide, 16px gap, `snap-x`.
- Label plus count.

**Grid**
- 4 columns on desktop, 3 on tablet, 2 on mobile. Column gap 16, row gap 48.
- Filter pills: Category, Colour, Price, Occasion.
- "Load 24 more" with a "48 of 312" progress line.

**Product card**
- 3:4 image with no radius, on a `--surface` placeholder.
- Hover crossfades to the second image if one exists.
- Top-left badge text ("NEW" / "LOW STOCK").
- On hover, a black pill **"Try on me"** in the bottom-left. It opens the widget with this SKU pre-loaded. On touch devices it is always visible, smaller.
- Below the image: name 14/20, then the price.

**PDP**
- Left 7 columns: image stack.
- Right 4 columns, sticky: serif name 40px, price, size pills, full-width black "Add to bag" (52px), and an outline "See it on you" button that shows the shopper's avatar once a photo exists.
- Accordions: Details, Fabric & care.
- A "Complete the look" rail opens that outfit in the widget.

**Cart drawer**
- 480px, sharing the right slot with the widget: opening one closes the other.
- Line items: 80×106 thumbnail, name, size, price, and remove.
- AI-styled items carry the tag "Styled with Ava" plus a crew verdict when one exists.
- Sticky subtotal and a black "Checkout" pill. Checkout is a stub [PRD non-goal].

## 3. Widget (Shadow DOM, 480px right panel, full screen under 640px)

**Shell**
- White panel with a 1px left border and shadow `0 0 40px rgba(0,0,0,.08)`.
- 64px header: "Ava" label, segmented tabs **Chat / Studio / Crew** (track `--surface`, active tab white with a shadow), new chat, close.
- Composer pinned at the bottom: 56px, radius 28, paperclip, black round send button.
- Footer links: "Download my style data" · "Forget me".

**Launcher**
- Bottom-right black pill, 52px, 24px inset, reading "Style me".
- After a photo is set it shows the shopper's 28px avatar.
- A badge dot appears when the crew has unread comments.

**Onboarding [PRD order wins: who/occasion/budget, then photo; no sizes]**
1. **Who and what.**
   - Toggle Me / Someone else. If Someone else: relation chips and age-range chips.
   - Gender is asked only when it can't be inferred and the store is multi-gender.
   - Occasion chips (Beach trip, Wedding, Office, Date night, Everyday, Festival) plus free text. Required.
   - Budget slider in ₹ with a "No limit" checkbox.
   - Collapsed "Help me understand you better (optional)": profession, age range, fit.
2. **Photo.**
   - Serif headline "See it on you before it ships."
   - Three guidance lines: full body visible · plain background · face unobstructed.
   - 3:4 dashed dropzone, a camera button, and a "Use a sample model" row with 4 model thumbnails.
   - Consent line: "Your photo is used only to show you clothes and is deleted when you close this session unless you save your profile."

**Style DNA picker**
- 2×2 grid of 3:4 rendered tiles, 12px gap. Each tile has 40px white round ✕ and ♥ buttons.
- ♥ gives the tile a 2px ink ring and a corner check. ✕ turns it grayscale at 40% opacity.
- Header copy: "Pick what feels like you. This teaches your stylist before you've bought anything."
- Pending tiles show a skeleton with a per-tile "Rendering…" label.
- Continue is enabled after 2 picks. A "Just start chatting" link skips.
- Result line: a serif DNA name ("Coastal Minimal") plus 3 trait chips.

**Chat**
- **User bubble:** ink background, white 15px text, radius 20 with the bottom-right corner at 6, max width 80%.
- **Agent text:** no bubble, 16/26, with an "Ava" label on each turn.
- **Status checklist:**
  - Each line has a spinner ring while pending and a filled check when done.
  - The lines carry real numbers ("Found 14 linen pieces under ₹7,000").
  - It collapses to "✓ Done in 8.4s".
- **Clarifying chips:**
  - One question, then outline pills (36px). A single tap sends.
  - The final chip, "Something else…", focuses the input.
  - Never more than one question per turn.
- **Outfit card:**
  - Number and serif name ("1 · Sunset Linen").
  - 3:4 render with an "ON YOU" tag. While pending it shows a skeleton silhouette and the "Rendering on you… ~15 s" line. On failure it shows the flat collage and a "Retry try-on" button.
  - Score badge.
  - Piece rows: 48×64 thumbnail, name, price, ↻ swap icon.
  - Total.
  - "Why this works" accordion.
  - Actions: black "Add look to bag" pill, plus icon buttons See it move (video), Share with Crew, and Open viewer.

**Try-on viewer (overlay inside the panel)**
- Before/after slider: 2px white divider with a 44px handle and BEFORE/AFTER tags. Arrow keys move it 5%.
- One hotspot per piece (20px white dot) that opens the swap drawer.
- History strip of 56px thumbnails, the current one ringed. Tapping one steps back.
- Action bar: Add to cart, Share with Crew, See it move, Download.
- During a swap, only the swapped region shimmers (overlay band on the top or bottom half).

**Swap drawer** (bottom sheet in the panel, 64% height)
- Title "Swap the trousers".
- 4–6 tiles in 2 columns. Each tile: 3:4 image, score badge, name, price delta ("+₹1,200"), and a one-line reason.
- Score bands:

| Score | Label | Background | Text |
|---|---|---|---|
| 85–100 | "92 · Great match" | `#E7F2EA` | `#1F5C3A` |
| 70–84 | "78 · Works" | `#F1EEE8` | `#3D3A35` |
| <70 | "61 · Bold choice" | `#FBEADC` | `#8A4513` |

  Never red, never hidden.
- Empty state: "Nothing else fits the budget. Raise it?"

**Studio**
- Gender toggle, category tabs, and filters.
- 2-column grid in the 480px panel.
- Bottom tray: thumbnails with ×, total, Try on, Add to cart, and an "Ask the stylist to finish this look" link.
- The tray holds one item per slot; a replacement shows an Undo toast.

**Crew**
- Crew name (editable).
- Members strip: overlapping 32px avatars and a "+ Invite" circle.
- Look cards, each with:
  - A horizontal strip of the render on each member who has a photo.
  - Piece rows with 👍 / 👎 / "swap it" reaction counts and a comment-count badge. Expanding a row shows its thread and a reply input.
  - Verdict bar ("3 of 4 love it").
  - A "Group photo" button (P2).
- Join screen: display name plus an optional photo, with "See it on you".

**Share sheet**
- Preview of the share image.
- Rows: WhatsApp, Copy link, Download image.

## 4. Polish checklist (judges notice these)

1. Skeletons match the real geometry (3:4 shimmer at 1.2s). No spinners on images.
2. Progressive reveal: the render fades in from `blur(20px)` to sharp over 400ms, and the status line ticks at the same moment.
3. Status lines carry real numbers and timings.
4. Add-to-bag morph: the pill reads "✓ Added" and the bag count bumps (scale 1 → 1.15 → 1).
5. Score badges count up from 0 over 500ms when the swap drawer opens.
6. Prices use `tabular-nums` with en-IN grouping.
7. Empty states are one serif line plus one action.
8. The composer placeholder rotates through real prompts and pauses on focus.
9. `Esc` closes sheets, a visible 2px focus ring, and alt text on every render ("You wearing Sunset Linen: linen shirt and wide trousers").
10. No layout shift: fixed aspect boxes everywhere. At ≥1440px the panel pushes page content instead of covering it.

**Never:** purple/blue gradients, glassmorphism, ✨ sparkle icons, emoji in system copy, exclamation marks (except the welcome line), or "as an AI".

## 5. Sources

From the research pass:
- Daydream (redantler.com/work/daydream)
- Google "Try it on" guidance
- Doji
- Toteme
- The Frankie Shop
- Alta
- Dressly
- depict.ai grid best practices
- Dazed on AI stylists (Ask Ralph, ASOS)
- Awwwards black-and-white e-commerce
- PollPal and Clueless Style (no-login voting links)

COS, SSENSE and Arket blocked the fetcher, so those patterns come from secondary write-ups.
