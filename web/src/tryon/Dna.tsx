import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, HelpCircle, Shirt, Trash2, X } from 'lucide-react'
import { navigate } from '../store/lib'
import { call, cap, FAMILY_HEX, SLOT_LABEL, type DnaPage, type Options, type PlayPair, type User } from './api'
import { go, PageHead, plural, useMedia } from './ui'

type Tab = 'overview' | 'map' | 'play' | 'timeline'
const TABS: [Tab, string][] = [['overview', 'Overview'], ['map', 'Style Map'], ['play', 'Style Play'], ['timeline', 'Timeline']]
const HEAD: Record<Tab, [string, string]> = {
  overview: ['Style DNA', 'What TRYON remembers about your style and your boundaries, and where you can correct it.'],
  map: ['Style Map', 'What you told TRYON, the taste it is learning, your hard boundaries, and the wardrobe and plans they shape.'],
  play: ['Style Play', 'Two pieces for the same moment, chosen to test one thing: colour, fit, detail or mood. Go with your first instinct.'],
  timeline: ['Timeline', 'Every answer, swipe and try-on that shaped your Style DNA, newest first.'],
}

/** Style DNA: what TRYON knows (what you told it, what it is learning, your hard boundaries, your wardrobe and plans)
 *  and where you can correct it. The tab lives in the URL (/tryon/dna/map), so links and reloads land on it. */
