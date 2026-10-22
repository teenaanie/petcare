// Adding a pet, driven in the real shell. Run: npm run test:add-pet-ui
//
// Three faults seen while demonstrating the app to someone:
//
//   1. "the note that says I want to speak ahead [has] no indication of a
//      voice or a mic" -- the offer carried a sparkle, so nobody tried talking.
//   2. "when the save was clicked, it didn't allow me to edit any information"
//      -- Save moved to the reminders step and the details were unreachable.
//   3. "the person did not choose a reminder and closed the box, and the pet
//      was not saved" -- it HAD been saved; savePet runs before that step. But
//      closing only shut the modal, while finishing also refreshes the list,
//      so the pet sat in the database and never appeared on screen.
//
// Three is the one that matters, and the test for it has to assert the pet is
// ON SCREEN. Asserting that a POST happened would have passed throughout --
// the POST always happened.
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

let fails = 0
const ck = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(58)} ${JSON.stringify(got)}`)
}

// One browser per scenario: a pet saved in one must not leak into the next.
async function withApp(fn) {
  const pets = []
  const writes = { POST: [], PATCH: [] }
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
  await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
    ['sb-lumgcfqsiwzbyfhjmkct-auth-token', SESSION])

  await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
  await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
  await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
  await ctx.route('**/api/**', r => r.fulfill({ json: { ok: true } }))
  // The parse the voice screen depends on. Stubbed so the review screen can be
  // reached without a recording or a real model call.
  await ctx.route('**/api/ai-complete*', r => r.fulfill({ json: {
    result: { pets: [{ name: 'Simba', species: 'Cat', breed: 'Indie' }] },
  } }))
  // A real store, so "the pet appears" cannot pass because the stub always
  // returned it, and a duplicate POST really does produce two pets.
  await ctx.route('**/rest/v1/pets*', async r => {
    const req = r.request()
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData())
      const one = Array.isArray(body) ? body[0] : body
      writes.POST.push(one)
      const saved = { id: `pet-${pets.length + 1}`, user_id: UID,
                      created_at: new Date().toISOString(), ...one }
      pets.push(saved)
      return r.fulfill({ status: 201, json: saved })
    }
    if (req.method() === 'PATCH') {
      const id = (new URL(req.url()).searchParams.get('id') || '').replace('eq.', '')
      const patch = JSON.parse(req.postData())
      writes.PATCH.push({ id, patch })
      const row = pets.find(p => p.id === id)
      if (!row) return r.fulfill({ status: 200, json: null })
      Object.assign(row, patch)
      return r.fulfill({ json: row })
    }
    return r.fulfill({ json: pets })
  })

  const page = await ctx.newPage()
  const errs = []; page.on('pageerror', e => errs.push(e.message))
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1900)
  const no = page.getByRole('button', { name: /^No thanks$/i }).first()
  if (await no.count()) await no.click().catch(() => {})
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /^Add Pet$/i }).first().click()
  await page.waitForTimeout(700)
  // Everything below is inside the modal. Scoped, because the page behind it
  // has its own "Add Pet" button and an unscoped match hits that one.
  const modal = page.locator('.fixed.inset-0').last()

  try { await fn({ page, modal, pets, writes, errs }) } finally { await browser.close() }
}

console.log('\n1. The offer to speak looks like speaking')
await withApp(async ({ modal }) => {
  const speak = modal.getByRole('button', { name: /speak/i }).first()
  ck('an offer mentioning "speak" is on the form', await speak.count() > 0, true)
  // The icon is the affordance; the words alone were there before and missed.
  const hasMic = await speak.evaluate(el => {
    const svg = el.querySelector('svg')
    if (!svg) return false
    // lucide renders the name as a class, e.g. "lucide-mic".
    return /mic/i.test(svg.getAttribute('class') || '')
  })
  ck('it carries a microphone icon, not a sparkle', hasMic, true)
})

console.log('\n2. The details stay editable after Save')
await withApp(async ({ page, modal, pets, writes }) => {
  await modal.getByPlaceholder('e.g. Buddy').fill('Rufus')
  await modal.getByPlaceholder('e.g. Golden Retriever').fill('Beagle')
  await modal.getByRole('button', { name: /^Save Pet$|^Save Changes$/ }).click()
  await page.waitForTimeout(1200)

  ck('the pet is written once', writes.POST.length, 1)
  const edit = modal.getByRole('button', { name: /^Edit Rufus$/i }).first()
  ck('the reminders step offers a way back to the details', await edit.count() > 0, true)

  await edit.click()
  await page.waitForTimeout(600)
  ck('the details come back filled in',
     await modal.getByPlaceholder('e.g. Buddy').inputValue(), 'Rufus')

  await modal.getByPlaceholder('e.g. Golden Retriever').fill('Labrador')
  await modal.getByRole('button', { name: /^Save Pet$|^Save Changes$/ }).click()
  await page.waitForTimeout(1200)

  // The trap: without the id carried back into the form, this makes a SECOND
  // pet rather than correcting the first.
  ck('saving again updates rather than duplicating', writes.POST.length, 1)
  ck('and it is a real update', writes.PATCH.length >= 1, true)
  ck('with the corrected breed', writes.PATCH.at(-1)?.patch?.breed, 'Labrador')
  ck('there is still exactly one pet', pets.length, 1)
})

console.log('\n3. Closing the reminder step does not lose the pet')
await withApp(async ({ page, modal, pets, errs }) => {
  await modal.getByPlaceholder('e.g. Buddy').fill('Mango')
  await modal.getByRole('button', { name: /^Save Pet$|^Save Changes$/ }).click()
  await page.waitForTimeout(1200)
  ck('the reminders step is showing',
     /Recommended Reminders/i.test(await page.innerText('body')), true)
  ck('the pet reached the database', pets.length, 1)

  // Close WITHOUT choosing a reminder — exactly what the demo did.
  await modal.locator('button').filter({ has: page.locator('svg.lucide-x') }).first().click()
  await page.waitForTimeout(1500)

  const body = await page.innerText('body')
  ck('the modal is gone', /Recommended Reminders/i.test(body), false)
  // THE assertion. The pet was always in the database; what was missing was
  // the refresh that puts it on screen.
  ck('and the pet is on screen', /Mango/.test(body), true)
  ck('no uncaught errors', errs, [])
})

console.log('\n4. The same, by voice — closing must not lose them either')
await withApp(async ({ page, modal, pets, errs }) => {
  await modal.getByRole('button', { name: /speak/i }).first().click()
  await page.waitForTimeout(900)

  // Type rather than record: the microphone is the browser's, not ours, and
  // what is under test here is what happens AFTER the pets are saved.
  const voice = page.locator('.fixed.inset-0').last()
  const type = voice.getByRole('button', { name: /type/i }).first()
  if (await type.count()) { await type.click(); await page.waitForTimeout(500) }
  const box = voice.locator('textarea').first()
  await box.fill('I have a cat called Simba, an indie')
  await voice.getByRole('button', { name: /sort|parse|continue|next|review/i }).first().click()
  await page.waitForTimeout(1500)

  await voice.getByRole('button', { name: /save/i }).first().click()
  await page.waitForTimeout(1800)
  ck('the voice path saved the pet', pets.length, 1)

  // Close at the reminder step, without choosing one.
  await voice.locator('button').filter({ has: page.locator('svg.lucide-x') }).first().click()
  await page.waitForTimeout(900)
  // And close the pet form behind it, the same way.
  const outer = page.locator('.fixed.inset-0').last()
  if (await outer.count()) {
    await outer.locator('button').filter({ has: page.locator('svg.lucide-x') }).first()
      .click().catch(() => {})
    await page.waitForTimeout(1500)
  }

  const body = await page.innerText('body')
  ck('the spoken pet is on screen', /Simba/.test(body), true)
  ck('no uncaught errors', errs, [])
})

console.log(fails ? `\n${fails} FAILED\n` : '\nall passed\n')
process.exit(fails ? 1 : 0)
