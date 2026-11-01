import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Plus, Search, Sparkles, Trash2, X } from 'lucide-react'
import { call, cap, FAMILY_HEX, SLOT_LABEL, type Piece, type User } from './api'

const TABS: [string, string][] = [['all', 'All'], ['top', 'Tops'], ['bottom', 'Bottoms'], ['one_piece', 'Dresses & sets'], ['layer', 'Layers'],
  ['footwear', 'Footwear'], ['bag', 'Bags'], ['accessory', 'Accessories']]
const FAMILIES = Object.keys(FAMILY_HEX)
const PATTERNS = ['solid', 'graphic', 'floral', 'stripe', 'check', 'textured', 'colorblock', 'polka', 'abstract', 'animal']

/** The shopper's own wardrobe. Photos are tagged by Claude in the catalogue's own fields, so the stylist can score
 *  and pair store pieces with them ("Pairs best with" in the widget). */
export function Wardrobe({ me }: { me: User }) {
  const [items, setItems] = useState<Piece[] | null>(null)
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [sel, setSel] = useState<Piece | null>(null)
  const load = useCallback(() => call<{ items: Piece[] }>('/api/me/wardrobe').then((r) => setItems(r.items), () => setItems([])), [])
  useEffect(() => { load() }, [load])
  const shown = (items ?? []).filter((p) => (tab === 'all' || p.slot === tab) && (!q || `${p.name} ${p.category} ${p.colors.join(' ')}`.toLowerCase().includes(q.toLowerCase())))
  const update = (p: Piece) => { setItems((xs) => xs?.map((x) => (x.id === p.id ? p : x)) ?? null); setSel(p) }
  return (
    <div className="flex min-h-[calc(100vh-24px)]" data-testid="wardrobe-page">
      <div className="flex-1 min-w-0 px-6 sm:px-10 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-semibold">Wardrobe</h1>
          <span className="h-7 px-2.5 rounded-lg bg-[#f4f4f5] text-[13px] inline-flex items-center num" data-testid="wardrobe-count">{items?.length ?? 0}</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="h-11 w-[260px] max-w-[60vw] px-4 rounded-xl border border-[#e5e5e5] flex items-center gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="flex-1 outline-none text-[15px] bg-transparent" />
              <Search size={17} className="text-[#737373]" />
            </label>
            <button onClick={() => setAdding(true)} data-testid="wardrobe-add" className="h-11 px-5 rounded-xl bg-[#0a0a0a] text-white text-[15px] font-medium inline-flex items-center gap-2">Add new <Plus size={17} /></button>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-1.5">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`h-10 px-4 rounded-xl text-[15px] ${tab === k ? 'border border-[#0a0a0a] bg-[#f4f4f5] font-medium' : 'text-[#525252] hover:text-[#0a0a0a]'}`}>{l}</button>
          ))}
        </div>
        {items === null ? (
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-6">{Array.from({ length: 10 }, (_, i) => <div key={i} className="aspect-[4/5] rounded-2xl t-skel" />)}</div>
        ) : items.length === 0 ? (
          <div className="mt-16 max-w-[520px] mx-auto text-center" data-testid="wardrobe-empty">
            <span className="w-16 h-16 rounded-2xl bg-[#f4f4f5] inline-flex items-center justify-center"><ImagePlus size={26} strokeWidth={1.5} /></span>
            <h2 className="mt-5 text-[24px] font-semibold">Unlock your style twin</h2>
            <p className="mt-2 text-[15px] text-[#737373]">Add photos of what you own. Each piece is recognised and tagged, and the stylist pairs store pieces with it, {me.name}.</p>
            <button onClick={() => setAdding(true)} className="mt-6 h-12 px-6 rounded-xl bg-[#0a0a0a] text-white text-[15px] font-medium">Add your first pieces</button>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-x-6 gap-y-8" data-testid="wardrobe-grid">
            {shown.map((p) => (
              <button key={p.id} onClick={() => setSel(p)} className={`text-left group ${sel?.id === p.id ? 'opacity-100' : ''}`} data-testid="wardrobe-item">
                <div className={`relative aspect-[4/5] rounded-2xl bg-[#f7f7f7] overflow-hidden ${sel?.id === p.id ? 'ring-2 ring-[#0a0a0a]' : ''}`}>
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-contain p-3 group-hover:scale-[1.03] transition-transform duration-300" loading="lazy" />
                  {!p.tagged && <span className="absolute top-2.5 left-2.5 h-6 px-2 rounded-full bg-white text-[11px] font-medium inline-flex items-center">Needs details</span>}
                  {!p.allow_styling && <span className="absolute top-2.5 right-2.5 h-6 px-2 rounded-full bg-white text-[11px] text-[#737373] inline-flex items-center">Not styled</span>}
                </div>
                <div className="mt-2.5 flex items-start gap-2">
                  <div className="flex-1 min-w-0"><p className="text-[14px] font-medium truncate">{p.name}</p><p className="text-[12px] text-[#737373] capitalize">{p.category || SLOT_LABEL[p.slot]}</p></div>
                  {p.color_family && <span className="mt-1 w-3.5 h-3.5 rounded-full border border-black/10" style={{ background: FAMILY_HEX[p.color_family] }} />}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {sel && <ItemPanel p={sel} onClose={() => setSel(null)} onUpdate={update} onDelete={() => { setItems((xs) => xs?.filter((x) => x.id !== sel.id) ?? null); setSel(null) }} />}
      {adding && <AddDialog onClose={() => setAdding(false)} onAdded={(ps) => { setItems((xs) => [...ps, ...(xs ?? [])]); setAdding(false); if (ps[0]) setSel(ps[0]) }} />}
    </div>
  )
}

function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (p: Piece[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  const up = async (files: FileList) => {
    const form = new FormData()
    Array.from(files).slice(0, 10).forEach((f) => form.append('file', f))
    setBusy(files.length); setErr('')
    try {
      const r = await call<{ items: Piece[]; errors: string[] }>('/api/me/wardrobe', { form })
      if (r.errors.length) setErr(r.errors.join(' '))
      onAdded(r.items)
    } catch (x) { setErr((x as Error).message); setBusy(0) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="wardrobe-dialog">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative w-full max-w-[620px] rounded-[28px] bg-white t-pop overflow-hidden">
        <div className="px-6 py-5 border-b border-[#ececec] flex items-center"><p className="text-[19px] font-semibold flex-1">Add to your wardrobe</p>
          <button onClick={onClose} disabled={!!busy} aria-label="Close" className="w-9 h-9 rounded-full bg-[#f4f4f5] inline-flex items-center justify-center"><X size={17} /></button></div>
        <div className="p-6">
          <div className="rounded-2xl border border-[#ececec] p-6">
            <span className="w-11 h-11 rounded-xl bg-[#f4f4f5] inline-flex items-center justify-center"><ImagePlus size={20} strokeWidth={1.6} /></span>
            <p className="mt-4 text-[17px] font-semibold">Add with photos</p>
            <p className="mt-1 text-[14px] leading-[21px] text-[#737373]">Pick one or more photos: a piece laid flat, on a hanger, or an outfit you’re wearing. Every piece in a photo is recognised and tagged (type, colour, fabric, vibe, fit), and you can edit anything after.</p>
            <button onClick={() => ref.current?.click()} disabled={!!busy} data-testid="wardrobe-upload" className="mt-5 w-full h-12 rounded-xl bg-[#0a0a0a] text-white text-[15px] font-medium disabled:bg-[#525252]">
              {busy ? <span className="t-shine !bg-clip-text">Recognising {busy} photo{busy > 1 ? 's' : ''}…</span> : 'Choose photos'}
            </button>
            <input ref={ref} type="file" accept="image/jpeg,image/png" multiple className="hidden" data-testid="wardrobe-input" onChange={(e) => { if (e.target.files?.length) up(e.target.files); e.target.value = '' }} />
          </div>
          {err && <p className="mt-4 text-[14px] text-[#c2410c]" role="alert">{err}</p>}
          <p className="mt-4 text-[12px] text-[#a3a3a3]">Photos stay in your TRYON account and are only used to style you.</p>
        </div>
      </div>
    </div>
  )
}

function ItemPanel({ p, onClose, onUpdate, onDelete }: { p: Piece; onClose: () => void; onUpdate: (p: Piece) => void; onDelete: () => void }) {
  const [name, setName] = useState(p.name)
  useEffect(() => setName(p.name), [p.id, p.name])
  const patch = async (body: Partial<Piece>) => onUpdate(await call<Piece>(`/api/me/wardrobe/${p.id}`, { method: 'PATCH', body }))
  const del = async () => { await call(`/api/me/wardrobe/${p.id}`, { method: 'DELETE' }); onDelete() }
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="py-3 flex items-start gap-4 border-b border-[#f1f1f1]"><p className="w-[120px] shrink-0 text-[14px] text-[#737373] pt-1.5">{label}</p><div className="flex-1 min-w-0">{children}</div></div>
  )
  const Pick = ({ value, options, onPick, testid }: { value: string; options: string[]; onPick: (v: string) => void; testid?: string }) => (
    <select value={value} onChange={(e) => onPick(e.target.value)} data-testid={testid} className="w-full h-9 px-3 rounded-lg border border-[#e5e5e5] text-[14px] capitalize bg-white">
      <option value="">Not set</option>{options.map((o) => <option key={o} value={o}>{cap(o)}</option>)}
    </select>
  )
  return (
    <aside className="w-[380px] shrink-0 border-l border-[#ececec] h-[calc(100vh-24px)] sticky top-3 overflow-y-auto t-fade" data-testid="wardrobe-panel">
      <div className="px-6 py-5 flex items-center border-b border-[#ececec]"><p className="flex-1 text-[17px] font-semibold truncate">{p.name}</p><button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full hover:bg-[#f4f4f5] inline-flex items-center justify-center"><X size={18} /></button></div>
      <div className="p-6">
        <div className="aspect-square rounded-2xl bg-[#f7f7f7]"><img src={p.image_url} alt="" className="w-full h-full object-contain p-4" /></div>
        <label className="mt-5 flex items-center justify-between rounded-xl bg-[#f7f7f7] px-4 h-12">
          <span className="text-[15px]">Allow in styling</span>
          <button role="switch" aria-checked={p.allow_styling} onClick={() => patch({ allow_styling: !p.allow_styling })} data-testid="allow-styling"
            className={`w-12 h-7 rounded-full p-0.5 transition-colors ${p.allow_styling ? 'bg-[#0a0a0a]' : 'bg-[#d4d4d4]'}`}><span className={`block w-6 h-6 rounded-full bg-white transition-transform ${p.allow_styling ? 'translate-x-5' : ''}`} /></button>
        </label>
        {!p.tagged && <p className="mt-4 rounded-xl bg-[#fff7ed] px-4 py-3 text-[13px] text-[#9a3412]">Add the type and colour so the stylist can pair it.</p>}
        <p className="mt-6 text-[12px] font-semibold tracking-[0.1em] text-[#737373]">DETAILS</p>
        <Row label="Name"><input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== p.name && patch({ name: name.trim() })} className="w-full h-9 px-3 rounded-lg border border-[#e5e5e5] text-[14px]" data-testid="item-name" /></Row>
        <Row label="Type"><Pick value={p.slot} options={Object.keys(SLOT_LABEL)} onPick={(v) => v && patch({ slot: v })} testid="item-slot" /></Row>
        <Row label="Category"><input defaultValue={p.category} key={p.id + p.category} onBlur={(e) => e.target.value !== p.category && patch({ category: e.target.value.trim().toLowerCase() })} placeholder="e.g. shirt" className="w-full h-9 px-3 rounded-lg border border-[#e5e5e5] text-[14px]" data-testid="item-category" /></Row>
        <Row label="Colour"><Pick value={p.color_family} options={FAMILIES} onPick={(v) => patch({ color_family: v })} testid="item-color" /></Row>
        <Row label="Pattern"><Pick value={p.pattern} options={PATTERNS} onPick={(v) => patch({ pattern: v })} /></Row>
        <Row label="Fit"><Pick value={p.fit ?? ''} options={['relaxed', 'regular', 'fitted']} onPick={(v) => patch({ fit: v })} /></Row>
        <Row label="Dress level"><Pick value={String(p.formality ?? '')} options={['1', '2', '3', '4', '5']} onPick={(v) => v && patch({ formality: Number(v) })} /></Row>
        {!!p.vibes.length && <Row label="Style"><div className="flex flex-wrap gap-1.5">{p.vibes.map((v) => <Tag key={v}>{v}</Tag>)}</div></Row>}
        {!!p.occasions.length && <Row label="Occasions"><div className="flex flex-wrap gap-1.5">{p.occasions.map((v) => <Tag key={v}>{v}</Tag>)}</div></Row>}
        {!!p.season.length && <Row label="Season"><div className="flex flex-wrap gap-1.5">{p.season.map((v) => <Tag key={v}>{v}</Tag>)}</div></Row>}
        {p.fabric && <Row label="Fabric"><p className="text-[14px] pt-1.5 capitalize">{p.fabric}</p></Row>}
        <div className="mt-6 flex items-center gap-2">
          <button onClick={del} aria-label="Delete this piece" className="w-11 h-11 rounded-xl border border-[#e5e5e5] inline-flex items-center justify-center text-[#c2410c]" data-testid="item-delete"><Trash2 size={16} /></button>
          <a href={`/?ask=${encodeURIComponent(`Build a look around my ${p.name}`)}`} className="flex-1 h-11 rounded-xl bg-[#0a0a0a] text-white text-[15px] font-medium inline-flex items-center justify-center gap-2" data-testid="item-style"><Sparkles size={16} />Style this</a>
        </div>
      </div>
    </aside>
  )
}

const Tag = ({ children }: { children: React.ReactNode }) => <span className="h-7 px-3 rounded-full border border-[#e5e5e5] text-[13px] inline-flex items-center capitalize">{children}</span>
