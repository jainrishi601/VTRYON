import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Ban, Check, Clock, HelpCircle, Shirt, Sparkles, Trash2, X } from 'lucide-react'
import { navigate } from '../store/lib'
import { call, cap, FAMILY_HEX, SLOT_LABEL, type DnaPage, type PlayPair, type User } from './api'

type Tab = 'overview' | 'map' | 'play' | 'timeline'

/** Style DNA: what TRYON knows — what you told it, what it is learning, your hard boundaries, and your wardrobe and
 *  plans — and where you can correct it. Overview, a constellation map, and a timeline. */
export function Dna({ me }: { me: User }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [d, setD] = useState<DnaPage | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => call<DnaPage>('/api/me/dna').then(setD, (x) => setErr((x as Error).message)), [])
  useEffect(() => { load() }, [load])
  const forget = async (kind: string, value: string) => {
    await call(`/api/me/dna?kind=${encodeURIComponent(kind)}&value=${encodeURIComponent(value)}`, { method: 'DELETE' })
    load()
  }
  const tabs: [Tab, string][] = [['overview', 'Overview'], ['map', 'Style Map'], ['play', 'Style Play'], ['timeline', 'Timeline']]
  return (
    <div className="px-6 sm:px-12 py-10 max-w-[1240px] mx-auto" data-testid="dna-page">
      <div className="flex flex-wrap items-start gap-6 justify-between">
        <div>
          <h1 className="text-[36px] sm:text-[44px] font-semibold tracking-[-0.02em] leading-tight">{tab === 'map' ? 'Your Style Constellation' : tab === 'timeline' ? 'Memory Timeline' : tab === 'play' ? 'Style Play' : 'Style DNA'}</h1>
          <p className="mt-2 text-[16px] text-[#737373] max-w-[640px]">
            {tab === 'map' ? 'What you told TRYON, the taste it is learning, your hard boundaries, and the wardrobe and plans they shape.'
              : tab === 'timeline' ? 'A chronological view of your style inputs, boundaries and learnings.'
              : tab === 'play' ? 'Same context, one visible difference. Pick by instinct: there is no wrong answer, and every pick sharpens your Style DNA.'
              : 'What TRYON remembers about your style and boundaries, and exactly where you can correct it.'}
          </p>
        </div>
        <div className="p-1.5 rounded-2xl border border-[#e5e5e5] flex" role="tablist">
          {tabs.map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-testid={`dna-tab-${t}`}
              className={`h-11 px-5 rounded-xl text-[15px] transition-colors ${tab === t ? 'bg-[#0a0a0a] text-white' : 'text-[#525252] hover:text-[#0a0a0a]'}`}>{l}</button>
          ))}
        </div>
      </div>
      {!me.profile.onboarded && (
        <div className="mt-8 rounded-2xl bg-[#f3f0ff] border border-[#e2dbff] px-5 py-4 flex flex-wrap items-center gap-4" data-testid="finish-profile">
          <Sparkles size={18} className="text-[#7b5cff]" />
          <p className="flex-1 text-[15px]"><b>Finish your profile</b> so the stylist gets your gender, sizes, colours and vibes right from the first look.</p>
          <button onClick={() => navigate('/tryon/onboarding')} className="h-10 px-5 rounded-xl bg-[#0a0a0a] text-white text-[14px] font-medium">Continue onboarding</button>
        </div>
      )}
      {err && <p className="mt-8 text-[15px] text-[#c2410c]">{err}</p>}
      {!d ? <div className="mt-10 h-[420px] rounded-3xl t-skel" /> : (
        <div className="t-fade" key={tab}>
          {tab === 'overview' && <Overview d={d} onForget={forget} />}
          {tab === 'map' && <Constellation d={d} onForget={forget} />}
          {tab === 'timeline' && <Timeline d={d} />}
          {tab === 'play' && <Play onVoted={load} />}
        </div>
      )}
    </div>
  )
}

const strength = (w: number) => (Math.abs(w) >= 1.5 ? 'Strong' : Math.abs(w) >= 0.7 ? 'Leaning' : 'Slight')
const kindLabel = (k: string) => ({ vibe: 'Vibe', color: 'Colour', pattern: 'Pattern', category: 'Piece', fabric: 'Fabric' } as Record<string, string>)[k] ?? cap(k)

