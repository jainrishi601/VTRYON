const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
export const inr = (n: number) => inrFmt.format(Math.round(n))
export const signedInr = (n: number) => (n === 0 ? 'Same price' : `${n > 0 ? '+' : '−'}${inrFmt.format(Math.abs(Math.round(n)))}`)

export const SLOT_LABEL: Record<string, string> = {
  top: 'Tops', bottom: 'Bottoms', one_piece: 'Dresses & sets', layer: 'Layers', bag: 'Bags', accessory: 'Accessories',
}
export const SLOT_SINGULAR: Record<string, string> = {
  top: 'top', bottom: 'bottom', one_piece: 'one-piece', layer: 'layer', bag: 'bag', accessory: 'accessory',
}
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
export const catName = (c: string) => (c || '').replace(/_/g, ' ')
