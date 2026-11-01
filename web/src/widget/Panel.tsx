import { useEffect, useRef, useState } from 'react'
import { SquarePen, X } from 'lucide-react'
import { useElara, type Tab } from './state'
import { ls } from './api'
import { Onboarding } from './Onboarding'
import { Chat } from './Chat'
import { Viewer, SwapDrawer } from './Viewer'
import { Studio } from './Studio'
import { CrewTab, ShareSheet } from './Crew'
import { Ring } from './ui'

export function Launcher() {
  const e = useElara()
  const avatar = e.session?.photo_url ? ls.get('elara.avatar') : null
  return (
    <button
      data-testid="elara-launcher"
      aria-label="Open your stylist"
      onClick={() => e.openWith()}
      className={`fixed z-[2147483000] bottom-6 ${e.cfg.position === 'bottom-left' ? 'left-6' : 'right-6'} h-[52px] rounded-full bg-ink text-white shadow-[0_8px_24px_rgba(0,0,0,.18)] inline-flex items-center gap-2.5 text-[15px] font-medium transition-all duration-[240ms] hover:-translate-y-0.5 ${avatar ? 'pl-3 pr-6' : 'px-6'} ${e.open ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-100'}`}
    >
      {avatar && <img src={avatar} alt="" className="w-7 h-7 rounded-full object-cover object-top ring-1 ring-white/30" />}
      Style me
      {e.unread && <span data-testid="launcher-badge" className="absolute top-2.5 right-3 w-2 h-2 rounded-full bg-accent ring-2 ring-ink" aria-label="New crew comments" />}
    </button>
  )
}

const TABS: [Tab, string][] = [['chat', 'Chat'], ['studio', 'Studio'], ['crew', 'Crew']]

