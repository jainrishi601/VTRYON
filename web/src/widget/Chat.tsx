import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Film, Maximize2, Pencil, Play, RefreshCw, ScanFace, SendHorizontal, ShoppingBag, ShoppingCart, Users, X } from 'lucide-react'
import type { Answer, Clarify, Look, Product, ProductCard } from '../shared/types'
import { inr, catName } from '../shared/format'
import { abs } from './api'
import { useElara, type Msg } from './state'
import { Collage, RenderProgress, RevealImg, Ring, ScoreBadge, WEARABLE, lookAlt, pieceName } from './ui'

export function Chat() {
  const e = useElara()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [e.messages, e.looks])

  const focusLook = e.focusLookId ? e.looks[e.focusLookId] : null
  const send = (text: string, answers?: Answer[]) => {
    stick.current = true
    e.send(text, { lookId: e.focusLookId, answers })
  }
  const last = e.messages[e.messages.length - 1]
  const card = last?.role === 'agent' && !e.busy && last.clarify?.questions?.length ? last.clarify : null

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="chat">
      <div
        ref={listRef}
        onScroll={(ev) => { const el = ev.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }}
        className="flex-1 min-h-0 overflow-y-auto thin-scroll px-4 sm:px-5 py-5 space-y-6"
        aria-live="polite"
      >
        {e.messages.length === 0 && <Empty onPick={(t) => send(t)} />}
        {e.messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end fade-in">
              <p className="max-w-[80%] bg-ink text-white text-[14px] font-medium leading-[21px] px-4 py-3 rounded-2xl whitespace-pre-wrap" data-testid="user-msg">{m.text}</p>
            </div>
          ) : (
            <AgentMsg key={m.id} m={m} last={i === e.messages.length - 1} onPick={(t) => send(t)} />
          ),
        )}
      </div>
      {card && <ClarifyCard key={last.id} card={card} onDone={send} />}
      <Composer inputRef={inputRef} onSend={(t) => send(t)} focusLook={focusLook} />
    </div>
  )
}

