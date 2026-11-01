import { useRef, useState } from 'react'
import { Check, Download, ImageUp, Link2, MessageCircle, Plus, RefreshCw, Send, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { Crew, CrewLook, Slot } from '../shared/types'
import { inr, catName } from '../shared/format'
import { abs, ApiError } from './api'
import { useElara } from './state'
import { AddLookButton } from './Chat'
import { Initials, Ring, ScoreBadge, Sheet, lookAlt, pieceName } from './ui'

// The link opens the store that embeds this widget, wherever that is.
const shareUrl = (c: Crew) => `${location.origin}/?crew=${c.id}`

export function CrewTab() {
  const e = useElara()
  if (!e.crewId) return <CrewEmpty />
  if (!e.crew) {
    return e.crewError ? (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="font-serif text-[26px]">Your crew didn’t load.</p>
        <button className="h-10 px-5 rounded-full border border-ink text-[14px]" onClick={() => e.loadCrew()}>Try again</button>
      </div>
    ) : (
      <div className="flex-1 p-6 space-y-4"><div className="h-8 w-1/2 skeleton" /><div className="h-10 w-1/3 skeleton rounded-full" /><div className="aspect-[4/3] skeleton rounded-[14px]" /></div>
    )
  }
  if (!e.crew.members.some((m) => m.is_you)) return <Join crew={e.crew} />
  return <CrewView crew={e.crew} />
}

function CrewEmpty() {
  const e = useElara()
  const latest = Object.values(e.looks).at(-1)
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-10 text-center" data-testid="crew-empty">
      <div className="flex -space-x-3 mb-8" aria-hidden>
        {['#E7F2EA', '#F1EEE8', '#FBEADC'].map((c, i) => <span key={i} className="w-14 h-14 rounded-full ring-4 ring-white" style={{ background: c }} />)}
      </div>
      <p className="font-serif text-[32px] leading-[1.1]">Style is better argued. Invite two friends.</p>
      <p className="mt-3 text-[14px] text-muted max-w-[300px]">Share a look and your crew can react to each piece, see it on themselves and vote.</p>
      {latest ? (
        <button className="mt-7 h-11 px-6 rounded-full bg-ink text-white text-[14px] font-medium" data-testid="crew-share-latest" onClick={() => e.shareLook(latest.id)}>Share “{latest.name}”</button>
      ) : (
        <button className="mt-7 h-11 px-6 rounded-full bg-ink text-white text-[14px] font-medium" onClick={() => e.setTab('chat')}>Find a look first</button>
      )}
    </div>
  )
}

function Join({ crew }: { crew: Crew }) {
  const e = useElara()
  const owner = crew.members.find((m) => m.is_owner)
  const [name, setName] = useState('')
  const [model, setModel] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const join = async () => {
    if (!name.trim()) return
    setBusy(true)
    setErr('')
    try {
      await e.joinCrew(crew.id, name.trim(), file ? { file } : model ? { sample_model_id: model } : {})
    } catch (x) { setErr((x as ApiError).message) } finally { setBusy(false) }
  }
  const first = crew.looks[0]?.look
  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll px-6 py-6 fade-in" data-testid="crew-join">
      <p className="label text-accent">Style Crew</p>
      <h2 className="font-serif text-[36px] leading-[1.05] mt-2">{owner?.display_name ?? 'A friend'} wants your take on {crew.name}.</h2>
      {crew.occasion && <p className="mt-2 text-[14px] text-muted">For {crew.occasion.toLowerCase()} · {crew.looks.length} {crew.looks.length === 1 ? 'look' : 'looks'} to vote on</p>}
      {first && (
        <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar">
          {crew.looks.slice(0, 4).map(({ look }) => (
            <div key={look.id} className="relative w-28 shrink-0 aspect-[3/4] bg-surface overflow-hidden rounded-[10px]">
              {look.render.image_url ? <img src={abs(look.render.image_url)} alt={lookAlt(look)} className="w-full h-full object-cover object-top" /> : <img src={abs(look.items[0]?.product.image_url)} alt="" className="w-full h-full object-cover object-top" />}
            </div>
          ))}
        </div>
      )}
      <label className="block mt-7">
        <span className="label text-muted">Your name</span>
        <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="How your crew knows you" data-testid="crew-name-input" maxLength={40}
          onKeyDown={(ev) => ev.key === 'Enter' && join()}
          className="mt-2 w-full h-11 px-4 rounded-[10px] border border-line text-[15px] outline-none focus:border-ink" />
      </label>
      <div className="mt-6">
        <p className="label text-muted">See these looks on you <span className="normal-case tracking-normal">(optional)</span></p>
        <div className="mt-3 grid grid-cols-5 gap-2">
          <button onClick={() => fileRef.current?.click()} className={`aspect-[3/4] rounded-[10px] border-[1.5px] border-dashed flex flex-col items-center justify-center gap-1 text-[11px] text-muted overflow-hidden relative ${file ? 'border-ink' : 'border-line'}`}>
            {file ? <img src={URL.createObjectURL(file)} alt="Your photo" className="absolute inset-0 w-full h-full object-cover object-top" /> : <><ImageUp size={16} strokeWidth={1.5} />Upload</>}
          </button>
          {(e.models ?? []).slice(0, 4).map((m) => (
            <button key={m.id} onClick={() => { setModel(model === m.id ? null : m.id); setFile(null) }} aria-pressed={model === m.id} aria-label={`Use ${m.label}`}
              className={`aspect-[3/4] rounded-[10px] overflow-hidden bg-surface ${model === m.id ? 'ring-2 ring-ink ring-offset-2' : ''}`}>
              <img src={abs(m.image_url)} alt="" className="w-full h-full object-cover object-top" />
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) { setFile(f); setModel(null) } }} />
      </div>
      {err && <p className="mt-4 text-[13px] text-accent" role="alert">{err}</p>}
      <button data-testid="crew-join-btn" disabled={!name.trim() || busy} onClick={join}
        className="mt-7 w-full h-[52px] rounded-full bg-ink text-white text-[15px] font-medium disabled:bg-line disabled:text-muted">
        {busy ? 'Joining…' : file || model ? 'Join and see it on you' : 'Join the crew'}
      </button>
      <p className="mt-3 text-[12px] text-center text-muted">No account needed. Your photo is only used to show you these looks.</p>
    </div>
  )
}

