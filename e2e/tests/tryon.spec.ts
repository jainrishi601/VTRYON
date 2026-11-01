import { test, expect } from '@playwright/test'
import { API } from './helpers'

// TRYON platform (desktop web): sign up → onboarding (no photos, so no renders) → Style DNA → wardrobe; the store widget then
// starts with the gender from the profile. Zero YouCam units.
test('TRYON-1 sign up, onboard, see Style DNA and the empty wardrobe; the widget knows the gender', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'TRYON is a desktop web page')
  await page.goto('/tryon')
  await expect(page).toHaveURL(/\/tryon\/login$/)
  await page.getByTestId('auth-switch').click()
  await page.getByTestId('auth-name').fill('Mira')
  await page.getByTestId('auth-email').fill(`mira+${Date.now()}${Math.random().toString(36).slice(2, 7)}@example.com`)
  await page.getByTestId('auth-password').fill('secret12')
  await page.getByTestId('auth-submit').click()

  await expect(page.getByTestId('onb-goal')).toBeVisible()
  await expect(page.getByTestId('onb-continue')).toBeDisabled()
  await page.getByTestId('goal-mindful').click()
  await page.getByTestId('onb-continue').click()
  await page.getByTestId('gender-women').click()
  await page.getByTestId('onb-continue').click()
  await expect(page.getByTestId('onb-photos-intro')).toBeVisible()
  await page.getByTestId('onb-continue').click()
  await page.getByTestId('onb-skip').click() // no photos
  await page.getByTestId('onb-continue').click() // breather
  await page.getByTestId('size-tops').selectOption('S')
  await page.getByTestId('onb-continue').click()
  await page.getByTestId('onb-skip').click() // height/weight
  await page.getByTestId('onb-continue').click() // breather
  await expect(page.getByTestId('onb-colors')).toBeVisible()
  await page.getByTestId('shade-Navy').click({ timeout: 30_000 })
  await page.getByTestId('onb-continue').click()
  await expect(page.getByTestId('vibes-progress')).toContainText('Shown flat')
  await page.getByTestId('vibe-love').click()
  await page.getByTestId('vibe-dislike').click()
  await page.getByTestId('onb-continue').click()
  await page.getByTestId('never-pattern:animal').click()
  await page.getByTestId('onb-continue').click()
  await page.getByTestId('onb-continue').click() // "Build my profile"
  await expect(page.getByTestId('onb-sync')).toBeVisible()

  await expect(page.getByTestId('dna-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('dna-facts')).toContainText(/Women.s/)
  await expect(page.getByTestId('dna-facts')).toContainText('Shop more mindfully')
  await page.getByTestId('dna-tab-map').click()
  await expect(page.getByTestId('dna-map').getByTestId('dna-node').first()).toBeVisible()
  await page.getByTestId('dna-tab-timeline').click()
  await expect(page.getByTestId('dna-timeline')).toContainText('never list')

  await page.getByTestId('nav-wardrobe').click()
  await expect(page.getByTestId('wardrobe-empty')).toBeVisible()

  // Style Play: one A/B pair, a pick moves on to the next
  await page.getByTestId('nav-style').click()
  await page.getByTestId('dna-tab-play').click()
  await expect(page.getByTestId('play-a')).toBeVisible()
  await page.getByTestId('play-b').click()
  await expect(page.getByTestId('dna-play')).toContainText('1 answered')

  // Daily Picks: three cards (store pieces until the wardrobe has some), feedback sticks
  await page.getByTestId('nav-daily').click()
  await expect(page.getByTestId('pick-card')).toHaveCount(3, { timeout: 60_000 })
  await page.getByTestId('pick-card').first().getByTestId('pick-wore').click()
  await expect(page.getByTestId('pick-card').first().getByTestId('pick-wore')).toHaveText('Wore it')

  // Stylist: opens the store's stylist chat with the message
  await page.getByTestId('nav-stylist').click()
  await page.getByTestId('stylist-input').fill('linen shirts')
  await page.getByTestId('stylist-input').press('Enter')
  await expect(page.getByTestId('elara-panel')).toHaveAttribute('aria-hidden', 'false')

  // The store widget on this site now uses the account's shopper token: its new chat starts with the gender.
  const token = await page.evaluate(() => localStorage.getItem('elara.token'))
  const r = await page.request.post(`${API}/api/session`, { data: { user_token: token } })
  const s = await (await page.request.get(`${API}/api/session/${(await r.json()).session_id}`)).json()
  expect(s.brief.gender).toBe('women')
})

