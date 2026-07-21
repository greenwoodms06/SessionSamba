import { chromium } from 'playwright'
const B = 'http://localhost:5173/SessionSamba/'
const browser = await chromium.launch()

// --- phone, picker ---
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
await phone.goto(B, { waitUntil: 'networkidle' })
await phone.waitForSelector('.session')
await phone.getByRole('tab', { name: /Tuesday/ }).click()
await phone.waitForTimeout(300)
await phone.screenshot({ path: 'e2e/shots/01-picker-phone.png' })

// filters open
await phone.getByRole('button', { name: /^Filters/ }).click()
await phone.waitForTimeout(200)
await phone.screenshot({ path: 'e2e/shots/02-filters-phone.png' })
await phone.getByRole('button', { name: /^Filters/ }).click()

// pick a few overlapping sessions to trigger conflicts
const cards = phone.locator('.session-toggle')
for (const i of [0, 1, 2, 3, 5]) await cards.nth(i).click()
await phone.waitForTimeout(400)
await phone.screenshot({ path: 'e2e/shots/03-picked-conflicts-phone.png' })

// collaborative view
await phone.getByRole('tab', { name: /My day/ }).click()
await phone.waitForTimeout(500)
await phone.screenshot({ path: 'e2e/shots/04-columns-phone.png' })

// --- desktop ---
const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await desk.goto(B, { waitUntil: 'networkidle' })
await desk.waitForSelector('.session')
await desk.getByRole('tab', { name: /Tuesday/ }).click()
await desk.waitForTimeout(300)
await desk.screenshot({ path: 'e2e/shots/05-picker-desktop.png' })

await browser.close()
console.log('screenshots written')
