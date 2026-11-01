import { useEffect, useRef, useState } from 'react'
import { Sparkles, SquarePen, X } from 'lucide-react'
import { useElara, type Tab } from './state'
import { api, ls, type ApiError } from './api'
import { Chat } from './Chat'
import { Viewer, SwapDrawer } from './Viewer'
import { Studio } from './Studio'
import { CrewTab, ShareSheet } from './Crew'
import { TryOnSheet } from './TryOn'
import { Ring, Sheet } from './ui'
import type { DnaSummary } from '../shared/types'

export function Launcher() {
  const e = useElara()
  const avatar = e.session?.photo_url ? ls.get('elara.avatar') : null
  const pos = e.cfg.position === 'bottom-left' ? 'left-6' : e.cfg.position === 'bottom-right' ? 'right-6' : 'left-1/2 -translate-x-1/2'
  return (
    <button
      data-testid="elara-launcher"
      aria-label="Open your stylist"
      onClick={() => e.openWith()}
      className={`ew fixed z-[2147483000] bottom-6 ${pos} h-11 pl-1.5 pr-4 rounded-full bg-white text-ink border border-line shadow-[0_8px_28px_rgba(0,0,0,.14)] inline-flex items-center gap-2 text-[13px] font-medium transition-[opacity,translate,box-shadow] duration-[240ms] hover:shadow-[0_10px_32px_rgba(0,0,0,.2)] ${e.open ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-100'}`}
    >
      {avatar ? <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover object-top" />
        : <span className="w-8 h-8 rounded-full bg-ink text-white inline-flex items-center justify-center"><Sparkles size={15} strokeWidth={1.75} /></span>}
      Need help choosing?
      {e.unread && <span data-testid="launcher-badge" className="absolute top-1 right-2 w-2 h-2 rounded-full bg-accent ring-2 ring-white" aria-label="New crew comments" />}
    </button>
  )
}

const TABS: [Tab, string][] = [['chat', 'Chat'], ['studio', 'Studio'], ['crew', 'Crew']]

