// Two listings for one business is the expensive mistake this form could make.
// Run: npm run test:register-dupe
//
// 968 of the directory came from Google and has never been asked, so most
// businesses reaching /register-provider are already in Pippy and do not know
// it. The page carried a "Already listed? Claim your business" link at the
// bottom, which is read by nobody. This pins the live hint that replaced it —
// and the two things the hint must NOT do, because this page is public and
// signed out:
//
//   · never render an email, even though search_providers() returns the whole
//     row for an approved listing and some rows carry one.
//   · never block the form. A business Google genuinely missed types a name
//     that looks like an existing one and must still be able to submit.
import fs from 'node:fs'
let chromium
try { ({ chromium } = await import('playwright')) }
catch { console.log('skipped — playwright is not installed'); process.exit(0) }
try {
  const probe = await fetch('http://localhost:5173/', { signal: AbortSignal.timeout(2000) })
  if (!probe.ok) throw new Error('bad status')
} catch { console.log('skipped — no dev server on :5173 (npm run dev)'); process.exit(0) }

const EXE = ['/opt/pw-browsers/chromium/chrome-linux/chrome',
             '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p))

// An approved listing that DOES carry a contact email, so "the hint never
// shows one" is tested against a row that has one to leak.
const MATCH = { id: 'pp1', name: 'Pune Pet Park', type: 'Boarder', area: 'Wagholi',
                city: 'Pune', phone: '9876500000', email: 'office@punepetpark.in',
                is_approved: true, services: [], specializations: [] }

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(50)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1200 } })

const searches = []
let posted = null
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/rpc/search_providers*', r => {
  const body = JSON.parse(r.request().postData() || '{}')
  searches.push(body)
  const term = (body.search_term || '').toLowerCase()
  const hit  = term.length >= 4 && MATCH.name.toLowerCase().includes(term.slice(0, 8))
  return r.fulfill({ json: hit ? [{ provider: MATCH, total_count: 1 }] : [] })
})
await ctx.route('**/api/register-provider', r => {
  posted = JSON.parse(r.request().postData()); return r.fulfill({ json: { success: true } })
})

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/register-provider', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }

const body = async () => page.innerText('body')
const name = page.locator('input[name="name"]')

// Below the threshold: no query at all. A hint that fires on "P" would query
// on every keystroke of every name and match half the directory.
await name.fill('Pun')
await page.waitForTimeout(900)
ck('a short name asks nothing', searches.length, 0)
ck('and shows nothing',         (await body()).includes('Claim it instead'), false)

await name.fill('Pune Pet Park')
await page.waitForTimeout(1200)
ck('a real name is looked up',    searches.length > 0, true)
ck('only in the PUBLISHED directory', searches.at(-1)?.approved_only, true)
let t = await body()
ck('the match is offered',        t.includes('Already on Pippy?'), true)
ck('named',                       t.includes('Pune Pet Park'), true)
ck('and placed',                  t.includes('Wagholi'), true)
// The one thing this public page must never print.
ck('but never its email',         t.includes('office@punepetpark.in'), false)
ck('with a way to claim it',
   await page.getByRole('link', { name: 'Claim your business instead' }).count(), 1)
await page.screenshot({ path: '/tmp/pippy-register-dupe.png', fullPage: true })

// Typing on past the match clears it, and the form still submits: a business
// Google missed must not be trapped behind a hint.
await name.fill('Totally New Kennel')
await page.waitForTimeout(1200)
ck('a name with no match clears it', (await body()).includes('Already on Pippy?'), false)
await page.locator('input[name="phone"]').fill('9876500123')
await page.getByRole('button', { name: /Submit|Register/i }).first().click()
await page.waitForTimeout(1200)
ck('and the form still submits', posted?.name, 'Totally New Kennel')

ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\none business, one listing')
process.exit(fails ? 1 : 0)
