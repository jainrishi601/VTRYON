let BASE = ''
export const setBase = (b: string) => { BASE = b.replace(/\/$/, '') }
/** Absolute URL for API paths and our /media files; external URLs pass through. */
export const abs = (p: string | null | undefined) => (!p ? '' : /^(https?:|data:|blob:)/.test(p) ? p : BASE + p)

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

const COPY = 'Something went wrong on our side. Try again in a moment.'

export async function api<T>(path: string, opts: { method?: string; body?: unknown; form?: FormData; timeout?: number } = {}): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), opts.timeout ?? 30000)
  try {
    const r = await fetch(abs(path), {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers: opts.form ? undefined : opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: ctl.signal,
    })
    if (!r.ok) {
      let code = 'http_' + r.status, message = COPY
      try {
        const j = await r.json()
        const e = j.error ?? j.detail?.error ?? j.detail
        if (e?.code) code = e.code
        if (typeof e?.message === 'string') message = e.message
      } catch { /* not json */ }
      throw new ApiError(r.status, code, message)
    }
    return (await r.json()) as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, 'network', 'We couldn’t reach the stylist. Check your connection and try again.')
  } finally {
    clearTimeout(t)
  }
}

/** POST + text/event-stream (EventSource can't POST), parsed by hand. */
export async function stream(path: string, body: unknown, onEvent: (event: string, data: any) => void, signal?: AbortSignal) {
  const r = await fetch(abs(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!r.ok || !r.body) throw new ApiError(r.status, 'http_' + r.status, COPY)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i)
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '')
      let event = 'message'
      const data: string[] = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (!data.length) continue
      let parsed: unknown = data.join('\n')
      try { parsed = JSON.parse(parsed as string) } catch { /* plain text */ }
      onEvent(event, parsed)
    }
  }
}

export const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* private mode */ } },
}
export const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string | null) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v) } catch { /* private mode */ } },
}
