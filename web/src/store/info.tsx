import { useState } from 'react'
import { Copy, Check, ArrowUpRight } from 'lucide-react'
import { openStylist, useApi } from './lib'

type Status = { ok: boolean; youcam: { units_left: number | null; demo_mode: boolean }; anthropic: { configured: boolean }; catalog: { count: number } }

function CopyBlock({ code, label }: { code: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="relative rounded-[14px] bg-ink text-white/90">
      <div className="flex items-center justify-between px-5 h-11 border-b border-white/10">
        <span className="label text-white/50">{label}</span>
        <button
          className="text-[12px] inline-flex items-center gap-1.5 text-white/70 hover:text-white"
          onClick={() => { navigator.clipboard?.writeText(code); setDone(true); setTimeout(() => setDone(false), 1500) }}
        >
          {done ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
        </button>
      </div>
      <pre className="p-5 overflow-x-auto text-[13px] leading-[22px] font-mono"><code>{code}</code></pre>
    </div>
  )
}

const PROMPTS = [
  {
    title: 'The beach trip',
    shows: 'Onboarding → Style DNA → three complete looks rendered on you, all under budget.',
    prompt: 'Goa beach trip next week, ₹7,000 a look. Breezy, nothing too loud.',
  },
  {
    title: 'Shopping for someone else',
    shows: 'Ava infers he is a man from “brother”, never asks, and dresses him, not you.',
    prompt: "College farewell outfit for my brother, he's 20. Keep it under ₹7,000.",
  },
  {
    title: 'Edit, don’t restart',
    shows: 'Follow-ups change only what you asked; tap ↻ on any piece to see scored swaps.',
    prompt: 'Make the first look a little more formal, and keep the shirt.',
  },
]

export function Judge() {
  const { data: s } = useApi<Status>('/api/status')
  return (
    <div className="px-4 md:px-8 pt-16 max-w-[1100px] mx-auto">
      <p className="label text-accent">Judge guide</p>
      <h1 className="font-serif text-[56px] md:text-[88px] leading-[0.95] mt-4 max-w-[900px]">Five minutes with Ava.</h1>
      <p className="mt-6 text-[17px] leading-[28px] text-muted max-w-[640px]">
        Northline is a fictional store. Everything an AI stylist adds to it comes from one script tag. Open the stylist with the black <strong className="text-ink font-medium">Style me</strong> pill at the bottom right, or use the prompts below.
      </p>

      <div className="mt-10 flex flex-wrap gap-2 text-[13px]" data-testid="judge-status">
        <span className="px-3 h-8 inline-flex items-center rounded-full bg-surface"><span className={`w-1.5 h-1.5 rounded-full mr-2 ${s?.ok ? 'bg-ok' : 'bg-warn'}`} />{s ? (s.ok ? 'Backend online' : 'Backend degraded') : 'Checking backend…'}</span>
        {s && <span className="px-3 h-8 inline-flex items-center rounded-full bg-surface">Renders: {s.youcam.demo_mode ? 'cached (demo mode)' : 'live'}</span>}
        {s && <span className="num px-3 h-8 inline-flex items-center rounded-full bg-surface">{s.catalog.count} products</span>}
        {s && <span className="px-3 h-8 inline-flex items-center rounded-full bg-surface">Agent: {s.anthropic.configured ? 'Claude' : 'fallback composer'}</span>}
      </div>

      <h2 className="font-serif text-[40px] leading-none mt-20">Three scripted prompts</h2>
      <div className="mt-8 grid md:grid-cols-3 gap-4">
        {PROMPTS.map((p, i) => (
          <article key={p.title} className="border border-line rounded-[14px] p-6 flex flex-col">
            <p className="label text-muted">Prompt {i + 1}</p>
            <h3 className="font-serif text-[28px] leading-tight mt-2">{p.title}</h3>
            <p className="mt-4 text-[15px] leading-6 bg-surface rounded-[10px] p-4">“{p.prompt}”</p>
            <p className="mt-4 text-[14px] leading-[22px] text-muted flex-1">{p.shows}</p>
            <button onClick={() => openStylist({ tab: 'chat', message: p.prompt })} className="mt-6 h-11 rounded-full bg-ink text-white text-[14px] font-medium hover:bg-black/85">
              Send to Ava
            </button>
          </article>
        ))}
      </div>

      <div className="mt-20 grid md:grid-cols-2 gap-12">
        <section>
          <h2 className="font-serif text-[40px] leading-none">Your photo</h2>
          <p className="mt-5 text-[15px] leading-[26px] text-muted">
            Use a full-length photo, facing the camera, plain background. Or skip it: the photo step offers four sample models, and their renders are pre-cached so they appear instantly. Photos are used only to show you clothes, and <em>Forget me</em> in the stylist footer deletes them along with your style data.
          </p>
          <h2 className="font-serif text-[40px] leading-none mt-14">Live or cached</h2>
          <p className="mt-5 text-[15px] leading-[26px] text-muted">
            Every render goes through one cache. Sample models and the scripted looks are pre-rendered, so they cost nothing and return in under a second. Your own photo renders live with YouCam Clothes try-on, about 15 seconds per garment layer (bottom first, then top). If the live budget runs out the store switches to cached renders and says so above.
          </p>
          <a href="/admin/renders" target="_blank" rel="noreferrer" className="mt-8 inline-flex items-center gap-1.5 h-11 px-6 rounded-full border border-ink text-[14px] font-medium hover:bg-ink hover:text-white transition-colors">
            Open the render log <ArrowUpRight size={15} />
          </a>
        </section>
        <section>
          <h2 className="font-serif text-[40px] leading-none">Worth trying</h2>
          <ul className="mt-6 divide-y divide-line border-y border-line text-[15px]">
            {[
              ['Try on me', 'Hover any product card. One tap renders that piece on you.'],
              ['Swap one piece', 'In the viewer, tap the dot on the trousers. Scores and reasons are computed, not guessed.'],
              ['Style Crew', 'Share a look; open the link in a private window to join as a friend and react per piece. Or open the seeded Goa trip crew.'],
              ['Studio', 'Build your own outfit, then ask Ava to finish it.'],
              ['Come back later', 'Reload in a new tab. Ava remembers the occasion and your taste.'],
            ].map(([h, b]) => (
              <li key={h} className="py-4 grid grid-cols-[140px_1fr] gap-4">
                <span className="font-medium">{h}</span>
                <span className="text-muted">{b}{h === 'Style Crew' && <> <a className="text-ink underline underline-offset-4" href="/?crew=goatripcrew2026x">Open it</a></>}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

const EMBED = `<script src="https://cdn.elara.shop/widget.js"
  data-store-id="northline"
  data-api="https://api.elara.shop"
  data-position="bottom-center"
  data-cart-adapter="shopify"></script>`

const FEED = `{
  "id": "nl-0042",
  "title": "Abe Shirt - Ivory",
  "price": 4290,
  "currency": "INR",
  "gender": "women",
  "category": "shirt",
  "colors": ["ivory"],
  "image_url": "https://cdn.yourstore.com/abe-ivory-1.jpg",
  "image_url_alt": "https://cdn.yourstore.com/abe-ivory-2.jpg",
  "sizes_in_stock": ["S", "M", "L"],
  "product_url": "/products/abe-shirt-ivory"
}`

const HOOKS = `/* optional: match your brand */
:root { --brand-primary: #111111; --brand-font: "Your Sans"; }

<!-- optional: a try-on chip on any element -->
<button data-elara-tryon="nl-0042">Try on me</button>

// optional: open from your own UI
window.Elara.open({ tab: "chat" })
window.Elara.open({ productId: "nl-0042" })`

export function Merchant() {
  return (
    <div className="px-4 md:px-8 pt-16 max-w-[1100px] mx-auto">
      <p className="label text-accent">For merchants</p>
      <h1 className="font-serif text-[56px] md:text-[88px] leading-[0.95] mt-4 max-w-[900px]">One script tag. Your whole catalogue, styled.</h1>
      <p className="mt-6 text-[17px] leading-[28px] text-muted max-w-[640px]">
        Elara adds an AI stylist with virtual try-on to any fashion store. It runs in a sealed Shadow DOM, so your CSS never breaks it and it never breaks yours. This store embeds it exactly like this.
      </p>
      <div className="mt-16 grid md:grid-cols-[1fr_1.4fr] gap-10 items-start [&>*]:min-w-0">
        <div>
          <p className="label text-muted">Step 1</p>
          <h2 className="font-serif text-[36px] leading-tight mt-2">Paste the tag before &lt;/body&gt;</h2>
          <p className="mt-4 text-[15px] leading-[26px] text-muted">The launcher, the product-card chip and the full stylist panel mount themselves. <code className="text-ink">data-cart-adapter</code> is <code className="text-ink">shopify</code> (posts to <code className="text-ink">/cart/add.js</code>) or <code className="text-ink">custom</code> (calls <code className="text-ink">window.elaraAddToCart(items)</code>).</p>
        </div>
        <CopyBlock label="index.html" code={EMBED} />
        <div>
          <p className="label text-muted">Step 2</p>
          <h2 className="font-serif text-[36px] leading-tight mt-2">Point us at your product feed</h2>
          <p className="mt-4 text-[15px] leading-[26px] text-muted">One row per product with an on-model image. We enrich each row once at ingestion (slot, vibes, formality, fit, pairing) so the stylist can reason about outfits, not keywords.</p>
        </div>
        <CopyBlock label="feed.json — one row" code={FEED} />
        <div>
          <p className="label text-muted">Optional</p>
          <h2 className="font-serif text-[36px] leading-tight mt-2">Theme it, place it, call it</h2>
          <p className="mt-4 text-[15px] leading-[26px] text-muted">The widget reads your brand colour and font from CSS variables, binds any element with a try-on attribute, and exposes a small JavaScript API.</p>
        </div>
        <CopyBlock label="hooks" code={HOOKS} />
      </div>
      <div className="mt-20 rounded-[20px] bg-surface p-8 md:p-12 grid md:grid-cols-3 gap-8">
        {[
          ['No keys in the browser', 'Try-on and model keys stay on the Elara server. The widget only talks to its own API.'],
          ['Your cart, your checkout', 'Looks land in your existing cart with a “Styled with Ava” tag. Checkout is untouched.'],
          ['Shoppers own their data', 'Style DNA lives on a browser token. One tap downloads it, one tap forgets it.'],
        ].map(([h, b]) => (
          <div key={h}><h3 className="font-serif text-[24px] leading-tight">{h}</h3><p className="mt-3 text-[14px] leading-[22px] text-muted">{b}</p></div>
        ))}
      </div>
      <div className="mt-12 flex gap-3">
        <button onClick={() => openStylist()} className="h-12 px-7 rounded-full bg-ink text-white text-[14px] font-medium">Open the stylist on this page</button>
      </div>
    </div>
  )
}
