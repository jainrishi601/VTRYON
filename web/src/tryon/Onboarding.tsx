import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Heart, Layers, Shirt, ShoppingBag, ThumbsUp, User as UserIcon, Users, X } from 'lucide-react'
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
    setP((cur) => ({ ...cur, ...np })) // keep answers on screen that aren't saved yet
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

  // Back saves what's on screen first, so nothing typed is lost on the way back.
  const back = () => { save({ ...patchFor(step, p), step: i - 1 }).catch(() => {}); setI(i - 1) }
  const hasPhoto = !!(p.selfie_url || p.body_url)
  const n = NUM[step]

  if (step === 'sync') return <Sync onDone={finish} />
  return (
    <div className="t-app t-ink min-h-[100dvh] flex items-stretch sm:items-center justify-center sm:p-8">
      <div className="w-full sm:max-w-[960px] sm:rounded-[20px] sm:border sm:border-white/10 bg-[#161513] flex flex-col overflow-hidden min-h-[100dvh] sm:min-h-[680px] sm:max-h-[92vh]" data-testid={`onb-${step}`}>
        <div className="px-5 sm:px-12 pt-5 sm:pt-8 shrink-0">
          <div className="h-10 grid grid-cols-[1fr_auto_1fr] items-center">
            {i > 0 ? <button onClick={back} className="justify-self-start -ml-2 h-10 pr-3 pl-1 text-[14px] text-white/70 hover:text-white inline-flex items-center gap-1" data-testid="onb-back"><ChevronLeft size={18} />Back</button> : <span />}
            <span className="font-serif italic text-[30px] leading-none">tryon</span>
            <button onClick={() => navigate('/tryon/dna')} className="justify-self-end text-[14px] text-white/55 hover:text-white" data-testid="onb-later">Finish later</button>
          </div>
          <div className="mt-6 flex items-center gap-3" aria-label={n ? `Step ${n} of 8` : undefined}>
            <div className="flex-1 grid grid-cols-8 gap-1">{Array.from({ length: 8 }, (_, k) => <span key={k} className={`h-[3px] rounded-full transition-colors duration-300 ${k < (n ?? stepsDone(i)) - (n ? 1 : 0) ? 'bg-[#f6f4f0]' : k === (n ?? 0) - 1 ? 'bg-accent' : 'bg-white/12'}`} />)}</div>
            <span className="label text-white/50 w-[64px] text-right num">{n ? `${n} of 8` : ''}</span>
          </div>
        </div>
        <div className="t-scroll flex-1 min-h-0 overflow-y-auto px-5 sm:px-12 pb-8 pt-8" key={step}>
          <div className="t-fade">
            {step === 'goal' && <Goal p={p} setP={setP} name={me.name} />}
            {step === 'shop' && <Shop p={p} setP={setP} />}
            {step === 'photos-intro' && <Breather text="TRYON works best when it can see you. A selfie reads your colouring; a full-body photo lets you try clothes on." gender={p.gender} />}
            {step === 'photos' && <Photos p={p} setP={setP} />}
            {step === 'fit-intro' && <Breather text="Two quick questions about fit, then the fun part." gender={p.gender} />}
            {step === 'sizes' && <Sizes p={p} setP={setP} sizes={opts?.sizes ?? []} />}
            {step === 'body' && <Body p={p} setP={setP} />}
            {step === 'taste-intro' && <Breather text="Now your taste. Swipe on looks, worn by you, and TRYON learns what feels like you." gender={p.gender} />}
            {step === 'colors' && <Colors p={p} setP={setP} opts={opts} />}
            {step === 'vibes' && <Vibes hasBody={!!p.body_url} />}
            {step === 'never' && <Never p={p} setP={setP} opts={opts} />}
            {step === 'done' && <Breather text="That’s everything. Let’s build your Style DNA." gender={p.gender} />}
          </div>
          {err && <p className="mt-4 text-[14px] text-[#e7a084]" role="alert">{err}</p>}
        </div>
        <div className="shrink-0 border-t border-white/10 px-5 sm:px-12 py-4 pb-[max(16px,env(safe-area-inset-bottom))] flex items-center gap-2.5 justify-end">
          {(['photos', 'sizes', 'body'] as StepId[]).includes(step) && !(step === 'photos' && hasPhoto) && (
            <button onClick={() => next()} disabled={busy} className="h-12 px-5 rounded-full text-[15px] text-white/75 hover:text-white" data-testid="onb-skip">{step === 'photos' ? 'Skip photos' : 'Skip'}</button>
          )}
          <button onClick={() => (step === 'done' ? setI(i + 1) : next(patchFor(step, p)))} disabled={busy || !canGo(step, p)} data-testid="onb-continue"
            className="h-12 px-7 rounded-full bg-[#f6f4f0] text-ink text-[15px] font-medium disabled:opacity-30 transition-opacity duration-150">
            {busy ? 'Saving…' : step === 'done' ? 'Build my Style DNA' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

const stepsDone = (i: number) => FLOW.slice(0, i).filter((s) => NUM[s]).length

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

const H = ({ children }: { children: React.ReactNode }) => <h2 className="font-serif text-[34px] sm:text-[48px] leading-[1.05] tracking-[-0.01em] max-w-[760px]">{children}</h2>

function Card({ on, onClick, children, testid }: { on: boolean; onClick: () => void; children: React.ReactNode; testid?: string }) {
  return (
    <button onClick={onClick} data-testid={testid} aria-pressed={on}
      className={`relative text-left rounded-[14px] border p-5 sm:p-6 transition-colors duration-150 ${on ? 'border-[#f6f4f0] bg-white/[0.07]' : 'border-white/12 bg-white/[0.02] hover:border-white/40'}`}>
      {on && <span className="absolute top-4 right-4 w-7 h-7 rounded-full bg-[#f6f4f0] text-ink inline-flex items-center justify-center t-pop"><Check size={14} strokeWidth={2.5} /></span>}
      {children}
    </button>
  )
}

/** A line icon in a hairline ring: quiet, in the ink palette. */
function Glyph({ icon: Icon, size = 56 }: { icon: typeof Shirt; size?: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-full border border-white/25" style={{ width: size, height: size }}>
      <Icon size={size * 0.4} strokeWidth={1.3} />
    </span>
  )
}

// Catalogue photos for the breathers (a fan of three, like pulling pieces off a rail).
const ART: Record<'women' | 'men', string[]> = {
  women: ['NBI027517_1.jpg?v=1682588249', 'NBI046729_1.jpg?v=1757069749', 'NBI037221_1.jpg?v=1748112027'],
  men: ['NBI039073_1.jpg?v=1741008190', 'NBI047601_1.jpg?v=1763622384', 'NBI038835_1.jpg?v=1741008190'],
}
const art = (f: string) => `https://cdn.shopify.com/s/files/1/0270/5129/4854/files/${f}&width=500`

function Breather({ text, gender }: { text: string; gender?: Profile['gender'] }) {
  const set = ART[gender === 'men' ? 'men' : 'women']
  return (
    <div className="py-2">
      <H>{text}</H>
      <div className="mt-10 sm:mt-14 h-[230px] sm:h-[260px] flex items-center justify-center">
        {set.map((f, k) => (
          <div key={f} style={{ transform: `rotate(${(k - 1) * 7}deg) translateY(${k === 1 ? -10 : 6}px)`, marginLeft: k ? -28 : 0, zIndex: k === 1 ? 2 : 1 }}>
            <div className="w-[132px] sm:w-[156px] aspect-[3/4] bg-[#24221f] overflow-hidden border-[5px] border-[#f6f4f0] shadow-[0_18px_40px_rgba(0,0,0,.45)] t-pop" style={{ animationDelay: `${k * 70}ms` }}>
              <img src={art(f)} alt="" className="w-full h-full object-cover object-top" />
            </div>
          </div>
        ))}
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
      <H>Good to meet you, <em>{name}</em>.<br />What brings you here?</H>
      <div className="mt-8 sm:mt-10 grid sm:grid-cols-3 gap-3 sm:gap-4">
        {goals.map(([k, t, d, I]) => (
          <Card key={k} on={p.goal === k} onClick={() => setP((x) => ({ ...x, goal: k }))} testid={`goal-${k}`}>
            <Glyph icon={I} size={48} />
            <p className="mt-5 sm:mt-8 font-serif text-[24px] leading-tight">{t}</p>
            <p className="mt-1.5 text-[14px] leading-[21px] text-white/55">{d}</p>
          </Card>
        ))}
      </div>
    </>
  )
}

function Select({ label, value, onChange, options, placeholder, testid }: { label: string; value?: string; onChange: (v: string) => void; options: string[]; placeholder: string; testid?: string }) {
  return (
    <label className="block">
      {label && <span className="text-[14px] font-medium text-white/80">{label}</span>}
      <div className={`relative ${label ? 'mt-2' : 'mt-3'}`}>
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} data-testid={testid}
          className="w-full h-12 pl-4 pr-11 rounded-[10px] bg-[#1f1d1a] border border-white/12 appearance-none text-[16px] outline-none focus:border-[#f6f4f0] transition-colors duration-150">
          <option value="" disabled>{placeholder}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={17} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 pointer-events-none" />
      </div>
    </label>
  )
}

function Shop({ p, setP }: StepProps) {
  const g: [Gender, string, typeof UserIcon][] = [['women', 'Women’s', UserIcon], ['men', 'Men’s', UserIcon], ['both', 'Both', Users]]
  return (
    <>
      <H>Whose clothes should I show you?</H>
      <div className="mt-8 grid grid-cols-3 gap-2.5 sm:gap-4">
        {g.map(([k, t, I]) => (
          <Card key={k} on={p.gender === k} onClick={() => setP((x) => ({ ...x, gender: k }))} testid={`gender-${k}`}>
            <div className="py-2 flex flex-col items-center text-center"><Glyph icon={I} size={48} /><p className="mt-4 font-serif text-[22px] sm:text-[24px] leading-none">{t}</p></div>
          </Card>
        ))}
      </div>
      <div className="mt-8 grid sm:grid-cols-2 gap-4">
        <Select label="Profession" value={p.profession} onChange={(v) => setP((x) => ({ ...x, profession: v }))} options={PROFESSIONS} placeholder="Pick one (optional)" testid="profession" />
        <Select label="Age range" value={p.age_range} onChange={(v) => setP((x) => ({ ...x, age_range: v }))} options={AGES} placeholder="Pick one (optional)" testid="age" />
      </div>
    </>
  )
}

function Photos({ p, setP }: StepProps) {
  return (
    <>
      <H>A selfie for your colouring, a full-body photo for try-on.</H>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4">
        <PhotoBox kind="selfie" title="Selfie" sub="Face in daylight, no filter" url={p.selfie_url} onSaved={(np) => setP(() => np)} />
        <PhotoBox kind="body" title="Full body" sub="Head to toe, one person, plain background" url={p.body_url} onSaved={(np) => setP(() => np)} />
      </div>
      <p className="mt-5 text-[13px] text-white/50">Used only to read your colouring and to show clothes on you. You can delete them from your profile any time.</p>
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
    <div className="flex flex-col">
      <button onClick={() => ref.current?.click()} disabled={busy} data-testid={`photo-${kind}`} aria-label={url ? `Replace your ${title.toLowerCase()}` : `Upload your ${title.toLowerCase()}`}
        className={`relative aspect-[3/4] rounded-[14px] overflow-hidden flex flex-col items-center justify-center gap-2 transition-colors duration-150 ${url ? 'bg-black' : 'border-[1.5px] border-dashed border-white/25 hover:border-white/60'}`}>
        {url ? <img src={url} alt={`Your ${title.toLowerCase()}`} className="absolute inset-0 w-full h-full object-cover t-in" />
          : busy ? <div className="absolute inset-0 t-skel-dark" />
          : <><Camera size={26} strokeWidth={1.3} className="text-white/60" /><span className="text-[14px] font-medium">Upload</span></>}
        {url && !busy && <span className="absolute bottom-2.5 right-2.5 h-8 px-3 rounded-full bg-[#f6f4f0] text-ink text-[12px] font-medium inline-flex items-center">Replace</span>}
        {busy && <span className="relative text-[13px] t-shine">Checking…</span>}
      </button>
      <p className="mt-3 text-[15px] font-medium flex items-center gap-2">{title}{url && !busy && <Check size={14} className="text-[#9cc5a8]" aria-label="Saved" />}</p>
      <p className="text-[13px] leading-[19px] text-white/55">{sub}</p>
      {err && <p className="mt-1 text-[13px] text-[#e7a084]" role="alert">{err}</p>}
      <input ref={ref} type="file" accept="image/jpeg,image/png" className="hidden" data-testid={`photo-${kind}-input`} onChange={(e) => { const f = e.target.files?.[0]; if (f) up(f); e.target.value = '' }} />
    </div>
  )
}

function Sizes({ p, setP, sizes }: StepProps & { sizes: string[] }) {
  const sz = p.sizes ?? {}
  const set = (k: string, v: string) => setP((x) => ({ ...x, sizes: { ...(x.sizes ?? {}), [k]: v } }))
  return (
    <>
      <H>Your usual sizes. Exact numbers are welcome if you know them.</H>
      <div className="mt-8 grid sm:grid-cols-2 gap-4">
        <Select label="Sizing region" value={sz.region} onChange={(v) => set('region', v)} options={REGIONS} placeholder="Pick a region" testid="size-region" />
        {[['tops', 'Tops', 'Shirts, tees, jackets'], ['bottoms', 'Bottoms', 'Trousers, skirts, shorts'], ...(p.gender !== 'men' ? [['dresses', 'Dresses', 'Dresses and sets']] : [])].map(([k, t, d]) => (
          <Select key={k} label={`${t} · ${d}`} value={(sz as Record<string, string>)[k]} onChange={(v) => set(k, v)} options={sizes} placeholder="Size" testid={`size-${k}`} />
        ))}
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
    <div className="rounded-[14px] border border-white/12 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-medium">{title}</p>
        <span className="inline-flex items-center gap-2.5 text-[13px] text-white/70">{unit}
          <Switch on={on} onClick={toggle} label={`Show ${title.toLowerCase()} in ${alt}`} />{alt}</span>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <p className="num"><span className="font-serif text-[64px] leading-none">{value}</span> <span className="text-[16px] text-white/50">{on ? alt : unit}</span></p>
        <div className="flex flex-col gap-2"><button aria-label={`More ${title.toLowerCase()}`} onClick={() => step(1)} className="w-11 h-11 rounded-full border border-white/20 hover:border-white/60 inline-flex items-center justify-center"><ChevronUp size={18} /></button><button aria-label={`Less ${title.toLowerCase()}`} onClick={() => step(-1)} className="w-11 h-11 rounded-full border border-white/20 hover:border-white/60 inline-flex items-center justify-center"><ChevronDown size={18} /></button></div>
      </div>
    </div>
  )
  return (
    <>
      <H>Help me get your fit right from the first look.</H>
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
      <span className={`relative w-[58px] h-[58px] sm:w-[68px] sm:h-[68px] rounded-full border-2 ${chosen.has(c.name) ? 'border-[#f6f4f0]' : 'border-transparent'} p-[3px] transition-colors duration-150`}>
        <span className="block w-full h-full rounded-full border border-white/10" style={{ background: c.hex }} />
        {chosen.has(c.name) && <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#f6f4f0] text-ink inline-flex items-center justify-center t-pop"><Check size={12} strokeWidth={3} /></span>}
      </span>
      <span className="label text-white/70">{c.name}</span>
    </button>
  )
  return (
    <>
      <H>{p.selfie_url || p.body_url ? 'Based on your photo, these are the shades that’ll work best on you. Add or remove anything you want.' : 'Pick the shades you love wearing. Add a selfie later and TRYON will suggest more.'}</H>
      <div className="mt-7 w-full h-14 px-5 rounded-[14px] border border-white/12 flex items-center justify-between text-[15px]">
        No preferred colours
        <Switch on={none} onClick={() => { setNone(!none); setP((x) => ({ ...x, colors: !none ? [] : pal?.recommended ?? [] })) }} label="No preferred colours" testid="no-colors" />
      </div>
      {!pal ? (
        <p className="mt-10 text-[17px]"><span className="t-shine">Reading your colouring…</span></p>
      ) : (
        <>
          {rec.length > 0 && (
            <div className="mt-8">
              <p className="label text-white/70">Recommended{pal.undertone ? ` · ${pal.undertone} undertone` : ''}</p>
              <p className="mt-1 text-[14px] text-white/55">{pal.analyzed ? pal.summary || 'From the colour analysis of your photo.' : pal.summary}</p>
              <div className="mt-5 flex flex-wrap gap-x-4 gap-y-5">{rec.map((c) => <Swatch key={c.name} c={c} />)}</div>
            </div>
          )}
          <p className="mt-10 label text-white/60">All colours</p>
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-5">{rest.map((c) => <Swatch key={c.name} c={c} />)}</div>
        </>
      )}
    </>
  )
}

// Our own line per vibe: about shape and attitude, never a colour the tile's piece may not have.
const VIBE_LINE: Record<string, string> = {
  minimal: 'Clean lines, nothing extra', bold: 'Pieces that make a statement', classic: 'Timeless and polished',
  street: 'Easy, urban, relaxed', boho: 'Flowing, loose and free', sporty: 'Active comfort',
  romantic: 'Soft details, gentle shapes', edgy: 'Sharp lines, strong contrast',
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
  const total = list?.length ?? 0
  return (
    <>
      <H>Which of these feel like you?</H>
      <p className="mt-3 text-[15px] text-white/60 num" data-testid="vibes-progress">
        {!list ? 'Getting your looks ready…' : hasBody ? `${ready} of ${list.length} looks ready on you · ${total - pending.length} answered` : `Shown flat: add a full-body photo to see these on you · ${total - pending.length} of ${total} answered`}
      </p>
      {list && !cur ? (
        <div className="mt-12 text-center"><Glyph icon={Check} size={64} /><p className="mt-5 font-serif text-[28px]">That’s every look.</p><p className="mt-1 text-[15px] text-white/60">Continue when you’re ready.</p></div>
      ) : (
        <div className="mt-6 flex justify-center sm:grid sm:grid-cols-[1fr_auto_1fr] items-center gap-4">
          <Hint side="left" onClick={() => vote('dislike')} />
          <div className="flex flex-col items-center">
            <div className="relative w-[248px] sm:w-[280px] aspect-[3/4]">
              <div className="absolute inset-0 bg-[#2a2825] rotate-[4deg] translate-y-2" />
              <div className="absolute inset-0 bg-[#211f1c] rotate-[-3deg] translate-y-1" />
              {cur ? (
                <div key={cur.id} className={`absolute inset-0 overflow-hidden border-[6px] border-[#f6f4f0] bg-[#2a2825] shadow-[0_24px_60px_rgba(0,0,0,.5)] t-pop ${out ? `t-swipe-${out}` : ''}`} data-testid="vibe-card" data-vibe={cur.vibe}>
                  {cur.status === 'pending' && hasBody ? <div className="absolute inset-0 t-skel-dark" /> : <img src={img(cur)} alt={`${cur.vibe} look${cur.product ? `: ${cur.product.title}` : ''}`} className="absolute inset-0 w-full h-full object-cover object-top" />}
                  {cur.rendered && <span className="absolute top-2.5 left-2.5 t-tag t-tag-linen">On you</span>}
                  <div className="absolute inset-x-0 bottom-0 p-4 pt-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent">
                    <p className="font-serif text-[34px] leading-none capitalize">{cur.vibe}</p>
                    <p className="text-[13px] text-white/80 mt-1">{VIBE_LINE[cur.vibe] ?? cur.line}{cur.status === 'pending' && hasBody ? ' · putting it on you…' : ''}</p>
                  </div>
                </div>
              ) : <div className="absolute inset-0 t-skel-dark" />}
            </div>
            <div className="mt-6 flex justify-center gap-4">
              <button onClick={() => vote('dislike')} aria-label="Not for me" data-testid="vibe-dislike" className="w-14 h-14 rounded-full border border-white/25 hover:border-white/70 inline-flex items-center justify-center transition-colors duration-150"><X size={20} /></button>
              <button onClick={() => vote('love')} aria-label="Love it" data-testid="vibe-love" className="w-14 h-14 rounded-full bg-[#f6f4f0] text-ink inline-flex items-center justify-center"><Heart size={19} fill="currentColor" /></button>
              <button onClick={() => vote('like')} aria-label="Like it" data-testid="vibe-like" className="w-14 h-14 rounded-full border border-white/25 hover:border-white/70 inline-flex items-center justify-center transition-colors duration-150"><ThumbsUp size={19} /></button>
            </div>
            <p className="mt-3 text-[12px] text-white/45 hidden sm:block">Keyboard: ← not for me · ↑ love · → like</p>
          </div>
          <Hint side="right" onClick={() => vote('like')} />
        </div>
      )}
    </>
  )
}

const Hint = ({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) => (
  <div className={`hidden sm:flex flex-col items-center gap-3 ${side === 'left' ? 'justify-self-end' : 'justify-self-start'}`}>
    <button onClick={onClick} className="w-14 h-14 rounded-full border border-white/15 inline-flex items-center justify-center hover:border-white/50 transition-colors duration-150" aria-label={side === 'left' ? 'Not for me' : 'Like it'}>
      {side === 'left' ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
    <p className="text-[13px] text-white/55 text-center">{side === 'left' ? 'Not for me' : 'Like it'}</p>
  </div>
)

/** A switch that reads on a dark ground: linen track when on, a light knob always. */
function Switch({ on, onClick, label, testid }: { on: boolean; onClick: () => void; label: string; testid?: string }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on} aria-label={label} data-testid={testid}
      className={`shrink-0 w-12 h-7 rounded-full p-[3px] transition-colors duration-150 ${on ? 'bg-[#f6f4f0]' : 'bg-white/15'}`}>
      <span className={`block w-[22px] h-[22px] rounded-full transition-transform duration-150 ${on ? 'translate-x-5 bg-ink' : 'bg-[#f6f4f0]'}`} />
    </button>
  )
}

function Never({ p, setP, opts }: StepProps & { opts: Options | null }) {
  const on = new Set(p.never ?? [])
  const toggle = (k: string) => setP((x) => { const s = new Set(x.never ?? []); if (s.has(k)) s.delete(k); else s.add(k); return { ...x, never: [...s] } })
  return (
    <>
      <H>Anything you’d never wear? I’ll keep it out of every look.</H>
      <div className="mt-5 flex items-center gap-4 text-[14px]">
        <span className="text-white/60 num">{on.size} selected</span>
        {on.size > 0 && <button onClick={() => setP((x) => ({ ...x, never: [] }))} className="text-white/80 underline underline-offset-4">Clear all</button>}
      </div>
      <div className="mt-6 space-y-7">
        {Object.entries(opts?.never ?? {}).map(([group, items]) => (
          <div key={group}>
            <p className="label text-white/55">{group}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {items.map((it) => (
                <button key={it.key} onClick={() => toggle(it.key)} aria-pressed={on.has(it.key)} data-testid={`never-${it.key}`}
                  className={`h-10 px-4 rounded-full border text-[14px] inline-flex items-center gap-1.5 transition-colors duration-150 ${on.has(it.key) ? 'bg-[#f6f4f0] text-ink border-[#f6f4f0]' : 'border-white/20 hover:border-white/50'}`}>{on.has(it.key) && <X size={13} />}{it.label}</button>
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
    <div className="t-app t-ink min-h-[100dvh] flex items-center justify-center p-6" data-testid="onb-sync">
      <div className="flex flex-col items-center text-center t-fade">
        <div className="t-wave h-12 flex items-center">{[0, 1, 2, 3, 4].map((i) => <span key={i} />)}</div>
        <p className="mt-10 label text-white/50">Building your profile</p>
        <p className="mt-3 font-serif text-[44px] sm:text-[64px] leading-none">Reading your <em>Style DNA</em>…</p>
        <p className="mt-5 text-[15px] leading-[24px] text-white/60 max-w-[480px]">Your answers, colours and vibes become one profile: better outfits here, and in every store with the stylist.</p>
      </div>
    </div>
  )
}
