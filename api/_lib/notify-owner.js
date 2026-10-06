// api/_lib/notify-owner.js
//
// Tells the person running Pippy when somebody signs up or adds a pet.
//
// THE CLIENT ASKS FOR THIS, SO THE CLIENT IS NOT TRUSTED. Anyone can post to
// this endpoint; what stops it becoming a way to spam the owner's inbox — or
// to fish for whether a pet id exists — is that nothing in the request body is
// believed. The caller's JWT identifies them, and every claim is then checked
// against the database with the service key:
//
//   signup     the account must have been created in the last few minutes
//   pet_added  the pet must exist, be OWNED BY THE CALLER, and be just created
//
// A replay inside that window can send a duplicate alert about the caller's own
// pet. That is the whole blast radius, and a duplicate ops email is a better
// trade than a table and a migration to dedupe it.
//
// Sending never blocks the app: the client fires this and ignores the result,
// and a missing RESEND_API_KEY logs rather than throws. An alert failing must
// never be why a pet did not save.

import { createClient } from '@supabase/supabase-js'
import { sendEmail, emailConfigured, fromDomain } from './_email.js'
import { maskEmail, maskPhone } from './_redact.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
// Where the alerts go. An env var so it can change without a deploy — set
// OWNER_ALERT_EMAIL on the host to override this default.
const ALERT_EMAIL  = process.env.OWNER_ALERT_EMAIL || 'hello@pippypets.com'

// How recent an event has to be to be worth announcing. Long enough for a slow
// phone and a retry, short enough that an old account cannot be replayed.
const FRESH_MS = 10 * 60 * 1000

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

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))

function layout(title, rows) {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px">
    <h2 style="color:#7a4900;margin:0 0 12px">${esc(title)}</h2>
    <table style="border-collapse:collapse;font-size:14px">
      ${rows.map(([k, v]) => `<tr>
        <td style="padding:4px 12px 4px 0;color:#73775b">${esc(k)}</td>
        <td style="padding:4px 0;color:#2b2b2b"><strong>${esc(v)}</strong></td>
      </tr>`).join('')}
    </table>
    <p style="color:#a08f7a;font-size:12px;margin-top:16px">
      Sent by Pippy because someone used the app. Reply-to is not monitored.
    </p>
  </div>`
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 503)

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing auth token' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  const event = body?.event

  // A closed set. An unknown event is rejected rather than passed through.
  if (event !== 'signup' && event !== 'pet_added') {
    return json({ error: 'Unknown event' }, 400)
  }

  const fresh = t => t && (Date.now() - new Date(t).getTime()) < FRESH_MS

  // MASKED, on purpose. These alerts say that something happened and which pet
  // it was about; they are not a copy of the user list. A full address in an
  // ops inbox is personal data sitting somewhere it is not needed — and the
  // admin dashboard already shows exactly who signed up, to whoever is entitled
  // to see it. te***@gmail.com is enough to tell two signups apart.
  const who   = user.email ? maskEmail(user.email)
              : user.phone ? maskPhone(user.phone)
              : user.id

  try {
    if (event === 'signup') {
      // Checked against auth.users, not against what the client claimed.
      if (!fresh(user.created_at)) return json({ ok: true, skipped: 'not_a_new_account' })

      await sendEmail(ALERT_EMAIL, 'Pippy — a new person signed up',
        layout('A new person signed up', [
          ['Account', who],
          ['Signed up', new Date(user.created_at).toUTCString()],
        ]))
      console.log(`Signup alert for ${who} → ${maskEmail(ALERT_EMAIL)} (from ${fromDomain()})`)
      return json({ ok: true, sent: emailConfigured() })
    }

    // pet_added — the pet is looked up rather than taken from the request, so
    // the name in the email is the name in the database and the caller cannot
    // announce a pet that is not theirs.
    const petId = String(body?.petId || '')
    if (!petId) return json({ error: 'petId required' }, 400)

    const { data: pet, error } = await supabase
      .from('pets').select('id, name, species, breed, user_id, created_at')
      .eq('id', petId).maybeSingle()
    if (error) throw error

    // Same answer whether the pet is missing or belongs to someone else, so
    // this cannot be used to test which pet ids exist.
    if (!pet || pet.user_id !== user.id) return json({ ok: true, skipped: 'not_yours' })
    if (!fresh(pet.created_at))          return json({ ok: true, skipped: 'not_new' })

    const { count } = await supabase
      .from('pets').select('*', { count: 'exact', head: true }).eq('user_id', user.id)

    await sendEmail(ALERT_EMAIL, `Pippy — ${pet.name || 'a pet'} was added`,
      layout('A pet was added', [
        ['Pet', pet.name || '(no name)'],
        ['Species', pet.species || '—'],
        ['Breed', pet.breed || '—'],
        ['Owner', who],
        ['Their pets now', String(count ?? '?')],
      ]))
    console.log(`Pet alert for ${who} → ${maskEmail(ALERT_EMAIL)} (from ${fromDomain()})`)
    return json({ ok: true, sent: emailConfigured() })
  } catch (e) {
    // Logged, not raised to the user — they were adding a pet, not subscribing
    // to our alerts, and this must never look like their action failed.
    console.error('notify-owner failed:', e?.message || e)
    return json({ ok: false, error: 'Notification could not be sent' }, 200)
  }
}
