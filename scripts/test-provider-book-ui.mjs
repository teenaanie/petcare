// The provider's own book, driven in the real shell. Run: npm run test:book-ui
//
// What this is really pinning: the book is INDEPENDENT. A provider adds a
// customer, their pet and a booking without a single inform note existing, and
// every write carries the provider_id the database will check it against.
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

const UID  = '33333333-3333-3333-3333-333333333333'
const USER = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'boarder@unleash.test',
               app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const SESSION = { access_token: 'stub', token_type: 'bearer', expires_in: 360000,
                  expires_at: Math.floor(Date.now() / 1000) + 360000, refresh_token: 'stub', user: USER }
const PROV = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ACCOUNT = [{ id: 'acc1', provider_id: PROV, status: 'active', role: 'owner',
                   claimed_type: 'Boarder', created_at: new Date().toISOString(),
                   provider_name: 'Unleash - The Dog Town', provider_type: 'Boarder',
                   provider_area: 'Baner', provider_city: 'Pune' }]

let customers = [], pets = [], appts = []
let posted = { customers: [], pets: [], appointments: [] }

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(50)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['pippy-provider-auth', SESSION])

const table = (name, store) => async r => {
  if (r.request().method() === 'POST') {
    const row = JSON.parse(r.request().postData())
    const one = Array.isArray(row) ? row[0] : row
    const saved = { id: `${name}-${store.length + 1}`, created_at: new Date().toISOString(), ...one }
    posted[name].push(one); store.push(saved)
    return r.fulfill({ status: 201, json: saved })
  }
  return r.fulfill({ json: store })
}

await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/rpc/my_provider_accounts*', r => r.fulfill({ json: ACCOUNT }))
await ctx.route('**/rest/v1/provider_notes*', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/provider_customers*',    r => table('customers', customers)(r))
await ctx.route('**/rest/v1/provider_pets*',         r => table('pets', pets)(r))
await ctx.route('**/rest/v1/provider_appointments*', r => table('appointments', appts)(r))

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/business', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }
await page.waitForTimeout(700)

let t = await page.innerText('body')
ck('the book is the default half', t.includes('Nothing booked'), true)
ck('both halves are offered', t.includes('My book') && t.includes('Shared with you'), true)
ck('and it says it needs nobody on the app',
   t.includes('None of this needs them to use'), true)

// Add a customer.
await page.getByRole('button', { name: 'Customers', exact: false }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Add', exact: true }).first().click()
await page.waitForTimeout(300)
await page.getByPlaceholder('Mrs Rao').fill('Mrs Rao')
await page.getByPlaceholder('98765 00000').fill('9876500001')
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(900)

ck('a customer was written', posted.customers.length, 1)
ck('carrying the business it belongs to', posted.customers[0]?.provider_id, PROV)
ck('and the name typed', posted.customers[0]?.name, 'Mrs Rao')
ck('and who added them', posted.customers[0]?.created_by, UID)
t = await page.innerText('body')
ck('the customer is listed', t.includes('Mrs Rao'), true)

// Open them, add a pet, book a stay.
await page.getByText('Mrs Rao', { exact: false }).first().click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Add', exact: false }).first().click()
await page.waitForTimeout(300)
await page.getByPlaceholder('Simba').fill('Simba')
await page.getByPlaceholder('Golden Retriever').fill('Golden Retriever')
await page.getByRole('button', { name: 'Save pet' }).click()
await page.waitForTimeout(900)
ck('a pet was written', posted.pets.length, 1)
ck('filed under that customer', posted.pets[0]?.customer_id, customers[0].id)
ck('with the same business', posted.pets[0]?.provider_id, PROV)
ck('and unlinked by default', posted.pets[0]?.note_id, null)

await page.getByRole('button', { name: 'Book', exact: true }).click()
await page.waitForTimeout(400)
await page.locator('input[type="date"]').first().fill('2026-11-20')
await page.locator('input[type="date"]').nth(1).fill('2026-11-25')
await page.getByRole('button', { name: 'Save booking' }).click()
await page.waitForTimeout(900)
ck('a booking was written', posted.appointments.length, 1)
ck('against that customer', posted.appointments[0]?.customer_id, customers[0].id)
ck('with the dates given', [posted.appointments[0]?.starts_on, posted.appointments[0]?.ends_on],
   ['2026-11-20', '2026-11-25'])
ck('defaulting to booked', posted.appointments[0]?.status, 'booked')
ck('and to boarding', posted.appointments[0]?.kind, 'Boarding')

await page.screenshot({ path: '/tmp/pippy-book.png', fullPage: true })
ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)

await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nthe book stands on its own')
process.exit(fails ? 1 : 0)