function CrewView({ crew }: { crew: Crew }) {
  const e = useElara()
  const me = crew.members.find((m) => m.is_you)
  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll" data-testid="crew-view">
      <div className="px-6 pt-6 pb-5 border-b border-line">
        <p className="label text-accent">Style Crew{crew.occasion ? ` · ${crew.occasion}` : ''}</p>
        <h2 className="font-serif text-[34px] leading-[1.05] mt-1.5" data-testid="crew-title">{crew.name}</h2>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex -space-x-2">
            {crew.members.slice(0, 6).map((m) => <span key={m.id} title={m.display_name}><Initials name={m.display_name} src={m.avatar_url} ring /></span>)}
          </div>
          <button aria-label="Invite to crew" onClick={() => crew.looks[0] && e.setShare({ lookId: crew.looks[0].look.id })}
            className="w-8 h-8 rounded-full border-[1.5px] border-dashed border-muted/60 inline-flex items-center justify-center hover:border-ink" data-testid="crew-invite"><Plus size={14} /></button>
          <span className="text-[13px] text-muted">{crew.members.map((m) => (m.is_you ? 'You' : m.display_name)).join(', ')}</span>
        </div>
      </div>
      {crew.looks.length === 0 ? (
        <div className="py-16 text-center px-8"><p className="font-serif text-[26px]">No looks shared yet.</p><button className="mt-4 h-10 px-5 rounded-full border border-ink text-[14px]" onClick={() => e.setTab('chat')}>Find one in Chat</button></div>
      ) : (
        <div className="px-4 sm:px-6 py-5 space-y-6">
          {crew.looks.map((cl) => <CrewLookCard key={cl.look.id} cl={cl} crew={crew} meId={me?.id} isOwner={!!me?.is_owner} />)}
        </div>
      )}
    </div>
  )
}

