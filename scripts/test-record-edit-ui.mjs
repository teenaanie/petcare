// Editing a vaccination or a medicine, driven in the real shell.
// Run: npm run test:record-edit-ui
//
// What this pins: an edit is an UPDATE of the existing record, not a second
// row, and it does not quietly change anything the owner did not touch.
//
// Why it exists: both screens had add, delete and mark-done but no edit, so
// correcting one misread digit on a scanned vaccine meant deleting the record
// and retyping it. The scanner is exactly the thing most likely to get a digit
// wrong.
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

// A scanned record: the vaccine name is the product off the label, which is
// deliberately NOT one of the app's COMMON_VACCINES.
let vaccinations = [{
  id: 'vax-1', pet_id: PET.id, name: 'Felocell', date_given: '2026-09-28',
  next_due: '2026-10-20', batch_number: 'SER-4471', vet: 'Dr Rao',
  notes: '', is_done: false, created_at: new Date().toISOString(),
}]
let medicines = [{
  id: 'med-1', pet_id: PET.id, name: 'Bravecto', dosage: '250mg', frequency: 'Every 3 months',
  category: 'Flea/Tick', start_date: '2026-09-01', end_date: null, next_due: '2026-12-01',
  prescribed_by: 'Dr Rao', reason: 'Prevention', notes: '', is_done: false,
  created_at: new Date().toISOString(),
}]

const writes = { PATCH: [], POST: [] }

