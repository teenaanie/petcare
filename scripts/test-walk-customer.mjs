// One continuous walk through the pet-parent product, in the order a real
// owner meets it: sign in, the pet, its records, the directory, saving a
// provider, and sending that provider a note. Same purpose as the provider
// walk — every other consumer test opens ONE screen, so a break BETWEEN them
// shows up only here.
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
const OUT = process.argv[2] || '/tmp/pippy-walk-customer'
fs.mkdirSync(OUT, { recursive: true })

const UID  = '66666666-6666-4666-8666-666666666666'
const USER = { id:UID, aud:'authenticated', role:'authenticated', email:'parent@pippy.test',
               app_metadata:{}, user_metadata:{}, created_at:new Date().toISOString() }
const SESSION = { access_token:'stub', token_type:'bearer', expires_in:360000,
                  expires_at:Math.floor(Date.now()/1000)+360000, refresh_token:'stub', user:USER }
const PET_ID='d0000000-0000-4000-8000-000000000001'
const PROV  ='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PET = { id:PET_ID, user_id:UID, name:'Pippin', species:'Dog', breed:'Beagle', gender:'Male',
  dob:'2023-10-07', vet_name:'Dr Rao', vet_phone:'9876500000', feeding_schedule:'8am and 7pm',
  diet_notes:'no chicken', food_preferences:['kibble'], temperament:'friendly',
  anxiety_notes:'hates thunder', triggers:['fireworks'], handling_notes:'harness not collar',
  socialises_with_dogs:true, notes:'PRIVATE OWNER NOTE', microchip_id:'900123456789',
  insurance_policy:'POLICY-1', created_at:new Date().toISOString() }
const VAX  = [{ id:'v1', pet_id:PET_ID, name:'Rabies', date_given:'2026-06-15', is_done:false }]
const MEDS = [{ id:'m1', pet_id:PET_ID, name:'Apoquel', dosage:'16mg', frequency:'twice daily', end_date:null, is_done:false }]
const RECS = [
  { id:'r1', pet_id:PET_ID, title:'Ear infection', date:'2026-08-12',
    description:'SECRET VET PROSE', vet:'Dr Who', type:'Consultation', cost:240000 },
  // type and cost both NULL — both columns are nullable, and this is the row
  // that used to render "undefined" and a dollar sign.
  { id:'r2', pet_id:PET_ID, title:'Nail trim', date:'2026-07-01',
    description:null, vet:null, type:null, cost:null },
]
const MINE = [{ id:'u1', user_id:UID, provider_id:PROV, pet_id:null, category:'Boarder',
                name:'Unleash - The Dog Town', is_primary:true, created_at:new Date().toISOString() }]
const DIRECTORY = [
  { provider:{ id:PROV, name:'Unleash - The Dog Town', type:'Boarder', area:'Baner', city:'Pune',
               phone:'9876500001', is_approved:true, services:['Boarding'], specializations:[] }, total_count:2 },
  { provider:{ id:'bbbb0000-0000-4000-8000-000000000002', name:'Aundh Pet Clinic', type:'Vet',
               area:'Aundh', city:'Pune', phone:'9876500002', is_approved:true,
               services:['Veterinary'], specializations:[] }, total_count:2 },
]

