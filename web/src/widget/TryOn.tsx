import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Maximize2, Plus, ScanFace } from 'lucide-react'
import type { Alternative, Look, Product } from '../shared/types'
import { inr, cap } from '../shared/format'
import { abs, api, ls, type ApiError } from './api'
import { mismatch, useElara } from './state'
import { prepare } from './Onboarding'
import { AddLookButton, RenderBox } from './Chat'
import { Dialog, ScoreBadge, pieceName } from './ui'

/** What completes a single piece. ponytail: catalogue only until the TRYON wardrobe exists (Part A). */
const PAIR: Record<string, string> = { top: 'bottom', bottom: 'top', one_piece: 'layer', layer: 'top' }
type G = 'women' | 'men'

/** The try-on sheet: gets a photo that can wear these clothes (asked once, with consent), then renders.
 *  A whole look renders back on its card; single pieces render here with what pairs best. */
export function TryOnSheet() {
  const e = useElara()
  const req = e.tryon!
  const look = req.kind === 'look' ? e.looks[req.lookId] : null
  const products = req.kind === 'items' ? req.products : look?.items.map((i) => i.product) ?? []
  const need = ((req.kind === 'look' ? look?.gender : products.find((p) => p.gender !== 'unisex')?.gender) ?? null) as G | null
  const ok = !!e.session?.photo_url && !mismatch({ gender: need }, e.session)
  const [go, setGo] = useState(ok)
  const [modelId, setModelId] = useState<string | null>(null)
  const done = useRef(false)

  useEffect(() => {
    if (go && req.kind === 'look' && !done.current) {
      done.current = true
      e.setTryon(null)
      ;(req.lookIds?.length ? req.lookIds : [req.lookId]).forEach((id) => e.renderLook(id, modelId ?? undefined))
    }
  }, [go, req, modelId, e])

  const gift = e.brief?.for === 'other'
  const many = req.kind === 'look' && (req.lookIds?.length ?? 0) > 1
  const title = gift ? 'See it on a model' : many ? `See all ${req.lookIds!.length} looks on you` : req.kind === 'look' ? 'See this look on you' : products.length === 1 ? 'See this on you' : 'See these on you'
  const sub = go ? null : gift ? 'Pick a model to see the pieces worn, layered the way they are meant to be.'
    : 'Pick a model for an instant preview, or use your own full-length photo.'
  return (
    <Dialog icon={<ScanFace size={22} strokeWidth={1.5} />} title={title} sub={sub} onClose={() => e.setTryon(null)} testid="tryon-sheet">
      {!go ? (
        <PhotoStep products={products} need={need} onReady={(m) => { setModelId(m ?? null); setGo(true) }} />
      ) : req.kind === 'items' ? (
        <ItemsResult products={products} modelId={modelId} name={req.name} fromLookId={req.fromLookId} />
      ) : null}
    </Dialog>
  )
}

