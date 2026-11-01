import { test, expect, type Page } from '@playwright/test'
import { API, openWidget, w } from './helpers'

// Happy-path screenshot set for docs/screens (Devpost). Opt-in: SCREENS=1 pnpm --dir e2e screens
test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture docs/screens')
test.setTimeout(240_000)

const settle = async (page: Page) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => {
    const shadow = document.querySelector('#elara-root')?.shadowRoot
    const imgs = [...document.images, ...(shadow ? [...shadow.querySelectorAll('img')] : [])] as HTMLImageElement[]
    const pending = imgs.filter((i) => !i.complete && i.loading !== 'lazy').map((i) => new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); setTimeout(r, 8000) }))
    return Promise.all(pending)
  })
  await page.waitForTimeout(700)
}

test('capture screens', async ({ page, request }, info) => {
  const shot = async (name: string) => {
    await settle(page)
    await page.screenshot({ path: `../docs/screens/${name}-${info.project.name}.png` })
  }

  await page.goto('/')
  await shot('01-store-home')
  await page.goto('/women')
  await shot('02-store-listing')
  await page.goto('/p/nl-0099')
  await shot('03-store-pdp')
  await page.goto('/judge')
  await shot('15-judge-guide')
  await page.goto('/merchant')
  await shot('16-merchant-embed')

  await page.goto('/women')
  await openWidget(page)
  await w(page, 'occasion-beach-trip').click()
  await shot('04-onboarding-who')
  await w(page, 'who-continue').click()
  await w(page, 'sample-model-w1').click()
  await expect(w(page, 'photo-ok')).toBeVisible()
  await shot('05-onboarding-photo')
  await w(page, 'photo-continue').click()
  await expect(page.locator('[data-testid=dna-tile][data-status=ready], [data-testid=dna-tile][data-status=failed]')).toHaveCount(4, { timeout: 60_000 })
  await w(page, 'dna-heart').nth(0).click()
  await w(page, 'dna-heart').nth(2).click()
  await w(page, 'dna-cross').nth(1).click()
  await expect(w(page, 'dna-name')).toBeVisible()
  await page.evaluate(() => { const el = document.querySelector('#elara-root')!.shadowRoot!.querySelector('[data-testid=onboarding-dna]'); if (el) el.scrollTop = 0 })
  await shot('06-style-dna')
  await w(page, 'dna-continue').click()
  const card = w(page, 'look-card').first()
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(card.locator('[data-render-status=ready], [data-render-status=failed]')).toHaveCount(1, { timeout: 60_000 })
  await page.evaluate(() => { const el = document.querySelector('#elara-root')!.shadowRoot!.querySelector('[data-testid=chat] > div'); if (el) el.scrollTop = 0 })
  await shot('07-chat-looks')
  await card.locator('[data-testid=look-name]').scrollIntoViewIfNeeded()
  await shot('08-outfit-card')

  // The scripted demo look (cached renders): Studio tray → Try on → viewer → swap.
  await page.evaluate(() => (window as any).Elara?.open({ tab: 'studio', productIds: ['nl-0099', 'nl-0125'] }))
  await expect(w(page, 'tray-total')).toBeVisible()
  await shot('09-studio')
  await w(page, 'studio-tryon').click()
  await expect(w(page, 'viewer')).toBeVisible()
  await expect(w(page, 'viewer').locator('img[alt^="You wearing"]').first()).toBeVisible({ timeout: 60_000 }).catch(() => {})
  await shot('10-viewer-before-after')
  await w(page, 'hotspot-bottom').click().catch(() => {})
  await expect(w(page, 'swap-tile').first()).toBeVisible()
  await page.waitForTimeout(600) // score count-up
  await shot('11-swap-drawer')
  const puff = w(page, 'swap-tile').filter({ hasText: 'Puff Pants' })
  await ((await puff.count()) ? puff.first() : w(page, 'swap-tile').first()).click()
  await expect(w(page, 'history-strip').locator('button')).toHaveCount(2)
  await page.waitForTimeout(2500)
  await shot('12-viewer-swapped')

  await page.getByTestId('viewer').getByRole('button', { name: 'Share with Crew' }).click()
  await expect(w(page, 'share-sheet')).toBeVisible()
  await expect.poll(() => w(page, 'share-preview').evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0)
  await shot('13-share-sheet')
  await page.keyboard.press('Escape')
  await page.getByTestId('viewer').getByTestId('add-look').click()
  await expect(page.getByTestId('cart-drawer')).toHaveAttribute('aria-hidden', 'false')
  await shot('17-cart-drawer')

  // Crew: the seeded "Goa trip crew" as its owner if seed_demo.py ran, else the crew made above.
  const seeded = (await request.get(`${API}/api/crews/goatripcrew2026x`)).ok()
  if (seeded) {
    const ctx = await page.context().browser()!.newContext({ viewport: page.viewportSize()!, isMobile: info.project.name === 'mobile' })
    const p2 = await ctx.newPage()
    await p2.addInitScript(() => { localStorage.setItem('elara.token', 'demo-priya-token-000000000'); localStorage.setItem('elara.crew', 'goatripcrew2026x') })
    await p2.goto('/')
    await p2.getByTestId('elara-launcher').click()
    await p2.getByTestId('tab-crew').click()
    await expect(p2.getByTestId('crew-view')).toBeVisible()
    await p2.getByTestId('thread-bottom').first().click().catch(() => {})
    await p2.waitForTimeout(1500)
    await p2.screenshot({ path: `../docs/screens/14-crew-${info.project.name}.png` })
    await ctx.close()
  } else {
    await page.getByTestId('cart-drawer').getByRole('button', { name: 'Close bag' }).click()
    await page.evaluate(() => (window as any).Elara?.open({ tab: 'crew' }))
    await expect(w(page, 'crew-view')).toBeVisible()
    await expect(w(page, 'toast')).toBeHidden({ timeout: 8_000 })
    await shot('14-crew')
  }
})
