// Telling a business that a customer sent them their pet's details.
//
// The note lands in provider_notes and nothing else happened: a provider found
// out by signing in and looking, which for a business that signs in once a week
// means a dog arriving before its note is read.
//
// ── Who is told ─────────────────────────────────────────────────────────────
//
// The ACTIVE CLAIMANTS of that business, resolved here from provider_accounts.
// Not providers.email, which is a scraped or admin-typed address on a listing
// nobody has claimed — 963 of the listings in the directory are exactly that,
// and mailing one would be a cold email to a business that never signed up,
// announcing that a stranger sent details in their name. An unclaimed listing
// gets no mail, which is the honest outcome: there is no account to read it.
//
// ── What the mail says, and what it does not ────────────────────────────────
//
// The pet's label and the stay dates, and nothing else. No body, no feeding,
// no medication, no phone number. The note is the provider's to read — in the
// app, behind their sign-in — and an email is forwardable, cacheable and sits
// in an inbox for years. The same reasoning as stay-update-email.js, which
// carries no photo for the same reason.
//
// ── Why the caller is checked ───────────────────────────────────────────────
//
// This runs with the service key, so no policy is doing it for us. Without the
// sent_by check any signed-in person could make us mail any business about any
// note, which is a spam cannon pointed at the directory.

import { createClient } from '@supabase/supabase-js'
import { sendEmail, emailConfigured } from './_email.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
const SITE_URL     = process.env.PUBLIC_SITE_URL || 'https://pippypets.com'

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

/** "14 Oct – 18 Oct", "from 14 Oct", or nothing at all. */
function stayLine(startsOn, endsOn) {
  const day = iso => {
    if (!iso) return null
    const d = new Date(`${iso}T00:00:00Z`)
    return Number.isNaN(d.getTime()) ? null
      : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }
  const a = day(startsOn), b = day(endsOn)
  if (a && b) return `${a} – ${b}`
  if (a) return `from ${a}`
  if (b) return `until ${b}`
  return null
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 503)
  if (!emailConfigured()) return json({ ok: false, sent: 0, reason: 'email_not_configured' })

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing auth token' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  const noteId = String(body?.noteId || '').trim()
  if (!noteId) return json({ error: 'noteId required' }, 400)

  try {
    const { data: note, error } = await supabase
      .from('provider_notes')
      .select('id, provider_id, sent_by, pet_label, starts_on, ends_on')
      .eq('id', noteId).maybeSingle()
    if (error) throw error
    // Deliberately the same answer as "that id does not exist": whether a note
    // is real is not something an unrelated caller gets to learn.
    if (!note || note.sent_by !== user.id) return json({ ok: true, sent: 0, reason: 'not_found' })

    const { data: accounts, error: accErr } = await supabase
      .from('provider_accounts')
      .select('email')
      .eq('provider_id', note.provider_id)
      .eq('status', 'active')
    if (accErr) throw accErr

    // One address each, however many claims they hold on the business.
    const to = [...new Set((accounts || [])
      .map(a => String(a.email || '').trim().toLowerCase())
      .filter(e => e && e.includes('@')))]
    if (!to.length) return json({ ok: true, sent: 0, reason: 'no_claimant' })

    const { data: provider } = await supabase
      .from('providers').select('name').eq('id', note.provider_id).maybeSingle()

    const who  = provider?.name || 'your business'
    const pet  = String(note.pet_label || 'a pet').split(',')[0]
    const stay = stayLine(note.starts_on, note.ends_on)

    const html = `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#4A2C0A">
    <h1 style="font-size:20px;margin:0 0 12px;color:#7a4900">A customer sent you ${esc(pet)}'s details</h1>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
      Someone who books with ${esc(who)} has sent you what you need to know about
      ${esc(pet)}${stay ? ` for <strong>${esc(stay)}</strong>` : ''} — what they are fed,
      what they react to, what they are on, and how to reach their owner.
    </p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 20px">
      <a href="${esc(SITE_URL)}/business" style="color:#7a4900;font-weight:700">
        Sign in to read it</a>.
    </p>
    <hr style="border:none;border-top:1px solid #f0e6c8;margin:24px 0" />
    <p style="font-size:12px;color:#73775b;margin:0">
      The details themselves stay in Pippy rather than in this email. You are getting
      this because you have an account for ${esc(who)}.
    </p>
  </div>`

    let sent = 0
    for (const address of to) {
      try {
        await sendEmail(address, `${pet}'s details, from a customer`, html)
        sent += 1
      } catch (e) {
        // One bad address must not stop the others being told.
        console.error('[inform-provider-email] send failed', e)
      }
    }
    return json({ ok: true, sent })
  } catch (e) {
    console.error('[inform-provider-email]', e)
    return json({ error: 'Could not send that.' }, 500)
  }
}