let fails = 0
const ck = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(58)} ${JSON.stringify(got)}`)
}

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['sb-lumgcfqsiwzbyfhjmkct-auth-token', SESSION])

// A real store, so "it is an update, not a second row" cannot pass merely
// because the stub refused to grow.
const table = (name, store) => async r => {
  const req = r.request()
  const method = req.method()
  if (method === 'PATCH') {
    const patch = JSON.parse(req.postData())
    const id = (new URL(req.url()).searchParams.get('id') || '').replace('eq.', '')
    writes.PATCH.push({ table: name, id, patch })
    const row = store.find(x => x.id === id)
    if (row) Object.assign(row, patch)
    return r.fulfill({ json: row || null })
  }
  if (method === 'POST') {
    const body = JSON.parse(req.postData())
    const one = Array.isArray(body) ? body[0] : body
    writes.POST.push({ table: name, row: one })
    const saved = { id: `${name}-${store.length + 1}`, created_at: new Date().toISOString(), ...one }
    store.push(saved)
    return r.fulfill({ status: 201, json: saved })
  }
  if (method === 'DELETE') return r.fulfill({ json: [] })
  return r.fulfill({ json: store })
}

// Catch-alls FIRST: Playwright checks handlers last-registered-first, so a
// catch-all registered last swallows every specific route below it.
await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/api/**', r => r.fulfill({ json: { ok: true } }))
await ctx.route('**/rest/v1/rpc/provider_facets*', r => r.fulfill({ json: {
  total: 0, types: {}, areas: [], states: [], districts: [] } }))
await ctx.route('**/rest/v1/pets*', r => r.fulfill({ json: [PET] }))
await ctx.route('**/rest/v1/vaccinations*', r => table('vaccinations', vaccinations)(r))
await ctx.route('**/rest/v1/medicines*',    r => table('medicines', medicines)(r))

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2200)
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }

// Open Daisy
await page.getByRole('button', { name: /Daisy/ }).first().click()
await page.waitForTimeout(1100)

// ── Vaccinations ────────────────────────────────────────────────────────────
const vaxTab = page.getByRole('button', { name: /^Vaccinations?$/i }).first()
if (await vaxTab.count()) { await vaxTab.click(); await page.waitForTimeout(700) }

if (process.env.DEBUG_UI) {
  console.log('--- BODY ---\n' + (await page.innerText('body')).slice(0, 1800))
  console.log('--- BUTTONS ---\n' + JSON.stringify(
    await page.getByRole('button').evaluateAll(ns => ns.map(n => n.innerText || n.getAttribute('aria-label')).slice(0, 60)), null, 0))
}

const pencil = page.getByRole('button', { name: /Edit Felocell/i }).first()
ck('a vaccination card offers an edit', await pencil.count() > 0, true)

if (await pencil.count()) {
  await pencil.click()
  await page.waitForTimeout(500)

  ck('the form says it is editing',
     (await page.innerText('body')).includes('Edit Vaccination Record'), true)

  // The scanned product name must survive being loaded into the form. A
  // <select> of common vaccines would have snapped "Felocell" to "Rabies"
  // the moment the form opened, silently rewriting the record on save.
  const nameVal = await page.locator('input[list="common-vaccines"]').inputValue()
  ck('the real vaccine name is preserved, not snapped to a list', nameVal, 'Felocell')

  const dateVal = await page.locator('input[type="date"]').first().inputValue()
  ck('the existing date is loaded', dateVal, '2026-09-28')

  // Correct a misread next-due date — the actual reason to edit a scan.
  const dues = page.locator('input[type="date"]')
  await dues.nth(1).fill('2026-11-15')
  await page.getByRole('button', { name: /Save changes/i }).click()
  await page.waitForTimeout(900)

  const vaxPatch = writes.PATCH.filter(w => w.table === 'vaccinations')
  ck('saving issues an update', vaxPatch.length, 1)
  ck('against the record that was edited', vaxPatch[0]?.id, 'vax-1')
  ck('with the corrected date', vaxPatch[0]?.patch?.next_due, '2026-11-15')
  ck('and no new row is created', writes.POST.filter(w => w.table === 'vaccinations').length, 0)
  ck('the store still holds one vaccination', vaccinations.length, 1)
  ck('untouched fields are not lost', vaccinations[0].batch_number, 'SER-4471')
}

// A record already marked given must not be quietly reopened by an edit.
vaccinations[0].is_done = true
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
{
  const c2 = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
  if (await c2.count()) { await c2.click(); await page.waitForTimeout(400) }
  await page.getByRole('button', { name: /Daisy/ }).first().click()
  await page.waitForTimeout(1100)
  const vt = page.getByRole('button', { name: /^Vaccinations?$/i }).first()
  if (await vt.count()) { await vt.click(); await page.waitForTimeout(700) }

  const p2 = page.getByRole('button', { name: /Edit Felocell/i }).first()
  if (await p2.count()) {
    await p2.click(); await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Save changes/i }).click()
    await page.waitForTimeout(900)
    const last = writes.PATCH.filter(w => w.table === 'vaccinations').at(-1)
    ck('editing a given record leaves it given', last?.patch?.is_done, true)
  } else {
    ck('editing a given record leaves it given', 'no edit button on a done record', true)
  }
}

// ── Medicines ───────────────────────────────────────────────────────────────
const medTab = page.getByRole('button', { name: /^Medicines?$/i }).first()
if (await medTab.count()) { await medTab.click(); await page.waitForTimeout(700) }

const medPencil = page.getByRole('button', { name: /Edit Bravecto/i }).first()
ck('a medicine card offers an edit', await medPencil.count() > 0, true)

if (await medPencil.count()) {
  await medPencil.click()
  await page.waitForTimeout(500)
  ck('the medicine form says it is editing',
     (await page.innerText('body')).includes('Edit Medicine'), true)

  const dosage = page.getByPlaceholder('e.g. 40mg, 5ml')
  ck('the existing dosage is loaded', await dosage.inputValue(), '250mg')
  await dosage.fill('500mg')
  await page.getByRole('button', { name: /Save changes/i }).click()
  await page.waitForTimeout(900)

  const medPatch = writes.PATCH.filter(w => w.table === 'medicines')
  ck('saving issues an update', medPatch.length, 1)
  ck('against the medicine that was edited', medPatch[0]?.id, 'med-1')
  ck('with the corrected dosage', medPatch[0]?.patch?.dosage, '500mg')
  ck('and no new row is created', writes.POST.filter(w => w.table === 'medicines').length, 0)
  ck('fields the owner did not touch survive', medicines[0].prescribed_by, 'Dr Rao')
}

ck('no uncaught errors in the page', errs, [])

await browser.close()
console.log(fails ? `\n${fails} FAILED\n` : '\nall passed\n')
process.exit(fails ? 1 : 0)
