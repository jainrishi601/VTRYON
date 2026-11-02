// Clean screenshots for the Devpost gallery, from state the demo recording already rendered (zero YouCam units:
// every render here is a cache hit or an existing look). Run from e2e/: node demo/shots.mjs
// ponytail: ids below come from one recording run; re-point them after a new run (see the sqlite queries in the PR notes).
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.DEMO_BASE ?? 'http://localhost:5190'
const OUT = 'var/gallery/raw'
mkdirSync(OUT, { recursive: true })
const ID = {
  email: process.env.MIRA_EMAIL, pw: 'drape-demo-26',
  chat: 's_w4fsenielft1kucr', gift: 's_gyroduviu8pb5qel',
  look: 'lk_1fe20mrroz', swapped: 'lk_kpn4ydo5ku', video: 'lk_olps538fd6',
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await desk.newPage()
const w = (id, p = page) => p.getByTestId(id)
const shot = async (name, p = page) => { await pause(700); await p.screenshot({ path: `${OUT}/${name}.png` }); console.log('·', name) }
const imgsLoaded = (p = page) => p.waitForFunction(() => {
  const all = [...document.images, ...[...document.querySelectorAll('#elara-root')].flatMap((r) => [...(r.shadowRoot?.querySelectorAll('img') ?? [])])]
  return all.every((i) => i.complete)
}, null, { timeout: 20_000 }).catch(() => {})
const withSid = (ctx, sid) => ctx.addInitScript((s) => { if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('elara.sid', s); sessionStorage.setItem('__s', '1') } }, sid)

async function step(name, fn) {
  try { await fn() } catch (e) { console.error(`✗ ${name}: ${e.message.split('\n')[0]}`) }
}

// TRYON: log in as the recording's test shopper (sets elara.token for the store widget too)
await step('login', async () => {
  await page.goto(BASE + '/tryon/login')
  await w('auth-email').fill(ID.email)
  await w('auth-password').fill(ID.pw)
  await w('auth-submit').click()
  await page.waitForURL(/\/tryon\/(dna|picks|onboarding)/, { timeout: 20_000 })
})
await step('dna', async () => {
  await page.goto(BASE + '/tryon/dna'); await w('dna-page').waitFor(); await imgsLoaded(); await shot('tryon-dna')
  await w('dna-tab-map').click(); await w('dna-map').waitFor(); await pause(800)
  await w('dna-node').nth(2).click().catch(() => {}); await shot('tryon-map')
  await w('dna-tab-play').click(); await w('play-a').waitFor(); await imgsLoaded(); await shot('tryon-play')
})
await step('picks', async () => {
  await page.goto(BASE + '/tryon/picks'); await w('pick-card').nth(2).waitFor({ timeout: 60_000 }); await imgsLoaded(); await shot('tryon-picks')
})
await step('wardrobe', async () => {
  await page.goto(BASE + '/tryon/wardrobe'); await w('wardrobe-item').first().waitFor({ timeout: 20_000 }); await imgsLoaded(); await shot('tryon-wardrobe')
})

// Store: the Goa chat with looks rendered on Mira
const store = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, storageState: await desk.storageState() })
await withSid(store, ID.chat)
const sp = await store.newPage()
await step('chat', async () => {
  await sp.goto(BASE + '/'); await sp.waitForLoadState('networkidle'); await shot('store-home', sp)
  await w('elara-launcher', sp).click(); await w('look-card', sp).first().waitFor({ timeout: 20_000 })
  await w('look-card', sp).first().scrollIntoViewIfNeeded(); await imgsLoaded(sp); await shot('chat-look', sp)
  await sp.locator('[data-testid=look-card]').first().getByText('Why this works').click().catch(() => {})
  await shot('chat-why', sp)
})
await step('viewer', async () => {
  await sp.goto(BASE + `/?look=${ID.swapped}`); await w('viewer', sp).waitFor(); await imgsLoaded(sp); await shot('viewer-swapped', sp)
  await sp.goto(BASE + `/?look=${ID.look}`); await w('viewer', sp).waitFor(); await imgsLoaded(sp)
  await w('hotspot-bottom', sp).click(); await w('swap-drawer', sp).waitFor(); await w('swap-tile', sp).first().waitFor(); await imgsLoaded(sp); await shot('swap-new', sp)
  await w('swap-mode-mine', sp).click(); await pause(600); await imgsLoaded(sp); await shot('swap-mine', sp)
  await sp.keyboard.press('Escape')
})
await step('share', async () => {
  await sp.goto(BASE + `/?look=${ID.swapped}`); await w('viewer', sp).waitFor()
  await w('viewer', sp).getByRole('button', { name: 'Share with Crew' }).click(); await w('share-sheet', sp).waitFor()
  await sp.waitForFunction(() => document.querySelector('#elara-root')?.shadowRoot?.querySelector('[data-testid=share-preview]')?.naturalWidth > 0, null, { timeout: 30_000 })
  await shot('share', sp); await sp.keyboard.press('Escape'); await sp.keyboard.press('Escape')
})
await step('crew', async () => {
  await sp.goto(BASE + '/'); await w('elara-launcher', sp).click(); await w('tab-crew', sp).click(); await w('crew-view', sp).waitFor()
  await w('thread-bottom', sp).first().click().catch(() => {}); await imgsLoaded(sp); await shot('crew-desktop', sp)
})
await step('video', async () => {
  await sp.goto(BASE + `/?look=${ID.video}`); await w('viewer', sp).waitFor()
  const play = w('viewer', sp).getByRole('button', { name: 'See it move' }); if (await play.isEnabled()) await play.click()
  await w('viewer-video', sp).waitFor({ timeout: 15_000 }); await pause(2200); await shot('video', sp)
})
await step('merchant', async () => { await sp.goto(BASE + '/merchant'); await sp.waitForLoadState('networkidle'); await shot('merchant', sp) })
await step('renders', async () => { await sp.goto(BASE + '/admin/renders'); await sp.waitForLoadState('networkidle'); await shot('admin-renders', sp) })

