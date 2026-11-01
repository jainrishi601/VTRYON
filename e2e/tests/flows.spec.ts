import { test, expect } from '@playwright/test'
import { API, apiSession, chatWithLooks, onboardToDna, openWidget, rupees, seedBrowser, w } from './helpers'

test('E2E-1 store loads, widget mounts in a shadow root, fonts are isolated', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Northline home' })).toBeVisible()
  expect(await page.evaluate(() => !!document.querySelector('#elara-root')?.shadowRoot)).toBe(true)
  await expect(w(page, 'elara-launcher')).toHaveText(/Style me/)
  // Hostile host CSS must not reach the widget.
  await page.addStyleTag({ content: '* { font-family: "Comic Sans MS", cursive !important; letter-spacing: 3px !important; }' })
  const font = await w(page, 'elara-launcher').evaluate((el) => getComputedStyle(el).fontFamily)
  expect(font).toContain('Hanken Grotesk')
  // And the one-script-tag embed is what loaded it.
  expect(await page.locator('script[src="/widget.js"][data-store-id="northline"]').count()).toBe(1)
})

test('E2E-2/3/4 onboarding → Style DNA → opener → outfit cards', async ({ page }) => {
  await test.step('E2E-2 onboarding lands on the DNA picker', async () => {
    await onboardToDna(page)
  })
  await test.step('E2E-3 DNA picker: 4 tiles, heart two, name appears, opener is sent', async () => {
    const tiles = w(page, 'dna-tile')
    await expect(tiles).toHaveCount(4)
    await expect(page.locator('[data-testid=dna-tile][data-status=ready], [data-testid=dna-tile][data-status=failed]')).toHaveCount(4, { timeout: 30_000 })
    await expect(w(page, 'dna-continue')).toBeDisabled()
    await w(page, 'dna-heart').nth(0).click()
    await w(page, 'dna-heart').nth(1).click()
    await expect(w(page, 'dna-name')).not.toBeEmpty()
    await w(page, 'dna-continue').click()
    await expect(w(page, 'user-msg').first()).toContainText('Beach trip')
    await expect(w(page, 'user-msg').first()).toContainText('7,000')
  })
  await test.step('E2E-4 streamed status, 2–3 cards within budget, renders resolve', async () => {
    const cards = w(page, 'look-card')
    await expect(cards.first()).toBeVisible({ timeout: 45_000 })
    const n = await cards.count()
    expect(n).toBeGreaterThanOrEqual(2)
    expect(n).toBeLessThanOrEqual(3)
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i)
      const total = rupees(await card.getByTestId('look-total').innerText())
      const over = await card.getByText(/over budget/).count()
      expect(total <= 7000 || over > 0).toBe(true)
      await expect(card.locator('[data-render-status=ready], [data-render-status=failed]')).toHaveCount(1, { timeout: 20_000 })
    }
    await expect(w(page, 'status-done').first()).toBeVisible()
  })
})

test('E2E-5 viewer slider → bottom hotspot → swap drawer → new render in history', async ({ page, request }) => {
  await chatWithLooks(page, request)
  const card = w(page, 'look-card').filter({ has: page.getByTestId('swap-bottom') }).first()
  await expect(card.locator('[data-render-status=ready]')).toHaveCount(1, { timeout: 20_000 })
  await card.getByTestId('open-viewer').click()
  await expect(w(page, 'viewer')).toBeVisible()
  const handle = w(page, 'ba-handle')
  if (await handle.count()) {
    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', '55')
  }
  await w(page, 'hotspot-bottom').click()
  await expect(w(page, 'swap-drawer')).toBeVisible()
  const tiles = w(page, 'swap-tile')
  await expect(tiles.first()).toBeVisible()
  const k = await tiles.count()
  expect(k).toBeGreaterThanOrEqual(4)
  expect(k).toBeLessThanOrEqual(6)
  await expect(w(page, 'swap-drawer').getByTestId('score-badge')).toHaveCount(k)
  await tiles.first().click()
  await expect(w(page, 'swap-drawer')).toBeHidden()
  await expect(w(page, 'history-strip').locator('button')).toHaveCount(2)
  await expect(w(page, 'viewer').locator('img[alt^="You wearing"]').first()).toBeVisible({ timeout: 20_000 })
})

test('E2E-6 product card "Try on me" opens the widget with that product rendered', async ({ page }) => {
  await page.goto('/women')
  const card = w(page, 'product-card').first()
  await expect(card).toBeVisible()
  const title = await card.locator('h3').innerText()
  await card.hover()
  await card.getByTestId('try-on-chip').click()
  await expect(w(page, 'elara-panel')).toHaveAttribute('aria-hidden', 'false')
  await w(page, 'sample-model-w1').click()
  await expect(w(page, 'photo-ok')).toBeVisible()
  await w(page, 'photo-continue').click()
  await expect(w(page, 'viewer')).toBeVisible()
  await expect(w(page, 'viewer').locator('img[alt^="You wearing"]').first()).toBeVisible({ timeout: 20_000 })
  await expect(w(page, 'viewer').locator('img[alt^="You wearing"]').first()).toHaveAttribute('alt', new RegExp(title.split(' - ')[0].toLowerCase()))
})

