import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Briefcase, ChevronDown, RefreshCw, ScanFace, Sun, TrendingUp, ThumbsDown, ThumbsUp } from 'lucide-react'
import { navigate } from '../store/lib'
import { inr } from '../shared/format'
import { call, undrawn, undrawnNote, type Pick, type TLook, type User } from './api'
import { PageHead, plural, Tag } from './ui'

const KIND = { casual: Sun, formal: Briefcase, trendy: TrendingUp } as const

/** Daily Picks: three outfits a day — casual, formal, trendy — built from the shopper's wardrobe first, with store
 *  pieces filling the gaps. Wore this / like / dislike teach the Style DNA; Try on renders the store pieces on them. */
export function Picks({ me }: { me: User }) {
  const [picks, setPicks] = useState<Pick[] | null>(null)
  const [owned, setOwned] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Picks are rebuilt server-side on any wardrobe change, so every visit simply refetches.
  const load = useCallback((regen = false) => {
    setBusy(true); setErr('')
    return call<{ picks: Pick[]; wardrobe_items?: number }>(regen ? '/api/me/daily/regenerate' : '/api/me/daily', regen ? { body: {} } : {})
      .then((r) => { setPicks(r.picks); if (r.wardrobe_items != null) setOwned(r.wardrobe_items) }, (x) => setErr((x as Error).message))
      .finally(() => setBusy(false))
  }, [])
  const loaded = useRef(false)
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    load()
  }, [load])
  const day = new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <div className="px-5 sm:px-10 xl:px-14 py-8 sm:py-12 max-w-[1280px] mx-auto" data-testid="picks-page">
      <PageHead eyebrow={day} title="Daily Picks" sub="Three outfits for today, built from your wardrobe first and finished with Northline pieces.">
        <button onClick={() => load(true)} disabled={busy} data-testid="picks-regenerate" className="h-11 px-5 rounded-full border border-ink text-[14px] font-medium inline-flex items-center gap-2 hover:bg-surface transition-colors duration-150 disabled:opacity-50">
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />{busy && picks ? 'Restyling…' : 'New picks'}
        </button>
      </PageHead>
      {owned === 0 && (
        <div className="mt-8 rounded-[14px] bg-surface px-5 py-4 text-[15px] flex flex-wrap items-center gap-x-4 gap-y-3" data-testid="picks-wardrobe-cta">
          <span className="flex-1 min-w-[220px]">Today’s picks come from the store. Add what you own and they’ll be built around it.</span>
          <button onClick={() => navigate('/tryon/wardrobe')} className="h-10 px-4 rounded-full bg-ink text-white text-[14px] font-medium">Add my wardrobe</button>
        </div>
      )}
      {err && <p className="mt-6 text-[15px] text-accent" role="alert">{err}</p>}
      <div className="mt-8 sm:mt-10 grid md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-10">
        {!picks ? [0, 1, 2].map((i) => <div key={i}><div className="h-4 w-24 t-skel" /><div className="mt-3 h-7 w-48 t-skel" /><div className="mt-4 aspect-[4/5] t-skel" /></div>)
          : picks.map((p) => <PickCard key={p.look.id} pick={p} hasBody={!!me.profile.body_url} onChange={(np) => setPicks((ps) => ps?.map((x) => (x.look.id === np.look.id ? np : x)) ?? null)} />)}
      </div>
    </div>
  )
}

