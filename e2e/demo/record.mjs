// Records the demo video against the running dev stack (store :5173 → live backend :8000; real Claude + YouCam).
// Frames + speed marks land in e2e/var/demo/; cut.py turns them into the mp4. Run from e2e/: node demo/record.mjs
// ponytail: one linear script, no retries; a failed step leaves a screenshot in var/demo/fail.png.
import { chromium } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const BASE = process.env.DEMO_BASE ?? 'http://localhost:5173'
const OUT = 'var/demo'
rmSync(OUT, { recursive: true, force: true })
mkdirSync(`${OUT}/f`, { recursive: true })

const frames = [] // { f, t, tag }
const marks = [] // { t, speed }
let active = 'main'
let n = 0
const sink = (tag) => ({ data }) => {
  if (active !== tag) return
  const f = `f/${String(n++).padStart(6, '0')}.jpg`
  writeFileSync(`${OUT}/${f}`, data)
  frames.push({ f, t: Date.now(), tag })
}
const speed = (s) => marks.push({ t: Date.now(), speed: s })
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 })
const page = await ctx.newPage()
const w = (id, p = page) => p.getByTestId(id)

const capOff = new Map()
const uncap = async (p = page) => { await capOff.get(p)?.[Symbol.asyncDispose]?.(); capOff.delete(p) }
/** A caption card: in the store's left gutter on desktop, across the top on the friend's phone. */
async function cap(title, sub = '', p = page) {
  await capOff.get(p)?.[Symbol.asyncDispose]?.()
  const phone = p !== page
  const pos = phone ? 'left:10px;right:10px;top:10px' : 'left:22px;bottom:34px;width:270px'
  capOff.set(p, await p.screencast.showOverlay(`
    <div style="position:fixed;${pos};padding:13px 16px;border-radius:14px;background:rgba(20,18,16,.9);color:#fff;font:600 ${phone ? 15 : 17}px/1.3 -apple-system,Inter,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.28)">
      ${title}${sub ? `<div style="margin-top:6px;font:400 12px/1.45 ui-monospace,Menlo,monospace;color:#d8cfc2">${sub}</div>` : ''}
    </div>`))
}
/** Full-screen title card. */
async function card(title, sub, ms) {
  const d = await page.screencast.showOverlay(`
    <div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#141210;color:#f4efe8;font-family:-apple-system,Inter,sans-serif;text-align:center">
      <div style="font:600 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.3em;color:#c1784a">YOUCAM ECOMMERCE VTO HACKATHON</div>
      <div style="margin-top:22px;font:600 64px/1.05 -apple-system,Inter,sans-serif;letter-spacing:-.02em">${title}</div>
      <div style="margin-top:18px;max-width:760px;font:400 22px/1.45 -apple-system,Inter,sans-serif;color:#bdb4a8">${sub}</div>
    </div>`)
  if (marks.at(-1)?.speed === 0) speed(1) // the opening cut ends once the card is up
  await pause(ms)
  await d[Symbol.asyncDispose]()
}
const actions = { cursor: 'pointer', duration: 450, style: { title: 'display:none', point: 'width:26px;height:26px;border-radius:50%;background:rgba(193,120,74,.35);border:2px solid rgba(193,120,74,.9)' } }

async function type(loc, text) {
  await loc.click()
  await loc.pressSequentially(text, { delay: 28 })
}

/** Answer the question card (if any) until looks arrive. */
async function untilLooks(prefer) {
  const looks = page.locator('[data-testid=look-card], [data-testid=grid-card]')
  for (let i = 0; i < 3; i++) {
    await looks.first().or(w('clarify-card')).waitFor({ timeout: 120_000 })
    if (await looks.count()) return
    speed(1.3)
    await pause(900)
    const opts = w('clarify-option')
    const m = opts.filter({ hasText: prefer })
    await ((await m.count()) ? m.first() : opts.first()).click()
    speed(5)
    await pause(800)
  }
  await looks.first().waitFor({ timeout: 120_000 })
}

async function rendersSettle(timeout = 180_000) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#elara-root')?.shadowRoot
    const els = [...(root?.querySelectorAll('[data-testid=look-card] [data-render-status]') ?? [])]
    return els.length > 0 && els.every((e) => ['ready', 'failed'].includes(e.getAttribute('data-render-status')))
  }, null, { timeout, polling: 500 })
}

