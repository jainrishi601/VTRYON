import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, Plus, Minus, Check } from 'lucide-react'
import type { Product } from '../shared/types'
import { inr, SLOT_LABEL, cap, catName } from '../shared/format'
import { cartActions, get, openStylist, useApi, useLocation } from './lib'
import { Link } from './App'

type Page = { items: Product[]; total: number }

// ---------- product card ----------
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
const badgeFor = (p: Product) => (p.sizes_in_stock.length === 1 ? 'LOW STOCK' : hash(p.id) % 5 === 0 ? 'NEW' : null)

export function ProductCard({ p, eager }: { p: Product; eager?: boolean }) {
  const badge = badgeFor(p)
  return (
    <article className="group relative" data-testid="product-card">
      <Link to={`/p/${p.id}`} className="block" aria-label={p.title}>
        <div className="relative aspect-[3/4] bg-surface overflow-hidden">
          <img src={p.image_url} alt={p.title} loading={eager ? 'eager' : 'lazy'} className="absolute inset-0 w-full h-full object-cover object-top" />
          {p.image_url_alt && (
            <img src={p.image_url_alt} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover object-top opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          )}
          {badge && <span className="label absolute top-3 left-3 !text-[10px] bg-white px-2 py-1">{badge}</span>}
        </div>
        <div className="pt-3 flex flex-col gap-0.5">
          <h3 className="text-[14px] leading-5">{p.title}</h3>
          <p className="num text-[14px] text-muted">{inr(p.price)}</p>
        </div>
      </Link>
      {/* The widget binds every [data-elara-tryon] element: no store code needed beyond this attribute. */}
      <button
        data-elara-tryon={p.id}
        data-testid="try-on-chip"
        className="absolute left-3 bottom-[72px] h-8 px-3.5 rounded-full bg-ink text-white text-[12px] font-medium tracking-[0.02em] transition-all duration-150 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus-visible:opacity-100 max-sm:h-7 max-sm:px-3 max-sm:text-[11px]"
      >
        Try on me
      </button>
    </article>
  )
}

function CardSkeleton() {
  return (
    <div>
      <div className="aspect-[3/4] skeleton" />
      <div className="mt-3 h-4 w-3/4 skeleton" />
      <div className="mt-2 h-4 w-1/4 skeleton" />
    </div>
  )
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-12">{children}</div>
)

function ErrorLine({ onRetry, what = 'the collection' }: { onRetry: () => void; what?: string }) {
  return (
    <div className="py-24 text-center">
      <p className="font-serif text-[28px]">We couldn’t load {what}.</p>
      <button onClick={onRetry} className="mt-5 h-11 px-6 rounded-full border border-ink text-[14px]">Try again</button>
    </div>
  )
}

