import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, Film, Maximize2, RefreshCw, Users, X, Play } from 'lucide-react'
import type { Look } from '../shared/types'
import { inr, catName } from '../shared/format'
import { abs } from './api'
import { useElara, type Msg } from './state'
import { Collage, RevealImg, Ring, ScoreBadge, Silhouette, lookAlt, pieceName } from './ui'

const PROMPTS = [
  'Goa beach trip, under ₹7,000',
  'Make the first look more formal',
  'A farewell outfit for my brother',
  'Show me something in blue',
  'What goes with wide linen trousers?',
  'Something for a sangeet, not too heavy',
]

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
  const send = (text: string) => {
    stick.current = true
    e.send(text, { lookId: e.focusLookId })
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="chat">
      <div
        ref={listRef}
        onScroll={(ev) => { const el = ev.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }}
        className="flex-1 min-h-0 overflow-y-auto thin-scroll px-4 sm:px-6 pt-6 pb-4 space-y-7"
        aria-live="polite"
      >
        {e.messages.length === 0 && <Empty onPick={send} />}
        {e.messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end fade-in">
              <p className="max-w-[80%] bg-ink text-white text-[15px] leading-[22px] px-4 py-2.5 rounded-[20px] rounded-br-[6px] whitespace-pre-wrap" data-testid="user-msg">{m.text}</p>
            </div>
          ) : (
            <AgentMsg key={m.id} m={m} last={i === e.messages.length - 1} onChip={send} onElse={() => inputRef.current?.focus()} />
          ),
        )}
      </div>
      <Composer inputRef={inputRef} onSend={send} focusLook={focusLook} />
    </div>
  )
}

function Empty({ onPick }: { onPick: (s: string) => void }) {
  const e = useElara()
  const occ = e.brief?.occasion
  const ideas = [occ ? `Show me looks for the ${occ.toLowerCase()}` : null, 'Something for a wedding', 'Office, but relaxed', 'A date night look under ₹5,000'].filter(Boolean) as string[]
  return (
    <div className="pt-6 fade-in">
      <p className="label text-muted">Ava</p>
      <p className="font-serif text-[34px] leading-[1.05] mt-2">Tell me where you’re going. I’ll dress you for it.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {ideas.map((s) => (
          <button key={s} onClick={() => onPick(s)} className="h-9 px-4 rounded-full border border-line text-[14px] hover:border-ink transition-colors">{s}</button>
        ))}
      </div>
    </div>
  )
}

function Status({ m }: { m: Msg }) {
  const [open, setOpen] = useState(false)
  const lines = m.statuses ?? []
  if (!lines.length) return m.streaming && !m.text ? <p className="text-[14px] text-muted flex items-center gap-2"><Ring done={false} /> Reading your message</p> : null
  if (!m.streaming && !open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[13px] text-muted inline-flex items-center gap-1.5 hover:text-ink" data-testid="status-done">
        <Check size={14} strokeWidth={2.5} className="text-ok" /> <span className="num">Done in {(m.doneIn ?? 0).toFixed(1)}s</span>
        <ChevronDown size={13} />
      </button>
    )
  }
  return (
    <ul className="space-y-2" data-testid="status-list">
      {lines.map((s) => (
        <li key={s.id} className={`flex items-center gap-2.5 text-[14px] num ${s.state === 'done' ? 'text-ink' : 'text-muted'}`}>
          <Ring done={s.state === 'done'} /> {s.label}
        </li>
      ))}
    </ul>
  )
}

function AgentMsg({ m, last, onChip, onElse }: { m: Msg; last: boolean; onChip: (s: string) => void; onElse: () => void }) {
  const e = useElara()
  const showChips = m.clarify && last && !e.busy
  return (
    <div className="fade-in" data-testid="agent-msg">
      <p className="label text-muted mb-2">Ava</p>
      <div className="space-y-3">
        <Status m={m} />
        {m.text && <p className="text-[16px] leading-[26px] whitespace-pre-wrap" data-testid="agent-text">{m.text}</p>}
        {m.clarify?.question && !m.text.includes(m.clarify.question) && <p className="text-[16px] leading-[26px]">{m.clarify.question}</p>}
        {showChips && (
          <div className="flex flex-wrap gap-2 pt-1" data-testid="clarify-chips">
            {m.clarify!.chips.map((c) => (
              <button key={c} onClick={() => onChip(c)} className="h-9 px-4 rounded-full border border-ink text-[14px] hover:bg-ink hover:text-white transition-colors">{c}</button>
            ))}
            <button onClick={onElse} className="h-9 px-4 rounded-full border border-line text-[14px] text-muted hover:border-ink hover:text-ink transition-colors">Something else…</button>
          </div>
        )}
        {m.error && (
          <div className="rounded-[14px] bg-surface px-4 py-3 flex items-center gap-3 text-[14px]" role="alert" data-testid="chat-error">
            <span className="flex-1">{m.error}</span>
            {m.retry && last && <button className="h-8 px-4 rounded-full bg-ink text-white text-[13px] font-medium" onClick={() => e.send(m.retry!.message, { lookId: m.retry!.lookId })}>Try again</button>}
          </div>
        )}
      </div>
      {!!m.lookIds?.length && (
        <div className="mt-5 space-y-5">
          {m.lookIds.map((id, i) => e.looks[id] && <LookCard key={id} look={e.looks[id]} n={i + 1} />)}
        </div>
      )}
    </div>
  )
}

