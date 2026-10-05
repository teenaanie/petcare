// scripts/test-provider-alert.mjs
//
// The admin alert for provider feedback. Run with: npm run test:provider-alert
//
// This exists because the handler's job is mostly REFUSING. It is called by a
// browser with a user's own token, and the three things it must never do —
// notify about somebody else's message, notify repeatedly for the same row, and
// reveal whether a feedback id exists — all look identical from outside: a 202.
// A regression in any of them is therefore invisible unless something asserts
// on what was actually sent. So the test counts emails, not status codes.
//
// No module mocking and no flags. A tiny HTTP server stands in for Supabase so
// the real supabase-js client runs, and globalThis.fetch is wrapped to catch
// the Resend call on its way out.

import http from 'node:http'

// ── A stand-in for the Supabase REST + auth API ──────────────────────────────

const TOKEN_FOR = {
  'tok-sender':   { id: '11111111-1111-4111-8111-111111111111',   email: 'boarder@unleash.test', phone: null },
  'tok-stranger': { id: '22222222-2222-4222-8222-222222222222', email: 'someone@else.test',    phone: null },
}

const USERS = {
  '11111111-1111-4111-8111-111111111111':   { id: '11111111-1111-4111-8111-111111111111',   email: 'boarder@unleash.test' },
  '22222222-2222-4222-8222-222222222222': { id: '22222222-2222-4222-8222-222222222222', email: 'someone@else.test' },
  '33333333-3333-4333-8333-333333333333':       { id: '33333333-3333-4333-8333-333333333333',       email: 'teena.anie9@gmail.com' },
  '44444444-4444-4444-8444-444444444444':       { id: '44444444-4444-4444-8444-444444444444',       email: 'tins08@gmail.com' },
}

// Ids are real UUIDs because auth.admin.getUserById() validates their shape and
// throws before any request is made. Production ids are UUIDs, so this is the
// fixture matching reality rather than the code being fussy.

// Mutated per case.
let state = {}
function reset(over = {}) {
  state = {
    feedback: [{
      id: '66666666-6666-4666-8666-666666666666', user_id: '11111111-1111-4111-8111-111111111111', provider_id: '55555555-5555-4555-8555-555555555555',
      category: 'Provider · Access paused', message: 'why was my access paused?',
      created_at: new Date().toISOString(),
    }],
    providers: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Unleash - The Dog Town', area: 'Baner' }],
    admins: [{ user_id: '33333333-3333-4333-8333-333333333333', email: null }, { user_id: '44444444-4444-4444-8444-444444444444', email: null }],
    ...over,
  }
  sent.length = 0
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  // maybeSingle() asks for an object; a plain select wants an array.
  const wantsObject = (req.headers.accept || '').includes('pgrst.object')
  const rows = list => (wantsObject ? (list[0] ?? null) : list)

  if (url.pathname === '/auth/v1/user') {
    const tok = (req.headers.authorization || '').replace('Bearer ', '')
    const u = TOKEN_FOR[tok]
    return u ? send(u) : send({ message: 'invalid token' }, 401)
  }
  if (url.pathname.startsWith('/auth/v1/admin/users/')) {
    const id = url.pathname.split('/').pop()
    return send(USERS[id] || {}, USERS[id] ? 200 : 404)
  }
  if (url.pathname === '/rest/v1/feedback') {
    const eq = (url.searchParams.get('id') || '').replace('eq.', '')
    return send(rows(state.feedback.filter(f => f.id === eq)))
  }
  if (url.pathname === '/rest/v1/providers') {
    const eq = (url.searchParams.get('id') || '').replace('eq.', '')
    return send(rows(state.providers.filter(p => p.id === eq)))
  }
  if (url.pathname === '/rest/v1/admins') return send(state.admins)
  return send({ message: 'not stubbed: ' + url.pathname }, 404)
})

await new Promise(r => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

// ── Catch the outbound email ─────────────────────────────────────────────────

const sent = []
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
process.env.RESEND_API_KEY       = 're_test'   // so sendEmail actually calls out
process.env.FROM_EMAIL           = 'reminders@teenaspetcare.com'

const { default: handler } = await import('../netlify/functions/notify-provider-feedback.js')

// ── Harness ──────────────────────────────────────────────────────────────────

let failed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const post = (body, token = 'tok-sender') => handler(new Request(`${base}/api/notify-provider-feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}))

// ── The happy path, so every refusal below means something ───────────────────

reset()
let res = await post({ feedbackId: '66666666-6666-4666-8666-666666666666' })
check('a real message emails every admin', [res.status, sent.length], [200, 2])
check('it reaches both admin addresses',
      sent.map(e => e.to).sort(), ['teena.anie9@gmail.com', 'tins08@gmail.com'])
check('subject names the business', sent[0]?.subject, 'Pippy: message from Unleash - The Dog Town')
check('body carries the message', sent[0]?.html.includes('why was my access paused?'), true)
check('body names who it is from', sent[0]?.html.includes('boarder@unleash.test'), true)

// ── The refusals ─────────────────────────────────────────────────────────────

reset()
res = await post({ feedbackId: '66666666-6666-4666-8666-666666666666' }, 'tok-stranger')
check("another user's message is not announced", [res.status, sent.length], [202, 0])

reset()
res = await post({ feedbackId: 'does-not-exist' })
check('an unknown id says nothing and sends nothing', [res.status, sent.length], [202, 0])

reset({ feedback: [{
  id: '66666666-6666-4666-8666-666666666666', user_id: '11111111-1111-4111-8111-111111111111', provider_id: null,
  category: 'Reminders', message: 'pet parent feedback',
  created_at: new Date().toISOString() }] })
res = await post({ feedbackId: '66666666-6666-4666-8666-666666666666' })
check('pet-parent feedback does not alert anyone', [res.status, sent.length], [202, 0])

reset({ feedback: [{
  id: '66666666-6666-4666-8666-666666666666', user_id: '11111111-1111-4111-8111-111111111111', provider_id: '55555555-5555-4555-8555-555555555555',
  category: 'Provider · Access paused', message: 'old',
  created_at: new Date(Date.now() - 60 * 60_000).toISOString() }] })
res = await post({ feedbackId: '66666666-6666-4666-8666-666666666666' })
check('a replayed old row sends nothing', [res.status, sent.length], [202, 0])

reset({ admins: [] })
res = await post({ feedbackId: '66666666-6666-4666-8666-666666666666' })
check('no admins is survivable', [res.status, sent.length], [202, 0])

reset()
res = await post({ feedbackId: '66666666-6666-4666-8666-666666666666' }, null)
check('no token is rejected outright', [res.status, sent.length], [401, 0])

reset()
res = await post({})
check('a missing feedbackId is a 400', [res.status, sent.length], [400, 0])

// One admin's address bouncing must not silence the other.
reset()
let first = true
globalThis.fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : input.url
  if (href.startsWith('https://api.resend.com')) {
    if (first) { first = false; return new Response(JSON.stringify({ message: 'bounced' }), { status: 422 }) }
    sent.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ id: 'email-2' }), { status: 200 })
  }
  return realFetch(input, init)
}
res = await post({ feedbackId: '66666666-6666-4666-8666-666666666666' })
check('one bad address does not stop the rest', [res.status, sent.length], [200, 1])

server.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
