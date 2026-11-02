// Devpost gallery: 15 slides at 3:2 (2400×1600 JPG) from the clean captures in var/gallery/raw (shots.mjs).
// Run from e2e/: node demo/gallery.mjs  → ../media/gallery/NN-name.jpg
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const G = resolve('var/gallery')
const OUT = resolve('../media/gallery')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// crop presets on the 2880×1800 desktop captures (device px): the widget panel, the onboarding card, the whole page
const C = { panel: [616, 66, 1648, 1668, 2880, 1800], onb: [456, 48, 1968, 1704, 2880, 1800], full: [0, 0, 2880, 1800, 2880, 1800], phone: [0, 0, 1170, 2532, 1170, 2532] }

/** One screenshot placed at (x, y) with width w (css px on the 1200×800 slide), cropped by preset. */
function img(src, crop, x, y, w, { rot = 0, z = 1 } = {}) {
  const [cx, cy, cw, ch, W, H] = C[crop]
  const h = (w * ch) / cw
  const phone = crop === 'phone'
  return `<div class="shot ${phone ? 'phone' : ''}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform:rotate(${rot}deg);z-index:${z}">
    <img src="raw/${src}.png" style="width:${(W / cw) * 100}%;left:${(-cx / cw) * 100}%;top:${(-cy / ch) * 100}%"></div>`
}

const chips = (list) => `<div class="chips">${list.map((c) => `<span>${c}</span>`).join('')}</div>`