export function AddLookButton({ look, verdict, className = '' }: { look: Look; verdict?: string; className?: string }) {
  const e = useElara()
  const [added, setAdded] = useState(false)
  return (
    <button
      data-testid="add-look"
      onClick={() => { e.addLookToCart(look, verdict); setAdded(true); setTimeout(() => setAdded(false), 2000) }}
      className={`h-11 px-5 rounded-full text-[14px] font-medium inline-flex items-center justify-center gap-2 transition-all duration-[240ms] ${added ? 'bg-ok text-white' : 'bg-ink text-white hover:opacity-90'} ${className}`}
    >
      {added ? <><Check size={16} strokeWidth={2.5} /> Added</> : 'Add look to bag'}
    </button>
  )
}

function IconBtn({ label, onClick, children, testid, active }: { label: string; onClick: () => void; children: React.ReactNode; testid?: string; active?: boolean }) {
  return (
    <button aria-label={label} title={label} data-testid={testid} onClick={onClick}
      className={`w-11 h-11 rounded-full border inline-flex items-center justify-center transition-colors ${active ? 'bg-ink text-white border-ink' : 'border-line hover:border-ink'}`}>
      {children}
    </button>
  )
}

export function RenderBox({ look, onOpen, video }: { look: Look; onOpen?: () => void; video?: boolean }) {
  const e = useElara()
  const r = look.render
  const products = look.items.map((i) => i.product)
  return (
    <div className="relative aspect-[3/4] bg-surface overflow-hidden" data-testid="render-box" data-render-status={r.status}>
      {r.status === 'ready' && r.image_url ? (
        <>
          <button className="absolute inset-0" onClick={onOpen} aria-label={`Open ${look.name} in the viewer`}>
            <RevealImg src={r.image_url} alt={lookAlt(look)} />
          </button>
          {video && look.video.url && (
            <video src={abs(look.video.url)} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" aria-label={`${look.name}, moving`} />
          )}
          <span className="label absolute top-3 left-3 !text-[10px] bg-white px-2 py-1 pointer-events-none">On you</span>
          {r.cached && <span className="sr-only">Cached render</span>}
        </>
      ) : r.status === 'failed' ? (
        <>
          <Collage products={products} />
          <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-between gap-3" data-testid="render-failed">
            <p className="text-[12px] text-white leading-4">{r.error || 'We couldn’t render this one.'}</p>
            <button onClick={() => e.retryRender(look.id)} data-testid="retry-render" className="shrink-0 h-9 px-4 rounded-full bg-white text-ink text-[13px] font-medium">Retry try-on</button>
          </div>
        </>
      ) : (
        <Silhouette label="Rendering on you… ~15 s" sub={r.steps_total > 1 ? `Layer ${Math.min(r.steps_done + 1, r.steps_total)} of ${r.steps_total}` : undefined} />
      )}
      {look.video.status === 'pending' && (
        <span className="absolute top-3 right-3 h-7 px-3 rounded-full bg-white text-[12px] inline-flex items-center gap-2"><Ring done={false} /> Making it move · a few minutes</span>
      )}
    </div>
  )
}

