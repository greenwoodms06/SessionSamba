import { chromium } from 'playwright'
const B='https://greenwoodms06.github.io/MyConferencePlan/'
const b=await chromium.launch()
const p=await b.newPage({viewport:{width:402,height:860}})
const errs=[]; p.on('pageerror',e=>errs.push(String(e)))
await p.goto(B,{waitUntil:'networkidle'}); await p.waitForSelector('.session',{timeout:20000})
// confirm Companion design is live: font + tokens + segmented tabs
const font = await p.evaluate(()=>getComputedStyle(document.body).fontFamily)
const title = await p.title()
await p.getByRole('tab',{name:/Tuesday/}).click(); await p.waitForTimeout(300)
const count = await p.locator('.result-count').innerText()
console.log('title  :', title)
console.log('font   :', font)
console.log('count  :', count)
console.log('errors :', errs.length?errs:'none')
await p.screenshot({path:'e2e/shots/20-live-companion.png'})
await b.close()