export function Dna({ me, path }: { me: User; path: string }) {
  const seg = path.split('/')[3] as Tab | undefined
  const tab: Tab = seg && TABS.some(([t]) => t === seg) ? seg : 'overview'
  const [d, setD] = useState<DnaPage | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const load = useCallback(() => call<DnaPage>('/api/me/dna').then(setD, (x) => setErr((x as Error).message)), [])
  useEffect(() => {
    load()
    call<Options>('/api/tryon/options').then((o) => setNames(Object.fromEntries(o.palette.map((s) => [s.hex.toLowerCase(), s.name]))), () => {})
  }, [load])
  const forget = async (kind: string, value: string) => {
    await call(`/api/me/dna?kind=${encodeURIComponent(kind)}&value=${encodeURIComponent(value)}`, { method: 'DELETE' })
    load()
  }
  return (
    <div className="px-5 sm:px-10 xl:px-14 py-8 sm:py-12 max-w-[1280px] mx-auto" data-testid="dna-page">
      <PageHead eyebrow={d?.name ? `Your style · ${d.name}` : 'Your style'} title={HEAD[tab][0]} sub={HEAD[tab][1]} />
      <div className="mt-8 -mx-5 px-5 sm:mx-0 sm:px-0 flex gap-6 border-b border-line t-xscroll" role="tablist">
        {TABS.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => go(t === 'overview' ? '/tryon/dna' : `/tryon/dna/${t}`, true)} data-testid={`dna-tab-${t}`}
            className={`shrink-0 h-11 text-[14px] border-b-2 -mb-px whitespace-nowrap transition-colors duration-150 ${tab === t ? 'border-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>
      {!me.profile.onboarded && (
        <div className="mt-8 rounded-[14px] bg-surface px-5 py-4 flex flex-wrap items-center gap-4" data-testid="finish-profile">
          <p className="flex-1 min-w-[220px] text-[15px]"><b className="font-semibold">Finish your profile</b> so the stylist gets your gender, sizes, colours and vibes right from the first look.</p>
          <button onClick={() => navigate('/tryon/onboarding')} className="h-10 px-5 rounded-full bg-ink text-white text-[14px] font-medium">Continue onboarding</button>
        </div>
      )}
      {err && <p className="mt-8 text-[15px] text-accent">{err}</p>}
      {!d ? <div className="mt-10 h-[420px] t-skel" /> : (
        <div className="t-fade" key={tab}>
          {tab === 'overview' && <Overview d={d} names={names} onForget={forget} />}
          {tab === 'map' && <Constellation d={d} names={names} onForget={forget} />}
          {tab === 'timeline' && <Timeline d={d} />}
          {tab === 'play' && <Play onVoted={load} />}
        </div>
      )}
    </div>
  )
}

const strength = (w: number) => (Math.abs(w) >= 1.5 ? 'Strong' : Math.abs(w) >= 0.7 ? 'Leaning' : 'Slight')
const kindLabel = (k: string) => ({ vibe: 'Vibe', color: 'Colour', pattern: 'Pattern', category: 'Piece', fabric: 'Fabric' } as Record<string, string>)[k] ?? cap(k)
/** Colour fact → one name per swatch (names from the palette, so the count always matches the swatches). */
const shades = (f: DnaPage['facts'][number] | undefined, names: Record<string, string>) =>
  (f?.swatches ?? []).map((h, i) => ({ hex: h, name: names[h.toLowerCase()] ?? f!.value.split(', ')[i] ?? '' }))
const Label = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="mt-14 mb-5 flex items-baseline justify-between gap-4 border-b border-line pb-3"><h2 className="font-serif text-[30px] leading-none">{children}</h2>{right && <p className="text-[13px] text-muted">{right}</p>}</div>
)

function Overview({ d, names, onForget }: { d: DnaPage; names: Record<string, string>; onForget: (k: string, v: string) => void }) {
  const [list, setList] = useState<'learning' | 'never'>('learning')
  const colours = shades(d.facts.find((f) => f.key === 'colors'), names)
  return (
    <>
      {d.name && (
        <section className="mt-10 grid md:grid-cols-[1fr_auto] gap-8 items-end bg-surface p-6 sm:p-10" data-testid="dna-hero">
          <div>
            <p className="label text-muted">Your Style DNA</p>
            <p className="mt-3 font-serif text-[52px] sm:text-[80px] leading-[0.92] tracking-[-0.01em]" data-testid="dna-name">{d.name}</p>
            <div className="mt-5 flex flex-wrap gap-2">{d.traits.map((t) => <span key={t} className="h-8 px-3.5 rounded-full bg-white text-[13px] inline-flex items-center">{t}</span>)}</div>
          </div>
          {colours.length > 0 && (
            <div className="flex md:flex-col md:items-end gap-3">
              <div className="flex">{colours.slice(0, 8).map((c, i) => <span key={i} className="w-9 h-9 sm:w-11 sm:h-11 rounded-full border-2 border-surface -ml-2 first:ml-0" style={{ background: c.hex }} title={c.name} />)}</div>
              <p className="text-[12px] text-muted self-center md:self-auto">{plural(colours.length, 'colour')} you wear</p>
            </div>
          )}
        </section>
      )}
      <Label right="Hard facts, not guesses">What you told me</Label>
      {d.facts.length === 0 ? <Empty text="Nothing yet. Your onboarding answers will show up here." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 border-t border-l border-line" data-testid="dna-facts">
          {d.facts.map((f) => (
            <div key={f.key} className={`p-5 border-r border-b border-line ${f.key === 'colors' ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
              <p className="label text-muted">{f.label}</p>
              {f.key === 'colors' ? (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2.5" data-testid="dna-colours">
                  {colours.map((c) => <span key={c.hex} className="inline-flex items-center gap-2 text-[14px]"><span className="w-4 h-4 rounded-full border border-black/10" style={{ background: c.hex }} />{c.name}</span>)}
                </div>
              ) : <p className="mt-2 text-[17px]">{f.value}</p>}
            </div>
          ))}
        </div>
      )}
      <div className="mt-14 mb-5 flex items-center gap-6 border-b border-line" role="tablist">
        {([['learning', 'What I’m learning', d.learning.length], ['never', 'Never list', d.never.length]] as const).map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={list === k} onClick={() => setList(k)} className={`h-12 -mb-px border-b-2 font-serif text-[24px] sm:text-[30px] leading-none inline-flex items-center gap-2 transition-colors duration-150 ${list === k ? 'border-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {l}<span className="font-sans text-[12px] text-muted num">{n}</span>
          </button>
        ))}
      </div>
      {list === 'learning' ? (
        d.learning.length === 0 ? <Empty text="I learn as you swipe, chat, try on and add to your bag." /> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 border-t border-l border-line" data-testid="dna-learning">
            {d.learning.map((x) => (
              <div key={x.kind + x.value} className="p-5 flex flex-col border-r border-b border-line">
                <div className="flex items-center gap-2"><p className="label text-muted flex-1">{kindLabel(x.kind)} · {x.weight > 0 ? strength(x.weight) : 'Passing'}</p>
                  <button onClick={() => onForget(x.kind, x.value)} aria-label={`Forget ${x.value}`} title="Forget this" className="w-8 h-8 -mr-1.5 rounded-full inline-flex items-center justify-center text-muted hover:text-ink hover:bg-surface"><Trash2 size={14} /></button></div>
                <p className="mt-1 font-serif text-[28px] leading-tight flex items-center gap-2.5">
                  {x.kind === 'color' && <span className="w-5 h-5 rounded-full border border-black/10" style={{ background: FAMILY_HEX[x.value] ?? '#ccc' }} />}{cap(x.value.replace(/_/g, ' '))}
                </p>
                <div className="mt-auto pt-4 flex items-center gap-3">
                  <div className="flex-1 h-1 bg-surface overflow-hidden"><div className={`h-full ${x.weight > 0 ? 'bg-ink' : 'bg-muted/50'}`} style={{ width: `${Math.min(100, Math.abs(x.weight) / 2.5 * 100)}%` }} /></div>
                  <span className="text-[12px] text-muted">{x.weight > 0 ? 'You lean toward it' : 'You pass on it'}</span>
                </div>
              </div>
            ))}
          </div>
        )
      ) : d.never.length === 0 ? <Empty text="Nothing is off-limits. Tell the stylist “never show me…” or set it in your profile." /> : (
        <div className="flex flex-wrap gap-2.5" data-testid="dna-never">
          {d.never.map((v) => (
            <span key={v} className="h-11 pl-4 pr-1.5 rounded-full border border-line text-[15px] inline-flex items-center gap-2"><X size={14} className="text-accent" />{cap(v.replace(/_/g, ' '))}
              <button onClick={() => onForget(neverKind(v), v)} aria-label={`Remove ${v}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-muted hover:text-ink hover:bg-surface"><Trash2 size={13} /></button></span>
          ))}
        </div>
      )}
      <WardrobeCard d={d} />
    </>
  )
}

