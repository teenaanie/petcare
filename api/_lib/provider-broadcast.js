// A business writing to the customers who wrote to it.
//
// This endpoint exists because the provider must NOT be able to see its
// customers' email addresses. The browser sends a subject and a body; the
// addresses are resolved here, with the service key, and never leave. There is
// no shape of this feature where the client holds the list.
//
// Three ceilings, all enforced here rather than in the UI, because a UI limit
// is a suggestion:
//
//   MAX_RECIPIENTS    one send reaches at most this many people
//   MAX_PER_MONTH     one business sends at most this many times in 30 days
//   SUBJECT/BODY caps so a broadcast cannot become a mail-merge payload
//
// EMAIL ONLY. The plan asked for a number on a 100-customer broadcast before
// this was built, and the number decided the design: email at that scale rounds
// to nothing against a monthly allowance, while SMS to Indian numbers is
// metered per message and carries DLT template registration, which is a
// compliance workflow rather than a line item. A kennel announcing Diwali
// closures does not need to interrupt anybody, so the expensive channel buys
// nothing. Do not add a Twilio leg here without costing it first.

import { createClient } from '@supabase/supabase-js'
import { sendEmail, emailConfigured, fromDomain } from './_email.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY

export const MAX_RECIPIENTS = 200
export const MAX_PER_MONTH  = 4
export const MAX_SUBJECT    = 120
export const MAX_BODY       = 2000

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function cors(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}
const json = (obj, status = 200) => cors(JSON.stringify(obj), status)

/**
 * The body a customer receives.
 *
 * Says who it is from and WHY they are getting it, because an unexpected email
 * from a kennel is otherwise indistinguishable from a list someone bought. The
 * "you sent them your pet's details" line is the honest answer and it is also
 * the only reason the address exists here.
 */
function broadcastEmail({ providerName, subject, body }) {
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#4A2C0A">
    <p style="font-size:12px;color:#b08d57;margin:0 0 4px;text-transform:uppercase;letter-spacing:.04em">
      A message from</p>
    <h1 style="font-size:20px;margin:0 0 16px;color:#7a4900">${esc(providerName)}</h1>
    <h2 style="font-size:16px;margin:0 0 8px;color:#4A2C0A">${esc(subject)}</h2>
    <div style="font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(body)}</div>
    <hr style="border:none;border-top:1px solid #f0e6c8;margin:24px 0" />
    <p style="font-size:12px;color:#73775b;margin:0">
      You are getting this because you sent ${esc(providerName)} your pet's details
      through Pippy. They cannot see your email address — Pippy sent this on their
      behalf. Reply to them directly on the number you have for them.
    </p>
  </div>`
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 503)
  if (!emailConfigured()) {
    return json({ ok: false, sent: 0, reason: 'email_not_configured' })
  }

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing auth token' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }

  const providerId = String(body?.providerId || '').trim()
  const subject    = String(body?.subject || '').trim()
  const message    = String(body?.body || '').trim()

  if (!providerId) return json({ error: 'providerId required' }, 400)
  if (!subject)    return json({ error: 'Please write a subject.' }, 400)
  if (!message)    return json({ error: 'Please write a message.' }, 400)
  if (subject.length > MAX_SUBJECT) return json({ error: `Subject must be under ${MAX_SUBJECT} characters.` }, 400)
  if (message.length > MAX_BODY)    return json({ error: `Message must be under ${MAX_BODY} characters.` }, 400)

  try {
    // ── Is this caller actually active on this business? ────────────────────
    //
    // Checked HERE against provider_accounts rather than trusting the request,
    // because this runs with the service key and so bypasses every policy that
    // would otherwise answer the question. The status filter is the same one
    // is_provider_member() applies: a suspended claimant must not be able to
    // mail a customer list.
    const { data: account, error: accErr } = await supabase
      .from('provider_accounts')
      .select('id, provider_id, status')
      .eq('provider_id', providerId).eq('user_id', user.id).eq('status', 'active')
      .maybeSingle()
    if (accErr) throw accErr
    if (!account) return json({ error: 'Not allowed' }, 403)

    const { data: provider, error: provErr } = await supabase
      .from('providers').select('name').eq('id', providerId).maybeSingle()
    if (provErr) throw provErr

    // ── The monthly ceiling ─────────────────────────────────────────────────
    //
    // Counted from the rows this endpoint wrote, which is why the table has no
    // INSERT policy: a client-writable count is a count the client chooses.
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { count: recent, error: cntErr } = await supabase
      .from('provider_broadcasts')
      .select('id', { count: 'exact', head: true })
      .eq('provider_id', providerId).gte('sent_at', since)
    if (cntErr) throw cntErr
    if ((recent || 0) >= MAX_PER_MONTH) {
      return json({
        error: `You have sent ${recent} messages in the last 30 days, which is the limit. `
             + 'This keeps Pippy out of your customers’ spam folders.',
      }, 429)
    }

    // ── Who gets it ─────────────────────────────────────────────────────────
    //
    // Exactly: people who sent THIS business a note and typed an address into
    // it. Not auth.users — mailing someone at an address they never offered to
    // this business is the thing this whole model exists to avoid.
    const { data: notes, error: noteErr } = await supabase
      .from('provider_notes')
      .select('contact_email')
      .eq('provider_id', providerId)
      .not('contact_email', 'is', null)
    if (noteErr) throw noteErr

    // One person who sent four notes is one recipient. Lowercased for the
    // dedupe only; the address is sent as the customer typed it.
    const seen = new Map()
    for (const n of notes || []) {
      const addr = String(n.contact_email || '').trim()
      if (!addr || !addr.includes('@')) continue
      const key = addr.toLowerCase()
      if (!seen.has(key)) seen.set(key, addr)
    }
    const recipients = [...seen.values()].slice(0, MAX_RECIPIENTS)
    const capped = seen.size > MAX_RECIPIENTS

    if (recipients.length === 0) {
      return json({ ok: true, sent: 0, reason: 'no_recipients' })
    }

    const html = broadcastEmail({ providerName: provider?.name || 'your pet care provider', subject, body: message })

    // Sent one at a time, each isolated: one bad address must not cost the
    // other ninety-nine their message. Failures are counted and reported, not
    // raised.
    let sent = 0, failures = 0
    for (const to of recipients) {
      try { await sendEmail(to, subject, html); sent += 1 }
      catch (e) { failures += 1; console.error('[broadcast] send failed:', e.message) }
    }

    // Recorded AFTER the send, with what actually happened. If every address
    // bounced this still records the attempt, because the ceiling is about how
    // often a business mails its customers, not how often it succeeds.
    const { error: recErr } = await supabase.from('provider_broadcasts').insert({
      provider_id: providerId, sent_by: user.id,
      subject, body: message, recipients: sent, failures,
    })
    if (recErr) console.error('[broadcast] could not record:', recErr.message)

    return json({ ok: true, sent, failures, capped, from: fromDomain() })
  } catch (e) {
    console.error('[broadcast]', e)
    return json({ error: 'Could not send that. Please try again.' }, 500)
  }
}
