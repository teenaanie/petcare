// Telling a business a customer's note arrived. Run: npm run test:inform-alert
//
// Like test:provider-alert, this handler's job is mostly REFUSING, and every
// refusal looks the same from outside. So the test counts EMAILS, not statuses:
//
//   · a stranger must not be able to make us mail a business about a note they
//     did not send — that is a spam cannon pointed at a 963-listing directory
//   · an UNCLAIMED listing gets nothing. Its address is scraped; mailing it
//     would be a cold email to a business that never signed up, announcing that
//     somebody used their name
//   · a SUSPENDED claimant is not told
//   · every active claimant is told, once each
//   · the mail carries the pet's label and the dates and NOTHING else — no
//     body, no feeding, no medication, no owner's phone number
//
// No module mocking: a tiny HTTP server stands in for Supabase so the real
// client runs, and fetch is wrapped to catch the Resend call on its way out.

import http from 'node:http'

const SENDER   = '11111111-1111-4111-8111-111111111111'
const STRANGER = '22222222-2222-4222-8222-222222222222'
const TOKEN_FOR = {
  'tok-sender':   { id: SENDER,   email: 'owner@example.test' },
  'tok-stranger': { id: STRANGER, email: 'someone@else.test' },
}

const NOTE_ID = '66666666-6666-4666-8666-666666666666'
const PROV_ID = '55555555-5555-4555-8555-555555555555'

let state = {}
function reset(over = {}) {
  state = {
    notes: [{
      id: NOTE_ID, provider_id: PROV_ID, sent_by: SENDER,
      pet_label: 'Simba, Golden Retriever, Dog',
      starts_on: '2026-10-14', ends_on: '2026-10-18',
      // Present in the row and expected NEVER to appear in the mail.
      body: 'He is on Apoquel 16mg at night and reacts badly to chicken.',
      contact_phone: '9000000001',
    }],
    accounts: [
      { provider_id: PROV_ID, email: 'owner@kennel.test',  status: 'active' },
      { provider_id: PROV_ID, email: 'OWNER@Kennel.test',  status: 'active' },  // same person, shouted
      { provider_id: PROV_ID, email: 'help@kennel.test',   status: 'active' },
      { provider_id: PROV_ID, email: 'paused@kennel.test', status: 'suspended' },
    ],
    providers: [{ id: PROV_ID, name: 'Paws Retreat Boarding' }],
    ...over,
  }
  sent.length = 0
}

const sent = []
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  const wantsObject = (req.headers.accept || '').includes('pgrst.object')
  const rows = list => (wantsObject ? (list[0] ?? null) : list)

  if (url.pathname === '/auth/v1/user') {
    const u = TOKEN_FOR[(req.headers.authorization || '').replace('Bearer ', '')]
    return u ? send(u) : send({ message: 'invalid token' }, 401)
  }
  if (url.pathname === '/rest/v1/provider_notes') {
    const eq = (url.searchParams.get('id') || '').replace('eq.', '')
    return send(rows(state.notes.filter(n => n.id === eq)))
  }
  if (url.pathname === '/rest/v1/provider_accounts') {
    const prov   = (url.searchParams.get('provider_id') || '').replace('eq.', '')
    const status = (url.searchParams.get('status') || '').replace('eq.', '')
    return send(state.accounts.filter(a =>
      a.provider_id === prov && (!status || a.status === status)))
  }
  if (url.pathname === '/rest/v1/providers') {
    const eq = (url.searchParams.get('id') || '').replace('eq.', '')
    return send(rows(state.providers.filter(p => p.id === eq)))
  }
  return send({ message: 'not stubbed: ' + url.pathname }, 404)
})
await new Promise(r => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : input.url
  if (href.startsWith('https://api.resend.com')) {
    sent.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 })
  }
  return realFetch(input, init)
}

process.env.SUPABASE_URL         = base
process.env.SUPABASE_SERVICE_KEY = 'service-key'
process.env.RESEND_API_KEY       = 're_test'
process.env.FROM_EMAIL           = 'reminders@teenaspetcare.com'

const { default: handler } = await import('../api/_lib/inform-provider-email.js')

let failed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}
const post = (token, body) => handler(new Request('http://x/api/provider-mail?op=inform', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
}))

// ── The happy path ──────────────────────────────────────────────────────────
reset()
{
  const res = await post('tok-sender', { noteId: NOTE_ID })
  const out = await res.json()
  check('it reports what it sent', [res.status, out.sent], [200, 2])
  check('one mail per claimant, case folded',
        sent.map(m => m.to).flat().sort(), ['help@kennel.test', 'owner@kennel.test'])
  check('the suspended claimant is not told',
        sent.some(m => JSON.stringify(m.to).includes('paused@')), false)

  const mail = sent[0]
  check('the subject names the pet', mail.subject, "Simba's details, from a customer")
  check('the business is named',     mail.html.includes('Paws Retreat Boarding'), true)
  check('the dates are there',       mail.html.includes('14 Oct – 18 Oct'), true)
  check('and a way in',              mail.html.includes('/business'), true)
  // The whole point of the mail being thin: an inbox is forwardable and lives
  // for years, and the note itself is behind a sign-in.
  check('NOT the medication',        mail.html.includes('Apoquel'), false)
  check('NOT the allergy',           mail.html.toLowerCase().includes('chicken'), false)
  check("NOT the owner's number",    mail.html.includes('9000000001'), false)
}

// ── Refusals ────────────────────────────────────────────────────────────────
reset()
{
  const out = await (await post('tok-stranger', { noteId: NOTE_ID })).json()
  check('a stranger sends nothing', [out.sent, sent.length], [0, 0])
  // And learns nothing: the same answer a missing id gets.
  check('and is told only "not_found"', out.reason, 'not_found')
}
reset()
{
  const out = await (await post('tok-sender', { noteId: '77777777-7777-4777-8777-777777777777' })).json()
  check('an unknown note sends nothing', [out.sent, sent.length], [0, 0])
}
reset({ accounts: [] })
{
  const out = await (await post('tok-sender', { noteId: NOTE_ID })).json()
  check('an UNCLAIMED listing is never mailed', [out.sent, sent.length, out.reason],
        [0, 0, 'no_claimant'])
}
reset({ accounts: [{ provider_id: PROV_ID, email: 'paused@kennel.test', status: 'suspended' }] })
{
  const out = await (await post('tok-sender', { noteId: NOTE_ID })).json()
  check('a business with only suspended claims is not mailed', [out.sent, sent.length], [0, 0])
}
reset()
{
  const res = await post('nope', { noteId: NOTE_ID })
  check('a bad token is refused', [res.status, sent.length], [401, 0])
}
reset()
{
  const res = await post('tok-sender', {})
  check('a missing noteId is refused', [res.status, sent.length], [400, 0])
}

// ── A note with no dates ────────────────────────────────────────────────────
reset({ notes: [{ id: NOTE_ID, provider_id: PROV_ID, sent_by: SENDER,
                  pet_label: 'Ivy, Persian, Cat', starts_on: null, ends_on: null }] })
{
  await post('tok-sender', { noteId: NOTE_ID })
  check('an undated note still goes', sent.length, 2)
  check('and says nothing about dates', /\d+ \w{3} –/.test(sent[0].html), false)
}

server.close()
console.log(failed ? `\n${failed} FAILED` : '\nthe business hears about it')
process.exit(failed ? 1 : 0)