// ---------- home ----------
export function Home() {
  const women = useApi<Page>('/api/products?gender=women&slot=one_piece&limit=8')
  const men = useApi<Page>('/api/products?gender=men&slot=top&limit=8')
  const fresh = useApi<Page>('/api/products?gender=women&limit=8&offset=8')
  const heroW = women.data?.items[1] ?? women.data?.items[0]
  const heroM = men.data?.items[0]
  return (
    <>
      <section className="relative h-[88vh] min-h-[560px] bg-surface overflow-hidden" data-testid="hero">
        <div className="absolute inset-0 grid md:grid-cols-2">
          {[heroW, heroM].map((p, i) => (
            <div key={i} className={`relative bg-surface ${i === 1 ? 'hidden md:block' : ''}`}>
              {p && <img src={p.image_url} alt="" className="absolute inset-0 w-full h-full object-cover object-top fadeup" style={{ animationDuration: '1200ms' }} />}
            </div>
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-black/20" />
        <div className="absolute left-4 right-4 md:left-8 bottom-10 md:bottom-14 text-white max-w-[900px]">
          <p className="label mb-4 fadeup">Resort '26</p>
          <h1 className="font-serif text-[56px] md:text-[88px] leading-[0.95] tracking-[-0.01em] fadeup" style={{ animationDelay: '80ms' }}>
            Salt, linen and <em>long afternoons.</em>
          </h1>
          <div className="mt-8 flex flex-wrap gap-3 fadeup" style={{ animationDelay: '160ms' }}>
            <Link to="/women" className="h-12 px-7 rounded-full bg-white text-ink text-[14px] font-medium inline-flex items-center hover:bg-white/90 transition-colors">
              Shop Women
            </Link>
            <button data-testid="hero-style-me" onClick={() => openStylist({ tab: 'chat' })} className="h-12 px-7 rounded-full border border-white text-white text-[14px] font-medium hover:bg-white hover:text-ink transition-colors">
              Style me with AI
            </button>
          </div>
        </div>
      </section>

      <CategoryRail />

      <section className="px-4 md:px-8 mt-24">
        <div className="flex items-end justify-between mb-8">
          <h2 className="font-serif text-[40px] leading-none">New in</h2>
          <Link to="/women" className="text-[14px] inline-flex items-center gap-1.5 hover:gap-2.5 transition-all">View all <ArrowRight size={15} strokeWidth={1.5} /></Link>
        </div>
        {fresh.error ? <ErrorLine onRetry={fresh.retry} what="new arrivals" /> : (
          <Grid>{fresh.data ? fresh.data.items.map((p) => <ProductCard key={p.id} p={p} />) : Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} />)}</Grid>
        )}
      </section>

      <EditorialBand image={women.data?.items[3]?.image_url ?? heroW?.image_url} image2={men.data?.items[2]?.image_url} />

      <section className="px-4 md:px-8 mt-24">
        <div className="flex items-end justify-between mb-8">
          <h2 className="font-serif text-[40px] leading-none">For him, for the coast</h2>
          <Link to="/men" className="text-[14px] inline-flex items-center gap-1.5 hover:gap-2.5 transition-all">Shop Men <ArrowRight size={15} strokeWidth={1.5} /></Link>
        </div>
        {men.error ? <ErrorLine onRetry={men.retry} what="this edit" /> : (
          <Grid>{men.data ? men.data.items.slice(0, 4).map((p) => <ProductCard key={p.id} p={p} />) : Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} />)}</Grid>
        )}
      </section>
    </>
  )
}

const RAIL: { label: string; gender: 'women' | 'men'; slot: string }[] = [
  { label: 'Dresses & sets', gender: 'women', slot: 'one_piece' },
  { label: 'Tops & shirts', gender: 'women', slot: 'top' },
  { label: 'Trousers & skirts', gender: 'women', slot: 'bottom' },
  { label: 'Shirts', gender: 'men', slot: 'top' },
  { label: 'Trousers & shorts', gender: 'men', slot: 'bottom' },
  { label: 'Layers', gender: 'women', slot: 'layer' },
]

