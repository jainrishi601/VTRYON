import { lazy, Suspense, useEffect, useRef, useState, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { Search, ShoppingBag, X, Menu } from 'lucide-react'
import { inr } from '../shared/format'
import { cartActions, navigate, useCart, useLocation } from './lib'
import { Home, Listing, PDP, NotFound } from './pages'
import { Judge, Merchant } from './info'

const TryonApp = lazy(() => import('../tryon/App'))

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

function route(path: string) {
  if (path === '/') return <Home />
  if (path === '/women' || path === '/men') return <Listing gender={path.slice(1) as 'women' | 'men'} />
  if (path === '/resort') return <Listing />
  if (path === '/search') return <Listing search />
  if (path.startsWith('/c/')) return <Listing slot={path.slice(3)} />
  if (path.startsWith('/p/')) return <PDP id={decodeURIComponent(path.slice(3))} />
  if (path === '/judge') return <Judge />
  if (path === '/merchant') return <Merchant />
  return <NotFound />
}

export default function App() {
  const { path } = useLocation()
  // TRYON, the shopper's own style platform (onboarding, Style DNA, wardrobe), lives beside the store without its chrome.
  if (path === '/tryon' || path.startsWith('/tryon/')) return <Suspense fallback={null}><TryonApp path={path} /></Suspense>
  return (
    <div className="min-h-screen flex flex-col">
      <Header path={path} />
      <main className="flex-1" key={path}>{route(path)}</main>
      <Footer />
      <CartDrawer />
    </div>
  )
}

function Header({ path }: { path: string }) {
  const { lines } = useCart()
  const [scrolled, setScrolled] = useState(false)
  const [searching, setSearching] = useState(false)
  const [menu, setMenu] = useState(false)
  const [bump, setBump] = useState(0)
  const prev = useRef(lines.length)
  useEffect(() => {
    if (lines.length > prev.current) setBump((b) => b + 1)
    prev.current = lines.length
  }, [lines.length])
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 120)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  const overHero = path === '/' && !scrolled && !searching && !menu
  const nav = [
    ['Women', '/women'],
    ['Men', '/men'],
    ["Resort '26", '/resort'],
  ]
  return (
    <>
      <div className="bg-ink text-white text-[12px] h-8 flex items-center justify-center px-4 text-center tracking-[0.02em]">
        Complimentary shipping above ₹4,999 · Easy 15-day returns
      </div>
      <header
        className={`sticky top-0 z-40 transition-colors duration-300 ${overHero ? 'bg-transparent text-white' : 'bg-white text-ink'} ${scrolled ? 'border-b border-line' : 'border-b border-transparent'}`}
        style={path === '/' ? { marginBottom: -64 } : undefined}
      >
        <div className="h-16 px-4 md:px-8 grid grid-cols-[1fr_auto_1fr] items-center">
          <nav className="flex items-center gap-6 text-[14px]">
            <button className="md:hidden -ml-1 p-1" aria-label="Menu" onClick={() => setMenu((m) => !m)}>
              <Menu size={20} strokeWidth={1.5} />
            </button>
            {nav.map(([l, to]) => (
              <Link key={to} to={to} className={`hidden md:inline hover:opacity-60 transition-opacity ${path === to ? 'underline underline-offset-[6px] decoration-1' : ''}`}>
                {l}
              </Link>
            ))}
          </nav>
          <Link to="/" className="font-serif text-[22px] md:text-[30px] tracking-[0.16em] md:tracking-[0.18em] leading-none pl-[0.18em]" aria-label="Northline home">
            NORTHLINE
          </Link>
          <div className="flex items-center justify-end gap-4 md:gap-5">
            <button aria-label="Search" onClick={() => setSearching((s) => !s)} className="p-1 hover:opacity-60">
              <Search size={19} strokeWidth={1.5} />
            </button>
            <button data-testid="bag-button" aria-label={`Bag, ${lines.length} items`} onClick={() => cartActions.open()} className="relative p-1 hover:opacity-60 flex items-center gap-1.5">
              <ShoppingBag size={19} strokeWidth={1.5} />
              <span key={bump} data-testid="bag-count" className={`num text-[13px] min-w-[1ch] ${bump ? 'bump' : ''}`}>{lines.length}</span>
            </button>
          </div>
        </div>
        {searching && <SearchBar onClose={() => setSearching(false)} />}
        {menu && (
          <nav className="md:hidden border-t border-line bg-white text-ink px-4 py-2 flex flex-col">
            {nav.map(([l, to]) => (
              <Link key={to} to={to} onClick={() => setMenu(false)} className="py-3 font-serif text-[28px] border-b border-line last:border-0">
                {l}
              </Link>
            ))}
          </nav>
        )}
      </header>
    </>
  )
}

function SearchBar({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  return (
    <form
      className="border-t border-line bg-white text-ink px-4 md:px-8 h-16 flex items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!q.trim()) return
        navigate(`/search?q=${encodeURIComponent(q.trim())}`)
        onClose()
      }}
    >
      <Search size={18} strokeWidth={1.5} className="text-muted" />
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        placeholder="Search linen shirts, kaftans, co-ords"
        className="flex-1 bg-transparent outline-none text-[16px] placeholder:text-muted"
        aria-label="Search the store"
      />
      <button type="button" onClick={onClose} aria-label="Close search" className="p-1"><X size={18} strokeWidth={1.5} /></button>
    </form>
  )
}

