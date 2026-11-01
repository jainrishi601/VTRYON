import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CartItem } from '../shared/types'

// ---- tiny history router ----
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
window.addEventListener('popstate', notify)
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l))
export const navigate = (to: string) => {
  if (to === location.pathname + location.search) return
  history.pushState(null, '', to)
  window.scrollTo(0, 0)
  notify()
}
export const useLocation = () => {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search)
  const url = new URL(href, location.origin)
  return { path: url.pathname, params: url.searchParams }
}

// ---- api ----
export async function get<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json() as Promise<T>
}
export function useApi<T>(path: string | null) {
  const [state, set] = useState<{ data: T | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: true })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!path) return
    let live = true
    set((s) => ({ ...s, loading: true, error: false }))
    get<T>(path).then(
      (data) => live && set({ data, error: false, loading: false }),
      () => live && set({ data: null, error: true, loading: false }),
    )
    return () => { live = false }
  }, [path, nonce])
  return { ...state, retry: () => setNonce((n) => n + 1) }
}

// ---- cart (persists per browser) ----
export interface Line extends CartItem { key: string }
let cart: Line[] = (() => { try { return JSON.parse(localStorage.getItem('northline.cart') || '[]') } catch { return [] } })()
let drawerOpen = false
const cartListeners = new Set<() => void>()
const cartSnapshot = { lines: cart, open: drawerOpen }
let snap = cartSnapshot
const emit = () => {
  snap = { lines: cart, open: drawerOpen }
  try { localStorage.setItem('northline.cart', JSON.stringify(cart)) } catch { /* private mode */ }
  cartListeners.forEach((l) => l())
}
export const useCart = () => useSyncExternalStore((l) => (cartListeners.add(l), () => cartListeners.delete(l)), () => snap)
export const cartActions = {
  add(items: CartItem[]) {
    cart = [...cart, ...items.map((i, n) => ({ ...i, key: `${i.product_id}-${Date.now()}-${n}` }))]
    drawerOpen = true
    window.Elara?.close()
    emit()
  },
  remove(key: string) { cart = cart.filter((l) => l.key !== key); emit() },
  open() { drawerOpen = true; window.Elara?.close(); emit() },
  close() { drawerOpen = false; emit() },
}
// The custom cart adapter the widget calls (data-cart-adapter="custom").
window.elaraAddToCart = (items) => cartActions.add(items)
// Widget and drawer share the right slot: opening one closes the other.
window.addEventListener('elara:open', () => { if (drawerOpen) cartActions.close() })

export const openStylist = (o?: Parameters<NonNullable<Window['Elara']>['open']>[0]) => window.Elara?.open(o)