export function Panel() {
  const e = useElara()
  // Chat first: the widget never blocks on a form. Who/occasion/budget come from the question card, the photo from
  // the try-on sheet. (The full onboarding and Style DNA picker belong to the TRYON platform.)
  const onboarding = e.tab === 'chat' && ['boot', 'error'].includes(e.stage)
  const ref = useRef<HTMLElement>(null)
  const [dnaOpen, setDnaOpen] = useState(false)

  // A centred modal over the store (full screen on phones): lock the page scroll while it is open.
  useEffect(() => {
    document.body.style.overflow = e.open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [e.open])

  useEffect(() => { if (e.open) ref.current?.focus() }, [e.open])
  useEffect(() => { if (e.open && e.tab === 'crew') e.markCrewSeen() }, [e.open, e.tab, e.crew, e.markCrewSeen])

  return (
    <div className={`ew fixed inset-0 z-[2147483001] flex items-stretch sm:items-center justify-center sm:p-4 transition-[opacity,visibility] duration-200 ${e.open ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}`}>
      <div className="absolute inset-0 bg-black/45 hidden sm:block" onClick={() => e.setOpen(false)} aria-hidden />
    <aside
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      data-testid="elara-panel"
      aria-label={`${e.store?.name ?? 'Your'} stylist`}
      aria-hidden={!e.open}
      {...(!e.open ? { inert: '' } : {})}
      onKeyDown={(ev) => {
        if (ev.key !== 'Escape') return
        if (dnaOpen) setDnaOpen(false)
        else if (e.tryon) e.setTryon(null)
        else if (e.swap) e.setSwap(null)
        else if (e.share) e.setShare(null)
        else if (e.viewer) e.setViewer(null)
        else e.setOpen(false)
      }}
      className={`relative w-full sm:max-w-[800px] h-[100dvh] sm:h-[90vh] bg-white sm:border border-line sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden outline-none ${e.open ? 'pop-in' : ''}`}
    >
      <header className="shrink-0 px-4 sm:px-5 py-3.5 flex items-center gap-2.5 border-b border-line" style={{ paddingTop: 'max(14px, env(safe-area-inset-top))' }}>
        <span className="text-[20px] sm:text-[22px] font-semibold tracking-[0.18em] leading-none uppercase truncate" data-testid="elara-brand">{e.store?.name ?? 'Stylist'}</span>
        {!onboarding && (
          <div role="tablist" className="ml-1 p-0.5 rounded-full bg-surface flex text-[12px] font-semibold" data-testid="elara-tabs">
            {TABS.map(([t, l]) => (
              <button
                key={t}
                role="tab"
                data-testid={`tab-${t}`}
                aria-selected={e.tab === t}
                onClick={() => e.setTab(t)}
                className={`relative px-3 py-1 rounded-full transition-all duration-150 ${e.tab === t ? 'bg-white shadow-sm text-ink' : 'text-muted hover:text-ink'}`}
              >
                {l}
                {t === 'crew' && e.unread && e.tab !== 'crew' && <span className="absolute top-0.5 right-1 w-1.5 h-1.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!onboarding && e.tab === 'chat' && (
            <button data-testid="new-chat" aria-label="Start a new chat" title="New chat" onClick={() => e.newChat()} className="w-9 h-9 rounded-full inline-flex items-center justify-center text-muted hover:text-ink hover:bg-surface"><SquarePen size={17} strokeWidth={1.75} /></button>
          )}
          <button data-testid="elara-close" aria-label="Close stylist" onClick={() => e.setOpen(false)} className="w-9 h-9 -mr-1.5 rounded-full inline-flex items-center justify-center text-muted hover:text-ink hover:bg-surface"><X size={19} strokeWidth={1.75} /></button>
        </div>
      </header>

      <div className="relative flex-1 min-h-0 flex flex-col">
        {e.tab === 'chat' && (e.stage === 'boot' ? <Booting /> : e.stage === 'error' ? <BootError /> : <Chat />)}
        {e.tab === 'studio' && <Studio />}
        {e.tab === 'crew' && <CrewTab />}

        {e.viewer && <Viewer />}
        {e.swap && <SwapDrawer />}
        {e.share && <ShareSheet />}
        {e.tryon && <TryOnSheet />}
        {dnaOpen && <DnaSheet onClose={() => setDnaOpen(false)} />}
        {e.toast && (
          <div role="status" data-testid="toast" key={e.toast.id} className="absolute left-4 right-4 top-3 z-50 fade-in">
            <div className="mx-auto max-w-[400px] bg-ink text-white rounded-[14px] px-4 py-3 text-[14px] flex items-center gap-3 shadow-[0_8px_24px_rgba(0,0,0,.2)]">
              <span className="flex-1">{e.toast.text}</span>
              {e.toast.action && <button className="font-medium underline underline-offset-4" onClick={() => { e.toast!.action!.fn(); e.setToast(null) }}>{e.toast.action.label}</button>}
            </div>
          </div>
        )}
      </div>
      {!onboarding && <Footer onDna={() => setDnaOpen(true)} />}
    </aside>
    </div>
  )
}

function Footer({ onDna }: { onDna: () => void }) {
  const e = useElara()
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="shrink-0 h-8 px-6 flex items-center justify-center gap-3 text-[11px] text-muted pb-[env(safe-area-inset-bottom)]" data-testid="elara-footer">
      {confirm ? (
        <>
          <span className="text-ink">Delete your photo, looks and style data?</span>
          <button className="font-medium text-accent underline underline-offset-2" data-testid="forget-confirm" onClick={() => { setConfirm(false); e.forgetMe() }}>Delete</button>
          <button className="underline underline-offset-2" onClick={() => setConfirm(false)}>Keep</button>
        </>
      ) : (
        <>
          <button className="hover:text-ink underline-offset-2 hover:underline" data-testid="dna-open" onClick={onDna}>My Style DNA</button>
          <span aria-hidden>·</span>
          <button className="hover:text-ink underline-offset-2 hover:underline" onClick={() => e.downloadData()}>Download my style data</button>
          <span aria-hidden>·</span>
          <button className="hover:text-ink underline-offset-2 hover:underline" data-testid="forget-me" onClick={() => setConfirm(true)}>Forget me</button>
        </>
      )}
    </div>
  )
}

function Booting() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[14px] text-muted">
      <Ring done={false} />
      Getting your stylist ready
    </div>
  )
}

function BootError() {
  const e = useElara()
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 text-center">
      <p className="font-serif text-[28px] leading-tight">Ava can’t reach the studio right now.</p>
      <button className="h-11 px-6 rounded-full bg-ink text-white text-[14px] font-medium" onClick={() => e.boot()}>Try again</button>
    </div>
  )
}

// ---------- Style DNA graph ----------
// ponytail: radial SVG, top 12 attributes by |weight|; no graph library until the graph outgrows one ring.

type DnaExport = { summary: DnaSummary; edges: { type: string }[] }
const SIGNALS: [string, string][] = [
  ['heart', 'Loved'], ['cross', 'Passed'], ['tried_on', 'Tried on'], ['liked_outfit', 'Liked looks'],
  ['disliked_outfit', 'Passed looks'], ['added_to_cart', 'Added to bag'], ['swapped_in', 'Swapped in'],
  ['swapped_out', 'Swapped out'], ['friend_liked', 'Crew liked'], ['friend_disliked', 'Crew passed'],
]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const swatch = (c: string) => (typeof CSS !== 'undefined' && CSS.supports('color', c) ? c : 'var(--color-surface)')

function DnaSheet({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<DnaExport | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = () => {
    const t = ls.get('elara.token')
    setErr(null)
    if (!t) return setData({ summary: { vibes: {}, colors: {}, never: [], name: null, traits: [] }, edges: [] })
    api<DnaExport>(`/api/dna/${t}`).then(setData, (x: ApiError) => setErr(x.message || 'Your Style DNA didn’t load.'))
  }
  useEffect(load, [])

  return (
    <Sheet title="Your Style DNA" onClose={onClose} height="82%" testid="dna-sheet">
      {err ? (
        <div className="py-10 text-center">
          <p className="text-[14px] text-muted">{err}</p>
          <button className="mt-4 h-11 px-6 rounded-full bg-ink text-white text-[14px] font-medium" onClick={load}>Try again</button>
        </div>
      ) : !data ? (
        <div className="py-16 flex justify-center"><Ring done={false} /></div>
      ) : (
        <DnaBody d={data} />
      )}
    </Sheet>
  )
}

function DnaBody({ d }: { d: DnaExport }) {
  const s = d.summary
  const nodes = [
    ...Object.entries(s.vibes).map(([k, w]) => ({ kind: 'vibe' as const, k, w })),
    ...Object.entries(s.colors).map(([k, w]) => ({ kind: 'color' as const, k, w })),
  ].sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 12)
  const counts = SIGNALS.map(([t, l]) => [l, d.edges.filter((e) => e.type === t).length] as const).filter(([, n]) => n > 0)

  if (!nodes.length) {
    return <p className="py-10 text-[15px] leading-[24px] text-muted" data-testid="dna-empty">Nothing yet. Heart a few looks or try one on, and I’ll start learning your taste.</p>
  }

  const max = Math.max(...nodes.map((n) => Math.abs(n.w)))
  const [W, H, cx, cy, R] = [400, 300, 200, 150, 100]
  return (
    <div className="pb-6" data-testid="dna-graph">
      {s.name && <p className="font-serif text-[30px] leading-tight" data-testid="dna-sheet-name">{s.name}</p>}
      {s.traits.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">{s.traits.map((t) => <span key={t} className="h-7 px-3 rounded-full bg-surface text-[12px] inline-flex items-center">{t}</span>)}</div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full h-auto" role="img" aria-label={`Taste graph: ${nodes.map((n) => `${n.k} ${n.w > 0 ? 'liked' : 'skipped'}`).join(', ')}`}>
        {nodes.map((n, i) => {
          const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2
          const f = Math.abs(n.w) / max
          const [x, y] = [cx + R * Math.cos(a), cy + R * Math.sin(a)]
          const r = 6 + 9 * f
          const pos = n.w > 0
          const never = n.kind === 'vibe' && s.never.includes(n.k)
          const tone = pos ? 'var(--color-ink)' : 'var(--color-accent)'
          const lx = cx + (R + r + 10) * Math.cos(a)
          const ly = cy + (R + r + 10) * Math.sin(a)
          const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle'
          return (
            <g key={`${n.kind}:${n.k}`}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={tone} strokeWidth={1 + 3 * f} strokeOpacity={0.3 + 0.6 * f} strokeDasharray={pos ? undefined : '4 4'} />
              <circle cx={x} cy={y} r={r} fill={n.kind === 'color' ? swatch(n.k) : 'var(--color-bg)'} stroke={n.kind === 'color' ? 'var(--color-line)' : tone} strokeWidth={1.5} />
              <text x={lx} y={ly} dy="0.35em" textAnchor={anchor} fontSize={12} fill="var(--color-ink)">
                {cap(n.k)}
                <tspan fill={never ? 'var(--color-accent)' : 'var(--color-muted)'} fontSize={10}>{never ? ' never' : ` ${pos ? '+' : ''}${n.w.toFixed(1)}`}</tspan>
              </text>
            </g>
          )
        })}
        <circle cx={cx} cy={cy} r={22} fill="var(--color-ink)" />
        <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={12} fontWeight={500} fill="var(--color-bg)">You</text>
      </svg>

      <div className="mt-1 flex items-center justify-center gap-5 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><svg width="18" height="4" aria-hidden><line x1="0" y1="2" x2="18" y2="2" stroke="var(--color-ink)" strokeWidth="2" /></svg>Drawn to</span>
        <span className="inline-flex items-center gap-1.5"><svg width="18" height="4" aria-hidden><line x1="0" y1="2" x2="18" y2="2" stroke="var(--color-accent)" strokeWidth="2" strokeDasharray="4 3" /></svg>Skips</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border border-ink" />Vibe</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-surface border border-line" />Colour</span>
      </div>

      {counts.length > 0 && (
        <>
          <p className="label text-muted mt-7">Signals so far</p>
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="dna-signals">
            {counts.map(([l, n]) => <span key={l} className="h-7 px-3 rounded-full border border-line text-[12px] inline-flex items-center gap-1.5">{l}<span className="num text-muted">{n}</span></span>)}
          </div>
        </>
      )}
      <p className="mt-6 text-[12px] leading-[18px] text-muted">Built from your picks, try-ons, swaps and bag. Recent signals count more. It lives on this browser, and Forget me deletes it.</p>
    </div>
  )
}