function Empty({ onPick }: { onPick: (s: string) => void }) {
  const e = useElara()
  const occ = e.brief?.occasion
  const ideas = [occ ? `Looks for the ${occ.toLowerCase()}` : 'Outfit for a beach party', 'Something for a wedding', 'Show me some linen shirts'].filter(Boolean) as string[]
  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center py-10 fade-in" data-testid="chat-empty">
      <p className="text-[22px] font-semibold tracking-[0.18em] uppercase">{e.store?.name ?? 'Stylist'}</p>
      <p className="mt-7 text-[16px] font-bold">Hi, I’m your stylist.</p>
      <p className="mt-1.5 text-[14px] text-muted max-w-[420px]">Tell me what you’re shopping for and I’ll put a look together from this store.</p>
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Try asking</p>
      <div className="mt-3 flex flex-col items-center gap-2">
        {ideas.map((s) => (
          <button key={s} onClick={() => onPick(s)} className="px-4 py-2.5 rounded-full bg-soft text-[14px] font-medium hover:bg-line transition-colors">{s}</button>
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
      <button onClick={() => setOpen(true)} className="text-[12px] text-muted inline-flex items-center gap-1.5 hover:text-ink" data-testid="status-done">
        <Check size={13} strokeWidth={2.5} className="text-ok" /> <span className="num">Done in {(m.doneIn ?? 0).toFixed(1)}s</span>
        <ChevronDown size={12} />
      </button>
    )
  }
  return (
    <ul className="space-y-2.5" data-testid="status-list">
      {lines.map((s) => (
        <li key={s.id} className="flex items-center gap-2.5 text-[14px] num">
          <Dot done={s.state === 'done'} />
          <span className={s.state === 'done' ? 'text-muted' : 'text-shine'}>{s.label}{s.state === 'done' ? '' : '…'}</span>
        </li>
      ))}
    </ul>
  )
}

/** Status dot: a filled check when done, a soft empty circle while working. */
const Dot = ({ done }: { done: boolean }) => (done
  ? <span className="w-[18px] h-[18px] rounded-full bg-ink text-white inline-flex items-center justify-center shrink-0"><Check size={11} strokeWidth={3} /></span>
  : <span className="w-[18px] h-[18px] rounded-full bg-soft shrink-0" aria-hidden />)

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
            {m.retry && last && <button className="h-8 px-4 rounded-full bg-ink text-white text-[12px] font-semibold" onClick={() => e.send(m.retry!.message, { lookId: m.retry!.lookId, answers: m.retry!.answers })}>Try again</button>}
          </div>
        )}
      </div>
      {!!m.products?.length && <ProductGrid cards={m.products} />}
      {!!m.lookIds?.length && (
        <div className="mt-3 space-y-3 max-w-[640px]">
          {m.lookIds.map((id, i) => e.looks[id] && <LookCard key={id} look={e.looks[id]} n={i + 1} />)}
        </div>
      )}
      {last && !e.busy && !!m.tryNext?.length && (
        <div className="mt-5" data-testid="try-next">
          <p className="text-[13px] text-muted mb-2">Try next</p>
          <div className="flex flex-col items-start gap-2">
            {m.tryNext.map((t) => (
              <button key={t} onClick={() => onPick(t)} data-testid="try-next-chip" className="px-4 py-2.5 rounded-full border border-line text-[14px] text-left hover:border-ink transition-colors">{t}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function AddLookButton({ look, verdict, className = '' }: { look: Look; verdict?: string; className?: string }) {
  const e = useElara()
  const [added, setAdded] = useState(false)
  if (look.items.length && look.items.every((i) => i.product.owned)) return null // all yours: nothing to buy
  return (
    <button
      data-testid="add-look"
      onClick={() => { e.addLookToCart(look, verdict); setAdded(true); setTimeout(() => setAdded(false), 2000) }}
      className={`h-9 px-4 rounded-full text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${added ? 'bg-ok text-white' : 'bg-ink text-white hover:opacity-90'} ${className}`}
    >
      {added ? <><Check size={14} strokeWidth={2.5} /> Added</> : <><ShoppingCart size={14} strokeWidth={2} /> Add to cart</>}
    </button>
  )
}

function IconBtn({ label, onClick, children, testid, active }: { label: string; onClick: () => void; children: React.ReactNode; testid?: string; active?: boolean }) {
  return (
    <button aria-label={label} title={label} data-testid={testid} onClick={onClick}
      className={`w-9 h-9 rounded-full border inline-flex items-center justify-center transition-colors ${active ? 'bg-ink text-white border-ink' : 'border-line text-muted hover:text-ink hover:border-ink'}`}>
      {children}
    </button>
  )
}

/** The try-on image area: the render, live progress while it renders, or the flat pieces with the next step. */
export function RenderBox({ look, onOpen, video, compact }: { look: Look; onOpen?: () => void; video?: boolean; compact?: boolean }) {
  const e = useElara()
  const r = look.render
  const products = look.items.map((i) => i.product)
  return (
    <div className="relative aspect-[3/4] bg-surface overflow-hidden" data-testid="render-box">
      {r.status === 'ready' && r.image_url ? (
        <>
          <button className="absolute inset-0" onClick={onOpen} aria-label={`Open ${look.name} in the viewer`}>
            <RevealImg src={r.image_url} alt={lookAlt(look)} />
          </button>
          {video && look.video.url && (
            <video src={abs(look.video.url)} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" aria-label={`${look.name}, moving`} />
          )}
          <span className="absolute top-2.5 left-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] bg-white rounded-full px-2.5 py-1 pointer-events-none">{look.model_id || e.session?.sample_model_id ? 'On the model' : 'On you'}</span>
          {r.cached && <span className="sr-only">Cached render</span>}
        </>
      ) : r.status === 'idle' || r.status === 'failed' ? (
        <>
          <Collage products={products} />
          <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-between gap-3" data-testid={r.status === 'failed' ? 'render-failed' : undefined}>
            <p className="text-[12px] text-white leading-4">{r.status === 'idle' ? '' : r.error || 'We couldn’t render this one.'}</p>
            {r.code !== 'minor' && (
              <button onClick={() => e.renderLook(look.id)} data-testid={r.status === 'idle' ? 'try-on' : 'retry-render'} className="shrink-0 h-8 px-3.5 rounded-full bg-white text-ink text-[12px] font-semibold inline-flex items-center gap-1.5">
                <ScanFace size={14} strokeWidth={1.75} />{r.status === 'idle' || r.code ? 'Try on' : 'Retry'}
              </button>
            )}
          </div>
        </>
      ) : (
        <RenderProgress look={look} compact={compact} onModel={!!e.session?.sample_model_id} />
      )}
      {look.video.status === 'pending' && (
        <span className="absolute top-2.5 right-2.5 h-7 px-3 rounded-full bg-white text-[11px] inline-flex items-center gap-2"><Ring done={false} /> Making it move</span>
      )}
    </div>
  )
}

/** Outfit card: numbered header, "Why this works", the pieces as thumbnails, the try-on once asked for, and a
 *  total with Try on / Add to cart. Tap a piece to see just that piece on you; ↻ swaps it; ↗ opens its page. */
export function LookCard({ look, n }: { look: Look; n: number }) {
  const e = useElara()
  const [why, setWhy] = useState(false)
  const [video, setVideo] = useState(false)
  const focused = e.focusLookId === look.id
  const r = look.render
  const shown = r.status !== 'idle' && !(r.status === 'failed' && (r.code === 'gender_mismatch' || r.code === 'no_photo'))
  const onVideo = () => {
    if (look.video.status === 'ready') setVideo((v) => !v)
    else if (look.video.status !== 'pending') { e.requestVideo(look.id); setVideo(true) }
  }
  return (
    <article data-testid="look-card" data-look-id={look.id} className={`card-glow rounded-2xl border bg-white overflow-hidden transition-colors ${focused ? 'border-ink' : 'border-line'}`}>
      <header className="flex items-center gap-2.5 px-4 pt-3.5">
        <span className="num w-6 h-6 shrink-0 rounded-full bg-ink text-white text-[12px] font-semibold inline-flex items-center justify-center">{n}</span>
        <h4 className="flex-1 min-w-0 text-[14px] font-semibold capitalize truncate" data-testid="look-name">{look.name}</h4>
        <ScoreBadge score={look.score} band={look.score_band} />
        <button aria-pressed={focused} aria-label={focused ? `Stop editing ${look.name}` : `Edit ${look.name} in the chat`} title={focused ? 'Selected for edits' : 'Select to change it in the chat'}
          onClick={() => e.setFocusLookId(focused ? null : look.id)} data-testid="look-select"
          className={`w-[22px] h-[22px] shrink-0 rounded-full border inline-flex items-center justify-center transition-colors ${focused ? 'bg-ink border-ink text-white' : 'border-line hover:border-ink'}`}>
          {focused && <Check size={12} strokeWidth={3} />}
        </button>
      </header>

      <button className="mx-4 mt-3 w-[calc(100%-2rem)] flex items-center justify-between rounded-full bg-soft px-3.5 py-2 text-left text-[12px] font-semibold uppercase tracking-[0.3px]" aria-expanded={why} onClick={() => setWhy(!why)}>
        Why this works <ChevronDown size={15} strokeWidth={2} className={`transition-transform ${why ? 'rotate-180' : ''}`} />
      </button>
      {why && (
        <div className="mx-4 mt-2 rounded-xl bg-surface px-4 py-3 text-[13px] leading-[20px] space-y-2 fade-in" data-testid="why-body">
          <p>{look.why}</p>
          {look.tip && <p><span className="font-semibold">Finish it:</span> <span className="text-muted">{look.tip}</span></p>}
          {look.score_reason && <p className="text-muted">{look.score_reason}.</p>}
        </div>
      )}

      <div className="px-4 mt-3 flex flex-wrap gap-3" data-render-status={r.status}>
        {shown && (
          <div className="w-[220px] max-w-full rounded-xl overflow-hidden fade-in">
            <RenderBox look={look} onOpen={() => e.setViewer(look.id)} video={video && look.video.status === 'ready'} compact />
          </div>
        )}
        <div className={`flex flex-wrap gap-3 content-start ${shown ? 'flex-1 min-w-[236px]' : ''}`}>
          {look.items.map(({ slot, product: p }) => (
            <div key={slot + p.id} className="w-28 flex flex-col gap-1.5" data-testid="piece-row">
              <div className="relative aspect-square rounded-lg overflow-hidden bg-surface group">
                <button className="absolute inset-0 disabled:cursor-default" disabled={!WEARABLE.has(slot) || !!p.owned} data-testid={`piece-tryon-${slot}`}
                  onClick={() => e.setTryon({ kind: 'items', products: [p], fromLookId: look.id })}
                  aria-label={WEARABLE.has(slot) ? `See the ${pieceName(p)} on you` : pieceName(p)} title={WEARABLE.has(slot) ? 'See just this on you' : undefined}>
                  <img src={abs(p.image_url)} alt="" className={`w-full h-full group-hover:scale-[1.03] transition-transform duration-300 ${p.owned ? 'object-contain p-1.5' : 'object-cover object-top'}`} />
                </button>
                <button aria-label={`Swap the ${catName(p.category)}`} title="Swap this piece" data-testid={`swap-${slot}`} onClick={() => e.setSwap({ lookId: look.id, slot })}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/95 shadow-sm inline-flex items-center justify-center"><RefreshCw size={11} strokeWidth={2} /></button>
                {p.owned ? <span className="absolute bottom-1.5 left-1.5 h-5 px-2 rounded-full bg-ink text-white text-[9px] font-semibold uppercase tracking-[0.06em] inline-flex items-center" data-testid="piece-owned">Yours</span>
                  : <a href={p.product_url} target="_top" aria-label={`Open ${pieceName(p)}`} title="Open the product page"
                    className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-white/95 shadow-sm inline-flex items-center justify-center"><ArrowUpRight size={12} strokeWidth={2} /></a>}
              </div>
              <p className="text-[11px] font-medium leading-snug line-clamp-2">{p.title}</p>
              <p className="num text-[11px] text-muted">{p.owned ? 'In your wardrobe' : inr(p.price)}</p>
            </div>
          ))}
        </div>
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3.5">
        <p className="text-[14px]">
          Total: <span className="num font-semibold" data-testid="look-total">{inr(look.total)}</span>
          {!!look.over_budget_by && <span className="num block text-[11px] text-accent">{inr(look.over_budget_by)} over budget</span>}
          {look.items.some((i) => i.product.owned) && <span className="block text-[11px] text-muted">+ {look.items.filter((i) => i.product.owned).length} from your wardrobe</span>}
        </p>
        <div className="flex items-center gap-1.5">
          {r.status === 'ready' && (
            <IconBtn label={look.video.status === 'ready' ? (video ? 'Show the photo' : 'Play the video') : 'See it move'} testid="see-it-move" onClick={onVideo} active={video && look.video.status === 'ready'}>
              {look.video.status === 'ready' && !video ? <Play size={14} strokeWidth={1.75} /> : <Film size={14} strokeWidth={1.75} />}
            </IconBtn>
          )}
          <IconBtn label="Share with Crew" testid="share-crew" onClick={() => e.shareLook(look.id)}><Users size={14} strokeWidth={1.75} /></IconBtn>
          <IconBtn label="Open viewer" testid="open-viewer" onClick={() => e.setViewer(look.id)}><Maximize2 size={14} strokeWidth={1.75} /></IconBtn>
          {(r.status === 'idle' || (r.status === 'failed' && r.code !== 'minor')) && (
            <button data-testid="look-try-on" onClick={() => e.renderLook(look.id)} className="h-9 px-3.5 rounded-full border border-line text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-surface"><ScanFace size={14} strokeWidth={1.75} /> Try on</button>
          )}
          <AddLookButton look={look} />
        </div>
      </footer>
    </article>
  )
}

function Composer({ inputRef, onSend, focusLook }: { inputRef: React.RefObject<HTMLTextAreaElement>; onSend: (s: string) => void; focusLook: Look | null }) {
  const e = useElara()
  const [v, setV] = useState('')
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(120, el.scrollHeight) + 'px'
  }, [v, inputRef])
  const go = () => {
    if (!v.trim() || e.busy) return
    onSend(v)
    setV('')
  }
  return (
    <div className="shrink-0 px-4 sm:px-5 pt-2 pb-2 bg-white">
      {focusLook && (
        <div className="mb-2 flex items-center gap-2 text-[12px]" data-testid="focus-chip">
          <span className="text-muted">Editing</span>
          <span className="h-7 pl-3 pr-1.5 rounded-full bg-surface inline-flex items-center gap-1.5 font-medium">
            {focusLook.name}
            <button aria-label="Stop editing this look" onClick={() => e.setFocusLookId(null)} className="w-5 h-5 rounded-full inline-flex items-center justify-center hover:bg-white"><X size={12} /></button>
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
          placeholder={focusLook ? `Change something about ${focusLook.name}` : 'What are you looking for?'}
          onChange={(ev) => setV(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); go() } }}
          className="flex-1 resize-none bg-transparent outline-none text-[14px] leading-6 py-2 max-h-[120px] placeholder:text-muted"
        />
        <button
          aria-label="Send message"
          data-testid="composer-send"
          disabled={!v.trim() || e.busy}
          onClick={go}
          className={`w-9 h-9 mb-0.5 rounded-full inline-flex items-center justify-center shrink-0 transition-colors ${v.trim() && !e.busy ? 'bg-ink text-white' : 'bg-surface text-muted'}`}
        >
          {e.busy ? <span className="w-4 h-4 rounded-full border-2 border-line border-t-ink spin" /> : <SendHorizontal size={16} strokeWidth={1.75} />}
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
    <div className="shrink-0 px-4 sm:px-5 pb-1 pop-in">
      <div className="rounded-2xl border border-line bg-white shadow-[0_8px_30px_rgba(0,0,0,.08)] overflow-hidden" data-testid="clarify-card" role="group" aria-label={q.question}>
        <div className="px-4 py-3.5 flex items-center gap-3 border-b border-line">
          <p className="flex-1 text-[15px] font-semibold leading-5" data-testid="clarify-question">{q.question}</p>
          {n > 1 && (
            <span className="num text-[13px] text-muted inline-flex items-center gap-1 shrink-0">
              <button aria-label="Previous question" disabled={i === 0} onClick={() => setI(i - 1)} className="disabled:opacity-30"><ChevronLeft size={15} /></button>
              {i + 1} of {n}
              <button aria-label="Next question" disabled={i === n - 1} onClick={() => setI(i + 1)} className="disabled:opacity-30"><ChevronRight size={15} /></button>
            </span>
          )}
        </div>
        <div className="p-1.5 fade-in" key={i}>
          {q.options.map((o, k) => (
            <button key={o.value + k} data-testid="clarify-option" onClick={() => choose(o)}
              className={`w-full h-12 px-2.5 rounded-xl flex items-center gap-3 text-[15px] text-left transition-colors hover:bg-surface ${picks[i]?.value === o.value ? 'bg-surface ring-1 ring-ink' : ''}`}>
              <span className="num w-7 h-7 rounded-full bg-surface text-[12px] text-muted inline-flex items-center justify-center shrink-0">{k + 1}</span>
              {o.label}
            </button>
          ))}
          <div className="h-12 px-2.5 flex items-center gap-3">
            <span className="w-7 h-7 rounded-full bg-surface text-muted inline-flex items-center justify-center shrink-0"><Pencil size={12} strokeWidth={1.75} /></span>
            {other ? (
              <input autoFocus value={txt} onChange={(ev) => setTxt(ev.target.value)} placeholder="Type your answer" data-testid="clarify-else-input" maxLength={80}
                onKeyDown={(ev) => { if (ev.key === 'Enter' && txt.trim()) choose({ label: txt.trim(), value: txt.trim() }); if (ev.key === 'Escape') setOther(false) }}
                className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted" />
            ) : (
              <button data-testid="clarify-else" onClick={() => setOther(true)} className="flex-1 text-left text-[15px] text-muted hover:text-ink">Something else</button>
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
    e.addToCart([{ product_id: p.id, title: p.title, price: p.price, image_url: p.image_url, size: p.sizes_in_stock.includes('M') ? 'M' : p.sizes_in_stock[0], styled_with: 'Ava' }])
    setAdded(p.id); setTimeout(() => setAdded(null), 1800)
  }
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 max-w-[640px]" data-testid="product-grid">
      {cards.map(({ product: p, match }) => (
        <article key={p.id} data-testid="grid-card">
          <div className="relative aspect-[3/4] bg-surface overflow-hidden rounded-xl">
            <img src={abs(p.image_url)} alt={p.title} className="w-full h-full object-cover object-top" loading="lazy" />
            {match != null && match >= 70 && <span className="absolute top-2.5 left-2.5 text-[10px] font-semibold uppercase tracking-[0.06em] bg-white rounded-full px-2.5 py-1" title="How closely it matches your Style DNA">{match}% your style</span>}
            {WEARABLE.has(p.slot) && (
              <button aria-label={`See the ${pieceName(p)} on you`} title="Try it on" data-testid="product-tryon" onClick={() => e.setTryon({ kind: 'items', products: [p] })}
                className="absolute bottom-2.5 left-2.5 w-8 h-8 rounded-full bg-white shadow-sm inline-flex items-center justify-center"><ScanFace size={15} strokeWidth={1.75} /></button>
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
              className={`w-8 h-8 shrink-0 rounded-full border inline-flex items-center justify-center transition-colors ${added === p.id ? 'bg-ok border-ok text-white' : 'border-line hover:border-ink'}`}>
              {added === p.id ? <Check size={14} strokeWidth={2.5} /> : <ShoppingBag size={14} strokeWidth={1.75} />}
            </button>
          </div>
          {WEARABLE.has(p.slot) && (
            <button data-testid="product-style" disabled={e.busy} onClick={() => e.send(`Build a complete look around the ${p.title}`)}
              className="mt-1.5 text-[12px] text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50">Build a look with this</button>
          )}
        </article>
      ))}
    </div>
  )
}
