import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** TRYON's small shared UI: route change without a scroll jump, body scroll lock, a sheet, toasts, page header. */

/** Change the URL like navigate(), but keep the scroll position (tabs inside a page). */
export function go(to: string, replace = false) {
  if (to === location.pathname + location.search) return
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  dispatchEvent(new PopStateEvent('popstate'))
}

/** Lock the page behind a sheet; restores the exact scroll offset (no jump) when it closes. */
export function useScrollLock(on = true) {
  useEffect(() => {
    if (!on) return
    const y = scrollY
    const b = document.body.style
    const prev = [b.position, b.top, b.width, b.overflow]
    Object.assign(b, { position: 'fixed', top: `-${y}px`, width: '100%', overflow: 'hidden' })
    return () => {
      ;[b.position, b.top, b.width, b.overflow] = prev
      scrollTo(0, y)
    }
  }, [on])
}

export const useMedia = (q: string) => {
  const [m, setM] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

/** Bottom sheet on phones (20 px top corners), centred card from `sm` up. Esc and the scrim close it. */
export function Sheet({ title, onClose, children, testid, full = false }: { title: ReactNode; onClose: () => void; children: ReactNode; testid?: string; full?: boolean }) {
  useScrollLock()
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" data-testid={testid}>
      <div className="absolute inset-0 bg-ink/40 t-scrim" onClick={onClose} />
      <div className={`relative w-full sm:max-w-[560px] bg-white rounded-t-[20px] sm:rounded-[20px] t-sheet flex flex-col ${full ? 'h-[100dvh] sm:h-auto rounded-t-none' : 'max-h-[88dvh]'}`}>
        <div className="shrink-0 h-14 px-5 flex items-center gap-3 border-b border-line">
          <div className="flex-1 min-w-0 text-[15px] font-semibold truncate">{title}</div>
          <button onClick={onClose} aria-label="Close" className="w-10 h-10 -mr-2 rounded-full inline-flex items-center justify-center hover:bg-surface"><X size={18} /></button>
        </div>
        <div className="t-scroll flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

// ---- toasts: one at a time, bottom centre, with one action ----
type Toast = { id: number; text: string; action?: { label: string; run: () => void }; onExpire?: () => void }
let cur: Toast | null = null
const subs = new Set<() => void>()
let timer = 0
const emit = () => subs.forEach((s) => s())
export function toast(text: string, action?: Toast['action'], opts: { ms?: number; onExpire?: () => void } = {}) {
  clearTimeout(timer)
  cur?.onExpire?.()
  const t: Toast = { id: Date.now(), text, action, onExpire: opts.onExpire }
  cur = t
  emit()
  timer = window.setTimeout(() => { if (cur?.id === t.id) { cur = null; t.onExpire?.(); emit() } }, opts.ms ?? 5000)
}
const dismiss = (run?: () => void) => { clearTimeout(timer); const t = cur; cur = null; emit(); if (run) run(); else t?.onExpire?.() }

export function Toasts() {
  const t = useSyncExternalStore((l) => (subs.add(l), () => subs.delete(l)), () => cur)
  if (!t) return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(88px,calc(env(safe-area-inset-bottom)+72px))] pointer-events-none" role="status" aria-live="polite">
      <div key={t.id} className="t-toast pointer-events-auto min-h-12 pl-5 pr-2 py-1.5 rounded-full bg-ink text-white text-[14px] flex items-center gap-3 shadow-[0_10px_30px_rgba(17,17,17,.25)] max-w-full" data-testid="tryon-toast">
        <span className="truncate">{t.text}</span>
        {t.action && <button onClick={() => dismiss(t.action!.run)} className="shrink-0 h-9 px-4 rounded-full bg-white text-ink text-[13px] font-semibold" data-testid="toast-action">{t.action.label}</button>}
        {!t.action && <button onClick={() => dismiss()} aria-label="Dismiss" className="shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center text-white/70"><X size={15} /></button>}
      </div>
    </div>
  )
}

/** Page header: a small label that says something true (date, count, store), a serif title, one line of help. */
export function PageHead({ eyebrow, title, sub, children }: { eyebrow: ReactNode; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="flex-1 min-w-[240px]">
        <p className="label text-muted flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-accent" />{eyebrow}</p>
        <h1 className="mt-3 font-serif text-[44px] sm:text-[64px] leading-[0.95] tracking-[-0.01em]">{title}</h1>
        {sub && <p className="mt-3 text-[15px] sm:text-[16px] text-muted max-w-[620px]">{sub}</p>}
      </div>
      {children}
    </header>
  )
}

/** The woven-label tag: marks what is yours vs. the store's, and what the try-on drew. */
export const Tag = ({ children, tone = 'ink' }: { children: ReactNode; tone?: 'ink' | 'linen' }) => (
  <span className={`t-tag ${tone === 'linen' ? 't-tag-linen' : ''}`}>{children}</span>
)

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Keys this browser keeps for one shopper: cleared on sign-out so the next person starts clean. */
export function clearShopper() {
  for (const st of [localStorage, sessionStorage]) {
    try {
      Object.keys(st).filter((k) => /^(elara\.|tryon\.|northline\.)/.test(k)).forEach((k) => st.removeItem(k))
    } catch { /* private mode */ }
  }
}
