/**
 * End-to-end tests against a real browser.
 *
 * These cover the surface unit tests cannot reach: IndexedDB persistence across
 * reloads, the file download paths, the share round trip through a real file
 * picker, and offline behaviour via the service worker.
 *
 * Starts its own preview server on a free port, so `node e2e/run.mjs` is
 * self-contained.
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 4321
const APP = `http://localhost:${PORT}/SessionSamba/`

const results = []
let failures = 0

async function check(name, fn) {
  try {
    await fn()
    results.push(`  PASS  ${name}`)
  } catch (error) {
    failures++
    results.push(`  FAIL  ${name}\n          ${error.message.split('\n')[0]}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// ---- server ---------------------------------------------------------------
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', detached: true,
})

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(APP)
      if (res.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('preview server did not start')
}

function shutdown() {
  try { process.kill(-server.pid) } catch { /* already gone */ }
}

// ---- run ------------------------------------------------------------------
let browser
try {
  await waitForServer()
  browser = await chromium.launch()

  const sessions = JSON.parse(readFileSync(new URL('../public/data/siggraph-2026/sessions.json', import.meta.url)))

  // --------------------------------------------------------------------
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForSelector('.session')

  await check('loads the schedule with no console errors', () => {
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`)
  })

  await check('renders every day tab from config', async () => {
    const tabs = await page.locator('.day-tabs button').count()
    assert(tabs === 5, `expected 5 day tabs, got ${tabs}`)
  })

  await check('Tuesday shows all 123 sessions', async () => {
    await page.getByRole('tab', { name: /Tuesday/ }).click()
    await page.waitForTimeout(200)
    const text = await page.locator('.result-count').innerText()
    assert(text.includes('123 of 123'), `got "${text}"`)
  })

  await check('search narrows the list', async () => {
    await page.getByRole('searchbox').fill('gaussian')
    await page.waitForTimeout(250)
    const count = await page.locator('.session').count()
    assert(count > 0 && count < 123, `expected a narrowed list, got ${count}`)
    await page.getByRole('searchbox').fill('')
    await page.waitForTimeout(200)
  })

  await check('Browse view-model: List/Timeline x Everything/By track', async () => {
    // Timeline axis reuses the shared column-timeline.
    await page.getByRole('tab', { name: /Timeline/ }).click()
    await page.waitForTimeout(300)
    assert(await page.locator('.timeline-inner .block').count() > 0, 'no timeline blocks')
    // Group by track -> one column per track.
    await page.getByLabel('Group by').selectOption('track')
    await page.waitForTimeout(300)
    const cols = await page.locator('.tl-col-head .label').allInnerTexts()
    assert(cols.length > 1, `expected multiple track columns, got ${cols.length}`)
    // List + By room -> horizontal facet columns of mini cards.
    await page.getByRole('tab', { name: /List/ }).click()
    await page.getByLabel('Group by').selectOption('room')
    await page.waitForTimeout(300)
    assert(await page.locator('.facet-col').count() > 1, 'no room facet columns')
    // Back to List / Everything.
    await page.getByLabel('Group by').selectOption('all')
    await page.waitForTimeout(200)
    assert(await page.locator('.session-list').count() === 1, 'did not return to list')
  })

  await check('tapping a title opens the detail sheet with the session page link', async () => {
    await page.locator('.session-title').first().click()
    await page.waitForSelector('.sheet[aria-label]')
    const sheet = await page.locator('.sheet').innerText()
    assert(/Add to my day|Remove from my day/.test(sheet), 'detail actions missing')
    const link = page.locator('.sheet a', { hasText: 'Session page' })
    if (await link.count()) {
      assert((await link.getAttribute('href'))?.startsWith('https://'), 'session link not absolute')
      assert((await link.getAttribute('rel'))?.includes('noopener'), 'session link missing noopener')
    }
    await page.locator('.scrim').click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(200)
  })

  await check('theme: Dark applies dark tokens and persists', async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.waitForSelector('.sheet')
    await page.getByRole('button', { name: 'dark', exact: true }).click()
    await page.waitForTimeout(200)
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    assert(attr === 'dark', `data-theme was ${attr}`)
    const page_bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    // dark --page is #0d1016 -> rgb(13, 16, 22)
    assert(page_bg === 'rgb(13, 16, 22)', `dark page bg was ${page_bg}`)
    const stored = await page.evaluate(() => localStorage.getItem('ss:theme'))
    assert(stored === 'dark', `theme not persisted (${stored})`)
    // restore
    await page.getByRole('button', { name: 'system', exact: true }).click()
    await page.locator('.scrim').click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(200)
  })

  await check('track filter cycles include -> exclude -> clear (in the Filters sheet)', async () => {
    await page.getByRole('button', { name: /^Filters/ }).click()
    await page.waitForSelector('.sheet .filter-chip')
    const chip = page.locator('.sheet .filter-chip').first()
    await chip.click()
    assert(await chip.evaluate((el) => el.classList.contains('is-include')), 'not included')
    await chip.click()
    assert(await chip.evaluate((el) => el.classList.contains('is-exclude')), 'not excluded')
    await chip.click()
    assert(
      await chip.evaluate((el) => !el.classList.contains('is-include') && !el.classList.contains('is-exclude')),
      'not cleared',
    )
    await page.locator('.scrim').click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(200)
  })

  // ---- the big one: does a pick actually survive a reload? --------------
  let pickedTitle
  await check('a pick persists across a full page reload (IndexedDB)', async () => {
    const card = page.locator('.session').first()
    pickedTitle = await card.locator('.session-title').innerText()
    await card.locator('.session-toggle').click()
    await page.waitForTimeout(400)
    assert((await page.locator('.app-header-sub').innerText()).includes('1 picked'), 'not selected')

    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.session')
    await page.waitForTimeout(600)
    const header = await page.locator('.app-header-sub').innerText()
    assert(header.includes('1 picked'), `after reload header was "${header}"`)
  })

  await check('the journal is really in IndexedDB, not just memory', async () => {
    const stored = await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('sessionsamba')
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('journals', 'readonly')
        const get = tx.objectStore('journals').get('siggraph-2026')
        get.onsuccess = () => resolve(get.result)
        get.onerror = () => reject(get.error)
      }
      req.onerror = () => reject(req.error)
    }))
    assert(stored, 'no journal record found')
    assert(stored.picks.length === 1, `expected 1 pick, got ${stored.picks?.length}`)
    assert(stored.picks[0].snapshot?.title, 'pick has no snapshot — change detection would not work')
    assert(stored.sender?.id, 'no stable sender id minted')
  })

  await check('conflicting picks are flagged in the header and on the card', async () => {
    await page.getByRole('tab', { name: /Tuesday/ }).click()
    await page.waitForTimeout(200)
    const toggles = page.locator('.session-toggle')
    for (const i of [1, 2, 3]) await toggles.nth(i).click()
    await page.waitForTimeout(400)
    const header = await page.locator('.app-header-sub').innerText()
    assert(/in overlap/.test(header), `header was "${header}"`)
    assert(await page.locator('.session.is-conflicted').count() > 0, 'no conflicted card')
  })

  // ---- exports ---------------------------------------------------------
  let icsText
  await check('.ics export downloads a valid calendar with stable UIDs', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export .ics' }).click(),
    ])
    const path = await download.path()
    icsText = readFileSync(path, 'utf8')
    assert(icsText.startsWith('BEGIN:VCALENDAR'), 'not a VCALENDAR')
    assert(icsText.trimEnd().endsWith('END:VCALENDAR'), 'unterminated VCALENDAR')
    const uids = [...icsText.replace(/\r\n[ \t]/g, '').matchAll(/UID:(.+)\r\n/g)].map((m) => m[1])
    assert(uids.length === 4, `expected 4 events, got ${uids.length}`)
    assert(new Set(uids).size === uids.length, 'duplicate UIDs would duplicate calendar events')
    assert(uids.every((u) => u.endsWith('@siggraph-2026')), 'UID missing conference scope')
    assert(/DTSTART:\d{8}T\d{6}Z/.test(icsText), 'DTSTART is not a UTC instant')
  })

  let shareFile
  await check('share export contains bare ids and no schedule copy', async () => {
    await page.getByRole('tab', { name: /My day/ }).click()
    await page.waitForTimeout(300)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Share mine', exact: true }).click(),
    ])
    shareFile = JSON.parse(readFileSync(await download.path(), 'utf8'))
    assert(shareFile.picks.length === 4, `expected 4 picks, got ${shareFile.picks.length}`)
    assert(shareFile.conferenceId === 'siggraph-2026', 'wrong conferenceId')
    assert(shareFile.dataVersion, 'no dataVersion — staleness could not be detected')
    assert(shareFile.sender?.id, 'no sender id — re-import could not auto-match')
    assert(!shareFile.annotations, 'annotations must be opt-in')
    const raw = JSON.stringify(shareFile)
    assert(!raw.includes(pickedTitle), 'share file must not carry session titles')
  })

  // ---- the share round trip, through a real file picker ----------------
  await check('importing a colleague file adds a column that renders their picks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-'))
    const file = join(dir, 'alex-picks.json')
    // A different person, with two picks that exist plus one that doesn't.
    const theirs = sessions.filter((s) => s.day === '2026-07-21').slice(40, 42).map((s) => s.id)
    writeFileSync(file, JSON.stringify({
      ...shareFile,
      sender: { id: 'alex-uuid-1234', name: 'Alex' },
      picks: [...theirs, 'a-session-that-was-cancelled'],
    }))

    const fresh = await context.newPage()
    await fresh.goto(APP, { waitUntil: 'networkidle' })
    await fresh.waitForSelector('.session')
    await fresh.getByRole('tab', { name: /My day/ }).click()
    await fresh.waitForTimeout(300)
    await fresh.getByRole('tab', { name: /Tuesday/ }).click()
    await fresh.waitForTimeout(200)
    await fresh.locator('input[type=file]').setInputFiles(file)
    await fresh.waitForSelector('.dialog')

    const dialog = await fresh.locator('.dialog').innerText()
    assert(dialog.includes('Alex'), 'sender name not shown')
    assert(/no longer in the schedule/i.test(dialog), 'unresolvable pick not surfaced before import')

    await fresh.getByRole('button', { name: 'Import', exact: true }).click()
    await fresh.waitForTimeout(500)

    const names = await fresh.locator('.tl-col-head .label').allInnerTexts()
    assert(names.includes('Alex'), `columns were ${JSON.stringify(names)}`)
    assert(names[0] !== 'Alex', 'my column must stay leftmost as the anchor')
    // A day holding picks must advertise it, or the view reads as empty.
    assert(await fresh.locator('.day-tabs .day-count').count() > 0, 'no day counts shown')

    // Their resolvable picks render on the timeline...
    const body = await fresh.locator('.timeline-inner').innerText()
    for (const id of theirs) {
      const title = sessions.find((s) => s.id === id).title
      assert(body.includes(title.slice(0, 20)), `missing "${title}"`)
    }
    // ...the cancelled one becomes a ghost, listed (never dropped) below.
    const whole = await fresh.locator('.app').innerText()
    assert(/no longer in the schedule/i.test(whole), 'cancelled pick silently vanished')
    assert(whole.includes('a-session-that-was-cancelled'), 'ghost id not shown')
    await fresh.close()
  })

  await check('imported columns survive a reload too', async () => {
    const fresh = await context.newPage()
    await fresh.goto(APP, { waitUntil: 'networkidle' })
    await fresh.waitForSelector('.session')
    await fresh.getByRole('tab', { name: /My day/ }).click()
    await fresh.waitForTimeout(300)
    await fresh.getByRole('tab', { name: /Tuesday/ }).click()
    await fresh.waitForTimeout(500)
    const names = await fresh.locator('.tl-col-head .label').allInnerTexts()
    assert(names.includes('Alex'), `columns after reload: ${JSON.stringify(names)}`)
    await fresh.close()
  })

  // ---- backup round trip: a fresh device picks up where this one left off
  await check('a backup file restores picks on a fresh device', async () => {
    const myHeader = await page.locator('.app-header-sub').innerText()
    const picked = myHeader.match(/(\d+) picked/)?.[1]
    assert(Number(picked) > 0, `expected existing picks, header was "${myHeader}"`)

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.waitForSelector('.sheet')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Back up now' }).click(),
    ])
    const backupPath = await download.path()
    await page.locator('.scrim').click({ position: { x: 5, y: 5 } })
    await page.waitForSelector('.sheet', { state: 'detached' })

    // A brand-new browser context is a stand-in for a replacement phone.
    const device2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const p2 = await device2.newPage()
    await p2.goto(APP, { waitUntil: 'networkidle' })
    await p2.waitForSelector('.session')
    assert((await p2.locator('.app-header-sub').innerText()).includes('0 picked'),
      'fresh device should start empty')

    await p2.getByRole('button', { name: 'Settings' }).click()
    await p2.waitForSelector('.sheet')
    await p2.locator('.sheet input[type=file]').setInputFiles(backupPath)
    await p2.waitForSelector('.toast')
    await p2.waitForTimeout(400)
    const header = await p2.locator('.app-header-sub').innerText()
    assert(header.includes(`${picked} picked`), `after restore header was "${header}"`)
    await device2.close()
  })

  // ---- badge tier: warn, never block (SPEC §9.1) -----------------------
  await check('an out-of-tier session warns on add but is never hidden or blocked', async () => {
    await page.getByRole('tab', { name: 'Browse' }).click()
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.waitForSelector('.sheet')
    const dBtn = page.locator('.sheet .tier-btn').filter({ hasText: /^D$/ })
    await dBtn.click()   // Discover — most limited
    assert(await dBtn.getAttribute('aria-pressed') === 'true', 'tier D did not register')
    await page.locator('.scrim').click({ position: { x: 5, y: 5 } })
    await page.waitForSelector('.sheet', { state: 'detached' })

    // Sessions are never hidden by tier.
    const total = await page.locator('.session').count()
    assert(total === 123, `sessions must stay visible; got ${total}`)

    // Adding a session the badge can't attend (access lacks 'D') warns, then proceeds.
    const idx = await page.locator('.session').evaluateAll((nodes) =>
      nodes.findIndex((n) => {
        const a = n.querySelector('.access')
        return a && !a.textContent.includes('D') && !n.classList.contains('is-picked')
      }))
    assert(idx >= 0, 'expected an unpicked Discover-restricted session on Tuesday')
    await page.locator('.session').nth(idx).locator('.session-toggle').click()
    await page.waitForSelector('.dialog', { timeout: 5000 })
    const warn = await page.locator('.dialog').innerText()
    assert(/badge/i.test(warn), 'tier warning not shown')
    await page.getByRole('button', { name: 'Add anyway' }).click()
    await page.waitForTimeout(300)
  })

  // ---- conference switcher + add ---------------------------------------
  await check('the conference switcher lists the active conference', async () => {
    await page.getByRole('button', { name: 'Switch conference' }).click()
    await page.waitForSelector('.sheet[aria-label="Your conferences"]')
    const sheet = await page.locator('.sheet').innerText()
    assert(/SIGGRAPH 2026/.test(sheet), 'active conference not listed')
    assert(await page.locator('.conf-row.is-active').count() === 1, 'no active row marked')
    await page.locator('.scrim').click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(200)
  })

  await check('adding a conference by file rebinds the whole app (multi-event)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-conf-'))
    const file = join(dir, 'bundle.json')
    writeFileSync(file, JSON.stringify({
      config: {
        schemaVersion: 1, conferenceId: 'test-conf-2026', name: 'Test Conf 2026',
        accent: '#c2570c', dateRange: 'Jan 1', shortLocation: 'Nowhere',
        timezone: 'UTC', days: [{ key: '2026-01-01', label: 'Thu', date: '1' }],
        accessLevels: [], tracks: [],
      },
      sessions: [
        { id: 'tc-1', day: '2026-01-01', start: '09:00', end: '10:00', title: 'Opening Remarks', tracks: ['Talks'], tags: [] },
      ],
    }))

    const fresh = await context.newPage()
    await fresh.goto(APP, { waitUntil: 'networkidle' })
    await fresh.waitForSelector('.session')
    await fresh.getByRole('button', { name: 'Switch conference' }).click()
    await fresh.waitForSelector('.sheet[aria-label="Your conferences"]')
    await fresh.getByText('Add a conference').click()
    await fresh.locator('input[type=file]').setInputFiles(file)
    // App rebinds: title, days, sessions all change to the new conference.
    await fresh.waitForFunction(() => document.querySelector('.app-header h1')?.textContent === 'Test Conf 2026', { timeout: 8000 })
    await fresh.waitForSelector('.session')
    assert(await fresh.locator('.session').count() === 1, 'new conference sessions not loaded')
    assert((await fresh.locator('.result-count').innerText()).includes('1 of 1'), 'wrong session count')

    // And it persists + stays selectable after reload (cached in IndexedDB).
    await fresh.reload({ waitUntil: 'networkidle' })
    await fresh.waitForSelector?.('.session') ?? await fresh.waitForSelector('.session')
    await fresh.waitForTimeout(500)
    assert((await fresh.locator('.app-header h1').innerText()) === 'Test Conf 2026', 'active conference not remembered')
    await fresh.close()
  })

  // ---- offline ---------------------------------------------------------
  await check('works offline via the service worker', async () => {
    const offlinePage = await context.newPage()
    await offlinePage.goto(APP, { waitUntil: 'networkidle' })
    await offlinePage.waitForSelector('.session')
    // Let the service worker take control and finish precaching.
    await offlinePage.evaluate(() => navigator.serviceWorker.ready)
    await offlinePage.waitForTimeout(1500)

    await context.setOffline(true)
    await offlinePage.reload({ waitUntil: 'domcontentloaded' })
    await offlinePage.waitForSelector('.session', { timeout: 15000 })
    const count = await offlinePage.locator('.session').count()
    assert(count > 0, 'no sessions rendered while offline')
    await context.setOffline(false)
    await offlinePage.close()
  })

  await check('no console errors accumulated across the whole run', () => {
    const real = consoleErrors.filter((e) => !/favicon/i.test(e))
    assert(real.length === 0, real.join(' | '))
  })
} catch (error) {
  failures++
  results.push(`  FAIL  harness: ${error.message}`)
} finally {
  await browser?.close()
  shutdown()
}

console.log('\nE2E (real browser)\n')
console.log(results.join('\n'))
console.log(`\n${results.length - failures}/${results.length} passed\n`)
process.exit(failures ? 1 : 0)
