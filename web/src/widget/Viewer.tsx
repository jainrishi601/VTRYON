import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronsLeftRight, Download, Film, Users } from 'lucide-react'
import type { Alternative, Look } from '../shared/types'
import { inr, signedInr, catName } from '../shared/format'
import { abs, api, ApiError } from './api'
import { useElara, TERMINAL } from './state'
import { AddLookButton } from './Chat'
import { Collage, RenderProgress, RevealImg, Ring, ScoreBadge, Sheet, lookAlt, pieceName } from './ui'

const HOTSPOT: Record<string, [number, number]> = { layer: [30, 38], top: [60, 32], one_piece: [62, 42], bottom: [57, 70] }
const REGION: Record<string, [number, number]> = { top: [14, 56], layer: [14, 60], bottom: [48, 100], one_piece: [12, 100] }

export function Viewer() {
  const e = useElara()
  const look = e.viewer ? e.looks[e.viewer] : null
  const [chain, setChain] = useState<Look[]>([])
  const [pos, setPos] = useState(50)
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  // Walk the parent chain for the history strip.
  useEffect(() => {
    if (!look) return
    let live = true
    ;(async () => {
      const out: Look[] = [look]
      let cur = look
      while (cur.parent_look_id && out.length < 12) {
        try { cur = await e.fetchLook(cur.parent_look_id) } catch { break }
        out.unshift(cur)
      }
      if (live) setChain(out)
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look?.id, look?.parent_look_id])

  useEffect(() => {
    if (!look && e.viewer) e.fetchLook(e.viewer).catch(() => e.setViewer(null))
  }, [look, e])

  if (!look) {
    return <div className="absolute inset-0 z-30 bg-white flex items-center justify-center"><Ring done={false} /></div>
  }

  const r = look.render
  const parent = look.parent_look_id ? e.looks[look.parent_look_id] : null
  const swapping = !TERMINAL.has(r.status) && parent?.render.status === 'ready' && parent.render.image_url
  const changedSlot = swapping ? look.items.find((i) => !parent!.items.some((p) => p.product.id === i.product.id))?.slot : null
  const ready = r.status === 'ready' && r.image_url
  const before = ready && look.before_url
  const move = (clientX: number) => {
    const b = box.current?.getBoundingClientRect()
    if (b) setPos(Math.max(0, Math.min(100, ((clientX - b.left) / b.width) * 100)))
  }

  return (
    <div className="absolute inset-0 z-30 bg-white flex flex-col fade-in" data-testid="viewer" role="dialog" aria-label={`${look.name} on you`}>
      <div className="h-14 shrink-0 px-4 flex items-center gap-3 border-b border-line">
        <button onClick={() => e.setViewer(null)} aria-label="Back" className="w-9 h-9 -ml-2 rounded-full inline-flex items-center justify-center hover:bg-surface"><ArrowLeft size={18} strokeWidth={1.5} /></button>
        <h3 className="font-serif text-[24px] leading-none truncate flex-1" data-testid="viewer-name">{look.name}</h3>
        <ScoreBadge score={look.score} band={look.score_band} />
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-4 bg-surface/50">
        <div
          ref={box}
          className="relative h-full max-w-full aspect-[3/4] bg-surface overflow-hidden select-none touch-pan-y"
          onPointerDown={(ev) => { if (before && (ev.target as HTMLElement).dataset.handle) { dragging.current = true; (ev.target as HTMLElement).setPointerCapture(ev.pointerId) } }}
          onPointerMove={(ev) => dragging.current && move(ev.clientX)}
          onPointerUp={() => { dragging.current = false }}
        >
          {ready ? (
            <>
              <RevealImg src={r.image_url!} alt={lookAlt(look)} />
              {before && (
                <>
                  <img src={abs(look.before_url!)} alt="Your original photo" className="absolute inset-0 w-full h-full object-cover object-top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
                  <span className="label absolute top-3 left-3 !text-[10px] bg-white px-2 py-1">Before</span>
                  <span className="label absolute top-3 right-3 !text-[10px] bg-ink text-white px-2 py-1">After</span>
                  <div className="absolute inset-y-0 w-[2px] bg-white pointer-events-none" style={{ left: `calc(${pos}% - 1px)` }} />
                  <button
                    data-handle="1"
                    role="slider"
                    aria-label="Before and after"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(pos)}
                    data-testid="ba-handle"
                    onKeyDown={(ev) => {
                      if (ev.key === 'ArrowLeft') { ev.preventDefault(); setPos((p) => Math.max(0, p - 5)) }
                      if (ev.key === 'ArrowRight') { ev.preventDefault(); setPos((p) => Math.min(100, p + 5)) }
                    }}
                    className="absolute top-1/2 w-11 h-11 -ml-[22px] -mt-[22px] rounded-full bg-white shadow-[0_2px_12px_rgba(0,0,0,.2)] inline-flex items-center justify-center cursor-ew-resize touch-none"
                    style={{ left: `${pos}%` }}
                  >
                    <ChevronsLeftRight size={18} strokeWidth={1.5} className="pointer-events-none" />
                  </button>
                </>
              )}
              {look.items.filter((i) => HOTSPOT[i.slot]).map((i) => (
                <button
                  key={i.slot}
                  data-testid={`hotspot-${i.slot}`}
                  aria-label={`Swap the ${catName(i.product.category)}`}
                  onClick={() => e.setSwap({ lookId: look.id, slot: i.slot })}
                  className="group absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full bg-white ring-4 ring-white/40 shadow-[0_1px_6px_rgba(0,0,0,.25)] hover:scale-110 transition-transform"
                  style={{ left: `${HOTSPOT[i.slot][0]}%`, top: `${HOTSPOT[i.slot][1]}%` }}
                >
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 whitespace-nowrap bg-white text-ink text-[12px] px-2.5 py-1 rounded-full shadow opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity pointer-events-none">
                    Swap {pieceName(i.product)}
                  </span>
                </button>
              ))}
            </>
          ) : swapping ? (
            <>
              <img src={abs(parent!.render.image_url!)} alt={lookAlt(parent!)} className="absolute inset-0 w-full h-full object-cover object-top" />
              <div className="absolute inset-x-0 band-shimmer" data-testid="swap-shimmer"
                style={{ top: `${REGION[changedSlot ?? 'one_piece'][0]}%`, bottom: `${100 - REGION[changedSlot ?? 'one_piece'][1]}%` }} />
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 h-8 px-3.5 rounded-full bg-white text-[12px] font-medium inline-flex items-center gap-2 whitespace-nowrap shadow"><Ring done={false} /> Swapping just this piece</span>
            </>
          ) : r.status === 'failed' || r.status === 'idle' ? (
            <>
              <Collage products={look.items.map((i) => i.product)} />
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/60 to-transparent flex items-end gap-3">
                <p className="flex-1 text-[13px] text-white">{r.status === 'idle' ? 'See the whole look on you.' : r.error || 'We couldn’t render this one.'}</p>
                {r.code !== 'minor' && (
                  <button onClick={() => e.renderLook(look.id)} data-testid="viewer-try-on" className="h-9 px-4 rounded-full bg-white text-[13px] font-medium">
                    {r.status === 'idle' || r.code ? 'Try on' : 'Retry try-on'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <RenderProgress look={look} onModel={!!e.session?.sample_model_id} />
          )}
          {look.video.status === 'ready' && look.video.url && (
            <video src={abs(look.video.url)} autoPlay muted loop playsInline controls className="absolute inset-0 w-full h-full object-cover bg-black" />
          )}
        </div>
      </div>

      {chain.length > 1 && (
        <div className="shrink-0 px-4 pt-3 flex gap-2 overflow-x-auto no-scrollbar" data-testid="history-strip" aria-label="Versions of this look">
          {chain.map((c) => e.looks[c.id] ?? c).map((l, i) => (
            <button key={l.id} onClick={() => e.setViewer(l.id)} aria-label={`Version ${i + 1}: ${l.name}`} aria-current={l.id === look.id}
              className={`relative shrink-0 w-14 aspect-[3/4] bg-surface overflow-hidden rounded-[6px] ${l.id === look.id ? 'ring-2 ring-ink ring-offset-2' : 'opacity-70 hover:opacity-100'}`}>
              {l.render.image_url ? <img src={abs(l.render.image_url)} alt="" className="w-full h-full object-cover object-top" /> : <div className="w-full h-full skeleton" />}
            </button>
          ))}
        </div>
      )}

      <div className="shrink-0 px-4 py-3 flex items-center gap-2 pb-safe">
        <div className="flex-1 min-w-0">
          <p className="num text-[13px] text-muted truncate"><span className="hidden sm:inline">{look.items.length} pieces · </span><span className="text-ink font-medium">{inr(look.total)}</span></p>
        </div>
        <button aria-label="Share with Crew" title="Share with Crew" onClick={() => e.shareLook(look.id)} className="w-11 h-11 rounded-full border border-line inline-flex items-center justify-center hover:border-ink"><Users size={16} strokeWidth={1.5} /></button>
        <button aria-label="See it move" title="See it move" onClick={() => look.video.status !== 'pending' && e.requestVideo(look.id)} className="w-11 h-11 rounded-full border border-line inline-flex items-center justify-center hover:border-ink">
          {look.video.status === 'pending' ? <Ring done={false} /> : <Film size={16} strokeWidth={1.5} />}
        </button>
        <a aria-label="Download image" title="Download" href={ready ? abs(r.image_url) : undefined} download={`${look.name}.jpg`} target="_blank" rel="noreferrer"
          className={`w-11 h-11 rounded-full border border-line inline-flex items-center justify-center hover:border-ink ${ready ? '' : 'opacity-40 pointer-events-none'}`}><Download size={16} strokeWidth={1.5} /></a>
        <AddLookButton look={look} />
      </div>
    </div>
  )
}

export function SwapDrawer() {
  const e = useElara()
  const { lookId, slot } = e.swap!
  const look = e.looks[lookId]
  const current = look?.items.find((i) => i.slot === slot)?.product
  const [items, setItems] = useState<Alternative[] | null>(null)
  const [ward, setWard] = useState<{ account: boolean; owned: number }>({ account: false, owned: 0 })
  const [mode, setMode] = useState<'new' | 'mine'>('new')
  const [err, setErr] = useState('')
  const [picking, setPicking] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const gift = e.brief?.for === 'other'

  useEffect(() => {
    let live = true
    setItems(null)
    setErr('')
    api<{ items: Alternative[]; wardrobe?: { account: boolean; owned: number } }>(`/api/looks/${lookId}/alternatives?slot=${slot}`)
      .then((r) => {
        if (!live) return
        setItems(r.items)
        setWard(r.wardrobe ?? { account: false, owned: 0 })
        if (!gift && r.items.length && r.items.every((a) => a.owned)) setMode('mine') // nothing new fits; open on what they own
      }, (x) => live && setErr((x as ApiError).message))
    return () => { live = false }
  }, [lookId, slot, nonce, gift])

  const pick = async (a: Alternative) => {
    setPicking(a.product.id)
    try {
      await e.swapTo(lookId, slot, a.product.id)
      e.setSwap(null)
      if (a.owned) e.showToast(`Swapped in your ${pieceName(a.product)}. The store pieces are tried on; your own piece stays as you wear it.`)
    } catch (x) {
      setErr((x as ApiError).message)
      setPicking(null)
    }
  }
  const what = current ? catName(current.category) : slot.replace('_', '-')
  const shop = (items ?? []).filter((a) => !a.owned)
  const mine = (items ?? []).filter((a) => a.owned)
  const shown = mode === 'mine' ? mine : shop

  const Tile = ({ a }: { a: Alternative }) => (
    <button data-testid={a.owned ? 'swap-tile-owned' : 'swap-tile'} disabled={!!picking} onClick={() => pick(a)} className="text-left group disabled:cursor-wait">
      <div className="relative aspect-[3/4] bg-surface overflow-hidden rounded-xl">
        <img src={abs(a.product.image_url)} alt={a.product.title} className={`w-full h-full group-hover:scale-[1.02] transition-transform duration-300 ${a.owned ? 'object-contain p-3' : 'object-cover object-top'}`} />
        <span className="absolute top-2 left-2"><ScoreBadge score={a.score} band={a.score_band} /></span>
        {a.owned && <span className="absolute bottom-2 left-2 h-6 px-2.5 rounded-full bg-ink text-white text-[10px] font-semibold uppercase tracking-[0.06em] inline-flex items-center">Yours</span>}
        {picking === a.product.id && <div className="absolute inset-0 bg-white/60 flex items-center justify-center"><Ring done={false} /></div>}
      </div>
      <p className="mt-2 text-[14px] leading-5 line-clamp-1">{pieceName(a.product)}</p>
      {a.owned
        ? <p className="num text-[13px] text-muted">In your wardrobe{current ? <span className="text-ok"> · saves {inr(current.price)}</span> : null}</p>
        : <p className="num text-[13px] text-muted">{inr(a.product.price)} <span className={a.price_delta > 0 ? 'text-ink' : 'text-ok'}>· {signedInr(a.price_delta)}</span></p>}
      <p className="mt-1 text-[12px] leading-[17px] text-muted line-clamp-2">{a.reason}</p>
    </button>
  )

  return (
    <Sheet title={`Swap the ${what}`} onClose={() => e.setSwap(null)} testid="swap-drawer">
      {current && <p className="text-[13px] text-muted -mt-1 mb-4">Replacing {pieceName(current)} · <span className="num">{current.owned ? 'yours' : inr(current.price)}</span>. Everything else stays.</p>}
      {!gift && (
        <div className="mb-5 p-1 rounded-full bg-surface grid grid-cols-2 text-[13px] font-semibold" role="tablist" data-testid="swap-modes">
          {([['new', 'Shop new', shop.length], ['mine', 'From your wardrobe', mine.length]] as const).map(([k, l, n]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} data-testid={`swap-mode-${k}`}
              className={`h-9 rounded-full inline-flex items-center justify-center gap-1.5 transition-colors ${mode === k ? 'bg-white shadow-sm text-ink' : 'text-muted hover:text-ink'}`}>
              {l}{items && <span className="num text-[11px] font-medium text-muted">{n}</span>}
            </button>
          ))}
        </div>
      )}
      {err && !items ? (
        <div className="py-10 text-center">
          <p className="font-serif text-[24px]">We couldn’t load swaps.</p>
          <button className="mt-4 h-10 px-5 rounded-full border border-ink text-[14px]" onClick={() => setNonce((n) => n + 1)}>Try again</button>
        </div>
      ) : mode === 'mine' && items && mine.length === 0 ? (
        <div className="py-10 text-center px-4" data-testid="swap-mine-empty">
          <p className="text-[18px] font-semibold">{ward.account ? `Nothing in your wardrobe for the ${what} yet.` : 'Swap with clothes you already own.'}</p>
          <p className="mt-2 text-[14px] text-muted">{ward.account ? 'Add a photo of it in TRYON and it shows up here, scored with the rest of the look.' : 'Add your wardrobe in TRYON and your own pieces show up here, scored with the rest of the look.'}</p>
          <a href={ward.account ? '/tryon/wardrobe' : '/tryon/signup'} target="_top" className="mt-5 inline-flex h-10 px-5 rounded-full bg-ink text-white text-[14px] items-center">{ward.account ? 'Add to my wardrobe' : 'Add my wardrobe'}</a>
        </div>
      ) : mode === 'new' && items && shop.length === 0 ? (
        <div className="py-10 text-center" data-testid="swap-empty">
          <p className="font-serif text-[24px]">Nothing else fits the budget. Raise it?</p>
          <button className="mt-4 h-10 px-5 rounded-full bg-ink text-white text-[14px]" onClick={() => {
            e.setSwap(null); e.setViewer(null); e.setTab('chat')
            e.send(`Swap the ${what} in ${look?.name ?? 'this look'}; I can stretch the budget a little.`, { lookId })
          }}>Ask Ava to stretch it</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 pb-4">
            {items ? shown.map((a) => <Tile key={a.product.id} a={a} />)
              : Array.from({ length: 4 }, (_, i) => <div key={i}><div className="aspect-[3/4] skeleton rounded-xl" /><div className="mt-2 h-4 w-3/4 skeleton" /><div className="mt-1.5 h-3 w-1/2 skeleton" /></div>)}
          </div>
          {mode === 'mine' && mine.length > 0 && <p className="pb-4 text-[12px] text-muted">Your own pieces aren’t drawn on the try-on; the store pieces are, on your photo.</p>}
        </>
      )}
      {err && items && <p className="text-[13px] text-accent pb-4">{err}</p>}
    </Sheet>
  )
}
