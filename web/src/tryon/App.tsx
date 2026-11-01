import { useEffect, useState } from 'react'
import { Fingerprint, LogOut, Shirt, ShoppingBag, SlidersHorizontal, MessageCircle, ShoppingCart, CalendarDays, Paperclip, Sun, Sparkles } from 'lucide-react'
import { navigate } from '../store/lib'
import { adoptShopper, auth, call, type User } from './api'
import { Onboarding } from './Onboarding'
import { Dna } from './Dna'
import { Wardrobe } from './Wardrobe'
import { Picks } from './Picks'
import { Stylist } from './Stylist'
import './tryon.css'

/** TRYON: the shopper's own style platform. Login → 8-step onboarding → Style DNA and Wardrobe. The account's shopper
 *  token is the one the store widget uses, so everything here shapes the stylist right away. */
export default function TryonApp({ path }: { path: string }) {
  const [me, setMe] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    document.title = 'TRYON · your style, everywhere'
    if (!document.querySelector('link[href*="Cormorant+Garamond"]')) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Outfit:wght@400;500;600;700&display=swap'
      document.head.appendChild(l)
    }
  }, [])
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
    navigate(u.profile.onboarded ? '/tryon/dna' : '/tryon/onboarding')
  }
  const signOut = async () => {
    await call('/api/auth/logout', { body: {} }).catch(() => {})
    auth.set(null)
    setMe(null)
    navigate('/tryon/login')
  }

  const authPage = path === '/tryon/login' || path === '/tryon/signup'
  if (me === undefined) return <div className="t-app min-h-screen bg-[#f4f4f5]" />
  if (!me) {
    if (!authPage) queueMicrotask(() => navigate('/tryon/login'))
    return <Auth key={path} mode={path === '/tryon/signup' ? 'signup' : 'login'} onDone={signedIn} />
  }
  if (authPage) { queueMicrotask(() => navigate(me.profile.onboarded ? '/tryon/dna' : '/tryon/onboarding')); return null }
  if (path.startsWith('/tryon/onboarding') || (path === '/tryon' && !me.profile.onboarded)) {
    return <Onboarding me={me} onUser={setMe} />
  }
  return (
    <Shell me={me} path={path} onSignOut={signOut}>
      {path.startsWith('/tryon/wardrobe') ? <Wardrobe me={me} /> : path.startsWith('/tryon/dna') ? <Dna me={me} />
        : path.startsWith('/tryon/stylist') ? <Stylist me={me} /> : <Picks me={me} />}
    </Shell>
  )
}

