// TRYON API client: bearer auth from login/signup; the account's shopper token is shared with the store widget.

const KEY = 'tryon.auth'
export const auth = {
  get: () => { try { return localStorage.getItem(KEY) } catch { return null } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY) } catch { /* private mode */ } },
}

export class ApiErr extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function call<T>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const t = auth.get()
  if (t) headers.Authorization = `Bearer ${t}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const r = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  })
  if (!r.ok) {
    let msg = 'Something went wrong on our side. Try again.'
    try { msg = (await r.json()).error?.message ?? msg } catch { /* not JSON */ }
    throw new ApiErr(r.status, msg)
  }
  return r.json() as Promise<T>
}

/** After login: the store widget on this site uses the account's shopper token, and starts a fresh chat. */
export function adoptShopper(userToken: string) {
  try {
    localStorage.setItem('elara.token', userToken)
    sessionStorage.removeItem('elara.sid')
  } catch { /* private mode */ }
}

export type Gender = 'women' | 'men' | 'both'
export interface Profile {
  goal?: 'build' | 'utilise' | 'mindful'
  gender?: Gender
  profession?: string
  age_range?: string
  sizes?: { region?: string; tops?: string; bottoms?: string; dresses?: string; footwear?: string }
  height_cm?: number
  weight_kg?: number
  colors?: string[]
  never?: string[]
  onboarded?: boolean
  step?: number
  selfie_url?: string
  body_url?: string
  palette?: { undertone: string | null; summary: string; recommended: string[]; analyzed: boolean }
}
export interface User { id: string; email: string; name: string; user_token: string; profile: Profile }
export interface Shade { name: string; hex: string; family: string }
export interface Options { palette: Shade[]; never: Record<string, { key: string; label: string }[]>; sizes: string[] }
export interface Vibe { id: string; vibe: string; line: string; status: 'pending' | 'ready' | 'failed'; image_url: string | null; rendered: boolean; verdict: string | null; product: { title: string; image_url: string } | null }
export interface Piece {
  id: string; name: string; slot: string; category: string; colors: string[]; color_family: string; pattern: string
  fabric: string; vibes: string[]; formality: number; fit: string | null; occasions: string[]; season: string[]
  image_url: string; allow_styling: boolean; tagged: boolean; created_at: string
}
export interface DnaPage {
  name: string | null; traits: string[]
  facts: { key: string; label: string; value: string; swatches?: string[] }[]
  learning: { kind: string; value: string; weight: number }[]
  never: string[]; occasions: string[]; wardrobe: Record<string, number>
  palette: Profile['palette'] | null
  timeline: { type: string; weight: number; created_at: string; kind: string; value: string }[]
}

export const FAMILY_HEX: Record<string, string> = {
  white: '#f4f1ea', beige: '#d9c7a7', black: '#141414', grey: '#8c8c8c', green: '#5f7f4a', red: '#c0392b',
  purple: '#7d5ba6', pink: '#e391ab', brown: '#7a5134', yellow: '#e2b93b', orange: '#e07b39', blue: '#2f5d9b',
}
export const SLOT_LABEL: Record<string, string> = {
  top: 'Tops', bottom: 'Bottoms', one_piece: 'Dresses & sets', layer: 'Layers', footwear: 'Footwear', bag: 'Bags', accessory: 'Accessories',
}
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : s)

export interface LookItem { slot: string; product: { id: string; title: string; price: number; image_url: string; product_url: string; owned?: boolean; color_family?: string } }
export interface TLook {
  id: string; name: string; why: string; tip: string | null; items: LookItem[]; total: number; score: number; score_band: string
  render: { status: 'idle' | 'pending' | 'rendering' | 'ready' | 'failed'; image_url: string | null; error: string | null; code: string | null }
}
export interface Pick { kind: 'casual' | 'formal' | 'trendy'; label: string; feedback: string | null; look: TLook; owned: number; can_try: boolean }
export interface PlaySide { product: { id: string; title: string; image_url: string; price: number }; title: string; sub: string }
export interface PlayPair { id: string; dimension: string; label: string; context: string; question: string; answered: number; a: PlaySide; b: PlaySide }

/** The store's stylist widget (same site, same shopper token). */
export const stylist = () => (window as unknown as { Elara?: { open: (o: { message?: string; lookId?: string }) => void } }).Elara
