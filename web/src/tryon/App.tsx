import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Fingerprint, LogOut, Menu, MessageCircle, Shirt, SlidersHorizontal, Sun } from 'lucide-react'
import { navigate } from '../store/lib'
import { adoptShopper, auth, call, type User } from './api'
import { Onboarding } from './Onboarding'
import { Dna } from './Dna'
import { Wardrobe } from './Wardrobe'
import { Picks } from './Picks'
import { Stylist } from './Stylist'
import { clearShopper, Sheet, Toasts } from './ui'
import './tryon.css'

// ponytail: a public demo account (scripts/seed_tryon_demo.py seeds and resets it); fine for a hackathon demo.
const DEMO = { email: 'demo@tryon.style', password: 'tryon-demo' }
const AUTH_PAGES = ['/tryon/login', '/tryon/signup']
const PAGES = /^\/tryon(\/(picks|stylist|wardrobe|onboarding|dna(\/(overview|map|play|timeline))?))?\/?$/
const nextPath = () => {
  const n = new URLSearchParams(location.search).get('next') ?? ''
  return PAGES.test(n) ? n : null
}

/** TRYON: the shopper's own style platform. Login → 8-step onboarding → Style DNA, Wardrobe, Daily Picks, Stylist.
 *  The account's shopper token is the one the store widget uses, so everything here shapes the stylist right away. */
export default function TryonApp({ path }: { path: string }) {
  const [me, setMe] = useState<User | null | undefined>(undefined)

  useEffect(() => { document.title = 'TRYON · your style, everywhere' }, [])
  // The store's stylist widget only appears on TRYON's Stylist page (same shopper token, so it knows the profile).
  useEffect(() => {
    if (path.startsWith('/tryon/stylist')) return
    const hide = document.createElement('style')
    hide.textContent = '#elara-root{display:none!important}'
    document.head.appendChild(hide)
    return () => hide.remove()
  }, [path])

  useEffect(() => {
    if (!auth.get()) { setMe(null); return }
    call<User>('/api/me').then((u) => { setMe(u); adoptShopper(u.user_token) }, () => { auth.set(null); setMe(null) })
  }, [])

  const signedIn = (a: string, u: User) => {
    auth.set(a)
    adoptShopper(u.user_token)
    setMe(u)
    navigate(!u.profile.onboarded ? '/tryon/onboarding' : nextPath() ?? '/tryon/picks')
  }
  const signOut = async () => {
    await call('/api/auth/logout', { body: {} }).catch(() => {})
    clearShopper() // TRYON auth, the widget's token/avatar/chat, the cart: the next person starts clean
    location.assign('/tryon/login') // a full load also resets the widget's and the cart's in-memory state
  }

  const authPage = AUTH_PAGES.includes(path)
  if (me === undefined) return <div className="t-app min-h-screen bg-surface" />
  if (!me) {
    if (!authPage) {
      const keep = path !== '/tryon' && PAGES.test(path) ? `?next=${encodeURIComponent(path)}` : ''
      queueMicrotask(() => { if (location.pathname === path) navigate(`/tryon/login${keep}`) })
      return null
    }
    return <Auth key={path} mode={path === '/tryon/signup' ? 'signup' : 'login'} onDone={signedIn} />
  }
  if (authPage) {
    const to = me.profile.onboarded ? nextPath() ?? '/tryon/picks' : '/tryon/onboarding'
    queueMicrotask(() => { if (AUTH_PAGES.includes(location.pathname)) navigate(to) })
    return null
  }
  if (path.startsWith('/tryon/onboarding') || (path === '/tryon' && !me.profile.onboarded)) {
    return <Onboarding me={me} onUser={setMe} />
  }
  const page = path.replace(/\/$/, '')
  return (
    <Shell me={me} path={page} onSignOut={signOut}>
      {page.startsWith('/tryon/wardrobe') ? <Wardrobe me={me} />
        : page.startsWith('/tryon/dna') ? <Dna me={me} path={page} />
        : page.startsWith('/tryon/stylist') ? <Stylist me={me} />
        : page === '/tryon' || page === '/tryon/picks' ? <Picks me={me} />
        : <Lost />}
    </Shell>
  )
}