test('E2E-7 "Add look to bag" opens the store cart with the right lines and subtotal', async ({ page, request }) => {
  await chatWithLooks(page, request)
  const card = w(page, 'look-card').first()
  const pieces = await card.getByTestId('piece-row').count()
  const total = rupees(await card.getByTestId('look-total').innerText())
  await card.getByTestId('add-look').click()
  await expect(page.getByTestId('cart-drawer')).toHaveAttribute('aria-hidden', 'false')
  await expect(page.getByTestId('cart-line')).toHaveCount(pieces)
  expect(rupees(await page.getByTestId('cart-subtotal').innerText())).toBe(total)
  await expect(page.getByTestId('bag-count')).toHaveText(String(pieces))
  await expect(page.getByTestId('cart-line').first()).toContainText('Styled with Ava')
})

test('E2E-8 a friend joins the crew from the link and the owner sees the comment', async ({ page, browser, request }) => {
  // Owner: a session with a look in a crew, set up through the API.
  const { sid, token } = await apiSession(request)
  const pick = async (slot: string) => (await (await request.get(`${API}/api/products?gender=women&slot=${slot}&limit=1`)).json()).items[0].id
  const look = await (await request.post(`${API}/api/tryon`, { data: { session_id: sid, product_ids: [await pick('top'), await pick('bottom')] } })).json()
  const crew = await (await request.post(`${API}/api/crews`, { data: { session_id: sid, look_id: look.id } })).json()

  const friendCtx = await browser.newContext()
  const friend = await friendCtx.newPage()
  await friend.goto(`/?crew=${crew.id}`)
  await expect(w(friend, 'crew-join')).toBeVisible()
  await w(friend, 'crew-name-input').fill('Riya')
  await w(friend, 'crew-join-btn').click()
  await expect(w(friend, 'crew-view')).toBeVisible()
  await w(friend, 'thread-bottom').click()
  await w(friend, 'reply-bottom').fill('trousers yes')
  await w(friend, 'reply-bottom').press('Enter')
  await expect(w(friend, 'thread-body-bottom')).toContainText('trousers yes')

  await seedBrowser(page, token, sid, { 'elara.crew': crew.id })
  await page.goto('/')
  await openWidget(page)
  await w(page, 'tab-crew').click()
  await w(page, 'thread-bottom').click()
  await expect(w(page, 'thread-body-bottom')).toContainText('trousers yes', { timeout: 5_000 })
  await expect(w(page, 'crew-view')).toContainText('Riya')
  await friendCtx.close()
})

test('E2E-9 Share with Crew shows a preview image and a copy link', async ({ page, request }) => {
  await chatWithLooks(page, request)
  await w(page, 'look-card').first().getByTestId('share-crew').click()
  await expect(w(page, 'share-sheet')).toBeVisible()
  const img = w(page, 'share-preview')
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0)
  await expect(w(page, 'share-copy')).toBeVisible()
  await expect(w(page, 'share-link')).toContainText('?crew=')
  await expect(w(page, 'share-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/)
})

test('E2E-10 a returning token skips onboarding and says welcome back', async ({ page, request }) => {
  const { token } = await apiSession(request)
  await seedBrowser(page, token) // new tab: token, no session id
  await page.goto('/')
  await openWidget(page)
  await expect(w(page, 'chat')).toBeVisible()
  await expect(w(page, 'agent-text').first()).toContainText('Welcome back')
  await expect(page.locator('[data-testid^=onboarding-]')).toHaveCount(0)
})

test('E2E-11 /admin/renders lists calls with cache and units', async ({ page, request }) => {
  const j = await (await request.get(`${API}/api/admin/renders`)).json()
  expect(j.totals).toHaveProperty('cache_hits')
  expect(j.totals).toHaveProperty('units')
  await page.goto('/admin/renders')
  await expect(page.locator('body')).toContainText(/cache/i)
  await expect(page.locator('body')).toContainText(/unit/i)
})

test('E2E-12 mobile: full-screen panel, pinned composer, no horizontal scroll', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile viewport only')
  await chatWithLooks(page, request)
  const box = await w(page, 'elara-panel').boundingBox()
  const vp = page.viewportSize()!
  expect(Math.round(box!.width)).toBe(vp.width)
  expect(Math.round(box!.height)).toBeGreaterThanOrEqual(vp.height - 1)
  const input = await w(page, 'composer-input').boundingBox()
  expect(input!.y + input!.height).toBeGreaterThan(vp.height - 120)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await w(page, 'look-card').first().getByTestId('open-viewer').click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('W17 Forget me deletes the profile and restarts onboarding', async ({ page, request }) => {
  const { sid, token } = await apiSession(request)
  await seedBrowser(page, token, sid)
  await page.goto('/')
  await openWidget(page)
  await expect(w(page, 'chat')).toBeVisible()
  await w(page, 'forget-me').click()
  await w(page, 'forget-confirm').click()
  await expect(w(page, 'onboarding-who')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('elara.token'))).not.toBe(token)
  expect((await request.get(`${API}/api/session/${sid}`)).status()).toBe(404)
})

test('W16 store pages have no horizontal scroll on phones', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile viewport only')
  for (const path of ['/', '/women', '/p/nl-0099', '/judge', '/merchant']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true)
  }
})
