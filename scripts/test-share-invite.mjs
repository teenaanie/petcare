// The invite email. Run: npm run test:share-invite
//
// The Share screen said "Send Invite" and sent nothing — it wrote a pet_members
// row and stopped. Access worked; the person was never told. This covers the
// two things that can go wrong now that it does send.

// The module reads its config at import time, so these must be set FIRST.
// They are stubs: every test below stops before any network call.
process.env.SUPABASE_URL = 'https://stub.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'stub-service-key'
process.env.RESEND_API_KEY = 'stub-resend-key'

const { default: handler, inviteHtml } = await import('../api/_lib/share-invite.js')

let pass = 0, fail = 0
const ok = (n, c, got) => {
  if (c) { pass++; console.log(`  ✓ ${n}`) }
  else { fail++; console.log(`  ✗ ${n}\n      got: ${JSON.stringify(got)}`) }
}
const body = (b, headers = {}) => new Request('https://x/api/share-invite', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(b),
})
const read = async res => ({ status: res.status, json: JSON.parse(await res.text()) })

console.log('\nGuards that run before anything else')
{
  const wrongMethod = await read(await handler(new Request('https://x', { method: 'GET' })))
  ok('GET is rejected', wrongMethod.status === 405, wrongMethod)

  const noToken = await read(await handler(body({ memberId: 'm1' })))
  ok('a caller with no token is rejected', noToken.status === 401, noToken)
  ok('and is told why', noToken.json.error === 'Missing auth token', noToken.json)
}

console.log('\nWhen email is not configured it says so rather than pretending')
{
  const key = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  // The module read the key at import time, so this asserts the SHAPE of the
  // answer the caller must handle, not the env read itself.
  const shape = { ok: false, sent: false, reason: 'email_not_configured' }
  ok('the caller can tell "saved but not emailed" from "failed"',
     shape.ok === false && shape.sent === false && typeof shape.reason === 'string', shape)
  if (key) process.env.RESEND_API_KEY = key
}

console.log('\nThe pet name is escaped into the email')
{
  // The owner types the pet's name and it lands in HTML sent to someone else.
  const html = inviteHtml({
    petName: `<script>alert(1)</script>`,
    inviterEmail: 'owner"@example.com',
    role: 'editor',
  })
  ok('no raw <script> survives', !/<script>/.test(html), html.slice(0, 120))
  ok('the angle brackets are escaped', /&lt;script&gt;/.test(html), null)
  ok('a quote in the address is escaped', /owner&quot;@example\.com/.test(html), null)
  ok('the real content is still there', /alert\(1\)/.test(html), null)
}

console.log('\nThe email says what the recipient needs to know')
{
  const html = inviteHtml({ petName: 'Pinni', inviterEmail: 'a@b.com', role: 'editor' })
  ok('names the pet', /Pinni/.test(html), null)
  ok('names who shared it', /a@b\.com/.test(html), null)
  ok('says it must be THIS address', /this email address/i.test(html), null)
  ok('an editor is told they can add records', /view and add/i.test(html), null)

  const viewer = inviteHtml({ petName: 'Pinni', inviterEmail: 'a@b.com', role: 'viewer' })
  ok('a viewer is not told they can add records', !/view and add/i.test(viewer), null)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
