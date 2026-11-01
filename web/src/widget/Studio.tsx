import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Plus, X } from 'lucide-react'
import type { Product, Slot } from '../shared/types'
import { inr, SLOT_LABEL, catName } from '../shared/format'
import { abs, api } from './api'
import { useElara } from './state'
import { Chip, Img, defaultSize, pieceName } from './ui'

const CATS: ['' | Slot, string][] = [['', 'All'], ['top', 'Tops'], ['bottom', 'Bottoms'], ['one_piece', 'Dresses & sets'], ['layer', 'Layers']]
const PRICES: [number, string][] = [[0, 'Any price'], [3000, 'Under ₹3,000'], [5000, 'Under ₹5,000'], [8000, 'Under ₹8,000']]
const VIBES = ['minimal', 'classic', 'boho', 'romantic', 'bold', 'street']

/** One item per slot; a one-piece and separates exclude each other. */
function place(tray: Product[], p: Product) {
  const clash = (q: Product) => q.slot === p.slot || (p.slot === 'one_piece' && (q.slot === 'top' || q.slot === 'bottom')) || (q.slot === 'one_piece' && (p.slot === 'top' || p.slot === 'bottom'))
  return { next: [...tray.filter((q) => !clash(q)), p], removed: tray.filter(clash) }
}

