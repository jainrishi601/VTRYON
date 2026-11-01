import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, MessageCircle, Plus, Search, Trash2, X } from 'lucide-react'
import { call, cap, FAMILY_HEX, SLOT_LABEL, type Piece, type User } from './api'
import { PageHead, plural, Sheet, Tag, toast, useMedia, useScrollLock } from './ui'

const TABS: [string, string][] = [['all', 'All'], ['top', 'Tops'], ['bottom', 'Bottoms'], ['one_piece', 'Dresses & sets'], ['layer', 'Layers'],
  ['footwear', 'Footwear'], ['bag', 'Bags'], ['accessory', 'Accessories']]
const FAMILIES = Object.keys(FAMILY_HEX)
const PATTERNS = ['solid', 'graphic', 'floral', 'stripe', 'check', 'textured', 'colorblock', 'polka', 'abstract', 'animal']
const newestFirst = (a: Piece, b: Piece) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || a.id.localeCompare(b.id)

/** The shopper's own wardrobe. Photos are tagged by Claude in the catalogue's own fields, so the stylist can score
 *  and pair store pieces with them ("Pairs best with" in the widget). */
export function Wardrobe({ me }: { me: User }) {
  const [items, setItems] = useState<Piece[] | null>(null)
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [selId, setSelId] = useState<string | null>(null)
  const pendingDelete = useRef(new Map<string, number>())
  const load = useCallback(() => call<{ items: Piece[] }>('/api/me/wardrobe').then((r) => setItems([...r.items].sort(newestFirst)), () => setItems([])), [])
  useEffect(() => { load() }, [load])
  // Leaving the page commits any delete still waiting out its Undo window.
  useEffect(() => () => pendingDelete.current.forEach((t, id) => { clearTimeout(t); commitDelete(id) }), [])
  const counts = useMemo(() => (items ?? []).reduce<Record<string, number>>((a, p) => ({ ...a, [p.slot]: (a[p.slot] ?? 0) + 1 }), {}), [items])
  const shown = (items ?? []).filter((p) => (tab === 'all' || p.slot === tab) && (!q || `${p.name} ${p.category} ${p.colors.join(' ')}`.toLowerCase().includes(q.toLowerCase())))
  const sel = items?.find((p) => p.id === selId) ?? null
  const update = (p: Piece) => { setItems((xs) => xs?.map((x) => (x.id === p.id ? p : x)) ?? null) }
  const remove = (p: Piece) => {
    setSelId(null)
    setItems((xs) => xs?.filter((x) => x.id !== p.id) ?? null)
    const t = window.setTimeout(() => { pendingDelete.current.delete(p.id); commitDelete(p.id) }, 6000)
    pendingDelete.current.set(p.id, t)
    toast(`Deleted ${p.name}`, { label: 'Undo', run: () => {
      clearTimeout(pendingDelete.current.get(p.id)); pendingDelete.current.delete(p.id)
      setItems((xs) => [...(xs ?? []), p].sort(newestFirst))
    } }, { ms: 6000 })
  }
  return (
    <div className="lg:flex min-h-[calc(100vh-24px)]" data-testid="wardrobe-page">
      <div className="flex-1 min-w-0 px-5 sm:px-10 xl:px-14 py-8 sm:py-12">
        <PageHead eyebrow={items ? plural(items.length, 'piece') : 'Your wardrobe'} title="Wardrobe"
          sub={`What you already own. Daily Picks and the stylist build around it, ${me.name}.`}>
          <span className="sr-only" data-testid="wardrobe-count">{items?.length ?? 0}</span>
          <button onClick={() => setAdding(true)} data-testid="wardrobe-add" className="h-11 px-5 rounded-full bg-ink text-white text-[14px] font-medium inline-flex items-center gap-2"><Plus size={16} />Add pieces</button>
        </PageHead>
        {!!items?.length && (
          <div className="mt-8 flex flex-col-reverse sm:flex-row sm:items-center gap-3 border-b border-line">
            <div className="flex-1 min-w-0 -mx-5 px-5 sm:mx-0 sm:px-0 flex gap-5 t-xscroll" role="tablist">
              {TABS.filter(([k]) => k === 'all' || counts[k]).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`shrink-0 h-11 text-[14px] border-b-2 -mb-px transition-colors duration-150 whitespace-nowrap ${tab === k ? 'border-ink text-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}>
                  {l} <span className="num text-muted text-[12px]">{k === 'all' ? items.length : counts[k]}</span>
                </button>
              ))}
            </div>
            <label className="h-10 w-full sm:w-[220px] px-4 rounded-full border border-line focus-within:border-ink flex items-center gap-2 sm:mb-2 transition-colors duration-150">
              <Search size={15} className="text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your pieces" aria-label="Search your pieces" className="flex-1 min-w-0 outline-none text-[14px] bg-transparent" />
              {q && <button onClick={() => setQ('')} aria-label="Clear search"><X size={14} /></button>}
            </label>
          </div>
        )}
        {items === null ? (
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-8">{Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-[4/5] t-skel" />)}</div>
        ) : items.length === 0 ? (
          <div className="mt-14 max-w-[480px] mx-auto text-center" data-testid="wardrobe-empty">
            <p className="font-serif text-[34px] leading-tight">Start with three pieces you wear most.</p>
            <p className="mt-3 text-[15px] text-muted">Photograph them flat, on a hanger or on you. Each piece is recognised and tagged, and the stylist pairs store pieces with it.</p>
            <button onClick={() => setAdding(true)} className="mt-6 h-12 px-6 rounded-full bg-ink text-white text-[15px] font-medium">Add your first pieces</button>
          </div>
        ) : shown.length === 0 ? (
          <p className="mt-12 text-center text-[15px] text-muted">Nothing matches “{q}”. <button onClick={() => { setQ(''); setTab('all') }} className="text-ink underline underline-offset-4">Show everything</button></p>
        ) : (
          <div className={`mt-8 grid grid-cols-2 sm:grid-cols-3 ${sel ? 'xl:grid-cols-3' : 'xl:grid-cols-4'} gap-x-4 sm:gap-x-6 gap-y-8`} data-testid="wardrobe-grid">
            {shown.map((p) => (
              <button key={p.id} onClick={() => setSelId(p.id)} className="text-left group min-w-0" data-testid="wardrobe-item" aria-pressed={selId === p.id}>
                <div className={`relative aspect-[4/5] bg-surface overflow-hidden transition-shadow duration-150 ${selId === p.id ? 'ring-2 ring-ink ring-offset-2' : ''}`}>
                  <img src={p.image_url} alt={p.name} className="absolute inset-0 w-full h-full object-cover object-top group-hover:scale-[1.02] transition-transform duration-300" loading="lazy" />
                  <span className="absolute top-2.5 left-2.5"><Tag>Yours</Tag></span>
                  {!p.tagged && <span className="absolute bottom-2.5 left-2.5 h-6 px-2 rounded-full bg-white text-[11px] font-medium inline-flex items-center">Needs details</span>}
                  {!p.allow_styling && <span className="absolute bottom-2.5 right-2.5 h-6 px-2 rounded-full bg-white text-[11px] text-muted inline-flex items-center">Not in styling</span>}
                </div>
                <div className="mt-2.5 flex items-start gap-2">
                  <div className="flex-1 min-w-0"><p className="text-[14px] font-medium truncate">{p.name}</p><p className="text-[12px] text-muted truncate">{cap(p.category || SLOT_LABEL[p.slot] || '')}</p></div>
                  {p.color_family && <span className="mt-1 w-3 h-3 rounded-full border border-black/10 shrink-0" style={{ background: FAMILY_HEX[p.color_family] }} title={cap(p.color_family)} />}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {sel && <ItemPanel key={sel.id} p={sel} onClose={() => setSelId(null)} onUpdate={update} onDelete={() => remove(sel)} />}
      {adding && <AddDialog onClose={() => setAdding(false)} onAdded={(ps) => { setItems((xs) => [...ps, ...(xs ?? [])].sort(newestFirst)); setAdding(false); if (ps[0]) setSelId(ps[0].id) }} />}
    </div>
  )
}

const commitDelete = (id: string) => { call(`/api/me/wardrobe/${id}`, { method: 'DELETE' }).catch(() => {}) }

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
      if (r.errors?.length) setErr(r.errors.join(' '))
      if (r.items.length) onAdded(r.items); else setBusy(0)
    } catch (x) { setErr((x as Error).message); setBusy(0) }
  }
  return (
    <Sheet title="Add to your wardrobe" onClose={busy ? () => {} : onClose} testid="wardrobe-dialog">
      <div className="p-5 sm:p-6">
        <button onClick={() => ref.current?.click()} disabled={!!busy} data-testid="wardrobe-upload"
          className="w-full aspect-[16/9] sm:aspect-[2/1] border-[1.5px] border-dashed border-line hover:border-ink rounded-[14px] flex flex-col items-center justify-center gap-3 transition-colors duration-150 disabled:hover:border-line">
          <ImagePlus size={26} strokeWidth={1.4} />
          <span className="text-[16px] font-medium">{busy ? <span className="t-shine">Recognising {plural(busy, 'photo')}…</span> : 'Choose photos'}</span>
          <span className="text-[13px] text-muted px-6 text-center">{busy ? 'Finding every piece and tagging it. About 15 seconds.' : 'A piece laid flat, on a hanger, or an outfit you’re wearing. Up to 10.'}</span>
        </button>
        <input ref={ref} type="file" accept="image/jpeg,image/png" multiple className="hidden" data-testid="wardrobe-input" onChange={(e) => { if (e.target.files?.length) up(e.target.files); e.target.value = '' }} />
        {err && <p className="mt-4 text-[14px] text-accent" role="alert">{err}</p>}
        <p className="mt-4 text-[13px] text-muted">Every piece in a photo is recognised and tagged (type, colour, fabric, vibe, fit). You can edit anything after. Photos stay in your TRYON account.</p>
      </div>
    </Sheet>
  )
}

function ItemPanel({ p, onClose, onUpdate, onDelete }: { p: Piece; onClose: () => void; onUpdate: (p: Piece) => void; onDelete: () => void }) {
  const wide = useMedia('(min-width: 1024px)')
  useScrollLock(!wide)
  const [name, setName] = useState(p.name)
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirty = name.trim() && name.trim() !== p.name
  // Every save carries an unsaved rename, so toggling a switch never throws the new name away.
  const patch = async (body: Partial<Piece>) => {
    setSaving(true)
    try { onUpdate(await call<Piece>(`/api/me/wardrobe/${p.id}`, { method: 'PATCH', body: { ...(dirty ? { name: name.trim() } : {}), ...body } })) } catch { /* keeps the old value */ }
    setSaving(false)
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  return (
    <aside className="fixed inset-0 z-50 bg-white flex flex-col lg:static lg:z-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-line lg:h-[calc(100vh-24px)] lg:sticky lg:top-3 t-panel" data-testid="wardrobe-panel" role={wide ? undefined : 'dialog'} aria-label={p.name}>
      <div className="shrink-0 h-14 px-3 lg:px-5 flex items-center gap-2 border-b border-line pt-[env(safe-area-inset-top)] box-content lg:box-border lg:pt-0">
        <p className="pl-2 lg:pl-0 flex-1 min-w-0 text-[15px] font-semibold truncate">{p.name}</p>
        {saving && <span className="text-[12px] text-muted">Saving…</span>}
        <button onClick={onClose} aria-label="Close" className="w-10 h-10 rounded-full inline-flex items-center justify-center hover:bg-surface" data-testid="wardrobe-panel-close"><X size={18} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto t-scroll px-5 pb-6">
        <div className="mt-5 relative aspect-[4/5] lg:aspect-square bg-surface overflow-hidden"><img src={p.image_url} alt={p.name} className="absolute inset-0 w-full h-full object-cover object-top" /></div>
        <div className="mt-5 flex items-center justify-between gap-4">
          <div><p className="text-[15px] font-medium">Use in styling</p><p className="text-[13px] text-muted">Daily Picks and the stylist can build around it.</p></div>
          <button role="switch" aria-checked={p.allow_styling} aria-label="Use in styling" onClick={() => patch({ allow_styling: !p.allow_styling })} data-testid="allow-styling"
            className={`shrink-0 w-12 h-7 rounded-full p-[3px] transition-colors duration-150 ${p.allow_styling ? 'bg-ink' : 'bg-line'}`}><span className={`block w-[22px] h-[22px] rounded-full bg-white shadow-sm transition-transform duration-150 ${p.allow_styling ? 'translate-x-5' : ''}`} /></button>
        </div>
        {!p.tagged && <p className="mt-4 rounded-[10px] bg-surface px-4 py-3 text-[13px]">Add the type and colour so the stylist can pair it.</p>}
        <p className="mt-7 label text-muted">Details</p>
        <div className="mt-1">
          <Row label="Name"><input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => dirty && patch({})} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="w-full h-10 px-3 rounded-[10px] border border-line text-[14px] focus:border-ink outline-none" data-testid="item-name" /></Row>
          <Row label="Type"><Pick value={p.slot} options={Object.keys(SLOT_LABEL)} onPick={(v) => v && patch({ slot: v })} testid="item-slot" /></Row>
          <Row label="Category"><input defaultValue={cap(p.category.replace(/_/g, ' '))} key={p.category} onBlur={(e) => { const v = e.target.value.trim().toLowerCase().replace(/ /g, '_'); if (v !== p.category) patch({ category: v }) }} placeholder="e.g. shirt" className="w-full h-10 px-3 rounded-[10px] border border-line text-[14px] focus:border-ink outline-none" data-testid="item-category" /></Row>
          <Row label="Colour"><Pick value={p.color_family} options={FAMILIES} onPick={(v) => patch({ color_family: v })} testid="item-color" /></Row>
          <Row label="Pattern"><Pick value={p.pattern} options={PATTERNS} onPick={(v) => patch({ pattern: v })} /></Row>
          <Row label="Fit"><Pick value={p.fit ?? ''} options={['relaxed', 'regular', 'fitted']} onPick={(v) => patch({ fit: v })} /></Row>
          <Row label="Dress level"><Pick value={String(p.formality ?? '')} options={['1', '2', '3', '4', '5']} onPick={(v) => v && patch({ formality: Number(v) })} /></Row>
          {!!p.vibes.length && <Row label="Style"><Chips list={p.vibes} /></Row>}
          {!!p.occasions.length && <Row label="Occasions"><Chips list={p.occasions} /></Row>}
          {!!p.season.length && <Row label="Season"><Chips list={p.season} /></Row>}
          {p.fabric && <Row label="Fabric"><p className="text-[14px]">{cap(p.fabric)}</p></Row>}
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))] bg-white">
        {confirm ? (
          <div className="flex items-center gap-2 t-fade" data-testid="item-delete-confirm">
            <p className="flex-1 text-[14px]">Delete this piece?</p>
            <button onClick={() => setConfirm(false)} className="h-11 px-4 rounded-full border border-line text-[14px]">Keep it</button>
            <button onClick={onDelete} className="h-11 px-4 rounded-full bg-ink text-white text-[14px] font-medium" data-testid="item-delete-yes">Delete</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => setConfirm(true)} aria-label="Delete this piece" className="w-11 h-11 rounded-full border border-line inline-flex items-center justify-center hover:border-ink transition-colors duration-150" data-testid="item-delete"><Trash2 size={16} strokeWidth={1.6} /></button>
            <a href={`/?ask=${encodeURIComponent(`Build a look around my ${p.name}`)}`} className="flex-1 h-11 rounded-full bg-ink text-white text-[14px] font-medium inline-flex items-center justify-center gap-2" data-testid="item-style"><MessageCircle size={15} />Build a look around it</a>
          </div>
        )}
      </div>
    </aside>
  )
}

// Module-level (not inside ItemPanel), so inputs keep focus while typing.
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="py-2.5 flex items-center gap-4 border-b border-line"><p className="w-[96px] shrink-0 text-[13px] text-muted">{label}</p><div className="flex-1 min-w-0">{children}</div></div>
)
const Pick = ({ value, options, onPick, testid }: { value: string; options: string[]; onPick: (v: string) => void; testid?: string }) => (
  <select value={value} onChange={(e) => onPick(e.target.value)} data-testid={testid} className="w-full h-10 px-3 rounded-[10px] border border-line text-[14px] bg-white focus:border-ink outline-none">
    <option value="">Not set</option>{options.map((o) => <option key={o} value={o}>{cap(o)}</option>)}
  </select>
)
const Chips = ({ list }: { list: string[] }) => <div className="flex flex-wrap gap-1.5">{list.map((v) => <span key={v} className="h-7 px-3 rounded-full bg-surface text-[13px] inline-flex items-center">{cap(v.replace(/_/g, ' '))}</span>)}</div>
