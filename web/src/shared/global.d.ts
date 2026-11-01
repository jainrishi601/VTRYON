import type { CartItem } from './types'

export interface ElaraOpenOptions { tab?: 'chat' | 'studio' | 'crew'; productId?: string; productIds?: string[]; message?: string; lookId?: string }

declare global {
  interface Window {
    Elara?: { open: (o?: ElaraOpenOptions) => void; close: () => void; isOpen: () => boolean }
    elaraAddToCart?: (items: CartItem[]) => void
    __ELARA_SCRIPT__?: HTMLScriptElement | null
  }
}
