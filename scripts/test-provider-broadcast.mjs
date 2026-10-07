// The broadcast endpoint. Run with: npm run test:broadcast
//
// This is the one place in the provider platform where a business causes mail
// to be sent to people whose addresses it cannot see. Everything below is about
// keeping that true:
//
//   * the audience is people who sent THIS business a note and typed an address
//     into it — never auth.users, which would mean mailing someone at an
//     address they never offered to this business;
//   * a suspended claimant cannot mail anybody;
//   * the monthly ceiling is counted from rows only the server writes;
//   * no address ever appears in the response.
//
// Same shape as test-register-provider.mjs: a stand-in for Supabase so the real
// client runs, and globalThis.fetch wrapped to catch the outbound mail.

import http from 'node:http'

const PROV   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OTHER  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const UID    = '33333333-3333-3333-3333-333333333333'

let state
function reset(over = {}) {
  state = {
    account:    over.account    !== undefined ? over.account    : { id: 'acc1', provider_id: PROV, status: 'active' },
    notes:      over.notes      !== undefined ? over.notes      : [
      { contact_email: 'a@example.test' },
      { contact_email: 'A@Example.test' },   // same person, shouted
      { contact_email: 'b@example.test' },
      { contact_email: null },               // never gave one
      { contact_email: '   ' },              // gave nothing useful
      { contact_email: 'not-an-address' },
    ],
    recentCount: over.recentCount !== undefined ? over.recentCount : 0,
    recorded:   [],
  }
  sent.length = 0
  failAddr = over.failAddr || null
}
const sent = []
let failAddr = null

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (obj, status = 200, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(obj))
  }
  const wantsObject = (req.headers.accept || '').includes('pgrst.object')

  if (url.pathname === '/auth/v1/user') {
    return send({ id: UID, aud: 'authenticated', email: 'boarder@unleash.test' })
  }
  if (url.pathname === '/rest/v1/provider_accounts') {
    // The handler filters on provider_id, user_id AND status=active. Honour the
    // status filter, so "a suspended claimant is refused" tests the real query.
    const wantsActive = (url.search || '').includes('status=eq.active')
    const ok = state.account && (!wantsActive || state.account.status === 'active')
    const rows = ok ? [state.account] : []
    return send(wantsObject ? (rows[0] ?? null) : rows)
  }
  if (url.pathname === '/rest/v1/providers') {
    const row = { name: 'Unleash - The Dog Town' }
    return send(wantsObject ? row : [row])
  }
  if (url.pathname === '/rest/v1/provider_broadcasts' && req.method !== 'POST') {
    // `head: true` makes supabase-js issue a HEAD, not a GET, and the count
    // rides in Content-Range rather than the body. A stub that only answered
    // GET returned no count at all, and the ceiling silently never fired — the
    // test caught that, which is the entire reason it asserts a 429 rather than
    // trusting the code path exists.
    res.writeHead(200, { 'Content-Type': 'application/json',
                         'Content-Range': `*/${state.recentCount}` })
    return res.end(req.method === 'HEAD' ? undefined : '[]')
  }
  if (url.pathname === '/rest/v1/provider_broadcasts' && req.method === 'POST') {
    let b = ''
    req.on('data', c => { b += c })
    return req.on('end', () => { state.recorded.push(JSON.parse(b)); send([], 201) })
  }
  if (url.pathname === '/rest/v1/provider_notes') {
    return send(state.notes)
  }
  return send({ message: 'not stubbed: ' + url.pathname }, 404)
})

await new Promise(r => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : input.url
  if (href.startsWith('https://api.resend.com')) {
    const payload = JSON.parse(init.body)
    if (failAddr && payload.to === failAddr) {
      return new Response(JSON.stringify({ message: 'bounced' }), { status: 422 })
    }
    sent.push(payload)
    return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 })
  }
  return realFetch(input, init)
}