function slide(n, total, { eyebrow, title, body, tags = [], media = '', extra = '' }) {
  return `<div class="slide">
    <div class="text">
      <div class="eyebrow">${String(n).padStart(2, '0')} / ${total} · ${eyebrow}</div>
      <h1>${title}</h1>
      <p>${body}</p>
      ${chips(tags)}
    </div>
    ${media}${extra}
    <div class="foot">DRAPE · YouCam eCommerce VTO Hackathon</div>
  </div>`
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=block');
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:800px;overflow:hidden;background:#141210}
.slide{position:relative;width:1200px;height:800px;overflow:hidden;color:#f4efe8;font-family:Inter,-apple-system,sans-serif;
  background:radial-gradient(900px 600px at 95% 0%,rgba(193,120,74,.20),transparent 60%),radial-gradient(700px 500px at 0% 100%,rgba(193,120,74,.08),transparent 60%),#141210}
.text{position:absolute;left:60px;top:0;bottom:0;width:380px;display:flex;flex-direction:column;justify-content:center}
.eyebrow{font:500 11.5px/1 'JetBrains Mono',monospace;letter-spacing:.18em;text-transform:uppercase;color:#c9845a}
h1{margin-top:18px;font:400 50px/1.02 'Instrument Serif',Georgia,serif;letter-spacing:-.01em}
h1 em{font-style:italic;color:#e3b08c}
p{margin-top:18px;font-size:16.5px;line-height:1.55;color:#bdb4a8}
.chips{margin-top:24px;display:flex;flex-wrap:wrap;gap:8px}
.chips span{font:500 11.5px/1 'JetBrains Mono',monospace;padding:8px 11px;border-radius:999px;border:1px solid rgba(201,132,90,.45);color:#e8c7ae;background:rgba(193,120,74,.08)}
.shot{position:absolute;overflow:hidden;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.09)}
.shot img{position:absolute;display:block}
.shot.phone{border-radius:30px;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 7px #0a0908,0 0 0 8px rgba(255,255,255,.14)}
.foot{position:absolute;left:60px;bottom:30px;font:500 10.5px/1 'JetBrains Mono',monospace;letter-spacing:.16em;color:#6f675d}
.flow{position:absolute;left:480px;top:52px;width:660px}
.box{position:relative;padding:15px 20px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10)}
.box b{display:block;font:600 16px/1.3 Inter,sans-serif;color:#f4efe8}
.box span{display:block;margin-top:5px;font-size:13.5px;line-height:1.45;color:#bdb4a8}
.box.hot{border-color:rgba(201,132,90,.8);background:rgba(193,120,74,.12)}
.box .tag{position:absolute;right:16px;top:15px;font:500 10.5px/1 'JetBrains Mono',monospace;letter-spacing:.12em;color:#c9845a}
.arrow{height:20px;display:flex;justify-content:center;color:#c9845a;font-size:15px;line-height:20px}
.wrap{margin-top:12px;padding:12px 16px;border-radius:12px;border:1px dashed rgba(201,132,90,.55);font:500 11.5px/1.55 'JetBrains Mono',monospace;color:#e8c7ae}
.cover h1{font-size:104px;margin-top:22px}
.cover p{font-size:19px}
`

const T = 15
const slides = [
  ['cover', `<div class="slide cover">
    <div class="text" style="width:420px">
      <div class="eyebrow">YouCam eCommerce VTO Hackathon</div>
      <h1>Drape</h1>
      <p style="color:#f4efe8;font-size:22px;line-height:1.4;margin-top:10px">An agentic AI stylist for <em style="font-family:'Instrument Serif',serif;font-size:27px;color:#e3b08c">any</em> fashion store.</p>
      <p>Describe the occasion. See complete outfits on you. Swap any piece. Shop it with your crew. One script tag.</p>
      ${chips(['YouCam AI Clothes VTO', 'Image-to-Video', 'Claude agent'])}
    </div>
    ${img('chat-look', 'panel', 500, 150, 360, { rot: -5, z: 1 })}
    ${img('viewer-swapped', 'panel', 735, 95, 380, { rot: 2.5, z: 2 })}
    ${img('crew-phone', 'phone', 985, 330, 170, { rot: 6, z: 3 })}
    <div class="foot">DRAPE · YouCam eCommerce VTO Hackathon</div></div>`],

  ['how-it-works', slide(2, T, {
    eyebrow: 'How it works', title: 'The model brings taste. <em>Code</em> brings the truth.',
    body: 'Claude decides what to show and says why. Prices, products, scores and every render come from the catalogue and from YouCam, through one wrapper.',
    tags: ['FastAPI', 'React · Shadow DOM', 'SQLite'],
    extra: `<div class="flow">
      <div class="box"><span class="tag">TRYON</span><b>One shopper profile</b><span>Photo, sizes, Style DNA taste graph, never-list, own wardrobe</span></div>
      <div class="arrow">↓</div>
      <div class="box"><span class="tag">CLAUDE SONNET 5.5</span><b>Agent with tools</b><span>Intent → search a 500-SKU catalogue → compose 2–3 looks. At most one question, never one the profile answers.</span></div>
      <div class="arrow">↓</div>
      <div class="box"><span class="tag">CODE</span><b>Grounding and scoring</b><span>Opaque refs instead of SKU ids · prices and totals from records · 0–100 compatibility score, deterministic</span></div>
      <div class="arrow">↓</div>
      <div class="box hot"><span class="tag">YOUCAM CLOTH-V4</span><b>Rendered on the shopper</b><span>lower_body → upper_body → outer, each result is the next src. A swap is one call on the current render.</span></div>
      <div class="arrow">↓</div>
      <div class="box"><span class="tag">YOUCAM I2V</span><b>Then social, then the cart</b><span>Image-to-Video clip · Style Crew votes per piece · one tap to the store's own cart</span></div>
      <div class="wrap">youcam.py · request-hash cache · unit budget + per-session cap · 4/8 concurrency · 429 backoff · error → shopper copy · results saved before the 2 h expiry</div>
    </div>`,
  })],

  ['onboarding', slide(3, T, {
    eyebrow: 'Onboarding', title: 'One profile, made <em>once</em>.',
    body: 'Goal, who you shop for, sizes, a selfie and a full-body photo. Claude reads the colours that suit you from the selfie in a few seconds.',
    tags: ['Claude vision', 'YouCam File API'],
    media: img('onb-photos', 'onb', 470, 70, 620, { z: 1 }) + img('onb-colors', 'onb', 700, 370, 460, { z: 2 }),
  })],

  ['vibes-on-you', slide(4, T, {
    eyebrow: 'Taste, on your body', title: 'Swipe on looks <em>worn by you</em>.',
    body: 'Eight vibe looks render on the shopper’s own photo in parallel. Love, like or pass: each swipe becomes an edge in the taste graph.',
    tags: ['YouCam cloth-v4', '8 parallel renders', 'cached per photo'],
    media: img('onb-vibes', 'onb', 485, 100, 680),
  })],

  ['style-dna', slide(5, T, {
    eyebrow: 'Style DNA', title: 'A taste profile you can <em>read</em> and correct.',
    body: 'A named style, the palette that suits you, what you told us and what it learned. The map shows every signal and where it came from.',
    tags: ['taste graph', 'nodes + edges', 'export / forget me'],
    media: img('tryon-dna', 'full', 470, 64, 690, { z: 1 }) + img('tryon-map', 'full', 560, 400, 570, { z: 2 }),
  })],

  ['daily-picks', slide(6, T, {
    eyebrow: 'Every day', title: 'Daily Picks, sharpened by <em>Style Play</em>.',
    body: 'Three outfits a day from the DNA, mixing store pieces with what you own. Quick A/B picks keep teaching it.',
    tags: ['Claude', 'taste graph'],
    media: img('tryon-picks', 'full', 470, 64, 690, { z: 1 }) + img('tryon-play', 'full', 560, 400, 570, { z: 2 }),
  })],

  ['wardrobe', slide(7, T, {
    eyebrow: 'Your wardrobe', title: 'Your closet, tagged from <em>one photo</em>.',
    body: 'Upload a photo and every piece is recognised and tagged: type, colour, fabric, vibe. The stylist can now build around what you already own.',
    tags: ['Claude vision', 'owned pieces = ₹0'],
    media: img('tryon-wardrobe', 'full', 470, 175, 690),
  })],

  ['any-store', slide(8, T, {
    eyebrow: 'For merchants', title: 'Any store. <em>One script tag.</em>',
    body: 'The widget mounts in a sealed Shadow DOM, so the store’s CSS never breaks it. A product feed is all a merchant provides. Northline is our demo store.',
    tags: ['&lt;script&gt; embed', 'Shopify / custom cart'],
    media: img('store-home', 'full', 470, 64, 690, { z: 1 }) + img('merchant', 'full', 560, 400, 570, { z: 2 }),
  })],

  ['outfits-on-you', slide(9, T, {
    eyebrow: 'The stylist', title: 'Describe the occasion. Get <em>complete outfits</em> on you.',
    body: '“Goa trip with friends, around ₹7,000.” Claude builds three looks from this store’s catalogue, within budget, and every look renders on the shopper automatically.',
    tags: ['Claude tool use', 'cloth-v4 · layered', 'desktop + mobile'],
    media: img('chat-look', 'panel', 475, 70, 620, { z: 1 }) + img('chat-phone', 'phone', 985, 300, 175, { z: 2 }),
  })],

  ['swap-one-piece', slide(10, T, {
    eyebrow: 'Swap', title: 'Swap one piece. <em>Only that piece</em> re-renders.',
    body: 'Tap the trousers and pick from alternatives ranked by a deterministic 0–100 compatibility score. One YouCam call on the current render keeps the face, pose and top untouched.',
    tags: ['1 call', 'garment_category: lower_body'],
    media: img('swap-new', 'panel', 500, 70, 640),
  })],

  ['wardrobe-swap', slide(11, T, {
    eyebrow: 'Wardrobe-aware', title: 'Or swap in something you <em>already own</em>.',
    body: 'Your own culottes, rendered into the look. Owned pieces cost ₹0 in the total and stay out of the cart.',
    tags: ['TRYON wardrobe', 'before / after'],
    media: img('swap-mine', 'panel', 470, 80, 470, { z: 1 }) + img('viewer-swapped', 'panel', 770, 250, 390, { z: 2 }),
  })],

  ['style-crew', slide(12, T, {
    eyebrow: 'Style Crew', title: 'Shopping is <em>social</em>.',
    body: 'Share a card and a link. Friends join from WhatsApp, vote piece by piece and comment. The verdict lands on your screen live.',
    tags: ['per-item threads', 'live verdict'],
    media: img('share', 'panel', 470, 90, 540, { z: 1 }) + img('crew-phone', 'phone', 955, 190, 200, { z: 2 }),
  })],

  ['gifting', slide(13, T, {
    eyebrow: 'Gifting', title: 'Buying for <em>someone else</em>.',
    body: '“College farewell outfit for my brother, he’s 20.” The agent works out who it is for, skips the gender question and renders on a matching model, never across genders.',
    tags: ['recipient inference', 'gender guard'],
    media: img('gift-chat', 'panel', 500, 70, 640),
  })],

  ['see-it-move', slide(14, T, {
    eyebrow: 'See it move', title: 'See it <em>move</em> before it ships.',
    body: 'YouCam Image-to-Video turns a finished look into a five-second clip, right in the viewer.',
    tags: ['YouCam Image-to-Video', '480p · 5 s'],
    media: img('video', 'panel', 500, 70, 640),
  })],

  ['cart-and-usage', slide(15, T, {
    eyebrow: 'Checkout', title: 'One tap to the store’s <em>own cart</em>.',
    body: 'Every piece lands with the size from the profile. Every YouCam call is logged with cache hits, units and latency: 129 live calls and 91 cache hits during the build.',
    tags: ['cart adapter', '/admin/renders'],
    media: img('cart', 'full', 470, 64, 690, { z: 1 }) + img('admin-renders', 'full', 560, 400, 570, { z: 2 }),
  })],
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })
for (const [i, [name, html]] of slides.entries()) {
  writeFileSync(`${G}/slide.html`, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>${html}`)
  await page.goto(`file://${G}/slide.html`)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => [...document.images].every((m) => m.complete))
  const png = `${G}/slide.png`
  await page.screenshot({ path: png })
  const jpg = `${OUT}/${String(i + 1).padStart(2, '0')}-${name}.jpg`
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', png, '-q:v', '2', jpg])
  console.log('·', jpg.split('/').pop())
}
await browser.close()
