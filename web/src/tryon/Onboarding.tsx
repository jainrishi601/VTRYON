import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Heart, Layers, Shirt, ShoppingBag, Sparkles, ThumbsDown, ThumbsUp, User as UserIcon, Users } from 'lucide-react'
import { navigate } from '../store/lib'
import { call, type Gender, type Options, type Profile, type User, type Vibe } from './api'

/** Onboarding for a cold-start shopper: 8 short steps (and three breathers) that fill the profile and teach the Style
 *  DNA — goal, who we shop for, photos, sizes, body, colours from the selfie, vibes swiped on their own photo, and the
 *  never list. Each Continue saves, so "Setup later" never loses anything. */
const FLOW = ['goal', 'shop', 'photos-intro', 'photos', 'fit-intro', 'sizes', 'body', 'taste-intro', 'colors', 'vibes', 'never', 'done', 'sync'] as const
type StepId = (typeof FLOW)[number]
const NUM: Partial<Record<StepId, number>> = { goal: 1, shop: 2, photos: 3, sizes: 4, body: 5, colors: 6, vibes: 7, never: 8 }
const PROFESSIONS = ['Student', 'Software engineer', 'Designer', 'Doctor', 'Lawyer', 'Finance', 'Marketing', 'Founder', 'Teacher', 'Creative', 'Other']
const AGES = ['18–24', '25–34', '35–44', '45–54', '55+']
const REGIONS = ['India', 'Asia', 'Europe', 'UK', 'US']