// Gift chat + cart
const gift = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, storageState: await desk.storageState() })
await withSid(gift, ID.gift)
const gp = await gift.newPage()
await step('gift', async () => {
  await gp.goto(BASE + '/'); await w('elara-launcher', gp).click(); await w('look-card', gp).first().waitFor({ timeout: 20_000 })
  await w('user-msg', gp).last().scrollIntoViewIfNeeded(); await imgsLoaded(gp); await shot('gift-chat', gp)
  await w('look-card', gp).first().scrollIntoViewIfNeeded(); await imgsLoaded(gp); await shot('gift-look', gp)
  await w('look-card', gp).first().getByTestId('add-look').click(); await gp.getByTestId('cart-drawer').waitFor(); await imgsLoaded(gp); await shot('cart', gp)
})

// Phone: the crew on mobile
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, storageState: await desk.storageState() })
await withSid(phone, ID.chat)
const pp = await phone.newPage()
await step('phone', async () => {
  await pp.goto(BASE + '/'); await w('elara-launcher', pp).click(); await w('tab-crew', pp).click(); await w('crew-view', pp).waitFor()
  await imgsLoaded(pp); await shot('crew-phone', pp)
  await w('tab-chat', pp).click(); await w('look-card', pp).first().scrollIntoViewIfNeeded(); await imgsLoaded(pp); await shot('chat-phone', pp)
})

// Onboarding: a fresh account to the vibe swipe (renders are cache hits on the same photo + pieces)
const onb = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const op = await onb.newPage()
await step('onboarding', async () => {
  await op.goto(BASE + '/tryon/login'); await w('auth-switch', op).click()
  await w('auth-name', op).fill('Mira'); await w('auth-email', op).fill(`mira.shots.${Date.now()}@example.com`); await w('auth-password', op).fill('drape-demo-26')
  await w('auth-submit', op).click(); await w('onb-goal', op).waitFor()
  const next = () => w('onb-continue', op).click()
  await w('goal-mindful', op).click(); await shot('onb-goal', op); await next()
  await w('gender-women', op).click(); await next()
  await w('onb-photos-intro', op).waitFor(); await next()
  await w('photo-selfie-input', op).setInputFiles('../data/models/w1.jpg'); await w('photo-body-input', op).setInputFiles('../data/models/w1.jpg')
  await op.locator('[data-testid=photo-body] img').waitFor({ timeout: 60_000 }); await op.locator('[data-testid=photo-selfie] img').waitFor({ timeout: 60_000 })
  await shot('onb-photos', op); await next(); await pause(400); await next()
  await w('size-tops', op).selectOption('S').catch(() => {}); await next(); await w('onb-skip', op).click(); await pause(400); await next()
  await w('onb-colors', op).waitFor(); await op.locator('[data-testid^=shade-]').first().waitFor({ timeout: 60_000 }); await shot('onb-colors', op); await next()
  await op.waitForFunction(() => /(\d+) of \1 looks ready/.test(document.querySelector('[data-testid=vibes-progress]')?.textContent ?? ''), null, { timeout: 120_000, polling: 500 })
  await imgsLoaded(op); await shot('onb-vibes', op)
  await w('vibe-love', op).click(); await pause(500); await shot('onb-vibes-2', op)
})

await browser.close()
