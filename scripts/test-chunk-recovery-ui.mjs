// A tab whose chunk fails, driven in the real shell.
// Run: npm run test:chunk-recovery-ui
//
// The report: "editing the medical records and vaccination, sometimes it works,
// but sometimes it is giving a load error. And then when I click again, it
// works."
//
// What was actually happening, measured here rather than reasoned about: the
// tab's lazy chunk failed to import, ChunkErrorBoundary force-reloaded the
// page, and the reload landed on the PET LIST -- because the open pet and the
// open tab are React state and nothing survives a reload. So a dropped request
// read as "it threw me out of the record", and clicking back in worked.
//
// Two things are pinned here, and the unit tests cannot pin either: that the
// BROWSER really re-fetches a module whose first request failed, and that the
// app comes back to the same pet and tab when a reload is unavoidable.
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
const VAX = [{ id: 'vax-1', pet_id: 'pet-1', name: 'Felocell', date_given: '2026-09-28',
               next_due: '2026-10-20', batch_number: 'SER-4471', vet: 'Dr Rao', notes: '',
               is_done: false, created_at: new Date().toISOString() }]

let fails = 0
const ck = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(56)} ${JSON.stringify(got)}`)
}

// One scenario = one browser, because the reload guard and the resume point
// both live in sessionStorage and must start clean.
async function run({ failTimes }) {
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
    ['sb-lumgcfqsiwzbyfhjmkct-auth-token', SESSION])

  await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
  await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
  await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
  await ctx.route('**/api/**', r => r.fulfill({ json: { ok: true } }))
  await ctx.route('**/rest/v1/pets*', r => r.fulfill({ json: [PET] }))
  await ctx.route('**/rest/v1/vaccinations*', r => r.fulfill({ json: VAX }))

  // Fail the Vaccinations module's first `failTimes` requests, then serve it.
  // Both spellings: the dev server serves the .jsx source, a build serves a
  // hashed chunk, and this should hold either way.
  let attempts = 0
  const flaky = r => {
    attempts++
    if (attempts <= failTimes) return r.abort('failed')
    return r.continue()
  }
  await ctx.route('**/Vaccinations-*.js', flaky)
  await ctx.route('**/components/Vaccinations.jsx*', flaky)

  let navs = 0
  const page = await ctx.newPage()
  page.on('framenavigated', f => { if (f === page.mainFrame()) navs++ })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  const no = page.getByRole('button', { name: /^No thanks$/i }).first()
  if (await no.count()) await no.click().catch(() => {})
  await page.waitForTimeout(500)

  await page.getByRole('button', { name: /Daisy/ }).first().click()
  await page.waitForTimeout(1200)
  const navsBefore = navs

  await page.getByRole('button', { name: /^Vaccinations?$/i }).first().click()
  await page.waitForTimeout(5000)

  const screen = await page.locator('main').innerText()
  const out = {
    attempts,
    reloaded: navs > navsBefore,
    // The record itself being on screen is the only proof the tab truly loaded.
    showsRecord: /Felocell/.test(screen),
    // The boundary's own words.
    showsLoadError: /did not finish loading/i.test(screen),
    // The pet list's heading, which is where the reload used to dump you.
    bouncedToPetList: /Add Pet/i.test(screen) && !/Felocell/.test(screen),
  }
  await browser.close()
  return out
}

console.log('\nOne dropped request — the common case')
{
  const r = await run({ failTimes: 1 })
  // The whole point of the retry: the user never finds out.
  ck('the chunk is fetched twice', r.attempts, 2)
  ck('the record is on screen', r.showsRecord, true)
  ck('no load error is shown', r.showsLoadError, false)
  ck('the page is NOT reloaded', r.reloaded, false)
  ck('the user is not bounced to the pet list', r.bouncedToPetList, false)
}

console.log('\nA genuinely stale chunk — retry cannot save it')
{
  const r = await run({ failTimes: 2 })
  ck('it gives up after two attempts', r.attempts >= 2, true)
  ck('the page reloads to pick up a fresh index', r.reloaded, true)
  // The fix: the reload used to land on the pet list, losing the record.
  ck('and comes back to the same pet and tab', r.showsRecord, true)
  ck('not to the pet list', r.bouncedToPetList, false)
}

console.log(fails ? `\n${fails} FAILED\n` : '\nall passed\n')
process.exit(fails ? 1 : 0)
