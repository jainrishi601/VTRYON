import { useEffect, useRef, useState } from 'react'
import { Camera, Check, ChevronDown, Heart, ImageUp, ScanFace, Sun, User, X } from 'lucide-react'
import type { Brief, Tile } from '../shared/types'
import { inr, cap } from '../shared/format'
import { abs, api, ApiError } from './api'
import { useElara } from './state'
import { Chip, Ring } from './ui'

const RELATIONS: [string, 'women' | 'men' | null][] = [
  ['Partner', null], ['Brother', 'men'], ['Sister', 'women'], ['Boyfriend', 'men'], ['Girlfriend', 'women'],
  ['Mum', 'women'], ['Dad', 'men'], ['Friend', null], ['Son', 'men'], ['Daughter', 'women'],
]
const AGES = ['13–17', '18–24', '25–34', '35–49', '50+']
const DEFAULT_OCC = ['Beach trip', 'Wedding', 'Office', 'Date night', 'Everyday', 'Festival']

export function Onboarding() {
  const { stage } = useElara()
  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll" data-testid={`onboarding-${stage}`}>
      {stage === 'who' && <Who />}
      {stage === 'photo' && <Photo />}
      {stage === 'dna' && <DnaPicker />}
    </div>
  )
}

function Steps({ n }: { n: number }) {
  return (
    <div className="flex items-center gap-2 mb-5" aria-label={`Step ${n} of 2`}>
      {[1, 2].map((i) => <span key={i} className={`h-[3px] w-8 rounded-full ${i <= n ? 'bg-ink' : 'bg-line'}`} />)}
      <span className="label text-muted ml-1">Step {n} of 2</span>
    </div>
  )
}

const Label = ({ children }: { children: React.ReactNode }) => <p className="label text-muted mb-3">{children}</p>

