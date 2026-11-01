import { test, expect } from '@playwright/test'
import { API, answerUntilResults, apiSession, chatWithLooks, openWidget, rupees, seedBrowser, w } from './helpers'

test('E2E-1 store loads, widget mounts in a shadow root, fonts are isolated', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Northline home' })).toBeVisible()
  expect(await page.evaluate(() => !!document.querySelector('#elara-root')?.shadowRoot)).toBe(true)
  await expect(w(page, 'elara-launcher')).toHaveText(/Need help choosing|Style me/)
  // Hostile host CSS must not reach the widget.
  await page.addStyleTag({ content: '* { font-family: "Comic Sans MS", cursive !important; letter-spacing: 3px !important; }' })
  const font = await w(page, 'elara-launcher').evaluate((el) => getComputedStyle(el).fontFamily)
  expect(font).toContain('Outfit')
  // And the one-script-tag embed is what loaded it.
  expect(await page.locator('script[src="/widget.js"][data-store-id="northline"]').count()).toBe(1)
})

test('E2E-2/3/4 chat first → question card → flat looks → Try on asks for a photo once → render', async ({ page }) => {
  await test.step('E2E-2 the widget opens straight into chat, no form', async () => {
    await page.goto('/')
    await openWidget(page)
    await expect(w(page, 'chat')).toBeVisible()
    await expect(page.locator('[data-testid^=onboarding-]')).toHaveCount(0)
  })
  await test.step('E2E-3 the question card fills in what is missing (gender first)', async () => {
    await w(page, 'composer-input').fill('Beach party looks, under ₹7,000')
    await w(page, 'composer-send').click()
    await expect(w(page, 'clarify-card')).toBeVisible({ timeout: 60_000 })
    await expect(w(page, 'clarify-option').first()).toBeVisible()
    await expect(w(page, 'clarify-skip')).toBeVisible()
    await answerUntilResults(page, /women/i)
  })
  await test.step('E2E-4 2–3 cards within budget, all flat until tapped; Try on renders after one photo', async () => {
    const cards = w(page, 'look-card')
    const n = await cards.count()
    expect(n).toBeGreaterThanOrEqual(2)
    expect(n).toBeLessThanOrEqual(3)
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i)
      const total = rupees(await card.getByTestId('look-total').innerText())
      const over = await card.getByText(/over budget/).count()
      expect(total <= 7000 || over > 0).toBe(true)
      await expect(card.locator('[data-render-status=idle]')).toHaveCount(1) // nothing spent yet
      await expect(card.locator('[data-testid^=piece-row]').first()).toBeVisible()
    }
    await cards.first().getByTestId('look-try-on').click()
    await expect(w(page, 'tryon-sheet')).toBeVisible()
    await expect(page.locator('[data-testid^=tryon-model-m]')).toHaveCount(0) // women's look: women's models only
    await w(page, 'tryon-model-w1').click()
    await expect(cards.first().locator('[data-render-status=ready], [data-render-status=failed]')).toHaveCount(1, { timeout: 30_000 })
    await expect(cards.nth(1).locator('[data-render-status=idle]')).toHaveCount(1) // the others stay flat
  })
})

test('E2E-16 empty state shows the scripted openers; flat looks get a one-tap "See these on you" strip', async ({ page }) => {
  await page.goto('/')
  await openWidget(page)
  await expect(w(page, 'chat-empty')).toBeVisible()
  await expect(w(page, 'opener')).toHaveCount(3)
  await w(page, 'opener').first().click()
  await answerUntilResults(page, /women/i)
  const strip = w(page, 'see-on-you')
  await expect(strip).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-testid^=see-model-m]')).toHaveCount(0) // women's looks: women's models only
  await w(page, 'see-model-w1').click()
  const cards = w(page, 'look-card')
  const n = await cards.count()
  await expect(page.locator('[data-testid=look-card] [data-render-status=ready]')).toHaveCount(n, { timeout: 45_000 })
  await expect(strip).toBeHidden()
})

test('E2E-17 Studio: tapping a tile toggles it in the tray', async ({ page }) => {
  await page.goto('/')
  await openWidget(page)
  await w(page, 'tab-studio').click()
  const tile = w(page, 'studio-item').first()
  await expect(tile).toBeVisible({ timeout: 20_000 })
  await tile.click()
  await expect(tile).toHaveAttribute('aria-pressed', 'true')
  await expect(w(page, 'tray-total')).toBeVisible()
  await tile.click()
  await expect(tile).toHaveAttribute('aria-pressed', 'false')
})

