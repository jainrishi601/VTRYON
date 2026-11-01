// API shapes — mirror docs/ARCHITECTURE.md §2–3 (the contract).
export type Slot = 'top' | 'bottom' | 'one_piece' | 'layer' | 'bag' | 'accessory'
export type Gender = 'women' | 'men' | 'unisex'

export interface Product {
  id: string
  title: string
  description: string
  price: number
  currency: string
  gender: Gender
  slot: Slot
  category: string
  colors: string[]
  color_family: string
  pattern: string
  vibes: string[]
  formality: number
  fit: string
  occasions: string[]
  statement_level: number
  fabric: string
  one_liner: string
  image_url: string
  image_url_alt?: string | null
  vto_ready: boolean
  sizes_in_stock: string[]
  product_url: string
}

export type ScoreBand = 'great' | 'works' | 'bold'
export type RenderStatus = 'pending' | 'rendering' | 'ready' | 'failed'

export interface Look {
  id: string
  name: string
  why: string
  items: { slot: Slot; product: Product }[]
  total: number
  currency: string
  score: number
  score_band: ScoreBand
  score_reason: string
  budget_max: number | null
  over_budget_by: number | null
  parent_look_id: string | null
  render: { status: RenderStatus; image_url: string | null; steps_done: number; steps_total: number; cached: boolean; error: string | null }
  video: { status: 'none' | 'pending' | 'ready' | 'failed'; url: string | null }
  before_url: string | null
}

export interface Alternative { product: Product; score: number; score_band: ScoreBand; reason: string; price_delta: number }

export interface Brief {
  for: 'self' | 'other'
  recipient?: { relation?: string; gender?: 'women' | 'men'; age_range?: string }
  occasion: string
  budget_max?: number | null
  gender?: 'women' | 'men' | 'both'
  profession?: string
  age_range?: string
  fit?: 'relaxed' | 'regular' | 'fitted'
}

export interface DnaSummary { vibes: Record<string, number>; colors: Record<string, number>; never: string[]; name: string | null; traits: string[] }
export interface Profile { brief: Brief | null; dna: DnaSummary; last_occasion: string | null }
export interface Session { id: string; user_token: string; brief: Brief | null; photo_url: string | null; sample_model_id: string | null; dna: DnaSummary }

export interface StoreInfo {
  id: string; name: string; currency: string; genders: string[]; slots: Slot[]; occasions: string[]
  budget: { min: number; max: number; step: number; default?: number }
}
export interface SampleModel { id: string; gender: string; label: string; image_url: string }
export interface Tile { id: string; vibe: string; product: Product; status: 'pending' | 'ready' | 'failed'; image_url: string | null }

export interface Member { id: string; display_name: string; avatar_url: string | null; is_owner: boolean; is_you: boolean }
export interface Comment { id: string; look_id: string; slot: Slot | null; member_id: string; display_name: string; text: string | null; reaction: 'up' | 'down' | 'swap' | null; created_at: string }
export interface CrewLook {
  look: Look
  renders: { member_id: string; status: string; image_url: string | null }[]
  verdict: { up: number; down: number; voters: number; label: string }
  slot_counts: Record<string, { up: number; down: number; swap: number; comments: number }>
}
export interface Crew { id: string; name: string; occasion: string; share_url: string; members: Member[]; looks: CrewLook[]; comments: Comment[]; updated_at: string }

/** Item handed to the host store's cart adapter (window.elaraAddToCart). */
export interface CartItem { product_id: string; title: string; price: number; image_url: string; size?: string; look_name?: string; styled_with?: string; crew_verdict?: string }