function Who() {
  const e = useElara()
  const multi = (e.store?.genders.length ?? 2) > 1
  const b0 = e.brief
  const [who, setWho] = useState<'self' | 'other'>(b0?.for ?? 'self')
  const [relation, setRelation] = useState(b0?.recipient?.relation ?? '')
  const [rAge, setRAge] = useState(b0?.recipient?.age_range ?? '')
  const [rGender, setRGender] = useState<'women' | 'men' | ''>(b0?.recipient?.gender ?? '')
  const [gender, setGender] = useState<'women' | 'men' | 'both' | ''>(b0?.gender ?? '')
  const [occasion, setOccasion] = useState(b0?.occasion ?? '')
  const [occText, setOccText] = useState('')
  const budgetCfg: { min: number; max: number; step: number; default?: number } = e.store?.budget ?? { min: 2000, max: 30000, step: 500, default: 7000 }
  const [budget, setBudget] = useState(b0?.budget_max ?? budgetCfg.default ?? 7000)
  const [noLimit, setNoLimit] = useState(b0 ? b0.budget_max == null : false)
  const [more, setMore] = useState(false)
  const [profession, setProfession] = useState(b0?.profession ?? '')
  const [age, setAge] = useState(b0?.age_range ?? '')
  const [fit, setFit] = useState<Brief['fit'] | ''>(b0?.fit ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const inferred = RELATIONS.find(([r]) => r === relation)?.[1] ?? null
  const needRGender = who === 'other' && relation && !inferred && multi
  const occ = occText.trim() || occasion
  const ready = !!occ && (who === 'self' || !!relation)

  const submit = async () => {
    if (!ready || !e.session) return
    const brief: Brief = {
      for: who,
      occasion: occ,
      budget_max: noLimit ? null : budget,
      ...(who === 'other'
        ? { recipient: { relation: relation.toLowerCase(), ...(inferred || rGender ? { gender: (inferred ?? rGender) as 'women' | 'men' } : {}), ...(rAge ? { age_range: rAge } : {}) } }
        : gender ? { gender } : {}),
      ...(profession.trim() ? { profession: profession.trim() } : {}),
      ...(age ? { age_range: age } : {}),
      ...(fit ? { fit } : {}),
    }
    setSaving(true)
    setErr('')
    try {
      await api(`/api/session/${e.session.id}`, { method: 'PATCH', body: { brief } })
      e.setBrief(brief)
      e.setStage(e.session.photo_url ? 'dna' : 'photo')
    } catch (x) {
      setErr((x as ApiError).message)
    } finally { setSaving(false) }
  }

  return (
    <div className="px-6 pt-6 pb-6 fade-in">
      <Steps n={1} />
      <h2 className="font-serif text-[40px] leading-[1.02]">Hello, I’m Ava. Who are we dressing?</h2>

      <div className="mt-7 h-11 p-1 rounded-full bg-surface grid grid-cols-2" role="radiogroup" aria-label="Who is this for">
        {(['self', 'other'] as const).map((w) => (
          <button key={w} role="radio" aria-checked={who === w} data-testid={`who-${w}`} onClick={() => setWho(w)}
            className={`rounded-full text-[14px] font-medium transition-all duration-150 ${who === w ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,.1)]' : 'text-muted'}`}>
            {w === 'self' ? 'Me' : 'Someone else'}
          </button>
        ))}
      </div>

      {who === 'other' ? (
        <div className="mt-6 fade-in">
          <Label>They are my</Label>
          <div className="flex flex-wrap gap-2">
            {RELATIONS.map(([r]) => <Chip key={r} active={relation === r} onClick={() => setRelation(r)} testid={`relation-${r.toLowerCase()}`}>{r}</Chip>)}
          </div>
          {needRGender && (
            <div className="mt-5 fade-in">
              <Label>Shop from</Label>
              <div className="flex gap-2">{(['women', 'men'] as const).map((g) => <Chip key={g} active={rGender === g} onClick={() => setRGender(g)}>{cap(g)}</Chip>)}</div>
            </div>
          )}
          <div className="mt-5">
            <Label>Their age</Label>
            <div className="flex flex-wrap gap-2">{AGES.map((a) => <Chip key={a} active={rAge === a} onClick={() => setRAge(rAge === a ? '' : a)}>{a}</Chip>)}</div>
          </div>
        </div>
      ) : multi ? (
        <div className="mt-6 fade-in">
          <Label>Shop from</Label>
          <div className="flex gap-2">
            {(['women', 'men', 'both'] as const).map((g) => <Chip key={g} testid={`gender-${g}`} active={gender === g} onClick={() => setGender(gender === g ? '' : g)}>{g === 'both' ? 'Both' : cap(g)}</Chip>)}
          </div>
        </div>
      ) : null}

      <div className="mt-8">
        <Label>The occasion <span className="normal-case tracking-normal text-accent">· required</span></Label>
        <div className="flex flex-wrap gap-2">
          {(e.store?.occasions ?? DEFAULT_OCC).map((o) => (
            <Chip key={o} testid={`occasion-${o.toLowerCase().replace(/\s+/g, '-')}`} active={!occText && occasion === o} onClick={() => { setOccasion(o); setOccText('') }}>{o}</Chip>
          ))}
        </div>
        <input
          value={occText}
          onChange={(ev) => setOccText(ev.target.value)}
          placeholder="Or describe it: a Goa trip in March"
          aria-label="Describe the occasion"
          data-testid="occasion-text"
          className="mt-3 w-full h-11 px-4 rounded-[10px] border border-line text-[15px] outline-none focus:border-ink placeholder:text-muted/70"
        />
      </div>

      <div className="mt-8">
        <div className="flex items-baseline justify-between">
          <Label>Budget per look</Label>
          <span className="num text-[15px] font-medium" data-testid="budget-value">{noLimit ? 'No limit' : `Up to ${inr(budget)}`}</span>
        </div>
        <input
          type="range"
          min={budgetCfg.min}
          max={budgetCfg.max}
          step={budgetCfg.step}
          value={budget}
          disabled={noLimit}
          onChange={(ev) => setBudget(+ev.target.value)}
          aria-label="Budget per look"
          data-testid="budget-slider"
          className="w-full disabled:opacity-30"
        />
        <div className="num flex justify-between text-[12px] text-muted"><span>{inr(budgetCfg.min)}</span><span>{inr(budgetCfg.max)}</span></div>
        <label className="mt-3 inline-flex items-center gap-2.5 text-[14px] cursor-pointer select-none">
          <input type="checkbox" checked={noLimit} onChange={(ev) => setNoLimit(ev.target.checked)} className="w-4 h-4 accent-[var(--color-ink)]" data-testid="budget-nolimit" />
          No limit
        </label>
      </div>

      <div className="mt-6 border-t border-b border-line">
        <button className="w-full h-12 flex items-center justify-between text-[14px]" aria-expanded={more} onClick={() => setMore(!more)}>
          Help me understand you better <span className="text-muted ml-1">(optional)</span>
          <ChevronDown size={16} strokeWidth={1.5} className={`ml-auto transition-transform ${more ? 'rotate-180' : ''}`} />
        </button>
        {more && (
          <div className="pb-5 space-y-5 fade-in">
            <input value={profession} onChange={(ev) => setProfession(ev.target.value)} placeholder="What do you do? e.g. architect" aria-label="Profession"
              className="w-full h-11 px-4 rounded-[10px] border border-line text-[15px] outline-none focus:border-ink placeholder:text-muted/70" />
            <div><Label>Age</Label><div className="flex flex-wrap gap-2">{AGES.slice(1).map((a) => <Chip key={a} active={age === a} onClick={() => setAge(age === a ? '' : a)}>{a}</Chip>)}</div></div>
            <div><Label>Fit you reach for</Label><div className="flex flex-wrap gap-2">{(['relaxed', 'regular', 'fitted'] as const).map((f) => <Chip key={f} active={fit === f} onClick={() => setFit(fit === f ? '' : f)}>{cap(f)}</Chip>)}</div></div>
          </div>
        )}
      </div>

      {err && <p className="mt-4 text-[13px] text-accent">{err}</p>}
      <button
        data-testid="who-continue"
        disabled={!ready || saving}
        onClick={submit}
        className="mt-6 w-full h-[52px] rounded-full bg-ink text-white text-[15px] font-medium disabled:bg-line disabled:text-muted transition-colors"
      >
        {saving ? 'Saving…' : 'Continue'}
      </button>
      {!occ && <p className="mt-2 text-center text-[12px] text-muted">Pick an occasion to continue.</p>}
    </div>
  )
}

// ---------- photo ----------
export async function prepare(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('That file isn’t a photo we can use. Try a JPG or PNG.')
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) throw new Error('We couldn’t open that photo. Try a JPG or PNG.')
  const long = Math.max(bmp.width, bmp.height)
  if (long <= 4096 && file.size <= 10 * 1024 * 1024) return file
  const k = Math.min(1, 4096 / long)
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k)
  c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9))
  if (!out || out.size > 10 * 1024 * 1024) throw new Error('That photo’s size won’t work. Try a JPG or PNG under 10 MB.')
  return out
}

