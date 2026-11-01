import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const API = `http://localhost:${process.env.E2E_API_PORT ?? '8010'}`

/** Playwright CSS/test-id locators pierce open shadow roots, so widget elements are found directly. */
export const w = (page: Page, id: string) => page.getByTestId(id)

export async function openWidget(page: Page) {
  await w(page, 'elara-launcher').click()
  await expect(w(page, 'elara-panel')).toHaveAttribute('aria-hidden', 'false')
}

/** Chat first: answer whatever the question card asks (pick the option matching `prefer`, else the first) until
 *  outfit cards or a product grid arrive. */
export async function answerUntilResults(page: Page, prefer: RegExp = /women/i) {
  const results = page.locator('[data-testid=look-card], [data-testid=grid-card]')
  for (let i = 0; i < 3; i++) {
    const card = w(page, 'clarify-card')
    await expect(results.first().or(card)).toBeVisible({ timeout: 90_000 }) // live Claude under load
    if (await results.count()) return
    const q1 = await w(page, 'clarify-question').innerText().catch(() => '')
    const opts = w(page, 'clarify-option')
    const match = opts.filter({ hasText: prefer })
    await ((await match.count()) ? match.first() : opts.first()).click()
    await page.waitForTimeout(500) // the card shows the pick for a beat, then moves on
    const q2 = await w(page, 'clarify-question').innerText({ timeout: 1000 }).catch(() => '')
    if (q2 && q2 !== q1) { // a second question on the same card
      const o2 = w(page, 'clarify-option')
      const m2 = o2.filter({ hasText: prefer })
      await ((await m2.count()) ? m2.first() : o2.first()).click()
    }
  }
  await expect(results.first()).toBeVisible({ timeout: 60_000 })
}

/** API-side session with a brief and a sample-model photo; returns ids to seed the browser with. */
export async function apiSession(request: APIRequestContext, brief: Record<string, unknown> = { for: 'self', gender: 'women', occasion: 'Beach trip', budget_max: 7000 }, model = 'w1') {
  const s = await (await request.post(`${API}/api/session`, { data: {} })).json()
  await request.patch(`${API}/api/session/${s.session_id}`, { data: { brief } })
  await request.post(`${API}/api/session/${s.session_id}/photo`, { data: { sample_model_id: model } })
  return { sid: s.session_id as string, token: s.user_token as string }
}

/** Seed localStorage (token) and, optionally, sessionStorage (sid) before the page loads. */
export async function seedBrowser(page: Page, token: string, sid?: string, extra: Record<string, string> = {}) {
  await page.addInitScript(([t, s, x]) => {
    if (sessionStorage.getItem('__seeded')) return
    localStorage.setItem('elara.token', t as string)
    if (s) sessionStorage.setItem('elara.sid', s as string)
    for (const [k, v] of Object.entries(x as Record<string, string>)) localStorage.setItem(k, v)
    sessionStorage.setItem('__seeded', '1')
  }, [token, sid ?? '', extra] as const)
}

/** Seeded session → chat opens → send a brief → wait for outfit cards. */
export async function chatWithLooks(page: Page, request: APIRequestContext, model = 'w1') {
  const { sid, token } = await apiSession(request, undefined, model)
  await seedBrowser(page, token, sid)
  await page.goto('/')
  await openWidget(page)
  await expect(w(page, 'chat')).toBeVisible()
  await w(page, 'composer-input').fill('Goa beach trip, ₹7,000, easy and minimal.')
  await w(page, 'composer-send').click()
  await answerUntilResults(page)
  await expect(w(page, 'look-card').first()).toBeVisible({ timeout: 45_000 })
  return { sid, token }
}

export const rupees = (s: string) => Number(s.replace(/[^\d]/g, ''))
