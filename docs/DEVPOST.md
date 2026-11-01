# Devpost submission (draft, under 400 words)

**Name:** Elara Commerce

**Tagline:** An agentic AI stylist for any fashion store. Describe the occasion, see complete outfits on you, swap any piece, and shop it with your crew.

## Inspiration

Online fashion still asks shoppers to do the stylist's job alone. They find the piece, imagine it on their own body, guess what goes with it, and then ask friends in a WhatsApp group the store never sees. Each gap costs a sale or causes a return. Existing try-on is a button on one product page. It answers "how does this look?" only after the shopper already knows what to try.

## What it does

A store adds one script tag. The shopper:
1. Answers two quick screens: who it's for, the occasion, a budget, and one photo.
2. Picks from four looks already rendered on them. These picks seed their Style DNA.
3. Talks to Ava, the stylist: "beach trip, ₹7,000" or "farewell outfit for my brother".

Ava builds 2–3 complete looks from that store's catalogue. Each look is within budget, scored for compatibility, and **rendered on the shopper with YouCam AI Clothes VTO**.

From there the shopper can:
- **Swap one piece.** Only that region re-renders.
- **See it move.** YouCam Image-to-Video plays a short runway clip.
- **Share with a Style Crew.** Friends join from a link, see the look on themselves and vote item by item.
- **Add the whole look to cart** in one tap.

## How we built it

- **YouCam `cloth-v4` in four modes:**
  - single item;
  - layered full look (lower_body → upper_body → outer, each step using the previous result as `src`);
  - slot-level swap on an existing render;
  - four parallel Style DNA tiles.
- **More YouCam APIs:** the File API, and AI Image-to-Video.
- **The YouCam wrapper:** every call goes through one wrapper with a request-hash cache (crew members viewing the same look cost 0 units), a credit budget, concurrency limits, 429 backoff, an error-to-copy map, and a demo mode that serves only real cached renders.
- **The agent:** a Claude Sonnet 5.5 tool-use loop.
  - It parses intent, asks at most one clarifying question and infers a gift recipient's gender.
  - It searches a pre-enriched 500-SKU catalogue (vibes, formality, fit, colour, pairing) and composes looks.
  - Code, not the model, owns prices, products and the 0–100 compatibility score (colour harmony, formality, silhouette, taste fit).
- **Stack:** FastAPI + SQLite on the backend; React + Tailwind in a Shadow DOM for the widget.

## Challenges

- **Layered renders on separates.** We render the bottom first, then the top, then the layer.
- **YouCam's lower-body references must be worn photos.** We curated a catalogue with on-model imagery.
- **Keeping latency honest.** Outfit text streams first, and renders follow with real progress.

## What's next

- A merchant dashboard: what gets tried on, swapped out, and bought.
- Shopify app packaging.
- Accessory try-on (bag, hat).
- Group photos with Background Change.

## Built with

YouCam API (AI Clothes VTO v4, File API, Image-to-Video) · Claude Sonnet 5.5 · FastAPI · React · Tailwind · SQLite

## Screenshots (8, ≥1280 px, from `docs/screens/`)

1. Store with launcher
2. Onboarding photo step
3. Style DNA grid
4. Outfit cards in chat
5. Try-on viewer with before/after
6. Swap drawer with scores
7. Crew view
8. Cart drawer
