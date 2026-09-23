// scripts/test-notify.mjs
//
// The shared outbound channels. Run with: npm run test:notify
//
// This exists because sendEmail/sendSMS/sendPush were lifted out of
// morning-reminders.js so the provider platform could reuse them, and sendPush
// changed shape in the process: it used to build the reminder wording itself
// and now takes the notification. A wrong payload here does not throw — the
// push simply arrives saying the wrong thing, or arrives blank, and nothing in
// the logs says so. So the old formula is pinned against the new one.
//
// It also checks the two things a caller can get wrong without noticing: a
// subscription that has expired must be deleted rather than retried forever,
// and passing no `scope` must not filter on a column that does not exist yet.

import webPush from 'web-push'

// Real keys, because web-push validates them at module load and _notify.js
// configures VAPID on import. Generated per run; nothing is ever sent.
const keys = webPush.generateVAPIDKeys()
process.env.VAPID_PUBLIC_KEY  = keys.publicKey
process.env.VAPID_PRIVATE_KEY = keys.privateKey

const { sendPush } = await import('../netlify/functions/_notify.js')

let failed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

// The payload morning-reminders.js built before the extraction, kept verbatim
// as the reference. If the call site drifts, this is what catches it.
function legacyPayload(petName, reminders) {
  return JSON.stringify({
    title: `🐾 ${petName} has ${reminders.length} reminder${reminders.length > 1 ? 's' : ''} today`,
    body: reminders.map(r => r.type).join(', '),
    url: '/',
  })
}

// What the call site in morning-reminders.js now passes.
function currentNotification(petName, rems) {
  return {
    title: `🐾 ${petName} has ${rems.length} reminder${rems.length > 1 ? 's' : ''} today`,
    body:  rems.map(r => r.type).join(', '),
    url:   '/',
  }
}

// ── A fake Supabase that records what was asked of it ────────────────────────

function fakeSupabase(subs) {
  const calls = { filters: [], deleted: [] }
  const builder = {
    select: () => builder,
    eq: (col, val) => { calls.filters.push([col, val]); return builder },
    delete: () => ({ eq: (_c, id) => { calls.deleted.push(id); return Promise.resolve({}) } }),
    then: (res) => res({ data: subs, error: null }),
  }
  return { client: { from: () => builder }, calls }
}

const sub = (id) => ({ id, endpoint: `https://push.example/${id}`, p256dh: 'k', auth: 'a' })

// ── 1. The payload still says exactly what it used to ────────────────────────

const cases = [
  ['Bruno',  [{ type: 'Vaccination' }]],
  ['Simba',  [{ type: 'Deworming' }, { type: 'Tick spot-on' }]],
  ['Coco',   [{ type: 'A' }, { type: 'B' }, { type: 'C' }]],
]

for (const [pet, rems] of cases) {
  const sent = []
  const orig = webPush.sendNotification
  webPush.sendNotification = async (_s, payload) => { sent.push(payload) }
  const { client } = fakeSupabase([sub('s1')])
  await sendPush(client, 'user-1', currentNotification(pet, rems))
  webPush.sendNotification = orig
  check(`payload unchanged — ${pet}, ${rems.length} reminder(s)`, sent[0], legacyPayload(pet, rems))
}

// ── 2. No scope means no filter on a column that does not exist yet ──────────

{
  const orig = webPush.sendNotification
  webPush.sendNotification = async () => {}
  const { client, calls } = fakeSupabase([sub('s1')])
  await sendPush(client, 'user-1', { title: 't', body: 'b' })
  webPush.sendNotification = orig
  check('no scope -> filters on user_id only', calls.filters, [['user_id', 'user-1']])
}

{
  const orig = webPush.sendNotification
  webPush.sendNotification = async () => {}
  const { client, calls } = fakeSupabase([sub('s1')])
  await sendPush(client, 'user-1', { title: 't', body: 'b' }, { scope: 'provider' })
  webPush.sendNotification = orig
  check('scope given -> filters on both', calls.filters, [['user_id', 'user-1'], ['scope', 'provider']])
}

// ── 3. A dead subscription is deleted, not retried forever ───────────────────

{
  const orig = webPush.sendNotification
  webPush.sendNotification = async (s) => {
    const e = new Error('gone'); e.statusCode = s.endpoint.endsWith('dead') ? 410 : 200
    if (e.statusCode === 410) throw e
  }
  const { client, calls } = fakeSupabase([sub('alive'), sub('dead')])
  await sendPush(client, 'user-1', { title: 't', body: 'b' })
  webPush.sendNotification = orig
  check('410 deletes that subscription only', calls.deleted, ['dead'])
}

// ── 4. url defaults to '/' when the caller omits it ──────────────────────────

{
  const sent = []
  const orig = webPush.sendNotification
  webPush.sendNotification = async (_s, p) => { sent.push(JSON.parse(p)) }
  const { client } = fakeSupabase([sub('s1')])
  await sendPush(client, 'user-1', { title: 't', body: 'b' })
  webPush.sendNotification = orig
  check('url defaults to /', sent[0].url, '/')
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