const PATTERNS = new Set(['floral', 'stripe', 'check', 'graphic', 'polka', 'animal', 'colorblock', 'abstract', 'textured', 'solid'])
const neverKind = (v: string) => (PATTERNS.has(v) ? 'pattern' : FAMILY_HEX[v] ? 'color' : 'category')

function WardrobeCard({ d }: { d: DnaPage }) {
  const n = Object.values(d.wardrobe).reduce((a, b) => a + b, 0)
  return (
    <button onClick={() => navigate('/tryon/wardrobe')} className="mt-14 w-full bg-surface p-6 flex items-center gap-5 text-left group">
      <Shirt size={26} strokeWidth={1.3} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-serif text-[26px] leading-tight">{n ? `${plural(n, 'piece')} in your wardrobe` : 'Add what you own'}</p>
        <p className="text-[14px] text-muted mt-1">{n ? Object.entries(d.wardrobe).map(([s, c]) => `${SLOT_LABEL[s] ?? cap(s)} ${c}`).join(' · ') : 'The stylist pairs store pieces with your own clothes.'}</p>
      </div>
      <ArrowUpRight size={20} className="shrink-0 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </button>
  )
}

const Empty = ({ text }: { text: string }) => <p className="py-8 text-center font-serif text-[22px] text-muted">{text}</p>

// ---------------------------------------------------------------------------------------------------- constellation