test('E2E-13 a women’s look never renders on a men’s photo; the sheet offers a women’s model instead', async ({ page, request }) => {
  await chatWithLooks(page, request, 'm1')
  const card = w(page, 'look-card').first()
  await card.getByTestId('look-try-on').click()
  await expect(w(page, 'tryon-mismatch')).toBeVisible()
  await expect(page.locator('[data-testid^=tryon-model-m]')).toHaveCount(0)
  await w(page, 'tryon-model-w1').click()
  await expect(card.locator('[data-render-status=ready]')).toHaveCount(1, { timeout: 30_000 })
  await expect(card.getByText('On the model')).toBeVisible()
})

test('E2E-14 tap one piece: it renders alone, with scored pieces that pair best', async ({ page, request }) => {
  await chatWithLooks(page, request)
  const card = w(page, 'look-card').filter({ has: page.locator('[data-testid=piece-tryon-top], [data-testid=piece-tryon-one_piece]') }).first()
  await card.locator('[data-testid=piece-tryon-top], [data-testid=piece-tryon-one_piece]').first().click()
  await expect(w(page, 'tryon-result')).toBeVisible({ timeout: 20_000 })
  await expect(w(page, 'tryon-result').locator('img[alt^="You wearing"]').first()).toBeVisible({ timeout: 30_000 })
  await expect(w(page, 'tryon-pair').first()).toBeVisible()
  await expect(w(page, 'tryon-pairs').getByTestId('score-badge').first()).toBeVisible()
  await expect(w(page, 'tryon-full-look')).toBeVisible()
})

test('E2E-15 a request for a kind of piece gets a product grid (live Claude only)', async ({ page, request }) => {
  const st = await (await request.get(`${API}/api/status`)).json()
  test.skip(!st.anthropic?.configured, 'the deterministic fallback only composes looks')
  const { sid, token } = await apiSession(request)
  await seedBrowser(page, token, sid)
  await page.goto('/')
  await openWidget(page)
  await w(page, 'composer-input').fill('show me some white shirts')
  await w(page, 'composer-send').click()
  await answerUntilResults(page)
  const cards = w(page, 'grid-card')
  await expect(cards.first()).toBeVisible()
  expect(await cards.count()).toBeGreaterThanOrEqual(2)
  await expect(cards.first().getByTestId('product-add')).toBeVisible()
})

test('E2E-5 viewer slider → bottom hotspot → swap drawer → new render in history', async ({ page, request }) => {
  await chatWithLooks(page, request)
  const card = w(page, 'look-card').filter({ has: page.getByTestId('swap-bottom') }).first()
  // The session already has a women's photo: the looks render on their own (or after one tap on older backends).
  await expect(card.locator('[data-render-status]:not([data-render-status=idle]), [data-testid=look-try-on]').first()).toBeVisible({ timeout: 20_000 })
  if (await card.getByTestId('look-try-on').count()) await card.getByTestId('look-try-on').click()
  await expect(card.locator('[data-render-status=ready]')).toHaveCount(1, { timeout: 30_000 })
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
  await expect(w(page, 'tryon-sheet')).toBeVisible()
  await expect(w(page, 'tryon-generate')).toBeDisabled() // an upload needs a photo and consent; a sample model doesn't
  await w(page, 'tryon-model-w1').click()
  const img = w(page, 'tryon-result').locator('img[alt^="You wearing"]').first()
  await expect(img).toBeVisible({ timeout: 20_000 })
  await expect(img).toHaveAttribute('alt', new RegExp(title.split(' - ')[0].toLowerCase()))
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

test('W17 Forget me deletes the profile and starts a fresh chat', async ({ page, request }) => {
  const { sid, token } = await apiSession(request)
  await seedBrowser(page, token, sid)
  await page.goto('/')
  await openWidget(page)
  await expect(w(page, 'chat')).toBeVisible()
  await w(page, 'forget-me').click()
  await w(page, 'forget-confirm').click()
  await expect(w(page, 'toast')).toContainText('deleted')
  await expect(w(page, 'chat')).toBeVisible()
  await expect(w(page, 'user-msg')).toHaveCount(0)
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
