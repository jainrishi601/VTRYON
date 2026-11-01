import { createRoot } from 'react-dom/client'
import css from './widget.css?inline'
import { setBase, ls } from './api'
import { ElaraProvider, controller, type Cfg } from './state'
import { Launcher, Panel } from './Panel'

// Elara Commerce widget: one <script> tag, mounted in a Shadow DOM so host CSS and ours never meet.
// currentScript is only set while this file first executes, so capture it now.
const script = (document.currentScript as HTMLScriptElement | null) ?? window.__ELARA_SCRIPT__ ?? document.querySelector<HTMLScriptElement>('script[src*="widget.js"]')

function mount() {
  if (document.getElementById('elara-root')) return
  const d = script?.dataset ?? {}
  setBase(d.api ?? (script?.src ? new URL(script.src, location.href).origin : ''))
  const cfg: Cfg = { storeId: d.storeId ?? 'default', cartAdapter: d.cartAdapter ?? 'custom', position: d.position ?? 'bottom-center' }

  // @font-face doesn't work inside a shadow root: load fonts on the host document once.
  if (!document.querySelector('link[href*="family=Outfit"]')) {
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap'
    document.head.appendChild(l)
  }
  // Same for @property (Tailwind v4 relies on it for shadows/rings/transforms): register on the document.
  const props = css.match(/@property[^{]+\{[^}]*\}/g)
  if (props && !document.getElementById('elara-props')) {
    const s = document.createElement('style')
    s.id = 'elara-props'
    s.textContent = props.join('\n')
    document.head.appendChild(s)
  }

  const host = document.createElement('div')
  host.id = 'elara-root'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = css
  shadow.appendChild(style)
  const app = document.createElement('div')
  shadow.appendChild(app)

  const params = new URLSearchParams(location.search)
  const crew = params.get('crew')
  if (crew) ls.set('elara.crew', crew)

  createRoot(app).render(
    <ElaraProvider cfg={cfg}>
      <div className="ew">
        <Launcher />
        <Panel />
      </div>
    </ElaraProvider>,
  )

  window.Elara = { open: (o) => controller.open(o), close: () => controller.close(), isOpen: () => controller.isOpen() }

  // Any element with data-elara-tryon="<productId>" becomes a try-on trigger.
  document.addEventListener('click', (ev) => {
    const el = (ev.target as Element | null)?.closest?.('[data-elara-tryon]')
    if (!el) return
    ev.preventDefault()
    ev.stopPropagation()
    controller.open({ productId: el.getAttribute('data-elara-tryon') ?? undefined })
  }, true)

  if (crew) controller.open({ tab: 'crew' })
  else if (params.get('look')) controller.open({ lookId: params.get('look')! })
  else if (params.get('ask')) controller.open({ message: params.get('ask')! }) // e.g. TRYON's "Style this" on a wardrobe piece
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
else mount()