function Shell({ me, path, onSignOut, children }: { me: User; path: string; onSignOut: () => void; children: React.ReactNode }) {
  const nav: [string, string, typeof Fingerprint][] = [
    ['/tryon/picks', 'Daily Picks', Sun],
    ['/tryon/stylist', 'Stylist', Sparkles],
    ['/tryon/dna', 'Style DNA', Fingerprint],
    ['/tryon/wardrobe', 'Wardrobe', Shirt],
    ['/tryon/onboarding', 'Edit my profile', SlidersHorizontal],
  ]
  const active = (to: string) => (to === '/tryon/picks' ? path === '/tryon' || path.startsWith('/tryon/picks') : path.startsWith(to))
  return (
    <div className="t-app min-h-screen bg-[#f4f4f5] text-[#0a0a0a] text-[15px] flex">
      <aside className="hidden md:flex w-[260px] shrink-0 flex-col p-5 sticky top-0 h-screen">
        <a href="/tryon" onClick={(e) => { e.preventDefault(); navigate('/tryon') }} className="t-mark text-[40px] leading-none px-2">tryon</a>
        <nav className="mt-8 space-y-1">
          {nav.map(([to, label, Icon]) => (
            <a key={to} href={to} onClick={(e) => { e.preventDefault(); navigate(to) }} data-testid={`nav-${label.split(' ')[0].toLowerCase()}`}
              className={`h-11 px-3.5 rounded-xl flex items-center gap-3 text-[15px] transition-colors ${active(to) ? 'bg-[#0a0a0a] text-white' : 'hover:bg-white'}`}>
              <Icon size={18} strokeWidth={1.6} />{label}
            </a>
          ))}
          <a href="/" className="h-11 px-3.5 rounded-xl flex items-center gap-3 text-[15px] hover:bg-white" data-testid="nav-store">
            <ShoppingBag size={18} strokeWidth={1.6} />Shop with my style
          </a>
        </nav>
        <div className="mt-auto rounded-2xl bg-white border border-[#e5e5e5] p-4">
          <p className="text-[14px] font-semibold truncate">{me.name}</p>
          <p className="text-[12px] text-[#737373] truncate">{me.email}</p>
          <button onClick={onSignOut} className="mt-3 text-[13px] text-[#737373] hover:text-[#0a0a0a] inline-flex items-center gap-1.5" data-testid="sign-out"><LogOut size={14} />Sign out</button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 md:my-3 md:mr-3 bg-white md:rounded-[28px] md:border md:border-[#ececec] min-h-screen md:min-h-[calc(100vh-24px)]">
        <div className="md:hidden flex items-center justify-between px-5 py-4 border-b border-[#ececec]">
          <span className="t-mark text-[30px] leading-none">tryon</span>
          <div className="flex gap-3 text-[13px]">{nav.slice(0, 2).map(([to, label]) => <a key={to} href={to} onClick={(e) => { e.preventDefault(); navigate(to) }} className={active(to) ? 'font-semibold' : 'text-[#737373]'}>{label}</a>)}</div>
        </div>
        {children}
      </main>
    </div>
  )
}

function Auth({ mode, onDone }: { mode: 'login' | 'signup'; onDone: (auth: string, u: User) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const signup = mode === 'signup'
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      let widgetToken: string | null = null
      try { widgetToken = localStorage.getItem('elara.token') } catch { /* private mode */ }
      const r = await call<{ auth: string; user: User }>(signup ? '/api/auth/signup' : '/api/auth/login',
        { body: signup ? { name, email, password, user_token: widgetToken } : { email, password } })
      onDone(r.auth, r.user)
    } catch (x) { setErr((x as Error).message); setBusy(false) }
  }
  const ok = email.includes('@') && password.length >= (signup ? 6 : 1) && (!signup || name.trim())
  return (
    <div className="t-app min-h-screen bg-[#ededed] text-[#0a0a0a] grid lg:grid-cols-2">
      <div className="px-8 sm:px-20 py-14 flex flex-col justify-center max-w-[620px]">
        <a href="/" className="text-[14px] text-[#737373] hover:text-[#0a0a0a]">‹ Back to the store</a>
        <p className="t-mark text-[64px] leading-none mt-8">tryon</p>
        <h1 className="mt-6 text-[34px] font-semibold tracking-[-0.01em]">{signup ? 'Create your style profile' : 'Welcome back'}</h1>
        <p className="mt-2 text-[15px] text-[#737373]">{signup ? 'One profile: your Style DNA, your wardrobe and your try-ons, in every store that has the stylist.' : 'Your Style DNA and wardrobe are waiting.'}</p>
        <form onSubmit={submit} className="mt-8 space-y-5" data-testid={`auth-${mode}`}>
          {signup && <Field label="Name" value={name} onChange={setName} placeholder="Your first name" testid="auth-name" />}
          <Field label="Email" value={email} onChange={setEmail} placeholder="Email" type="email" testid="auth-email" />
          <Field label="Password" value={password} onChange={setPassword} placeholder={signup ? 'At least 6 characters' : 'Enter password'} type="password" testid="auth-password" />
          {err && <p className="text-[14px] text-[#c2410c]" role="alert">{err}</p>}
          <button disabled={!ok || busy} data-testid="auth-submit" className="w-full h-12 rounded-xl bg-[#0a0a0a] text-white text-[15px] font-medium disabled:bg-[#8a8a8a] transition-colors">
            {busy ? 'One moment…' : 'Continue'}
          </button>
        </form>
        <p className="mt-6 text-center text-[15px]">
          {signup ? 'Already have a profile? ' : 'New here? '}
          <a href={signup ? '/tryon/login' : '/tryon/signup'} onClick={(e) => { e.preventDefault(); navigate(signup ? '/tryon/login' : '/tryon/signup') }} className="font-semibold underline underline-offset-4" data-testid="auth-switch">{signup ? 'Log in' : 'Sign up'}</a>
        </p>
      </div>
      <div className="hidden lg:block p-4">
        <div className="t-art h-full rounded-[28px] relative overflow-hidden">
          <div className="absolute left-8 right-[-40px] top-1/2 -translate-y-1/2 rounded-[28px] bg-[#1d1a24]/90 border border-[#ff2d6f]/40 p-6 shadow-2xl">
            <p className="text-[17px] text-white/50">Ask TRYON to plan outfits for Goa…</p>
            <div className="mt-8 flex items-center gap-2 text-white/80">
              <span className="w-11 h-11 rounded-xl bg-white/5 inline-flex items-center justify-center"><Paperclip size={17} /></span>
              <span className="h-11 px-3 rounded-xl bg-white/5 inline-flex items-center gap-4"><MessageCircle size={17} /><ShoppingCart size={17} /><CalendarDays size={17} /></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', testid }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string; testid: string }) {
  return (
    <label className="block">
      <span className="text-[15px] font-medium">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testid}
        className="mt-2 w-full h-12 px-4 rounded-xl bg-[#f6f6f6] border border-[#e8e8e8] outline-none focus:border-[#0a0a0a] text-[15px] placeholder:text-[#a3a3a3]" />
    </label>
  )
}