function Overview({ d, onForget }: { d: DnaPage; onForget: (k: string, v: string) => void }) {
  const [list, setList] = useState<'learning' | 'never'>('learning')
  return (
    <>
      {d.name && (
        <div className="mt-10 rounded-3xl t-glow border border-[#ececec] p-7 flex flex-wrap items-center gap-6" data-testid="dna-hero">
          <div className="flex-1 min-w-[240px]">
            <p className="text-[12px] font-semibold tracking-[0.12em] text-[#737373]">YOUR STYLE DNA</p>
            <p className="t-serif text-[46px] leading-none mt-2" data-testid="dna-name">{d.name}</p>
            <div className="mt-4 flex flex-wrap gap-2">{d.traits.map((t) => <span key={t} className="h-8 px-3.5 rounded-full bg-[#f4f4f5] text-[13px] inline-flex items-center">{t}</span>)}</div>
          </div>
          {d.palette?.recommended?.length ? <div className="flex -space-x-2">{d.facts.find((f) => f.key === 'colors')?.swatches?.slice(0, 8).map((h, i) => <span key={i} className="w-10 h-10 rounded-full border-2 border-white shadow" style={{ background: h }} />)}</div> : null}
        </div>
      )}
      <p className="mt-12 text-[13px] font-semibold tracking-[0.12em] text-[#737373]">SAVED</p>
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-[24px] font-semibold mt-1">Things you told me directly</h2>
        <p className="text-[14px] text-[#737373]">Hard facts, not guesses</p>
      </div>
      {d.facts.length === 0 ? <Empty text="Nothing yet. Your onboarding answers will show up here." /> : (
        <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="dna-facts">
          {d.facts.map((f) => (
            <div key={f.key} className="rounded-2xl border border-[#e5e5e5] p-5">
              <div className="flex items-start justify-between gap-3"><p className="text-[17px] font-semibold">{f.label}</p><span className="h-7 px-2.5 rounded-full bg-[#e8f5ec] text-[#166534] text-[12px] font-medium inline-flex items-center gap-1"><Check size={12} />Saved</span></div>
              <p className="mt-2 text-[15px] text-[#525252]">{f.value}</p>
              {f.swatches && <div className="mt-3 flex gap-1.5">{f.swatches.map((h, i) => <span key={i} className="w-5 h-5 rounded-full border border-black/10" style={{ background: h }} />)}</div>}
              <p className="mt-3 text-[12px] text-[#a3a3a3]">You told me in onboarding</p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-12 flex items-center gap-2">
        {([['learning', 'Learning', d.learning.length], ['never', 'Never list', d.never.length]] as const).map(([k, l, n]) => (
          <button key={k} onClick={() => setList(k)} className={`h-12 px-5 rounded-2xl text-[16px] inline-flex items-center gap-2.5 ${list === k ? 'bg-[#f4f4f5] font-semibold' : 'text-[#525252]'}`}>
            {l}<span className="w-7 h-7 rounded-full bg-white border border-[#e5e5e5] text-[13px] inline-flex items-center justify-center num">{n}</span>
          </button>
        ))}
      </div>
      {list === 'learning' ? (
        d.learning.length === 0 ? <Empty text="I learn as you swipe, chat, try on and add to your bag." /> : (
          <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="dna-learning">
            {d.learning.map((x) => (
              <div key={x.kind + x.value} className={`rounded-3xl p-6 ${x.weight > 0 ? 'bg-[#a8e8c9]/60' : 'bg-[#fde2e2]'}`}>
                <p className="text-[13px] text-[#3f3f46]">{kindLabel(x.kind)} · {strength(x.weight)}</p>
                <p className="mt-2 text-[24px] font-semibold leading-tight capitalize flex items-center gap-2">
                  {x.kind === 'color' && <span className="w-6 h-6 rounded-full border border-black/10" style={{ background: FAMILY_HEX[x.value] ?? '#ccc' }} />}{x.value}
                </p>
                <p className="mt-2 text-[14px] text-[#3f3f46]">{x.weight > 0 ? 'You lean toward this' : 'You tend to pass on this'}</p>
                <div className="mt-5 flex items-center gap-2">
                  <span className="h-9 px-4 rounded-full bg-white/70 text-[13px] font-medium inline-flex items-center gap-1.5"><Check size={13} />Learned</span>
                  <button onClick={() => onForget(x.kind, x.value)} aria-label={`Forget ${x.value}`} className="w-9 h-9 rounded-full bg-white inline-flex items-center justify-center text-[#c2410c]"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : d.never.length === 0 ? <Empty text="Nothing is off-limits. Tell the stylist “never show me…” or set it in onboarding." /> : (
        <div className="mt-5 flex flex-wrap gap-3" data-testid="dna-never">
          {d.never.map((v) => (
            <span key={v} className="h-11 pl-4 pr-2 rounded-full bg-[#fde2e2] text-[15px] inline-flex items-center gap-2 capitalize"><Ban size={15} className="text-[#c2410c]" />{v.replace('_', ' ')}
              <button onClick={() => onForget(neverKind(v), v)} aria-label={`Remove ${v}`} className="w-7 h-7 rounded-full bg-white inline-flex items-center justify-center"><Trash2 size={13} /></button></span>
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
    <button onClick={() => navigate('/tryon/wardrobe')} className="mt-12 w-full rounded-3xl border border-[#e5e5e5] p-6 flex items-center gap-5 text-left hover:border-[#0a0a0a] transition-colors">
      <span className="w-14 h-14 rounded-2xl bg-[#f4f4f5] inline-flex items-center justify-center"><Shirt size={24} strokeWidth={1.5} /></span>
      <div className="flex-1">
        <p className="text-[18px] font-semibold">{n ? `${n} pieces in your wardrobe` : 'Unlock your style twin'}</p>
        <p className="text-[14px] text-[#737373] mt-0.5">{n ? Object.entries(d.wardrobe).map(([s, c]) => `${SLOT_LABEL[s] ?? cap(s)} ${c}`).join(' · ') : 'Add what you own, and the stylist pairs store pieces with it.'}</p>
      </div>
      <ArrowUpRight size={20} />
    </button>
  )
}

const Empty = ({ text }: { text: string }) => <p className="mt-5 rounded-2xl border border-dashed border-[#e5e5e5] px-5 py-6 text-[15px] text-[#737373]">{text}</p>

// ---------------------------------------------------------------------------------------------------- constellation

type Cluster = 'told' | 'learning' | 'never' | 'life'
interface Node { id: string; cluster: Cluster; label: string; detail: string; kind?: string; value?: string; weight?: number }
const CL: Record<Cluster, { x: number; y: number; color: string; name: string; legend: string; how: string[] }> = {
  told: { x: 230, y: 150, color: '#3fae6b', name: 'Things you told me', legend: 'Told by you', how: ['Applied as a hard fact in every look and search.', 'Sets the gender, sizes and colours the stylist shops.', 'Change it any time in your profile.'] },
  learning: { x: 670, y: 150, color: '#8b6cf0', name: 'What I’m learning', legend: 'Learned taste', how: ['Leans looks toward it, a little more each time you like or try on.', 'Fades slowly if you stop choosing it.', 'Forget it here and it stops counting.'] },
  never: { x: 230, y: 455, color: '#e5484d', name: 'Never list', legend: 'Never', how: ['Kept out of every look and search, in every store.', 'Remove it here to see it again.'] },
  life: { x: 670, y: 455, color: '#e2a33b', name: 'Wardrobe & plans', legend: 'Wardrobe & plans', how: ['Store pieces are paired with what you own.', 'Recent occasions guide what you are shown next.'] },
}

function Constellation({ d, onForget }: { d: DnaPage; onForget: (k: string, v: string) => void }) {
  const [hide, setHide] = useState<Set<Cluster>>(new Set())
  const [sel, setSel] = useState<Node | null>(null)
  const nodes = useMemo(() => {
    const out: Node[] = []
    d.facts.forEach((f) => out.push({ id: `f:${f.key}`, cluster: 'told', label: f.value, detail: f.label }))
    d.learning.filter((x) => x.weight > 0).slice(0, 7).forEach((x) => out.push({ id: `l:${x.kind}:${x.value}`, cluster: 'learning', label: cap(x.value), detail: `${kindLabel(x.kind)} · ${strength(x.weight)}`, kind: x.kind, value: x.value, weight: x.weight }))
    d.never.slice(0, 6).forEach((v) => out.push({ id: `n:${v}`, cluster: 'never', label: cap(v), detail: 'Hard boundary', kind: neverKind(v), value: v }))
    Object.entries(d.wardrobe).forEach(([s, c]) => out.push({ id: `w:${s}`, cluster: 'life', label: `${SLOT_LABEL[s] ?? cap(s)} · ${c}`, detail: `${c} in your wardrobe` }))
    d.occasions.slice(0, 3).forEach((o) => out.push({ id: `o:${o}`, cluster: 'life', label: o, detail: 'Recently shopped for' }))
    return out
  }, [d])
  const byCluster = (c: Cluster) => nodes.filter((n) => n.cluster === c)
  // Two columns either side of the cluster's label, stacked: pills never overlap, however many a cluster has.
  const rowsOf = (c: Cluster) => Math.max(1, Math.ceil(byCluster(c).length / 2))
  const top = (c: Cluster) => CL[c].y - rowsOf(c) * 20 // the cluster's label sits here; its pills stack below
  const pos = (c: Cluster, i: number, n: number) => {
    const side = n === 1 ? 0 : i % 2 === 0 ? -1 : 1
    return [CL[c].x + side * 104, top(c) + 44 + Math.floor(i / 2) * 40]
  }
  const W = (s: string) => Math.min(190, 20 + s.length * 6.9)
  const short = (s: string) => (s.length > 24 ? s.slice(0, 23) + '…' : s)
  const empty = nodes.length === 0
  return (
    <div className="mt-10 rounded-[30px] border border-[#ececec] p-3 grid lg:grid-cols-[1fr_340px] gap-3">
      <div className="relative rounded-[24px] bg-[#fbf9f4] overflow-hidden" data-testid="dna-map">
        <div className="m-4 mb-0 inline-flex rounded-2xl bg-white border border-[#ececec] shadow-sm p-1.5 flex-wrap gap-1">
          {(Object.keys(CL) as Cluster[]).map((c) => (
            <button key={c} onClick={() => setHide((h) => { const n = new Set(h); n.has(c) ? n.delete(c) : n.add(c); return n })}
              className={`h-8 px-3 rounded-xl text-[13px] inline-flex items-center gap-1.5 ${hide.has(c) ? 'text-[#a3a3a3]' : ''}`}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: hide.has(c) ? '#d4d4d4' : CL[c].color }} />{CL[c].legend}
            </button>
          ))}
        </div>
        <svg viewBox="0 0 900 600" className="w-full h-auto block" role="img" aria-label="Your style constellation">
          {(Object.keys(CL) as Cluster[]).map((c) => !hide.has(c) && (
            <g key={c}>
              <line x1={450} y1={300} x2={CL[c].x} y2={top(c)} stroke={CL[c].color} strokeOpacity={0.45} strokeWidth={1.4} pointerEvents="none" />
              <ellipse cx={CL[c].x} cy={top(c) + rowsOf(c) * 20 + 10} rx={212} ry={rowsOf(c) * 20 + 46} fill={CL[c].color} fillOpacity={0.08} pointerEvents="none" />
            </g>
          ))}
          {(Object.keys(CL) as Cluster[]).map((c) => {
            if (hide.has(c)) return null
            const list = byCluster(c)
            return (
              <g key={c + 'n'}>
                {list.map((n, i) => {
                  const [x, y] = pos(c, i, list.length)
                  const w = W(short(n.label))
                  const on = sel?.id === n.id
                  return (
                    <g key={n.id} className="t-node" onClick={() => setSel(n)} data-testid="dna-node" style={{ transformOrigin: `${x}px ${y}px` }}>
                      <line x1={CL[c].x} y1={top(c)} x2={x} y2={y} stroke={CL[c].color} strokeOpacity={0.3} strokeDasharray={c === 'life' ? '3 4' : undefined} pointerEvents="none" />
                      <rect x={x - w / 2} y={y - 15} width={w} height={30} rx={15} fill={on ? CL[c].color : '#fff'} stroke={CL[c].color} strokeOpacity={on ? 1 : 0.45} />
                      <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={12.5} fill={on ? '#fff' : '#262626'} fontFamily="Outfit, sans-serif">{short(n.label)}</text>
                    </g>
                  )
                })}
                <rect x={CL[c].x - W(CL[c].name) / 2} y={top(c) - 17} width={W(CL[c].name)} height={34} rx={17} fill="#fff" stroke={CL[c].color} strokeWidth={1.5} />
                <text x={CL[c].x} y={top(c)} dy="0.35em" textAnchor="middle" fontSize={13.5} fontWeight={600} fill="#171717" fontFamily="Outfit, sans-serif">{CL[c].name}</text>
              </g>
            )
          })}
          <circle cx={450} cy={300} r={54} fill="#0a0a0a" />
          <text x={450} y={292} textAnchor="middle" fontSize={13} fill="#fff" fontFamily="Outfit, sans-serif" fontWeight={600}>Your style</text>
          <text x={450} y={312} textAnchor="middle" fontSize={11} fill="#a3a3a3" fontFamily="Outfit, sans-serif">{short(d.name ?? 'still forming')}</text>
        </svg>
        {empty && <p className="absolute inset-x-0 bottom-6 text-center text-[14px] text-[#737373]">Your constellation fills in as you onboard, swipe, chat and try on.</p>}
        <p className="px-5 pb-4 text-[12px] text-[#a3a3a3]">Solid lines group what you told me and what I learned. Dotted lines connect your wardrobe and plans. Nothing here is invented: every node comes from something you did or said.</p>
      </div>
      <div className="rounded-[24px] border border-[#ececec] p-6" data-testid="dna-node-panel">
        {!sel ? (
          <div className="h-full flex flex-col justify-center text-center text-[#737373]"><Sparkles size={22} className="mx-auto text-[#8b6cf0]" /><p className="mt-3 text-[15px]">Tap any point on the map to see what it is and how TRYON uses it.</p></div>
        ) : (
          <div className="t-fade">
            <span className="h-8 px-3 rounded-full text-[12px] font-semibold tracking-[0.1em] inline-flex items-center" style={{ background: CL[sel.cluster].color + '1f', color: CL[sel.cluster].color }}>{CL[sel.cluster].legend.toUpperCase()}</span>
            <p className="mt-4 text-[26px] font-semibold leading-tight">{sel.label}</p>
            <p className="mt-1 text-[15px] text-[#737373]">{sel.detail}</p>
            {sel.weight != null && <div className="mt-4 h-2 rounded-full bg-[#f1f1f1] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.abs(sel.weight) / 2.5 * 100)}%`, background: CL[sel.cluster].color }} /></div>}
            <p className="mt-7 text-[12px] font-semibold tracking-[0.12em] text-[#737373]">HOW TRYON USES IT</p>
            <ul className="mt-3 space-y-2.5">{CL[sel.cluster].how.map((h) => <li key={h} className="flex gap-2.5 text-[15px] leading-[22px]"><Check size={16} className="mt-0.5 shrink-0 text-[#3fae6b]" />{h}</li>)}</ul>
            <div className="mt-8">
              {(sel.cluster === 'learning' || sel.cluster === 'never') && sel.kind && sel.value && (
                <button onClick={() => { onForget(sel.kind!, sel.value!); setSel(null) }} className="text-[14px] text-[#c2410c] inline-flex items-center gap-1.5"><Trash2 size={14} />{sel.cluster === 'never' ? 'Remove from never list' : 'Forget this'}</button>
              )}
              {sel.cluster === 'told' && <button onClick={() => navigate('/tryon/onboarding')} className="h-10 px-4 rounded-xl border border-[#e5e5e5] text-[14px]">Edit in my profile</button>}
              {sel.cluster === 'life' && <button onClick={() => navigate('/tryon/wardrobe')} className="h-10 px-4 rounded-xl border border-[#e5e5e5] text-[14px]">Open my wardrobe</button>}
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
}

function Timeline({ d }: { d: DnaPage }) {
  const rows = d.timeline.filter((r) => r.kind !== 'user')
  if (!rows.length) return <Empty text="Your timeline starts with your first answer, swipe or try-on." />
  return (
    <div className="mt-10" data-testid="dna-timeline">
      <p className="text-[12px] font-semibold tracking-[0.12em] text-[#737373] flex items-center gap-2"><Clock size={14} className="text-[#e07b39]" />RECENTLY UPDATED</p>
      <h2 className="text-[22px] font-semibold mt-1">Your memory timeline</h2>
      <ol className="mt-6">
        {rows.slice(0, 40).map((r, i) => (
          <li key={i} className="relative pl-7 pb-6 border-l border-[#ececec] ml-1.5 last:border-transparent">
            <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-[#e07b39]" />
            <div className="flex items-baseline gap-4">
              <p className="flex-1 text-[16px] font-medium capitalize">{kindLabel(r.kind)}: {r.value.replace('_', ' ')}</p>
              <p className="text-[13px] text-[#a3a3a3] num">{new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
            </div>
            <p className="text-[14px] text-[#737373]">{(EDGE[r.type] ?? [cap(r.type), 'Learned'])[0]} · {(EDGE[r.type] ?? ['', 'Learned'])[1]}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------------- style play

function Play({ onVoted }: { onVoted: () => void }) {
  const [ctx, setCtx] = useState<'everyday' | 'office' | 'festive'>('everyday')
  const [pair, setPair] = useState<PlayPair | null | undefined>(undefined)
  const [picked, setPicked] = useState<string | null>(null)
  const [count, setCount] = useState(0)
  const next = useCallback(() => {
    setPair(undefined); setPicked(null)
    call<{ pair: PlayPair | null }>(`/api/me/play?context=${ctx}`).then((r) => { setPair(r.pair); if (r.pair) setCount(r.pair.answered) }, () => setPair(null))
  }, [ctx])
  useEffect(() => { next() }, [next])
  const vote = async (choice: 'a' | 'b' | 'both' | 'neither' | 'unsure') => {
    if (!pair || picked) return
    setPicked(choice)
    await call('/api/me/play', { body: { pair_id: pair.id, choice } }).catch(() => {})
    onVoted()
    setTimeout(next, 450)
  }
  const Side = ({ k }: { k: 'a' | 'b' }) => {
    const s = pair![k]
    return (
      <button onClick={() => vote(k)} data-testid={`play-${k}`} className={`text-left w-[300px] max-w-full rounded-[22px] border bg-white p-2.5 transition-all ${picked === k ? 'border-[#0a0a0a] ring-2 ring-[#0a0a0a]' : picked ? 'opacity-50 border-[#ececec]' : 'border-[#ececec] hover:border-[#0a0a0a]'}`}>
        <div className="relative aspect-[4/5] rounded-[16px] overflow-hidden bg-[#f4f4f5]">
          <img src={s.product.image_url} alt={s.product.title} className="w-full h-full object-cover object-top" />
          <span className="absolute top-2.5 left-2.5 w-7 h-7 rounded-full bg-white text-[12px] font-semibold inline-flex items-center justify-center uppercase">{k}</span>
        </div>
        <p className="mt-3 px-1.5 text-[17px] font-semibold">{s.title}</p>
        <p className="px-1.5 pb-1.5 text-[13px] text-[#737373]">{s.sub}</p>
      </button>
    )
  }
  return (
    <div className="mt-8 flex flex-col items-center" data-testid="dna-play">
      <p className="text-[13px] text-[#737373]">Discovery mode · Updates your Style DNA · <span className="num">{count}</span> answered</p>
      <div className="mt-3 flex gap-2">
        {(['everyday', 'office', 'festive'] as const).map((c) => <button key={c} onClick={() => setCtx(c)} className={`h-9 px-4 rounded-full text-[14px] border ${ctx === c ? 'bg-[#0a0a0a] text-white border-[#0a0a0a]' : 'border-[#e5e5e5]'}`}>{cap(c)}</button>)}
      </div>
      {pair === undefined ? <div className="mt-8 w-[640px] max-w-full h-[460px] rounded-3xl t-skel" />
        : pair === null ? <Empty text="You’ve seen every pair for this context. Try another one, or come back after the catalogue changes." />
        : (
          <div className="t-fade flex flex-col items-center" key={pair.id}>
            <span className="mt-6 h-7 px-3 rounded-full bg-[#f4f4f5] text-[12px] font-semibold tracking-[0.1em] uppercase inline-flex items-center">{pair.label}</span>
            <h2 className="mt-3 text-[24px] font-semibold text-center">{pair.question}</h2>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
              <Side k="a" /><span className="w-10 h-10 rounded-full bg-[#f4f4f5] text-[13px] inline-flex items-center justify-center">or</span><Side k="b" />
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 w-[660px] max-w-full">
              {([['both', 'Both work', Check], ['neither', 'Neither', X], ['unsure', 'Not sure', HelpCircle]] as const).map(([k, l, I]) => (
                <button key={k} onClick={() => vote(k)} data-testid={`play-${k}`} className={`h-12 rounded-2xl text-[14px] font-medium inline-flex items-center justify-center gap-2 ${picked === k ? 'bg-[#0a0a0a] text-white' : 'bg-[#f4f4f5] hover:bg-[#ececec]'}`}>{l}<I size={15} /></button>
              ))}
            </div>
          </div>
        )}
    </div>
  )
}
