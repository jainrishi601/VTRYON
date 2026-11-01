import { useEffect, useState } from 'react'
import { ArrowUpRight, SendHorizontal, Sparkles } from 'lucide-react'
import { call, type DnaPage, type TLook, type User } from './api'

/** Shop with your stylist, from TRYON: opens the same stylist (the store widget, same shopper token, so it knows your
 *  gender, photo, Style DNA and wardrobe) and lists the looks it made for you, as cards. */
export function Stylist({ me }: { me: User }) {
  const [looks, setLooks] = useState<TLook[] | null>(null)
  const [occ, setOcc] = useState<string[]>([])
  const [v, setV] = useState('')
  useEffect(() => {
    call<{ looks: TLook[] }>('/api/me/looks').then((r) => setLooks(r.looks), () => setLooks([]))
    call<DnaPage>('/api/me/dna').then((d) => setOcc(d.occasions), () => {})
  }, [])
  const ask = (message: string) => { if (message.trim()) window.Elara?.open({ message: message.trim() }) }
  const ideas = [...occ.slice(0, 2).map((o) => `Looks for the ${o.toLowerCase()}`), 'Smart casual for the office', 'Something for a wedding', 'Show me linen shirts'].slice(0, 4)
  return (
    <div className="px-6 sm:px-12 py-10 max-w-[1240px] mx-auto" data-testid="stylist-page">
      <span className="h-8 px-3 rounded-full bg-[#fff1e8] text-[#c2410c] text-[13px] font-medium inline-flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#f97316]" />Shopping Northline</span>
      <h1 className="mt-5 text-[34px] sm:text-[42px] font-semibold tracking-[-0.02em] leading-tight">What are we shopping for, <span className="text-[#f97316]">{me.name}</span>?</h1>
      <p className="mt-2 text-[16px] text-[#737373] max-w-[640px]">Your stylist already knows your sizes, colours, Style DNA and wardrobe. Ask for an outfit or a piece; every look can be tried on you.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {ideas.map((s) => <button key={s} onClick={() => ask(s)} className="h-11 px-4 rounded-full border border-[#e5e5e5] text-[15px] hover:border-[#0a0a0a]" data-testid="stylist-idea">{s}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(v); setV('') }} className="mt-5 rounded-[26px] p-[1.5px] bg-gradient-to-r from-[#e0648a] to-[#8fc5e8]">
        <div className="rounded-[25px] bg-white flex items-center gap-2 pl-6 pr-2 py-2">
          <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Ask your stylist to plan outfits for Goa…" className="flex-1 h-12 outline-none text-[16px] bg-transparent" data-testid="stylist-input" />
          <button disabled={!v.trim()} aria-label="Send" className="w-12 h-12 rounded-full bg-[#0a0a0a] text-white inline-flex items-center justify-center disabled:bg-[#e5e5e5] disabled:text-[#a3a3a3]"><SendHorizontal size={18} /></button>
        </div>
      </form>

      <h2 className="mt-14 text-[22px] font-semibold">Your recent looks</h2>
      {!looks ? <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">{[0, 1, 2].map((i) => <div key={i} className="h-[320px] rounded-[24px] t-skel" />)}</div>
        : looks.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[#e5e5e5] px-6 py-8 text-center text-[15px] text-[#737373]"><Sparkles size={20} className="mx-auto mb-2 text-[#8b6cf0]" />Looks your stylist makes for you will collect here.</div>
        ) : (
          <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="stylist-looks">
            {looks.map((l) => (
              <article key={l.id} className="rounded-[24px] border border-[#ececec] overflow-hidden t-glow" data-testid="stylist-look">
                <div className="p-4 flex items-center gap-2.5"><span className="flex-1 text-[16px] font-semibold truncate">{l.name}</span><span className="h-7 px-2.5 rounded-full bg-[#e8f5ec] text-[#166534] text-[12px] font-medium inline-flex items-center num">{l.score}</span></div>
                <div className="px-4">
                  {l.render.status === 'ready' && l.render.image_url ? (
                    <img src={l.render.image_url} alt={`You wearing ${l.name}`} className="w-full aspect-[4/3] object-cover object-top rounded-2xl bg-[#f4f4f5]" />
                  ) : (
                    <div className="grid grid-cols-3 gap-2">{l.items.slice(0, 3).map((it) => <img key={it.product.id} src={it.product.image_url} alt={it.product.title} className="aspect-square w-full object-cover object-top rounded-xl bg-[#f4f4f5]" />)}</div>
                  )}
                </div>
                <div className="p-4 flex items-center gap-3">
                  <p className="flex-1 text-[14px]">Total: <b className="num">₹{l.total.toLocaleString('en-IN')}</b> <span className="text-[#a3a3a3]">· {l.items.length} {l.items.length === 1 ? 'piece' : 'pieces'}</span></p>
                  <button onClick={() => window.Elara?.open({ lookId: l.id })} className="h-9 px-3.5 rounded-full bg-[#0a0a0a] text-white text-[13px] font-medium inline-flex items-center gap-1.5">Open<ArrowUpRight size={14} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
    </div>
  )
}
