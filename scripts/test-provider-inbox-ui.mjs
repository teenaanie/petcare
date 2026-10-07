// The inbox as a provider actually sees it. Run with: npm run test:inbox-ui
//
// test:inbox pins the grouping in isolation. This pins that the provider shell
// renders it: the right sections in the right order, a superseded note absent
// from the screen rather than merely from an array, the stale flag on an old
// note, and the customer's chosen phone number reachable as a tel: link —
// which, with no booking system anywhere, is the whole product.
//
// Skips without Playwright or a dev server, same contract as the other two.

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

const iso = d => new Date(d).toISOString()
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

const NOTES = [
  { id: 'n-current', provider_id: PROV, pet_label: 'Rex, Labrador, Dog',
    body: 'Rex is here this week. He is on Apoquel.', starts_on: day(-2), ends_on: day(3),
    contact_name: 'Teena', contact_phone: '9000000001', contact_email: null,
    sent_at: iso(Date.now() - 86400000), supersedes: 'n-old' },
  // The half of a correction that must NOT appear anywhere on screen.
  { id: 'n-old', provider_id: PROV, pet_label: 'Rex, Labrador, Dog',
    body: 'RETRACTED EARLIER VERSION', starts_on: day(-2), ends_on: day(3),
    contact_name: null, contact_phone: null, contact_email: null,
    sent_at: iso(Date.now() - 172800000), supersedes: null },
  { id: 'n-upcoming', provider_id: PROV, pet_label: 'Pippin, Beagle, Dog',
    body: 'Pippin arrives next month.', starts_on: day(20), ends_on: day(25),
    contact_name: null, contact_phone: null, contact_email: null,
    sent_at: iso(Date.now() - 3600000), supersedes: null },
  { id: 'n-undated', provider_id: PROV, pet_label: 'Ivy, Persian, Cat',
    body: 'Just so you have Ivy on file.', starts_on: null, ends_on: null,
    contact_name: null, contact_phone: null, contact_email: null,
    sent_at: iso(Date.now() - 1800000), supersedes: null },
  { id: 'n-stale', provider_id: PROV, pet_label: 'Old Timer, Dog',
    body: 'Sent a long time ago.', starts_on: day(-120), ends_on: day(-110),
    contact_name: null, contact_phone: null, contact_email: null,
    sent_at: iso(Date.now() - 120 * 86400000), supersedes: null },
]
const ACCOUNT = [{ id: 'acc1', provider_id: PROV, status: 'active', role: 'owner',
                   claimed_type: 'Boarder', created_at: iso(Date.now()),
                   provider_name: 'Unleash - The Dog Town', provider_type: 'Boarder',
                   provider_area: 'Baner', provider_city: 'Pune' }]

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(48)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
// The provider shell keeps its session under its OWN storage key.
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['pippy-provider-auth', SESSION])

let queriedIds = null
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/my_provider_accounts*', r => r.fulfill({ json: ACCOUNT }))
let broadcastPost = null
await ctx.route('**/api/provider-broadcast', r => {
  broadcastPost = JSON.parse(r.request().postData())
  return r.fulfill({ json: { ok: true, sent: 3, failures: 0 } })
})
await ctx.route('**/rest/v1/provider_broadcasts*', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/provider_notes*', r => {
  queriedIds = new URL(r.request().url()).searchParams.get('provider_id')
  return r.fulfill({ json: NOTES })
})

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/business', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }
await page.waitForTimeout(800)

// innerText returns RENDERED text, and the section headings carry Tailwind's
// `uppercase`, so they come back shouted. Compare case-insensitively rather
// than hard-coding the shouting, which would break the day someone restyles it.
const raw = await page.innerText('body')
const t = raw
const T = raw.toUpperCase()
const has = s => T.includes(s.toUpperCase())
const at  = s => T.indexOf(s.toUpperCase())

ck('the shell knows the business', t.includes('Unleash - The Dog Town'), true)
ck('it queried the right provider', (queriedIds || '').includes(PROV), true)

ck('With you now section', has('With you now (1)'), true)
ck('Coming up section',    has('Coming up (1)'), true)
ck('No dates section',     has('No dates given (1)'), true)
ck('Past section',         has('Past (1)'), true)

ck('the current note is shown',   t.includes('Rex is here this week'), true)
ck('the RETRACTED half is not',   t.includes('RETRACTED EARLIER VERSION'), false)
ck('the upcoming pet is named',   t.includes('Pippin, Beagle, Dog'), true)
ck('the undated note is not past', at('Just so you have Ivy') < at('Past (1)'), true)
ck('an old note is flagged',      t.includes('Sent over a month ago'), true)
ck('a fresh note is not',         t.includes('yesterday'), true)

ck('the owner is reachable',
   await page.getAttribute('a[href="tel:9000000001"]', 'href'), 'tel:9000000001')
ck('sections appear before feedback',
   at('With you now') < at('Send us a message'), true)
ck('the old placeholder is gone',
   t.includes('land here next'), false)
// The broadcast box: collapsed by default, and what it sends carries no
// recipient list — the whole point is that the client never holds one.
ck('the broadcast entry point is there', has('Message your customers'), true)
await page.getByRole('button', { name: 'Message your customers' }).first().click()
await page.waitForTimeout(500)
const t2 = (await page.innerText('body')).toUpperCase()
ck('it explains who will get it',
   t2.includes('INCLUDED AN EMAIL ADDRESS'), true)
ck('and that the provider cannot see them',
   t2.includes('YOU WILL NOT SEE THEIR ADDRESSES'), true)
await page.getByPlaceholder('Closed for Diwali').fill('Closed for Diwali')
await page.locator('textarea').first().fill('We are shut 20th to 23rd.')
await page.getByRole('button', { name: /Send to your customers/ }).click()
await page.waitForTimeout(900)
ck('it posts the subject and body',
   [broadcastPost?.subject, broadcastPost?.body],
   ['Closed for Diwali', 'We are shut 20th to 23rd.'])
ck('and names the business, not a list',
   Object.keys(broadcastPost || {}).sort(), ['body', 'providerId', 'subject'])
ck('the result is reported back',
   (await page.innerText('body')).includes('Sent to 3 customers'), true)

ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)
await page.screenshot({ path: '/tmp/pippy-inbox.png', fullPage: true })

await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nthe book reads as a diary')
process.exit(fails ? 1 : 0)
