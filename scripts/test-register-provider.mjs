// scripts/test-register-provider.mjs
//
// The public registration endpoint. Run with: npm run test:register
//
// This is the one endpoint anyone on the internet can POST to, and it now
// writes TWO tables: the listing, and a waiting claim carrying the submitted
// address. The claim is what lets that person sign in at /business later and
// have claim_provider() adopt the row rather than create a second one — so if
// it silently stops being written, nothing breaks loudly, the head start is
// just quietly gone.
//
// It also used to mail one hardcoded address. It now mails every active admin,
// which is invisible until the day a second admin notices they never hear about
// submissions. Both are asserted here.
//
// Same approach as test-provider-alert.mjs: a stand-in for Supabase so the real
// client runs, and globalThis.fetch wrapped to catch the outbound mail.

import http from 'node:http'

const ADMINS = [
  { user_id: '33333333-3333-4333-8333-333333333333', email: null },
  { user_id: '44444444-4444-4444-8444-444444444444', email: null },
]
const USERS = {
  '33333333-3333-4333-8333-333333333333': { id: '33333333-3333-4333-8333-333333333333', email: 'teena.anie9@gmail.com' },
  '44444444-4444-4444-8444-444444444444': { id: '44444444-4444-4444-8444-444444444444', email: 'tins08@gmail.com' },
}

let inserted = { providers: [], provider_accounts: [] }
let admins = ADMINS
const sent = []

function reset(over = {}) {
  inserted = { providers: [], provider_accounts: [] }
  admins = over.admins ?? ADMINS
  sent.length = 0
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  const wantsObject = (req.headers.accept || '').includes('pgrst.object')

  if (url.pathname.startsWith('/auth/v1/admin/users/')) {
    const id = url.pathname.split('/').pop()
    return send(USERS[id] || {}, USERS[id] ? 200 : 404)
  }
  if (url.pathname === '/rest/v1/admins') return send(admins)

  if (url.pathname === '/rest/v1/providers' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    return req.on('end', () => {
      const rows = JSON.parse(body)
      const row = { id: '55555555-5555-4555-8555-555555555555', ...(Array.isArray(rows) ? rows[0] : rows) }
      inserted.providers.push(row)
      return send(wantsObject ? row : [row], 201)
    })
  }
  if (url.pathname === '/rest/v1/provider_accounts' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    return req.on('end', () => {
      const rows = JSON.parse(body)
      inserted.provider_accounts.push(Array.isArray(rows) ? rows[0] : rows)
      return send([], 201)
    })
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
process.env.FROM_EMAIL           = 'reminders@pippypets.com'

const { default: handler } = await import('../api/_lib/register-provider.js')

let failed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const post = body => handler(new Request(`${base}/api/register-provider`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}))

const VALID = {
  name: 'Backstreet Kennels', type: 'Boarder', phone: '9876500000',
  area: 'Baner', city: 'Pune', email: 'owner@backstreet.test',
}

// ── Every admin is told, not just the one that used to be hardcoded ──────────

reset()
let res = await post(VALID)
check('a submission succeeds', res.status, 200)
check('both admins are emailed', sent.map(e => e.to).sort(),
      ['teena.anie9@gmail.com', 'tins08@gmail.com'])
check('the mail names the business', sent[0]?.subject,
      '🐾 New provider submission: Backstreet Kennels (Boarder)')
check('the mail shows the address', sent[0]?.html.includes('owner@backstreet.test'), true)

// ── The listing, and the waiting claim ───────────────────────────────────────

check('the listing is unapproved', inserted.providers[0]?.is_approved, false)
check('the listing is marked self_registered', inserted.providers[0]?.source, 'self_registered')
check('the address is NOT on the public listing', inserted.providers[0]?.email, undefined)
check('a waiting claim was created', inserted.provider_accounts.length, 1)
check('the claim carries the address', inserted.provider_accounts[0]?.email, 'owner@backstreet.test')
check('the claim grants nothing yet', inserted.provider_accounts[0]?.status, 'pending')
check('the claim has no user_id', inserted.provider_accounts[0]?.user_id, undefined)

// ── Validation and the cases that must not create half a record ──────────────

reset()
res = await post({ ...VALID, email: 'not-an-address' })
check('a malformed address is refused', res.status, 400)
check('and nothing was written', [inserted.providers.length, inserted.provider_accounts.length], [0, 0])

reset()
res = await post({ ...VALID, email: undefined })
check('no address is still accepted', res.status, 200)
check('but no claim is pre-created', inserted.provider_accounts.length, 0)
check('the listing is still created', inserted.providers.length, 1)

reset()
res = await post({ ...VALID, name: '  ' })
check('a blank name is refused', res.status, 400)

reset()
res = await post({ ...VALID, type: 'Taxidermist' })
check('an unknown type is refused', res.status, 400)

reset()
res = await post({ ...VALID, url: 'http://spam.test' })
check('the honeypot answers success and writes nothing',
      [res.status, inserted.providers.length, sent.length], [200, 0, 0])

reset({ admins: [] })
res = await post(VALID)
check('no admins is survivable', [res.status, sent.length], [200, 0])
check('and the listing is still saved', inserted.providers.length, 1)

server.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
