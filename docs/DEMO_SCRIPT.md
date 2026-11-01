# Demo video script (target 2:45, hard cap 2:55)

**Recording setup**
- 1920×1080 at 60 fps; desktop Chrome, 100% zoom; cursor trail hidden.
- Music: royalty-free only (YouTube Audio Library).
- Brands: no third-party brand anywhere on screen. The store is "Northline".
- Caption every YouCam call on screen (endpoint + `garment_category`).
- Pre-warm the cache by running the full script once before recording. Live renders on camera then land in 5–8 s, and the caption says "live render · cached" honestly.
- One phone cut-in for the Crew friend: a real phone on a tripod, or the 390 px viewport.

## Shots

**0:00–0:12 · Hook**
- Shot: the Northline home page, then a hover over a product, then a cut to a phone WhatsApp screenshot: "does this look ok on me??"
- VO: "Online fashion still asks you to imagine. We built a stylist that shows you instead — on any store, with one script tag."
- Caption: Elara Commerce · YouCam eCommerce VTO Hackathon

**0:12–0:30 · Onboarding**
- Shot: click "Style me". Screen 1: Me · Beach trip · budget slider. Screen 2: upload a full-body photo.
- VO: "Three questions and one photo."
- Caption: Onboarding: 2 screens, under 45 s

**0:30–0:50 · Style DNA**
- Shot: four looks render on the photo tile by tile; heart two, cross one; the DNA name appears ("Coastal Minimal").
- VO: "Before you've bought anything, four looks on you. Your picks teach the stylist your taste."
- Caption: YouCam AI Clothes VTO (cloth-v4) · 4 parallel renders · full_body

**0:50–1:20 · Agent**
- Shot: chat opener auto-sent. The status lines tick ("Found 14 linen pieces…"), three outfit cards stream in, and the renders fade in. Open "Why this works" on one card.
- VO: "Now the agent styles complete outfits from this store's catalogue, within budget, and renders each one on you."
- Caption: Claude agent: intent → search → compose → score → render · lower_body → upper_body layered

**1:20–1:45 · Swap**
- Shot: open the viewer and drag before/after. Tap the trousers hotspot; the swap drawer opens with scores (92 Great match…). Pick one; only the lower half shimmers and re-renders. The history strip now shows 2.
- VO: "Don't like the trousers? Swap just that piece. The compatibility score explains why each option works — and only that part re-renders."
- Caption: Swap = 1 call · garment_category: lower_body on the existing render

**1:45–2:10 · Style Crew**
- Shot: Share with Crew. The share image appears; send to WhatsApp. On the phone, the friend opens the link, joins as "Meera", picks a photo and sees the look on herself. On the trousers she writes "the trousers are a yes". Back on desktop, the comment appears and the verdict bar reads "3 of 4 love it".
- VO: "Shopping is social. Your crew joins from a link, sees it on themselves, and votes piece by piece."
- Caption: Style Crew · per-item threads · same look rendered per member

**2:10–2:20 · See it move**
- Shot: tap "See it move" and a 5 s runway clip plays.
- VO: "And see it move, before it ships."
- Caption: YouCam AI Image-to-Video

**2:20–2:32 · Gifting**
- Shot: new chat, "college farewell outfit for my brother, he's 20". Men's looks come back with no gender question asked.
- VO: "Buying for someone else? It infers who, and asks only what it must."
- Caption: Recipient inference · max one clarifying question

**2:32–2:40 · Cart**
- Shot: "Add look to bag". The store's cart drawer opens with every piece and the total.
- VO: "One tap to cart. Every choice feeds a Style DNA that follows you to the next store."
- Caption: Taste graph

**2:40–2:45 · Close**
- Shot: the /merchant page with the embed snippet and feed JSON; the repo URL.
- VO: "One script tag, any catalogue. Elara Commerce."
- Caption: github.com/… · built with YouCam API

## Scripted prompts (also on /judge)

1. Opener: auto-composed after onboarding (Beach trip, budget, picked vibes)
2. "college farewell outfit for my brother, he's 20"
3. Follow-up on a look: "make it a bit more formal"