function Photo() {
  const e = useElara()
  const [state, setState] = useState<'idle' | 'checking' | 'rejected' | 'done'>(e.session?.photo_url ? 'done' : 'idle')
  const [preview, setPreview] = useState<string | null>(e.session?.photo_url ? abs(e.session.photo_url) : null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(e.session?.photo_url ?? null)
  const [reason, setReason] = useState('')
  const [model, setModel] = useState<string | null>(e.session?.sample_model_id ?? null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    setModel(null)
    setPreview(URL.createObjectURL(file))
    setState('checking')
    try {
      const blob = await prepare(file)
      const f = new FormData()
      f.set('file', blob, file.name.replace(/\.\w+$/, '') + (blob.type === 'image/png' ? '.png' : '.jpg'))
      const r = await api<{ photo_url: string }>(`/api/session/${e.session!.id}/photo`, { form: f, timeout: 45000 })
      setPhotoUrl(r.photo_url)
      setState('done')
    } catch (x) {
      setReason((x as Error).message)
      setState('rejected')
    }
  }
  const pickModel = async (id: string, url: string) => {
    setModel(id)
    setPreview(abs(url))
    setState('checking')
    try {
      const r = await api<{ photo_url: string }>(`/api/session/${e.session!.id}/photo`, { body: { sample_model_id: id } })
      setPhotoUrl(r.photo_url)
      setState('done')
    } catch (x) {
      setReason((x as ApiError).message)
      setState('rejected')
    }
  }
  const pendingName = e.pendingTryon ? 'that piece' : null
  const g = e.brief?.for === 'other' ? e.brief.recipient?.gender : e.brief?.gender
  const models = (e.models ?? []).slice().sort((a, b) => (g && g !== 'both' ? +(b.gender === g) - +(a.gender === g) : 0))

  return (
    <div className="px-6 pt-6 pb-6 fade-in">
      {!e.pendingTryon && !e.pendingMessage && <Steps n={2} />}
      <h2 className="font-serif text-[40px] leading-[1.02]">See it on you before it ships.</h2>
      {(pendingName || e.pendingMessage) && <p className="mt-3 text-[15px] text-muted">One photo first, then Ava shows you {pendingName ?? 'your looks'} on you.</p>}

      <div className="mt-6 grid grid-cols-[minmax(0,168px)_1fr] gap-5 items-start">
        <div
          className={`relative aspect-[3/4] rounded-[14px] border-[1.5px] border-dashed overflow-hidden transition-colors ${drag ? 'border-ink bg-surface' : state === 'rejected' ? 'border-accent' : 'border-line'} ${preview ? '' : 'bg-surface/60'}`}
          onDragOver={(ev) => { ev.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(ev) => { ev.preventDefault(); setDrag(false); const f = ev.dataTransfer.files[0]; if (f) upload(f) }}
        >
          {preview ? (
            <img src={preview} alt="Your photo" className={`absolute inset-0 w-full h-full object-cover object-top ${state === 'checking' ? 'opacity-60' : ''} ${state === 'rejected' ? 'grayscale opacity-50' : ''}`} />
          ) : (
            <button onClick={() => fileRef.current?.click()} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px] text-muted hover:text-ink" data-testid="photo-dropzone">
              <ImageUp size={22} strokeWidth={1.5} />
              <span>Drop a photo<br />or <u>browse</u></span>
            </button>
          )}
          {state === 'checking' && (
            <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-white to-transparent text-[12px] font-medium flex items-center gap-2"><Ring done={false} /> Checking your photo</div>
          )}
          {state === 'done' && (
            <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-ink text-white inline-flex items-center justify-center" data-testid="photo-ok"><Check size={14} strokeWidth={2.5} /></span>
          )}
        </div>
        <div className="space-y-3.5 pt-1">
          {[
            [User, 'Full body visible, head to toe'],
            [Sun, 'Plain background, good light'],
            [ScanFace, 'Face unobstructed, facing the camera'],
          ].map(([Icon, t], i) => {
            const I = Icon as typeof User
            return <p key={i} className="flex items-start gap-2.5 text-[14px] leading-5"><I size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-muted" />{t as string}</p>
          })}
          <div className="pt-2 flex flex-col gap-2">
            <button onClick={() => fileRef.current?.click()} className="h-10 rounded-full border border-ink text-[13px] font-medium inline-flex items-center justify-center gap-2 hover:bg-ink hover:text-white transition-colors">
              <ImageUp size={15} strokeWidth={1.5} /> {preview && !model ? 'Choose another' : 'Upload photo'}
            </button>
            <button onClick={() => camRef.current?.click()} className="h-10 rounded-full border border-line text-[13px] font-medium inline-flex items-center justify-center gap-2 hover:border-ink transition-colors">
              <Camera size={15} strokeWidth={1.5} /> Take one now
            </button>
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" data-testid="photo-input" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) upload(f); ev.target.value = '' }} />
      <input ref={camRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) upload(f); ev.target.value = '' }} />

      {state === 'rejected' && (
        <p className="mt-4 text-[14px] text-accent flex items-start gap-2" role="alert" data-testid="photo-error"><X size={16} className="mt-0.5 shrink-0" />{reason || 'That photo won’t work. Try another, or use a sample model.'}</p>
      )}

      <div className="mt-7">
        <Label>Or use a sample model</Label>
        <div className="grid grid-cols-4 gap-2.5">
          {models === null || e.models === null
            ? Array.from({ length: 4 }, (_, i) => <div key={i} className="aspect-[3/4] rounded-[10px] skeleton" />)
            : models.slice(0, 4).map((m) => (
                <button
                  key={m.id}
                  data-testid={`sample-model-${m.id}`}
                  onClick={() => pickModel(m.id, m.image_url)}
                  aria-pressed={model === m.id}
                  aria-label={`Use ${m.label}`}
                  className={`relative aspect-[3/4] rounded-[10px] overflow-hidden bg-surface transition-shadow ${model === m.id ? 'ring-2 ring-ink ring-offset-2' : 'hover:ring-1 hover:ring-line'}`}
                >
                  <img src={abs(m.image_url)} alt="" className="w-full h-full object-cover object-top" />
                </button>
              ))}
        </div>
      </div>

      <p className="mt-6 text-[12px] leading-[18px] text-muted">
        Your photo is used only to show you clothes and is deleted when you close this session unless you save your profile.
      </p>
      <button
        data-testid="photo-continue"
        disabled={state !== 'done' || !photoUrl}
        onClick={() => photoUrl && e.photoDone(photoUrl)}
        className="mt-5 w-full h-[52px] rounded-full bg-ink text-white text-[15px] font-medium disabled:bg-line disabled:text-muted transition-colors"
      >
        Continue
      </button>
      {!e.pendingTryon && !e.pendingMessage && (
        <button className="mt-3 w-full text-[13px] text-muted underline underline-offset-4" onClick={() => e.setStage('who')}>Back</button>
      )}
    </div>
  )
}