type Cluster = 'told' | 'learning' | 'never' | 'life'
interface Node { id: string; cluster: Cluster; label: string; detail: string; kind?: string; value?: string; weight?: number }
const CL: Record<Cluster, { x: number; y: number; color: string; name: string; legend: string; how: string[] }> = {
  told: { x: 230, y: 160, color: '#111111', name: 'Things you told me', legend: 'Told by you', how: ['Applied as a hard fact in every look and search.', 'Sets the gender, sizes and colours the stylist shops.', 'Change it any time in your profile.'] },
  learning: { x: 670, y: 160, color: '#2F7A4F', name: 'What I’m learning', legend: 'Learned taste', how: ['Leans looks toward it, a little more each time you like or try on.', 'Fades slowly if you stop choosing it.', 'Forget it here and it stops counting.'] },
  never: { x: 230, y: 470, color: '#B5532E', name: 'Never list', legend: 'Never', how: ['Kept out of every look and search, in every store.', 'Remove it here to see it again.'] },
  life: { x: 670, y: 470, color: '#8A6A3B', name: 'Wardrobe & plans', legend: 'Wardrobe & plans', how: ['Store pieces are paired with what you own.', 'Recent occasions guide what you are shown next.'] },
}
const NUMERIC = new Set(['age_range', 'height_cm', 'weight_kg'])
/** Up to two lines of ~22 characters, split at a word; nothing is cut unless a label is very long. */
function wrap(s: string, n = 22): string[] {
  if (s.length <= n) return [s]
  const words = s.split(' ')
  let a = ''
  while (words.length && (a + ' ' + words[0]).trim().length <= n) a = (a + ' ' + words.shift()).trim()
  if (!a) { a = s.slice(0, n); words.splice(0, words.length, s.slice(n)) }
  const b = words.join(' ')
  return [a, b.length > n + 2 ? b.slice(0, n + 1) + '…' : b]
}

function useNodes(d: DnaPage, names: Record<string, string>) {
  return useMemo(() => {
    const out: Node[] = []
    d.facts.forEach((f) => {
      const label = f.key === 'colors' ? `${plural(shades(f, names).length, 'colour')} you wear` : NUMERIC.has(f.key) ? `${f.label} ${f.value}` : f.value
      out.push({ id: `f:${f.key}`, cluster: 'told', label, detail: f.key === 'colors' ? shades(f, names).map((c) => c.name).join(', ') : f.label })
    })
    d.learning.filter((x) => x.weight > 0).slice(0, 7).forEach((x) => out.push({ id: `l:${x.kind}:${x.value}`, cluster: 'learning', label: cap(x.value.replace(/_/g, ' ')), detail: `${kindLabel(x.kind)} · ${strength(x.weight)}`, kind: x.kind, value: x.value, weight: x.weight }))
    d.never.slice(0, 6).forEach((v) => out.push({ id: `n:${v}`, cluster: 'never', label: cap(v.replace(/_/g, ' ')), detail: 'Hard boundary', kind: neverKind(v), value: v }))
    Object.entries(d.wardrobe).forEach(([s, c]) => out.push({ id: `w:${s}`, cluster: 'life', label: `${SLOT_LABEL[s] ?? cap(s)} · ${c}`, detail: `${plural(c, 'piece')} in your wardrobe` }))
    d.occasions.slice(0, 3).forEach((o) => out.push({ id: `o:${o}`, cluster: 'life', label: o, detail: 'Recently shopped for' }))
    return out
  }, [d, names])
}

