// Correcting what the AI captured, before it is written.
// Run: npm run test:captured-edit-ui
//
// "can you fix the review screen to allow inline edits. and also whenever AI
// captures anything and displays there should be an ability to edit what is
// captured"
//
// The assertion that matters is that a correction REACHES THE DATABASE.
// Checking that a text box appeared would pass while the save path still read
// the model's original answer -- which is exactly how this would go wrong,
// because the review screen keeps the parse and the edits in different places.
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

const UID  = '44444444-4444-4444-4444-444444444444'
const USER = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'owner@pippy.test',
               app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const SESSION = { access_token: 'stub', token_type: 'bearer', expires_in: 360000,
                  expires_at: Math.floor(Date.now() / 1000) + 360000, refresh_token: 'stub', user: USER }

// What the model "heard" — deliberately wrong in ways an owner would catch.
// `category` is NOT one of the app's own options, which is the case that used
// to display as the first option while saving something else entirely.
const PARSE = { result: { pets: [{
  name: 'Simba', species: 'Cat', breed: 'Indi',
  vaccinations: [{ name: 'Felocel', dateGiven: '2026-09-28', nextDue: '2026-10-20' }],
  medicines: [{ name: 'Bravecto', dosage: '250mg', frequency: 'Monthly', category: 'Painkiller' }],
}] } }

let fails = 0
const ck = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(58)} ${JSON.stringify(got)}`)
}

const posted = { pets: [], vaccinations: [], medicines: [] }
const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['sb-lumgcfqsiwzbyfhjmkct-auth-token', SESSION])

const capture = name => async r => {
  if (r.request().method() === 'POST') {
    const b = JSON.parse(r.request().postData())
    const one = Array.isArray(b) ? b[0] : b
    posted[name].push(one)
    return r.fulfill({ status: 201, json: { id: `${name}-1`, user_id: UID,
                                            created_at: new Date().toISOString(), ...one } })
  }
  return r.fulfill({ json: [] })
}

await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/api/**', r => r.fulfill({ json: { ok: true } }))
await ctx.route('**/api/ai-complete*', r => r.fulfill({ json: PARSE }))
await ctx.route('**/rest/v1/pets*', capture('pets'))
await ctx.route('**/rest/v1/vaccinations*', capture('vaccinations'))
await ctx.route('**/rest/v1/medicines*', capture('medicines'))

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1900)
const no = page.getByRole('button', { name: /^No thanks$/i }).first()
if (await no.count()) await no.click().catch(() => {})
await page.waitForTimeout(700)

await page.getByRole('button', { name: /^Add Pet$/i }).first().click()
await page.waitForTimeout(700)
await page.locator('.fixed.inset-0').last().getByRole('button', { name: /speak/i }).first().click()
await page.waitForTimeout(900)

const voice = page.locator('.fixed.inset-0').last()
const type = voice.getByRole('button', { name: /type/i }).first()
if (await type.count()) { await type.click(); await page.waitForTimeout(400) }
await voice.locator('textarea').first().fill('I have a cat called Simba')
await voice.getByRole('button', { name: /sort|parse|continue|next|review/i }).first().click()
await page.waitForTimeout(1600)

ck('the review screen is showing', /Check this before saving/i.test(await page.innerText('body')), true)

// Every captured row offers an edit, which is the general ask.
const editButtons = voice.getByRole('button', { name: /^Edit$/ })
ck('every captured row offers an edit', await editButtons.count(), 3)

// Open every row's editor. Taken one at a time from the front, because
// opening a panel turns its own button into "Done editing" and an index
// captured beforehand then points at the wrong row.
for (let i = 0; i < 3; i++) {
  const btn = voice.getByRole('button', { name: /^Edit$/ }).first()
  if (await btn.count() === 0) break
  await btn.click()
  await page.waitForTimeout(350)
}

// ── Correct the pet's breed ──
// Anchored to the field's own label, which is the sibling right before its
// control in CapturedField. A looser selector matched the row's tick-box.
await voice.locator('span:text-is("Breed") + input').fill('Indie')

// ── Correct the vaccination's next-due date ──
await voice.locator('span:text-is("Next due") + input').fill('2026-11-15')

// ── The medicine category the model invented ──
const cat = voice.locator('span:text-is("Category") + select')
// The trap: a value outside the option list must still be what is SHOWN,
// not silently replaced by whichever option comes first.
ck('an unexpected captured value is shown, not replaced',
   await cat.inputValue(), 'Painkiller')
await cat.selectOption('Flea/Tick')

await voice.getByRole('button', { name: /save these/i }).first().click()
await page.waitForTimeout(2200)

// THE assertions: corrections reach the database.
ck('the pet is saved once', posted.pets.length, 1)
ck('with the corrected breed', posted.pets[0]?.breed, 'Indie')
ck('untouched fields keep what was captured', posted.pets[0]?.name, 'Simba')
ck('the vaccination carries the corrected date', posted.vaccinations[0]?.next_due, '2026-11-15')
ck('and keeps the date that was right', posted.vaccinations[0]?.date_given, '2026-09-28')
ck('the medicine carries the corrected category', posted.medicines[0]?.category, 'Flea/Tick')
ck('and keeps its dosage', posted.medicines[0]?.dosage, '250mg')
ck('no uncaught errors', errs, [])

await browser.close()
console.log(fails ? `\n${fails} FAILED\n` : '\nall passed\n')
process.exit(fails ? 1 : 0)
