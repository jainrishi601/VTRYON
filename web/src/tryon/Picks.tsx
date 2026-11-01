import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Briefcase, ChevronDown, Lightbulb, RefreshCw, ScanFace, Sun, ThumbsDown, ThumbsUp, TrendingUp } from 'lucide-react'
import { navigate } from '../store/lib'
import { call, type Pick, type TLook, type User } from './api'

const KIND = {
  casual: { icon: Sun, tone: 'from-[#fff3dc] to-white', accent: 'text-[#d97706]', ring: 'border-[#fde7c2]' },
  formal: { icon: Briefcase, tone: 'from-[#e3edff] to-white', accent: 'text-[#2563eb]', ring: 'border-[#d6e3ff]' },
  trendy: { icon: TrendingUp, tone: 'from-[#ffe1ec] to-white', accent: 'text-[#db2777]', ring: 'border-[#ffd2e1]' },
} as const

/** Daily Picks: three outfits a day — casual, formal, trendy — built from the shopper's wardrobe first, with store
 *  pieces filling the gaps. Wore this / like / dislike teach the Style DNA; Try on renders the store pieces on them. */
export function Picks({ me }: { me: User }) {
  const [picks, setPicks] = useState<Pick[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback((regen = false) => {
    setBusy(true); setErr('')
    call<{ picks: Pick[] }>(regen ? '/api/me/daily/regenerate' : '/api/me/daily', regen ? { body: {} } : {})
      .then((r) => setPicks(r.picks), (x) => setErr((x as Error).message)).finally(() => setBusy(false))
  }, [])
  const loaded = useRef(false)
  useEffect(() => { if (!loaded.current) { loaded.current = true; load() } }, [load])
  const day = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const owned = (picks ?? []).reduce((a, p) => a + p.owned, 0)
  return (
    <div className="px-6 sm:px-12 py-10 max-w-[1240px] mx-auto" data-testid="picks-page">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-[36px] sm:text-[44px] font-semibold tracking-[-0.02em] leading-tight">Daily Picks</h1>
          <p className="mt-1 text-[16px] text-[#737373]">{day}</p>
        </div>
        <button onClick={() => load(true)} disabled={busy} data-testid="picks-regenerate" className="h-11 px-5 rounded-xl bg-[#0a0a0a] text-white text-[15px] font-medium inline-flex items-center gap-2 disabled:opacity-60">
          <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />Regenerate
        </button>
      </div>
      {picks && owned === 0 && (
        <div className="mt-6 rounded-2xl bg-[#fff8eb] border border-[#fde7c2] px-5 py-4 text-[15px] flex flex-wrap items-center gap-3">
          <span className="flex-1">Today’s picks come from the store. Add your own clothes and they’ll be built around what you already own.</span>
          <button onClick={() => navigate('/tryon/wardrobe')} className="h-9 px-4 rounded-lg border border-[#0a0a0a] text-[14px]">Add my wardrobe</button>
        </div>
      )}
      {err && <p className="mt-6 text-[15px] text-[#c2410c]">{err}</p>}
      <div className="mt-8 grid md:grid-cols-3 gap-5">
        {!picks ? [0, 1, 2].map((i) => <div key={i} className="h-[520px] rounded-[28px] t-skel" />)
          : picks.map((p) => <PickCard key={p.look.id} pick={p} hasBody={!!me.profile.body_url} onChange={(np) => setPicks((ps) => ps?.map((x) => (x.look.id === np.look.id ? np : x)) ?? null)} />)}
      </div>
    </div>
  )
}

function PickCard({ pick, hasBody, onChange }: { pick: Pick; hasBody: boolean; onChange: (p: Pick) => void }) {
  const k = KIND[pick.kind]
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
    setLook(await call<TLook>(`/api/looks/${look.id}/render`, { body: {} }))
  }
  const items = look.items.slice(0, 4)
  return (
    <article className={`rounded-[28px] border ${k.ring} bg-gradient-to-b ${k.tone} p-5 flex flex-col`} data-testid="pick-card" data-kind={pick.kind}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className={`text-[12px] font-semibold tracking-[0.1em] uppercase inline-flex items-center gap-1.5 ${k.accent}`}><k.icon size={14} />{pick.label}</p>
          <h3 className="mt-1 text-[19px] font-semibold leading-tight" data-testid="pick-name">{look.name}</h3>
        </div>
        {pick.owned > 0 && <span className="h-7 px-2.5 rounded-full bg-white border border-[#ececec] text-[12px] inline-flex items-center whitespace-nowrap">{pick.owned} from your wardrobe</span>}
      </div>
      <div className="mt-4 relative">
        {showOn && look.render.image_url ? (
          <div className="relative aspect-square rounded-2xl overflow-hidden bg-white">
            <img src={look.render.image_url} alt={`You wearing ${look.name}`} className="w-full h-full object-cover object-top" />
            <span className="absolute top-2.5 left-2.5 h-6 px-2.5 rounded-full bg-white text-[11px] font-semibold uppercase tracking-[0.06em] inline-flex items-center">On you</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {items.map(({ slot, product: p }) => (
              <div key={slot + p.id} className="relative aspect-square rounded-2xl bg-white overflow-hidden">
                <img src={p.image_url} alt={p.title} className={`w-full h-full ${p.owned ? 'object-contain p-2' : 'object-cover object-top'}`} />
                {p.owned ? <span className="absolute bottom-2 left-2 h-5 px-2 rounded-full bg-[#0a0a0a] text-white text-[10px] font-semibold uppercase tracking-[0.06em] inline-flex items-center">Yours</span>
                  : <a href={p.product_url} title={`${p.title} · ₹${p.price.toLocaleString('en-IN')}`} className="absolute bottom-2 right-2 h-6 pl-2 pr-1.5 rounded-full bg-white shadow-sm text-[11px] inline-flex items-center gap-1 num">₹{p.price.toLocaleString('en-IN')}<ArrowUpRight size={11} /></a>}
              </div>
            ))}
            {rendering && <div className="absolute inset-0 rounded-2xl bg-white/70 flex items-center justify-center"><span className="t-shine text-[15px] font-medium !bg-clip-text" style={{ background: 'linear-gradient(90deg,#737373 35%,#0a0a0a 50%,#737373 65%)', backgroundSize: '250% 100%' }}>Putting it on you…</span></div>}
          </div>
        )}
      </div>
      <div className="mt-4 flex-1">
        <p className="text-[13px] text-[#737373] inline-flex items-center gap-1.5"><Lightbulb size={13} />Why this works</p>
        <p className={`mt-1 text-[15px] leading-[22px] ${more ? '' : 'line-clamp-2'}`}>{look.why}</p>
        {more && look.tip && <p className="mt-2 text-[14px] text-[#525252]"><b>Finish it:</b> {look.tip}</p>}
        {more && <ul className="mt-2 space-y-1">{look.items.map((it) => <li key={it.product.id} className="text-[13px] text-[#525252] flex gap-2"><span className="flex-1 truncate">{it.product.title}</span><span className="num">{it.product.owned ? 'Yours' : `₹${it.product.price.toLocaleString('en-IN')}`}</span></li>)}</ul>}
      </div>
      <div className="mt-3 pt-3 border-t border-black/5 flex items-center text-[13px] text-[#737373]">
        <span>{look.items.length} items</span>
        <button onClick={() => setMore(!more)} className="ml-auto inline-flex items-center gap-1 text-[#0a0a0a]"><ChevronDown size={14} className={more ? 'rotate-180' : ''} />{more ? 'Show less' : 'Show more'}</button>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => feedback('wore')} data-testid="pick-wore" className={`h-10 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap ${pick.feedback === 'wore' ? 'bg-[#0a0a0a] text-white' : 'bg-white border border-[#ececec]'}`}>{pick.feedback === 'wore' ? 'Wore it' : 'Wore this'}</button>
        <button onClick={() => feedback('like')} aria-label="Like" data-testid="pick-like" className={`w-10 h-10 rounded-full inline-flex items-center justify-center ${pick.feedback === 'like' ? 'bg-[#0a0a0a] text-white' : 'hover:bg-white'}`}><ThumbsUp size={16} /></button>
        <button onClick={() => feedback('dislike')} aria-label="Dislike" data-testid="pick-dislike" className={`w-10 h-10 rounded-full inline-flex items-center justify-center ${pick.feedback === 'dislike' ? 'bg-[#0a0a0a] text-white' : 'hover:bg-white'}`}><ThumbsDown size={16} /></button>
        {pick.can_try && (hasBody ? (
          <button onClick={tryOn} disabled={rendering} data-testid="pick-tryon" className="ml-auto h-10 px-3.5 rounded-full bg-white border border-[#ececec] text-[13px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60">
            <ScanFace size={15} />{look.render.status === 'ready' ? (showOn ? 'Pieces' : 'On you') : rendering ? 'Trying on…' : 'Try on'}
          </button>
        ) : <button onClick={() => navigate('/tryon/onboarding')} className="ml-auto text-[12px] text-[#737373] underline underline-offset-4">Add a photo to try on</button>)}
      </div>
      {look.render.status === 'failed' && look.render.error && <p className="mt-2 text-[12px] text-[#c2410c]">{look.render.error}</p>}
    </article>
  )
}