// Swap has two options in the store: shop new, or a piece from the shopper's own TRYON wardrobe. Zero YouCam units.
test('TRYON-2 swap a piece with one from your own wardrobe', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop web')
  const s = await (await request.post(`${API}/api/session`, { data: {} })).json()
  const email = `wren+${Date.now()}${Math.random().toString(36).slice(2, 7)}@example.com`
  const { auth } = await (await request.post(`${API}/api/auth/signup`, { data: { name: 'Wren', email, password: 'secret12', user_token: s.user_token } })).json()
  const H = { Authorization: `Bearer ${auth}` }
  await request.patch(`${API}/api/me/profile`, { headers: H, data: { gender: 'women' } })
  // one owned piece: upload a plain image, keep a single item, tag it as jeans
  await page.setContent('<body style="margin:0;background:#2f4a7a"></body>')
  const img = await page.screenshot()
  const added = (await (await request.post(`${API}/api/me/wardrobe`, { headers: H, multipart: { file: { name: 'w.png', mimeType: 'image/png', buffer: img } } })).json()).items
  for (const x of added.slice(1)) await request.delete(`${API}/api/me/wardrobe/${x.id}`, { headers: H })
  await request.patch(`${API}/api/me/wardrobe/${added[0].id}`, { headers: H, data: { name: 'My Blue Wide Jeans', slot: 'bottom', category: 'jeans', color_family: 'blue', formality: 2, allow_styling: true } })
  // a store chat on a sample model, and a ready look with a top and a bottom
  const s2 = await (await request.post(`${API}/api/session`, { data: { user_token: s.user_token } })).json()
  await request.patch(`${API}/api/session/${s2.session_id}`, { data: { brief: { for: 'self', gender: 'women', occasion: 'Weekend', budget_max: 12000 } } })
  await request.post(`${API}/api/session/${s2.session_id}/photo`, { data: { sample_model_id: 'w1' } })
  const pick = async (slot: string) => (await (await request.get(`${API}/api/products?gender=women&slot=${slot}&max_price=3500&limit=1`)).json()).items[0].id
  const look = await (await request.post(`${API}/api/tryon`, { data: { session_id: s2.session_id, product_ids: [await pick('top'), await pick('bottom')] } })).json()

  await page.addInitScript(([t, sid]) => { if (!sessionStorage.getItem('__s')) { localStorage.setItem('elara.token', t); sessionStorage.setItem('elara.sid', sid); sessionStorage.setItem('__s', '1') } }, [s.user_token, s2.session_id])
  await page.goto(`/?look=${look.id}`)
  await page.getByTestId('hotspot-bottom').click({ timeout: 30_000 })
  await expect(page.getByTestId('swap-drawer')).toBeVisible()
  await expect(page.getByTestId('swap-modes')).toBeVisible()
  await expect(page.getByTestId('swap-tile').first()).toBeVisible() // "Shop new" first
  await expect(page.getByTestId('swap-tile-owned')).toHaveCount(0)
  await page.getByTestId('swap-mode-mine').click()
  const mine = page.getByTestId('swap-tile-owned')
  await expect(mine).toHaveCount(1)
  await expect(mine).toContainText('My Blue Wide Jeans')
  await expect(mine).toContainText('In your wardrobe')
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes(`/api/looks/${look.id}/swap`)), mine.click()])
  const child = await res.json()
  const bottom = child.items.find((it: { slot: string }) => it.slot === 'bottom').product
  expect(bottom.id).toBe(added[0].id)
  expect(bottom.owned).toBe(true)
  expect(child.total).toBe(child.items.find((it: { slot: string }) => it.slot === 'top').product.price) // owned pieces cost nothing
  await expect(page.getByTestId('swap-drawer')).toBeHidden()
})