export function Studio() {
  const e = useElara()
  const g0 = (e.brief?.for === 'other' ? e.brief.recipient?.gender : e.brief?.gender) ?? 'women'
  const [gender, setGender] = useState<'women' | 'men'>(g0 === 'men' ? 'men' : 'women')
  const [cat, setCat] = useState<'' | Slot>('')
  const [price, setPrice] = useState(0)
  const [vibe, setVibe] = useState('')
  const [items, setItems] = useState<Product[] | null>(null)
  const [total, setTotal] = useState(0)
  const [err, setErr] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [tray, setTray] = useState<Product[]>([])
  const [trying, setTrying] = useState(false)
  const [lookId, setLookId] = useState<string | null>(null)

  useEffect(() => {
    if (!e.studioSeed?.length) return
    let t: Product[] = []
    e.studioSeed.forEach((p) => { t = place(t, p).next })
    setTray(t)
    const g = e.studioSeed[0].gender
    if (g === 'men' || g === 'women') setGender(g)
    e.setStudioSeed(null)
  }, [e.studioSeed, e])

  const q = (offset: number) => {
    const p = new URLSearchParams({ gender, offset: String(offset), limit: '24' })
    if (cat) p.set('slot', cat)
    if (price) p.set('max_price', String(price))
    if (vibe) p.set('vibe', vibe)
    return `/api/products?${p}`
  }
  useEffect(() => {
    let live = true
    setItems(null)
    setErr(false)
    api<{ items: Product[]; total: number }>(q(0)).then((r) => { if (live) { setItems(r.items.filter((p) => p.slot !== 'bag' && p.slot !== 'accessory')); setTotal(r.total) } }, () => live && setErr(true))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gender, cat, price, vibe, nonce])

  const [loadingMore, setLoadingMore] = useState(false)
  const more = async () => {
    if (!items || loadingMore) return
    setLoadingMore(true)
    const r = await api<{ items: Product[] }>(q(items.length)).catch(() => null)
    setLoadingMore(false)
    if (r) setItems([...items, ...r.items.filter((p) => p.slot !== 'bag' && p.slot !== 'accessory')])
  }

  const add = (p: Product) => {
    if (tray.some((t) => t.id === p.id)) { setTray(tray.filter((t) => t.id !== p.id)); return }
    const prev = tray
    const { next, removed } = place(tray, p)
    setTray(next)
    setLookId(null)
    if (removed.length) e.showToast(`Replaced the ${removed.map((r) => catName(r.category)).join(' and ')}`, { label: 'Undo', fn: () => setTray(prev) })
  }
  const sum = useMemo(() => tray.reduce((s, p) => s + p.price, 0), [tray])
  const complete = tray.some((p) => p.slot === 'one_piece') || (tray.some((p) => p.slot === 'top') && tray.some((p) => p.slot === 'bottom'))

  const tryOn = async () => {
    setTrying(true)
    const l = await e.tryOn(tray.map((p) => p.id), 'Your Studio look')
    if (l) setLookId(l.id)
    setTrying(false)
  }
  const ask = () => {
    const names = tray.map((p) => `the ${pieceName(p)} (${SLOT_LABEL[p.slot].toLowerCase()})`).join(' and ')
    e.setTab('chat')
    if (lookId) e.setFocusLookId(lookId)
    e.openWith({ tab: 'chat', message: `Finish this look for me. I've picked ${names}.` })
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="studio">
      <div className="shrink-0 px-4 sm:px-6 pt-4 pb-3 space-y-3 border-b border-line">
        <div className="flex items-center gap-3">
          <div className="h-9 p-1 rounded-full bg-surface grid grid-cols-2 w-[160px]" role="radiogroup" aria-label="Gender">
            {(['women', 'men'] as const).map((g) => (
              <button key={g} role="radio" aria-checked={gender === g} onClick={() => setGender(g)}
                className={`rounded-full text-[13px] font-medium capitalize ${gender === g ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,.1)]' : 'text-muted'}`}>{g}</button>
            ))}
          </div>
          <label className="ml-auto relative">
            <span className="sr-only">Price</span>
            <select value={price} onChange={(ev) => setPrice(+ev.target.value)} className="appearance-none h-9 pl-4 pr-9 rounded-full border border-line text-[13px] bg-white outline-none focus:border-ink hover:border-ink cursor-pointer">
              {PRICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <ChevronDown size={14} strokeWidth={1.5} className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </label>
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 sm:-mx-6 sm:px-6" role="tablist">
          {CATS.map(([c, l]) => (
            <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
              className={`shrink-0 h-8 px-3.5 text-[13px] border-b-2 transition-colors ${cat === c ? 'border-ink text-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 sm:-mx-6 sm:px-6">
          {VIBES.map((v) => <Chip key={v} active={vibe === v} onClick={() => setVibe(vibe === v ? '' : v)}><span className="capitalize text-[13px]">{v}</span></Chip>)}
        </div>
      </div>

      <div className="flex-1 min-h-0 scroll-y px-4 sm:px-6 pt-4 pb-6">
        {err ? (
          <div className="py-16 text-center"><p className="font-serif text-[20px]">The rail didn’t load.</p><button className="mt-4 h-10 px-5 rounded-full border border-ink text-[14px]" onClick={() => setNonce((n) => n + 1)}>Try again</button></div>
        ) : items && items.length === 0 ? (
          <div className="py-16 text-center"><p className="font-serif text-[20px]">Nothing here with those filters.</p><button className="mt-4 h-10 px-5 rounded-full border border-ink text-[14px]" onClick={() => { setPrice(0); setVibe('') }}>Clear filters</button></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-5">
            {(items ?? Array.from({ length: 9 }, () => null)).map((p, i) => {
              if (!p) return <div key={i}><div className="aspect-[3/4] skeleton rounded-xl" /><div className="mt-2 h-4 w-3/4 skeleton" /></div>
              const inTray = tray.some((t) => t.id === p.id)
              return (
                // The whole tile toggles the piece in and out of the tray; the round button mirrors the state.
                <button key={p.id} type="button" className="group text-left" data-testid="studio-item" aria-pressed={inTray} onClick={() => add(p)}
                  aria-label={inTray ? `Remove ${p.title} from your outfit` : `Add ${p.title} to your outfit`}>
                  <div className={`relative aspect-[3/4] bg-surface overflow-hidden rounded-xl transition-shadow duration-150 ${inTray ? 'ring-2 ring-ink ring-offset-2' : ''}`}>
                    <Img src={p.image_url} alt={p.title} className="w-full h-full object-cover object-top group-hover:scale-[1.03] transition-transform duration-300" />
                    <span data-testid="studio-add"
                      className={`absolute bottom-2 right-2 w-9 h-9 rounded-full inline-flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,.15)] transition-colors duration-150 ${inTray ? 'bg-ink text-white' : 'bg-white text-ink group-hover:bg-ink group-hover:text-white'}`}>
                      {inTray ? <Check size={16} strokeWidth={2.5} /> : <Plus size={17} strokeWidth={2} />}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] leading-[18px] line-clamp-1">{pieceName(p)}</p>
                  <p className="num text-[13px] text-muted">{inr(p.price)}</p>
                </button>
              )
            })}
          </div>
        )}
        {items && items.length < total && (
          <div className="text-center mt-6"><button onClick={more} aria-busy={loadingMore} disabled={loadingMore} className="h-10 px-5 rounded-full border border-line text-[13px] hover:border-ink disabled:opacity-60"><span className="num">Show more · {items.length} of {total}</span></button></div>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-4 sm:px-6 py-3 bg-white shadow-[0_-8px_24px_rgba(0,0,0,.04)]" data-testid="studio-tray">
        {tray.length === 0 ? (
          <p className="text-[13px] text-muted text-center py-2">Tap pieces to build an outfit. One per slot; tap again to remove.</p>
        ) : (
          <>
            {/* One compact row on wide panels (the grid keeps its room); two rows on phones. */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-3">
              <div className="flex gap-2 scroll-x flex-1 min-w-0 pt-1.5 pr-1.5">
                {tray.map((p) => (
                  <div key={p.id} className="relative shrink-0">
                    <img src={abs(p.image_url)} alt={p.title} className="w-11 h-[58px] object-cover object-top bg-surface rounded-md pop-in" />
                    <button aria-label={`Remove ${p.title}`} onClick={() => setTray(tray.filter((t) => t.id !== p.id))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-white inline-flex items-center justify-center"><X size={11} strokeWidth={2.5} /></button>
                  </div>
                ))}
              </div>
              <div className="text-right shrink-0">
                <p className="label text-muted">Total</p>
                <p className="num text-[16px] font-semibold" data-testid="tray-total">{inr(sum)}</p>
              </div>
              <div className="w-full sm:w-auto flex gap-2 shrink-0">
                <button data-testid="studio-tryon" disabled={trying} aria-busy={trying} onClick={tryOn} className="flex-1 sm:flex-none h-11 px-6 rounded-full bg-ink text-white text-[14px] font-medium disabled:opacity-70 inline-flex items-center justify-center gap-2">{trying && <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />}{trying ? 'Starting…' : 'Try on'}</button>
                <button onClick={() => e.addToCart(tray.map((p) => ({ product_id: p.id, title: p.title, price: p.price, image_url: p.image_url, size: defaultSize(p), styled_with: 'Ava', look_name: 'Studio' })), lookId ?? undefined)}
                  className="flex-1 sm:flex-none h-11 px-5 rounded-full border border-ink text-[14px] font-medium hover:bg-ink hover:text-white transition-colors">Add to bag</button>
              </div>
            </div>
            <button onClick={ask} data-testid="studio-ask" className="mt-1.5 h-8 w-full text-[13px] underline underline-offset-4 text-muted hover:text-ink">
              {complete ? 'Ask the stylist what to change' : 'Ask the stylist to finish this look'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
