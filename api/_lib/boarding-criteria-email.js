// A boarder sending a customer what they need before a stay.
//
// The criteria already exist in two places a customer may never look: the
// directory listing, and a checklist inside the app for people who use the app.
// Most of a boarder's customers do neither — they rang, they are coming on
// Friday, and they want to know what to bring. Until now the boarder retyped it
// into WhatsApp from memory, which is how a requirement quietly stops being
// asked for.
//
// ── Who it can be sent to ───────────────────────────────────────────────────
//
// One customer in the sender's OWN book, by id. Never a typed address: an
// endpoint that mails whatever address it is handed is an open relay with a
// kennel's name on it. The caller must be an active member of the business that
// owns the customer, checked here with the service key because no policy is
// doing it for us.
//
// ── What it contains ────────────────────────────────────────────────────────
//
// Only what the boarder has already published about themselves: their criteria,
// their name, and their own phone number. Nothing about the customer beyond
// their name, and nothing about any animal — this is the same mail whoever it
// goes to, which is what makes it safe to send in a batch later if that is ever
// wanted.

import { createClient } from '@supabase/supabase-js'
import { sendEmail, emailConfigured } from './_email.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY

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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 503)
  if (!emailConfigured()) return json({ ok: false, sent: false, reason: 'email_not_configured' })

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing auth token' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  const customerId = String(body?.customerId || '').trim()
  // The rendered lines come from the browser, which holds the catalogue and the
  // boarder's own additions. They are escaped on the way into the mail and are
  // the boarder's own words about their own business either way.
  const lines = Array.isArray(body?.lines) ? body.lines.slice(0, 40) : []
  if (!customerId) return json({ error: 'customerId required' }, 400)
  if (!lines.length) return json({ ok: false, sent: false, reason: 'nothing_to_send' })

  try {
    const { data: customer, error } = await supabase
      .from('provider_customers')
      .select('id, provider_id, name, email')
      .eq('id', customerId).maybeSingle()
    if (error) throw error
    if (!customer) return json({ ok: true, sent: false, reason: 'not_found' })

    // Is the caller actually on this business? Same two matches as
    // is_provider_member(): a claim carries an address until its owner signs in.
    const { data: accounts, error: accErr } = await supabase
      .from('provider_accounts')
      .select('id, user_id, email')
      .eq('provider_id', customer.provider_id)
      .eq('status', 'active')
    if (accErr) throw accErr
    const mine = (accounts || []).some(a =>
      a.user_id === user.id ||
      (a.email && user.email && a.email.toLowerCase() === user.email.toLowerCase()))
    // The same answer as a customer that does not exist: whether somebody
    // else's customer is real is not something a caller gets to learn.
    if (!mine) return json({ ok: true, sent: false, reason: 'not_found' })

    const to = String(customer.email || '').trim()
    if (!to.includes('@')) return json({ ok: true, sent: false, reason: 'no_address' })

    const { data: provider } = await supabase
      .from('providers').select('name, phone').eq('id', customer.provider_id).maybeSingle()
    const who = provider?.name || 'Your boarding house'

    const items = lines
      .map(l => `<li style="margin:0 0 8px"><strong>${esc(l.label)}</strong>${
        l.help ? `<br/><span style="color:#73775b">${esc(l.help)}</span>` : ''}</li>`)
      .join('')

    const html = `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#4A2C0A">
    <h1 style="font-size:20px;margin:0 0 12px;color:#7a4900">Before your pet's stay</h1>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
      ${esc(customer.name ? customer.name + ', here' : 'Here')} is what ${esc(who)} needs
      before a stay.
    </p>
    <ul style="font-size:14px;line-height:1.5;padding-left:20px;margin:0 0 16px">${items}</ul>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
      Anything you are unsure about, just ask${provider?.phone ? ` — ${esc(provider.phone)}` : ''}.
    </p>
    <hr style="border:none;border-top:1px solid #f0e6c8;margin:24px 0" />
    <p style="font-size:12px;color:#73775b;margin:0">
      Sent by ${esc(who)} through Pippy, because you are in their book.
    </p>
  </div>`

    await sendEmail(to, `Before your pet's stay at ${who}`, html)
    return json({ ok: true, sent: true })
  } catch (e) {
    console.error('[boarding-criteria-email]', e)
    return json({ error: 'Could not send that.' }, 500)
  }
}
