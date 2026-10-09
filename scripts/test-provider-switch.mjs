// One person, two businesses. Run: npm run test:switch
//
// Somebody who boards AND grooms is two listings, because `type` decides which
// tab of the directory a pet parent finds them under and they belong in both.
// Nothing needs linking: one sign-in holds both claims because both carry the
// same address.
//
// What used to happen, and what this pins so it cannot come back:
//
//   · the screen named only the FIRST claim, so the second business was
//     invisible and its owner could not tell the app knew about it
//   · the two books were MERGED — one query across both provider_ids — so a
//     groomer's customers appeared in the kennel's list
//   · every new customer was filed under business one whatever was on screen,
//     because primaryProviderId came from the first claim
//   · the vocabulary came from the first claim too, so a groomer was asked a
//     kennel's trial-day question

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
const USER = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'both@business.test',
               app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const SESSION = { access_token: 'stub', token_type: 'bearer', expires_in: 360000,
                  expires_at: Math.floor(Date.now() / 1000) + 360000, refresh_token: 'stub', user: USER }

const KENNEL  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const SALON   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const ACCOUNTS = [
  { id: 'acc1', provider_id: KENNEL, status: 'active', role: 'owner', claimed_type: 'Boarder',
    created_at: '2026-01-01T00:00:00Z', provider_name: 'Paws Retreat Boarding',
    provider_type: 'Boarder', provider_area: 'Baner', provider_city: 'Pune' },
  { id: 'acc2', provider_id: SALON, status: 'active', role: 'owner', claimed_type: 'Groomer',
    created_at: '2026-02-01T00:00:00Z', provider_name: 'The Scruffy Spa',
    provider_type: 'Groomer', provider_area: 'Baner', provider_city: 'Pune' },
]
// One customer each, so a merged book is visible as both names at once.
const CUSTOMERS = [
  { id: 'c-kennel', provider_id: KENNEL, name: 'Kennel Customer', created_at: new Date().toISOString() },
  { id: 'c-salon',  provider_id: SALON,  name: 'Salon Customer',  created_at: new Date().toISOString() },
]

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(52)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['pippy-provider-auth', SESSION])

let askedFor = []        // every provider_id the book has queried customers for
let postedCustomer = null
const posted = []
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/rpc/my_provider_accounts*', r => r.fulfill({ json: ACCOUNTS }))
await ctx.route('**/rest/v1/provider_notes*', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/provider_customers*', r => {
  if (r.request().method() === 'POST') {
    postedCustomer = JSON.parse(r.request().postData())
    posted.push(postedCustomer)
    return r.fulfill({ status: 201, json: { id: `new${posted.length}`, ...postedCustomer } })
  }
  const inList = new URL(r.request().url()).searchParams.get('provider_id') || ''
  askedFor.push(inList)
  return r.fulfill({ json: CUSTOMERS.filter(c => inList.includes(c.provider_id)) })
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

ck('both businesses are offered',
   [await has('Paws Retreat Boarding'), await has('The Scruffy Spa')], [true, true])
ck('and it says which one you are in', await has('Working on'), true)

// The boarder's questions, because the boarder is who is on screen.
ck('the tile is a boarder’s',         await has('With you now'), true)

// One book at a time. The two have different customers, different words and,
// for a boarder, criteria a groomer has no use for.
await page.getByRole('button', { name: 'All customers' }).click()
await page.waitForTimeout(700)
ck('the kennel’s customer is there',  await has('Kennel Customer'), true)
ck('the salon’s is NOT',              await has('Salon Customer'), false)
ck('and only one business was queried',
   askedFor.every(q => q.includes(KENNEL) && !q.includes(SALON)), true)

// Switch. It lands on the new business's DASHBOARD rather than leaving you on
// a list that now belongs to somebody else — the ids in that view would not
// resolve against the other book anyway.
askedFor = []
await page.getByRole('button', { name: /The Scruffy Spa/ }).click()
await page.waitForTimeout(1200)
// A groomer has no overnight stay, so the kennel's words go with the kennel.
ck('the words follow the business',      await has('In today'), true)
ck('not the kennel’s',               await has('With you now'), false)

await page.getByRole('button', { name: 'All customers' }).click()
await page.waitForTimeout(700)
ck('the salon’s customer appears',    await has('Salon Customer'), true)
ck('the kennel’s is gone',            await has('Kennel Customer'), false)
ck('and the salon was the one queried',
   askedFor.length > 0 && askedFor.every(q => q.includes(SALON) && !q.includes(KENNEL)), true)

// Back to the dashboard for the add.
await page.getByRole('button', { name: 'Dashboard' }).click()
await page.waitForTimeout(500)

// A customer added while the salon is on screen belongs to the salon. This is
// the one that silently filed everything under business one.
await page.getByRole('button', { name: 'Add a customer' }).click()
await page.waitForTimeout(400)
await page.getByPlaceholder('Mrs Rao').fill('New Salon Customer')
await page.getByRole('button', { name: 'Save customer' }).click()
await page.waitForTimeout(900)
ck('a new customer joins the business on screen', postedCustomer?.provider_id, SALON)

// ── Copying one customer into both books ────────────────────────────────────
//
// The two books stay separate — what you write about a dog at the grooming
// table is not the kennel's to inherit — but typing the same phone number
// twice is nobody's idea of separation. So the copy carries the CONTACT
// DETAILS and nothing else.
// Adding a customer opens them, so the way back to the dashboard from here is
// their Back button, not the list's.
posted.length = 0
await page.getByRole('button', { name: 'Back' }).first().click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Add a customer' }).click()
await page.waitForTimeout(400)
ck('the other business is offered', await has('Also add them to'), true)
ck('and named',                     await has('Paws Retreat Boarding'), true)

await page.getByPlaceholder('Mrs Rao').fill('Mrs Shared')
await page.getByPlaceholder('98765 00000').fill('9000000123')
await page.getByPlaceholder('Pays by UPI. Prefers evening pickup.').fill('Grooming only, hates the dryer.')
await page.getByRole('button', { name: /Paws Retreat Boarding/ }).last().click()
await page.getByRole('button', { name: 'Save customer' }).click()
await page.waitForTimeout(1200)

ck('they land in both books',
   posted.map(c => c.provider_id).sort(), [KENNEL, SALON].sort())
const copy = posted.find(c => c.provider_id === KENNEL)
const here = posted.find(c => c.provider_id === SALON)
ck('the copy carries the name',   copy?.name, 'Mrs Shared')
ck('and how to reach them',       copy?.phone, '9000000123')
// The half that matters: a note is about one business's relationship with
// them, and the other book has not earned it.
ck('but NOT the notes',           copy?.notes, null)
ck('while the original keeps them', here?.notes, 'Grooming only, hates the dryer.')

// And the choice survives a reload, or a provider switches business every time
// they open the app.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
ck('the choice is remembered', await has('The Scruffy Spa'), true)
ck('and it is still the one in use', await has('In today'), true)

ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\ntwo businesses, one sign-in')
process.exit(fails ? 1 : 0)