function CartDrawer() {
  const { lines, open } = useCart()
  const [note, setNote] = useState(false)
  const subtotal = lines.reduce((s, l) => s + l.price, 0)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && cartActions.close()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
  return (
    <>
      <div
        className={`fixed inset-0 z-[2147483002] bg-black/25 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => cartActions.close()}
      />
      <aside
        data-testid="cart-drawer"
        aria-hidden={!open}
        aria-label="Your bag"
        className={`fixed top-0 right-0 z-[2147483003] h-full w-full sm:w-[480px] bg-white flex flex-col shadow-[0_0_40px_rgba(0,0,0,.08)] transition-transform duration-[320ms] ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        {...(!open ? { inert: '' } : {})}
      >
        <div className="h-16 px-6 flex items-center justify-between border-b border-line">
          <h2 className="font-serif text-[28px] leading-none">Your bag <span className="num font-sans text-[14px] text-muted align-middle ml-1">({lines.length})</span></h2>
          <button aria-label="Close bag" onClick={() => cartActions.close()} className="p-2 -mr-2"><X size={20} strokeWidth={1.5} /></button>
        </div>
        {lines.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
            <p className="font-serif text-[28px]">Your bag is empty.</p>
            <button className="h-11 px-6 rounded-full border border-ink text-[14px]" onClick={() => { cartActions.close(); navigate('/women') }}>Continue shopping</button>
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto px-6 divide-y divide-line" data-testid="cart-lines">
            {lines.map((l) => (
              <li key={l.key} className="py-5 flex gap-4" data-testid="cart-line">
                <img src={l.image_url} alt="" className="w-20 h-[106px] object-cover bg-surface shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex justify-between gap-3">
                    <p className="text-[14px] leading-5">{l.title}</p>
                    <p className="num text-[14px]">{inr(l.price)}</p>
                  </div>
                  <p className="text-[13px] text-muted mt-1">Size {l.size || 'M'}</p>
                  {l.styled_with && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="label !text-[10px] px-2 py-1 rounded-full bg-surface">Styled with {l.styled_with}{l.look_name ? ` · ${l.look_name}` : ''}</span>
                      {l.crew_verdict && <span className="label !text-[10px] px-2 py-1 rounded-full bg-[#E7F2EA] text-[#1F5C3A]">Crew: {l.crew_verdict}</span>}
                    </div>
                  )}
                  <button className="mt-auto self-start text-[13px] text-muted underline underline-offset-4 hover:text-ink" onClick={() => cartActions.remove(l.key)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {lines.length > 0 && (
          <div className="border-t border-line p-6 space-y-4 bg-white">
            <div className="flex justify-between text-[15px]">
              <span>Subtotal</span>
              <span className="num font-medium" data-testid="cart-subtotal">{inr(subtotal)}</span>
            </div>
            <p className="text-[12px] text-muted">Shipping and taxes calculated at checkout.</p>
            <button className="w-full h-[52px] rounded-full bg-ink text-white text-[15px] font-medium hover:bg-black/85 transition-colors" onClick={() => setNote(true)}>
              Checkout
            </button>
            {note && <p className="text-[13px] text-muted text-center">Checkout is switched off in this demo store. Your bag stays saved.</p>}
          </div>
        )}
      </aside>
    </>
  )
}

function Footer() {
  return (
    <footer className="bg-ink text-white mt-24">
      <div className="px-4 md:px-8 py-16 grid gap-12 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <p className="font-serif text-[40px] leading-none tracking-[0.12em]">NORTHLINE</p>
          <p className="mt-4 text-[14px] text-white/60 max-w-xs">Linen, cotton and easy tailoring for long, warm days. Designed for the coast, worn everywhere.</p>
        </div>
        {[
          ['Shop', [['Women', '/women'], ['Men', '/men'], ["Resort '26", '/resort']]],
          ['Help', [['Shipping', '/judge'], ['Returns', '/judge'], ['Size guide', '/judge']]],
          ['Elara', [['Judge guide', '/judge'], ['For merchants', '/merchant'], ['Render log', '/admin/renders']]],
        ].map(([h, links]) => (
          <div key={h as string}>
            <p className="label text-white/50 mb-4">{h as string}</p>
            <ul className="space-y-2.5 text-[14px]">
              {(links as string[][]).map(([l, to]) => (
                <li key={l}>
                  {to.startsWith('/admin') ? <a href={to} className="hover:opacity-60">{l}</a> : <Link to={to} className="hover:opacity-60">{l}</Link>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="px-4 md:px-8 py-6 border-t border-white/10 text-[12px] text-white/40 flex flex-col md:flex-row gap-2 justify-between">
        <span>© 2026 Northline. A demo store for Elara Commerce.</span>
        <span>Prices in INR, inclusive of taxes.</span>
      </div>
    </footer>
  )
}