function CategoryRail() {
  const [tiles, setTiles] = useState<({ img?: string; total: number } | null)[]>(RAIL.map(() => null))
  useEffect(() => {
    RAIL.forEach((r, i) =>
      get<Page>(`/api/products?gender=${r.gender}&slot=${r.slot}&limit=1&offset=2`)
        .then((d) => setTiles((t) => t.map((x, j) => (j === i ? { img: d.items[0]?.image_url, total: d.total } : x))))
        .catch(() => setTiles((t) => t.map((x, j) => (j === i ? { total: 0 } : x)))),
    )
  }, [])
  return (
    <section className="mt-16" aria-label="Shop by category">
      <div className="px-4 md:px-8 flex items-end justify-between mb-6">
        <h2 className="font-serif text-[40px] leading-none">Shop by category</h2>
      </div>
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory px-4 md:px-8 pb-2 no-scrollbar scroll-px-4 md:scroll-px-8">
        {RAIL.map((r, i) => {
          const t = tiles[i]
          if (t && t.total === 0 && t.img === undefined) return null
          return (
            <Link key={r.label + r.gender} to={`/c/${r.slot}?gender=${r.gender}`} className="snap-start shrink-0 w-[240px] group">
              <div className="aspect-[4/5] bg-surface overflow-hidden">
                {t?.img ? <img src={t.img} alt="" loading="lazy" className="w-full h-full object-cover object-top group-hover:scale-[1.03] transition-transform duration-500" /> : <div className="w-full h-full skeleton" />}
              </div>
              <div className="pt-3 flex items-baseline justify-between">
                <span className="text-[14px]">{r.label} <span className="text-muted">· {cap(r.gender)}</span></span>
                <span className="num text-[12px] text-muted">{t ? t.total : ''}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function EditorialBand({ image, image2 }: { image?: string; image2?: string }) {
  return (
    <section className="mt-24 bg-surface">
      <div className="grid md:grid-cols-[1fr_1fr] items-stretch">
        <div className="relative min-h-[520px] md:min-h-[680px] overflow-hidden">
          {image ? <img src={image} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover object-top" /> : <div className="absolute inset-0 skeleton" />}
          {image2 && (
            <img src={image2} alt="" loading="lazy" className="hidden md:block absolute right-8 bottom-8 w-[34%] aspect-[3/4] object-cover object-top border-[6px] border-white shadow-[0_20px_40px_rgba(0,0,0,.12)]" />
          )}
        </div>
        <div className="px-6 md:px-16 py-16 md:py-0 flex flex-col justify-center max-w-[620px]">
          <p className="label text-accent">The Northline stylist</p>
          <h2 className="font-serif text-[48px] md:text-[64px] leading-[1] mt-4">Tell Ava where you’re going. <em>See it on you</em> before it ships.</h2>
          <p className="mt-6 text-[16px] leading-[26px] text-muted max-w-[460px]">
            Describe the trip, the wedding or the Monday. Ava builds complete outfits from this season, under your budget, and shows every one on your photo. Swap a piece, ask your friends, add the look to your bag.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={() => openStylist({ tab: 'chat' })} className="h-12 px-7 rounded-full bg-ink text-white text-[14px] font-medium hover:bg-black/85 transition-colors">Style me with AI</button>
            <Link to="/judge" className="h-12 px-7 rounded-full border border-ink text-[14px] font-medium inline-flex items-center hover:bg-ink hover:text-white transition-colors">How it works</Link>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- listing ----------
const COLOURS = ['white', 'black', 'beige', 'brown', 'grey', 'blue', 'green', 'pink', 'red', 'purple', 'orange', 'yellow']
const PRICES = [2000, 4000, 6000, 10000]
const VIBES = ['minimal', 'classic', 'boho', 'romantic', 'bold', 'street', 'sporty', 'edgy']

function FilterPill({ label, value, options, onChange, testid }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void; testid?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [open])
  const current = options.find(([v]) => v === value)
  const active = value !== ''
  return (
    <div ref={ref} className="relative">
      <button
        data-testid={testid}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`h-9 pl-4 pr-3 rounded-full border text-[13px] inline-flex items-center gap-1.5 transition-colors ${active ? 'bg-ink text-white border-ink' : 'border-line hover:border-ink'}`}
      >
        {active ? current?.[1] : label}
        <ChevronDown size={14} strokeWidth={1.5} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" className="absolute z-30 mt-2 min-w-[200px] bg-white border border-line rounded-[10px] py-2 shadow-[0_12px_32px_rgba(0,0,0,.08)]">
          {options.map(([v, l]) => (
            <li key={v}>
              <button role="option" aria-selected={v === value} className="w-full text-left px-4 py-2 text-[14px] hover:bg-surface flex items-center justify-between gap-4" onClick={() => { onChange(v); setOpen(false) }}>
                {l}
                {v === value && <Check size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Listing({ gender, slot: slotProp, search }: { gender?: 'women' | 'men'; slot?: string; search?: boolean }) {
  const { params } = useLocation()
  const g = gender ?? (params.get('gender') as 'women' | 'men' | null) ?? ''
  const q0 = search ? params.get('q') ?? '' : ''
  const [slot, setSlot] = useState(slotProp ?? '')
  const [colour, setColour] = useState('')
  const [price, setPrice] = useState('')
  const [vibe, setVibe] = useState('')
  const [items, setItems] = useState<Product[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)

  const query = (offset: number) => {
    const p = new URLSearchParams({ offset: String(offset), limit: '24' })
    if (g) p.set('gender', g)
    if (slot) p.set('slot', slot)
    const q = [q0, colour].filter(Boolean).join(' ')
    if (q) p.set('q', q)
    if (price) p.set('max_price', price)
    if (vibe) p.set('vibe', vibe)
    return `/api/products?${p}`
  }
  useEffect(() => {
    let live = true
    setItems(null)
    setError(false)
    get<Page>(query(0)).then((d) => { if (live) { setItems(d.items); setTotal(d.total) } }, () => live && setError(true))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, slot, colour, price, vibe, q0, nonce])

  const more = async () => {
    if (!items) return
    setLoadingMore(true)
    try {
      const d = await get<Page>(query(items.length))
      setItems([...items, ...d.items])
    } finally { setLoadingMore(false) }
  }

  const title = search ? `“${q0}”` : slotProp ? `${SLOT_LABEL[slotProp] ?? 'Collection'}${g ? ` for ${g}` : ''}` : g ? cap(g) : "Resort '26"
  const lede = search ? 'Search results' : g === 'men' ? 'Linen shirts, easy trousers and layers for warm evenings.' : g === 'women' ? 'Breezy dresses, co-ords and tailoring cut for heat.' : 'The full season, for everyone.'
  const anyFilter = slot !== (slotProp ?? '') || colour || price || vibe

  return (
    <div className="px-4 md:px-8 pt-12">
      <nav className="text-[12px] text-muted mb-6" aria-label="Breadcrumb"><Link to="/" className="hover:text-ink">Home</Link> <span className="mx-1.5">/</span> {search ? 'Search' : title}</nav>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="font-serif text-[56px] md:text-[64px] leading-[0.95]">{title}</h1>
          <p className="mt-3 text-[15px] text-muted max-w-md">{lede}</p>
        </div>
        <button onClick={() => openStylist({ tab: 'chat' })} className="self-start md:self-auto h-10 px-5 rounded-full border border-ink text-[13px] font-medium hover:bg-ink hover:text-white transition-colors">
          Not sure? Ask the stylist
        </button>
      </div>

      <div className="sticky top-16 z-20 bg-white -mx-4 md:-mx-8 px-4 md:px-8 py-4 mt-8 border-b border-line flex items-center gap-2 overflow-x-auto no-scrollbar">
        <FilterPill testid="filter-category" label="Category" value={slot} onChange={setSlot} options={[['', 'All categories'], ...(['top', 'bottom', 'one_piece', 'layer', 'bag', 'accessory'] as const).map((s) => [s, SLOT_LABEL[s]] as [string, string])]} />
        <FilterPill label="Colour" value={colour} onChange={setColour} options={[['', 'Any colour'], ...COLOURS.map((c) => [c, cap(c)] as [string, string])]} />
        <FilterPill label="Price" value={price} onChange={setPrice} options={[['', 'Any price'], ...PRICES.map((p) => [String(p), `Under ${inr(p)}`] as [string, string])]} />
        <FilterPill label="Style" value={vibe} onChange={setVibe} options={[['', 'Any style'], ...VIBES.map((v) => [v, cap(v)] as [string, string])]} />
        {anyFilter && (
          <button className="text-[13px] text-muted underline underline-offset-4 ml-2 shrink-0" onClick={() => { setSlot(slotProp ?? ''); setColour(''); setPrice(''); setVibe('') }}>Clear all</button>
        )}
        <span className="ml-auto num text-[13px] text-muted shrink-0 pl-4">{items ? `${total} pieces` : ''}</span>
      </div>

      <div className="mt-8">
        {error ? <ErrorLine onRetry={() => setNonce((n) => n + 1)} /> : items && items.length === 0 ? (
          <div className="py-24 text-center">
            <p className="font-serif text-[28px]">Nothing matches those filters.</p>
            <button className="mt-5 h-11 px-6 rounded-full border border-ink text-[14px]" onClick={() => { setColour(''); setPrice(''); setVibe('') }}>Clear filters</button>
          </div>
        ) : (
          <Grid>{items ? items.map((p, i) => <ProductCard key={p.id} p={p} eager={i < 4} />) : Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} />)}</Grid>
        )}
      </div>

      {items && items.length > 0 && (
        <div className="mt-20 flex flex-col items-center gap-4" data-testid="load-more-block">
          <p className="num text-[13px] text-muted">{items.length} of {total}</p>
          <div className="w-48 h-[2px] bg-line"><div className="h-full bg-ink transition-all duration-500" style={{ width: `${Math.min(100, (items.length / Math.max(1, total)) * 100)}%` }} /></div>
          {items.length < total && (
            <button onClick={more} disabled={loadingMore} className="mt-2 h-12 px-8 rounded-full border border-ink text-[14px] font-medium hover:bg-ink hover:text-white transition-colors disabled:opacity-50">
              {loadingMore ? 'Loading…' : `Load ${Math.min(24, total - items.length)} more`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- PDP ----------
const SIZES = ['XS', 'S', 'M', 'L', 'XL']
const avatar = () => { try { return localStorage.getItem('elara.avatar') } catch { return null } }

export function PDP({ id }: { id: string }) {
  const { data: p, error, retry } = useApi<Product>(`/api/products/${encodeURIComponent(id)}`)
  const [size, setSize] = useState('')
  const [needSize, setNeedSize] = useState(false)
  const [added, setAdded] = useState(false)
  const [rail, setRail] = useState<Product[] | null>(null)
  const [open, setOpen] = useState<string | null>('Details')

  useEffect(() => {
    if (!p) return
    const g = p.gender === 'unisex' ? 'women' : p.gender
    const want = p.slot === 'top' ? 'bottom' : p.slot === 'bottom' ? 'top' : p.slot === 'one_piece' ? 'layer' : 'top'
    get<Page>(`/api/products?gender=${g}&slot=${want}&limit=3${p.vibes[0] ? `&vibe=${p.vibes[0]}` : ''}`)
      .then((d) => d.items.length ? d : get<Page>(`/api/products?gender=${g}&slot=${want}&limit=3`))
      .then((d) => setRail(d.items), () => setRail([]))
  }, [p])

  if (error) return <ErrorLine onRetry={retry} what="this piece" />
  if (!p) {
    return (
      <div className="px-4 md:px-8 pt-8 grid md:grid-cols-12 gap-8">
        <div className="md:col-span-7 aspect-[3/4] skeleton" />
        <div className="md:col-span-4 md:col-start-9 space-y-4 pt-8"><div className="h-10 w-3/4 skeleton" /><div className="h-5 w-1/4 skeleton" /><div className="h-40 skeleton" /></div>
      </div>
    )
  }
  const images = [p.image_url, p.image_url_alt].filter(Boolean) as string[]
  const av = avatar()
  const addToBag = () => {
    if (!size) { setNeedSize(true); return }
    cartActions.add([{ product_id: p.id, title: p.title, price: p.price, image_url: p.image_url, size }])
    setAdded(true)
    setTimeout(() => setAdded(false), 1800)
  }
  return (
    <div className="px-4 md:px-8 pt-6">
      <nav className="text-[12px] text-muted mb-6" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-ink">Home</Link><span className="mx-1.5">/</span>
        <Link to={`/${p.gender === 'men' ? 'men' : 'women'}`} className="hover:text-ink">{cap(p.gender === 'men' ? 'men' : 'women')}</Link><span className="mx-1.5">/</span>
        {p.title}
      </nav>
      <div className="grid md:grid-cols-12 gap-8 md:gap-0">
        <div className="md:col-span-7 flex md:flex-col gap-2 overflow-x-auto snap-x snap-mandatory no-scrollbar -mx-4 md:mx-0">
          {images.map((src, i) => (
            <img key={src} src={src} alt={i === 0 ? p.title : `${p.title}, alternate view`} className="snap-center shrink-0 w-full aspect-[3/4] object-cover object-top bg-surface" />
          ))}
        </div>
        <aside className="md:col-span-4 md:col-start-9">
          <div className="md:sticky md:top-24 pb-12">
            <p className="label text-muted">{catName(p.category)}</p>
            <h1 className="font-serif text-[40px] leading-[1.05] mt-3">{p.title}</h1>
            <p className="num text-[18px] mt-3" data-testid="pdp-price">{inr(p.price)}</p>
            <p className="text-[15px] leading-6 text-muted mt-5">{p.one_liner}</p>

            <div className="mt-8">
              <div className="flex justify-between items-baseline"><p className="label">Size</p>{needSize && !size && <p className="text-[12px] text-accent">Pick a size first</p>}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {SIZES.map((s) => {
                  const ok = p.sizes_in_stock.length === 0 || p.sizes_in_stock.includes(s)
                  return (
                    <button
                      key={s}
                      disabled={!ok}
                      onClick={() => setSize(s)}
                      aria-pressed={size === s}
                      className={`h-11 min-w-[52px] px-4 rounded-full border text-[14px] transition-colors ${size === s ? 'bg-ink text-white border-ink' : ok ? 'border-line hover:border-ink' : 'border-line text-muted/50 line-through cursor-not-allowed'}`}
                    >
                      {s}
                    </button>
                  )
                })}
              </div>
            </div>

            <button data-testid="pdp-add" onClick={addToBag} className="mt-8 w-full h-[52px] rounded-full bg-ink text-white text-[15px] font-medium hover:bg-black/85 transition-colors inline-flex items-center justify-center gap-2">
              {added ? <><Check size={17} /> Added</> : 'Add to bag'}
            </button>
            <button
              data-testid="pdp-see-on-you"
              onClick={() => openStylist({ productId: p.id })}
              className="mt-3 w-full h-[52px] rounded-full border border-ink text-[15px] font-medium hover:bg-ink hover:text-white transition-colors inline-flex items-center justify-center gap-2.5"
            >
              {av && <img src={av} alt="" className="w-7 h-7 rounded-full object-cover object-top" />}
              See it on you
            </button>
            <p className="mt-3 text-[12px] text-muted text-center">Virtual try-on on your own photo, in about 15 seconds.</p>

            <div className="mt-10 border-t border-line">
              {[
                ['Details', <><p>{p.description}</p><ul className="mt-3 space-y-1"><li>Fit: {cap(p.fit)}</li><li>Colour: {p.colors.map(cap).join(', ')}</li>{p.pattern && <li>Pattern: {cap(p.pattern)}</li>}</ul></>],
                ['Fabric & care', <><p>{cap(p.fabric || 'Natural fibres')}.</p><p className="mt-2">Cold hand wash or gentle machine cycle. Dry in shade. Warm iron while damp.</p></>],
              ].map(([h, body]) => (
                <div key={h as string} className="border-b border-line">
                  <button className="w-full py-4 flex justify-between items-center text-[14px] font-medium" aria-expanded={open === h} onClick={() => setOpen(open === h ? null : (h as string))}>
                    {h as string}
                    {open === h ? <Minus size={16} strokeWidth={1.5} /> : <Plus size={16} strokeWidth={1.5} />}
                  </button>
                  {open === h && <div className="pb-5 text-[14px] leading-6 text-muted">{body}</div>}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {rail && rail.length > 0 && (
        <section className="mt-16 border-t border-line pt-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div>
              <h2 className="font-serif text-[40px] leading-none">Complete the look</h2>
              <p className="text-[14px] text-muted mt-2">Pieces Ava would pair with the {p.title.split(' - ')[0]}.</p>
            </div>
            <button
              data-testid="complete-look-open"
              onClick={() => openStylist({ tab: 'studio', productIds: [p.id, rail[0].id] })}
              className="self-start h-11 px-6 rounded-full bg-ink text-white text-[14px] font-medium hover:bg-black/85"
            >
              Try this outfit on
            </button>
          </div>
          <Grid>{rail.map((r) => <ProductCard key={r.id} p={r} />)}</Grid>
        </section>
      )}
    </div>
  )
}

export function NotFound() {
  return (
    <div className="py-40 text-center px-4">
      <p className="font-serif text-[48px] leading-none">This page went to the beach.</p>
      <Link to="/" className="mt-8 inline-flex h-11 px-6 rounded-full border border-ink text-[14px] items-center">Back to the store</Link>
    </div>
  )
}
