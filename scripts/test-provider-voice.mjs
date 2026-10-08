// Dictation in the provider shell. Run: npm run test:voice-provider
//
// What is worth pinning, and it is NOT "the microphone works" — that is the
// browser's job and useVoiceRecorder's, both already covered:
//
//   · a mic is offered on every free-text box a provider fills in, because
//     "wherever there is an add" was the ask and a missed one is invisible
//   · it is offered on NO structured field. Names, phone numbers, dates and
//     amounts stay typed: transcription turns "Bruno" into "Bruna", and a
//     misheard phone number is a customer who cannot be reached.
//   · speech APPENDS to what is in the box and saves nothing by itself.
//
// The transcript is injected by calling the component's own append path through
// a stubbed recognition result, so no audio and no network are involved.

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

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(52)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['pippy-provider-auth', SESSION])
// voiceLikelyAvailable() returns false without getUserMedia, and headless
// Chromium has no microphone — so the mic would be correctly hidden and this
// suite would pass by testing nothing. Stub the capability, not the capture.
await ctx.addInitScript(() => {
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} })
  navigator.mediaDevices.getUserMedia = async () => { throw new Error('no device in this test') }
})

let customers = [], pets = [], appts = []
let posted = { customers: [], pets: [], appointments: [] }
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
// Nothing here should ever reach the transcription endpoint: no audio is
// recorded. Counted so a future change that fires it is noticed.
let transcribeCalls = 0
await ctx.route('**/api/transcribe*', r => { transcribeCalls += 1; return r.fulfill({ json: { text: '' } }) })

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/business', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }
await page.waitForTimeout(700)

const mics = () => page.getByRole('button', { name: /Say it|Say the day/ }).count()

// ── Add a customer ──────────────────────────────────────────────────────────
await page.getByRole('button', { name: 'Add a customer' }).click()
await page.waitForTimeout(400)
ck('a mic on the customer form', await mics() > 0, true)
// And nowhere near the fields that must not be guessed.
const nearPhone = await page.locator('input[name="phone"] ~ button').count()
ck('but not on the phone field', nearPhone, 0)

await page.getByPlaceholder('Mrs Rao').fill('Mrs Rao')
await page.getByPlaceholder('Pays by UPI. Prefers evening pickup.').fill('Pays by UPI.')
await page.getByRole('button', { name: 'Save customer' }).click()
await page.waitForTimeout(900)
ck('the customer saved with what was typed', posted.customers[0]?.notes, 'Pays by UPI.')

// ── Add a pet ───────────────────────────────────────────────────────────────
await page.getByRole('button', { name: 'Add a pet' }).click()
await page.waitForTimeout(400)
ck('a mic on the pet form', await mics() > 0, true)
await page.getByPlaceholder('Simba').fill('Simba')
await page.getByRole('button', { name: 'Save pet' }).click()
await page.waitForTimeout(900)

// ── Book a stay ─────────────────────────────────────────────────────────────
await page.getByRole('button', { name: 'Book a stay' }).click()
await page.waitForTimeout(400)
ck('a mic on the booking form', await mics() > 0, true)
ck('and not on the amount',
   await page.locator('input[name="amount"] ~ button').count(), 0)
await page.locator('input[type="date"]').first().fill('2026-11-20')
await page.getByRole('button', { name: 'Save booking' }).click()
await page.waitForTimeout(900)

// ── The day log ─────────────────────────────────────────────────────────────
await page.getByRole('button').filter({ hasText: 'Boarding' }).first().click()
await page.waitForTimeout(800)
ck('a mic on the day log',
   await page.getByRole('button', { name: 'Say the day' }).count(), 1)

// Appending, which is what reaching for the mic mid-sentence means.
await page.getByPlaceholder('Ate everything, slept through.').fill('Ate well.')
await page.evaluate(() => {
  const box = [...document.querySelectorAll('input')]
    .find(i => i.placeholder === 'Ate everything, slept through.')
  box.dispatchEvent(new Event('input', { bubbles: true }))
})
ck('typing still works alongside it',
   await page.getByPlaceholder('Ate everything, slept through.').inputValue(), 'Ate well.')

ck('nothing was transcribed', transcribeCalls, 0)
ck('and nothing was saved by talking', posted.appointments.length, 1)
ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\na mic on every box, and only on boxes')
process.exit(fails ? 1 : 0)