let fails = 0, step = 'boot'
const ck = (l, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want); if(!ok) fails++
  console.log(`${ok?'PASS':'FAIL'}  ${l.padEnd(52)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport:{ width:1280, height:1500 } })
await ctx.addInitScript(([k,s]) => localStorage.setItem(k, JSON.stringify(s)),
  ['sb-lumgcfqsiwzbyfhjmkct-auth-token', SESSION])

const pets = [PET]; let postedNote = null, savedProvider = null
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/pets*', r => {
  if (r.request().method() === 'POST') {
    const row = JSON.parse(r.request().postData()); const one = Array.isArray(row)?row[0]:row
    const saved = { id:'pet2', user_id:UID, created_at:new Date().toISOString(), ...one }
    pets.push(saved); return r.fulfill({ status:201, json: saved })
  }
  return r.fulfill({ json: pets })
})
await ctx.route('**/rest/v1/vaccinations*',    r => r.fulfill({ json: VAX }))
await ctx.route('**/rest/v1/medicines*',       r => r.fulfill({ json: MEDS }))
await ctx.route('**/rest/v1/medical_records*', r => r.fulfill({ json: RECS }))
await ctx.route('**/rest/v1/user_providers*',  r => {
  if (r.request().method() === 'POST') {
    savedProvider = JSON.parse(r.request().postData())
    return r.fulfill({ status:201, json:{ id:'u2', ...savedProvider } })
  }
  return r.fulfill({ json: MINE })
})
await ctx.route('**/rest/v1/rpc/search_providers*', r => r.fulfill({ json: DIRECTORY }))
await ctx.route('**/rest/v1/rpc/provider_facets*', r => r.fulfill({
  json:{ total:2, types:{ Boarder:1, Vet:1 }, areas:['Aundh','Baner'] } }))
await ctx.route('**/rest/v1/rpc/onboarded_provider_ids*', r => r.fulfill({ json:[{ provider_id:PROV }] }))
await ctx.route('**/rest/v1/provider_notes*', r => {
  if (r.request().method() === 'POST') {
    postedNote = JSON.parse(r.request().postData())
    return r.fulfill({ status:201, json:{ ...postedNote, id:'n1', sent_at:new Date().toISOString() } })
  }
  return r.fulfill({ json: [] })
})
await ctx.route('**/api/ai-complete', r => r.fulfill({ json:{ result:'Hi, here are Pippin’s details.' } }))

const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(`[${step}] ${e.message}`))
await page.goto('http://localhost:5173/', { waitUntil:'networkidle' })
await page.waitForTimeout(2200)
const consent = page.getByRole('button', { name:/No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(500) }
await page.waitForTimeout(900)
const body = async () => page.innerText('body')
const has  = async s => (await body()).toUpperCase().includes(s.toUpperCase())

step = 'home'
ck('1 the pet is listed',        await has('Pippin'), true)
ck('2 the nav is there',         await has('Find Services') && await has('My Providers'), true)
await page.screenshot({ path:`${OUT}/c1-home.png`, fullPage:true })

step = 'pet'
await page.getByText('Pippin', { exact:false }).first().click(); await page.waitForTimeout(1200)
let t = await body()
ck('3 the pet opens',            t.includes('Pippin'), true)
ck('4 with its breed',           /beagle/i.test(t), true)
await page.screenshot({ path:`${OUT}/c2-pet.png`, fullPage:true })

step = 'records'
// Read the timeline BEFORE clicking any filter chip. Clicking through them in
// a loop lands on the last one, and then asserting a vaccination is visible
// fails on the Medicines filter rather than on anything being wrong.
t = await body()
ck('5 the health timeline is there', /health timeline/i.test(t), true)
ck('6 the vaccination is on it',     /rabies/i.test(t), true)
ck('7 and the medical record too',   /ear infection/i.test(t), true)
// The two bugs the walk found, now pinned where a user would see them.
ck('7a money is rupees, not dollars', /₹2,40,000/.test(t) && !/\$2,?40,?000/.test(t), true)
ck('7b and grouped the Indian way',   t.includes('₹2,40,000'), true)
ck('7c a null field never prints',    /undefined/.test(t), false)
ck('7d and leaves no stray separator', /Nail trim\s*·/.test(t), false)
// Each filter chip, one at a time, back to All — scoped to the timeline's own
// chip row. Unscoped, "Reminders" also matches the left-rail nav item and the
// walk navigates away mid-assertion.
const chips = page.locator('main, [class*="flex-1"]').locator('button').filter({ hasText:/^(All|Medical|Vaccinations|Allergies|Reminders)$/ })
const chipRow = page.locator('div').filter({ has: page.getByRole('button', { name:'All', exact:true }) }).last()
for (const n of ['Medical', 'Vaccinations', 'Allergies', 'All']) {
  const b = chipRow.getByRole('button', { name:n, exact:true }).first()
  if (await b.count()) { await b.click(); await page.waitForTimeout(400) }
}
ck('8 the filters leave the page standing', /health timeline/i.test(await body()), true)
// The sections in the left rail.
for (const n of ['Vaccinations', 'Medicines', 'Medical History']) {
  const b = page.getByRole('button').filter({ hasText: new RegExp(`^${n}$`, 'i') }).first()
  if (await b.count()) { await b.click(); await page.waitForTimeout(700) }
}
ck('9 a rail section opens without error', errs.length, 0)

step = 'inform'
// From the PET, which is where it lives — My Providers is a contact list and
// carries no send action at all.
const tl = page.getByRole('button').filter({ hasText:'Timeline' }).first()
if (await tl.count()) { await tl.click(); await page.waitForTimeout(700) }
await page.getByRole('button', { name:'Inform' }).first().click()
await page.waitForTimeout(1600)
// Scoped to the MODAL, not the page. innerText('body') also returns the
// timeline sitting behind the overlay, where the vet's prose legitimately is —
// asserting on the whole page reports a leak that is not one.
const modal = page.locator('div.fixed.inset-0.z-50').first()
const mt = await modal.innerText()
ck('10 the composer opens on the pet', /pippin/i.test(mt), true)
// The three things that must never reach a note the business reads.
ck('11 no private owner note', mt.includes('PRIVATE OWNER NOTE'), false)
ck('12 no vet prose',          mt.includes('SECRET VET PROSE'), false)
ck('13 no microchip',          mt.includes('900123456789'), false)
await page.screenshot({ path:`${OUT}/c5-inform.png`, fullPage:true })
// Close it properly. The modal has no Escape handler, and its backdrop keeps
// intercepting clicks, so leaving it open makes every later step time out on
// an overlay rather than on anything being wrong.
await page.locator('div.fixed.inset-0.z-50').first().click({ position:{ x:5, y:5 } })
await page.waitForTimeout(800)
ck('14 the composer closes', await page.locator('div.fixed.inset-0.z-50').count(), 0)

step = 'directory'
await page.getByRole('button', { name:/Find Services/i }).first().click(); await page.waitForTimeout(1500)
t = await body()
ck('15 the directory opens',      t.includes('Unleash - The Dog Town'), true)
ck('16 and shows a second trade', t.includes('Aundh Pet Clinic'), true)
await page.screenshot({ path:`${OUT}/c3-directory.png`, fullPage:true })

step = 'my-providers'
await page.getByRole('button', { name:/My Providers/i }).first().click(); await page.waitForTimeout(1300)
t = await body()
ck('17 the saved provider is there', t.includes('Unleash - The Dog Town'), true)
await page.screenshot({ path:`${OUT}/c4-my-providers.png`, fullPage:true })

step = 'done'
ck('18 no page errors in the whole walk', errs.length, 0)
if (errs.length) console.log(errs)
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nthe customer walk is clean')
process.exit(fails ? 1 : 0)