export function LookCard({ look, n }: { look: Look; n: number }) {
  const e = useElara()
  const [why, setWhy] = useState(false)
  const [video, setVideo] = useState(false)
  const focused = e.focusLookId === look.id
  const products = look.items
  const onVideo = () => {
    if (look.video.status === 'ready') setVideo((v) => !v)
    else if (look.video.status !== 'pending') { e.requestVideo(look.id); setVideo(true) }
  }
  return (
    <article
      data-testid="look-card"
      data-look-id={look.id}
      className={`rounded-[14px] border overflow-hidden bg-white transition-colors ${focused ? 'border-ink' : 'border-line'}`}
      onClickCapture={() => e.setFocusLookId(look.id)}
    >
      <header className="px-4 py-3 flex items-center justify-between gap-3">
        <h4 className="font-serif text-[24px] leading-tight truncate"><span className="num text-muted">{n}</span> · <span data-testid="look-name">{look.name}</span></h4>
        <ScoreBadge score={look.score} band={look.score_band} />
      </header>
      <RenderBox look={look} onOpen={() => e.setViewer(look.id)} video={video && look.video.status === 'ready'} />
      <ul className="px-4 divide-y divide-line">
        {products.map(({ slot, product: p }) => (
          <li key={slot + p.id} className="py-3 flex items-center gap-3" data-testid="piece-row">
            <img src={abs(p.image_url)} alt="" className="w-12 h-16 object-cover object-top bg-surface shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] leading-5 truncate">{pieceName(p)}</p>
              <p className="text-[12px] text-muted truncate">{p.title.split(' - ')[1] ?? catName(p.category)}</p>
            </div>
            <span className="num text-[14px]">{inr(p.price)}</span>
            {['top', 'bottom', 'one_piece', 'layer'].includes(slot) && (
              <button aria-label={`Swap the ${catName(p.category)}`} title="Swap this piece" data-testid={`swap-${slot}`} onClick={() => e.setSwap({ lookId: look.id, slot })}
                className="w-9 h-9 -mr-2 rounded-full inline-flex items-center justify-center hover:bg-surface"><RefreshCw size={16} strokeWidth={1.5} /></button>
            )}
          </li>
        ))}
      </ul>
      <div className="px-4 py-3 border-t border-line flex items-baseline justify-between">
        <span className="text-[14px] text-muted">Total</span>
        <span className="text-right">
          <span className="num text-[16px] font-medium" data-testid="look-total">{inr(look.total)}</span>
          {!!look.over_budget_by && <span className="num block text-[12px] text-accent">{inr(look.over_budget_by)} over budget</span>}
        </span>
      </div>
      <div className="border-t border-line">
        <button className="w-full h-11 px-4 flex items-center justify-between text-[14px]" aria-expanded={why} onClick={() => setWhy(!why)}>
          Why this works <ChevronDown size={15} strokeWidth={1.5} className={`transition-transform ${why ? 'rotate-180' : ''}`} />
        </button>
        {why && (
          <div className="px-4 pb-4 text-[14px] leading-[22px] text-muted fade-in space-y-2">
            <p>{look.why}</p>
            {look.score_reason && <p className="text-ink/80">{look.score_reason}.</p>}
          </div>
        )}
      </div>
      <footer className="px-4 py-3 border-t border-line flex items-center gap-2">
        <AddLookButton look={look} className="flex-1" />
        <IconBtn label={look.video.status === 'ready' ? (video ? 'Show the photo' : 'Play the video') : 'See it move'} testid="see-it-move" onClick={onVideo} active={video && look.video.status === 'ready'}>
          {look.video.status === 'ready' && !video ? <Play size={16} strokeWidth={1.5} /> : <Film size={16} strokeWidth={1.5} />}
        </IconBtn>
        <IconBtn label="Share with Crew" testid="share-crew" onClick={() => e.shareLook(look.id)}><Users size={16} strokeWidth={1.5} /></IconBtn>
        <IconBtn label="Open viewer" testid="open-viewer" onClick={() => e.setViewer(look.id)}><Maximize2 size={16} strokeWidth={1.5} /></IconBtn>
      </footer>
    </article>
  )
}

function Composer({ inputRef, onSend, focusLook }: { inputRef: React.RefObject<HTMLTextAreaElement>; onSend: (s: string) => void; focusLook: Look | null }) {
  const e = useElara()
  const [v, setV] = useState('')
  const [ph, setPh] = useState(0)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (focused || v) return
    const iv = setInterval(() => setPh((p) => (p + 1) % PROMPTS.length), 3200)
    return () => clearInterval(iv)
  }, [focused, v])
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
    <div className="shrink-0 px-4 sm:px-6 pt-2 pb-3 bg-white">
      {focusLook && (
        <div className="mb-2 flex items-center gap-2 text-[12px]" data-testid="focus-chip">
          <span className="text-muted">Editing</span>
          <span className="h-7 pl-3 pr-1.5 rounded-full bg-surface inline-flex items-center gap-1.5 font-medium">
            {focusLook.name}
            <button aria-label="Stop editing this look" onClick={() => e.setFocusLookId(null)} className="w-5 h-5 rounded-full inline-flex items-center justify-center hover:bg-white"><X size={12} /></button>
          </span>
        </div>
      )}
      <div className="min-h-14 rounded-[28px] border border-line focus-within:border-ink transition-colors flex items-end gap-2 pl-5 pr-2 py-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={v}
          data-testid="composer-input"
          aria-label="Message Ava"
          placeholder={focusLook ? `Change something about ${focusLook.name}` : PROMPTS[ph]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(ev) => setV(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); go() } }}
          className="flex-1 resize-none bg-transparent outline-none text-[16px] leading-6 py-2 max-h-[120px] placeholder:text-muted/80"
        />
        <button
          aria-label="Send"
          data-testid="composer-send"
          disabled={!v.trim() || e.busy}
          onClick={go}
          className="w-10 h-10 rounded-full bg-ink text-white inline-flex items-center justify-center shrink-0 disabled:bg-line disabled:text-muted transition-colors"
        >
          {e.busy ? <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" /> : <ArrowUp size={18} strokeWidth={2} />}
        </button>
      </div>
    </div>
  )
}
