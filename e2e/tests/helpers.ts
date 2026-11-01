import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const API = 'http://localhost:8000'

/** Playwright CSS/test-id locators pierce open shadow roots, so widget elements are found directly. */
export const w = (page: Page, id: string) => page.getByTestId(id)

export async function openWidget(page: Page) {
  await w(page, 'elara-launcher').click()
  await expect(w(page, 'elara-panel')).toHaveAttribute('aria-hidden', 'false')
}

/** Full UI onboarding: Me → Beach trip → budget 7000 → sample model → DNA picker. */
export async function onboardToDna(page: Page) {
  await page.goto('/')
  await openWidget(page)
  await expect(w(page, 'who-continue')).toBeDisabled()
  await w(page, 'occasion-beach-trip').click()
  await expect(w(page, 'budget-value')).toContainText('7,000')
  await w(page, 'who-continue').click()
  await w(page, 'sample-model-w1').click()
  await expect(w(page, 'photo-ok')).toBeVisible()
  await w(page, 'photo-continue').click()
  await expect(w(page, 'dna-picker')).toBeVisible()
}

/** API-side session with a brief and a sample-model photo; returns ids to seed the browser with. */
export async function apiSession(request: APIRequestContext, brief: Record<string, unknown> = { for: 'self', gender: 'women', occasion: 'Beach trip', budget_max: 7000 }) {
  const s = await (await request.post(`${API}/api/session`, { data: {} })).json()
  await request.patch(`${API}/api/session/${s.session_id}`, { data: { brief } })
  await request.post(`${API}/api/session/${s.session_id}/photo`, { data: { sample_model_id: 'w1' } })
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
export async function chatWithLooks(page: Page, request: APIRequestContext) {
  const { sid, token } = await apiSession(request)
  await seedBrowser(page, token, sid)
  await page.goto('/')
  await openWidget(page)
  await expect(w(page, 'chat')).toBeVisible()
  await w(page, 'composer-input').fill('Goa beach trip, ₹7,000, easy and minimal.')
  await w(page, 'composer-send').click()
  await expect(w(page, 'look-card').first()).toBeVisible({ timeout: 45_000 })
  return { sid, token }
}

export const rupees = (s: string) => Number(s.replace(/[^\d]/g, ''))