type NavItem = [string, string, typeof Fingerprint, string]
const NAV: NavItem[] = [
  ['/tryon/picks', 'Daily Picks', Sun, 'nav-daily'],
  ['/tryon/stylist', 'Stylist', MessageCircle, 'nav-stylist'],
  ['/tryon/wardrobe', 'Wardrobe', Shirt, 'nav-wardrobe'],
  ['/tryon/dna', 'Style DNA', Fingerprint, 'nav-style'],
]

const Mark = ({ size = 34 }: { size?: number }) => (
  <a href="/tryon/picks" onClick={(e) => { e.preventDefault(); navigate('/tryon/picks') }} className="font-serif italic leading-none tracking-[-0.02em]" style={{ fontSize: size }} aria-label="TRYON home">tryon</a>
)

function Shell({ me, path, onSignOut, children }: { me: User; path: string; onSignOut: () => void; children: React.ReactNode }) {
  const [menu, setMenu] = useState(false)
  useEffect(() => setMenu(false), [path])
  const active = (to: string) => (to === '/tryon/picks' ? path === '/tryon' || path === to : path.startsWith(to))
  const go = (to: string) => (e: React.MouseEvent) => { e.preventDefault(); navigate(to) }
  const initials = me.name.trim().slice(0, 1).toUpperCase()
  return (
    <div className="t-app min-h-screen bg-surface text-[15px] lg:flex">
      <aside className="hidden lg:flex w-[248px] shrink-0 flex-col px-5 py-6 sticky top-0 h-screen">
        <div className="px-3 flex items-baseline gap-2"><Mark /><span className="label text-muted">by Drape</span></div>
        <nav className="mt-10 space-y-0.5" aria-label="TRYON">
          {NAV.map(([to, label, Icon, id]) => (
            <a key={to} href={to} onClick={go(to)} data-testid={id} aria-current={active(to) ? 'page' : undefined}
              className={`h-11 px-3 rounded-full flex items-center gap-3 text-[15px] transition-colors duration-150 ${active(to) ? 'bg-ink text-white' : 'text-ink/80 hover:bg-white'}`}>
              <Icon size={17} strokeWidth={1.6} />{label}
            </a>
          ))}
        </nav>
        <a href="/" className="mt-6 mx-3 pt-5 border-t border-line text-[14px] text-muted hover:text-ink inline-flex items-center gap-2" data-testid="nav-store">
          Shop Northline<ArrowUpRight size={14} />
        </a>
        <div className="mt-auto rounded-[14px] bg-white border border-line p-4">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-ink text-white font-serif text-[18px] inline-flex items-center justify-center">{initials}</span>
            <div className="min-w-0"><p className="text-[14px] font-semibold truncate">{me.name}</p><p className="text-[12px] text-muted truncate">{me.email}</p></div>
          </div>
          <div className="mt-3 pt-3 border-t border-line flex items-center justify-between text-[13px]">
            <a href="/tryon/onboarding" onClick={go('/tryon/onboarding')} className="text-muted hover:text-ink inline-flex items-center gap-1.5" data-testid="nav-edit"><SlidersHorizontal size={13} />Edit profile</a>
            <button onClick={onSignOut} className="text-muted hover:text-ink inline-flex items-center gap-1.5" data-testid="sign-out"><LogOut size={13} />Sign out</button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 lg:my-3 lg:mr-3 bg-white lg:rounded-[20px] lg:border lg:border-line min-h-screen lg:min-h-[calc(100vh-24px)]">
        <div className="lg:hidden sticky top-0 z-30 h-14 px-4 flex items-center justify-between bg-white/95 backdrop-blur border-b border-line">
          <Mark size={28} />
          <span className="text-[13px] text-muted truncate px-3">{NAV.find(([to]) => active(to))?.[1] ?? ''}</span>
          <button onClick={() => setMenu(true)} className="h-10 pl-3 pr-3.5 -mr-1 rounded-full border border-line inline-flex items-center gap-2 text-[14px]" aria-label="Open menu" data-testid="nav-menu"><Menu size={16} />Menu</button>
        </div>
        {children}
      </main>
      {menu && (
        <Sheet title={<span className="font-serif italic text-[24px] font-normal">tryon</span>} onClose={() => setMenu(false)} testid="nav-sheet">
          <nav className="p-3" aria-label="TRYON">
            {NAV.map(([to, label, Icon, id]) => (
              <a key={to} href={to} onClick={go(to)} data-testid={`m-${id}`}
                className={`h-14 px-4 rounded-[14px] flex items-center gap-4 text-[17px] ${active(to) ? 'bg-surface font-semibold' : ''}`}>
                <Icon size={19} strokeWidth={1.6} />{label}{active(to) && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />}
              </a>
            ))}
            <a href="/tryon/onboarding" onClick={go('/tryon/onboarding')} className="h-14 px-4 rounded-[14px] flex items-center gap-4 text-[17px]" data-testid="m-nav-edit"><SlidersHorizontal size={19} strokeWidth={1.6} />Edit profile</a>
          </nav>
          <div className="mx-5 mb-[max(20px,env(safe-area-inset-bottom))] pt-4 border-t border-line">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-ink text-white font-serif text-[19px] inline-flex items-center justify-center">{initials}</span>
              <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold truncate">{me.name}</p><p className="text-[13px] text-muted truncate">{me.email}</p></div>
              <button onClick={onSignOut} className="h-10 px-4 rounded-full border border-line text-[14px] inline-flex items-center gap-2" data-testid="m-sign-out"><LogOut size={14} />Sign out</button>
            </div>
            <a href="/" className="mt-4 h-12 rounded-full bg-ink text-white text-[15px] font-medium flex items-center justify-center gap-2">Shop Northline with your style<ArrowUpRight size={15} /></a>
          </div>
        </Sheet>
      )}
      <Toasts />
    </div>
  )
}

