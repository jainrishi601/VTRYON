import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUpRight, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Film, Maximize2, Pencil, Play, RefreshCw, ScanFace, SendHorizontal, ShoppingBag, ShoppingCart, Users, X } from 'lucide-react'
import type { Answer, Clarify, Look, Product, ProductCard } from '../shared/types'
import { inr, catName } from '../shared/format'
import { abs, api } from './api'
import { chatScroll, mismatch, useElara, type Msg } from './state'
import { Collage, Img, RenderProgress, RevealImg, Ring, ScoreBadge, WEARABLE, defaultSize, lookAlt, pieceName, useBusy } from './ui'

/** The demo's scripted openers: a trip, a gift, a single piece. */
const OPENERS: [string, string][] = [
  ['A trip', 'Going to Goa next week with friends, need something breezy, budget around 7k'],
  ['A gift', 'College farewell outfit for my brother, he’s 20'],
  ['One piece', 'Linen shirts for the office, under ₹5,000'],
]
const PLACEHOLDERS = ['Going to Goa with friends, budget 7k…', 'A farewell outfit for my brother…', 'Something for a sangeet…', 'Linen shirts for the office…']

const near = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 140

export function Chat() {
  const e = useElara()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const [pill, setPill] = useState<{ id: string; label: string } | null>(null)

  const focusLook = e.focusLookId ? e.looks[e.focusLookId] : null
  const send = (text: string, answers?: Answer[]) => {
    stick.current = true
    setPill(null)
    e.send(text, { lookId: e.focusLookId, answers })
  }
  const last = e.messages[e.messages.length - 1]
  const card = last?.role === 'agent' && !e.busy && last.clarify?.questions?.length ? last.clarify : null
  const empty = !e.messages.some((m) => m.role === 'user')
  const welcome = empty ? e.messages.find((m) => m.welcome) : undefined

  // Restore where the shopper was when they come back from another tab; a fresh chat starts at the top.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (chatScroll.top != null && !empty) el.scrollTop = chatScroll.top
    else if (!empty) el.scrollTop = el.scrollHeight
    stick.current = near(el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (empty) chatScroll.top = null }, [empty])

  // Follow new content only when the shopper is already at the bottom. When outfits land, bring the first one to
  // the top (not the bottom of the third), then let them read. Render progress never moves the list.
  const results = (last?.lookIds?.length ?? 0) + (last?.products?.length ?? 0)
  const sig = `${e.messages.length}|${last?.id}|${last?.text.length}|${last?.statuses?.length}|${results}|${last?.tryNext?.length ?? 0}|${last?.error ? 1 : 0}|${card ? 1 : 0}`
  const prev = useRef({ id: '', results: 0, n: 0 })
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !last) return
    const p = prev.current
    prev.current = { id: last.id, results, n: e.messages.length }
    const sent = e.messages.length > p.n && last.role === 'agent' && last.streaming
    const landed = last.id === p.id && results > 0 && p.results === 0
    if (sent) { stick.current = true; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); return }
    if (landed) {
      const anchor = el.querySelector<HTMLElement>(`[data-results="${last.id}"]`)
      const label = last.lookIds?.length ? `New ${last.lookIds.length === 1 ? 'look' : 'looks'}` : 'New pieces'
      if (anchor && stick.current) {
        const top = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12
        el.scrollTo({ top, behavior: 'smooth' })
        stick.current = false
      } else if (anchor) setPill({ id: last.id, label })
      return
    }
    if (stick.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const jump = () => {
    const el = listRef.current
    const anchor = pill && el?.querySelector<HTMLElement>(`[data-results="${pill.id}"]`)
    if (el && anchor) el.scrollTo({ top: anchor.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12, behavior: 'smooth' })
    else el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setPill(null)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="chat">
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={listRef}
          onScroll={(ev) => {
            const el = ev.currentTarget
            stick.current = near(el)
            chatScroll.top = el.scrollTop
            if (pill && stick.current) setPill(null)
          }}
          className="flex-1 min-h-0 scroll-y px-4 sm:px-6 py-5 space-y-7"
          aria-live="polite"
        >
          {empty ? <Empty onPick={(t) => send(t)} welcome={welcome} /> : e.messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end fade-in">
                <p className="max-w-[80%] bg-ink text-white text-[14px] font-medium leading-[21px] px-4 py-3 rounded-2xl rounded-br-md whitespace-pre-wrap" data-testid="user-msg">{m.text}</p>
              </div>
            ) : m.welcome ? null : (
              <AgentMsg key={m.id} m={m} last={i === e.messages.length - 1} onPick={(t) => send(t)} />
            ),
          )}
        </div>
        {pill && (
          <button onClick={jump} data-testid="new-looks-pill" className="pill-in absolute bottom-3 left-1/2 z-10 h-9 pl-3 pr-4 rounded-full bg-ink text-white text-[13px] font-semibold inline-flex items-center gap-1.5 shadow-[0_8px_24px_rgba(0,0,0,.22)]">
            <ArrowDown size={15} strokeWidth={2} /> {pill.label}
          </button>
        )}
      </div>
      {card && <ClarifyCard key={last.id} card={card} onDone={send} />}
      <Composer inputRef={inputRef} onSend={(t) => send(t)} focusLook={focusLook} />
    </div>
  )
}

