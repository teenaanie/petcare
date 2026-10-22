// Ticking something off the notification bell. Run: npm run test:bell-tick-ui
//
// The report: "when I click the tick of the notification, it's telling me that
// reminder belongs to a pet you can view but not edit ... although these are
// my own pets."
//
// The cause: the bell lists three kinds of thing now -- reminders, vaccination
// due dates and medicine due dates -- and the tick sent every one of them to
// markReminderDone. A vaccination's id matches no row in `reminders`, and the
// zero-rows case is reported as a sharing problem, so ticking off your own
// pet's booster accused you of not owning it.
//
// What this pins is WHICH TABLE the write lands in, which is the thing that
// was wrong. Asserting "no error appeared" would pass the day it writes to the
// wrong table silently.
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
const PET = { id: 'pet-1', user_id: UID, name: 'Daisy', species: 'Cat', breed: 'Indie',
              date_of_birth: '2024-02-01', gender: 'Female', created_at: new Date().toISOString() }

// Today in IST, which is what the feed buckets against.
const TODAY = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0]

let fails = 0
const ck = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(58)} ${JSON.stringify(got)}`)
}

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['sb-lumgcfqsiwzbyfhjmkct-auth-token', SESSION])

const vaccinations = [{ id: 'vax-1', pet_id: 'pet-1', name: 'Felocell', date_given: '2026-09-28',
                        next_due: TODAY, batch_number: 'B', vet: 'Dr Rao', notes: '',
                        is_done: false, created_at: new Date().toISOString() }]
const medicines = [{ id: 'med-1', pet_id: 'pet-1', name: 'Bravecto', dosage: '250mg',
                     frequency: 'Monthly', category: 'Flea/Tick', start_date: '2026-09-01',
                     end_date: null, next_due: TODAY, prescribed_by: null, reason: null,
                     notes: null, is_done: false, created_at: new Date().toISOString() }]

// Every PATCH, and the table it went to. This is the assertion.
const patches = []
const table = (name, store) => async r => {
  const req = r.request()
  if (req.method() === 'PATCH') {
    const id = (new URL(req.url()).searchParams.get('id') || '').replace('eq.', '')
    const patch = JSON.parse(req.postData())
    patches.push({ table: name, id, patch })
    const row = store.find(x => x.id === id)
    // Answer as PostgREST does: the updated row, or nothing when none matched.
    // Returning a row unconditionally would hide a write aimed at the wrong
    // table, which is the entire bug.
    if (!row) return r.fulfill({ status: 200, json: null })
    Object.assign(row, patch)
    return r.fulfill({ json: row })
  }
  return r.fulfill({ json: store })
}

await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/api/**', r => r.fulfill({ json: { ok: true } }))
await ctx.route('**/rest/v1/pets*', r => r.fulfill({ json: [PET] }))
await ctx.route('**/rest/v1/reminders*',    r => table('reminders', [])(r))
await ctx.route('**/rest/v1/vaccinations*', r => table('vaccinations', vaccinations)(r))
await ctx.route('**/rest/v1/medicines*',    r => table('medicines', medicines)(r))

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
const no = page.getByRole('button', { name: /^No thanks$/i }).first()
if (await no.count()) await no.click().catch(() => {})
await page.waitForTimeout(1400)

const bell = page.getByRole('button', { name: /notification|reminder|bell/i }).first()
ck('the bell is there', await bell.count() > 0, true)
await bell.click()
await page.waitForTimeout(1400)

const panelHas = async s => (await page.innerText('body')).includes(s)
ck('the vaccination is listed', await panelHas('Felocell due'), true)
ck('the medicine is listed',    await panelHas('Bravecto due'), true)

// Tick the vaccination.
const vaxRow = page.locator('li, div').filter({ hasText: 'Felocell due' }).last()
const tick = vaxRow.getByRole('button').filter({ hasNot: page.locator('text=Felocell') }).last()
await tick.click()
await page.waitForTimeout(1600)

const vaxPatches = patches.filter(p => p.table === 'vaccinations')
ck('the write goes to the vaccinations table', vaxPatches.length, 1)
ck('against the vaccination that was ticked', vaxPatches[0]?.id, 'vax-1')
ck('setting it done', vaxPatches[0]?.patch?.is_done, true)
// The bug: this used to be the ONLY write, and it matched nothing.
ck('nothing is written to the reminders table',
   patches.filter(p => p.table === 'reminders').length, 0)

let body = await page.innerText('body')
ck('no false "you can view but not edit" message',
   /view but not edit/i.test(body), false)
ck('the ticked item leaves the panel', /Felocell due/.test(body), false)
ck('the other item stays', /Bravecto due/.test(body), true)

// And the medicine, so BOTH dispatch entries are pinned. Without this, losing
// the medicines entry would fall through to reminders and no test would notice.
const medRow = page.locator('li, div').filter({ hasText: 'Bravecto due' }).last()
await medRow.getByRole('button').last().click()
await page.waitForTimeout(1600)

const medPatches = patches.filter(p => p.table === 'medicines')
ck('the medicine write goes to the medicines table', medPatches.length, 1)
ck('against the medicine that was ticked', medPatches[0]?.id, 'med-1')
ck('still nothing written to reminders',
   patches.filter(p => p.table === 'reminders').length, 0)

body = await page.innerText('body')
ck('the medicine leaves the panel too', /Bravecto due/.test(body), false)
ck('no false sharing message for the medicine either',
   /view but not edit/i.test(body), false)
ck('no uncaught errors', errs, [])

await browser.close()
console.log(fails ? `\n${fails} FAILED\n` : '\nall passed\n')
process.exit(fails ? 1 : 0)
