import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Answer, Brief, CartItem, Clarify, Crew, DnaSummary, Look, Product, ProductCard, SampleModel, Session, StoreInfo } from '../shared/types'
import type { ElaraOpenOptions } from '../shared/global'
import { abs, api, ApiError, ls, ss, stream } from './api'

export type Tab = 'chat' | 'studio' | 'crew'
export type Stage = 'boot' | 'who' | 'photo' | 'dna' | 'chat' | 'error'
export interface StatusLine { id: string; label: string; state: 'active' | 'done' }
export interface Msg {
  id: string
  role: 'user' | 'agent'
  text: string
  statuses?: StatusLine[]
  startedAt?: number
  doneIn?: number | null
  clarify?: Clarify | null
  lookIds?: string[]
  products?: ProductCard[]
  tryNext?: string[]
  error?: string | null
  retry?: { message: string; lookId?: string; answers?: Answer[] }
  streaming?: boolean
}
// The try-on sheet: a look waiting for a usable photo, or single pieces tried on with what pairs best.
export type TryOnReq = { kind: 'look'; lookId: string } | { kind: 'items'; products: Product[]; fromLookId?: string; name?: string }
export interface Cfg { storeId: string; cartAdapter: string; position: string }
interface Toast { id: number; text: string; action?: { label: string; fn: () => void } }

const uid = () => Math.random().toString(36).slice(2, 10)
export const TERMINAL = new Set(['ready', 'failed', 'idle'])
/** The look can't render on this photo: it's cut for the other gender (a sample-model override fixes that). */
export const mismatch = (l: Look | { gender: string | null; model_id?: string | null }, s: Session | null) =>
  !!(l.gender && !l.model_id && s?.photo_gender && s.photo_gender !== l.gender)

// Bridge for the non-React entry points (window.Elara, URL params, [data-elara-tryon]).
const queue: (ElaraOpenOptions | undefined)[] = []
export const controller: { open: (o?: ElaraOpenOptions) => void; close: () => void; isOpen: () => boolean } = {
  open: (o) => { queue.push(o) }, close: () => {}, isOpen: () => false,
}

function useStateRef<T>(init: T) {
  const [v, setV] = useState<T>(init)
  const r = useRef(v)
  // The ref updates synchronously so async flows (boot → tryOn) never read a stale value.
  const set = useCallback((x: T | ((p: T) => T)) => {
    r.current = typeof x === 'function' ? (x as (p: T) => T)(r.current) : x
    setV(r.current)
  }, [])
  return [v, set, r] as const
}

