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
export function RevealImg({ src, alt, className = '', onLoad }: { src: string; alt: string; className?: string; onLoad?: () => void }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => setLoaded(false), [src])
  return (
    <>
      {!loaded && <div className="absolute inset-0 skeleton" />}
      <img
        src={abs(src)}
        alt={alt}
        onLoad={() => { setLoaded(true); onLoad?.() }}
        className={`absolute inset-0 w-full h-full object-cover object-top ${loaded ? 'reveal' : 'opacity-0'} ${className}`}
      />
    </>
  )
}

/** The flat product collage: what a look shows when a render is missing or failed. */
export function Collage({ products }: { products: Product[] }) {
  const ps = products.slice(0, 4)
  return (
    <div className={`absolute inset-0 grid gap-[2px] bg-white ${ps.length > 1 ? 'grid-cols-2' : ''} ${ps.length > 2 ? 'grid-rows-2' : ''}`}>
      {ps.map((p, i) => (
        <img key={p.id} src={abs(p.image_url)} alt={p.title} className={`w-full h-full object-cover object-top bg-surface ${ps.length === 3 && i === 0 ? 'row-span-2' : ''}`} />
      ))}
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

export function Sheet({ title, onClose, children, height = '64%', testid }: { title: ReactNode; onClose: () => void; children: ReactNode; height?: string; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = (ref.current?.getRootNode() as ShadowRoot | Document)?.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => prev?.focus?.()
  }, [])
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="absolute inset-0 bg-black/30 fade-in" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        data-testid={testid}
        className="relative bg-white rounded-t-[20px] sheet-in flex flex-col outline-none shadow-[0_-12px_40px_rgba(0,0,0,.08)]"
        style={{ height }}
      >
        <div className="mx-auto mt-2.5 w-9 h-1 rounded-full bg-line" />
        <div className="flex items-center justify-between px-6 pt-3 pb-3">
          <h3 className="font-serif text-[26px] leading-tight">{title}</h3>
          <button aria-label="Close" onClick={onClose} className="w-9 h-9 -mr-2 rounded-full inline-flex items-center justify-center hover:bg-surface"><X size={18} strokeWidth={1.5} /></button>
        </div>
        <div className="flex-1 overflow-y-auto thin-scroll px-6 pb-safe">{children}</div>
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
