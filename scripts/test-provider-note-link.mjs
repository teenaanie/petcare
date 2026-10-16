// Following a pet in the book to the note it came from.
//
// A pet added in the provider's book can be linked to a Pippy note the
// customer sent. The book showed that as the words "linked to their Pippy
// note" and nothing else: the provider could see the note existed and then
// had to go and find it by hand in the other tab. An owner reported exactly
// that -- "from that pet data, I was not able to click and go to that note".
//
// So: the chip is a button, it switches to Shared with you, and the note it
// meant is open and marked when you land. The last part is what makes it a
// link rather than a tab switch.

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
const ck = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(52)} ${JSON.stringify(got)}`)
}

const UID  = '33333333-3333-3333-3333-333333333333'
const PROV = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'shop@tailwaggers.test',
               app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const SESSION = { access_token: 'stub', token_type: 'bearer', expires_in: 360000,
                  expires_at: Math.floor(Date.now() / 1000) + 360000, refresh_token: 'stub', user: USER }
const ACCOUNT = [{ id: 'acc1', provider_id: PROV, status: 'active', role: 'owner',
                   claimed_type: 'Store', created_at: new Date().toISOString(),
                   provider_name: 'Tailwaggers Pet Supplies', provider_type: 'Store',
                   provider_area: 'Kothrud', provider_city: 'Pune' }]

const WANTED = 'note-pino'
const OTHER  = 'note-other'
const NOTES = [
  { id: OTHER, provider_id: PROV, pet_id: null, pet_label: 'Rusty · Boxer',
    body: 'RUSTY BODY TEXT', sent_at: new Date().toISOString(), posted_by: UID },
  { id: WANTED, provider_id: PROV, pet_id: null, pet_label: 'Pino · Beagle',
    body: 'PINO NOTE BODY — feeding, allergies, what he is on',
    sent_at: new Date().toISOString(), posted_by: UID },
]
const CUSTOMERS = [{ id: 'c1', provider_id: PROV, name: 'Teena Anie', phone: '9158900361',
                     email: 'owner@pippy.test', notes: 'Prefers morning pickup',
                     created_at: new Date().toISOString() }]
const PETS = [{ id: 'p1', provider_id: PROV, customer_id: 'c1', name: 'Pino', species: 'Dog',
                breed: 'Beagle', notes: '', note_id: WANTED, created_at: new Date().toISOString() }]

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['pippy-provider-auth', SESSION])

// Catch-alls first — Playwright checks handlers last-registered first.
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/rpc/my_provider_accounts*', r => r.fulfill({ json: ACCOUNT }))
await ctx.route('**/rest/v1/provider_notes*', r => r.fulfill({ json: NOTES }))
await ctx.route('**/rest/v1/provider_customers*', r => r.fulfill({ json: CUSTOMERS }))
await ctx.route('**/rest/v1/provider_pets*', r => r.fulfill({ json: PETS }))

const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/business', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

// Into the customer, where the pet with the linked note lives. The dashboard
// opens on counts, so the list comes first.
await page.getByRole('button', { name: /^All customers$/i }).first().click()
await page.waitForTimeout(900)
await page.getByText('Teena Anie').first().click()
await page.waitForTimeout(900)
const link = page.getByRole('button', { name: /Pippy note/i }).first()
ck('the linked note is a button, not just words', await link.count(), 1)

await link.click()
await page.waitForTimeout(1200)
const body = await page.locator('body').innerText()

ck('it lands on Shared with you',   /Pino · Beagle/.test(body), true)
ck('the note it meant is on screen', /PINO NOTE BODY/.test(body), true)

// Landing on the right TAB is not the same as landing on the right NOTE. A
// provider with twenty notes needs to be told which one was meant, so the
// card marks itself -- and only that one.
//
// Not asserted on the body text: `open` only line-clamps in CSS, so every
// note's body is in the DOM either way. Asserting on visible text here would
// have passed for the wrong reason.
ck('the note it meant is marked',
  await page.locator(`[data-note-id="${WANTED}"][data-focused="true"]`).count(), 1)
ck('and no other note is',
  await page.locator(`[data-note-id="${OTHER}"][data-focused="true"]`).count(), 0)
ck('no uncaught errors', errs, [])

await browser.close()
console.log(fails ? `\n${fails} failing` : '\na linked pet reaches its note')
process.exit(fails ? 1 : 0)