try {
  await page.screencast.start({ onFrame: sink('main'), size: { width: 1920, height: 1080 }, quality: 88 })
  await page.screencast.showActions(actions)

  // 1 · TRYON by Drape: sign up → onboarding → Style DNA (frames before the title card are cut)
  speed(0)
  await page.goto(BASE + '/tryon')
  await w('auth-switch').waitFor()
  await card('Drape', 'An AI stylist for any fashion store. It learns your taste once, builds outfits from each store’s catalogue and shows them on you with YouCam virtual try-on.', 3600)
  await cap('Shoppers start with one style profile', 'TRYON by Drape · it follows them to every store')
  await w('auth-switch').click()
  await pause(300)
  await type(w('auth-name'), 'Mira')
  await type(w('auth-email'), `mira.${Date.now()}@example.com`)
  await type(w('auth-password'), 'drape-demo-26')
  await w('auth-submit').click()
  await w('onb-goal').waitFor()
  await cap('Onboarding', 'goal · who you shop for · photos · fit · taste')
  await pause(700)
  const next = async (ms = 500) => { await w('onb-continue').click(); await pause(ms) }
  await w('goal-mindful').click(); await pause(400); await next()
  await w('gender-women').click(); await pause(300)
  await w('profession').selectOption({ index: 1 }).catch(() => {})
  await w('age').selectOption({ index: 2 }).catch(() => {})
  await pause(400); await next()
  await w('onb-photos-intro').waitFor(); await pause(1400); await next()
  await cap('A selfie and a full-body photo', 'selfie → colour analysis (Claude vision) · body → try-on source')
  await w('photo-selfie-input').setInputFiles('../data/models/w1.jpg')
  await pause(300)
  await w('photo-body-input').setInputFiles('../data/models/w1.jpg')
  speed(3)
  await page.locator('[data-testid=photo-body] img').waitFor({ timeout: 60_000 })
  await page.locator('[data-testid=photo-selfie] img').waitFor({ timeout: 60_000 })
  speed(1.2)
  await pause(1200); await next()
  await pause(1200); await next() // fit breather
  await cap('Fit', 'sizes for every category')
  await w('size-tops').selectOption('S').catch(() => {})
  await w('size-bottoms').selectOption('S').catch(() => {})
  await pause(700); await next()
  await w('onb-skip').click(); await pause(500) // height/weight
  await pause(1200); await next() // taste breather
  await w('onb-colors').waitFor()
  await cap('Colours that suit you', 'read from the selfie · tap to adjust')
  speed(3)
  await page.locator('[data-testid^=shade-]').first().waitFor({ timeout: 60_000 })
  speed(1.2)
  await pause(1600)
  await next(800)

  await cap('Swipe on 8 looks, worn by you', 'YouCam AI Clothes VTO · 8 renders in parallel on the body photo')
  speed(6)
  await page.waitForFunction(() => /(\d+) of \1 looks ready/.test(document.querySelector('[data-testid=vibes-progress]')?.textContent ?? ''), null, { timeout: 180_000, polling: 500 }).catch(() => {})
  speed(1.2)
  await pause(900)
  for (const v of ['love', 'like', 'dislike', 'love', 'dislike', 'like', 'love', 'dislike']) {
    if (!(await w('vibe-card').count())) break
    await w(`vibe-${v}`).click()
    await pause(750)
  }
  await pause(500); await next()
  await cap('A never-list', 'the stylist will not show these')
  await w('never-pattern:animal').click().catch(() => {}); await pause(300)
  await page.locator('[data-testid^=never-]').nth(3).click().catch(() => {}); await pause(600)
  await next()
  await pause(900)
  await w('onb-continue').click() // Build my Style DNA
  speed(3)
  await w('dna-page').waitFor({ timeout: 60_000 })
  speed(1.2)
  await cap('Your Style DNA', 'a taste graph: vibes, colours, fit and every pick, kept as nodes and edges')
  await pause(2600)
  await page.mouse.move(900, 500)
  await page.mouse.wheel(0, 500); await pause(1300)
  await page.mouse.wheel(0, -500); await pause(500)
  await w('dna-tab-map').click()
  await cap('The taste map', 'every signal the stylist uses, and where it came from')
  await pause(1500)
  const node = w('dna-node').nth(2)
  if (await node.count()) { await node.click().catch(() => {}); await pause(1800) }
  await w('dna-tab-play').click()
  await cap('Style Play', 'quick A/B picks keep sharpening it')
  await pause(900)
  for (const k of ['a', 'b', 'a']) { await w(`play-${k}`).click().catch(() => {}); await pause(900) }

  await w('nav-daily').click()
  await cap('Daily Picks', 'three outfits a day from your DNA')
  speed(4)
  await w('pick-card').nth(2).waitFor({ timeout: 90_000 })
  speed(1.2)
  await pause(1800)
  await w('pick-card').first().getByTestId('pick-like').click().catch(() => {})
  await pause(900)

  await w('nav-wardrobe').click()
  await w('wardrobe-add').click()
  await cap('Your own wardrobe', 'one photo → every piece recognised and tagged (Claude vision)')
  await w('wardrobe-input').setInputFiles('demo/assets/my-pants.jpg')
  speed(5)
  await w('wardrobe-item').first().waitFor({ timeout: 90_000 })
  speed(1.2)
  await page.keyboard.press('Escape').catch(() => {})
  await pause(2000)

  // 2 · The store: the same profile, now inside any shop
  await uncap()
  await w('nav-store').click()
  await page.waitForLoadState('networkidle')
  await cap('Now Mira shops at Northline', 'a demo store · Drape is one &lt;script&gt; tag')
  await page.mouse.move(900, 500)
  await page.mouse.wheel(0, 650); await pause(1000)
  await page.mouse.wheel(0, -650); await pause(500)

  // 3 · Chat → looks
  await w('elara-launcher').click()
  await w('chat').waitFor()
  await cap('Describe the occasion', 'Claude agent · it already knows her DNA, sizes and photo')
  await pause(700)
  await type(w('composer-input'), 'Goa trip next week with friends, something breezy, budget around ₹7,000')
  await w('composer-send').click()
  speed(5)
  await untilLooks(/women/i)
  speed(1.2)
  await cap('Complete outfits, within budget', 'search → compose → score · prices, images and scores come from code, never the model')
  await pause(2200)

  // 3 · On a model: YouCam renders
  const strip = w('see-on-you')
  if (await strip.isVisible().catch(() => false)) {
    await strip.scrollIntoViewIfNeeded()
    await pause(500)
    await w('see-model-w1').click()
  }
  await cap('Every look renders on her own photo', 'YouCam AI Clothes VTO · lower_body, then upper_body on that result')
  speed(6)
  await rendersSettle()
  speed(1.2)
  const list = page.locator('[data-testid=look-card]')
  await list.first().scrollIntoViewIfNeeded()
  await pause(2000)
  for (let i = 1; i < await list.count(); i++) { await list.nth(i).scrollIntoViewIfNeeded(); await pause(1300) }
  await page.screenshot({ path: `${OUT}/s-looks.png` })

  // 4 · Viewer + swap
  const sep = list.filter({ has: page.getByTestId('swap-bottom') }).first()
  const target = (await sep.count()) ? sep : list.first()
  await target.scrollIntoViewIfNeeded()
  await pause(400)
  await target.getByTestId('open-viewer').click()
  await w('viewer').waitFor()
  await cap('Before and after')
  const h = w('ba-handle')
  if (await h.count()) {
    const b = await h.boundingBox()
    const y = b.y + b.height / 2
    await page.mouse.move(b.x + b.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(b.x - 130, y, { steps: 16 })
    await page.mouse.move(b.x + 150, y, { steps: 20 })
    await page.mouse.move(b.x + b.width / 2, y, { steps: 10 })
    await page.mouse.up()
  }
  await pause(500)
  if (await w('hotspot-bottom').count()) {
    await w('hotspot-bottom').click()
    await w('swap-drawer').waitFor()
    await cap('Swap just one piece', 'compatibility score: deterministic code (colour, formality, occasion, budget)')
    await pause(2400)
    const mine = w('swap-tile-owned')
    if (await w('swap-mode-mine').count()) {
      await w('swap-mode-mine').click()
      await pause(900)
      if (await mine.count()) await cap('…or with a piece she already owns', 'from her TRYON wardrobe · owned pieces cost ₹0 in the total')
      else await w('swap-mode-new').click().catch(() => {})
      await pause(1800)
    }
    await ((await mine.count()) ? mine.first() : w('swap-tile').nth(1)).click()
    await cap('Only that piece re-renders', 'one YouCam call · lower_body on the current render')
    speed(6)
    await w('swap-shimmer').waitFor({ timeout: 15_000 }).catch(() => {})
    await w('swap-shimmer').waitFor({ state: 'detached', timeout: 150_000 })
    speed(1.2)
    await pause(2200)
    await page.screenshot({ path: `${OUT}/s-swap.png` })
  }

  // 5 · Style Crew: share, a friend joins on her phone
  await w('viewer').getByRole('button', { name: 'Share with Crew' }).click()
  await w('share-sheet').waitFor()
  await cap('Share with your Style Crew', 'a share card + a link · WhatsApp or copy')
  await page.waitForFunction(() => {
    const img = document.querySelector('#elara-root')?.shadowRoot?.querySelector('[data-testid=share-preview]')
    return img && img.naturalWidth > 0
  }, null, { timeout: 30_000 }).catch(() => {})
  await pause(2400)
  const link = (await w('share-link').innerText()).trim()

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const phone = await phoneCtx.newPage()
  await phone.screencast.start({ onFrame: sink('phone'), size: { width: 500, height: 1080 }, quality: 88 })
  await phone.screencast.showActions(actions)
  await phone.goto(link.startsWith('http') ? link : `${BASE}/?crew=${link.split('crew=')[1]}`)
  await w('crew-join', phone).waitFor({ timeout: 30_000 })
  active = 'phone'
  speed(1.2)
  await cap('Meera opens the link on her phone', '', phone)
  await pause(900)
  await type(w('crew-name-input', phone), 'Meera')
  await w('crew-join-btn', phone).click()
  await w('crew-view', phone).waitFor()
  await cap('She votes piece by piece', 'per-item threads', phone)
  await pause(1200)
  const up = phone.locator('[data-testid=react-up-top], [data-testid=react-up-one_piece]').first()
  if (await up.count()) { await up.scrollIntoViewIfNeeded(); await up.click(); await pause(700) }
  if (await w('thread-bottom', phone).count()) {
    await w('thread-bottom', phone).scrollIntoViewIfNeeded()
    await w('thread-bottom', phone).click()
    await type(w('reply-bottom', phone), 'the trousers are a yes')
    await w('reply-bottom', phone).press('Enter')
    await w('thread-body-bottom', phone).getByText('the trousers are a yes').waitFor()
  }
  await pause(1500)

  // back on the desktop: the owner sees it
  await page.keyboard.press('Escape')
  await pause(300)
  active = 'main'
  await page.keyboard.press('Escape')
  await pause(400)
  if ((await w('elara-panel').getAttribute('aria-hidden')) === 'true') await w('elara-launcher').click()
  await w('tab-crew').click()
  await w('crew-view').waitFor()
  await cap('Back on desktop: the crew’s verdict', 'votes + comments land live')
  await pause(1200)
  if (await w('thread-bottom').count()) {
    await w('thread-bottom').scrollIntoViewIfNeeded()
    await w('thread-bottom').click()
  }
  await pause(2600)
  await phoneCtx.close()

  // 6 · Gifting: another person, no gender question
  await w('tab-chat').click()
  await w('new-chat').click()
  await w('composer-input').waitFor()
  await cap('Shopping for someone else', 'the agent infers who it is for · at most one question per turn')
  await type(w('composer-input'), 'College farewell outfit for my brother, he’s 20')
  await w('composer-send').click()
  speed(5)
  await untilLooks(/\bmen/i)
  speed(1.2)
  await pause(1600)
  const strip2 = w('see-on-you')
  if (await strip2.isVisible().catch(() => false)) {
    await strip2.scrollIntoViewIfNeeded()
    await pause(500)
    await page.locator('[data-testid^=see-model-m]').first().click()
  }
  await cap('Men’s looks render on a men’s model', 'never on the other gender')
  speed(6)
  await rendersSettle()
  speed(1.2)
  await list.first().scrollIntoViewIfNeeded()
  await pause(2200)
  await page.screenshot({ path: `${OUT}/s-gift.png` })

  // 7 · Cart
  await list.first().getByTestId('add-look').click()
  await page.getByTestId('cart-drawer').waitFor()
  await cap('One tap: every piece in the store’s own cart')
  await pause(2800)
  await page.keyboard.press('Escape')

  // 8 · See it move (a clip made earlier: image-to-video takes 5–8 minutes)
  await uncap()
  await page.goto(BASE + '/?look=lk_olps538fd6')
  await w('viewer').waitFor({ timeout: 20_000 })
  await cap('See it move', 'YouCam AI Image-to-Video · 5 s clip of a finished look')
  await pause(800)
  const play = page.getByRole('button', { name: 'See it move' })
  if (await play.isEnabled().catch(() => false)) await play.click()
  await w('viewer-video').waitFor({ timeout: 15_000 }).catch(() => {})
  await pause(5200)

  // 9 · Merchant + close
  await uncap()
  await page.goto(BASE + '/merchant')
  await page.waitForLoadState('networkidle')
  await cap('For merchants', 'one script tag + a product feed')
  await pause(1600)
  await page.mouse.move(900, 500)
  await page.mouse.wheel(0, 600); await pause(1600)
  await card('Drape', 'One script tag. Any catalogue. Outfits styled by Claude, worn on you by YouCam.', 3400)
} catch (err) {
  console.error(err)
  await page.screenshot({ path: `${OUT}/fail.png` }).catch(() => {})
} finally {
  speed(1)
  await page.screencast.stop().catch(() => {})
  writeFileSync(`${OUT}/frames.json`, JSON.stringify({ frames, marks }))
  await browser.close()
  console.log(`${frames.length} frames, ${marks.length} marks`)
}
