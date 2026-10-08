// A boarder sending one customer their criteria. Run: npm run test:criteria-mail
//
// The refusals are the feature. An endpoint that mails whatever address it is
// handed is an open relay with a kennel's name on it, so what is pinned is:
//
//   · it mails ONE customer in the sender's own book, by id, never a typed
//     address
//   · a provider cannot mail somebody else's customer, and cannot learn whether
//     that customer exists
//   · a suspended claimant cannot send
//   · a customer with no address is a quiet no, not an error
//   · the mail carries the criteria and the business's own phone number, and
//     nothing about the customer beyond their name

import http from 'node:http'

const OWNER    = '11111111-1111-4111-8111-111111111111'
const STRANGER = '22222222-2222-4222-8222-222222222222'
const TOKEN_FOR = {
  'tok-owner':    { id: OWNER,    email: 'owner@kennel.test' },
  'tok-stranger': { id: STRANGER, email: 'someone@else.test' },
}
const PROV = '55555555-5555-4555-8555-555555555555'
const CUST = '66666666-6666-4666-8666-666666666666'

let state = {}
function reset(over = {}) {
  state = {
    customers: [{ id: CUST, provider_id: PROV, name: 'Mrs Rao', email: 'rao@example.test' }],
    accounts: [{ id: 'a1', provider_id: PROV, user_id: OWNER, email: 'owner@kennel.test', status: 'active' }],
    providers: [{ id: PROV, name: 'Paws Retreat Boarding', phone: '+91 98230 11001' }],
    ...over,
  }
  sent.length = 0
}

const sent = []
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj))
  }
  const wantsObject = (req.headers.accept || '').includes('pgrst.object')
  const rows = list => (wantsObject ? (list[0] ?? null) : list)

  if (url.pathname === '/auth/v1/user') {
    const u = TOKEN_FOR[(req.headers.authorization || '').replace('Bearer ', '')]
    return u ? send(u) : send({ message: 'invalid token' }, 401)
  }
  if (url.pathname === '/rest/v1/provider_customers') {
    const eq = (url.searchParams.get('id') || '').replace('eq.', '')
    return send(rows(state.customers.filter(c => c.id === eq)))
  }
  if (url.pathname === '/rest/v1/provider_accounts') {
    const prov   = (url.searchParams.get('provider_id') || '').replace('eq.', '')
    const status = (url.searchParams.get('status') || '').replace('eq.', '')
    return send(state.accounts.filter(a => a.provider_id === prov && (!status || a.status === status)))
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

const { default: handler } = await import('../api/_lib/boarding-criteria-email.js')

let failed = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}
const LINES = [
  { label: 'Rabies vaccination current', help: 'Asked for by almost every boarder.' },
  { label: 'A blanket that smells of home' },
]
const post = (token, payload) => handler(new Request('http://x/api/provider-mail?op=criteria', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
}))

reset()
{
  const out = await (await post('tok-owner', { customerId: CUST, lines: LINES })).json()
  check('it sends', [out.ok, out.sent], [true, true])
  // sendEmail passes a single address through as a string; the inform alert
  // sends one mail each rather than one with several recipients, so neither
  // path ever hands Resend an array here.
  check('to the customer on file', sent[0].to, 'rao@example.test')
  check('the subject names the business', sent[0].subject, "Before your pet's stay at Paws Retreat Boarding")
  check('the criteria are in it',  sent[0].html.includes('Rabies vaccination current'), true)
  check('including the custom one', sent[0].html.includes('A blanket that smells of home'), true)
  check('the help line too',       sent[0].html.includes('almost every boarder'), true)
  check('and a number to ring',    sent[0].html.includes('98230 11001'), true)
  check('the customer is greeted', sent[0].html.includes('Mrs Rao'), true)
}

reset()
{
  // Somebody else's customer. The same answer as a customer that does not
  // exist, so the caller learns nothing either way.
  const out = await (await post('tok-stranger', { customerId: CUST, lines: LINES })).json()
  check('a stranger sends nothing', [out.sent, sent.length, out.reason], [false, 0, 'not_found'])
}
reset({ accounts: [{ id: 'a1', provider_id: PROV, user_id: OWNER, email: 'owner@kennel.test', status: 'suspended' }] })
{
  const out = await (await post('tok-owner', { customerId: CUST, lines: LINES })).json()
  check('a suspended claimant sends nothing', [out.sent, sent.length], [false, 0])
}
reset({ customers: [{ id: CUST, provider_id: PROV, name: 'Mrs Rao', email: null }] })
{
  const out = await (await post('tok-owner', { customerId: CUST, lines: LINES })).json()
  check('no address is a quiet no', [out.ok, out.sent, out.reason], [true, false, 'no_address'])
}
reset()
{
  const out = await (await post('tok-owner', { customerId: CUST, lines: [] })).json()
  check('nothing to send is refused', [out.sent, out.reason], [false, 'nothing_to_send'])
}
reset()
{
  const res = await post('tok-owner', { lines: LINES })
  check('a missing customer id is refused', [res.status, sent.length], [400, 0])
}
reset()
{
  const res = await post('nope', { customerId: CUST, lines: LINES })
  check('a bad token is refused', [res.status, sent.length], [401, 0])
}
reset()
{
  // Whatever arrives in `lines` is rendered as text, never as markup.
  await post('tok-owner', { customerId: CUST, lines: [{ label: '<script>alert(1)</script>' }] })
  check('markup in a criterion is escaped', sent[0].html.includes('<script>'), false)
  check('and still readable', sent[0].html.includes('&lt;script&gt;'), true)
}

server.close()
console.log(failed ? `\n${failed} FAILED` : '\nthe customer knows what to bring')
process.exit(failed ? 1 : 0)