function PickCard({ pick, hasBody, onChange }: { pick: Pick; hasBody: boolean; onChange: (p: Pick) => void }) {
  const Icon = KIND[pick.kind] ?? Sun
  const [more, setMore] = useState(false)
  const [look, setLook] = useState<TLook>(pick.look)
  const [showOn, setShowOn] = useState(pick.look.render.status === 'ready')
  const rendering = look.render.status === 'pending' || look.render.status === 'rendering'
  useEffect(() => {
    if (!rendering) return
    const t = setTimeout(() => call<TLook>(`/api/looks/${look.id}`).then((l) => { setLook(l); if (l.render.status === 'ready') setShowOn(true) }, () => {}), 2000)
    return () => clearTimeout(t)
  }, [look, rendering])
  const feedback = async (kind: 'wore' | 'like' | 'dislike') => {
    onChange({ ...pick, feedback: kind })
    await call(`/api/me/daily/${look.id}/feedback`, { body: { kind } }).catch(() => {})
  }
  const tryOn = async () => {
    if (look.render.status === 'ready') { setShowOn(!showOn); return }
    setLook({ ...look, render: { ...look.render, status: 'pending' } })
    setLook(await call<TLook>(`/api/looks/${look.id}/render`, { body: {} }).catch(() => ({ ...look, render: { ...look.render, status: 'failed' as const, error: 'The try-on didn’t finish. Try again.' } })))
  }
  const notDrawn = undrawn(look, pick.undrawn_pieces)
  const items = look.items.slice(0, 4)
  const ownedAll = look.items.length > 0 && look.items.every((it) => it.product.owned)
  const on = showOn && !!look.render.image_url
  return (
    <article className="flex flex-col t-fade" data-testid="pick-card" data-kind={pick.kind}>
      <div className="flex items-center gap-2">
        <p className="label text-muted inline-flex items-center gap-1.5"><Icon size={13} strokeWidth={1.8} />{pick.label}</p>
        {pick.owned > 0 && <span className="ml-auto text-[12px] text-muted">{pick.owned} of {look.items.length} yours</span>}
      </div>
      <h3 className="mt-1.5 font-serif text-[30px] leading-[1.05]" data-testid="pick-name">{look.name}</h3>

      <div className="mt-4 relative aspect-[4/5] bg-surface overflow-hidden">
        {on ? (
          <>
            <img key={look.render.image_url} src={look.render.image_url!} alt={`You wearing ${look.name}: ${look.items.filter((it) => !it.product.owned).map((it) => it.product.title).join(', ')}`} className="absolute inset-0 w-full h-full object-contain t-in" />
            <span className="absolute top-3 left-3"><Tag>On you</Tag></span>
          </>
        ) : (
          <div className={`absolute inset-0 grid gap-[3px] bg-white ${items.length >= 3 ? 'grid-cols-2 grid-rows-2' : items.length === 2 ? 'grid-cols-2' : ''}`}>
            {items.map(({ slot, product: p }, i) => (
              <div key={slot + p.id} className={`relative overflow-hidden bg-surface ${items.length === 3 && i === 0 ? 'row-span-2' : ''}`}>
                <img src={p.image_url} alt={p.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover object-top" />
                {p.owned ? <><span className="t-stitch" /><span className="absolute top-2.5 left-2.5"><Tag>Yours</Tag></span></>
                  : <a href={p.product_url} title={p.title} className="absolute bottom-2.5 left-2.5 h-6 pl-2 pr-1.5 rounded-full bg-white/95 text-[11px] inline-flex items-center gap-0.5 num hover:bg-white">{inr(p.price)}<ArrowUpRight size={11} /></a>}
              </div>
            ))}
          </div>
        )}
        {rendering && (
          <div className="absolute inset-0 bg-white/75 flex flex-col items-center justify-center gap-2 t-fade">
            <ScanFace size={22} strokeWidth={1.4} />
            <span className="t-shine text-[15px] font-medium">Putting it on you…</span>
            <span className="text-[12px] text-muted">About 20 seconds</span>
          </div>
        )}
      </div>
      {(on || rendering) && notDrawn.length > 0 && (
        <p className="mt-3 flex gap-2.5 text-[13px] leading-[19px] text-muted" data-testid="pick-undrawn">
          <span className="mt-0.5 w-3.5 h-3.5 shrink-0 border-[1.5px] border-dashed border-muted/70" aria-hidden />{undrawnNote(notDrawn, look.undrawn_note)}
        </p>
      )}

      <div className="mt-4">
        <p className={`text-[15px] leading-[23px] ${more ? '' : 'line-clamp-2'}`}>{look.why}</p>
        {more && (
          <div className="t-fade">
            {look.tip && <p className="mt-2 text-[14px] text-muted"><span className="text-ink font-medium">Finish it:</span> {look.tip}</p>}
            <ul className="mt-3 border-t border-line">
              {look.items.map((it) => <li key={it.product.id} className="h-10 border-b border-line text-[14px] flex items-center gap-3"><span className="flex-1 truncate">{it.product.title}</span>{it.product.owned ? <Tag>Yours</Tag> : <span className="num">{inr(it.product.price)}</span>}</li>)}
            </ul>
          </div>
        )}
        <button onClick={() => setMore(!more)} className="mt-2 text-[13px] text-muted hover:text-ink inline-flex items-center gap-1" aria-expanded={more}>
          {more ? 'Less' : `${plural(look.items.length, 'piece')} · details`}<ChevronDown size={14} className={`transition-transform duration-150 ${more ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div className="mt-4 pt-4 border-t border-line flex items-center gap-1.5">
        <button onClick={() => feedback('wore')} data-testid="pick-wore" aria-pressed={pick.feedback === 'wore'} className={`h-10 px-4 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${pick.feedback === 'wore' ? 'bg-ink text-white' : 'border border-line hover:border-ink'}`}>{pick.feedback === 'wore' ? 'Wore it' : 'Wore this'}</button>
        <button onClick={() => feedback('like')} aria-label="Like" aria-pressed={pick.feedback === 'like'} data-testid="pick-like" className={`w-10 h-10 rounded-full inline-flex items-center justify-center transition-colors duration-150 ${pick.feedback === 'like' ? 'bg-ink text-white' : 'hover:bg-surface'}`}><ThumbsUp size={16} strokeWidth={1.7} /></button>
        <button onClick={() => feedback('dislike')} aria-label="Dislike" aria-pressed={pick.feedback === 'dislike'} data-testid="pick-dislike" className={`w-10 h-10 rounded-full inline-flex items-center justify-center transition-colors duration-150 ${pick.feedback === 'dislike' ? 'bg-ink text-white' : 'hover:bg-surface'}`}><ThumbsDown size={16} strokeWidth={1.7} /></button>
        {pick.can_try ? (hasBody ? (
          <button onClick={tryOn} disabled={rendering} data-testid="pick-tryon" className="ml-auto h-10 px-4 rounded-full bg-ink text-white text-[13px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60">
            <ScanFace size={15} strokeWidth={1.7} />{look.render.status === 'ready' ? (showOn ? 'See pieces' : 'See on you') : rendering ? 'Trying on…' : 'Try on'}
          </button>
        ) : <button onClick={() => navigate('/tryon/onboarding')} className="ml-auto text-[13px] text-muted underline underline-offset-4">Add a photo to try on</button>)
          : ownedAll && <span className="ml-auto text-[12px] text-muted">All yours: nothing to try on</span>}
      </div>
      {look.render.status === 'failed' && look.render.error && <p className="mt-2 text-[13px] text-muted">{look.render.error}</p>}
    </article>
  )
}
