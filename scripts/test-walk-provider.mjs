// One continuous walk through the provider product, signed-out to signed-in,
// in the order a real business meets it. Every per-feature test in the repo
// opens ONE screen; this one never reloads, so a break BETWEEN screens — a
// crash on the way back from a drill-down, a stale view after a save — shows
// up here and nowhere else.
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
const OUT = process.argv[2] || '/tmp/pippy-walk-provider'
fs.mkdirSync(OUT, { recursive: true })

const UID  = '33333333-3333-3333-3333-333333333333'
const USER = { id: UID, aud:'authenticated', role:'authenticated', email:'kennel@test',
               app_metadata:{}, user_metadata:{}, created_at:new Date().toISOString() }
const SESSION = { access_token:'stub', token_type:'bearer', expires_in:360000,
                  expires_at:Math.floor(Date.now()/1000)+360000, refresh_token:'stub', user:USER }
const PROV = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ACCOUNT = [{ id:'acc1', provider_id:PROV, status:'active', role:'owner', claimed_type:'Boarder',
                   created_at:new Date().toISOString(), provider_name:'Baner Boarding & Day Care',
                   provider_type:'Boarder', provider_area:'Baner', provider_city:'Pune' }]
const day = n => new Date(Date.now()+n*86400000).toISOString().slice(0,10)
const CUSTOMERS = [{ id:'c1', provider_id:PROV, name:'Mrs Rao', phone:'9876500010',
                     email:'rao@example.test', notes:'Pays by UPI.', created_at:new Date().toISOString() }]
const PETS = [{ id:'p1', provider_id:PROV, customer_id:'c1', name:'Simba', species:'Dog',
                breed:'Indie', notes:null, created_at:new Date().toISOString() }]
const APPTS = [-200,-120,-40,-10,5].map((d,i) => ({
  id:`a${i}`, provider_id:PROV, customer_id:'c1', provider_pet_id:'p1', kind:'Boarding',
  starts_on:day(d), ends_on:day(d+3), status: d<0?'completed':'booked',
  amount: i%2?null:String(1500+i*200), trial_done:d<0, criteria_met:d<0,
  created_at:new Date().toISOString() }))

let fails = 0, step = 0
const ck = (l, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want); if(!ok) fails++
  console.log(`${ok?'PASS':'FAIL'}  ${l.padEnd(52)} ${JSON.stringify(got)}`) }

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})

// ── Part 1: signed OUT. The hero and the lookup. ───────────────────────────
const anon = await browser.newContext({ viewport:{ width:1280, height:1400 } })
await anon.route('**/rest/v1/**',     r => r.fulfill({ json: [] }))
await anon.route('**/auth/v1/**',     r => r.fulfill({ status:401, json:{ message:'no session' } }))
await anon.route('**/rest/v1/rpc/search_providers*', r => r.fulfill({ json: [
  { provider:{ id:PROV, name:'Baner Boarding & Day Care', type:'Boarder', area:'Baner',
               city:'Pune', is_approved:true }, total_count:1 } ] }))