export function Panel() {
  const e = useElara()
  const onboarding = e.tab === 'chat' && ['boot', 'who', 'photo', 'dna', 'error'].includes(e.stage)
  const ref = useRef<HTMLElement>(null)

  // At ≥1440px the panel pushes the page instead of covering it.
  useEffect(() => {
    const apply = () => {
      document.body.style.marginRight = e.open && innerWidth >= 1440 ? '480px' : ''
      document.body.style.overflow = e.open && innerWidth < 640 ? 'hidden' : '' // full-screen on phones: lock the page
    }
    apply()
    addEventListener('resize', apply)
    return () => removeEventListener('resize', apply)
  }, [e.open])

  useEffect(() => { if (e.open) ref.current?.focus() }, [e.open])
  useEffect(() => { if (e.open && e.tab === 'crew') e.markCrewSeen() }, [e.open, e.tab, e.crew, e.markCrewSeen])

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      data-testid="elara-panel"
      aria-label="Ava, your stylist"
      aria-hidden={!e.open}
      {...(!e.open ? { inert: '' } : {})}
      onKeyDown={(ev) => {
        if (ev.key !== 'Escape') return
        if (e.swap) e.setSwap(null)
        else if (e.share) e.setShare(null)
        else if (e.viewer) e.setViewer(null)
        else e.setOpen(false)
      }}
      className={`ew fixed z-[2147483001] top-0 right-0 h-full w-full sm:w-[480px] bg-white border-l border-line shadow-[0_0_40px_rgba(0,0,0,.08)] flex flex-col outline-none transition-[translate,visibility] duration-[320ms] ease-[cubic-bezier(0.2,0,0,1)] ${e.open ? 'translate-x-0 visible' : 'translate-x-full invisible'}`}
      style={{ height: '100dvh' }}
    >
      <header className="h-16 shrink-0 px-4 sm:px-6 flex items-center gap-3 border-b border-line" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-serif text-[26px] leading-none">Ava</span>
          {onboarding && <span className="label text-muted truncate">Your stylist</span>}
        </div>
        {!onboarding && (
          <div role="tablist" className="mx-auto h-9 p-1 rounded-full bg-surface flex" data-testid="elara-tabs">
            {TABS.map(([t, l]) => (
              <button
                key={t}
                role="tab"
                data-testid={`tab-${t}`}
                aria-selected={e.tab === t}
                onClick={() => e.setTab(t)}
                className={`relative h-7 px-3.5 sm:px-4 rounded-full text-[13px] font-medium transition-all duration-150 ${e.tab === t ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,.1)] text-ink' : 'text-muted hover:text-ink'}`}
              >
                {l}
                {t === 'crew' && e.unread && e.tab !== 'crew' && <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        )}
        <div className={`flex items-center gap-1 ${onboarding ? 'ml-auto' : ''}`}>
          {!onboarding && e.tab === 'chat' && (
            <button data-testid="new-chat" aria-label="New chat" title="New chat" onClick={() => e.newChat()} className="w-9 h-9 rounded-full inline-flex items-center justify-center hover:bg-surface"><SquarePen size={17} strokeWidth={1.5} /></button>
          )}
          <button data-testid="elara-close" aria-label="Close stylist" onClick={() => e.setOpen(false)} className="w-9 h-9 -mr-2 rounded-full inline-flex items-center justify-center hover:bg-surface"><X size={19} strokeWidth={1.5} /></button>
        </div>
      </header>

      <div className="relative flex-1 min-h-0 flex flex-col">
        {e.tab === 'chat' && (e.stage === 'boot' ? <Booting /> : e.stage === 'error' ? <BootError /> : onboarding ? <Onboarding /> : <Chat />)}
        {e.tab === 'studio' && <Studio />}
        {e.tab === 'crew' && <CrewTab />}

        {e.viewer && <Viewer />}
        {e.swap && <SwapDrawer />}
        {e.share && <ShareSheet />}
        {e.toast && (
          <div role="status" data-testid="toast" key={e.toast.id} className="absolute left-4 right-4 top-3 z-50 fade-in">
            <div className="mx-auto max-w-[400px] bg-ink text-white rounded-[14px] px-4 py-3 text-[14px] flex items-center gap-3 shadow-[0_8px_24px_rgba(0,0,0,.2)]">
              <span className="flex-1">{e.toast.text}</span>
              {e.toast.action && <button className="font-medium underline underline-offset-4" onClick={() => { e.toast!.action!.fn(); e.setToast(null) }}>{e.toast.action.label}</button>}
            </div>
          </div>
        )}
      </div>
      {!onboarding && <Footer />}
    </aside>
  )
}

function Footer() {
  const e = useElara()
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="shrink-0 h-9 px-6 border-t border-line flex items-center justify-center gap-3 text-[11px] text-muted pb-[env(safe-area-inset-bottom)]" data-testid="elara-footer">
      {confirm ? (
        <>
          <span className="text-ink">Delete your photo, looks and style data?</span>
          <button className="font-medium text-accent underline underline-offset-2" data-testid="forget-confirm" onClick={() => { setConfirm(false); e.forgetMe() }}>Delete</button>
          <button className="underline underline-offset-2" onClick={() => setConfirm(false)}>Keep</button>
        </>
      ) : (
        <>
          <button className="hover:text-ink underline-offset-2 hover:underline" onClick={() => e.downloadData()}>Download my style data</button>
          <span aria-hidden>·</span>
          <button className="hover:text-ink underline-offset-2 hover:underline" data-testid="forget-me" onClick={() => setConfirm(true)}>Forget me</button>
        </>
      )}
    </div>
  )
}

function Booting() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[14px] text-muted">
      <Ring done={false} />
      Getting your stylist ready
    </div>
  )
}

function BootError() {
  const e = useElara()
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 text-center">
      <p className="font-serif text-[28px] leading-tight">Ava can’t reach the studio right now.</p>
      <button className="h-11 px-6 rounded-full bg-ink text-white text-[14px] font-medium" onClick={() => e.boot()}>Try again</button>
    </div>
  )
}
