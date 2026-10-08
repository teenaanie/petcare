// A business editing itself. Run: npm run test:details
//
// Two things worth a browser rather than a unit test:
//
//   · the form reads through my_provider_details(), NOT the table. A listing
//     that is not published cannot be read by its own owner through the
//     directory's policy, and a form that opened empty would then save over
//     what it never saw.
//   · what the save actually SENDS. The whole argument for a SECURITY DEFINER
//     function is that `type`, `is_approved`, `name` and the scraped Google
//     columns are not in it — so this asserts the exact argument list.

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
// Unapproved on purpose: this is the row a plain SELECT would not return.
const DETAILS = [{ id: PROV, name: 'Unleash - The Dog Town', type: 'Boarder',
                   area: 'Baner', city: 'Pune', address: 'Lane 5, Baner',
                   phone: '9000000001', whatsapp: null, email: null, website: null,
                   hours: 'Mon-Sun 7am-8pm', description: null,
                   is_approved: false, boarding_policy: null }]

let fails = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(52)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['pippy-provider-auth', SESSION])

let savedDetails = null, savedPolicy = null, readTable = 0
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/rpc/my_provider_accounts*', r => r.fulfill({ json: ACCOUNT }))
await ctx.route('**/rest/v1/rpc/my_provider_details*', r => r.fulfill({ json: DETAILS }))
await ctx.route('**/rest/v1/rpc/update_my_provider*', r => {
  savedDetails = JSON.parse(r.request().postData()); return r.fulfill({ json: true })
})
await ctx.route('**/rest/v1/rpc/update_my_boarding_policy*', r => {
  savedPolicy = JSON.parse(r.request().postData()); return r.fulfill({ json: true })
})
// The table itself. Nothing should read the listing this way.
await ctx.route('**/rest/v1/providers*', r => { readTable += 1; return r.fulfill({ json: [] }) })

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto('http://localhost:5173/business', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const consent = page.getByRole('button', { name: /No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }
await page.waitForTimeout(800)

const body = async () => (await page.innerText('body')).toUpperCase()
const has  = async s => (await body()).includes(s.toUpperCase())

ck('both panels are offered',   [await has('Your details'), await has('Your boarding criteria')], [true, true])
ck('and collapsed to start',    await has('Save details'), false)
ck('the listing was NOT read from the table', readTable, 0)

await page.getByRole('button').filter({ hasText: 'Your details' }).first().click()
await page.waitForTimeout(400)
ck('it opens on what is there now',
   await page.getByPlaceholder('Mon-Sun 8am-7pm').inputValue(), 'Mon-Sun 7am-8pm')
ck('and says what it will not change', await has('are not editable here'), true)

// One save carrying everything the form holds. Two saves would re-read the
// listing in between and reset the typed fields from the stub, which is exactly
// what the screen should do and not what this is testing.
//
// One business is very often a boarder AND a groomer AND a counter selling
// food. The TYPE decides their tab; these say everything else they do.
await page.getByPlaceholder('98765 43210').first().fill('9823011001')
await page.getByRole('button', { name: /^(✓ )?Grooming$/ }).click()
await page.getByRole('button', { name: /^(✓ )?Pet Supplies$/ }).click()
await page.getByRole('button', { name: 'Save details' }).click()
await page.waitForTimeout(700)
ck('what else they do is saved', savedDetails?.p_services, ['Grooming', 'Pet Supplies'])

ck('it saves through the function', Object.keys(savedDetails || {}).sort(),
   ['p_address','p_area','p_description','p_email','p_hours','p_phone','p_provider_id','p_services','p_website','p_whatsapp'])
ck('with the new number', savedDetails?.p_phone, '9823011001')
// The point of the whole design: these are not in the payload and cannot be.
ck('and nothing it must not touch',
   ['p_type','p_name','p_is_approved','p_categories'].filter(k => k in (savedDetails || {})), [])

// The criteria panel.
await page.getByRole('button').filter({ hasText: 'Your boarding criteria' }).first().click()
await page.waitForTimeout(400)
ck('it says it is showing the standard list', await has('Using the standard list'), true)
ck('and explains who reads it', await has('before they travel'), true)

// The panel opens pre-ticked with the standard list, so the first save is
// "the standard list, plus or minus what I just changed". Microchipping is NOT
// on the standard list — only some boarders ask for it — so ticking it proves
// an addition, while rabies surviving proves the rest came along.
await page.getByRole('button').filter({ hasText: 'Microchipped' }).first().click()
await page.waitForTimeout(700)
ck('a criterion saves as a policy object',
   typeof savedPolicy?.p_policy === 'object' && Array.isArray(savedPolicy.p_policy.required), true)
ck('the new requirement is added',  savedPolicy?.p_policy?.required?.includes('microchip'), true)
ck('and the standard ones came too', savedPolicy?.p_policy?.required?.includes('rabies'), true)

await page.getByRole('button').filter({ hasText: 'A trial day before a first stay' }).first().click()
await page.waitForTimeout(700)
ck('the trial flag is part of the same policy', savedPolicy?.p_policy?.trial_required, true)

// ── A boarder's own criteria ────────────────────────────────────────────────
//
// The catalogue is what the research found boarders asking for. This is for
// what it could not have predicted, and it has to survive the round trip: the
// id goes into `required` as well as `custom`, or the pet parent sees nothing.
await page.getByPlaceholder('A blanket that smells of home').fill('Lift key if you live in a tower')
await page.getByPlaceholder('One line of explanation (optional)').fill('The service lift needs one after 8pm.')
await page.getByRole('button', { name: 'Add this' }).click()
await page.waitForTimeout(700)

const added = (savedPolicy?.p_policy?.custom || [])[0]
ck('it is stored with the policy', [added?.label, added?.help],
   ['Lift key if you live in a tower', 'The service lift needs one after 8pm.'])
// `own_` so a typed criterion can never shadow a catalogue id — `required`
// holds both, and a collision would replace a checked requirement with an
// unchecked one.
ck('its id is prefixed', String(added?.id || '').startsWith('own_'), true)
ck('and it is asked for, not just listed',
   savedPolicy?.p_policy?.required?.includes(added?.id), true)

ck('no page errors', errs.length, 0)
if (errs.length) console.log(errs)
await page.screenshot({ path: '/tmp/pippy-details.png', fullPage: true })
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\na business can describe itself')
process.exit(fails ? 1 : 0)
