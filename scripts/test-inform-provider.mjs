// The send path, end to end in a real browser. Run with: npm run test:inform
//
// test:brief already pins the facts composer in isolation. This pins the thing
// that actually matters to a customer: that the row POSTed to provider_notes
// contains exactly what the screen showed them and nothing else — no vet prose,
// no microchip, no bill — and that editing the textarea changes what is sent.
//
// Needs Playwright and a dev server on :5173, neither of which this repo
// depends on, so it skips rather than fails without them. Same contract as
// test:claim-approve.
//   npm i -D playwright && npm run dev

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

const UID  = '66666666-6666-4666-8666-666666666666'
const USER = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'parent@pippy.test',
               app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const SESSION = { access_token: 'stub', token_type: 'bearer', expires_in: 360000,
                  expires_at: Math.floor(Date.now() / 1000) + 360000, refresh_token: 'stub', user: USER }

const PET_ID = 'd0000000-0000-4000-8000-000000000001'
const PROV   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PET = {
  id: PET_ID, user_id: UID, name: 'Pippin', species: 'Dog', breed: 'Beagle',
  gender: 'Male', dob: '2023-10-07', vet_name: 'Dr Rao', vet_phone: '9876500000',
  feeding_schedule: '8am and 7pm', diet_notes: 'no chicken', food_preferences: ['kibble'],
  temperament: 'friendly', anxiety_notes: 'hates thunder', triggers: ['fireworks'],
  handling_notes: 'harness not collar', socialises_with_dogs: true,
  // Present on the row, and must never reach the note:
  notes: 'PRIVATE OWNER NOTE', microchip_id: '900123456789', insurance_policy: 'POLICY-1',
  created_at: new Date().toISOString(),
}
const VAX  = [{ id: 'v1', pet_id: PET_ID, name: 'Rabies', date_given: '2026-06-15', is_done: false }]
const MEDS = [
  { id: 'm1', pet_id: PET_ID, name: 'Apoquel', dosage: '16mg', frequency: 'twice daily', end_date: null, is_done: false },
  { id: 'm2', pet_id: PET_ID, name: 'Amoxicillin', dosage: '250mg', end_date: '2026-01-01', is_done: false },
]
const RECS = [{ id: 'r1', pet_id: PET_ID, title: 'Ear infection', date: '2026-08-12',
                description: 'SECRET VET PROSE', vet: 'Dr Who', cost: 2400 }]
const MINE = [{ id: 'u1', user_id: UID, provider_id: PROV, pet_id: null, category: 'Boarder',
                name: 'Unleash - The Dog Town', is_primary: true, created_at: new Date().toISOString() },
              { id: 'u2', user_id: UID, provider_id: null, pet_id: null, category: 'Vet',
                name: 'Typed-in vet', is_primary: false, created_at: new Date().toISOString() }]

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(50)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['sb-lumgcfqsiwzbyfhjmkct-auth-token', SESSION])

let posted = null
let briefAsked = null
// Catch-alls first: routes match in REVERSE registration order.
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/pets*',            r => r.fulfill({ json: [PET] }))
await ctx.route('**/rest/v1/vaccinations*',    r => r.fulfill({ json: VAX }))
await ctx.route('**/rest/v1/medicines*',       r => r.fulfill({ json: MEDS }))
await ctx.route('**/rest/v1/medical_records*', r => r.fulfill({ json: RECS }))
await ctx.route('**/rest/v1/user_providers*',  r => r.fulfill({ json: MINE }))
await ctx.route('**/rest/v1/rpc/onboarded_provider_ids*',
  r => r.fulfill({ json: [{ provider_id: PROV }] }))
