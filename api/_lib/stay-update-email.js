// Telling an owner their pet's boarder posted an update.
//
// The provider does not know the owner's address and must not learn it, so the
// address is resolved here from the note the update hangs off — the same
// contact_email the customer typed into "How they can reach you". If they left
// it blank there is nothing to send to, and that is a correct outcome rather
// than a failure: they will see the update in the app.
//
// The mail deliberately carries NO photo and no quoted text. An update can be a
// picture of someone's dog, and an email is forwardable, cacheable and sits in
// an inbox for years. The notification says one landed; the app shows it, where
// the private bucket and a one-hour signed URL still apply.

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
  const updateId = String(body?.updateId || '').trim()
  if (!updateId) return json({ error: 'updateId required' }, 400)

  try {
    // Read the update, and check the caller is the one who posted it. This runs
    // with the service key, so no policy is doing that for us — without this
    // check any signed-in person could make us mail a stranger's customer.
    const { data: update, error } = await supabase
      .from('stay_updates')
      .select('id, note_id, provider_id, posted_by, body, photo_path')
      .eq('id', updateId).maybeSingle()
    if (error) throw error
    if (!update) return json({ ok: true, sent: false, reason: 'not_found' })
    if (update.posted_by !== user.id) return json({ error: 'Not allowed' }, 403)

    const { data: note, error: noteErr } = await supabase
      .from('provider_notes')
      .select('contact_email, pet_label')
      .eq('id', update.note_id).maybeSingle()
    if (noteErr) throw noteErr

    const to = String(note?.contact_email || '').trim()
    if (!to || !to.includes('@')) return json({ ok: true, sent: false, reason: 'no_address' })

    const { data: provider } = await supabase
      .from('providers').select('name').eq('id', update.provider_id).maybeSingle()

    const who  = provider?.name || 'Your pet care provider'
    const pet  = (note?.pet_label || 'your pet').split(',')[0]
    const kind = update.photo_path && update.body ? 'a note and a photo'
               : update.photo_path ? 'a photo' : 'a note'

    const html = `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#4A2C0A">
    <h1 style="font-size:20px;margin:0 0 12px;color:#7a4900">An update on ${esc(pet)}</h1>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
      ${esc(who)} posted ${esc(kind)} about ${esc(pet)}.
    </p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
      Open ${esc(pet)}'s page in Pippy to see it.
    </p>
    <hr style="border:none;border-top:1px solid #f0e6c8;margin:24px 0" />
    <p style="font-size:12px;color:#73775b;margin:0">
      You are getting this because you sent ${esc(who)} ${esc(pet)}'s details
      through Pippy. The update itself stays in the app.
    </p>
  </div>`

    await sendEmail(to, `An update on ${pet}`, html)
    return json({ ok: true, sent: true })
  } catch (e) {
    console.error('[stay-update-email]', e)
    return json({ error: 'Could not send that.' }, 500)
  }
}
