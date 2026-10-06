// api/_lib/share-invite.js
//
// Tells someone that a pet has been shared with them.
//
// The Share screen said "Send Invite" and sent nothing. It wrote a row to
// pet_members and stopped, which grants access the moment that person signs up
// with the same address — but nobody ever told them to. The invite worked and
// looked broken, which is the worst combination: the owner thinks it failed and
// invites again, and the person they wanted to reach never hears about it.
//
// Same trust model as notify-owner.js: the client asks, the server believes
// nothing. The caller's JWT says who they are, then the invite is looked up and
// checked to be one THEY are entitled to have made.
//
// This one sends to a THIRD PARTY, which notify-owner does not, so it carries
// two extra constraints:
//   - a per-account monthly cap, because "email an arbitrary address with text
//     I control" is a spam primitive if it is uncapped
//   - the pet's name is escaped into the HTML, because the owner types it

import { createClient } from '@supabase/supabase-js'
import { sendEmail, emailConfigured, fromDomain } from './_email.js'
import { maskEmail } from './_redact.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
const APP_URL      = process.env.APP_URL || 'https://pippyapp.vercel.app'

// Invites are a human-paced action: a pet is shared with a handful of people,
// not a mailing list. A cap well above real use still stops a runaway.
const MONTHLY_INVITE_LIMIT = parseInt(process.env.MONTHLY_INVITE_LIMIT || '50')

// Only announce an invite that was just made, so an old row cannot be replayed
// to email the same person again and again.
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

const esc = s => String(s ?? '').replace(/[<>&"]/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))

/**
 * The email body. Exported so the escaping can be tested: the pet's name is
 * typed by the owner and lands in HTML sent to somebody else, which is the one
 * injection route this endpoint has.
 */
export function inviteHtml({ petName, inviterEmail, role }) {
  const what = role === 'editor'
    ? 'You can view and add to their records.'
    : 'You can view their records.'
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;color:#2b2b2b">
    <h2 style="color:#7a4900;margin:0 0 12px">${esc(petName)} has been shared with you</h2>
    <p style="font-size:15px;line-height:1.5">
      <strong>${esc(inviterEmail)}</strong> has shared their pet
      <strong>${esc(petName)}</strong> with you on Pippy. ${esc(what)}
    </p>
    <p style="font-size:15px;line-height:1.5">
      Sign in with <strong>this email address</strong> and ${esc(petName)} will be there.
      Access is matched on your address, so it has to be the one this was sent to.
    </p>
    <p style="margin:20px 0">
      <a href="${APP_URL}" style="background:#f2b83d;color:#7a4900;text-decoration:none;
         padding:11px 20px;border-radius:12px;font-weight:bold;display:inline-block">
        Open Pippy
      </a>
    </p>
    <p style="color:#a08f7a;font-size:12px">
      If you were not expecting this, you can ignore it — nothing happens until you sign in.
    </p>
  </div>`
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 503)
  if (!emailConfigured()) {
    // Said plainly rather than pretending. The invite itself already worked.
    return json({ ok: false, sent: false, reason: 'email_not_configured' })
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
  const memberId = String(body?.memberId || '')
  if (!memberId) return json({ error: 'memberId required' }, 400)

  try {
    // The invite is READ from the database, so the address emailed is the one
    // actually granted access — not one supplied in the request.
    const { data: member, error } = await supabase
      .from('pet_members')
      .select('id, email, role, pet_id, created_at')
      .eq('id', memberId).maybeSingle()
    if (error) throw error
    if (!member) return json({ ok: true, sent: false, reason: 'not_found' })

    // Only the pet's OWNER may cause an email to be sent about it.
    const { data: pet } = await supabase
      .from('pets').select('id, name, user_id').eq('id', member.pet_id).maybeSingle()
    if (!pet || pet.user_id !== user.id) {
      // Same answer either way, so this cannot be used to probe ids.
      return json({ ok: true, sent: false, reason: 'not_yours' })
    }
    if (Date.now() - new Date(member.created_at).getTime() > FRESH_MS) {
      return json({ ok: true, sent: false, reason: 'not_new' })
    }

    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    const { count } = await supabase
      .from('api_usage').select('*', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('type', 'share_invite')
      .gte('created_at', startOfMonth)
    if ((count || 0) >= MONTHLY_INVITE_LIMIT) {
      return json({ ok: false, sent: false, reason: 'limit_reached',
                    error: `You have sent ${MONTHLY_INVITE_LIMIT} invites this month.` }, 429)
    }

    await sendEmail(member.email,
      `${pet.name} has been shared with you on Pippy`,
      inviteHtml({ petName: pet.name, inviterEmail: user.email || 'A Pippy user', role: member.role }))

    await supabase.from('api_usage').insert({ user_id: user.id, type: 'share_invite' })
    console.log(`Invite for ${pet.name} → ${maskEmail(member.email)} (from ${fromDomain()})`)
    return json({ ok: true, sent: true })
  } catch (e) {
    console.error('share-invite failed:', e?.message || e)
    // The invite row already exists, so access is granted either way. The
    // caller shows this so the owner can tell the person another way.
    return json({ ok: false, sent: false, error: 'The invite was saved, but the email could not be sent.' }, 200)
  }
}
