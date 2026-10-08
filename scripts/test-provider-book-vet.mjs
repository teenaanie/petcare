// The same book, run by a vet. Run: npm run test:book-vet
//
// One set of tables serves every trade; what changes is the vocabulary. This
// pins the two differences that are NOT just words, because getting either
// wrong makes the app look broken to a business it was extended for:
//
//   · a vet has no trial day and no boarding criteria, so those two toggles are
//     absent — and, crucially, the "needs attention" tile does NOT light up for
//     every visit on the strength of two booleans nobody will ever tick.
//   · "nights" is not offered to a business that keeps nobody overnight, where
//     it would report zero forever and read as a bug.
//
// It also pins the populated year — the figures and the twelve-month chart —
// which test:book-ui cannot, because the only booking it makes is in the future.

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
const USER = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'vet@clinic.test',
               app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const SESSION = { access_token: 'stub', token_type: 'bearer', expires_in: 360000,
                  expires_at: Math.floor(Date.now() / 1000) + 360000, refresh_token: 'stub', user: USER }
const PROV = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ACCOUNT = [{ id: 'acc1', provider_id: PROV, status: 'active', role: 'owner',
                   claimed_type: 'Vet', created_at: new Date().toISOString(),
                   provider_name: 'Aundh Pet Clinic', provider_type: 'Vet',
                   provider_area: 'Aundh', provider_city: 'Pune' }]

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

const CUSTOMERS = [{ id: 'cust1', provider_id: PROV, name: 'Mrs Rao', phone: '9876500001',
                     created_at: new Date().toISOString() }]
const PETS = [{ id: 'pet1', provider_id: PROV, customer_id: 'cust1', name: 'Simba',
                species: 'Dog', breed: 'Indie', created_at: new Date().toISOString() }]
// History, so the year has something in it. A vet's visits are single days.
const APPTS = [
  { id: 'v1', provider_id: PROV, customer_id: 'cust1', provider_pet_id: 'pet1',
    kind: 'Vaccination', starts_on: day(-120), ends_on: null, status: 'completed',
    amount: '800', created_at: new Date().toISOString() },
  { id: 'v2', provider_id: PROV, customer_id: 'cust1', provider_pet_id: 'pet1',
    kind: 'Consultation', starts_on: day(-20), ends_on: null, status: 'completed',
    amount: null, created_at: new Date().toISOString() },
  { id: 'v3', provider_id: PROV, customer_id: 'cust1', provider_pet_id: 'pet1',
    kind: 'Follow-up', starts_on: day(3), ends_on: null, status: 'booked',
    amount: null, created_at: new Date().toISOString() },
]

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(52)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['pippy-provider-auth', SESSION])

let postedAppt = null, postedLog = null
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/rpc/my_provider_accounts*', r => r.fulfill({ json: ACCOUNT }))
await ctx.route('**/rest/v1/provider_notes*', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/provider_customers*', r => r.fulfill({ json: CUSTOMERS }))
await ctx.route('**/rest/v1/provider_pets*', r => r.fulfill({ json: PETS }))
await ctx.route('**/rest/v1/provider_appointment_logs*', r => {
  if (r.request().method() === 'POST') {
    postedLog = JSON.parse(r.request().postData())
    return r.fulfill({ status: 201, json: { id: 'log1', ...postedLog } })
  }
  return r.fulfill({ json: [] })
})
await ctx.route('**/rest/v1/provider_appointments*', r => {
  if (r.request().method() === 'POST') {
    postedAppt = JSON.parse(r.request().postData())
    return r.fulfill({ status: 201, json: { id: 'v4', ...postedAppt } })
  }
  return r.fulfill({ json: APPTS })
})

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/business', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }
await page.waitForTimeout(800)

const body = async () => (await page.innerText('body')).toUpperCase()
const has  = async s => (await body()).includes(s.toUpperCase())

ck('the clinic is named',          await has('Aundh Pet Clinic'), true)
ck('the tile says in today',       await has('In today'), true)
ck('not "with you now"',           await has('With you now'), false)
ck('past VISITS, not past stays',  await has('Past visits'), true)
// The one that would have made the app useless to a vet: two booleans a clinic
// never ticks must not flag every booked visit as needing attention.
ck('nothing is falsely flagged',   await has('Needs attention'), false)

// The year, populated.
ck('the year is there',            await has('Your year'), true)
ck('and counts visits, not nights', await has('visits in 12 months'), true)
ck('nights are not offered',       await page.getByRole('button', { name: 'Nights', exact: true }).count(), 0)
// One of the three visits in the window carries a price, and the line says so
// rather than presenting ₹800 as the year's takings. Three, not two: the window
// is the twelve months up to and including THIS month, so a visit booked for
// later this month is part of the month it falls in.
await page.getByRole('button', { name: 'Money', exact: true }).click()
await page.waitForTimeout(400)
// A short fragment on purpose: innerText breaks the rendered sentence across
// lines, so matching the whole of it would fail on a wrap rather than on a
// wrong number.
ck('money names its denominator',  await has('1 of 3 visits'), true)

// A bar is a question: the figure says three and the next thing asked is
// "three of whom". Tapping one answers it.
await page.getByRole('button', { name: 'Visits', exact: true }).click()
await page.waitForTimeout(400)
const bar = page.getByRole('button', { name: /^See / }).last()
ck('a month with something in it is tappable', await bar.count(), 1)
await bar.click()
await page.waitForTimeout(700)
ck('it opens that month',        await has('Mrs Rao'), true)
ck('and says what it holds',     await has('across 1 customer'), true)
await page.getByRole('button', { name: 'Dashboard' }).click()
await page.waitForTimeout(600)

// One customer, their history in a vet's words.
await page.getByRole('button', { name: 'All customers' }).click()
await page.waitForTimeout(600)
await page.getByRole('button').filter({ hasText: 'Mrs Rao' }).first().click()
await page.waitForTimeout(900)

ck('their history is shown',       await has('Their history'), true)
ck('counted all time, not nights', await has('All time'), true)
ck('the section is VISITS',        await has('Visits'), true)
ck('and the button records one',   await page.getByRole('button', { name: 'Record a visit' }).count() > 0, true)

await page.getByRole('button', { name: 'Record a visit' }).click()
await page.waitForTimeout(400)
const kinds = await page.locator('select[name="kind"] option').allTextContents()
ck("a vet's vocabulary",           kinds.slice(0, 3), ['Consultation', 'Vaccination', 'Deworming'])
ck('no trial toggle on the form',  await page.getByRole('button', { name: 'Trial done' }).count(), 0)
ck('no criteria toggle either',    await page.getByRole('button', { name: 'Criteria met' }).count(), 0)

await page.locator('input[type="date"]').first().fill('2026-11-20')
await page.getByPlaceholder('₹ what you charged').fill('800')
await page.getByRole('button', { name: 'Save booking' }).click()
await page.waitForTimeout(900)
ck('the visit was written',        [postedAppt?.kind, postedAppt?.amount], ['Consultation', 800])
ck('with no boarding flags set',   [postedAppt?.trial_done, postedAppt?.criteria_met], [false, false])

// The day log, in a clinic's words.
await page.getByRole('button').filter({ hasText: 'Vaccination' }).first().click()
await page.waitForTimeout(800)
ck('the log is what was given',    await has('Given on the day'), true)
ck('not "day by day"',             await has('Day by day'), false)

ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)
await page.screenshot({ path: '/tmp/pippy-vet-book.png', fullPage: true })
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\none book, every trade')
process.exit(fails ? 1 : 0)