process.env.SUPABASE_URL         = base
process.env.SUPABASE_SERVICE_KEY = 'service-key'
process.env.RESEND_API_KEY       = 're_test'
process.env.FROM_EMAIL           = 'Pippy <reminders@pippypets.com>'

const { default: handler, MAX_PER_MONTH, MAX_SUBJECT, MAX_BODY } =
  await import('../api/_lib/provider-broadcast.js')

let failed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const post = (body, token = 'tok') => handler(new Request(`${base}/api/provider-broadcast`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
}))

const VALID = { providerId: PROV, subject: 'Closed for Diwali', body: 'We are shut 20th to 23rd.' }

// ── The happy path, and who it reached ──────────────────────────────────────

reset()
let res = await post(VALID)
let out = await res.json()
check('a broadcast succeeds', res.status, 200)
check('it reached the two real addresses', out.sent, 2)
check('the shouted duplicate is one person', sent.map(e => e.to).sort(), ['a@example.test', 'b@example.test'])
check('a missing address is skipped', sent.some(e => (e.to || '').trim() === ''), false)
check('and a malformed one is too', sent.some(e => e.to === 'not-an-address'), false)
check('the subject is the provider’s', sent[0]?.subject, 'Closed for Diwali')
check('the mail names the business', sent[0]?.html.includes('Unleash - The Dog Town'), true)
check('and says why they got it', sent[0]?.html.includes('you sent'), true)
check('and that the business cannot see them',
      sent[0]?.html.includes('cannot see your email address'), true)

// The response is what the PROVIDER sees. No address may be in it.
const blob = JSON.stringify(out)
check('no address leaks to the sender', blob.includes('@example.test'), false)

check('the send was recorded', state.recorded.length, 1)
check('with the real count', state.recorded[0]?.recipients, 2)
check('and attributed', state.recorded[0]?.sent_by, UID)

// ── Who may send ────────────────────────────────────────────────────────────

reset({ account: { id: 'acc1', provider_id: PROV, status: 'suspended' } })
res = await post(VALID)
check('a suspended claimant is refused', res.status, 403)
check('and nothing was sent', sent.length, 0)

reset({ account: null })
res = await post(VALID)
check('a stranger to the business is refused', res.status, 403)

reset()
res = await handler(new Request(`${base}/api/provider-broadcast`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(VALID),
}))
check('no token at all is refused', res.status, 401)

// ── The ceiling ─────────────────────────────────────────────────────────────

reset({ recentCount: MAX_PER_MONTH })
res = await post(VALID)
check('the monthly ceiling is enforced', res.status, 429)
check('and nothing was sent', sent.length, 0)

reset({ recentCount: MAX_PER_MONTH - 1 })
res = await post(VALID)
check('one under the ceiling still sends', res.status, 200)

// ── Validation ──────────────────────────────────────────────────────────────

reset()
check('a blank subject is refused', (await post({ ...VALID, subject: '  ' })).status, 400)
check('a blank body is refused',    (await post({ ...VALID, body: '' })).status, 400)
check('an overlong subject is refused',
      (await post({ ...VALID, subject: 'x'.repeat(MAX_SUBJECT + 1) })).status, 400)
check('an overlong body is refused',
      (await post({ ...VALID, body: 'x'.repeat(MAX_BODY + 1) })).status, 400)
check('no providerId is refused', (await post({ ...VALID, providerId: '' })).status, 400)
check('and none of that sent anything', sent.length, 0)

// ── Nobody to write to ──────────────────────────────────────────────────────

reset({ notes: [] })
res = await post(VALID)
out = await res.json()
check('no recipients is not an error', [res.status, out.sent, out.reason], [200, 0, 'no_recipients'])
check('and records nothing', state.recorded.length, 0)

// ── One bad address must not cost the others theirs ─────────────────────────

reset({ failAddr: 'a@example.test' })
res = await post(VALID)
out = await res.json()
check('the other recipient still got it', out.sent, 1)
check('the failure is counted, not raised', out.failures, 1)
check('and the attempt is still recorded', state.recorded[0]?.failures, 1)

server.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