export function Onboarding({ me, onUser }: { me: User; onUser: (u: User) => void }) {
  const [p, setP] = useState<Profile>(me.profile)
  const [i, setI] = useState(() => Math.min(Math.max(0, me.profile.step ?? 0), FLOW.indexOf('never')))
  const [opts, setOpts] = useState<Options | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const step = FLOW[i]
  useEffect(() => { call<Options>('/api/tryon/options').then(setOpts, () => {}) }, [])

  const save = useCallback(async (patch: Partial<Profile>) => {
    const np = await call<Profile>('/api/me/profile', { method: 'PATCH', body: patch })
    setP(np)
    return np
  }, [])
  const next = async (patch: Partial<Profile> = {}) => {
    setBusy(true); setErr('')
    try {
      await save({ ...patch, step: i + 1 })
      setI(i + 1)
    } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  const finish = async () => {
    await save({ onboarded: true, step: 0 })
    const u = await call<User>('/api/me')
    onUser(u)
    navigate('/tryon/dna')
  }

  if (step === 'sync') return <Sync onDone={finish} />
  return (
    <div className="t-app min-h-screen bg-[#0d0d0d] text-white flex items-center justify-center p-3 sm:p-8">
      <div className="t-card-dark w-full max-w-[920px] rounded-[28px] border border-white/10 flex flex-col overflow-hidden min-h-[640px] max-h-[94vh]" data-testid={`onb-${step}`}>
        <div className="px-7 sm:px-12 pt-8 shrink-0">
          {i > 0 && <button onClick={() => setI(i - 1)} className="text-[15px] text-white/70 hover:text-white inline-flex items-center gap-1.5" data-testid="onb-back"><ChevronLeft size={18} />Back</button>}
          <p className="t-mark-light text-[40px] leading-none mt-4">tryon</p>
          {NUM[step] && <p className="mt-6 text-[13px] font-semibold tracking-[0.08em] text-white/60">STEP {NUM[step]}/8</p>}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-7 sm:px-12 pb-8 pt-4" key={step}>
          <div className="t-fade">
            {step === 'goal' && <Goal p={p} setP={setP} name={me.name} />}
            {step === 'shop' && <Shop p={p} setP={setP} />}
            {step === 'photos-intro' && <Breather text="TRYON works best when it can see you. Add a selfie and a full-body photo, so we can read your colouring and run try-ons on you." art="photo" />}
            {step === 'photos' && <Photos p={p} setP={setP} />}
            {step === 'fit-intro' && <Breather text="Last structured bit, then it’s the fun part." art="list" />}
            {step === 'sizes' && <Sizes p={p} setP={setP} sizes={opts?.sizes ?? []} />}
            {step === 'body' && <Body p={p} setP={setP} />}
            {step === 'taste-intro' && <Breather text="Now, let’s dial in your taste. Swipe on looks, worn by you, to teach TRYON your style." art="cards" />}
            {step === 'colors' && <Colors p={p} setP={setP} opts={opts} />}
            {step === 'vibes' && <Vibes hasBody={!!p.body_url} />}
            {step === 'never' && <Never p={p} setP={setP} opts={opts} />}
            {step === 'done' && <Breather text="You’re all set. Let’s build your style profile." art="done" />}
          </div>
          {err && <p className="mt-4 text-[14px] text-[#ff8a65]" role="alert">{err}</p>}
        </div>
        <div className="shrink-0 border-t border-white/10 px-7 sm:px-12 py-5 flex items-center gap-3">
          <button onClick={() => navigate('/tryon/dna')} className="text-[16px] text-white/60 hover:text-white" data-testid="onb-later">Setup later</button>
          <div className="ml-auto flex gap-2.5">
            {(['photos', 'sizes', 'body'] as StepId[]).includes(step) && (
              <button onClick={() => next()} disabled={busy} className="h-12 px-6 rounded-xl bg-white/10 text-[16px] font-medium hover:bg-white/15" data-testid="onb-skip">{step === 'photos' ? 'Skip all' : 'Skip'}</button>
            )}
            <button onClick={() => (step === 'done' ? setI(i + 1) : next(patchFor(step, p)))} disabled={busy || !canGo(step, p)} data-testid="onb-continue"
              className="h-12 px-7 rounded-xl bg-white text-[#0a0a0a] text-[16px] font-medium disabled:bg-white/40 transition-colors">
              {busy ? 'Saving…' : step === 'done' ? 'Build my profile' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function patchFor(step: StepId, p: Profile): Partial<Profile> {
  switch (step) {
    case 'goal': return { goal: p.goal }
    case 'shop': return { gender: p.gender, profession: p.profession, age_range: p.age_range }
    case 'sizes': return { sizes: p.sizes }
    case 'body': return { height_cm: p.height_cm, weight_kg: p.weight_kg }
    case 'colors': return { colors: p.colors ?? [] }
    case 'never': return { never: p.never ?? [] }
    default: return {}
  }
}
const canGo = (step: StepId, p: Profile) => (step === 'goal' ? !!p.goal : step === 'shop' ? !!p.gender : true)

const H = ({ children }: { children: React.ReactNode }) => <h2 className="t-serif text-[34px] sm:text-[44px] leading-[1.12]">{children}</h2>

function Card({ on, onClick, children, testid }: { on: boolean; onClick: () => void; children: React.ReactNode; testid?: string }) {
  return (
    <button onClick={onClick} data-testid={testid} aria-pressed={on}
      className={`relative text-left rounded-[22px] border p-6 transition-colors ${on ? 'border-white bg-white/[0.06]' : 'border-white/12 bg-white/[0.03] hover:border-white/40'}`}>
      {on && <span className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/60 border border-white/70 inline-flex items-center justify-center"><Check size={15} strokeWidth={2.5} /></span>}
      {children}
    </button>
  )
}

function Sticker({ icon: Icon, tone = 'violet', size = 76 }: { icon: typeof Shirt; tone?: 'violet' | 'lime' | 'sky'; size?: number }) {
  const bg = { violet: 'from-[#b9a8ff] to-[#7b5cff]', lime: 'from-[#e3f5b0] to-[#a7cf63]', sky: 'from-[#cfe6ff] to-[#8eb8f0]' }[tone]
  return (
    <span className={`inline-flex items-center justify-center rounded-[20px] bg-gradient-to-br ${bg} border-[3px] border-white shadow-lg -rotate-6`} style={{ width: size, height: size }}>
      <Icon size={size * 0.48} strokeWidth={1.6} className="text-[#2b1f6b]" />
    </span>
  )
}

function Breather({ text, art }: { text: string; art: 'photo' | 'list' | 'cards' | 'done' }) {
  return (
    <div className="py-2">
      <H>{text}</H>
      <div className="mt-12 h-[220px] flex items-center justify-center gap-3">
        {art === 'photo' && <><Sticker icon={Shirt} tone="lime" /><Sticker icon={UserIcon} size={120} /><Sticker icon={Layers} tone="sky" /></>}
        {art === 'list' && <><Sticker icon={Check} tone="lime" size={96} /><Sticker icon={Shirt} size={120} /></>}
        {art === 'cards' && <><Sticker icon={Heart} tone="sky" size={96} /><Sticker icon={Sparkles} size={120} /><Sticker icon={Shirt} tone="lime" size={96} /></>}
        {art === 'done' && <><Sticker icon={Layers} tone="sky" /><Sticker icon={Sparkles} size={120} /><Sticker icon={ShoppingBag} tone="lime" /></>}
      </div>
    </div>
  )
}

type StepProps = { p: Profile; setP: (f: (p: Profile) => Profile) => void }

function Goal({ p, setP, name }: StepProps & { name: string }) {
  const goals: [Profile['goal'], string, string, typeof Shirt][] = [
    ['build', 'Build a new wardrobe', 'I’m starting fresh and want complete outfit ideas.', Shirt],
    ['utilise', 'Use my wardrobe', 'Help me make new looks from what I already own.', Layers],
    ['mindful', 'Shop more mindfully', 'Find pieces that really match my style and needs.', ShoppingBag],
  ]
  return (
    <>
      <H>Good to meet you, <em className="text-[#b9a8ff]">{name}</em>.<br />So, why are you here?</H>
      <div className="mt-9 grid sm:grid-cols-3 gap-4">
        {goals.map(([k, t, d, I]) => (
          <Card key={k} on={p.goal === k} onClick={() => setP((x) => ({ ...x, goal: k }))} testid={`goal-${k}`}>
            <Sticker icon={I} tone={k === 'utilise' ? 'sky' : k === 'mindful' ? 'lime' : 'violet'} size={64} />
            <p className="mt-7 text-[18px] font-semibold">{t}</p>
            <p className="mt-1.5 text-[15px] leading-[22px] text-white/55">{d}</p>
          </Card>
        ))}
      </div>
    </>
  )
}

function Select({ label, value, onChange, options, placeholder, testid }: { label: string; value?: string; onChange: (v: string) => void; options: string[]; placeholder: string; testid?: string }) {
  return (
    <label className="block">
      <span className="text-[16px] font-semibold">{label}</span>
      <div className="relative mt-3">
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} data-testid={testid}
          className="w-full h-14 pl-5 pr-12 rounded-2xl bg-[#1d1d1d] border border-white/10 appearance-none text-[16px] outline-none focus:border-white/60">
          <option value="" disabled>{placeholder}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={18} className="absolute right-5 top-1/2 -translate-y-1/2 text-white/60 pointer-events-none" />
      </div>
    </label>
  )
}

function Shop({ p, setP }: StepProps) {
  const g: [Gender, string, typeof UserIcon][] = [['women', 'Women’s', UserIcon], ['men', 'Men’s', UserIcon], ['both', 'Both', Users]]
  return (
    <>
      <H>How do you want me to shop for you?</H>
      <div className="mt-8 grid grid-cols-3 gap-4">
        {g.map(([k, t, I]) => (
          <Card key={k} on={p.gender === k} onClick={() => setP((x) => ({ ...x, gender: k }))} testid={`gender-${k}`}>
            <div className="py-3 flex flex-col items-center"><Sticker icon={I} tone={k === 'men' ? 'sky' : k === 'both' ? 'lime' : 'violet'} size={68} /><p className="mt-5 text-[18px] font-semibold">{t}</p></div>
          </Card>
        ))}
      </div>
      <div className="mt-8 space-y-6">
        <Select label="Profession" value={p.profession} onChange={(v) => setP((x) => ({ ...x, profession: v }))} options={PROFESSIONS} placeholder="Pick one (optional)" testid="profession" />
        <Select label="Age range" value={p.age_range} onChange={(v) => setP((x) => ({ ...x, age_range: v }))} options={AGES} placeholder="Pick one (optional)" testid="age" />
      </div>
    </>
  )
}

function Photos({ p, setP }: StepProps) {
  return (
    <>
      <H>Selfie for your undertone and colouring. Full body for fit and try-on. Both help.</H>
      <div className="mt-8 grid sm:grid-cols-2 gap-4">
        <PhotoBox kind="selfie" title="Selfie" sub="Skin undertone & colour" url={p.selfie_url} onSaved={(np) => setP(() => np)} />
        <PhotoBox kind="body" title="Full body" sub="One person, face and legs visible, at least 70% of your body; head to toe is best." url={p.body_url} onSaved={(np) => setP(() => np)} />
      </div>
      <p className="mt-5 text-[13px] text-white/45">Used only to read your colouring and to show clothes on you. You can delete them from your profile any time.</p>
    </>
  )
}

function PhotoBox({ kind, title, sub, url, onSaved }: { kind: 'selfie' | 'body'; title: string; sub: string; url?: string; onSaved: (p: Profile) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const up = async (f: File) => {
    setBusy(true); setErr('')
    const form = new FormData()
    form.set('file', f)
    try { onSaved(await call<Profile>(`/api/me/photo?kind=${kind}`, { form })) } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-[22px] border border-white/12 bg-white/[0.03] p-6 flex flex-col">
      <p className="text-[16px] font-semibold">{title}</p>
      <p className="mt-1 text-[14px] leading-[20px] text-white/55">{sub}</p>
      <div className="mt-5 flex-1 flex flex-col items-center justify-center gap-3 min-h-[230px]">
        {url ? <img src={url} alt={`Your ${title.toLowerCase()}`} className="h-[220px] rounded-2xl object-cover bg-black" /> : busy ? <div className="h-[220px] w-[160px] rounded-2xl t-skel-dark" /> : <Camera size={30} strokeWidth={1.4} className="text-white/40" />}
        <button onClick={() => ref.current?.click()} disabled={busy} data-testid={`photo-${kind}`} className="h-11 px-6 rounded-xl bg-black border border-white/15 text-[15px] font-medium hover:border-white/50">{busy ? 'Checking…' : url ? 'Replace' : 'Upload'}</button>
        {url && !busy && <p className="text-[13px] text-white/55">Saved</p>}
        {err && <p className="text-[13px] text-[#ff8a65] text-center" role="alert">{err}</p>}
      </div>
      <input ref={ref} type="file" accept="image/jpeg,image/png" className="hidden" data-testid={`photo-${kind}-input`} onChange={(e) => { const f = e.target.files?.[0]; if (f) up(f); e.target.value = '' }} />
    </div>
  )
}

function Sizes({ p, setP, sizes }: StepProps & { sizes: string[] }) {
  const sz = p.sizes ?? {}
  const set = (k: string, v: string) => setP((x) => ({ ...x, sizes: { ...(x.sizes ?? {}), [k]: v } }))
  return (
    <>
      <H>Pick your region and your usual sizes. Exact numbers are welcome if you know them.</H>
      <div className="mt-8 space-y-4">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5"><Select label="Sizing region" value={sz.region} onChange={(v) => set('region', v)} options={REGIONS} placeholder="Pick a region" testid="size-region" /></div>
        <div className="grid sm:grid-cols-2 gap-4">
          {[['tops', 'Tops', 'Shirts, tees, jackets'], ['bottoms', 'Bottoms', 'Jeans, trousers, skirts'], ...(p.gender !== 'men' ? [['dresses', 'Dresses', 'One-piece sizing']] : [])].map(([k, t, d]) => (
            <div key={k} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-[16px] font-semibold">{t}</p><p className="text-[14px] text-white/55 -mt-0.5 mb-[-4px]">{d}</p>
              <Select label="" value={(sz as Record<string, string>)[k]} onChange={(v) => set(k, v)} options={sizes} placeholder="Size" testid={`size-${k}`} />
            </div>
          ))}
          <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[16px] font-semibold">Footwear</p><p className="text-[14px] text-white/55">Numbers only</p>
            <input value={sz.footwear ?? ''} onChange={(e) => set('footwear', e.target.value.replace(/[^\d.]/g, '').slice(0, 4))} inputMode="decimal" placeholder="e.g. 8"
              className="mt-3 w-full h-14 px-5 rounded-2xl bg-[#1d1d1d] border border-white/10 outline-none focus:border-white/60 text-[16px]" />
          </div>
        </div>
      </div>
    </>
  )
}

function Body({ p, setP }: StepProps) {
  const [ft, setFt] = useState(false)
  const [lbs, setLbs] = useState(false)
  const h = p.height_cm ?? 168
  const w = p.weight_kg ?? 62
  const hShow = ft ? `${Math.floor(h / 30.48)}′${Math.round((h / 2.54) % 12)}″` : `${h}`
  const wShow = lbs ? `${Math.round(w * 2.205)}` : `${w}`
  const Stepper = ({ title, unit, alt, on, toggle, value, step }: { title: string; unit: string; alt: string; on: boolean; toggle: () => void; value: string; step: (d: number) => void }) => (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center justify-between">
        <p className="text-[18px] font-semibold">{title}</p>
        <span className="inline-flex items-center gap-2.5 text-[15px] text-white/70">{unit}
          <button onClick={toggle} role="switch" aria-checked={on} className={`w-14 h-8 rounded-full p-1 transition-colors ${on ? 'bg-[#7b5cff]' : 'bg-white/10'}`}><span className={`block w-6 h-6 rounded-full bg-black border border-white/20 transition-transform ${on ? 'translate-x-6' : ''}`} /></button>{alt}</span>
      </div>
      <div className="mt-5 rounded-2xl bg-[#141414] h-[150px] px-6 flex items-center justify-between">
        <p className="num"><span className="text-[46px] font-semibold">{value}</span> <span className="text-[18px] text-white/50">{on ? alt : unit}</span></p>
        <div className="flex flex-col gap-3"><button aria-label={`More ${title.toLowerCase()}`} onClick={() => step(1)}><ChevronUp size={20} className="text-white/60" /></button><button aria-label={`Less ${title.toLowerCase()}`} onClick={() => step(-1)}><ChevronDown size={20} className="text-white/60" /></button></div>
      </div>
    </div>
  )
  return (
    <>
      <H>Help me get your fit right off the bat.</H>
      <div className="mt-8 grid sm:grid-cols-2 gap-4">
        <Stepper title="Height" unit="cm" alt="ft" on={ft} toggle={() => setFt(!ft)} value={hShow} step={(d) => setP((x) => ({ ...x, height_cm: Math.max(120, Math.min(220, (x.height_cm ?? 168) + d)) }))} />
        <Stepper title="Weight" unit="kg" alt="lbs" on={lbs} toggle={() => setLbs(!lbs)} value={wShow} step={(d) => setP((x) => ({ ...x, weight_kg: Math.max(35, Math.min(200, (x.weight_kg ?? 62) + d)) }))} />
      </div>
    </>
  )
}

function Colors({ p, setP, opts }: StepProps & { opts: Options | null }) {
  const [pal, setPal] = useState(p.palette ?? null)
  const [none, setNone] = useState(p.colors?.length === 0 && !!p.palette)
  const asked = useRef(false) // one analysis per visit (dev StrictMode runs effects twice)
  useEffect(() => {
    if (pal || asked.current) return
    asked.current = true
    call<NonNullable<Profile['palette']>>('/api/me/colors/analyze', { body: {} }).then((r) => {
      setPal(r)
      setP((x) => ({ ...x, colors: x.colors?.length ? x.colors : r.recommended }))
    }, () => setPal({ undertone: null, summary: '', recommended: [], analyzed: false }))
  }, [pal, setP])
  const chosen = new Set(none ? [] : p.colors ?? [])
  const toggle = (n: string) => { setNone(false); setP((x) => { const s = new Set(x.colors ?? []); s.has(n) ? s.delete(n) : s.add(n); return { ...x, colors: [...s] } }) }
  const all = opts?.palette ?? []
  const rec = all.filter((c) => pal?.recommended.includes(c.name))
  const rest = all.filter((c) => !pal?.recommended.includes(c.name))
  const Swatch = ({ c }: { c: { name: string; hex: string } }) => (
    <button onClick={() => toggle(c.name)} disabled={none} aria-pressed={chosen.has(c.name)} data-testid={`shade-${c.name}`} className="flex flex-col items-center gap-2 disabled:opacity-40">
      <span className={`relative w-[72px] h-[72px] rounded-[18px] border-2 ${chosen.has(c.name) ? 'border-white' : 'border-transparent'} p-1`}>
        <span className="block w-full h-full rounded-[14px]" style={{ background: c.hex }} />
        {chosen.has(c.name) && <Check size={22} strokeWidth={2.5} className="absolute inset-0 m-auto text-white drop-shadow" />}
      </span>
      <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-white/70">{c.name}</span>
    </button>
  )
  return (
    <>
      <H>{p.selfie_url || p.body_url ? 'Based on your photo, these are the shades that’ll work best on you. Add or remove anything you want.' : 'Pick the shades you love wearing. Add a selfie later and TRYON will suggest more.'}</H>
      <button onClick={() => { setNone(!none); setP((x) => ({ ...x, colors: !none ? [] : pal?.recommended ?? [] })) }} className="mt-7 w-full h-16 px-6 rounded-2xl border border-white/12 flex items-center justify-between text-[16px] font-medium" data-testid="no-colors">
        No preferred colours
        <span className={`w-14 h-8 rounded-full p-1 transition-colors ${none ? 'bg-[#7b5cff]' : 'bg-white/10'}`}><span className={`block w-6 h-6 rounded-full bg-white transition-transform ${none ? 'translate-x-6' : ''}`} /></span>
      </button>
      {!pal ? (
        <p className="mt-10 text-[18px]"><span className="t-shine">Reading your colouring…</span></p>
      ) : (
        <>
          {rec.length > 0 && (
            <div className="mt-8">
              <p className="text-[13px] font-semibold tracking-[0.08em] text-white/70">RECOMMENDED{pal.undertone ? ` · ${pal.undertone.toUpperCase()} UNDERTONE` : ''}</p>
              <p className="mt-1 text-[14px] text-white/55">{pal.analyzed ? pal.summary || 'From the colour analysis of your photo.' : pal.summary}</p>
              <div className="mt-5 flex flex-wrap gap-4">{rec.map((c) => <Swatch key={c.name} c={c} />)}</div>
            </div>
          )}
          <p className="mt-10 text-center text-[13px] font-semibold tracking-[0.08em] text-white/60">ALL COLOURS</p>
          <div className="mt-5 flex flex-wrap gap-4">{rest.map((c) => <Swatch key={c.name} c={c} />)}</div>
        </>
      )}
    </>
  )
}

function Vibes({ hasBody }: { hasBody: boolean }) {
  const [list, setList] = useState<Vibe[] | null>(null)
  const [out, setOut] = useState<'' | 'left' | 'right' | 'up'>('')
  const [votes, setVotes] = useState<Record<string, string>>({})
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    call<{ vibes: Vibe[] }>('/api/me/vibes/start', { body: {} }).then((r) => setList(r.vibes), () => setList([]))
  }, [])
  useEffect(() => {
    if (!list?.some((v) => v.status === 'pending')) return
    const t = setTimeout(() => call<{ vibes: Vibe[] }>('/api/me/vibes').then((r) => setList(r.vibes), () => {}), 2500)
    return () => clearTimeout(t)
  }, [list])
  const pending = (list ?? []).filter((v) => !(votes[v.id] ?? v.verdict))
  const cur = pending[0]
  const vote = useCallback((verdict: 'love' | 'like' | 'dislike') => {
    if (!cur || out) return
    setOut(verdict === 'dislike' ? 'left' : verdict === 'like' ? 'right' : 'up')
    call(`/api/me/vibes/${cur.id}`, { body: { verdict } }).catch(() => {})
    setTimeout(() => { setVotes((v) => ({ ...v, [cur.id]: verdict })); setOut('') }, 240)
  }, [cur, out])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') vote('dislike'); if (e.key === 'ArrowRight') vote('like'); if (e.key === 'ArrowUp') vote('love') }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [vote])
  const ready = (list ?? []).filter((v) => v.rendered).length
  const img = (v: Vibe) => (v.image_url ?? v.product?.image_url ?? '')
  return (
    <>
      <H>Choose the vibes you identify with</H>
      <p className="mt-3 text-[16px] text-white/60 num" data-testid="vibes-progress">
        {!list ? 'Getting your looks ready…' : hasBody ? `${ready} of ${list.length} looks ready on you.` : 'Shown flat: add a full-body photo to see these on you.'}
      </p>
      {list && !cur ? (
        <div className="mt-10 text-center"><Sticker icon={Sparkles} size={96} /><p className="mt-6 text-[18px]">That’s every look. Continue when you’re ready.</p></div>
      ) : (
        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <Hint side="left" onClick={() => vote('dislike')} />
          <div className="flex flex-col items-center">
            <button onClick={() => vote('love')} className="w-14 h-14 rounded-full border border-[#7b5cff] text-[#a594ff] inline-flex items-center justify-center" aria-label="Love it"><ChevronUp size={22} /></button>
            <p className="mt-2 text-[15px] text-white/70">Swipe up to love</p>
            <div className="relative mt-5 w-[240px] sm:w-[268px] aspect-[3/4]">
              <div className="absolute inset-0 rounded-[26px] bg-[#232323] border border-white/10 rotate-[4deg] translate-y-3" />
              <div className="absolute inset-0 rounded-[26px] bg-[#1c1c1c] border border-white/10 rotate-[-3deg] translate-y-1.5" />
              {cur ? (
                <div key={cur.id} className={`absolute inset-0 rounded-[26px] overflow-hidden border-[6px] border-[#2a2a2a] bg-[#b9b2a8] shadow-2xl rotate-[-2deg] t-pop ${out ? `t-swipe-${out}` : ''}`} data-testid="vibe-card" data-vibe={cur.vibe}>
                  {cur.status === 'pending' && hasBody ? <div className="absolute inset-0 t-skel-dark" /> : <img src={img(cur)} alt={`${cur.vibe} look`} className="absolute inset-0 w-full h-full object-cover object-top" />}
                  <div className="absolute inset-x-0 bottom-0 p-4 pt-16 bg-gradient-to-t from-black/80 to-transparent">
                    <p className="t-serif text-[28px] leading-none capitalize">{cur.vibe}</p>
                    <p className="text-[13px] text-white/75 mt-1">{cur.line}{cur.status === 'pending' && hasBody ? ' · putting it on you…' : ''}</p>
                    <div className="mt-3 flex justify-center gap-3">
                      <button onClick={() => vote('dislike')} aria-label="Not for me" data-testid="vibe-dislike" className="w-12 h-12 rounded-full border-2 border-[#e5484d] bg-black/40 inline-flex items-center justify-center"><ThumbsDown size={18} className="text-[#ff6b6b]" /></button>
                      <button onClick={() => vote('love')} aria-label="Love it" data-testid="vibe-love" className="w-12 h-12 rounded-full border-2 border-[#7b5cff] bg-black/40 inline-flex items-center justify-center"><Heart size={18} className="text-[#a594ff]" fill="#a594ff" /></button>
                      <button onClick={() => vote('like')} aria-label="Like it" data-testid="vibe-like" className="w-12 h-12 rounded-full border-2 border-[#30a46c] bg-black/40 inline-flex items-center justify-center"><ThumbsUp size={18} className="text-[#4cc38a]" /></button>
                    </div>
                  </div>
                </div>
              ) : <div className="absolute inset-0 rounded-[26px] t-skel-dark" />}
            </div>
          </div>
          <Hint side="right" onClick={() => vote('like')} />
        </div>
      )}
    </>
  )
}

const Hint = ({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) => (
  <div className={`hidden sm:flex flex-col items-center gap-3 ${side === 'left' ? 'justify-self-end' : 'justify-self-start'}`}>
    <button onClick={onClick} className="w-16 h-16 rounded-full bg-[#262626] border border-white/10 inline-flex items-center justify-center hover:bg-[#303030]" aria-label={side === 'left' ? 'Dislike' : 'Like'}>
      {side === 'left' ? <ChevronLeft size={24} /> : <ChevronRight size={24} />}
    </button>
    <p className="text-[15px] text-white/70 text-center leading-5">Click {side}<br />arrow to {side === 'left' ? 'dislike' : 'like'}</p>
  </div>
)

function Never({ p, setP, opts }: StepProps & { opts: Options | null }) {
  const on = new Set(p.never ?? [])
  const toggle = (k: string) => setP((x) => { const s = new Set(x.never ?? []); s.has(k) ? s.delete(k) : s.add(k); return { ...x, never: [...s] } })
  return (
    <>
      <div className="flex items-start gap-4">
        <H>Anything you’d never wear? I’ll keep it out of every look.</H>
        <span className="shrink-0 mt-2 h-10 px-4 rounded-full border border-[#7b5cff]/60 text-[#b9a8ff] text-[15px] inline-flex items-center num">{on.size} selected</span>
      </div>
      <button onClick={() => setP((x) => ({ ...x, never: [] }))} className="mt-5 text-[15px] text-[#b9a8ff] underline underline-offset-4">Nothing is off-limits</button>
      <div className="mt-6 space-y-7">
        {Object.entries(opts?.never ?? {}).map(([group, items]) => (
          <div key={group}>
            <p className="text-[13px] font-semibold tracking-[0.08em] text-white/60 uppercase">{group}</p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {items.map((it) => (
                <button key={it.key} onClick={() => toggle(it.key)} aria-pressed={on.has(it.key)} data-testid={`never-${it.key}`}
                  className={`h-11 px-5 rounded-full border text-[15px] transition-colors ${on.has(it.key) ? 'bg-white text-[#0a0a0a] border-white' : 'border-white/20 hover:border-white/50'}`}>{it.label}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function Sync({ onDone }: { onDone: () => void }) {
  const done = useRef(false)
  useEffect(() => {
    const t = setTimeout(() => { if (!done.current) { done.current = true; onDone() } }, 2600)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="t-app min-h-screen bg-[#0d0d0d] text-white flex items-center justify-center p-6" data-testid="onb-sync">
      <div className="t-card-dark w-full max-w-[920px] rounded-[28px] border border-white/10 py-24 px-8 flex flex-col items-center text-center">
        <div className="t-wave h-12 flex items-center">{[0, 1, 2, 3, 4].map((i) => <span key={i} />)}</div>
        <p className="t-mark-light text-[44px] leading-none mt-8">tryon</p>
        <p className="text-[14px] tracking-[0.3em] text-white/50 mt-1">PROFILE</p>
        <p className="mt-12 text-[20px]"><span className="t-shine">Your fashion brain is syncing…</span></p>
        <p className="mt-4 text-[16px] leading-[26px] text-white/55 max-w-[560px]">We’re processing your picks to fine-tune your profile: smarter suggestions, better outfit combinations, and recommendations you’ll actually want to wear.</p>
      </div>
    </div>
  )
}