function Lost() {
  return (
    <div className="px-5 sm:px-12 py-24 max-w-[640px] mx-auto text-center" data-testid="tryon-404">
      <p className="label text-muted">Not found</p>
      <h1 className="mt-3 font-serif text-[44px] sm:text-[56px] leading-none">This page isn’t in your wardrobe.</h1>
      <p className="mt-4 text-[16px] text-muted">The link may be old. Your picks, wardrobe and Style DNA are all here.</p>
      <button onClick={() => navigate('/tryon/picks')} className="mt-8 h-12 px-6 rounded-full bg-ink text-white text-[15px] font-medium inline-flex items-center gap-2"><ArrowLeft size={16} />Back to Daily Picks</button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------- auth

const ART = 'https://cdn.shopify.com/s/files/1/0270/5129/4854/files/NBI035795_1.jpg?v=1726933842&width=900'

function Auth({ mode, onDone }: { mode: 'login' | 'signup'; onDone: (auth: string, u: User) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'' | 'form' | 'demo'>('')
  const [err, setErr] = useState('')
  const signup = mode === 'signup'
  const send = async (path: string, body: object, kind: 'form' | 'demo') => {
    setBusy(kind); setErr('')
    try {
      const r = await call<{ auth: string; user: User }>(path, { body })
      onDone(r.auth, r.user)
    } catch (x) {
      setErr(kind === 'demo' ? 'The demo profile isn’t set up on this server yet. Run scripts/seed_tryon_demo.py.' : (x as Error).message)
      setBusy('')
    }
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    let widgetToken: string | null = null
    try { widgetToken = localStorage.getItem('elara.token') } catch { /* private mode */ }
    send(signup ? '/api/auth/signup' : '/api/auth/login', signup ? { name, email, password, user_token: widgetToken } : { email, password }, 'form')
  }
  const ok = email.includes('@') && password.length >= (signup ? 6 : 1) && (!signup || name.trim())
  const swap = signup ? '/tryon/login' : '/tryon/signup'
  return (
    <div className="t-app min-h-[100dvh] bg-white grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="px-6 sm:px-16 py-8 sm:py-12 flex flex-col">
        <div className="flex items-center justify-between">
          <span className="font-serif italic text-[34px] leading-none">tryon</span>
          <a href="/" className="text-[14px] text-muted hover:text-ink inline-flex items-center gap-1.5"><ArrowLeft size={14} />Northline</a>
        </div>
        <div className="flex-1 flex flex-col justify-center max-w-[420px] w-full mx-auto lg:mx-0 py-10">
          <p className="label text-muted flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-accent" />{signup ? 'New profile' : 'Your style profile'}</p>
          <h1 className="mt-3 font-serif text-[44px] sm:text-[56px] leading-[0.98] tracking-[-0.01em]">{signup ? 'One profile for every store.' : 'Welcome back.'}</h1>
          <p className="mt-3 text-[15px] text-muted">{signup ? 'Your Style DNA, your wardrobe and your try-ons, wherever the stylist is.' : 'Your Style DNA, wardrobe and today’s picks are waiting.'}</p>
          <form onSubmit={submit} className="mt-8 space-y-4" data-testid={`auth-${mode}`}>
            {signup && <Field label="Name" value={name} onChange={setName} placeholder="Your first name" testid="auth-name" auto="given-name" />}
            <Field label="Email" value={email} onChange={setEmail} placeholder="you@example.com" type="email" testid="auth-email" auto="email" />
            <Field label="Password" value={password} onChange={setPassword} placeholder={signup ? 'At least 6 characters' : 'Your password'} type="password" testid="auth-password" auto={signup ? 'new-password' : 'current-password'} />
            {err && <p className="text-[14px] text-accent" role="alert">{err}</p>}
            <button disabled={!ok || !!busy} data-testid="auth-submit" className="w-full h-12 rounded-full bg-ink text-white text-[15px] font-medium disabled:opacity-35 transition-opacity duration-150">
              {busy === 'form' ? 'One moment…' : signup ? 'Create my profile' : 'Log in'}
            </button>
          </form>
          {!signup && (
            <>
              <div className="my-5 flex items-center gap-3 text-[12px] text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
              <button onClick={() => send('/api/auth/login', DEMO, 'demo')} disabled={!!busy} data-testid="auth-demo"
                className="w-full h-12 rounded-full border border-ink text-[15px] font-medium hover:bg-surface transition-colors duration-150 disabled:opacity-50">
                {busy === 'demo' ? 'Opening Priya’s profile…' : 'Try the demo profile'}
              </button>
              <p className="mt-2 text-center text-[12px] text-muted">Priya: 8 wardrobe pieces and a finished Style DNA.</p>
            </>
          )}
          <p className="mt-8 text-[15px] text-muted">
            {signup ? 'Already have a profile? ' : 'New here? '}
            <a href={swap} onClick={(e) => { e.preventDefault(); navigate(swap + location.search) }} className="text-ink font-semibold underline underline-offset-4" data-testid="auth-switch">{signup ? 'Log in' : 'Create a profile'}</a>
          </p>
        </div>
      </div>
      <div className="hidden lg:block p-3">
        <div className="t-ink h-full rounded-[20px] relative overflow-hidden">
          <img src={ART} alt="" className="absolute inset-0 w-full h-full object-cover object-top opacity-80" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-[#111]/30 to-transparent" />
          <div className="absolute left-10 right-10 bottom-10">
            <span className="t-tag t-tag-linen">On you</span>
            <p className="mt-5 font-serif text-[52px] leading-[1] max-w-[520px]">See it on you.<br /><em>Style what you own.</em></p>
            <p className="mt-4 text-[15px] text-white/70 max-w-[440px]">Try-ons on your own photo, outfits built around your wardrobe, and a Style DNA you can read and correct.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', testid, auto }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string; testid: string; auto?: string }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testid} autoComplete={auto}
        className="mt-1.5 w-full h-12 px-4 rounded-[10px] bg-white border border-line outline-none focus:border-ink text-[16px] placeholder:text-muted/60 transition-colors duration-150" />
    </label>
  )
}