function CrewLookCard({ cl, crew, meId, isOwner }: { cl: CrewLook; crew: Crew; meId?: string; isOwner: boolean }) {
  const e = useElara()
  const { look } = cl
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const owner = crew.members.find((m) => m.is_owner)
  const strip = [
    ...(look.render.image_url || !cl.renders.length ? [{ member_id: owner?.id ?? 'owner', status: look.render.status, image_url: look.render.image_url }] : []),
    ...cl.renders.filter((r) => r.member_id !== owner?.id),
  ]
  const nameOf = (id: string) => { const m = crew.members.find((x) => x.id === id); return m ? (m.is_you ? 'You' : m.display_name) : 'Crew' }
  const mine = (slot: string, reaction: string) => crew.comments.some((c) => c.look_id === look.id && c.slot === slot && c.member_id === meId && c.reaction === reaction)
  const v = cl.verdict
  const pct = v.voters ? (v.up / Math.max(1, v.up + v.down)) * 100 : 0

  const sendDraft = async (slot: string) => {
    if (!draft.trim()) return
    const t = draft.trim()
    setDraft('')
    await e.comment(look.id, slot, { text: t })
  }

  return (
    <article className="rounded-[14px] border border-line overflow-hidden" data-testid="crew-look">
      <header className="px-4 py-3 flex items-center justify-between gap-3">
        <h4 className="font-serif text-[24px] leading-tight truncate">{look.name}</h4>
        <ScoreBadge score={look.score} band={look.score_band} countUp={false} />
      </header>
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 pb-3" aria-label="This look on each member">
        {strip.map((r) => (
          <figure key={r.member_id} className="shrink-0 w-[132px]">
            <div className="relative aspect-[3/4] bg-surface overflow-hidden rounded-[8px]">
              {r.image_url ? (
                <button className="absolute inset-0" onClick={() => e.setViewer(look.id)} aria-label={`Open ${look.name}`}>
                  <img src={abs(r.image_url)} alt={`${nameOf(r.member_id)} wearing ${look.name}`} className="w-full h-full object-cover object-top reveal" />
                </button>
              ) : r.status === 'failed' ? (
                <img src={abs(look.items[0]?.product.image_url)} alt="" className="w-full h-full object-cover object-top opacity-80" />
              ) : (
                <div className="absolute inset-0 skeleton flex items-end justify-center pb-3"><span className="text-[11px] text-muted flex items-center gap-1.5"><Ring done={false} />Rendering</span></div>
              )}
            </div>
            <figcaption className="mt-1.5 text-[12px] text-muted truncate">On {nameOf(r.member_id) === 'You' ? 'you' : nameOf(r.member_id)}</figcaption>
          </figure>
        ))}
      </div>
      <ul className="border-t border-line divide-y divide-line">
        {look.items.map(({ slot, product: p }) => {
          const sc = cl.slot_counts[slot] ?? { up: 0, down: 0, swap: 0, comments: 0 }
          const thread = crew.comments.filter((c) => c.look_id === look.id && c.slot === slot && c.text)
          const isOpen = open === slot
          return (
            <li key={slot} data-testid={`crew-piece-${slot}`}>
              <div className="px-4 py-3 flex items-center gap-3">
                <img src={abs(p.image_url)} alt="" className="w-10 h-[54px] object-cover object-top bg-surface shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] leading-5 truncate">{pieceName(p)}</p>
                  <p className="num text-[12px] text-muted">{inr(p.price)}</p>
                </div>
                <div className="flex items-center gap-1">
                  {([['up', ThumbsUp, sc.up, 'Love it'], ['down', ThumbsDown, sc.down, 'Not this'], ['swap', RefreshCw, sc.swap, 'Swap it']] as const).map(([k, Icon, n, label]) => (
                    <button key={k} aria-label={`${label}: ${catName(p.category)}`} aria-pressed={mine(slot, k)} data-testid={`react-${k}-${slot}`} onClick={() => e.comment(look.id, slot as Slot, { reaction: k })}
                      className={`h-8 min-w-8 px-2 rounded-full inline-flex items-center justify-center gap-1 text-[12px] num transition-colors ${mine(slot, k) ? 'bg-ink text-white' : 'hover:bg-surface text-muted'}`}>
                      <Icon size={14} strokeWidth={1.75} />{n > 0 && n}
                    </button>
                  ))}
                  <button aria-label={`Comments on the ${catName(p.category)}`} aria-expanded={isOpen} data-testid={`thread-${slot}`} onClick={() => setOpen(isOpen ? null : slot)}
                    className={`relative h-8 min-w-8 px-2 rounded-full inline-flex items-center justify-center gap-1 text-[12px] num ${isOpen ? 'bg-surface text-ink' : 'text-muted hover:bg-surface'}`}>
                    <MessageCircle size={14} strokeWidth={1.75} />{sc.comments > 0 && <span className="text-ink font-medium">{sc.comments}</span>}
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className="px-4 pb-4 fade-in" data-testid={`thread-body-${slot}`}>
                  {thread.length === 0 ? <p className="text-[13px] text-muted pb-2">No comments on this piece yet.</p> : (
                    <ul className="space-y-2.5 pb-3">
                      {thread.map((c) => (
                        <li key={c.id} className="flex gap-2.5 text-[14px] leading-5">
                          <Initials name={c.display_name} size={24} />
                          <p><span className="font-medium">{c.member_id === meId ? 'You' : c.display_name}</span> <span className="text-ink/85">{c.text}</span></p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-2 h-10 pl-4 pr-1 rounded-full border border-line focus-within:border-ink">
                    <input value={draft} onChange={(ev) => setDraft(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && sendDraft(slot)} placeholder={`Say something about the ${catName(p.category)}`} aria-label="Reply"
                      data-testid={`reply-${slot}`} className="flex-1 bg-transparent outline-none text-[14px]" />
                    <button aria-label="Send comment" onClick={() => sendDraft(slot)} disabled={!draft.trim()} className="w-8 h-8 rounded-full bg-ink text-white inline-flex items-center justify-center disabled:bg-line"><Send size={13} /></button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="px-4 py-3 border-t border-line" data-testid="verdict">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-medium">{v.label || 'No votes yet'}</span>
          <span className="num text-muted">{inr(look.total)}</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-surface overflow-hidden"><div className="h-full bg-ok transition-all duration-500" style={{ width: `${pct}%` }} /></div>
      </div>
      <footer className="px-4 py-3 border-t border-line flex gap-2">
        <AddLookButton look={look} verdict={v.label || undefined} className="flex-1" />
        {isOwner && (
          <button onClick={() => { e.setTab('chat'); e.send('What did my crew think?', { lookId: look.id }) }} className="h-11 px-4 rounded-full border border-line text-[13px] font-medium hover:border-ink">Ask Ava</button>
        )}
      </footer>
    </article>
  )
}

export function ShareSheet() {
  const e = useElara()
  const { lookId } = e.share!
  const crew = e.crew
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState(false)
  const look = e.looks[lookId] ?? crew?.looks.find((l) => l.look.id === lookId)?.look
  if (!crew) return null
  const link = shareUrl(crew)
  const img = abs(`/api/crews/${crew.id}/share.png?look_id=${lookId}&format=square`)
  const text = `Help me pick: ${look?.name ?? 'my look'} for ${crew.occasion || 'the trip'}. Vote on each piece here:`
  return (
    <Sheet title="Share with your crew" onClose={() => e.setShare(null)} height="78%" testid="share-sheet">
      <div className="relative aspect-square bg-surface rounded-[14px] overflow-hidden">
        {!loaded && <div className="absolute inset-0 skeleton flex items-center justify-center"><span className="text-[13px] text-muted flex items-center gap-2"><Ring done={false} /> Making your share card</span></div>}
        <img src={img} alt={`Share card for ${look?.name ?? 'this look'}`} onLoad={() => setLoaded(true)} data-testid="share-preview" className={`w-full h-full object-cover ${loaded ? 'reveal' : 'opacity-0'}`} />
      </div>
      <div className="mt-5 divide-y divide-line border-y border-line">
        <a href={`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`} target="_blank" rel="noreferrer" className="h-14 flex items-center gap-3 text-[15px] hover:bg-surface -mx-2 px-2 rounded-[10px]" data-testid="share-whatsapp">
          <span className="w-9 h-9 rounded-full bg-[#E7F2EA] text-[#1F5C3A] inline-flex items-center justify-center"><MessageCircle size={16} /></span> WhatsApp
        </a>
        <button onClick={() => { navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }, () => {}) }}
          className="w-full h-14 flex items-center gap-3 text-[15px] hover:bg-surface -mx-2 px-2 rounded-[10px]" data-testid="share-copy">
          <span className="w-9 h-9 rounded-full bg-surface inline-flex items-center justify-center">{copied ? <Check size={16} /> : <Link2 size={16} />}</span>
          {copied ? 'Link copied' : 'Copy link'}
          <span className="ml-auto text-[12px] text-muted truncate max-w-[45%]" data-testid="share-link">{link.replace(/^https?:\/\//, '')}</span>
        </button>
        <a href={img} download={`${look?.name ?? 'look'}.png`} className="h-14 flex items-center gap-3 text-[15px] hover:bg-surface -mx-2 px-2 rounded-[10px]">
          <span className="w-9 h-9 rounded-full bg-surface inline-flex items-center justify-center"><Download size={16} /></span> Download image
        </a>
      </div>
      <button className="mt-5 mb-2 w-full h-11 rounded-full border border-ink text-[14px] font-medium" onClick={() => { e.setShare(null); e.setViewer(null); e.setTab('crew') }}>Open the crew</button>
    </Sheet>
  )
}
