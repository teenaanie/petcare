// Leaving a view must actually leave it.
//
// The views were three independent booleans and every navigation had to clear
// the other two by hand. selectPet cleared admin and services but not
// myProviders, and myProviders renders ABOVE selectedPet, so tapping a pet
// while in My Providers left My Providers on screen with the pet behind it.
// An owner hit this after saving a provider: "the provider details on the
// right hand side did not go ... I had to refresh the page."
//
// The path that broke is the one a real owner walks, so that is what this
// walks: My Providers -> a pet, and back out again from every view.

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

let fails = 0
const ck = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(56)} ${JSON.stringify(got)}`)
}

const UID = '88888888-8888-4888-8888-888888888888'
const SESSION = { access_token:'stub', token_type:'bearer', expires_in:360000,
  expires_at:Math.floor(Date.now()/1000)+360000, refresh_token:'stub',
  user:{ id:UID, aud:'authenticated', role:'authenticated', email:'parent@pippy.test',
         app_metadata:{}, user_metadata:{}, created_at:new Date().toISOString() } }
const PET_ID = 'd0000000-0000-4000-8000-00000000beef'
const PET = { id:PET_ID, user_id:UID, name:'Pino', species:'Dog', breed:'Beagle',
  gender:'Male', dob:'2020-04-01', created_at:new Date().toISOString() }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport:{ width:1280, height:1000 } })
await ctx.addInitScript(([k,s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['sb-lumgcfqsiwzbyfhjmkct-auth-token', SESSION])
// Catch-alls first: Playwright checks route handlers last-registered first.
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/pets*', r => r.fulfill({ json: [PET] }))
await ctx.route('**/rest/v1/rpc/provider_facets*', r => r.fulfill({ json:{
  total:0, types:{}, areas:[], states:[], districts:[] } }))

const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/', { waitUntil:'domcontentloaded' })
await page.waitForTimeout(1500)
const no = page.getByRole('button', { name: /^No thanks$/i }).first()
if (await no.count()) await no.click().catch(() => {})
await page.waitForTimeout(400)

const nav  = n => page.getByRole('button', { name: n }).first()
const text = async () => (await page.locator('main').innerText()).slice(0, 500)

// Which view is on screen, by a string ONLY that view renders.
//
// Loose markers are a trap here: the pets LIST carries the words "Find
// Services near you" as its own call to action, so matching /Find Services/
// reports the directory while looking straight at the pet list -- a false
// failure that looks exactly like the bug under test. The two subtitles are
// near-identical too, and differ only in word order:
//   directory  "Vets, groomers, stores and boarding near you"
//   pets list  "Vets, groomers, boarding and stores"
const showing = async () => {
  const t = await text()
  // The directory's own subtitle. Not the search box placeholder -- a
  // placeholder is an attribute, not innerText, so matching it never fires.
  if (/stores and boarding near you/i.test(t)) return 'services'
  if (/Your vets, boarders, groomers and shops/i.test(t)) return 'providers'
  if (/My Pets/i.test(t)) return 'petlist'
  if (/Pino/.test(t)) return 'pets'
  return 'other:' + t.slice(0, 40).replace(/\n/g, ' ')
}

// ── The reported bug: My Providers → a pet ──────────────────────────────────
await nav(/^My Providers$/i).click(); await page.waitForTimeout(900)
ck('My Providers opens', await showing(), 'providers')

await page.getByRole('button', { name: /Pino/ }).first().click()
await page.waitForTimeout(900)
ck('tapping a pet from My Providers opens the pet', await showing(), 'pets')

// ── The same move from every other view ─────────────────────────────────────
await nav(/^Find Services$/i).click(); await page.waitForTimeout(900)
ck('Find Services opens', await showing(), 'services')
await page.getByRole('button', { name: /Pino/ }).first().click()
await page.waitForTimeout(900)
ck('tapping a pet from Find Services opens the pet', await showing(), 'pets')

// ── Crossing between the two provider views ─────────────────────────────────
await nav(/^My Providers$/i).click(); await page.waitForTimeout(800)
await nav(/^Find Services$/i).click(); await page.waitForTimeout(900)
ck('My Providers → Find Services switches', await showing(), 'services')
await nav(/^My Providers$/i).click(); await page.waitForTimeout(900)
ck('Find Services → My Providers switches back', await showing(), 'providers')

// ── A toggle returns to the pets list ───────────────────────────────────────
await nav(/^My Providers$/i).click(); await page.waitForTimeout(900)
ck('toggling My Providers off returns to the pet list', await showing(), 'petlist')

ck('no uncaught errors through the whole walk', errs, [])

await browser.close()
console.log(fails ? `\n${fails} failing` : '\nleaving a view leaves it')
process.exit(fails ? 1 : 0)