function useElaraState(cfg: Cfg) {
  const [open, setOpenRaw] = useState(false)
  const [tab, setTabRaw] = useState<Tab>('chat')
  const [stage, setStage, stageRef] = useStateRef<Stage>('boot')
  const [store, setStore] = useState<StoreInfo | null>(null)
  const [models, setModels] = useState<SampleModel[] | null>(null)
  const [session, setSession, sessionRef] = useStateRef<Session | null>(null)
  const [dna, setDna] = useState<DnaSummary | null>(null)
  const [brief, setBrief] = useState<Brief | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [looks, setLooks, looksRef] = useStateRef<Record<string, Look>>({})
  const [busy, setBusy, busyRef] = useStateRef(false)
  const [focusLookId, setFocusLookId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<string | null>(null)
  const [swap, setSwap] = useState<{ lookId: string; slot: string } | null>(null)
  const [share, setShare] = useState<{ lookId: string } | null>(null)
  const [tryon, setTryon] = useState<TryOnReq | null>(null)
  // Switching tabs closes any overlay (viewer, swap drawer, share sheet) so each tab starts clean.
  const setTab = useCallback((t: Tab) => { setTabRaw(t); setViewer(null); setSwap(null); setShare(null); setTryon(null) }, [])
  const [toast, setToast] = useState<Toast | null>(null)
  const [crewId, setCrewId, crewIdRef] = useStateRef<string | null>(ls.get('elara.crew'))
  const [crew, setCrew] = useState<Crew | null>(null)
  const [crewError, setCrewError] = useState(false)
  const [crewSeen, setCrewSeen] = useState<string>(ls.get('elara.crew.seen') ?? '')
  const [studioSeed, setStudioSeed] = useState<Product[] | null>(null)
  const [pendingTryon, setPendingTryon, pendingTryonRef] = useStateRef<string[] | null>(null)
  const [pendingMessage, setPendingMessage, pendingMessageRef] = useStateRef<string | null>(null)
  const [bagBump, setBagBump] = useState(0)
  const streamingIds = useRef(new Set<string>())
  const firstSeen = useRef(new Map<string, number>())
  const booting = useRef<Promise<void> | null>(null)
  const token = useRef<string | null>(ls.get('elara.token'))

  const showToast = useCallback((text: string, action?: Toast['action']) => {
    const id = Date.now()
    setToast({ id, text, action })
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), action ? 5000 : 3200)
  }, [])

  const upsertLook = useCallback((l: Look) => {
    setLooks((m) => ({ ...m, [l.id]: l }))
  }, [setLooks])

  const setOpen = useCallback((v: boolean) => {
    setOpenRaw(v)
    if (v) window.dispatchEvent(new CustomEvent('elara:open'))
    else window.dispatchEvent(new CustomEvent('elara:close'))
  }, [])

  // ---------- boot ----------
  const adoptSession = useCallback((s: Session) => {
    setSession(s)
    setDna(s.dna)
    setBrief(s.brief)
    if (s.photo_url) ls.set('elara.avatar', abs(s.photo_url))
  }, [setSession])

  const restore = useCallback(async (sid: string) => {
    const hist = await api<{ messages: { role: string; text: string; looks?: Look[]; products?: ProductCard[]; clarify?: Clarify; try_next?: string[] }[] }>(`/api/session/${sid}/messages`).catch(() => ({ messages: [] }))
    const msgs: Msg[] = hist.messages.map((m) => {
      m.looks?.forEach((l) => upsertLook(l))
      return { id: uid(), role: m.role === 'user' ? 'user' : 'agent', text: m.text ?? '', lookIds: m.looks?.map((l) => l.id), products: m.products, tryNext: m.try_next, clarify: m.clarify ?? null }
    })
    setMessages(msgs)
  }, [upsertLook])

  const newSession = useCallback(async () => {
    const r = await api<{ session_id: string; user_token: string; returning: boolean; profile: { brief: Brief | null; last_occasion: string | null; dna: DnaSummary } | null }>('/api/session', {
      body: token.current ? { user_token: token.current } : {},
    })
    token.current = r.user_token
    ls.set('elara.token', r.user_token)
    ss.set('elara.sid', r.session_id)
    const s = await api<Session>(`/api/session/${r.session_id}`)
    adoptSession(s)
    return { s, returning: r.returning, profile: r.profile }
  }, [adoptSession])

  const boot = useCallback(() => {
    const stored = ls.get('elara.token')
    if (stored && stored !== token.current) { // TRYON login (same site) switched the shopper: start over as them
      token.current = stored
      booting.current = null
      setSession(null); setMessages([]); setLooks({}); setViewer(null); setSwap(null); setTryon(null); setFocusLookId(null)
    }
    if (booting.current) return booting.current
    booting.current = (async () => {
      setStage('boot')
      api<StoreInfo>('/api/store').then(setStore, () => {})
      api<{ models: SampleModel[] }>('/api/models').then((m) => setModels(m.models), () => setModels([]))
      try {
        const sid = ss.get('elara.sid')
        let s: Session | null = null
        if (sid && token.current) {
          s = await api<Session>(`/api/session/${sid}`).catch(() => null)
          if (s && s.user_token !== token.current) s = null
        }
        // Chat first: who it's for, gender, occasion and budget come from the question card when Ava needs them,
        // and the photo only when the shopper taps Try on.
        if (s) {
          adoptSession(s)
          await restore(s.id)
        } else {
          const { returning, profile } = await newSession()
          const occ = profile?.last_occasion || profile?.brief?.occasion
          if (returning && occ) {
            setMessages([{ id: uid(), role: 'agent', text: `Welcome back. Still shopping for the ${occ.toLowerCase()}, or something new?`,
              clarify: { questions: [{ field: 'occasion', question: 'What are we dressing for?', options: [{ label: `Still the ${occ.toLowerCase()}`, value: occ }] }] } }])
          }
        }
        setStage('chat')
      } catch {
        booting.current = null
        setStage('error')
      }
    })()
    return booting.current
  }, [adoptSession, newSession, restore, setStage, setSession, setLooks])

  // ---------- chat ----------
  const patchMsg = useCallback((id: string, f: (m: Msg) => Msg) => setMessages((ms) => ms.map((m) => (m.id === id ? f(m) : m))), [])

  const send = useCallback(async (message: string, opts: { lookId?: string | null; answers?: Answer[] } = {}) => {
    const s = sessionRef.current
    if (!s || busyRef.current || !message.trim()) return
    setBusy(true)
    const lookId = opts.lookId ?? undefined
    const answers = opts.answers?.length ? opts.answers : undefined
    const aid = uid()
    const t0 = performance.now()
    setMessages((ms) => [
      ...ms.map((m) => (m.clarify ? { ...m, clarify: null } : m)),
      { id: uid(), role: 'user', text: message.trim() },
      { id: aid, role: 'agent', text: '', statuses: [], startedAt: t0, streaming: true },
    ])
    const turnLooks = new Set<string>()
    let gotSomething = false
    try {
      await stream('/api/chat', { session_id: s.id, message: message.trim(), ...(lookId ? { look_id: lookId } : {}), ...(answers ? { answers } : {}) }, (ev, data) => {
        gotSomething = true
        if (ev === 'status') {
          patchMsg(aid, (m) => {
            const list = [...(m.statuses ?? [])]
            const i = list.findIndex((x) => x.id === data.id)
            if (i >= 0) list[i] = { ...list[i], ...data }
            else list.push(data)
            return { ...m, statuses: list }
          })
        } else if (ev === 'text') {
          patchMsg(aid, (m) => ({ ...m, text: m.text + (data.delta ?? '') }))
        } else if (ev === 'clarify') {
          patchMsg(aid, (m) => ({ ...m, clarify: data }))
        } else if (ev === 'looks') {
          ;(data.looks as Look[]).forEach((l) => { upsertLook(l); turnLooks.add(l.id); streamingIds.current.add(l.id) })
          patchMsg(aid, (m) => ({ ...m, lookIds: [...(m.lookIds ?? []), ...(data.looks as Look[]).map((l) => l.id)] }))
        } else if (ev === 'suggest') {
          patchMsg(aid, (m) => ({ ...m, tryNext: data.items as string[] }))
        } else if (ev === 'products') {
          patchMsg(aid, (m) => ({ ...m, products: data.products as ProductCard[] }))
        } else if (ev === 'look') {
          upsertLook(data.look)
        } else if (ev === 'error') {
          patchMsg(aid, (m) => ({ ...m, error: data.message || 'Ava lost the thread there.', retry: { message, lookId, answers } }))
        }
      })
      if (!gotSomething) throw new Error('empty')
    } catch {
      patchMsg(aid, (m) => ({ ...m, error: 'Ava lost the thread there. Your message is safe.', retry: { message, lookId, answers } }))
    } finally {
      turnLooks.forEach((id) => streamingIds.current.delete(id))
      patchMsg(aid, (m) => ({ ...m, streaming: false, doneIn: (performance.now() - t0) / 1000, statuses: m.statuses?.map((x) => ({ ...x, state: 'done' as const })) }))
      setBusy(false)
      // Answers may have filled the brief (gender, occasion): refresh it so the photo step filters models right.
      if (answers) api<Session>(`/api/session/${s.id}`).then((ns) => { setSession(ns); setBrief(ns.brief) }, () => {})
    }
  }, [busyRef, patchMsg, sessionRef, setBusy, setSession, upsertLook])

  // Poll looks whose render (or video) is still in flight and not covered by an open stream.
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now()
      Object.values(looksRef.current).forEach((l) => {
        const rendering = !TERMINAL.has(l.render.status)
        const video = l.video?.status === 'pending'
        if ((!rendering && !video) || (rendering && !video && streamingIds.current.has(l.id))) return
        const seen = firstSeen.current.get(l.id) ?? now
        firstSeen.current.set(l.id, seen)
        if (now - seen > 180_000) {
          upsertLook({ ...l, render: { ...l.render, status: rendering ? 'failed' : l.render.status, error: rendering ? 'This one is taking too long.' : l.render.error }, video: video ? { status: 'failed', url: null } : l.video })
          return
        }
        api<Look>(`/api/looks/${l.id}`).then((nl) => {
          if (TERMINAL.has(nl.render.status) && nl.video?.status !== 'pending') firstSeen.current.delete(l.id)
          upsertLook(nl)
        }, () => {})
      })
    }, 2000)
    return () => clearInterval(iv)
  }, [looksRef, upsertLook])

  /** Try on a whole look. Without a photo that can wear it, the try-on sheet asks first. */
  const renderLook = useCallback(async (id: string, modelId?: string) => {
    const l = looksRef.current[id]
    const s = sessionRef.current
    if (!modelId && l && (!s?.photo_url || mismatch(l, s))) { setTryon({ kind: 'look', lookId: id }); return }
    firstSeen.current.delete(id)
    if (l) upsertLook({ ...l, render: { ...l.render, status: 'pending', error: null, code: null } })
    try { upsertLook(await api<Look>(`/api/looks/${id}/render`, { body: modelId ? { model_id: modelId } : {} })) } catch (e) {
      if (l) upsertLook({ ...l, render: { ...l.render, status: 'failed', error: (e as ApiError).message } })
    }
  }, [looksRef, sessionRef, upsertLook])
  const retryRender = renderLook

  const requestVideo = useCallback(async (id: string) => {
    try {
      firstSeen.current.delete(id)
      upsertLook(await api<Look>(`/api/looks/${id}/video`, { body: {} }))
    } catch (e) { showToast((e as ApiError).message || 'Video isn’t available for this look right now.') }
  }, [showToast, upsertLook])

  const fetchLook = useCallback(async (id: string) => {
    if (looksRef.current[id]) return looksRef.current[id]
    const l = await api<Look>(`/api/looks/${id}`)
    upsertLook(l)
    return l
  }, [looksRef, upsertLook])

  // ---------- try-on & cart ----------
  const tryOn = useCallback(async (productIds: string[], name?: string) => {
    const s = sessionRef.current
    if (!s) return null
    const ps = productIds.map((id) => Object.values(looksRef.current).flatMap((l) => l.items.map((i) => i.product)).find((p) => p.id === id)).filter(Boolean) as Product[]
    const g = ps.find((p) => p.gender !== 'unisex')?.gender ?? null
    if (!s.photo_url || mismatch({ gender: g }, s)) {
      const all = ps.length === productIds.length ? ps : (await Promise.all(productIds.map((id) => api<Product>(`/api/products/${id}`).catch(() => null)))).filter(Boolean) as Product[]
      setTryon({ kind: 'items', products: all, name })
      return null
    }
    try {
      const l = await api<Look>('/api/tryon', { body: { session_id: s.id, product_ids: productIds, ...(name ? { name } : {}) } })
      upsertLook(l)
      setMessages((ms) => [...ms, { id: uid(), role: 'agent', text: productIds.length > 1 ? 'Here is your outfit, on you.' : `Here is the ${l.items[0]?.product.title.split(' - ')[0] ?? 'piece'} on you.`, lookIds: [l.id] }])
      setViewer(l.id)
      return l
    } catch (e) {
      showToast((e as ApiError).message)
      return null
    }
  }, [looksRef, sessionRef, showToast, upsertLook])

  const addToCart = useCallback(async (items: CartItem[], lookId?: string) => {
    if (cfg.cartAdapter === 'shopify') {
      await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items.map((i) => ({ id: i.product_id, quantity: 1, properties: { _styled_with: 'Ava' } })) }) }).catch(() => {})
    } else if (typeof window.elaraAddToCart === 'function') {
      window.elaraAddToCart(items)
    }
    setBagBump((b) => b + 1)
    showToast(`${items.length} ${items.length === 1 ? 'item' : 'items'} added to your bag`)
    if (lookId) api(`/api/looks/${lookId}/feedback`, { body: { kind: 'cart' } }).catch(() => {})
  }, [cfg.cartAdapter, showToast])

  // The shopper's own wardrobe pieces are part of the look, never part of the order.
  const addLookToCart = useCallback((l: Look, verdict?: string) => addToCart(
    l.items.filter((i) => !i.product.owned).map((i) => ({ product_id: i.product.id, title: i.product.title, price: i.product.price, image_url: i.product.image_url, size: i.product.sizes_in_stock.includes('M') ? 'M' : i.product.sizes_in_stock[0], look_name: l.name, styled_with: 'Ava', crew_verdict: verdict })),
    l.id,
  ), [addToCart])

  const swapTo = useCallback(async (lookId: string, slot: string, productId: string) => {
    const nl = await api<Look>(`/api/looks/${lookId}/swap`, { body: { slot, product_id: productId } })
    upsertLook(nl)
    setViewer(nl.id)
    setFocusLookId(nl.id)
    return nl
  }, [upsertLook])

  // ---------- onboarding completions ----------
  const photoDone = useCallback((photo_url: string) => {
    setSession((s) => (s ? { ...s, photo_url } : s))
    ls.set('elara.avatar', abs(photo_url))
    const pt = pendingTryonRef.current
    const pm = pendingMessageRef.current
    if (pt) {
      setPendingTryon(null)
      setStage('chat')
      tryOn(pt)
    } else if (pm) {
      setPendingMessage(null)
      setStage('chat')
      send(pm)
    } else setStage('dna')
  }, [pendingMessageRef, pendingTryonRef, send, sessionRef, setPendingMessage, setPendingTryon, setSession, setStage, tryOn])

  // ---------- crew ----------
  const memberToken = useCallback((id: string) => ls.get(`elara.member.${id}`) ?? token.current ?? '', [])

  const loadCrew = useCallback(async (id = crewIdRef.current) => {
    if (!id) return null
    try {
      const c = await api<Crew>(`/api/crews/${id}?member_token=${encodeURIComponent(memberToken(id))}`)
      setCrew(c)
      setCrewError(false)
      return c
    } catch (e) {
      if ((e as ApiError).status === 404) { setCrewId(null); ls.set('elara.crew', null); setCrew(null) } else setCrewError(true)
      return null
    }
  }, [crewIdRef, memberToken, setCrewId])

  useEffect(() => {
    if (!crewId) return
    loadCrew(crewId)
    const iv = setInterval(() => document.visibilityState === 'visible' && loadCrew(crewId), 3000)
    return () => clearInterval(iv)
  }, [crewId, loadCrew])

  const adoptCrew = useCallback((c: Crew) => {
    setCrew(c)
    setCrewId(c.id)
    ls.set('elara.crew', c.id)
  }, [setCrewId])

  const shareLook = useCallback(async (lookId: string) => {
    const s = sessionRef.current
    if (!s) return
    try {
      const c = await api<Crew>('/api/crews', { body: { session_id: s.id, look_id: lookId } })
      adoptCrew(c)
      setShare({ lookId })
    } catch (e) { showToast((e as ApiError).message) }
  }, [adoptCrew, sessionRef, showToast])

  const comment = useCallback(async (lookId: string, slot: string | null, body: { text?: string; reaction?: 'up' | 'down' | 'swap' }) => {
    const id = crewIdRef.current
    if (!id) return
    try {
      await api(`/api/crews/${id}/comments`, { body: { member_token: memberToken(id), look_id: lookId, slot, ...body } })
      await loadCrew(id)
    } catch (e) { showToast((e as ApiError).message) }
  }, [crewIdRef, loadCrew, memberToken, showToast])

  const joinCrew = useCallback(async (id: string, name: string, photo: { file?: Blob; sample_model_id?: string }) => {
    let r: { member_token: string; crew: Crew }
    if (photo.file) {
      const f = new FormData()
      f.set('display_name', name)
      f.set('file', photo.file, 'photo.jpg')
      r = await api(`/api/crews/${id}/join`, { form: f, timeout: 45000 })
    } else {
      r = await api(`/api/crews/${id}/join`, { body: { display_name: name, ...(photo.sample_model_id ? { sample_model_id: photo.sample_model_id } : {}) } })
    }
    ls.set(`elara.member.${id}`, r.member_token)
    adoptCrew(r.crew)
    return r
  }, [adoptCrew])

  const myMemberId = crew?.members.find((m) => m.is_you)?.id
  const unread = useMemo(() => !!crew && crew.comments.some((c) => c.member_id !== myMemberId && c.created_at > crewSeen), [crew, crewSeen, myMemberId])
  const markCrewSeen = useCallback(() => {
    const latest = crew?.comments.reduce((a, c) => (c.created_at > a ? c.created_at : a), crewSeen) ?? crewSeen
    if (latest !== crewSeen) { setCrewSeen(latest); ls.set('elara.crew.seen', latest) }
  }, [crew, crewSeen])

  // ---------- privacy ----------
  const downloadData = useCallback(async () => {
    if (!token.current) return
    try {
      const data = await api(`/api/dna/${token.current}`)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      a.download = 'my-style-data.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) { showToast((e as ApiError).message) }
  }, [showToast])

  const resetAll = useCallback(() => {
    ;['elara.token', 'elara.avatar', 'elara.crew', 'elara.crew.seen'].forEach((k) => ls.set(k, null))
    ss.set('elara.sid', null)
    token.current = null
    booting.current = null
    setSession(null); setDna(null); setBrief(null); setMessages([]); setLooks({}); setViewer(null); setSwap(null); setShare(null); setTryon(null)
    setCrew(null); setCrewId(null); setFocusLookId(null); setTab('chat')
  }, [setCrewId, setLooks, setSession])

  const forgetMe = useCallback(async () => {
    try {
      if (token.current) await api(`/api/dna/${token.current}`, { method: 'DELETE' })
      resetAll()
      await boot()
      showToast('Done. Your photo, looks and style data are deleted.')
    } catch (e) { showToast((e as ApiError).message) }
  }, [boot, resetAll, showToast])

  const newChat = useCallback(async () => {
    if (busyRef.current) return
    setMessages([]); setFocusLookId(null); setViewer(null)
    try {
      await newSession()
      setStage('chat')
    } catch { showToast('We couldn’t start a new chat. Try again.') }
  }, [busyRef, newSession, setStage, showToast])

  // ---------- entry points ----------
  const openWith = useCallback(async (o: ElaraOpenOptions = {}) => {
    setOpen(true)
    if (o.tab) setTab(o.tab)
    await boot()
    if (stageRef.current === 'error') return
    if (o.productId) { setTab('chat'); await tryOn([o.productId]); return }
    if (o.lookId) { try { await fetchLook(o.lookId); setViewer(o.lookId) } catch { /* expired link: just open */ } }
    if (o.productIds?.length) {
      const ps = await Promise.all(o.productIds.map((id) => api<Product>(`/api/products/${id}`).catch(() => null)))
      setStudioSeed(ps.filter(Boolean) as Product[])
      setTab('studio')
    }
    if (o.message) {
      setTab('chat')
      send(o.message)
    }
  }, [boot, fetchLook, send, setOpen, stageRef, tryOn])

  const openRef = useRef(openWith)
  openRef.current = openWith
  const openStateRef = useRef(open)
  openStateRef.current = open
  useEffect(() => {
    controller.open = (o) => { openRef.current(o) }
    controller.close = () => setOpen(false)
    controller.isOpen = () => openStateRef.current
    queue.splice(0).forEach((o) => openRef.current(o))
  }, [setOpen])

  return {
    cfg, open, setOpen, tab, setTab, stage, setStage, store, models, session, setSession, dna, setDna, brief, setBrief,
    messages, setMessages, looks, upsertLook, busy, send, focusLookId, setFocusLookId, viewer, setViewer, swap, setSwap,
    share, setShare, tryon, setTryon, renderLook, toast, showToast, setToast, crewId, crew, crewError, loadCrew, shareLook, comment, joinCrew, unread, markCrewSeen,
    studioSeed, setStudioSeed, pendingTryon, pendingMessage, bagBump, boot, retryRender, requestVideo, fetchLook, tryOn,
    addToCart, addLookToCart, swapTo, photoDone, downloadData, forgetMe, newChat, openWith, token,
  }
}

export type Elara = ReturnType<typeof useElaraState>
const Ctx = createContext<Elara | null>(null)
export function ElaraProvider({ cfg, children }: { cfg: Cfg; children: ReactNode }) {
  const v = useElaraState(cfg)
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}
export const useElara = () => useContext(Ctx)!