function PhotoStep({ products, need, onReady }: { products: Product[]; need: G | null; onReady: (modelId?: string) => void }) {
  const e = useElara()
  const s = e.session!
  const wrong = !!s.photo_url && mismatch({ gender: need }, s) // their photo is set to the other gender's clothes
  const briefG = e.brief?.for === 'other' ? null : e.brief?.gender
  const [file, setFile] = useState<{ blob: Blob; name: string; url: string } | null>(null)
  const [pg, setPg] = useState<G | ''>(need ?? (briefG === 'women' || briefG === 'men' ? briefG : ''))
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const models = (e.models ?? []).filter((m) => !need || m.gender === need)
  const store = e.store?.name ?? 'this store'

  const choose = async (f: File) => {
    setErr('')
    try { setFile({ blob: await prepare(f), name: f.name, url: URL.createObjectURL(f) }) } catch (x) { setErr((x as Error).message) }
  }
  const adopt = (photo_url: string, photo_gender: G | null, sample_model_id: string | null) => {
    e.setSession({ ...s, photo_url, photo_gender, sample_model_id })
    ls.set('elara.avatar', abs(photo_url))
  }
  const upload = async () => {
    if (!file || !pg || !consent) return
    setBusy('upload'); setErr('')
    try {
      const f = new FormData()
      f.set('file', file.blob, file.name.replace(/\.\w+$/, '') + (file.blob.type === 'image/png' ? '.png' : '.jpg'))
      f.set('photo_gender', pg)
      const r = await api<{ photo_url: string; photo_gender: G | null }>(`/api/session/${s.id}/photo`, { form: f, timeout: 45000 })
      adopt(r.photo_url, r.photo_gender, null)
      onReady()
    } catch (x) { setErr((x as ApiError).message); setBusy(null) }
  }
  const useModel = async (id: string) => {
    if (wrong) return onReady(id) // keep the shopper's own photo; only this try-on uses the model
    setBusy(id); setErr('')
    try {
      const r = await api<{ photo_url: string; photo_gender: G | null }>(`/api/session/${s.id}/photo`, { body: { sample_model_id: id } })
      adopt(r.photo_url, r.photo_gender, id)
      onReady()
    } catch (x) { setErr((x as ApiError).message); setBusy(null) }
  }

  const whose = need === 'men' ? 'men’s' : need === 'women' ? 'women’s' : ''
  return (
    <div data-testid="tryon-photo">
      {wrong && (
        <p className="mb-4 text-[13px] leading-[19px] rounded-xl bg-ink text-white px-4 py-3" data-testid="tryon-mismatch">
          These pieces are cut for {need}, and {s.sample_model_id ? `you’re trying things on a ${s.photo_gender === 'men' ? 'men’s' : 'women’s'} model` : `your photo is set to ${s.photo_gender}’s clothes`}. Try them on a {whose} model{s.sample_model_id ? '' : '; your own photo stays saved'}.
        </p>
      )}

      {models.length > 0 && (
        <section aria-label="Use a model">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em]">Use a model</p>
            <p className="text-[12px] text-muted">Instant, no upload</p>
          </div>
          <div className="mt-2.5 grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.max(3, Math.min(4, models.length))}, minmax(0, 1fr))` }}>
            {models.slice(0, 4).map((m) => (
              <button key={m.id} data-testid={`tryon-model-${m.id}`} disabled={!!busy} onClick={() => useModel(m.id)} aria-label={`Use ${m.label}`} aria-busy={busy === m.id}
                className={`relative aspect-[3/4] rounded-xl overflow-hidden bg-surface ring-offset-2 transition-shadow hover:ring-2 hover:ring-ink disabled:cursor-wait ${busy === m.id ? 'ring-2 ring-ink' : ''}`}>
                <img src={abs(m.image_url)} alt="" className="w-full h-full object-cover object-top" />
                {busy === m.id && <span className="absolute inset-0 bg-white/55 flex items-center justify-center"><span className="w-5 h-5 rounded-full border-2 border-line border-t-ink spin" /></span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {!wrong && (
        <>
          <div className="my-5 flex items-center gap-3 text-[12px] text-muted"><span className="h-px flex-1 bg-line" />or use your own photo<span className="h-px flex-1 bg-line" /></div>
          <div className="flex gap-3 items-stretch">
            <button onClick={() => fileRef.current?.click()} data-testid="tryon-dropzone"
              className={`relative flex-1 rounded-2xl border border-dashed border-line bg-surface/60 overflow-hidden flex flex-col items-center justify-center gap-0.5 hover:border-ink transition-[border-color,height] duration-200 ${file ? 'h-[220px]' : 'h-[112px]'}`}>
              {file ? (
                <img src={file.url} alt="Your photo" className="absolute inset-0 w-full h-full object-contain bg-surface" />
              ) : (
                <>
                  <Camera size={20} strokeWidth={1.5} className="text-muted mb-1" />
                  <span className="text-[14px] font-semibold">Choose a photo</span>
                  <span className="text-[12px] text-muted">Full length, facing the camera · JPG or PNG</span>
                </>
              )}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[13px]">
            <button onClick={() => camRef.current?.click()} className="h-8 text-muted underline underline-offset-4 hover:text-ink">Take one now</button>
            {file && <button onClick={() => fileRef.current?.click()} className="h-8 text-muted underline underline-offset-4 hover:text-ink">Choose another</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" data-testid="tryon-photo-input" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) choose(f); ev.target.value = '' }} />
          <input ref={camRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) choose(f); ev.target.value = '' }} />

          {file && (
            <div className="mt-3 flex items-center gap-3 fade-in">
              <p className="text-[13px] text-muted">Dress this photo in</p>
              <div className="flex gap-1.5" role="radiogroup" aria-label="Which clothes this photo wears">
                {(['women', 'men'] as const).map((g) => (
                  <button key={g} role="radio" aria-checked={pg === g} data-testid={`photo-gender-${g}`} onClick={() => setPg(g)}
                    className={`h-8 px-3.5 rounded-full border text-[13px] font-medium transition-colors ${pg === g ? 'bg-ink text-white border-ink' : 'border-line hover:border-ink'}`}>{cap(g)}’s</button>
                ))}
              </div>
            </div>
          )}

          <label className="mt-3 flex items-start gap-3 rounded-2xl border border-line px-4 py-3 text-[13px] leading-[19px] text-ink/80 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={(ev) => setConsent(ev.target.checked)} data-testid="tryon-consent" className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--color-ink)]" />
            I consent to {store} sending this photo to its AI image provider only to create this try-on preview. Forget me deletes it any time.
          </label>
          <button data-testid="tryon-generate" disabled={!file || !pg || !consent || !!busy} onClick={upload} aria-busy={busy === 'upload'}
            className="mt-3 w-full h-[50px] rounded-full bg-ink text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 disabled:bg-[#b5b5b5] transition-colors">
            {busy === 'upload' ? <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" /> : <ScanFace size={18} strokeWidth={1.75} />}{busy === 'upload' ? 'Checking your photo…' : 'Generate try-on'}
          </button>
        </>
      )}
      {err && <p className="mt-3 text-[13px] text-accent" role="alert">{err}</p>}

      <div className="mt-5 pt-4 border-t border-line flex gap-2 scroll-x" aria-label="What you’re trying on">
        {products.map((p) => (
          <div key={p.id} className="shrink-0 w-[64px]">
            <img src={abs(p.image_url)} alt="" className="w-[64px] aspect-[3/4] object-cover object-top bg-surface rounded-lg" />
            <p className="mt-1 text-[10px] leading-[13px] text-muted line-clamp-2">{pieceName(p)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ItemsResult({ products, modelId, name, fromLookId }: { products: Product[]; modelId: string | null; name?: string; fromLookId?: string }) {
  const e = useElara()
  const [lookId, setLookId] = useState<string | null>(null)
  const [rootId, setRootId] = useState<string | null>(null)
  const [pairs, setPairs] = useState<Alternative[] | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const started = useRef(false)
  const look: Look | undefined = lookId ? e.looks[lookId] : undefined
  const anchor = products.length === 1 ? products[0] : null
  const pairSlot = anchor ? PAIR[anchor.slot] : undefined
  const chosen = look?.items.find((i) => i.slot === pairSlot)?.product.id

  useEffect(() => {
    if (started.current || !e.session) return
    started.current = true
    api<Look>('/api/tryon', { body: { session_id: e.session.id, product_ids: products.map((p) => p.id), name: name ?? (anchor ? pieceName(anchor) : 'Your pick'), ...(modelId ? { model_id: modelId } : {}) } })
      .then((l) => { e.upsertLook(l); setLookId(l.id); setRootId(l.id) }, (x) => setErr((x as ApiError).message))
  }, [anchor, e, modelId, name, products])

  useEffect(() => {
    if (!rootId || !pairSlot) return
    api<{ items: Alternative[] }>(`/api/looks/${rootId}/alternatives?slot=${pairSlot}`).then((r) => setPairs(r.items.slice(0, 4)), () => setPairs([]))
  }, [rootId, pairSlot])

  const addPair = async (a: Alternative) => {
    if (!lookId || !pairSlot) return  // owned pieces swap in too: they join the look, not the try-on or the cart
    setAdding(a.product.id)
    try {
      const child = await api<Look>(`/api/looks/${lookId}/swap`, { body: { slot: pairSlot, product_id: a.product.id } })
      e.upsertLook(child)
      setLookId(child.id)
    } catch (x) { e.showToast((x as ApiError).message) } finally { setAdding(null) }
  }

  if (err) return <p className="py-10 text-center text-[14px] text-muted">{err}</p>
  if (!look) return <div className="aspect-[3/4] max-w-[320px] mx-auto skeleton rounded-2xl" />
  const ready = look.render.status === 'ready'
  return (
    <div data-testid="tryon-result">
      <div className="rounded-2xl overflow-hidden max-w-[320px] mx-auto"><RenderBox look={look} onOpen={() => e.setViewer(look.id)} /></div>
      <ul className="mt-3 divide-y divide-line">
        {look.items.map(({ slot, product: p }) => (
          <li key={slot + p.id} className="py-2.5 flex items-center gap-3">
            <img src={abs(p.image_url)} alt="" className="w-10 h-[52px] object-cover object-top bg-surface shrink-0" />
            <p className="flex-1 min-w-0 text-[14px] truncate">{pieceName(p)}</p>
            <span className="num text-[14px]">{inr(p.price)}</span>
          </li>
        ))}
      </ul>
      {anchor && <p className="mt-1 text-[12px] text-muted">Your own clothes in the photo stay as they are.</p>}

      {pairSlot && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-2.5">Pairs best with</p>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1" data-testid="tryon-pairs">
            {(pairs ?? Array.from({ length: 3 }, () => null)).map((a, i) =>
              a ? (
                <button key={a.product.id} data-testid="tryon-pair" disabled={!ready || !!adding} onClick={() => addPair(a)}
                  className={`shrink-0 w-[132px] text-left disabled:cursor-wait ${chosen === a.product.id ? 'opacity-100' : ''}`}
                  title={ready ? `Add ${pieceName(a.product)}` : 'Wait for the try-on to finish'}>
                  <div className={`relative aspect-square bg-surface overflow-hidden rounded-xl ${chosen === a.product.id ? 'ring-2 ring-ink ring-offset-2' : ''}`}>
                    <img src={abs(a.product.image_url)} alt={a.product.title} className="w-full h-full object-cover object-top" />
                    <span className="absolute top-2 left-2"><ScoreBadge score={a.score} band={a.score_band} compact /></span>
                    {a.owned ? <span className="absolute bottom-2 left-2 text-[9px] font-semibold uppercase tracking-[0.06em] bg-white text-ink rounded-full px-2 py-0.5" data-testid="pair-owned">Yours</span>
                      : i === 0 && <span className="absolute bottom-2 left-2 text-[9px] font-semibold uppercase tracking-[0.06em] bg-ink text-white rounded-full px-2 py-0.5">Best match</span>}
                    <span className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-white shadow inline-flex items-center justify-center">
                      {adding === a.product.id ? <span className="w-3 h-3 rounded-full border-2 border-line border-t-ink spin" /> : chosen === a.product.id ? <Check size={14} strokeWidth={2.5} /> : <Plus size={14} strokeWidth={2} />}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-[17px] line-clamp-1">{pieceName(a.product)}</p>
                  <p className="num text-[12px] text-muted">{a.owned ? 'In your wardrobe' : inr(a.product.price)}</p>
                </button>
              ) : <div key={i} className="shrink-0 w-[132px] aspect-square skeleton rounded-xl" />,
            )}
            {pairs && pairs.length === 0 && <p className="text-[13px] text-muted py-4">Nothing in the catalogue pairs within your budget yet.</p>}
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center gap-2">
        <AddLookButton look={look} className="flex-1" />
        <button aria-label="Open full view" title="Open full view" onClick={() => e.setViewer(look.id)} className="w-9 h-9 rounded-full border border-line inline-flex items-center justify-center text-muted hover:text-ink hover:border-ink"><Maximize2 size={14} strokeWidth={1.75} /></button>
      </div>
      {fromLookId && e.looks[fromLookId] && (
        <button data-testid="tryon-full-look" onClick={() => { e.setTryon(null); e.renderLook(fromLookId, modelId ?? undefined) }}
          className="mt-3 w-full h-11 rounded-full border border-line text-[13px] font-semibold hover:border-ink transition-colors">
          Try the full “{e.looks[fromLookId].name}” look
        </button>
      )}
    </div>
  )
}
