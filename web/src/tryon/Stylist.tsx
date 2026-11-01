import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowUpRight } from 'lucide-react'
import { cartActions, navigate, useCart } from '../store/lib'
import { inr } from '../shared/format'
import { call, type DnaPage, type TLook, type User } from './api'
import { PageHead, plural, Tag, toast } from './ui'

const BAND: Record<string, [string, string, string]> = { // DESIGN.md score bands
  great: ['Great match', '#E7F2EA', '#1F5C3A'], works: ['Works', '#F1EEE8', '#3D3A35'], bold: ['Bold choice', '#FBEADC', '#8A4513'],
}

/** Shop with your stylist, from TRYON: opens the same stylist (the store widget, same shopper token, so it knows your
 *  gender, photo, Style DNA and wardrobe) and lists the looks it made for you, as cards. */
export function Stylist({ me }: { me: User }) {
  const [looks, setLooks] = useState<TLook[] | null>(null)
  const [occ, setOcc] = useState<string[]>([])
  const [v, setV] = useState('')
  const load = () => call<{ looks: TLook[] }>('/api/me/looks').then((r) => setLooks(r.looks), () => setLooks((l) => l ?? []))
  useEffect(() => {
    load()
    call<DnaPage>('/api/me/dna').then((d) => setOcc(d.occasions), () => {})
    // The stylist made or swapped a look: refresh the list when its panel closes.
    const on = () => load()
    addEventListener('elara:close', on)
    return () => removeEventListener('elara:close', on)
  }, [])

  // Add to bag from the stylist: the store's cart drawer isn't on this page, so confirm here with a way to it.
  const { lines } = useCart()
  const prev = useRef(lines.length)
  useEffect(() => {
    const added = lines.length - prev.current
    prev.current = lines.length
    if (added <= 0) return
    toast(`${plural(added, 'piece')} added to your bag`, { label: 'View bag', run: () => { cartActions.open(); navigate('/') } },
      { ms: 6000, onExpire: () => cartActions.close() })
  }, [lines.length])

  const ask = (message: string) => { if (message.trim()) window.Elara?.open({ message: message.trim() }) }
  const ideas = [...occ.slice(0, 2).map((o) => `Looks for the ${o.toLowerCase()}`), 'Build a look around my ivory palazzos', 'Smart casual for the office', 'Something for a wedding'].slice(0, 4)
  return (
    <div className="px-5 sm:px-10 xl:px-14 py-8 sm:py-12 max-w-[1280px] mx-auto" data-testid="stylist-page">
      <PageHead eyebrow="Shopping Northline" title={<>What are we shopping for, <em>{me.name}</em>?</>}
        sub="Your stylist already knows your sizes, colours, Style DNA and wardrobe. Ask for an outfit or a piece, and try any look on you." />
      <form onSubmit={(e) => { e.preventDefault(); ask(v); setV('') }} className="mt-8 max-w-[760px] h-16 rounded-full border border-line focus-within:border-ink bg-white flex items-center gap-2 pl-6 pr-2 transition-colors duration-150 shadow-[0_1px_0_rgba(17,17,17,.03)]">
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Plan three outfits for a Goa weekend…" aria-label="Ask your stylist" className="flex-1 min-w-0 h-full outline-none text-[16px] bg-transparent placeholder:text-muted/70" data-testid="stylist-input" />
        <button disabled={!v.trim()} aria-label="Send" className="w-12 h-12 shrink-0 rounded-full bg-ink text-white inline-flex items-center justify-center disabled:opacity-25 transition-opacity duration-150"><ArrowUp size={19} /></button>
      </form>
      <div className="mt-4 -mx-5 px-5 sm:mx-0 sm:px-0 flex sm:flex-wrap gap-2 t-xscroll">
        {ideas.map((s) => <button key={s} onClick={() => ask(s)} className="shrink-0 h-10 px-4 rounded-full border border-line text-[14px] hover:border-ink transition-colors duration-150 whitespace-nowrap" data-testid="stylist-idea">{s}</button>)}
      </div>

      <div className="mt-14 sm:mt-16 flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h2 className="font-serif text-[32px] leading-none">Your recent looks</h2>
        {looks && looks.length > 0 && <span className="text-[13px] text-muted">{plural(looks.length, 'look')}</span>}
      </div>
      {!looks ? <div className="mt-6 grid sm:grid-cols-2 xl:grid-cols-3 gap-6">{[0, 1, 2].map((i) => <div key={i} className="aspect-[4/5] t-skel" />)}</div>
        : looks.length === 0 ? (
          <div className="mt-8 text-center py-10">
            <p className="font-serif text-[28px]">Looks your stylist makes for you collect here.</p>
            <button onClick={() => ask('Style me for this weekend')} className="mt-5 h-11 px-5 rounded-full bg-ink text-white text-[14px] font-medium">Style me for this weekend</button>
          </div>
        ) : (
          <div className="mt-6 grid sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-10" data-testid="stylist-looks">
            {looks.map((l) => {
              const [band, bg, fg] = BAND[l.score_band] ?? BAND.works
              const store = l.items.filter((it) => !it.product.owned)
              return (
                <article key={l.id} className="flex flex-col t-fade" data-testid="stylist-look">
                  <button onClick={() => window.Elara?.open({ lookId: l.id })} className="relative aspect-[4/5] bg-surface overflow-hidden text-left group" aria-label={`Open ${l.name}`}>
                    {l.render.status === 'ready' && l.render.image_url ? (
                      <><img src={l.render.image_url} alt={`You wearing ${l.name}`} className="absolute inset-0 w-full h-full object-contain" loading="lazy" /><span className="absolute top-3 left-3"><Tag>On you</Tag></span></>
                    ) : (
                      <div className={`absolute inset-0 grid gap-[3px] bg-white ${l.items.length >= 2 ? 'grid-cols-2' : ''}`}>
                        {l.items.slice(0, 2).map((it) => <img key={it.product.id} src={it.product.image_url} alt={it.product.title} loading="lazy" className="w-full h-full object-cover object-top bg-surface" />)}
                      </div>
                    )}
                    <span className="absolute top-3 right-3 h-7 px-2.5 rounded-full text-[12px] font-medium inline-flex items-center num" style={{ background: bg, color: fg }}>{l.score} · {band}</span>
                  </button>
                  <div className="mt-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-serif text-[24px] leading-tight truncate">{l.name}</p>
                      <p className="mt-0.5 text-[13px] text-muted"><span className="num text-ink">{inr(l.total)}</span> · {plural(store.length, 'store piece')}{l.items.length > store.length ? ` + ${l.items.length - store.length} yours` : ''}</p>
                    </div>
                    <button onClick={() => window.Elara?.open({ lookId: l.id })} className="h-10 px-4 rounded-full border border-line hover:border-ink text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors duration-150">Open<ArrowUpRight size={14} /></button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
    </div>
  )
}