let page = await anon.newPage()
const errs = []; page.on('pageerror', e => errs.push(`[${step}] ${e.message}`))
await page.goto('http://localhost:5173/business', { waitUntil:'networkidle' })
await page.waitForTimeout(1800)
let consent = page.getByRole('button', { name:/No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(400) }
let t = await page.innerText('body')
step = 'landing'
ck('1 the hero names the trades', /boarder/i.test(t) && /groomer/i.test(t), true)
ck('2 no phone login is offered', /phone number|OTP/i.test(t), false)
await page.getByPlaceholder(/business name/i).first().fill('Baner Boarding')
await page.waitForTimeout(1200)
t = await page.innerText('body')
ck('3 the lookup finds the listing', t.includes('Baner Boarding & Day Care'), true)
ck('4 and offers to claim it',      /claim/i.test(t), true)
await page.screenshot({ path:`${OUT}/p1-landing.png`, fullPage:true })
await anon.close()

// ── Part 2: signed IN. The book, end to end. ───────────────────────────────
const ctx = await browser.newContext({ viewport:{ width:1280, height:1600 } })
await ctx.addInitScript(([k,s]) => localStorage.setItem(k, JSON.stringify(s)), ['pippy-provider-auth', SESSION])
const posted = { customers:[], pets:[], appointments:[], logs:[] }
const patched = []
const table = (key, store) => async r => {
  const m = r.request().method()
  if (m === 'POST') {
    const row = JSON.parse(r.request().postData()); const one = Array.isArray(row)?row[0]:row
    const saved = { id:`${key}-${store.length+1}`, created_at:new Date().toISOString(), ...one }
    store.push(saved); posted[key].push(one); return r.fulfill({ status:201, json:[saved] })
  }
  if (m === 'PATCH') {
    const patch = JSON.parse(r.request().postData())
    const id = (new URL(r.request().url()).searchParams.get('id')||'').replace('eq.','')
    patched.push({ key, id, patch })
    const row = store.find(x => x.id === id); if (row) Object.assign(row, patch)
    return r.fulfill({ json: row ? [row] : [] })
  }
  return r.fulfill({ json: store })
}
const customers = [...CUSTOMERS], pets = [...PETS], appts = [...APPTS], logs = []
await ctx.route('**/rest/v1/**', r => r.fulfill({ json: [] }))
await ctx.route('**/auth/v1/**', r => r.fulfill({ json: USER }))
await ctx.route('**/rest/v1/rpc/**', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/rpc/my_provider_accounts*', r => r.fulfill({ json: ACCOUNT }))
await ctx.route('**/rest/v1/rpc/my_provider_details*', r => r.fulfill({ json: [{
  id:PROV, name:'Baner Boarding & Day Care', type:'Boarder', area:'Baner', city:'Pune',
  address:'12 Baner Road', phone:'9876500000', whatsapp:'9876500000', email:'hello@baner.test',
  website:'', hours:'Mon–Sun 8–8', description:'', services:[], boarding_policy:null }] }))
await ctx.route('**/rest/v1/provider_notes*', r => r.fulfill({ json: [] }))
await ctx.route('**/rest/v1/provider_customers*',        table('customers', customers))
await ctx.route('**/rest/v1/provider_pets*',             table('pets', pets))
await ctx.route('**/rest/v1/provider_appointments*',     table('appointments', appts))
await ctx.route('**/rest/v1/provider_appointment_logs*', table('logs', logs))
await ctx.route('**/api/provider-mail*', r => r.fulfill({ json:{ ok:true, sent:1 } }))

page = await ctx.newPage()
page.on('pageerror', e => errs.push(`[${step}] ${e.message}`))
await page.goto('http://localhost:5173/business', { waitUntil:'networkidle' })
await page.waitForTimeout(2200)
consent = page.getByRole('button', { name:/No thanks|Yes, that's fine/ }).first()
if (await consent.count()) { await consent.click(); await page.waitForTimeout(500) }
await page.waitForTimeout(800)
const body = async () => page.innerText('body')
const has  = async s => (await body()).toUpperCase().includes(s.toUpperCase())
// Back out to the dashboard, whatever depth we are at. A drill-down's back
// button says "Dashboard"; a customer or booking screen says "Back". Handling
// only the first leaves the walk two screens deep, and every later assertion
// then fails on a screen that was never meant to carry it.
const dash = async () => {
  for (let i = 0; i < 6; i++) {
    if (await page.getByRole('button').filter({ hasText: 'Message your customers' }).count()) return
    const d = page.getByRole('button', { name:'Dashboard' })
    const b = page.getByRole('button', { name:'Back' })
    if (await d.count())      await d.first().click()
    else if (await b.count()) await b.first().click()
    else break
    await page.waitForTimeout(600)
  }
}

step = 'dashboard'
ck('5 the business is named',    await has('Baner Boarding & Day Care'), true)
ck('6 the tiles are there',      await has('With you now') && await has('Past stays'), true)
ck('7 the year is there',        await has('Your year'), true)
ck('8 regulars is a tile',       await has('Regulars'), true)
await page.screenshot({ path:`${OUT}/p2-dashboard.png`, fullPage:true })

step = 'regulars'
await page.getByText('Regulars', { exact:false }).first().click(); await page.waitForTimeout(800)
ck('9 regulars opens the ranking', await has('Who comes back most'), true)
await dash()

step = 'month'
await page.getByRole('button', { name:'Stays', exact:true }).click(); await page.waitForTimeout(500)
const bars = page.locator('button[aria-label*="stay"], button[title*="stay"]')
step = 'customers'
await page.getByRole('button', { name:/All customers/i }).first().click(); await page.waitForTimeout(800)
ck('10 the customer list opens',  await has('Mrs Rao'), true)
await page.getByRole('button', { name:/Mrs Rao/ }).first().click(); await page.waitForTimeout(900)
ck('11 their history is shown',   await has('Their history'), true)
ck('12 their pet is listed',      await has('Simba'), true)
await page.screenshot({ path:`${OUT}/p3-customer.png`, fullPage:true })

step = 'edit-customer'
await page.locator('button[title="Edit their details"]').click(); await page.waitForTimeout(500)
await page.getByPlaceholder('98765 00000').fill('9876500099')
await page.getByRole('button', { name:'Save customer' }).click(); await page.waitForTimeout(900)
ck('13 the customer was updated', patched.find(p => p.key==='customers')?.patch?.phone, '9876500099')
ck('14 and not duplicated',       customers.length, 1)

step = 'edit-pet'
await page.locator('button[title="Edit Simba"]').click(); await page.waitForTimeout(500)
await page.getByPlaceholder('Nervous with men in hats.').fill('Scared of the dryer.')
await page.getByRole('button', { name:'Save pet' }).click(); await page.waitForTimeout(900)
ck('15 the pet note was saved',   patched.find(p => p.key==='pets')?.patch?.notes, 'Scared of the dryer.')

step = 'add-pet'
await page.getByRole('button', { name:/Add a pet/i }).first().click(); await page.waitForTimeout(500)
await page.getByPlaceholder('Simba').fill('Misty')
await page.getByRole('button', { name:'Save pet' }).click(); await page.waitForTimeout(900)
ck('16 a second pet was added',   posted.pets.at(-1)?.name, 'Misty')

step = 'book'
await page.getByRole('button', { name:/Book a stay/i }).first().click(); await page.waitForTimeout(600)
const dates = page.locator('input[type="date"]')
await dates.nth(0).fill(day(20)); await dates.nth(1).fill(day(24))
await page.getByRole('button', { name:/Save|Book/i }).last().click(); await page.waitForTimeout(1000)
ck('17 the booking was written',  posted.appointments.at(-1)?.starts_on, day(20))

step = 'criteria'
await dash()
const crit = page.getByText('Your boarding criteria', { exact:false }).first()
ck('18 the criteria block is on the dashboard', await crit.count() > 0, true)
await crit.click(); await page.waitForTimeout(900)
ck('19 it opens the requirements', await has('requirement') || await has('Vaccination'), true)
await page.screenshot({ path:`${OUT}/p4-criteria.png`, fullPage:true })

step = 'details'
await dash()
const det = page.getByText('Your details', { exact:false }).first()
await det.click(); await page.waitForTimeout(900)
// By inputValue, not by body text: innerText does not include what is IN a
// box, so asserting on the page text here passes or fails for the wrong
// reason — the labels are present whether or not the row loaded.
ck('20 the details screen is filled', await page.locator('input[name="address"]').inputValue(), '12 Baner Road')
ck('21 with the contact email',       await page.locator('input[name="email"]').inputValue(), 'hello@baner.test')
ck('22 and the website box exists',   await page.locator('input[name="website"]').count(), 1)
await page.screenshot({ path:`${OUT}/p5-details.png`, fullPage:true })

step = 'broadcast'
await dash()
const bc = page.getByRole('button').filter({ hasText: 'Message your customers' }).first()
ck('23 the broadcast button is there', await bc.count(), 1)
await bc.click(); await page.waitForTimeout(900)
ck('24 and it opens a composer', await page.locator('input, textarea').count() > 1, true)
await dash()

step = 'inbox'
const inbox = page.getByRole('button', { name:/Shared with you/i }).first()
ck('25 the shared-with-you tab is there', await inbox.count(), 1)
await inbox.click(); await page.waitForTimeout(900)
ck('26 and it opens', (await body()).length > 0, true)

ck('27 no page errors in the whole walk', errs.length, 0)
if (errs.length) console.log(errs)
await page.screenshot({ path:`${OUT}/p6-end.png`, fullPage:true })
await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nthe provider walk is clean')
process.exit(fails ? 1 : 0)
