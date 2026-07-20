import { chromium } from 'playwright'
const APP = 'https://greenwoodms06.github.io/MyConferencePlan/'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
const p = await ctx.newPage()
const errs = []
p.on('console', m => m.type() === 'error' && errs.push(m.text()))
p.on('pageerror', e => errs.push(String(e)))

await p.goto(APP, { waitUntil: 'networkidle' })
await p.waitForSelector('.session', { timeout: 20000 })
console.log('header   :', await p.locator('.app-header h1').innerText())
console.log('day tabs :', await p.locator('.day-tabs button').count())
await p.getByRole('tab', { name: /Tuesday/ }).click()
await p.waitForTimeout(400)
console.log('count    :', await p.locator('.result-count').innerText())

// pick, then reload — proves IndexedDB works on the real origin
await p.locator('.session-toggle').first().click()
await p.waitForTimeout(400)
await p.reload({ waitUntil: 'networkidle' })
await p.waitForSelector('.session')
await p.waitForTimeout(600)
console.log('persisted:', await p.locator('.app-header-sub').innerText())

// offline, on the real origin
await p.evaluate(() => navigator.serviceWorker.ready)
await p.waitForTimeout(1500)
await ctx.setOffline(true)
await p.reload({ waitUntil: 'domcontentloaded' })
await p.waitForSelector('.session', { timeout: 20000 })
console.log('offline  :', await p.locator('.session').count(), 'sessions rendered with no network')
await ctx.setOffline(false)

console.log('errors   :', errs.length ? errs : 'none')
await p.screenshot({ path: 'e2e/shots/07-live.png' })
await b.close()
