import type { CartItem } from './types'

export interface ElaraOpenOptions { tab?: 'chat' | 'studio' | 'crew'; productId?: string; productIds?: string[]; message?: string; lookId?: string }

declare global {
  interface Window {
    Drape?: { open: (o?: ElaraOpenOptions) => void; close: () => void; isOpen: () => boolean }
    drapeAddToCart?: (items: CartItem[]) => void
    __ELARA_SCRIPT__?: HTMLScriptElement | null
  }
}
