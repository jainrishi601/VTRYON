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

const STEPS = [
  {
    title: 'The trip',
    prompt: 'going to goa next week with friends, need something breezy, budget around 7k',
    shows: 'Ava asks at most one question, then builds three complete outfits under ₹7,000 from this catalogue. Under the cards, tap a sample model: all three render on that model together.',
  },
  {
    title: 'The edit',
    prompt: 'make look 2 a bit more formal',
    shows: 'Send it after step 1. Ava changes look 2 only and keeps the rest; on a try-on, only the changed piece re-renders. Tap ↻ on any piece for scored swaps.',
  },
  {
    title: 'The gift',
    prompt: 'college farewell outfit for my brother, he’s 20',
    shows: 'Ava reads “brother” and dresses him, not you: men’s looks, a men’s sample model, and your own photo stays saved. Women’s clothes never render on a men’s photo, and the reverse.',
  },
]

type Model = { id: string; gender: string; label: string; image_url: string }

export function Judge() {
  const { data: s } = useApi<Status>('/api/status')
  const { data: m } = useApi<{ models: Model[] }>('/api/models')
  return (
    <div className="px-4 md:px-8 pt-16 max-w-[1100px] mx-auto">
      <p className="label text-accent">Judge guide</p>
      <h1 className="font-serif text-[56px] md:text-[88px] leading-[0.95] mt-4 max-w-[900px]">Five minutes with Ava.</h1>
      <p className="mt-6 text-[17px] leading-[28px] text-muted max-w-[660px]">
        Northline is a fictional store. Everything the AI stylist adds to it comes from one script tag. Open it with the{' '}
        <strong className="text-ink font-medium">Need help choosing?</strong> pill at the bottom centre of any page (it reads <strong className="text-ink font-medium">Style me</strong> on a phone), or with <em>Style me with AI</em> on the home page. It is chat first: no form, no sign-up.
      </p>

      <div className="mt-10 flex flex-wrap gap-2 text-[13px]" data-testid="judge-status">
        <span className="px-3 h-8 inline-flex items-center rounded-full bg-surface"><span className={`w-1.5 h-1.5 rounded-full mr-2 ${s?.ok ? 'bg-ok' : 'bg-warn'}`} />{s ? (s.ok ? 'Backend online' : 'Backend degraded') : 'Checking backend…'}</span>
        {s && <span className="px-3 h-8 inline-flex items-center rounded-full bg-surface" data-testid="judge-mode">Renders: {s.youcam.demo_mode ? 'cached only (demo mode)' : 'live, with a cache'}</span>}
        {s && <span className="num px-3 h-8 inline-flex items-center rounded-full bg-surface">{s.catalog.count} products</span>}
        {s && <span className="px-3 h-8 inline-flex items-center rounded-full bg-surface">Agent: {s.anthropic.configured ? 'Claude' : 'fallback composer'}</span>}
      </div>

      <h2 className="font-serif text-[40px] leading-none mt-20">The demo, in order</h2>
      <p className="mt-3 text-[15px] text-muted">Each button opens the stylist and sends the prompt exactly as written.</p>
      <ol className="mt-8 grid md:grid-cols-3 gap-4" data-testid="judge-steps">
        {STEPS.map((p, i) => (
          <li key={p.title} className="border border-line rounded-[14px] p-6 flex flex-col">
            <p className="label text-muted">Step {i + 1}</p>
            <h3 className="font-serif text-[28px] leading-tight mt-2">{p.title}</h3>
            <p className="mt-4 text-[15px] leading-6 bg-surface rounded-[10px] p-4">“{p.prompt}”</p>
            <p className="mt-4 text-[14px] leading-[22px] text-muted flex-1">{p.shows}</p>
            <button onClick={() => openStylist({ tab: 'chat', message: p.prompt })} data-testid="judge-send"
              className="mt-6 h-11 rounded-full bg-ink text-white text-[14px] font-medium hover:bg-black/85 active:scale-[.98] transition-[background-color,transform]">
              Send to Ava
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-20 grid md:grid-cols-2 gap-12">
        <section>
          <h2 className="font-serif text-[40px] leading-none">No photo? Use a model</h2>
          <p className="mt-5 text-[15px] leading-[26px] text-muted">
            Under every set of looks, and first in every try-on dialog, are sample models filtered to the looks’ gender. One tap renders every look on that model. Or upload your own full-length photo: it is checked, used only for try-on, and <em>Forget me</em> in the stylist footer deletes it with your style data.
          </p>
          <div className="mt-6 grid grid-cols-4 gap-3 max-w-[420px]" data-testid="judge-models">
            {(m?.models ?? []).map((x) => (
              <figure key={x.id}>
                <div className="aspect-[3/4] bg-surface overflow-hidden rounded-[10px]"><img src={x.image_url} alt={x.label} loading="lazy" className="w-full h-full object-cover object-top" /></div>
                <figcaption className="mt-1.5 text-[11px] text-muted capitalize">{x.gender === 'men' ? 'Men’s' : 'Women’s'}</figcaption>
              </figure>
            ))}
          </div>
          <h2 className="font-serif text-[40px] leading-none mt-14">Live or cached</h2>
          <p className="mt-5 text-[15px] leading-[26px] text-muted">
            Every render goes through one cache, keyed on the photo and the garment. The scripted looks on the sample models are pre-rendered, so they cost nothing and appear in about a second. Anything new renders live with YouCam Clothes try-on, about 15 seconds per layer (bottom first, then top); swapping one piece re-renders only that piece. The status line above says which mode is on.
          </p>
          <a href="/admin/renders" target="_blank" rel="noreferrer" className="mt-8 inline-flex items-center gap-1.5 h-11 px-6 rounded-full border border-ink text-[14px] font-medium hover:bg-ink hover:text-white transition-colors">
            Open the render log <ArrowUpRight size={15} />
          </a>
        </section>
        <section>
          <h2 className="font-serif text-[40px] leading-none">Worth trying</h2>
          <ul className="mt-6 divide-y divide-line border-y border-line text-[15px]">
            {[
              ['Swap one piece', 'Open a look in the viewer and tap the dot on the trousers. Scores and reasons are computed, not guessed; drag the slider for before and after.'],
              ['See it move', 'The film icon on a rendered look makes a short clip. It takes a few minutes; the card says so and plays it when ready.'],
              ['Try on me', 'Hover any product card in the store. One tap renders that piece, with what pairs best.'],
              ['Style Crew', 'Share a look; open the link in a private window to join as a friend and react per piece.'],
              ['Studio', 'Tap pieces to build your own outfit, then ask Ava to finish it.'],
              ['Your style profile', 'Sign up in TRYON for Style DNA, a wardrobe Ava can style around, and daily picks. The stylist here shares it.'],
            ].map(([h, b]) => (
              <li key={h} className="py-4 grid grid-cols-[140px_1fr] gap-4">
                <span className="font-medium">{h}</span>
                <span className="text-muted">{b}{h === 'Style Crew' && <> <a className="text-ink underline underline-offset-4" href="/?crew=goatripcrew2026x">Open the seeded crew</a></>}</span>
              </li>
            ))}
          </ul>
          <a href="/tryon" data-testid="judge-tryon" className="mt-8 inline-flex items-center gap-1.5 h-11 px-6 rounded-full bg-ink text-white text-[14px] font-medium hover:bg-black/85 transition-colors">
            Open your style profile <ArrowUpRight size={15} />
          </a>
        </section>
      </div>
    </div>
  )
}

const EMBED = `<script src="https://cdn.drape.style/widget.js"
  data-store-id="northline"
  data-api="https://api.drape.style"
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
<button data-drape-tryon="nl-0042">Try on me</button>

// optional: open from your own UI
window.Drape.open({ tab: "chat" })
window.Drape.open({ productId: "nl-0042" })`

export function Merchant() {
  return (
    <div className="px-4 md:px-8 pt-16 max-w-[1100px] mx-auto">
      <p className="label text-accent">For merchants</p>
      <h1 className="font-serif text-[56px] md:text-[88px] leading-[0.95] mt-4 max-w-[900px]">One script tag. Your whole catalogue, styled.</h1>
      <p className="mt-6 text-[17px] leading-[28px] text-muted max-w-[640px]">
        Drape adds an AI stylist with virtual try-on to any fashion store. It runs in a sealed Shadow DOM, so your CSS never breaks it and it never breaks yours. This store embeds it exactly like this.
      </p>
      <div className="mt-16 grid md:grid-cols-[1fr_1.4fr] gap-10 items-start [&>*]:min-w-0">
        <div>
          <p className="label text-muted">Step 1</p>
          <h2 className="font-serif text-[36px] leading-tight mt-2">Paste the tag before &lt;/body&gt;</h2>
          <p className="mt-4 text-[15px] leading-[26px] text-muted">The launcher, the product-card chip and the full stylist panel mount themselves. <code className="text-ink">data-cart-adapter</code> is <code className="text-ink">shopify</code> (posts to <code className="text-ink">/cart/add.js</code>) or <code className="text-ink">custom</code> (calls <code className="text-ink">window.drapeAddToCart(items)</code>).</p>
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
          ['No keys in the browser', 'Try-on and model keys stay on the Drape server. The widget only talks to its own API.'],
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
