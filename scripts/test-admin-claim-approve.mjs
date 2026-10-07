// The bug the user hit: approving a self-registered listing from the Providers
// tab published it but left the claim pending, so the provider was told
// "approval pending" forever. Reproduces the shape of that row and asserts the
// single click now goes through approve_provider_claim().
// Needs Playwright and a dev server on :5173, neither of which this repo
// depends on — every other test here is node-only. So it skips rather than
// fails when they are missing: a check nobody can run is worse than no check,
// but a check that breaks `npm run` for a contributor who never asked for a
// browser is worse still.
//   npm i -D playwright && npm run dev   (then: npm run test:claim-approve)
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
const OWNER = { id:'8dda0e24-ac89-42fe-b800-cc3f7f2ba2f9', aud:'authenticated', role:'authenticated',
                email:'teena.anie9@gmail.com', app_metadata:{}, user_metadata:{}, created_at:new Date().toISOString() }
const SESSION = { access_token:'stub', token_type:'bearer', expires_in:360000,
                  expires_at:Math.floor(Date.now()/1000)+360000, refresh_token:'stub', user:OWNER }

// Exactly the live row: listing published, claim still pending, user_id null.
const PROVIDER = { id:'p1', name:'Test Boarder', type:'Boarder', area:'Baner', city:'Pune',
  address:null, phone:'9876500000', whatsapp:null, email:null, website:null, hours:null,
  photo_url:null, maps_url:null, is_approved:false, source:'self_registered',
  services:[], specializations:[], description:null }
const CLAIM = { id:'c1', provider_id:'p1', status:'pending', role:'owner', claimed_type:'Boarder',
  claim_note:'Added their own listing from the business sign-in.',
  email:'teena09292602@gmail.com', phone:null, created_at:new Date().toISOString(),
  provider_name:'Test Boarder', provider_type:'Boarder', provider_area:'Baner',
  provider_city:'Pune', provider_phone:'9876500000',
  provider_is_approved:false, provider_source:'self_registered' }

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(52)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport:{ width:1280, height:1000 } })
await ctx.addInitScript(([k,s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['sb-lumgcfqsiwzbyfhjmkct-auth-token', SESSION])

let approveRpc = null
const providerPatches = []
// Catch-alls FIRST: routes match in reverse registration order.
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/auth/v1/user*', r => r.fulfill({ json: OWNER }))
await ctx.route('**/rest/v1/rpc/get_all_users_for_admin*', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/rpc/search_providers*', r =>
  r.fulfill({ json: [{ provider: PROVIDER, total_count: 1 }] }))
await ctx.route('**/rest/v1/rpc/admin_provider_claims*', r => r.fulfill({ json: [CLAIM] }))
await ctx.route('**/rest/v1/rpc/approve_provider_claim*', r => {
  approveRpc = JSON.parse(r.request().postData()); return r.fulfill({ json: null })
})
// The old, wrong path. If this fires on an approve, the bug is still there.
await ctx.route('**/rest/v1/providers*', r => {
  if (r.request().method() === 'PATCH') providerPatches.push(JSON.parse(r.request().postData()))
  return r.fulfill({ json: [PROVIDER] })
})

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/', { waitUntil:'networkidle' })
await page.waitForTimeout(1500)
// The consent banner is fixed to the bottom and swallows clicks until answered.
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(500) }
await page.getByRole('button', { name:'Admin' }).first().click()
await page.waitForTimeout(600)
await page.getByRole('button', { name:'Providers', exact:true }).click()
await page.waitForTimeout(1200)

let t = await page.innerText('body')
ck('the row says somebody is waiting', t.includes('is waiting to manage this'), true)
ck('and names them', t.includes('teena09292602@gmail.com'), true)
ck('and says what approving will do',
   t.includes('approving publishes the listing and lets them in'), true)
await page.screenshot({ path:'/tmp/pippy-claim-row.png', fullPage:true })

// The edit form must answer "who registered this?"
await page.getByRole('button', { name:'Edit' }).first().click()
await page.waitForTimeout(700)
t = await page.innerText('body')
ck('edit form shows who registered it', t.includes('Registered by'), true)
ck('with their address', t.includes('teena09292602@gmail.com'), true)
ck('and says it is not published', t.includes('Not shown in the directory'), true)
await page.screenshot({ path:'/tmp/pippy-claim-edit.png', fullPage:true })
await page.getByRole('button', { name:'Cancel' }).first().click()
await page.waitForTimeout(500)

// The click that was broken.
await page.locator('button[title="Approve"]').first().click()
await page.waitForTimeout(1200)
ck('approve went through the claim RPC', approveRpc, { p_account_id: 'c1' })
ck('and did NOT half-approve the listing', providerPatches, [])
ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)

await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nthe trap is closed')
process.exit(fails ? 1 : 0)
