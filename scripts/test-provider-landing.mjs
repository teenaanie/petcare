// The signed-out page at /business, in a real browser. Run: npm run test:landing
//
// Two things it pins, and both are things that were wrong on the live site:
//
//   1. There IS a page. /business used to render a bare email box with nothing
//      on it saying what a boarder was signing in to.
//   2. There is NO phone tab. Sending an SMS code needs an SMS provider and
//      none is configured, so the tab offered a way in that could only fail.
//      The pet-parent sign-in has been gated since September; this half was
//      missed, which is why the flag is now shared.
//
// Skips without Playwright or a dev server, same contract as the others.

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

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(52)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })

// Signed out: no session in the provider storage key, and the OTP request
// stubbed so the code-entry step can be reached without sending real mail.
let otpSentTo = null
await ctx.route('**/auth/v1/otp*', r => {
  otpSentTo = JSON.parse(r.request().postData() || '{}')
  return r.fulfill({ json: {} })
})
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
// The public lookup. A business owner should not have to make an account to
// learn whether they already have a listing — that is how the same kennel ends
// up in the directory twice.
let lookedUp = null
await ctx.route('**/rest/v1/rpc/search_providers*', r => {
  lookedUp = JSON.parse(r.request().postData() || '{}')
  return r.fulfill({ json: [{ provider: { id: 'p1', name: 'Paws Retreat Boarding & Day Care',
                                          type: 'Boarder', area: 'Baner', city: 'Pune' } }] })
})

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/business', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }
await page.waitForTimeout(600)

// innerText returns RENDERED text, so anything styled `uppercase` comes back
// shouted. Compare case-insensitively rather than hard-coding the shouting.
const T = (await page.innerText('body')).toUpperCase()
const has = s => T.includes(s.toUpperCase())

ck('it says who it is for',        has('For boarders & groomers'), true)
ck('it leads with a headline',     has('The book by the phone'), true)
ck('the book is described',        has('Your own book'), true)
ck('so is the dashboard',          has('Who is in, who is coming'), true)
ck('so are the stay records',      has('Trial, criteria, and the day log'), true)
ck('so is the inform note',        has('What the owner already told you'), true)
ck('so is writing back',           has('Send a line back'), true)
ck('so is broadcasting',           has('Message your customers'), true)
ck('claiming is explained',        has('How it starts'), true)
// The half of the deal a provider will otherwise think is a missing feature.
ck('and what they CANNOT see',     has('You see what you are sent'), true)
// ── Looking yourself up, signed out ─────────────────────────────────────────
ck('the lookup is offered',  has('Look yourself up'), true)
await page.getByPlaceholder('Your business name').fill('Paws Retreat')
await page.waitForTimeout(900)
ck('it asks the directory',  lookedUp?.search_term, 'Paws Retreat')
// The published directory, not the review queue: "are we listed?" means listed.
ck('and only the published part', lookedUp?.approved_only, true)
const after = (await page.innerText('body')).toUpperCase()
ck('the listing comes back',  after.includes('PAWS RETREAT BOARDING'), true)
ck('with where it is',        after.includes('BANER'), true)
ck('and a way to claim it',   after.includes('CLAIM IT'), true)

ck('a pet parent is sent home',
   await page.getByRole('link', { name: /Go to the Pippy app/ }).count() > 0, true)

// The sign-in itself still works, and is the only way in offered.
ck('the email field is there',
   await page.getByPlaceholder('you@yourbusiness.com').count(), 1)
ck('no phone tab', await page.getByRole('button', { name: 'Phone', exact: true }).count(), 0)
ck('and no phone field',  await page.getByPlaceholder('98765 43210').count(), 0)

await page.getByPlaceholder('you@yourbusiness.com').fill('owner@kennel.test')
await page.getByRole('button', { name: 'Send me a code' }).click()
await page.waitForTimeout(900)
ck('it asks for a code by email', otpSentTo?.email, 'owner@kennel.test')
const T2 = (await page.innerText('body')).toUpperCase()
ck('the code screen takes over', T2.includes('ENTER THE CODE SENT TO'), true)
// Once a code is on its way the only job is typing six digits; the pitch would
// be in the way.
ck('and the pitch is gone', T2.includes('HOW IT STARTS'), false)

ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nthe door has a shopfront')
process.exit(fails ? 1 : 0)
