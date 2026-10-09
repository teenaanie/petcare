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

let customers = [], pets = [], appts = [], logs = []
let posted = { customers: [], pets: [], appointments: [], logs: [] }

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(50)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['pippy-provider-auth', SESSION])

const table = (name, store) => async r => {
  // PATCH has to update in place, or "it is an update, not a second row"
  // passes for the wrong reason — the stub would be the thing keeping the
  // count at one.
  if (r.request().method() === 'PATCH') {
    const patch = JSON.parse(r.request().postData())
    const id = (new URL(r.request().url()).searchParams.get('id') || '').replace('eq.', '')
    const row = store.find(x => x.id === id)
    if (row) Object.assign(row, patch)
    return r.fulfill({ json: row || null })
  }
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
await ctx.route('**/rest/v1/provider_appointment_logs*', r => table('logs', logs)(r))

// Broadcasting lives on this dashboard now, so its send is pinned here.
let broadcastPost = null
await ctx.route('**/rest/v1/provider_broadcasts*', r => r.fulfill({ json: [] }))
await ctx.route('**/api/provider-mail*', r => {
  broadcastPost = JSON.parse(r.request().postData())
  return r.fulfill({ json: { ok: true, sent: 3, failures: 0 } })
})

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/business', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }
await page.waitForTimeout(700)

// Tile labels and section headings carry Tailwind's `uppercase`, and innerText
// returns RENDERED text — so these compare case-insensitively rather than
// hard-coding the shouting, which would break the day someone restyles it.
const body = async () => (await page.innerText('body')).toUpperCase()
const has  = async s => (await body()).includes(s.toUpperCase())

let t = await page.innerText('body')
// The dashboard leads with numbers, not a list. That is the whole point of the
// redesign: a boarder wants to know how many are in before they read anything.
ck('the dashboard leads with tiles',
   (await has('With you now')) && (await has('Coming up')) && (await has('Customers')), true)
ck('and not with a list of bookings', t.includes('Boarding ·'), false)
ck('broadcasting is on the dashboard', await has('Message your customers'), true)

// Add a customer, and land straight on them — the next thing anybody does is
// add the pet and book it in.
await page.getByRole('button', { name: 'Add a customer' }).click()
await page.waitForTimeout(300)
await page.getByPlaceholder('Mrs Rao').fill('Mrs Rao')
await page.getByPlaceholder('98765 00000').fill('9876500001')
await page.getByRole('button', { name: 'Save customer' }).click()
await page.waitForTimeout(1000)

ck('a customer was written', posted.customers.length, 1)
ck('carrying the business it belongs to', posted.customers[0]?.provider_id, PROV)
ck('and who added them', posted.customers[0]?.created_by, UID)
t = await page.innerText('body')
ck('and it opens them straight away', t.includes('Add a pet') && t.includes('Book a stay'), true)
ck('with a way to reach them', await page.getByRole('link', { name: 'WhatsApp', exact: true }).count() > 0, true)

// Sending the criteria by WhatsApp is a wa.me link the provider presses send
// on, not something Pippy sends: there is no WhatsApp account here, and a
// customer should get it from a number they recognise. So what is pinned is the
// LINK — that it goes to their number and carries the criteria as text.
const waCriteria = page.getByRole('link', { name: 'WhatsApp our criteria' })
ck('the criteria can go by WhatsApp', await waCriteria.count(), 1)
{
  const href = await waCriteria.getAttribute('href')
  const text = decodeURIComponent((href.split('?text=')[1] || ''))
  ck('to the number in the book',   href.startsWith('https://wa.me/919876500001'), true)
  ck('naming the customer',         text.includes('Mrs Rao'), true)
  ck('carrying a requirement',      text.includes('Rabies vaccination current'), true)
  // WhatsApp renders no markdown, so a message full of asterisks reads as a
  // mistake rather than as emphasis.
  ck('and no markdown',             /\*\*/.test(text), false)
}

await page.getByRole('button', { name: 'Add a pet' }).click()
await page.waitForTimeout(300)
await page.getByPlaceholder('Simba').fill('Simba')
await page.getByPlaceholder('Golden Retriever').fill('Golden Retriever')
await page.getByRole('button', { name: 'Save pet' }).click()
await page.waitForTimeout(1000)
ck('a pet was written', posted.pets.length, 1)
ck('filed under that customer', posted.pets[0]?.customer_id, customers[0].id)

await page.getByRole('button', { name: 'Book a stay' }).click()
await page.waitForTimeout(400)
await page.locator('input[type="date"]').first().fill('2026-11-20')
await page.locator('input[type="date"]').nth(1).fill('2026-11-25')
// Optional, and it stays optional — but when it is typed it has to reach the
// row, because every total on the dashboard counts from this column.
await page.getByPlaceholder('₹ what you charged').fill('4500')
// The two flags a front desk checks before the animal arrives.
await page.getByRole('button', { name: 'Trial done' }).click()
await page.getByRole('button', { name: 'Save booking' }).click()
await page.waitForTimeout(1000)
ck('a booking was written', posted.appointments.length, 1)
ck('with the dates given', [posted.appointments[0]?.starts_on, posted.appointments[0]?.ends_on],
   ['2026-11-20', '2026-11-25'])
ck('the amount was recorded', posted.appointments[0]?.amount, 4500)
ck('the trial flag was recorded', posted.appointments[0]?.trial_done, true)
ck('and criteria left unticked', posted.appointments[0]?.criteria_met, false)

// ── Editing what was typed ──────────────────────────────────────────────────
//
// A number changes, somebody marries, and what an animal needs is the thing a
// boarder learns AFTER the first stay — "scared of the dryer", "only eats if
// you sit with her". Before this both were typed once and never again, and the
// only way to fix a digit was to delete the customer, which takes their pets
// and their whole history with it.
await page.locator('button[title="Edit their details"]').click()
await page.waitForTimeout(400)
await page.getByPlaceholder('98765 00000').fill('9876500002')
await page.getByPlaceholder('Pays by UPI. Prefers evening pickup.').fill('Pays by UPI.')
await page.getByRole('button', { name: 'Save customer' }).click()
await page.waitForTimeout(900)
ck('a customer can be corrected',
   [posted.customers.length, customers[0]?.phone, customers[0]?.notes],
   [1, '9876500002', 'Pays by UPI.'])
ck('and it is an update, not a second row', customers.length, 1)

await page.locator('button[title="Edit Simba"]').click()
await page.waitForTimeout(400)
await page.getByPlaceholder('Nervous with men in hats.').fill('Scared of the dryer. Towel finish.')
await page.getByRole('button', { name: 'Save pet' }).click()
await page.waitForTimeout(900)
ck('a pet can be given a note later', pets[0]?.notes, 'Scared of the dryer. Towel finish.')
ck('and it stays one pet',            pets.length, 1)

// Open the booking: edit it, and log a day against it.
// By BUTTON, not by text: "Boarding · 1" also appears as a chip in the history
// block above, and getByText(...).first() picked the chip, clicked a span and
// sat there. The row is the only button carrying the word.
await page.getByRole('button').filter({ hasText: 'Boarding' }).first().click()
await page.waitForTimeout(800)
t = await page.innerText('body')
ck('the booking opens on its own screen', await has('Day by day'), true)
ck('and can be edited', await page.locator('button[title="Edit this booking"]').count(), 1)

await page.getByPlaceholder('Ate everything, slept through.').fill('Ate everything, slept through.')
await page.locator('.btn-primary').last().click()
await page.waitForTimeout(900)
ck('a day was logged', posted.logs.length, 1)
ck('against that booking', posted.logs[0]?.appointment_id, appts[0].id)
ck('and the business it belongs to', posted.logs[0]?.provider_id, PROV)

// Back out to the dashboard — booking → customer → dashboard — and send a
// broadcast. What it carries matters more than that it sends: the client must
// never hold the recipient list, so the payload names the business and nothing
// else and the server does the fan-out.
await page.getByRole('button', { name: 'Back' }).first().click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Back' }).first().click()
await page.waitForTimeout(700)
ck('backing out lands on the dashboard', await has('With you now'), true)
// The year, computed from the same rows the tiles count.
ck('the year is on the dashboard', await has('Your year'), true)
// The only booking in this suite is in the future, so the last twelve months
// are genuinely empty — and an empty year says so rather than drawing a chart
// of nothing. The populated case is pinned in test:book-vet.
ck('and an empty year says so', await has('Nothing in the last twelve months'), true)

await page.getByRole('button', { name: 'Message your customers' }).first().click()
await page.waitForTimeout(500)
ck('it explains who will get it', await has('included an email address'), true)
ck('and that the provider cannot see them', await has('you will not see their addresses'), true)
// By placeholder, not position: `textarea.first()` broke silently once when
// another composer appeared above this one.
await page.getByPlaceholder('Closed for Diwali').fill('Closed for Diwali')
await page.getByPlaceholder(/We are shut from the 20th/).fill('We are shut 20th to 23rd.')
await page.getByRole('button', { name: /Send to your customers/ }).click()
await page.waitForTimeout(900)
ck('it posts the subject and body',
   [broadcastPost?.subject, broadcastPost?.body],
   ['Closed for Diwali', 'We are shut 20th to 23rd.'])
ck('and names the business, not a list',
   Object.keys(broadcastPost || {}).sort(), ['body', 'providerId', 'subject'])
ck('the result is reported back',
   (await page.innerText('body')).includes('Sent to 3 customers'), true)

await page.screenshot({ path: '/tmp/pippy-book.png', fullPage: true })
ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)

await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nthe book stands on its own')
process.exit(fails ? 1 : 0)