function Constellation({ d, names, onForget }: { d: DnaPage; names: Record<string, string>; onForget: (k: string, v: string) => void }) {
  const [hide, setHide] = useState<Set<Cluster>>(new Set())
  const [sel, setSel] = useState<Node | null>(null)
  const wide = useMedia('(min-width: 768px)')
  const nodes = useNodes(d, names)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => { if (sel && !wide) panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [sel, wide])
  const byCluster = (c: Cluster) => nodes.filter((n) => n.cluster === c)
  const ROW = 52
  const rowsOf = (c: Cluster) => Math.max(1, Math.ceil(byCluster(c).length / 2))
  const top = (c: Cluster) => CL[c].y - rowsOf(c) * (ROW / 2) // the cluster's label sits here; its pills stack below
  const pos = (c: Cluster, i: number, n: number) => {
    const side = n === 1 ? 0 : i % 2 === 0 ? -1 : 1
    return [CL[c].x + side * 114, top(c) + 48 + Math.floor(i / 2) * ROW]
  }
  const W = (lines: string[]) => Math.min(222, 28 + Math.max(...lines.map((l) => l.length)) * 7.4)
  const legend = (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(CL) as Cluster[]).map((c) => (
        <button key={c} aria-pressed={!hide.has(c)} onClick={() => setHide((h) => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n })}
          className={`h-8 px-3 rounded-full border text-[13px] inline-flex items-center gap-1.5 transition-colors duration-150 ${hide.has(c) ? 'border-line text-muted' : 'border-line bg-white'}`}>
          <span className="w-2 h-2 rounded-full" style={{ background: hide.has(c) ? '#d4d0c8' : CL[c].color }} />{CL[c].legend}
        </button>
      ))}
    </div>
  )
  return (
    <div className="mt-8 grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="relative bg-surface" data-testid="dna-map">
        <div className="p-4">{legend}</div>
        {wide ? (
          <svg viewBox="0 0 900 640" className="w-full h-auto block" role="img" aria-label="Your style map">
            {(Object.keys(CL) as Cluster[]).map((c) => !hide.has(c) && (
              <line key={c} x1={450} y1={320} x2={CL[c].x} y2={top(c)} stroke={CL[c].color} strokeOpacity={0.35} strokeWidth={1.2} pointerEvents="none" />
            ))}
            {(Object.keys(CL) as Cluster[]).map((c) => {
              if (hide.has(c)) return null
              const list = byCluster(c)
              return (
                <g key={c + 'n'}>
                  {list.map((n, i) => {
                    const [x, y] = pos(c, i, list.length)
                    const lines = wrap(n.label)
                    const w = W(lines)
                    const h = lines.length > 1 ? 44 : 32
                    const on = sel?.id === n.id
                    return (
                      <g key={n.id}>
                      <line x1={CL[c].x} y1={top(c)} x2={x} y2={y} stroke={CL[c].color} strokeOpacity={0.14} strokeDasharray={c === 'life' ? '3 4' : undefined} pointerEvents="none" />
                      <g className="t-node" onClick={() => setSel(n)} data-testid="dna-node" style={{ transformOrigin: `${x}px ${y}px` }}>
                        <title>{n.label}</title>
                        <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} fill={on ? CL[c].color : '#fff'} stroke={CL[c].color} strokeOpacity={on ? 1 : 0.35} />
                        <text x={x} y={y - (lines.length - 1) * 8} textAnchor="middle" fontSize={14} fill={on ? '#fff' : '#111'} fontFamily="Hanken Grotesk, sans-serif">
                          {lines.map((l, k) => <tspan key={k} x={x} dy={k ? 16 : '0.35em'}>{l}</tspan>)}
                        </text>
                      </g>
                      </g>
                    )
                  })}
                  <text x={CL[c].x} y={top(c)} dy="0.35em" textAnchor="middle" fontSize={26} fill="#111" fontFamily="Instrument Serif, serif"
                    paintOrder="stroke" stroke="#f6f4f0" strokeWidth={8}>{CL[c].name}</text>
                </g>
              )
            })}
            <circle cx={450} cy={320} r={58} fill="#111" />
            <text x={450} y={312} textAnchor="middle" fontSize={11} fill="#a39f98" fontFamily="Hanken Grotesk, sans-serif" letterSpacing="1.2">YOUR STYLE</text>
            {wrap(d.name ?? 'Still forming', 14).map((l, k) => <text key={k} x={450} y={334 + k * 18} textAnchor="middle" fontSize={18} fill="#fff" fontFamily="Instrument Serif, serif">{l}</text>)}
          </svg>
        ) : (
          <div className="px-4 pb-4 space-y-5">
            {(Object.keys(CL) as Cluster[]).filter((c) => !hide.has(c) && byCluster(c).length).map((c) => (
              <div key={c}>
                <p className="font-serif text-[22px] flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: CL[c].color }} />{CL[c].name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {byCluster(c).map((n) => (
                    <button key={n.id} onClick={() => setSel(n)} data-testid="dna-node" className="min-h-9 px-3.5 py-1.5 rounded-full border text-[13px] text-left transition-colors duration-150"
                      style={sel?.id === n.id ? { background: CL[c].color, borderColor: CL[c].color, color: '#fff' } : { background: '#fff', borderColor: CL[c].color + '55' }}>{n.label}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {nodes.length === 0 && <p className="absolute inset-x-0 bottom-6 text-center text-[14px] text-muted">Your map fills in as you onboard, swipe, chat and try on.</p>}
        <p className="px-5 pb-4 text-[12px] text-muted">Every point comes from something you did or said.{wide && ' Dotted lines connect your wardrobe and plans.'}</p>
      </div>
      <div ref={panel} className="border border-line p-6 lg:sticky lg:top-6 self-start w-full scroll-mb-4" data-testid="dna-node-panel">
        {!sel ? (
          <div className="py-8 text-center"><p className="font-serif text-[24px] leading-tight">Tap any point {wide ? 'on the map' : 'above'}.</p><p className="mt-2 text-[14px] text-muted">See what it is and how TRYON uses it.</p></div>
        ) : (
          <div className="t-fade" key={sel.id}>
            <p className="label flex items-center gap-2" style={{ color: CL[sel.cluster].color }}><span className="w-2 h-2 rounded-full" style={{ background: CL[sel.cluster].color }} />{CL[sel.cluster].legend}</p>
            <p className="mt-3 font-serif text-[32px] leading-[1.05]">{sel.label}</p>
            <p className="mt-1.5 text-[14px] text-muted">{sel.detail}</p>
            {sel.weight != null && <div className="mt-4 h-1 bg-surface overflow-hidden"><div className="h-full" style={{ width: `${Math.min(100, Math.abs(sel.weight) / 2.5 * 100)}%`, background: CL[sel.cluster].color }} /></div>}
            <p className="mt-7 label text-muted">How TRYON uses it</p>
            <ul className="mt-3 space-y-2.5">{CL[sel.cluster].how.map((h) => <li key={h} className="flex gap-2.5 text-[14px] leading-[21px]"><Check size={15} className="mt-0.5 shrink-0" />{h}</li>)}</ul>
            <div className="mt-7">
              {(sel.cluster === 'learning' || sel.cluster === 'never') && sel.kind && sel.value && (
                <button onClick={() => { onForget(sel.kind!, sel.value!); setSel(null) }} className="h-10 px-4 rounded-full border border-line hover:border-ink text-[14px] inline-flex items-center gap-1.5"><Trash2 size={14} />{sel.cluster === 'never' ? 'Remove from never list' : 'Forget this'}</button>
              )}
              {sel.cluster === 'told' && <button onClick={() => navigate('/tryon/onboarding')} className="h-10 px-4 rounded-full border border-line hover:border-ink text-[14px]">Edit in my profile</button>}
              {sel.cluster === 'life' && <button onClick={() => navigate('/tryon/wardrobe')} className="h-10 px-4 rounded-full border border-line hover:border-ink text-[14px]">Open my wardrobe</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------------------------------------- timeline

const EDGE: Record<string, [string, string]> = {
  picked_color: ['Picked in onboarding', 'Told by you'], like: ['You told the stylist you like it', 'Told by you'],
  dislike: ['You told the stylist you don’t', 'Told by you'], never: ['Added to your never list', 'Hard boundary'],
  heart: ['Liked a look', 'Learned'], loved: ['Loved a look', 'Learned'], cross: ['Passed on a look', 'Learned'],
  tried_on: ['Tried a look on', 'Learned'], liked_outfit: ['Liked an outfit', 'Learned'], disliked_outfit: ['Passed on an outfit', 'Learned'],
  added_to_cart: ['Added to your bag', 'Learned'], swapped_in: ['Swapped it in', 'Learned'], swapped_out: ['Swapped it out', 'Learned'],
  friend_liked: ['Your crew liked it', 'Learned'], friend_disliked: ['Your crew passed', 'Learned'], owns: ['Added to your wardrobe', 'Wardrobe'],
  play: ['Answered in Style Play', 'Learned'], wore: ['Wore a daily pick', 'Learned'],
}

function Timeline({ d }: { d: DnaPage }) {
  const rows = d.timeline.filter((r) => r.kind !== 'user')
  if (!rows.length) return <Empty text="Your timeline starts with your first answer, swipe or try-on." />
  return (
    <ol className="mt-8 max-w-[760px]" data-testid="dna-timeline">
      {rows.slice(0, 40).map((r, i) => (
        <li key={i} className="relative pl-7 pb-6 border-l border-line ml-1 last:border-transparent">
          <span className={`absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full ${i === 0 ? 'bg-accent' : 'bg-ink'}`} />
          <div className="flex items-baseline gap-4">
            <p className="flex-1 text-[16px]">{kindLabel(r.kind)}: <span className="font-medium">{cap(r.value.replace(/_/g, ' '))}</span></p>
            <p className="text-[12px] text-muted num shrink-0">{new Date(r.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</p>
          </div>
          <p className="text-[14px] text-muted">{(EDGE[r.type] ?? [cap(r.type), 'Learned'])[0]} · {(EDGE[r.type] ?? ['', 'Learned'])[1]}</p>
        </li>
      ))}
    </ol>
  )
}

// ------------------------------------------------------------------------------------------------------- style play

function Play({ onVoted }: { onVoted: () => void }) {
  const [ctx, setCtx] = useState<'everyday' | 'office' | 'festive'>('everyday')
  const [pair, setPair] = useState<PlayPair | null | undefined>(undefined)
  const [picked, setPicked] = useState<string | null>(null)
  const [count, setCount] = useState(0)
  const next = useCallback(() => {
    setPicked(null)
    call<{ pair: PlayPair | null }>(`/api/me/play?context=${ctx}`).then((r) => { setPair(r.pair); if (r.pair) setCount(r.pair.answered) }, () => setPair(null))
  }, [ctx])
  useEffect(() => { setPair(undefined); next() }, [next])
  const vote = async (choice: 'a' | 'b' | 'both' | 'neither' | 'unsure') => {
    if (!pair || picked) return
    setPicked(choice)
    setCount((c) => c + 1)
    await call('/api/me/play', { body: { pair_id: pair.id, choice } }).catch(() => {})
    onVoted()
    setTimeout(next, 420)
  }
  const Side = ({ k }: { k: 'a' | 'b' }) => {
    const s = pair![k]
    return (
      <button onClick={() => vote(k)} data-testid={`play-${k}`} className={`text-left min-w-0 transition-opacity duration-150 ${picked && picked !== k ? 'opacity-40' : ''}`}>
        <div className={`relative aspect-[3/4] bg-surface overflow-hidden ${picked === k ? 'ring-2 ring-ink ring-offset-2' : ''}`}>
          <img src={s.product.image_url} alt={s.product.title} className="absolute inset-0 w-full h-full object-cover object-top" />
          <span className="absolute top-2.5 left-2.5 w-7 h-7 rounded-full bg-white text-[12px] font-semibold inline-flex items-center justify-center uppercase">{k}</span>
        </div>
        <p className="mt-3 font-serif text-[22px] sm:text-[26px] leading-tight">{s.title}</p>
        <p className="text-[13px] text-muted">{s.sub}</p>
      </button>
    )
  }
  return (
    <div className="mt-8 max-w-[720px] mx-auto" data-testid="dna-play">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {(['everyday', 'office', 'festive'] as const).map((c) => <button key={c} onClick={() => setCtx(c)} aria-pressed={ctx === c} className={`h-9 px-4 rounded-full text-[13px] border transition-colors duration-150 ${ctx === c ? 'bg-ink text-white border-ink' : 'border-line hover:border-ink'}`}>{cap(c)}</button>)}
        </div>
        <p className="text-[13px] text-muted num"><span className="num">{count}</span> answered</p>
      </div>
      {pair === undefined ? <div className="mt-8 aspect-[3/2] t-skel" />
        : pair === null ? <Empty text="You’ve answered every pair for this moment. Try another one." />
        : (
          <div className="t-fade" key={pair.id}>
            <p className="mt-8 label text-muted">Testing · {pair.label}</p>
            <h2 className="mt-2 font-serif text-[30px] sm:text-[36px] leading-tight">{pair.a.title} or {pair.b.title.charAt(0).toLowerCase() + pair.b.title.slice(1)}?</h2>
            <p className="mt-1 text-[14px] text-muted">{pair.question}</p>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:gap-6"><Side k="a" /><Side k="b" /></div>
            <div className="mt-6 grid grid-cols-3 gap-2">
              {([['both', 'Both work', Check], ['neither', 'Neither', X], ['unsure', 'Not sure', HelpCircle]] as const).map(([k, l, I]) => (
                <button key={k} onClick={() => vote(k)} data-testid={`play-${k}`} className={`h-11 rounded-full text-[13px] font-medium inline-flex items-center justify-center gap-1.5 border transition-colors duration-150 ${picked === k ? 'bg-ink text-white border-ink' : 'border-line hover:border-ink'}`}><I size={14} />{l}</button>
              ))}
            </div>
          </div>
        )}
    </div>
  )
}
