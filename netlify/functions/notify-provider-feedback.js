// Tell the admins when a business sends a message.
//
// Provider feedback used to land in a table and wait to be noticed. That is
// tolerable for a feature request and not for the case this exists to serve: a
// business whose access has just been suspended, asking why. Nobody was going
// to look.
//
// Fired by the client after the row is written, rather than by a database
// trigger, because that is the pattern the rest of this codebase already uses
// and it needs no new extension. The trade is honest and worth knowing: if the
// browser dies between the insert and this call, the feedback is saved and the
// email is not. The row is never lost, only the nudge.
//
// Three things it refuses to do:
//
//   1. Notify about somebody else's message. The caller's token is checked
//      against the row's user_id, so this cannot be used to make the admins'
//      inbox ring on demand by quoting ids.
//   2. Notify twice for the same row, or long after the fact. A row older than
//      REPLAY_WINDOW_MIN is ignored, which bounds what a replayed request can
//      cost without needing a "notified" column.
//   3. Reveal whether a feedback id exists. Every refusal returns the same 202,
//      because the caller is a browser that should carry on regardless and an
//      attacker should learn nothing.

import { createClient } from '@supabase/supabase-js'
import { maskEmail, bodyShape } from './_redact.js'
import { sendEmail, sendPush, emailConfigured, fromDomain } from './_notify.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
const APP_URL      = process.env.APP_URL || 'https://pippypets.com'

const REPLAY_WINDOW_MIN = 10

function cors(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}
const json = (obj, status = 200) => cors(JSON.stringify(obj), status)

// Everything that is not a hard configuration error answers this. See note 3.
const accepted = () => json({ ok: true }, 202)

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function emailHtml({ businessName, businessArea, category, message, senderEmail, senderPhone }) {
  const from = [senderEmail, senderPhone].filter(Boolean).join(' · ') || 'no contact on file'
  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 520px; color: #4A2C0A;">
      <h2 style="color:#7a4900; margin:0 0 4px;">${escapeHtml(businessName || 'A business')}</h2>
      <p style="color:#b08d57; margin:0 0 16px; font-size:14px;">
        ${escapeHtml([businessArea, category].filter(Boolean).join(' · '))}
      </p>
      <div style="background:#fffef8; border:1px solid #f0e6c8; border-radius:12px; padding:14px; white-space:pre-wrap;">
${escapeHtml(message)}
      </div>
      <p style="color:#73775b; font-size:13px; margin:16px 0 0;">
        From ${escapeHtml(from)}.
      </p>
      <p style="color:#73775b; font-size:13px; margin:8px 0 0;">
        It is in the Feedback tab of the admin dashboard:
        <a href="${APP_URL}" style="color:#b08d57;">${APP_URL}</a>
      </p>
    </div>`
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  if (!SUPABASE_URL || !SERVICE_KEY) {
    // Same shape as ai-complete.js: say which variable, so a deploy that looks
    // fine but silently sends nothing is diagnosable.
    const missing = [!SUPABASE_URL && 'SUPABASE_URL', !SERVICE_KEY && 'SUPABASE_SERVICE_KEY'].filter(Boolean)
    console.error('Not configured — missing env: ' + missing.join(', '))
    return json({ error: `Server is misconfigured (missing ${missing.join(', ')}).` }, 503)
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
  const feedbackId = body?.feedbackId
  if (!feedbackId) return json({ error: 'Missing feedbackId' }, 400)

  const { data: row, error: rowErr } = await supabase
    .from('feedback')
    .select('id, user_id, provider_id, category, message, created_at')
    .eq('id', feedbackId)
    .maybeSingle()

  if (rowErr) { console.error('Feedback lookup failed:', rowErr.message); return accepted() }

  // The three refusals, all answering 202 so the caller learns nothing.
  if (!row)                                   return accepted()
  if (row.user_id !== user.id)                return accepted()
  if (!row.provider_id)                       return accepted()
  if (Date.now() - new Date(row.created_at).getTime() > REPLAY_WINDOW_MIN * 60_000) return accepted()

  const { data: provider } = await supabase
    .from('providers').select('name, area').eq('id', row.provider_id).maybeSingle()

  // Who the message is from. The admins can already see this; including it
  // saves a lookup when the whole point is replying quickly.
  const { data: sender } = await supabase.auth.admin.getUserById(row.user_id)

  const { data: admins, error: adminErr } = await supabase
    .from('admins').select('user_id, email').is('revoked_at', null)
  if (adminErr) { console.error('Admin lookup failed:', adminErr.message); return accepted() }
  if (!admins?.length) { console.warn('Provider feedback arrived with no active admins to tell.'); return accepted() }

  const subject = `Pippy: message from ${provider?.name || 'a business'}`
  const html = emailHtml({
    businessName: provider?.name,
    businessArea: provider?.area,
    category:     row.category,
    message:      row.message,
    senderEmail:  sender?.user?.email,
    senderPhone:  sender?.user?.phone,
  })

  if (emailConfigured()) console.log(`Sending provider-feedback alert from domain ${fromDomain()}`)

  let notified = 0
  for (const admin of admins) {
    // admins.email is the bootstrap address; auth.users is the truth once the
    // row is bound, and a row can be bound with no email column set at all.
    let to = admin.email
    if (admin.user_id) {
      const { data: au } = await supabase.auth.admin.getUserById(admin.user_id)
      to = au?.user?.email || to
    }
    if (!to) continue

    try {
      await sendEmail(to, subject, html)
      notified++
    } catch (e) {
      // One admin's bounced address must not stop the others being told.
      console.error(`Admin email failed for ${maskEmail(to)}: ${e.message}`)
    }

    if (admin.user_id) {
      await sendPush(supabase, admin.user_id, {
        title: 'New provider message',
        body:  `${provider?.name || 'A business'} sent you a message`,
        url:   '/',
      }).catch(e => console.error('Admin push failed:', e.message))
    }
  }

  // Never the message itself: it is a third party's words and this log is not
  // the place for them.
  console.log(`Provider feedback alert: ${notified} admin(s), ${bodyShape(row.message)}`)
  return json({ ok: true, notified }, 200)
}