/** First screen: who Ava is, a few real looks from the store, and the scripted openers as one-tap prompts. */
function Empty({ onPick, welcome }: { onPick: (s: string) => void; welcome?: Msg }) {
  const e = useElara()
  const [pics, setPics] = useState<Product[]>([])
  useEffect(() => {
    if (e.cfg.storeId !== 'northline') return // ponytail: curated for the demo store; other stores get type only
    let live = true
    Promise.all(['nl-0203', 'nl-0296', 'nl-0187'].map((id) => api<Product>(`/api/products/${id}`).catch(() => null)))
      .then((ps) => live && setPics(ps.filter(Boolean) as Product[]))
    return () => { live = false }
  }, [e.cfg.storeId])
  const ideas: [string, string][] = welcome?.tryNext?.length ? [['Pick up where you left off', welcome.tryNext[0]], ...OPENERS.slice(0, 2)] : OPENERS
  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center py-6 sm:py-10" data-testid="chat-empty">
      <div className="relative h-[132px] w-[220px] fade-in" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="absolute top-1/2 left-1/2 w-[84px] aspect-[3/4] rounded-[14px] overflow-hidden bg-surface ring-4 ring-white shadow-[0_10px_30px_rgba(0,0,0,.12)] transition-transform duration-700"
            style={{ transform: `translate(-50%, -50%) translateX(${(i - 1) * 62}px) rotate(${(i - 1) * 7}deg) translateY(${i === 1 ? -6 : 4}px)`, zIndex: i === 1 ? 2 : 1 }}>
            {pics[i] && <Img src={pics[i].image_url} className="w-full h-full object-cover object-top" />}
          </div>
        ))}
      </div>
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Ava · your {e.store?.name ?? ''} stylist</p>
      {welcome ? (
        <p className="mt-2 text-[22px] sm:text-[26px] font-semibold leading-tight tracking-[-0.01em] max-w-[460px]" data-testid="agent-text">{welcome.text}</p>
      ) : (
        <p className="mt-2 text-[24px] sm:text-[28px] font-semibold leading-tight tracking-[-0.01em]">Tell me where you’re going.</p>
      )}
      <p className="mt-2 text-[14px] leading-[21px] text-muted max-w-[400px]">I’ll put complete outfits together from this store, under your budget, and show them on you.</p>
      <div className="mt-7 w-full max-w-[460px] flex flex-col gap-2 stagger" data-testid="openers">
        {ideas.map(([k, s]) => (
          <button key={s} onClick={() => onPick(s)} data-testid="opener"
            className="group w-full text-left rounded-2xl border border-line bg-white px-4 py-3 flex items-center gap-3 hover:border-ink hover:shadow-[0_6px_20px_rgba(0,0,0,.06)] transition-[border-color,box-shadow] duration-150">
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{k}</span>
              <span className="block mt-0.5 text-[14px] leading-[20px]">{s}</span>
            </span>
            <ArrowUpRight size={16} strokeWidth={1.75} className="shrink-0 text-muted group-hover:text-ink transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
        ))}
      </div>
    </div>
  )
}

function Status({ m }: { m: Msg }) {
  const [open, setOpen] = useState(false)
  const lines = m.statuses ?? []
  if (!lines.length) return m.streaming && !m.text ? <p className="text-[14px] flex items-center gap-2.5"><Dot done={false} /><span className="text-shine">Reading your message…</span></p> : null
  if (!m.streaming && !open) {
    return (
      <button onClick={() => setOpen(true)} className="h-7 -ml-1 px-1 rounded-md text-[12px] text-muted inline-flex items-center gap-1.5 hover:text-ink" data-testid="status-done">
        <Check size={13} strokeWidth={2.5} className="text-ok" /> <span className="num">Done in {(m.doneIn ?? 0).toFixed(1)}s</span>
        <ChevronDown size={12} />
      </button>
    )
  }
  return (
    <ul className="space-y-2.5" data-testid="status-list">
      {lines.map((s) => (
        <li key={s.id} className="flex items-center gap-2.5 text-[14px] num line-in">
          <Dot done={s.state === 'done'} />
          <span className={s.state === 'done' ? 'text-muted' : 'text-shine'}>{s.label}{s.state === 'done' ? '' : '…'}</span>
        </li>
      ))}
    </ul>
  )
}

/** Status dot: a filled check when done, a soft pulsing circle while working. */
const Dot = ({ done }: { done: boolean }) => (done
  ? <span className="w-[18px] h-[18px] rounded-full bg-ink text-white inline-flex items-center justify-center shrink-0"><Check size={11} strokeWidth={3} /></span>
  : <span className="w-[18px] h-[18px] rounded-full border-[1.5px] border-line border-t-ink spin shrink-0" aria-hidden />)