// ---------- Style DNA ----------
const VIBE_WORD: Record<string, string> = {
  minimal: 'minimal', bold: 'bold', classic: 'classic', street: 'street', boho: 'boho', sporty: 'sporty', romantic: 'romantic', edgy: 'edgy',
}

export function composeOpener(b: { occasion?: string; budget_max?: number | null; for?: string; recipient?: { relation?: string } } | null, liked: string[]) {
  const occ = b?.occasion ? cap(b.occasion) : 'Something new'
  const forWho = b?.for === 'other' && b.recipient?.relation ? ` for my ${b.recipient.relation}` : ''
  const budget = b?.budget_max ? inr(b.budget_max) : 'no fixed budget'
  const vibes = liked.map((v) => VIBE_WORD[v] ?? v)
  const like = vibes.length ? `, you liked ${vibes.length > 1 ? vibes.slice(0, -1).join(', ') + ' and ' + vibes.at(-1) : vibes[0]}` : ''
  return `${occ}${forWho}, ${budget}${like}.`
}

function DnaPicker() {
  const e = useElara()
  const [tiles, setTiles] = useState<Tile[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [verdict, setVerdict] = useState<Record<string, 'heart' | 'cross'>>({})
  const sid = e.session?.id

  useEffect(() => {
    if (!sid) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const r = await api<{ tiles: Tile[] }>(`/api/session/${sid}/dna/tiles`)
        if (!live) return
        setTiles(r.tiles)
        if (r.tiles.some((t) => t.status !== 'ready' && t.status !== 'failed')) timer = setTimeout(poll, 1500)
      } catch { if (live) timer = setTimeout(poll, 3000) }
    }
    api<{ tiles: Tile[] }>(`/api/session/${sid}/dna/tiles`, { body: {}, timeout: 30000 })
      .then((r) => { if (!live) return; setTiles(r.tiles); if (r.tiles.some((t) => t.status !== 'ready' && t.status !== 'failed')) timer = setTimeout(poll, 1500) })
      .catch(() => live && setFailed(true))
    return () => { live = false; clearTimeout(timer) }
  }, [sid])

  const pick = async (t: Tile, v: 'heart' | 'cross') => {
    const next = verdict[t.id] === v ? undefined : v
    setVerdict((m) => { const n = { ...m }; if (next) n[t.id] = next; else delete n[t.id]; return n })
    if (!next) return
    try {
      const r = await api<{ dna: typeof e.dna }>(`/api/session/${sid}/dna/pick`, { body: { tile_id: t.id, verdict: next } })
      if (r.dna) e.setDna(r.dna)
    } catch { /* the pick still shapes the opener */ }
  }
  const picks = Object.keys(verdict).length
  const liked = (tiles ?? []).filter((t) => verdict[t.id] === 'heart').map((t) => t.vibe)
  const finish = (useLikes: boolean) => {
    e.setStage('chat')
    e.send(composeOpener(e.brief, useLikes ? liked : []))
  }
  const name = e.dna?.name
  const traits = e.dna?.traits ?? []

  return (
    <div className="px-6 pt-6 fade-in" data-testid="dna-picker">
      <p className="label text-accent">Style DNA</p>
      <h2 className="font-serif text-[34px] leading-[1.05] mt-2">Pick what feels like you.</h2>
      <p className="mt-2 text-[14px] leading-[22px] text-muted">This teaches your stylist before you’ve bought anything.</p>

      {failed ? (
        <div className="mt-10 text-center py-10 bg-surface rounded-[14px]">
          <p className="font-serif text-[24px]">The style tiles didn’t load.</p>
          <button className="mt-4 h-10 px-5 rounded-full bg-ink text-white text-[14px]" onClick={() => finish(false)}>Start chatting instead</button>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 max-w-[316px] mx-auto">
          {(tiles ?? Array.from({ length: 4 }, () => null)).map((t, i) => {
            const v = t ? verdict[t.id] : undefined
            const img = t?.image_url ?? (t?.status === 'failed' ? t.product.image_url : null)
            return (
              <div key={t?.id ?? i} data-testid="dna-tile" data-status={t?.status ?? 'loading'}
                className={`relative aspect-[3/4] rounded-[14px] overflow-hidden bg-surface transition-all duration-200 ${v === 'heart' ? 'ring-2 ring-ink ring-offset-2' : ''}`}>
                {!t || (t.status !== 'ready' && t.status !== 'failed') || !img ? (
                  <div className="absolute inset-0 skeleton flex items-end justify-center pb-16">
                    <span className="text-[12px] text-muted flex items-center gap-2"><Ring done={false} /> Rendering…</span>
                  </div>
                ) : (
                  <img src={abs(img)} alt={`${cap(t.vibe)} look: ${t.product.title}`} className={`absolute inset-0 w-full h-full object-cover object-top reveal transition-[filter,opacity] duration-300 ${v === 'cross' ? 'grayscale opacity-40' : ''}`} />
                )}
                {t && <span className="label absolute top-2.5 left-2.5 !text-[10px] bg-white/90 px-2 py-1 rounded-full">{t.vibe}</span>}
                {v === 'heart' && <span className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-ink text-white inline-flex items-center justify-center"><Check size={13} strokeWidth={3} /></span>}
                {t && (
                  <div className="absolute bottom-2.5 inset-x-0 flex justify-center gap-3">
                    <button aria-label={`Not for me: ${t.vibe}`} aria-pressed={v === 'cross'} data-testid="dna-cross" onClick={() => pick(t, 'cross')}
                      className={`w-10 h-10 rounded-full inline-flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,.12)] transition-colors ${v === 'cross' ? 'bg-ink text-white' : 'bg-white text-ink'}`}><X size={17} strokeWidth={2} /></button>
                    <button aria-label={`Love it: ${t.vibe}`} aria-pressed={v === 'heart'} data-testid="dna-heart" onClick={() => pick(t, 'heart')}
                      className={`w-10 h-10 rounded-full inline-flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,.12)] transition-colors ${v === 'heart' ? 'bg-ink text-white' : 'bg-white text-ink'}`}><Heart size={17} strokeWidth={2} fill={v === 'heart' ? 'currentColor' : 'none'} /></button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="sticky bottom-0 -mx-6 px-6 pt-4 pb-5 mt-1 bg-white/95 backdrop-blur-[2px] border-t border-line/60">
      <div className="min-h-[64px]" aria-live="polite">
        {picks >= 2 && name ? (
          <div className="fade-in" data-testid="dna-result">
            <p className="label text-muted">Your Style DNA</p>
            <p className="font-serif text-[30px] leading-tight mt-1" data-testid="dna-name">{name}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{traits.slice(0, 3).map((t) => <span key={t} className="h-7 px-3 rounded-full bg-surface text-[12px] inline-flex items-center">{t}</span>)}</div>
          </div>
        ) : (
          <p className="text-[13px] text-muted num">{picks === 0 ? 'Tap ♥ or ✕ on at least two.' : `${picks} of 2 picked`}</p>
        )}
      </div>

      <button data-testid="dna-continue" disabled={picks < 2} onClick={() => finish(true)}
        className="mt-3 w-full h-[52px] rounded-full bg-ink text-white text-[15px] font-medium disabled:bg-line disabled:text-muted transition-colors">
        Continue
      </button>
      <button data-testid="dna-skip" className="mt-3 w-full text-[13px] text-muted underline underline-offset-4 hover:text-ink" onClick={() => finish(false)}>Just start chatting</button>
      </div>
    </div>
  )
}
