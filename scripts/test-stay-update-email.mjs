// The stay-update notification. Run with: npm run test:stay-email
//
// Two things this is really guarding:
//
//   * the caller must be the person who POSTED the update. This runs with the
//     service key, so no policy checks that for us — without it, any signed-in
//     person could make us mail a stranger's customer.
//   * the mail must carry NO photo and no quoted text. An update can be a
//     picture of someone's dog; email is forwardable, cacheable, and sits in an
//     inbox for years. The notification says one landed, the app shows it.

import http from 'node:http'

const POSTER = '33333333-3333-3333-3333-333333333333'
const OTHER  = '44444444-4444-4444-4444-444444444444'

let state
const sent = []
function reset(over = {}) {
  state = {
    caller: over.caller || POSTER,
    update: over.update !== undefined ? over.update : {
      id: 'u1', note_id: 'n1', provider_id: 'p1', posted_by: POSTER,
      body: 'SECRET UPDATE TEXT', photo_path: 'n1/PRIVATE-PHOTO.jpg',
    },
    note: over.note !== undefined ? over.note
      : { contact_email: 'owner@example.test', pet_label: 'Pippin, Beagle, Dog' },
  }
  sent.length = 0
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  const one = (req.headers.accept || '').includes('pgrst.object')
  if (url.pathname === '/auth/v1/user')          return send({ id: state.caller, aud: 'authenticated' })
  if (url.pathname === '/rest/v1/stay_updates')  return send(one ? state.update : [state.update].filter(Boolean))
  if (url.pathname === '/rest/v1/provider_notes')return send(one ? state.note : [state.note].filter(Boolean))
  if (url.pathname === '/rest/v1/providers')     return send(one ? { name: 'Unleash - The Dog Town' } : [{ name: 'Unleash - The Dog Town' }])
  return send({ message: 'not stubbed: ' + url.pathname }, 404)
})
await new Promise(r => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : input.url
  if (href.startsWith('https://api.resend.com')) {
    sent.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ id: 'e1' }), { status: 200 })
  }
  return realFetch(input, init)
}

process.env.SUPABASE_URL         = base
process.env.SUPABASE_SERVICE_KEY = 'service-key'
process.env.RESEND_API_KEY       = 're_test'
process.env.FROM_EMAIL           = 'Pippy <reminders@pippypets.com>'

const { default: handler } = await import('../api/_lib/stay-update-email.js')

let failed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}
const post = (body, token = 'tok') => handler(new Request(`${base}/api/provider-mail?op=stay-update`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
}))

reset()
let res = await post({ updateId: 'u1' })
let out = await res.json()
check('the owner is told', [res.status, out.sent], [200, true])
check('addressed from the note', sent[0]?.to, 'owner@example.test')
check('the subject names the pet', sent[0]?.subject, 'An update on Pippin')
check('and the business is named', sent[0]?.html.includes('Unleash - The Dog Town'), true)
check('it says what kind of update', sent[0]?.html.includes('a note and a photo'), true)

// The two that matter.
check('the update text is NOT in the mail', sent[0]?.html.includes('SECRET UPDATE TEXT'), false)
check('nor the photo path',                 sent[0]?.html.includes('PRIVATE-PHOTO'), false)
check('it points back to the app',          sent[0]?.html.includes('in Pippy'), true)

reset({ caller: OTHER })
res = await post({ updateId: 'u1' })
check('somebody else cannot trigger it', res.status, 403)
check('and nothing was sent', sent.length, 0)

reset()
res = await handler(new Request(`${base}/api/provider-mail?op=stay-update`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updateId: 'u1' }) }))
check('no token is refused', res.status, 401)

reset({ note: { contact_email: null, pet_label: 'Pippin, Dog' } })
res = await post({ updateId: 'u1' })
out = await res.json()
check('no address is not an error', [res.status, out.sent, out.reason], [200, false, 'no_address'])

reset({ update: null })
res = await post({ updateId: 'gone' })
out = await res.json()
check('a missing update is survivable', [res.status, out.reason], [200, 'not_found'])

reset()
check('no updateId is refused', (await post({})).status, 400)

reset({ update: { id: 'u1', note_id: 'n1', provider_id: 'p1', posted_by: POSTER, body: 'hi', photo_path: null } })
await post({ updateId: 'u1' })
check('a note-only update says so', sent[0]?.html.includes('posted a note about'), true)

reset({ update: { id: 'u1', note_id: 'n1', provider_id: 'p1', posted_by: POSTER, body: null, photo_path: 'n1/x.jpg' } })
await post({ updateId: 'u1' })
check('a photo-only update says so', sent[0]?.html.includes('posted a photo about'), true)

server.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
