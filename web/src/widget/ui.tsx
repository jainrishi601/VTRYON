import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import type { Look, Product, ScoreBand } from '../shared/types'
import { abs } from './api'

export const BAND: Record<ScoreBand, { label: string; cls: string }> = {
  great: { label: 'Great match', cls: 'bg-great-bg text-great' },
  works: { label: 'Works', cls: 'bg-works-bg text-works' },
  bold: { label: 'Bold choice', cls: 'bg-bold-bg text-bold' },
}
export const bandOf = (score: number): ScoreBand => (score >= 85 ? 'great' : score >= 70 ? 'works' : 'bold')

export function useCountUp(target: number, ms = 500, run = true) {
  const [v, setV] = useState(run ? 0 : target)
  useEffect(() => {
    if (!run || matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms, run])
  return v
}

export function ScoreBadge({ score, band, countUp = true, compact }: { score: number; band?: ScoreBand; countUp?: boolean; compact?: boolean }) {
  const b = BAND[band ?? bandOf(score)]
  const v = useCountUp(Math.round(score), 500, countUp)
  return (
    <span data-testid="score-badge" className={`num inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium whitespace-nowrap ${b.cls}`}>
      {v}{compact ? '' : ` · ${b.label}`}
    </span>
  )
}

export function Ring({ done }: { done: boolean }) {
  return done ? (
    <span className="w-4 h-4 rounded-full bg-ink text-white inline-flex items-center justify-center shrink-0"><Check size={10} strokeWidth={3} /></span>
  ) : (
    <span className="w-4 h-4 rounded-full border-[1.5px] border-line border-t-ink spin shrink-0" aria-hidden />
  )
}

/** Render image that never blocks: a fixed 3:4 box, a skeleton until it loads, then a blur-to-sharp reveal. */
export function RevealImg({ src, alt, className = '', onLoad, develop }: { src: string; alt: string; className?: string; onLoad?: () => void; develop?: boolean }) {
  const [loaded, setLoaded] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  useEffect(() => { setLoaded(!!img.current?.complete && !!img.current.naturalWidth) }, [src]) // cached: no flash
  return (
    <>
      {!loaded && <div className="absolute inset-0 skeleton" />}
      <img
        ref={img}
        src={abs(src)}
        alt={alt}
        decoding="async"
        onLoad={() => { setLoaded(true); onLoad?.() }}
        className={`absolute inset-0 w-full h-full object-cover object-top ${loaded ? (develop ? 'develop' : 'reveal') : 'opacity-0'} ${className}`}
      />
    </>
  )
}

/** A product image in a fixed box: surface placeholder, then a short fade so grids never pop. */
export function Img({ src, alt = '', className = '' }: { src: string; alt?: string; className?: string }) {
  const [ok, setOk] = useState(false)
  return <img src={abs(src)} alt={alt} loading="lazy" decoding="async" onLoad={() => setOk(true)} className={`transition-opacity duration-300 ${ok ? 'opacity-100' : 'opacity-0'} ${className}`} />
}

/** "1 piece", "3 pieces". */
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** Cart size: the look's own pick (profile size), else the catalogue default, else M / One Size. */
export const defaultSize = (p: Product, size?: string | null) =>
  size ?? p.default_size ?? (p.slot === 'bag' || p.slot === 'accessory' ? 'One Size' : !p.sizes_in_stock.length || p.sizes_in_stock.includes('M') ? 'M' : p.sizes_in_stock[Math.floor(p.sizes_in_stock.length / 2)])

/** Wraps an async click so the control shows busy at once and ignores repeat taps until it settles. */
export function useBusy() {
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  const run = (fn: () => unknown) => async () => {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { if (live.current) setBusy(false) }
  }
  return [busy, run] as const
}

/** The flat look: the lead piece (a dress, else the top) full-bleed, the rest as small framed insets. What a look
 *  shows before it is tried on, or when a render failed. */
export function Collage({ products }: { products: Product[] }) {
  const rank = (p: Product) => ['one_piece', 'top', 'layer', 'bottom', 'bag', 'accessory'].indexOf(p.slot)
  const [lead, ...rest] = [...products].sort((x, y) => rank(x) - rank(y))
  if (!lead) return <div className="absolute inset-0 bg-surface" />
  return (
    <div className="absolute inset-0 bg-surface">
      <Img src={lead.image_url} alt={lead.title} className="absolute inset-0 w-full h-full object-cover object-top" />
      <div className="absolute top-3 right-3 w-[24%] max-w-[88px] flex flex-col gap-2">
        {rest.slice(0, 3).map((p) => (
          <div key={p.id} className="w-full aspect-[3/4] rounded-[8px] overflow-hidden bg-surface ring-[3px] ring-white shadow-[0_6px_18px_rgba(0,0,0,.14)]">
            <Img src={p.image_url} alt={p.title} className={`w-full h-full ${p.owned ? 'object-contain p-1 bg-white' : 'object-cover object-top'}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Render order of the worn pieces (same plan as the server: one-piece or bottom → top, then layer). */
const ORDER = ['one_piece', 'bottom', 'top', 'layer']
const STEP_S = 14 // a cloth-v4 call takes ~11–15 s

/** While a look renders: the real step (which piece is going on, k of n), a rotating line of what the try-on is
 *  doing, and a progress bar paced on the real step count. Fills its (3:4, relative) parent. */
export function RenderProgress({ look, compact, onModel: modelPhoto }: { look: Look; compact?: boolean; onModel?: boolean }) {
  const worn = ORDER.map((sl) => look.items.find((i) => i.slot === sl)).filter(Boolean) as Look['items']
  const order = worn.some((i) => i.slot === 'one_piece') ? worn.filter((i) => i.slot !== 'bottom' && i.slot !== 'top') : worn
  const n = Math.max(1, look.render.steps_total || order.length)
  const k = Math.min(look.render.steps_done, n - 1)
  const piece = order[Math.min(k, order.length - 1)]?.product
  const what = piece ? pieceName(piece) : 'your look'
  const onModel = !!look.model_id || !!modelPhoto // a sample model, not the shopper's own photo
  const lines = [
    onModel ? 'Getting the model ready' : 'Reading your photo',
    'Matching your pose and light',
    `Fitting the ${what}`,
    'Settling the drape and the fit',
    onModel ? 'Keeping the model exactly as they are' : 'Keeping your face and shape as they are',
    n > 1 && k < n - 1 ? 'Lining up the next piece' : 'Final touches',
  ]
  const [li, setLi] = useState(0)
  const [t, setT] = useState(0)
  const stepAt = useRef(performance.now())
  useEffect(() => { stepAt.current = performance.now(); setLi(2) }, [k]) // a new piece: say which one
  useEffect(() => {
    const a = setInterval(() => setLi((x) => (x + 1) % lines.length), 2600)
    const b = setInterval(() => setT((performance.now() - stepAt.current) / 1000), 250)
    return () => { clearInterval(a); clearInterval(b) }
  }, [lines.length])
  const pct = Math.round(((k + Math.min(0.92, t / STEP_S)) / n) * 100)
  return (
    <div className="absolute inset-0 skeleton flex flex-col items-center justify-end" data-testid="render-pending" aria-live="polite">
      <svg viewBox="0 0 120 160" className="absolute inset-0 m-auto h-[74%] text-[#e3e3e3]" aria-hidden>
        <circle cx="60" cy="22" r="13" fill="currentColor" />
        <path d="M38 44c6-6 38-6 44 0l8 46-10 2-4-28-2 36 8 56H66l-6-44-6 44H38l8-56-2-36-4 28-10-2z" fill="currentColor" />
      </svg>
      <div className={`relative w-full text-center ${compact ? 'px-3 pb-3' : 'px-6 pb-6'}`}>
        <p className="num text-[11px] font-semibold uppercase tracking-[0.08em] text-muted" data-testid="render-step">
          {n > 1 ? `Piece ${k + 1} of ${n} · ` : ''}{what}
        </p>
        <p key={li} className={`line-in mt-1.5 font-medium ${compact ? 'text-[13px]' : 'text-[15px]'}`}><span className="text-shine">{lines[li]}…</span></p>
        <div className="mt-3 h-1 rounded-full bg-white/70 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full bg-ink rounded-full transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
        </div>
        {!compact && <p className="num mt-2 text-[11px] text-muted">About {Math.max(5, Math.round((n - k) * STEP_S - t))} s left</p>}
      </div>
    </div>
  )
}

/** Skeleton silhouette for a pending render — matches the 3:4 geometry exactly. */
export function Silhouette({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="absolute inset-0 skeleton flex flex-col items-center justify-end pb-6" data-testid="render-pending">
      <svg viewBox="0 0 120 160" className="absolute inset-0 m-auto h-[78%] text-[#e9e4dc]" aria-hidden>
        <circle cx="60" cy="22" r="13" fill="currentColor" />
        <path d="M38 44c6-6 38-6 44 0l8 46-10 2-4-28-2 36 8 56H66l-6-44-6 44H38l8-56-2-36-4 28-10-2z" fill="currentColor" />
      </svg>
      <div className="relative text-center">
        <p className="text-[13px] font-medium text-ink/80 flex items-center gap-2 justify-center"><Ring done={false} /> {label}</p>
        {sub && <p className="num text-[12px] text-muted mt-1">{sub}</p>}
      </div>
    </div>
  )
}

/** Run the exit animation, then really close. Returns [closing, close]. */
export function useExit(onClose: () => void, ms = 200) {
  const [closing, setClosing] = useState(false)
  const done = useRef(false)
  const close = () => {
    if (done.current) return
    done.current = true
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return onClose()
    setClosing(true)
    setTimeout(onClose, ms)
  }
  return [closing, close] as const
}

export function Sheet({ title, onClose, children, height = '64%', testid, sub }: { title: ReactNode; onClose: () => void; children: ReactNode; height?: string; testid?: string; sub?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [closing, close] = useExit(onClose)
  useEffect(() => {
    const prev = (ref.current?.getRootNode() as ShadowRoot | Document)?.activeElement as HTMLElement | null
    ref.current?.focus({ preventScroll: true })
    return () => prev?.focus?.({ preventScroll: true })
  }, [])
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}>
      <div className={`absolute inset-0 bg-black/35 ${closing ? 'fade-out' : 'fade-in'}`} onClick={close} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        data-testid={testid}
        className={`relative bg-white rounded-t-[20px] flex flex-col outline-none shadow-[0_-12px_40px_rgba(0,0,0,.1)] ${closing ? 'sheet-out' : 'sheet-in'}`}
        style={{ height }}
      >
        <div className="mx-auto mt-2.5 w-9 h-1 rounded-full bg-line" />
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-3 pb-3">
          <div className="min-w-0">
            <h3 className="text-[19px] font-semibold leading-tight">{title}</h3>
            {sub && <div className="mt-1 text-[13px] text-muted">{sub}</div>}
          </div>
          <button aria-label="Close" onClick={close} className="w-9 h-9 -mr-2 -mt-1 shrink-0 rounded-full inline-flex items-center justify-center hover:bg-surface"><X size={18} strokeWidth={1.5} /></button>
        </div>
        <div className="flex-1 min-h-0 scroll-y px-5 sm:px-6 pb-safe">{children}</div>
      </div>
    </div>
  )
}

/** Centred dialog inside the panel (a bottom sheet on phones): icon + title + subtitle header, scrolling body. */
export function Dialog({ icon, title, sub, onClose, children, testid }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [closing, close] = useExit(onClose, 180)
  useEffect(() => {
    const prev = (ref.current?.getRootNode() as ShadowRoot | Document)?.activeElement as HTMLElement | null
    ref.current?.focus({ preventScroll: true })
    return () => prev?.focus?.({ preventScroll: true })
  }, [])
  return (
    <div className="absolute inset-0 z-40 flex items-end sm:items-center justify-center sm:p-4" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}>
      <div className={`absolute inset-0 bg-black/55 ${closing ? 'fade-out' : 'fade-in'}`} onClick={close} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" data-testid={testid}
        className={`relative w-full sm:max-w-[560px] max-h-[94%] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col outline-none ${closing ? 'dlg-out' : 'dlg-in'}`}>
        <div className="flex items-start gap-3.5 px-6 pt-6 pb-4">
          {icon && <span className="mt-0.5 shrink-0 text-ink">{icon}</span>}
          <div className="flex-1 min-w-0">
            <h3 className="text-[19px] font-semibold leading-tight">{title}</h3>
            {sub && <p className="mt-1.5 text-[14px] leading-[21px] text-muted">{sub}</p>}
          </div>
          <button aria-label="Close" onClick={close} className="w-8 h-8 -mr-1.5 -mt-1 rounded-full inline-flex items-center justify-center text-muted hover:text-ink hover:bg-surface"><X size={18} strokeWidth={1.75} /></button>
        </div>
        <div className="flex-1 min-h-0 scroll-y px-6 pb-6">{children}</div>
      </div>
    </div>
  )
}

export function Chip({ active, children, onClick, testid, disabled }: { active?: boolean; children: ReactNode; onClick?: () => void; testid?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`h-9 px-4 rounded-full border text-[14px] transition-colors duration-150 whitespace-nowrap disabled:opacity-40 ${active ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:border-ink'}`}
    >
      {children}
    </button>
  )
}

export function Initials({ name, src, size = 32, ring }: { name: string; src?: string | null; size?: number; ring?: boolean }) {
  const s = { width: size, height: size }
  return src ? (
    <img src={abs(src)} alt={name} style={s} className={`rounded-full object-cover object-top bg-surface ${ring ? 'ring-2 ring-white' : ''}`} />
  ) : (
    <span style={{ ...s, fontSize: size * 0.4 }} className={`rounded-full bg-surface text-ink inline-flex items-center justify-center font-medium ${ring ? 'ring-2 ring-white' : ''}`} aria-label={name}>
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  )
}

export const lookAlt = (l: Look) =>
  `You wearing ${l.name}: ${l.items.map((i) => i.product.title.split(' - ')[0].toLowerCase()).join(' and ')}`

export const pieceName = (p: Product) => p.title.split(' - ')[0]
/** Slots YouCam renders on the body; bags and accessories are shown, not tried on. */
export const WEARABLE = new Set(['top', 'bottom', 'one_piece', 'layer'])
