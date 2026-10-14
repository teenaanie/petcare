// The place filters: state → district → area, widest first.
//
// Each dropdown renders only when there is more than one thing to pick, so a
// directory covering one state shows nothing new. That is deliberate, and it
// is also why the owner could not find the feature after #107 shipped: the
// database held one state and one district, so both were correctly hidden.
//
// This pins both halves — hidden with one option, shown with two — because
// "it works, you just cannot see it" is only worth saying if it is true.

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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(52)} ${JSON.stringify(got)}`)
}

const row = (id, name, type, area, state, district) => ({
  provider: { id, name, type, area, city: district, state, district, is_approved: true,
              phone: '9999900000', services: [], specializations: [], categories: [] },
  total_count: 4,
})
const DIRECTORY = [
  row('p1', 'Kochi Pet Clinic',   'Vet',     'Kadavanthra', 'Keralam',     'Ernakulam'),
  row('p2', 'Thrissur Pet Store', 'Store',   'Punkunnam',   'Keralam',     'Thrissur'),
  row('p3', 'Kothrud Groomers',   'Groomer', 'Kothrud',     'Maharashtra', 'Pune'),
  row('p4', 'Baner Boarding',     'Boarder', 'Baner',       'Maharashtra', 'Pune'),
]

const ONE_STATE = {
  total: 2, types: { Groomer: 1, Boarder: 1 },
  areas: [{ area: 'Kothrud', count: 1 }, { area: 'Baner', count: 1 }],
  states: [{ state: 'Maharashtra', count: 2 }],
  districts: [{ district: 'Pune', count: 2 }],
}
const TWO_STATES = {
  total: 4, types: { Vet: 1, Store: 1, Groomer: 1, Boarder: 1 },
  areas: [{ area: 'Kadavanthra', count: 1 }, { area: 'Punkunnam', count: 1 },
          { area: 'Kothrud', count: 1 }, { area: 'Baner', count: 1 }],
  states: [{ state: 'Keralam', count: 2 }, { state: 'Maharashtra', count: 2 }],
  districts: [{ district: 'Ernakulam', count: 1 }, { district: 'Thrissur', count: 1 },
              { district: 'Pune', count: 2 }],
}

const UID = '77777777-7777-4777-8777-777777777777'
const USER = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'parent@pippy.test',
               app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const SESSION = { access_token: 'stub', token_type: 'bearer', expires_in: 360000,
                  expires_at: Math.floor(Date.now() / 1000) + 360000,
                  refresh_token: 'stub', user: USER }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})

async function openDirectory(facets) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
  // Same stub session the walk tests use: supabase-js derives its storage key
  // from the project ref, so this is the key the app will actually read.
  await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
    ['sb-lumgcfqsiwzbyfhjmkct-auth-token', SESSION])
  let lastFacetsBody = null
  // Order matters: Playwright checks route handlers LAST-registered first, so
  // the catch-alls go first and the specific ones after. Registered the other
  // way round, the catch-all answers provider_facets with [] and no dropdown
  // ever renders -- which looks exactly like the feature being broken.
  await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
  await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
  await ctx.route('**/rest/v1/rpc/search_providers*', r => r.fulfill({ json: DIRECTORY }))
  await ctx.route('**/rest/v1/rpc/provider_facets*', r => {
    lastFacetsBody = r.request().postData()
    return r.fulfill({ json: facets })
  })
  const page = await ctx.newPage()
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1400)
  // The analytics consent banner opens over everything on a fresh profile.
  const no = page.getByRole('button', { name: /^No thanks$/i }).first()
  if (await no.count()) await no.click({ timeout: 3000 }).catch(() => {})
  // "Find Services" is the directory's entry point in the pet-parent app.
  const entry = page.getByRole('button', { name: /^Find Services$/i }).first()
  await entry.click({ timeout: 6000 })
  await page.waitForTimeout(1400)
  return { page, ctx, facetsBody: () => lastFacetsBody }
}

const labels = async page => {
  const out = []
  for (const sel of await page.locator('select').all()) {
    const l = await sel.getAttribute('aria-label')
    if (l) out.push(l)
  }
  return out.sort()
}

// ── One state: nothing new appears ──────────────────────────────────────────
{
  const { page, ctx } = await openDirectory(ONE_STATE)
  const found = await labels(page)
  ck('one state  — no State dropdown',    found.includes('State'), false)
  ck('one state  — no District dropdown', found.includes('District'), false)
  ck('one state  — Area dropdown stays',  found.includes('Area'), true)
  await ctx.close()
}

// ── Two states: both appear, with counts ────────────────────────────────────
{
  const { page, ctx } = await openDirectory(TWO_STATES)
  const found = await labels(page)
  ck('two states — State dropdown shows',    found.includes('State'), true)
  ck('two states — District dropdown shows', found.includes('District'), true)
  ck('two states — Area dropdown shows',     found.includes('Area'), true)

  const stateSel = page.locator('select[aria-label="State"]')
  const opts = await stateSel.locator('option').allTextContents()
  ck('states listed, widest first', opts, ['All states', 'Keralam (2)', 'Maharashtra (2)'])

  const distOpts = await page.locator('select[aria-label="District"] option').allTextContents()
  ck('districts listed with counts', distOpts,
     ['All districts', 'Ernakulam (1)', 'Thrissur (1)', 'Pune (2)'])
  await ctx.close()
}

// ── Choosing a state narrows the district list ──────────────────────────────
{
  const { page, ctx, facetsBody } = await openDirectory(TWO_STATES)
  await page.locator('select[aria-label="State"]').selectOption('Keralam')
  await page.waitForTimeout(700)
  const body = facetsBody() || ''
  ck('picking a state refetches facets with it', /Keralam/.test(body), true)
  ck('and does not pin a district',             /filter_district":"/.test(body), false)
  await ctx.close()
}

await browser.close()
console.log(fails ? `\n${fails} failing` : '\nthe place filters appear exactly when there is a choice')
process.exit(fails ? 1 : 0)