let noteGets = 0
await ctx.route('**/rest/v1/provider_notes*', r => {
  if (r.request().method() === 'GET') {
    noteGets += 1
    // Nothing sent yet on the first read; the row we POST on the second, so the
    // history section is exercised rather than merely present in the source.
    return r.fulfill({ json: noteGets === 1 || !posted ? [] : [{ ...posted, id: 'n1', sent_at: '2026-11-01T00:00:00Z' }] })
  }
  if (r.request().method() === 'POST') {
    posted = JSON.parse(r.request().postData())
    return r.fulfill({ status: 201, json: { ...posted, id: 'n1', sent_at: new Date().toISOString() } })
  }
  return r.fulfill({ json: [] })
})
// The covering line. Deliberately answered with something that would be WRONG
// if it were trusted for facts — the assertion below is that it stays prose.
await ctx.route('**/api/ai-complete', r => {
  briefAsked = JSON.parse(r.request().postData())
  return r.fulfill({ json: { result: 'Hi Unleash, here are Pippin’s details for his stay. Shout if anything looks off.' } })
})

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }

await page.getByText('Pippin', { exact: false }).first().click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Inform' }).first().click()
await page.waitForTimeout(2000)

let t = await page.innerText('body')
ck('the sheet opens on the pet', t.includes('Inform a provider about Pippin'), true)
ck('it shows the onboarded business', t.includes('Unleash'), true)
ck('and not the hand-typed one', t.includes('Typed-in vet'), false)

// The prompt must be told category words only — no dates, doses or record text.
const promptBlob = JSON.stringify(briefAsked)
ck('the model is asked for provider_brief', briefAsked?.task, 'provider_brief')
ck('it is given topics, not values', briefAsked?.topics?.includes('vaccinations'), true)
ck('no date reaches the prompt', promptBlob.includes('2026-06-15'), false)
ck('no dose reaches the prompt', promptBlob.includes('16mg'), false)
ck('no vet prose reaches the prompt', promptBlob.includes('SECRET VET PROSE'), false)

const factsBox = page.locator('textarea').nth(1)
const factsShown = await factsBox.inputValue()
ck('the facts show the latest shot', factsShown.includes('Rabies — 15 Jun 2026'), true)
ck('and only current medicine',
   factsShown.includes('Apoquel') && !factsShown.includes('Amoxicillin'), true)
ck('and the visit as a headline', factsShown.includes('Ear infection — 12 Aug 2026'), true)
ck('and never the vet prose', factsShown.includes('SECRET VET PROSE'), false)
await page.screenshot({ path: '/tmp/pippy-inform.png', fullPage: true })

// The customer edits before sending — the whole depth-control claim.
await factsBox.fill(factsShown + '\nHe is nervous with men in hats.')
await page.locator('input[type="date"]').first().fill('2026-11-01')
await page.locator('input[type="date"]').nth(1).fill('2026-11-05')
await page.getByPlaceholder('Phone').fill('9000000001')

await page.getByRole('button', { name: /Send to/ }).click()
await page.waitForTimeout(1500)

ck('a row was POSTed', !!posted, true)
ck('to the right business', posted?.provider_id, PROV)
ck('about the right pet', posted?.pet_id, PET_ID)
ck('attributed to the sender', posted?.sent_by, UID)
ck('carrying the stay window', [posted?.starts_on, posted?.ends_on], ['2026-11-01', '2026-11-05'])
ck('and the chosen phone', posted?.contact_phone, '9000000001')
ck('with a denormalised label', posted?.pet_label, 'Pippin, Beagle, Dog')
ck('the edit is in what was sent', posted?.body?.includes('nervous with men in hats'), true)
ck('so is the covering line', posted?.body?.includes('Shout if anything looks off'), true)

const sentBlob = JSON.stringify(posted)
ck('the vet prose was never sent', sentBlob.includes('SECRET VET PROSE'), false)
ck('nor the private owner note', sentBlob.includes('PRIVATE OWNER NOTE'), false)
ck('nor the microchip', sentBlob.includes('900123456789'), false)
ck('nor the insurance policy', sentBlob.includes('POLICY-1'), false)
ck('nor the bill', sentBlob.includes('2400'), false)
ck('the finished course was not sent', sentBlob.includes('Amoxicillin'), false)

t = await page.innerText('body')
ck('the customer is told it landed', t.includes('Unleash - The Dog Town has it'), true)
ck('and that it cannot be taken back', t.includes('cannot be taken back'), true)
ck('the history was re-read after sending', noteGets >= 2, true)
ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)

await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nthe note carries exactly what was shown')
process.exit(fails ? 1 : 0)