function AgentMsg({ m, last, onPick }: { m: Msg; last: boolean; onPick: (s: string) => void }) {
  const e = useElara()
  return (
    <div className="fade-in" data-testid="agent-msg">
      <div className="space-y-3">
        <Status m={m} />
        {m.text && <p className="text-[14px] leading-[22px] whitespace-pre-wrap max-w-[640px]" data-testid="agent-text">{m.text}</p>}
        {!m.text && !!m.clarify?.questions?.length && !(last && !e.busy) && <p className="text-[14px] leading-[22px]">{m.clarify.questions[0].question}</p>}
        {m.error && (
          <div className="rounded-2xl bg-surface px-4 py-3 flex items-center gap-3 text-[14px]" role="alert" data-testid="chat-error">
            <span className="flex-1">{m.error}</span>
            {m.retry && last && <button className="h-9 px-4 rounded-full bg-ink text-white text-[12px] font-semibold" onClick={() => e.send(m.retry!.message, { lookId: m.retry!.lookId, answers: m.retry!.answers })}>Try again</button>}
          </div>
        )}
      </div>
      {!!m.products?.length && <div data-results={m.id}><ProductGrid cards={m.products} /></div>}
      {!!m.lookIds?.length && (
        <div className="mt-4 space-y-4" data-results={m.id}>
          <div className="space-y-4 stagger">
            {m.lookIds.map((id, i) => e.looks[id] && <LookCard key={id} look={e.looks[id]} n={i + 1} />)}
          </div>
          {!m.streaming && <SeeOnYou lookIds={m.lookIds} />}
        </div>
      )}
      {last && !e.busy && !!m.tryNext?.length && (
        <div className="mt-6" data-testid="try-next">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-2.5">Try next</p>
          <div className="flex flex-wrap gap-2">
            {m.tryNext.map((t) => (
              <button key={t} onClick={() => onPick(t)} data-testid="try-next-chip" className="min-h-9 px-4 py-2 rounded-full border border-line text-[13px] text-left hover:border-ink active:bg-surface transition-colors">{t}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Under a set of flat looks: one tap puts every look on a sample model, or on the shopper's own photo. */
function SeeOnYou({ lookIds }: { lookIds: string[] }) {
  const e = useElara()
  const [busy, setBusy] = useState<string | null>(null)
  const looks = lookIds.map((id) => e.looks[id]).filter(Boolean)
  const waiting = looks.filter((l) => l.render.status === 'idle' || (l.render.status === 'failed' && (l.render.code === 'no_photo' || l.render.code === 'gender_mismatch')))
  if (!e.session) return null
  if (!waiting.length) {
    // After the tap the strip turns into a quiet progress line, so the list below doesn't jump.
    const live = looks.filter((l) => l.render.status === 'pending' || l.render.status === 'rendering').length
    const ready = looks.filter((l) => l.render.status === 'ready').length
    if ((!live && !ready) || looks.length < 2) return null
    const who = e.session.sample_model_id || looks.some((l) => l.model_id) ? 'the model' : 'you'
    return (
      <p className="h-11 px-4 rounded-2xl bg-surface text-[13px] flex items-center gap-2.5 fade-in" data-testid="see-progress" aria-live="polite">
        {live ? <><Ring done={false} /><span className="num">{ready ? <><span className="font-semibold">{ready} of {looks.length} ready</span> · the rest are close</> : <><span className="font-semibold">Putting {looks.length === 2 ? 'both' : `all ${looks.length}`} on {who}</span> · about a minute</>}</span></>
          : <><Ring done /><span>All {looks.length} on {who}. Tap one to see it big, or ↻ to swap a piece.</span></>}
      </p>
    )
  }
  const ids = waiting.map((l) => l.id)
  const need = looks.map((l) => l.gender).find(Boolean) ?? null
  const s = e.session
  const wrong = !!s.photo_url && mismatch({ gender: need }, s)
  const models = (e.models ?? []).filter((m) => !need || m.gender === need).slice(0, 4)
  const whose = need === 'men' ? 'men’s' : need === 'women' ? 'women’s' : ''
  const go = async (modelId?: string) => {
    if (busy) return
    setBusy(modelId ?? 'all')
    try { await e.seeLooksOn(ids, modelId) } finally { setBusy(null) }
  }
  if (s.photo_url && !wrong) {
    return (
      <button data-testid="see-all" aria-busy={!!busy} onClick={() => go()} className="w-full h-12 rounded-2xl bg-ink text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 fade-in">
        {busy ? <Spinner light /> : <ScanFace size={17} strokeWidth={1.75} />} See {ids.length === 1 ? 'it' : `all ${ids.length}`} on you
      </button>
    )
  }
  return (
    <section className="rounded-2xl bg-surface p-4 sm:p-5 fade-in" data-testid="see-on-you" aria-label="See these looks on a photo">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-semibold leading-tight">{wrong ? `See them on a ${whose} model` : `See ${ids.length === 1 ? 'it' : 'these'} on you`}</p>
          <p className="mt-1 text-[13px] leading-[19px] text-muted">
            {wrong ? `They’re cut for ${need}. One tap puts ${ids.length === 1 ? 'it' : `all ${ids.length}`} on a ${whose} model${s.sample_model_id ? '' : '; your own photo stays saved'}.`
              : `Pick a model or add your photo. ${ids.length === 1 ? 'It renders' : `All ${ids.length} render together`} in about 30 seconds.`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {models.map((m) => (
            <button key={m.id} data-testid={`see-model-${m.id}`} aria-label={`See them on ${m.label}`} title={m.label} disabled={!!busy} onClick={() => go(m.id)}
              className={`relative w-[50px] aspect-[3/4] rounded-[10px] overflow-hidden bg-white ring-offset-2 ring-offset-surface transition-shadow hover:ring-2 hover:ring-ink disabled:cursor-wait ${busy === m.id ? 'ring-2 ring-ink' : ''}`}>
              <img src={abs(m.image_url)} alt="" className="w-full h-full object-cover object-top" />
              {busy === m.id && <span className="absolute inset-0 bg-white/55 flex items-center justify-center"><Spinner /></span>}
            </button>
          ))}
          {!wrong && (
            <button data-testid="see-upload" disabled={!!busy} onClick={() => e.setTryon({ kind: 'look', lookId: ids[0], lookIds: ids })}
              className="h-[66px] px-4 rounded-[12px] bg-ink text-white text-[13px] font-semibold inline-flex flex-col items-center justify-center gap-1 disabled:opacity-60">
              <Camera size={16} strokeWidth={1.75} /> Your photo
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

const Spinner = ({ light }: { light?: boolean }) => <span className={`w-4 h-4 rounded-full border-2 spin ${light ? 'border-white/30 border-t-white' : 'border-line border-t-ink'}`} aria-hidden />

export function AddLookButton({ look, verdict, className = '' }: { look: Look; verdict?: string; className?: string }) {
  const e = useElara()
  const [added, setAdded] = useState(false)
  if (look.items.length && look.items.every((i) => i.product.owned)) return null // all yours: nothing to buy
  return (
    <button
      data-testid="add-look"
      onClick={() => { if (added) return; setAdded(true); e.addLookToCart(look, verdict); setTimeout(() => setAdded(false), 2000) }}
      className={`h-10 px-4 rounded-full text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors duration-150 ${added ? 'bg-ok text-white' : 'bg-ink text-white hover:bg-ink/85'} ${className}`}
    >
      {added ? <><Check size={15} strokeWidth={2.5} /> Added</> : <><ShoppingCart size={15} strokeWidth={2} /> Add to cart</>}
    </button>
  )
}

/** Round icon action; an async action shows a spinner at once and ignores repeat taps. */
function IconBtn({ label, onClick, children, testid, active }: { label: string; onClick: () => unknown; children: React.ReactNode; testid?: string; active?: boolean }) {
  const [busy, run] = useBusy()
  return (
    <button aria-label={label} title={label} data-testid={testid} aria-busy={busy} onClick={run(onClick)}
      className={`w-10 h-10 rounded-full border inline-flex items-center justify-center transition-colors duration-150 ${active ? 'bg-ink text-white border-ink' : 'border-line text-ink/70 hover:text-ink hover:border-ink active:bg-surface'}`}>
      {busy ? <Spinner /> : children}
    </button>
  )
}

/** The try-on image area (always 3:4, so nothing below it moves): the render, live progress while it renders, or
 *  the flat pieces with the next step. */
export function RenderBox({ look, onOpen, video, compact }: { look: Look; onOpen?: () => void; video?: boolean; compact?: boolean }) {
  const e = useElara()
  const r = look.render
  const products = look.items.map((i) => i.product)
  const onModel = !!look.model_id || !!e.session?.sample_model_id
  const blocked = r.status === 'failed' && (r.code === 'gender_mismatch' || r.code === 'no_photo')
  return (
    <div className="relative aspect-[3/4] bg-surface overflow-hidden" data-testid="render-box">
      {r.status === 'ready' && r.image_url ? (
        <>
          <button className="absolute inset-0" data-nopress onClick={onOpen} aria-label={`Open ${look.name} in the viewer`}>
            <RevealImg src={r.image_url} alt={lookAlt(look)} develop />
          </button>
          {video && look.video.url && (
            <video src={abs(look.video.url)} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover fade-in" aria-label={`${look.name}, moving`} />
          )}
          <span className="absolute bottom-3 left-3 h-6 px-2.5 rounded-full bg-white/95 text-[10px] font-semibold uppercase tracking-[0.08em] inline-flex items-center gap-1.5 pointer-events-none shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-ok" />{onModel ? 'On the model' : 'On you'}
          </span>
          {look.undrawn_note && <span className="absolute top-3 inset-x-12 mx-auto w-fit max-w-[calc(100%-6rem)] rounded-[10px] bg-ink/90 text-white text-[11px] leading-[15px] px-2.5 py-1.5 text-center pointer-events-none" data-testid="undrawn-note">{look.undrawn_note}</span>}
          {r.cached && <span className="sr-only">Cached render</span>}
        </>
      ) : r.status === 'idle' || r.status === 'failed' ? (
        <>
          <Collage products={products} />
          <div className="absolute inset-x-0 bottom-0 p-3 flex items-end justify-between gap-2" data-testid={r.status === 'failed' && !blocked ? 'render-failed' : undefined}>
            {r.status === 'failed' && !blocked
              ? <span className="min-w-0 rounded-[10px] bg-ink text-white text-[12px] leading-4 px-3 py-2 shadow">{r.error || 'We couldn’t render this one.'}</span>
              : blocked && r.code === 'gender_mismatch' ? <span className="min-w-0 rounded-[10px] bg-ink text-white text-[12px] leading-4 px-3 py-2 shadow">{r.error || 'Cut for a different fit. Try it on a model.'}</span>
              : <span />}
            {r.code !== 'minor' && (
              <button onClick={() => e.renderLook(look.id)} data-testid={r.status === 'idle' || r.code ? 'look-try-on' : 'retry-render'}
                className="shrink-0 h-9 px-3.5 rounded-full bg-white text-ink text-[12px] font-semibold inline-flex items-center gap-1.5 shadow-[0_4px_14px_rgba(0,0,0,.18)] hover:bg-white/90">
                <ScanFace size={14} strokeWidth={1.75} />{r.status === 'idle' || r.code ? 'Try on' : 'Retry'}
              </button>
            )}
          </div>
        </>
      ) : (
        <RenderProgress look={look} compact={compact} onModel={!!e.session?.sample_model_id} />
      )}
      {look.video.status === 'pending' && (
        <span className="absolute top-3 right-3 h-7 px-3 rounded-full bg-white/95 text-[11px] font-medium inline-flex items-center gap-2 shadow-sm" data-testid="video-pending"><Ring done={false} /> Making it move · a few minutes</span>
      )}
    </div>
  )
}

/** Outfit card. The render is the hero (3:4, left on a wide card, on top on a phone); the pieces sit beside or
 *  below it. Tap a piece to see just that piece on you; ↻ swaps it; ↗ opens its page. */
export function LookCard({ look, n }: { look: Look; n: number }) {
  const e = useElara()
  const [more, setMore] = useState(false)
  const [video, setVideo] = useState(false)
  const focused = e.focusLookId === look.id
  const r = look.render
  const owned = look.items.filter((i) => i.product.owned).length
  const onVideo = () => {
    if (look.video.status === 'ready') setVideo((v) => !v)
    else if (look.video.status !== 'pending') { setVideo(true); return e.requestVideo(look.id) }
  }
  return (
    <article data-testid="look-card" data-look-id={look.id} className={`@container rounded-[20px] border bg-white overflow-hidden transition-[border-color,box-shadow] duration-200 ${focused ? 'border-ink shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line hover:shadow-[0_10px_34px_rgba(0,0,0,.06)]'}`}>
      <div className="grid @[540px]:grid-cols-[minmax(0,46%)_1fr]">
        <div className="relative" data-render-status={r.status}>
          <RenderBox look={look} onOpen={() => e.setViewer(look.id)} video={video && look.video.status === 'ready'} />
          <span className="num absolute top-3 left-3 w-7 h-7 rounded-full bg-white/95 text-ink text-[12px] font-semibold inline-flex items-center justify-center shadow-sm pointer-events-none">{n}</span>
        </div>

        <div className="min-w-0 flex flex-col p-4 @[540px]:p-5">
          <header className="flex items-start gap-2.5">
            <div className="flex-1 min-w-0">
              <h4 className="text-[18px] font-semibold leading-[23px] tracking-[-0.01em] capitalize" data-testid="look-name">{look.name}</h4>
              <div className="mt-1.5"><ScoreBadge score={look.score} band={look.score_band} /></div>
            </div>
            <button aria-pressed={focused} aria-label={focused ? `Stop editing ${look.name}` : `Edit ${look.name} in the chat`} title={focused ? 'Selected: your next message edits this look' : 'Select to change it in the chat'}
              onClick={() => e.setFocusLookId(focused ? null : look.id)} data-testid="look-select"
              className={`mt-0.5 h-8 px-3 shrink-0 rounded-full border text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors ${focused ? 'bg-ink border-ink text-white' : 'border-line text-muted hover:border-ink hover:text-ink'}`}>
              {focused ? <><Check size={13} strokeWidth={2.5} /> Editing</> : <><Pencil size={12} strokeWidth={1.75} /> Edit</>}
            </button>
          </header>

          <div className="mt-3 text-[13px] leading-[20px] text-ink/80">
            <p className={more ? '' : 'line-clamp-3'}>{look.why}</p>
            {more && (
              <div className="mt-2 space-y-1.5 fade-in" data-testid="why-body">
                {look.tip && <p><span className="font-semibold text-ink">Finish it:</span> {look.tip}</p>}
                {look.score_reason && <p className="text-muted">{look.score_reason}.</p>}
              </div>
            )}
            {(look.why.length > 120 || look.tip || look.score_reason) && (
              <button onClick={() => setMore(!more)} aria-expanded={more} className="mt-1 h-7 -ml-1 px-1 rounded-md text-[12px] font-semibold text-ink inline-flex items-center gap-1 hover:bg-surface">
                {more ? 'Less' : 'Why this works'} <ChevronDown size={13} className={`transition-transform ${more ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>

          <ul className="mt-3 border-t border-line divide-y divide-line">
            {look.items.map(({ slot, product: p }) => (
              <li key={slot + p.id} className="py-2.5 flex items-center gap-3" data-testid="piece-row">
                <button className="relative w-11 aspect-[3/4] shrink-0 rounded-md overflow-hidden bg-surface disabled:cursor-default group" disabled={!WEARABLE.has(slot) || !!p.owned} data-testid={`piece-tryon-${slot}`}
                  onClick={() => e.setTryon({ kind: 'items', products: [p], fromLookId: look.id })}
                  aria-label={WEARABLE.has(slot) ? `See the ${pieceName(p)} on you` : pieceName(p)} title={WEARABLE.has(slot) && !p.owned ? 'See just this on you' : undefined}>
                  <Img src={p.image_url} className={`w-full h-full ${p.owned ? 'object-contain p-1' : 'object-cover object-top'} group-hover:scale-[1.06] transition-transform duration-300`} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium leading-[18px] line-clamp-1">{pieceName(p)}</p>
                  <p className="num text-[12px] text-muted leading-[17px]">
                    {p.owned ? <span className="inline-flex items-center gap-1.5"><span className="h-4 px-1.5 rounded-full bg-ink text-white text-[9px] font-semibold uppercase tracking-[0.06em] inline-flex items-center" data-testid="piece-owned">Yours</span>In your wardrobe</span>
                      : <>{catName(p.category)} · {inr(p.price)}</>}
                  </p>
                </div>
                <button aria-label={`Swap the ${catName(p.category)}`} title="Swap this piece" data-testid={`swap-${slot}`} onClick={() => e.setSwap({ lookId: look.id, slot })}
                  className="w-8 h-8 shrink-0 rounded-full inline-flex items-center justify-center text-ink/70 hover:text-ink hover:bg-surface active:bg-soft"><RefreshCw size={14} strokeWidth={1.75} /></button>
                {!p.owned && (
                  <a href={p.product_url} target="_top" aria-label={`Open ${pieceName(p)}`} title="Open the product page"
                    className="w-8 h-8 shrink-0 -ml-1.5 rounded-full inline-flex items-center justify-center text-ink/70 hover:text-ink hover:bg-surface"><ArrowUpRight size={15} strokeWidth={1.75} /></a>
                )}
              </li>
            ))}
          </ul>

          <footer className="mt-auto pt-3 border-t border-line flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
            <p className="leading-tight">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Total</span>
              <span className="num text-[18px] font-semibold" data-testid="look-total">{inr(look.total)}</span>
              {!!look.over_budget_by && <span className="num block text-[11px] text-accent mt-0.5">{inr(look.over_budget_by)} over budget</span>}
              {owned > 0 && <span className="block text-[11px] text-muted mt-0.5">+ {owned} from your wardrobe</span>}
            </p>
            <div className="flex items-center gap-1.5">
              {r.status === 'ready' && (
                <IconBtn label={look.video.status === 'ready' ? (video ? 'Show the photo' : 'Play the video') : look.video.status === 'pending' ? 'Making it move' : 'See it move'} testid="see-it-move" onClick={onVideo} active={video && look.video.status === 'ready'}>
                  {look.video.status === 'pending' ? <Spinner /> : look.video.status === 'ready' && !video ? <Play size={15} strokeWidth={1.75} /> : <Film size={15} strokeWidth={1.75} />}
                </IconBtn>
              )}
              <IconBtn label="Share with Crew" testid="share-crew" onClick={() => e.shareLook(look.id)}><Users size={15} strokeWidth={1.75} /></IconBtn>
              <IconBtn label="Open viewer" testid="open-viewer" onClick={() => e.setViewer(look.id)}><Maximize2 size={15} strokeWidth={1.75} /></IconBtn>
              <AddLookButton look={look} />
            </div>
          </footer>
        </div>
      </div>
    </article>
  )
}

function Composer({ inputRef, onSend, focusLook }: { inputRef: React.RefObject<HTMLTextAreaElement>; onSend: (s: string) => void; focusLook: Look | null }) {
  const e = useElara()
  const [v, setV] = useState('')
  const [focus, setFocus] = useState(false)
  const [ph, setPh] = useState(0)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(120, el.scrollHeight) + 'px'
  }, [v, inputRef])
  // The placeholder cycles through real requests, and holds still while the shopper is typing.
  useEffect(() => {
    if (focus || v) return
    const t = setInterval(() => setPh((i) => (i + 1) % PLACEHOLDERS.length), 3600)
    return () => clearInterval(t)
  }, [focus, v])
  const go = () => {
    if (!v.trim() || e.busy) return
    onSend(v)
    setV('')
  }
  return (
    <div className="shrink-0 px-4 sm:px-6 pt-2 pb-2 bg-white">
      {focusLook && (
        <div className="mb-2 flex items-center gap-2 text-[12px] fade-in" data-testid="focus-chip">
          <span className="text-muted">Editing</span>
          <span className="h-7 pl-3 pr-1 rounded-full bg-surface inline-flex items-center gap-1.5 font-medium">
            {focusLook.name}
            <button aria-label="Stop editing this look" onClick={() => e.setFocusLookId(null)} className="w-6 h-6 rounded-full inline-flex items-center justify-center hover:bg-white"><X size={12} /></button>
          </span>
        </div>
      )}
      <div className="gradient-border rounded-[24px] shadow-sm flex items-end gap-1.5 pl-4 pr-1.5 py-1">
        <textarea
          ref={inputRef}
          rows={1}
          value={v}
          data-testid="composer-input"
          aria-label="Message your stylist"
          placeholder={focusLook ? `Change something about ${focusLook.name}` : focus ? 'What are you looking for?' : PLACEHOLDERS[ph]}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onChange={(ev) => setV(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); go() } }}
          className="flex-1 resize-none bg-transparent outline-none text-[15px] sm:text-[14px] leading-6 py-2 max-h-[120px] placeholder:text-muted"
        />
        <button
          aria-label="Send message"
          data-testid="composer-send"
          disabled={!v.trim() || e.busy}
          onClick={go}
          className={`w-9 h-9 mb-0.5 rounded-full inline-flex items-center justify-center shrink-0 transition-colors duration-150 ${v.trim() && !e.busy ? 'bg-ink text-white' : 'bg-surface text-muted'}`}
        >
          {e.busy ? <Spinner /> : <SendHorizontal size={16} strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  )
}

/** 1-2 questions on one card, docked above the composer. Answers go to the server structured (they fill the
 *  shopper's profile) and as one readable line in the chat. */
function ClarifyCard({ card, onDone }: { card: Clarify; onDone: (text: string, answers: Answer[]) => void }) {
  const n = card.questions.length
  const [i, setI] = useState(0)
  const [picks, setPicks] = useState<({ label: string; value: string } | null)[]>(() => card.questions.map(() => null))
  const [other, setOther] = useState(false)
  const [txt, setTxt] = useState('')
  const q = card.questions[i]
  const finish = (ps: typeof picks) => {
    const answers = ps.flatMap((p, k) => (p ? [{ field: card.questions[k].field, value: p.value }] : []))
    const labels = ps.flatMap((p) => (p ? [p.label] : []))
    onDone(labels.length ? labels.join(' · ') : 'Skip the questions, just show me something', answers)
  }
  // Show the pick for a beat before moving on, and ignore clicks meanwhile: without it a double-click (or a
  // double-tap on a phone) silently answered the NEXT question with whatever option sat under the cursor.
  const busy = useRef(false)
  const choose = (p: { label: string; value: string } | null) => {
    if (busy.current) return
    busy.current = true
    const next = picks.map((x, k) => (k === i ? p : x))
    setPicks(next); setOther(false); setTxt('')
    setTimeout(() => {
      busy.current = false
      if (i < n - 1) setI(i + 1)
      else finish(next)
    }, 260)
  }
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const k = Number(ev.key)
      if (!other && k >= 1 && k <= q.options.length && !(ev.target as HTMLElement)?.closest?.('textarea,input')) choose(q.options[k - 1])
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })
  return (
    <div className="shrink-0 px-4 sm:px-6 pb-1 pop-in">
      <div className="rounded-2xl border border-line bg-white shadow-[0_8px_30px_rgba(0,0,0,.08)] overflow-hidden" data-testid="clarify-card" role="group" aria-label={q.question}>
        <div className="px-4 py-3.5 flex items-center gap-3 border-b border-line">
          <p className="flex-1 text-[15px] font-semibold leading-5" data-testid="clarify-question">{q.question}</p>
          {n > 1 && (
            <span className="num text-[13px] text-muted inline-flex items-center gap-1 shrink-0">
              <button aria-label="Previous question" disabled={i === 0} onClick={() => setI(i - 1)} className="w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-surface disabled:opacity-30"><ChevronLeft size={15} /></button>
              {i + 1} of {n}
              <button aria-label="Next question" disabled={i === n - 1} onClick={() => setI(i + 1)} className="w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-surface disabled:opacity-30"><ChevronRight size={15} /></button>
            </span>
          )}
        </div>
        <div className="p-1.5 fade-in" key={i}>
          {q.options.map((o, k) => {
            const on = picks[i]?.value === o.value
            return (
              <button key={o.value + k} data-testid="clarify-option" onClick={() => choose(o)} aria-pressed={on}
                className={`w-full h-12 px-2.5 rounded-xl flex items-center gap-3 text-[15px] text-left transition-colors duration-100 hover:bg-surface active:bg-soft ${on ? 'bg-surface ring-1 ring-ink' : ''}`}>
                <span className={`num w-7 h-7 rounded-full text-[12px] inline-flex items-center justify-center shrink-0 transition-colors ${on ? 'bg-ink text-white' : 'bg-surface text-muted'}`}>{on ? <Check size={13} strokeWidth={2.5} /> : k + 1}</span>
                {o.label}
              </button>
            )
          })}
          <div className="h-12 px-2.5 flex items-center gap-3">
            <span className="w-7 h-7 rounded-full bg-surface text-muted inline-flex items-center justify-center shrink-0"><Pencil size={12} strokeWidth={1.75} /></span>
            {other ? (
              <input autoFocus value={txt} onChange={(ev) => setTxt(ev.target.value)} placeholder="Type your answer" data-testid="clarify-else-input" maxLength={80}
                onKeyDown={(ev) => { if (ev.key === 'Enter' && txt.trim()) choose({ label: txt.trim(), value: txt.trim() }); if (ev.key === 'Escape') setOther(false) }}
                className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted" />
            ) : (
              <button data-testid="clarify-else" onClick={() => setOther(true)} className="flex-1 h-10 text-left text-[15px] text-muted hover:text-ink">Something else</button>
            )}
            <button data-testid="clarify-skip" onClick={() => choose(null)} className="h-8 px-3.5 rounded-full border border-line text-[13px] text-muted hover:border-ink hover:text-ink">Skip</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProductGrid({ cards }: { cards: ProductCard[] }) {
  const e = useElara()
  const [added, setAdded] = useState<string | null>(null)
  const add = (p: Product) => {
    e.addToCart([{ product_id: p.id, title: p.title, price: p.price, image_url: p.image_url, size: defaultSize(p), styled_with: 'Ava' }])
    setAdded(p.id); setTimeout(() => setAdded(null), 1800)
  }
  return (
    <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-5 max-w-[680px] stagger" data-testid="product-grid">
      {cards.map(({ product: p, match }) => (
        <article key={p.id} data-testid="grid-card">
          <div className="relative aspect-[3/4] bg-surface overflow-hidden rounded-xl">
            <Img src={p.image_url} alt={p.title} className="w-full h-full object-cover object-top" />
            {match != null && match >= 70 && <span className="absolute top-2.5 left-2.5 text-[10px] font-semibold uppercase tracking-[0.06em] bg-white rounded-full px-2.5 py-1" title="How closely it matches your Style DNA">{match}% your style</span>}
            {WEARABLE.has(p.slot) && (
              <button aria-label={`See the ${pieceName(p)} on you`} title="Try it on" data-testid="product-tryon" onClick={() => e.setTryon({ kind: 'items', products: [p], name: pieceName(p) })}
                className="absolute bottom-2.5 left-2.5 h-8 pl-2.5 pr-3 rounded-full bg-white shadow-sm inline-flex items-center gap-1.5 text-[12px] font-semibold"><ScanFace size={14} strokeWidth={1.75} />Try on</button>
            )}
            <a href={p.product_url} target="_top" aria-label={`Open ${pieceName(p)}`} title="Open the product page"
              className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-white shadow-sm inline-flex items-center justify-center"><ArrowUpRight size={14} strokeWidth={2} /></a>
          </div>
          <div className="mt-2 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium leading-[18px] line-clamp-2">{p.title}</p>
              <p className="num text-[13px] text-muted mt-0.5">{inr(p.price)}</p>
            </div>
            <button aria-label={`Add ${pieceName(p)} to cart`} title="Add to cart" data-testid="product-add" onClick={() => add(p)}
              className={`w-9 h-9 shrink-0 rounded-full border inline-flex items-center justify-center transition-colors ${added === p.id ? 'bg-ok border-ok text-white' : 'border-line hover:border-ink'}`}>
              {added === p.id ? <Check size={14} strokeWidth={2.5} /> : <ShoppingBag size={14} strokeWidth={1.75} />}
            </button>
          </div>
          {WEARABLE.has(p.slot) && (
            <button data-testid="product-style" disabled={e.busy} onClick={() => e.send(`Build a complete look around the ${p.title}`)}
              className="mt-1 h-8 text-[12px] text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50">Build a look with this</button>
          )}
        </article>
      ))}
    </div>
  )
}
