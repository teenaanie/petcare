// netlify/functions/morning-reminders.js
// Scheduled function — runs daily at 7:00 AM IST (1:30 AM UTC)
// Checks all reminders due today, sends email + SMS to each user

import { createClient } from '@supabase/supabase-js'
import webPush from 'web-push'
import { maskEmail, maskPhone, bodyShape } from './_redact.js'

const SUPABASE_URL   = process.env.SUPABASE_URL
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY
const CRON_SECRET = process.env.CRON_SECRET   // set by Vercel on scheduled runs
const TWILIO_SID     = process.env.TWILIO_ACCOUNT_SID
const TWILIO_TOKEN   = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM    = process.env.TWILIO_PHONE_NUMBER
const RESEND_API_KEY = process.env.RESEND_API_KEY        // free at resend.com
const FROM_EMAIL     = process.env.FROM_EMAIL || 'reminders@teenaspetcare.com'
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT || 'mailto:teena.anie9@gmail.com'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

// ── Email via Resend ──────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log(`[EMAIL SKIPPED] No RESEND_API_KEY. Would send to ${maskEmail(to)}`)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Email failed: ${err.message}`)
  }
}

// ── SMS via Twilio ────────────────────────────────────────────────────────────

async function sendSMS(to, body) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    console.log(`[SMS SKIPPED] Twilio not configured. Would send to ${maskPhone(to)} (${bodyShape(body)})`)
    return
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }).toString(),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`SMS failed: ${err.message}`)
  }
}

// ── Email HTML template ───────────────────────────────────────────────────────

function reminderEmailHtml(petName, reminders) {
  const rows = reminders.map(r => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #F0E6C8;">
        <strong style="color:#4A2C0A">${r.type}</strong>
        ${r.notes ? `<br><span style="color:#B8A080;font-size:13px">${r.notes}</span>` : ''}
      </td>
    </tr>`).join('')

  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#FFFEF8;border:1px solid #F0E6C8;border-radius:16px;overflow:hidden">
      <div style="background:#F9D548;padding:20px 24px">
        <h1 style="margin:0;color:#4A2C0A;font-size:20px">🐾 Pippy Reminder</h1>
        <p style="margin:4px 0 0;color:#6B4C1E;font-size:14px">Daily health check for <strong>${petName}</strong></p>
      </div>
      <div style="padding:20px 24px">
        <p style="color:#4A2C0A;font-weight:bold;margin-bottom:8px">Due today:</p>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;border:1px solid #F0E6C8">
          ${rows}
        </table>
        <p style="color:#B8A080;font-size:12px;margin-top:16px">Open Pippy to mark these as done or view more details.</p>
      </div>
    </div>`
}

// ── Web Push ──────────────────────────────────────────────────────────────────

async function sendPush(supabase, userId, petName, reminders) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('[PUSH SKIPPED] VAPID keys not configured.')
    return
  }
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (error || !subs || subs.length === 0) return

  const payload = JSON.stringify({
    title: `🐾 ${petName} has ${reminders.length} reminder${reminders.length > 1 ? 's' : ''} today`,
    body: reminders.map(r => r.type).join(', '),
    url: '/',
  })

  for (const sub of subs) {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    } catch (e) {
      // 404/410 means the subscription is no longer valid — clean it up
      if (e.statusCode === 404 || e.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      } else {
        console.error('Push send failed:', e.message)
      }
    }
  }
}

// ── Recurrence ────────────────────────────────────────────────────────────────
//
// A recurring reminder used to fire once and never again: nothing here or in
// the app advanced `due_date`, and marking one done only flips `is_done`. So
// every "Monthly" and "Yearly" reminder in the database was, in practice, a
// one-off. These are the frequency strings the app actually writes (the form,
// the new-pet suggestions and the voice parser), lowercased.

const RECURRENCE = {
  'daily':          { days: 1 },
  'weekly':         { days: 7 },
  'fortnightly':    { days: 14 },
  'every 2 weeks':  { days: 14 },
  'monthly':        { months: 1 },
  'every 3 months': { months: 3 },
  'quarterly':      { months: 3 },
  'every 6 months': { months: 6 },
  'yearly':         { months: 12 },
  'annually':       { months: 12 },
}

// Adding a month to the 31st must not land in the month after next. Clamp to
// the last day instead: 31 Jan + 1 month is 28 Feb, not 3 March.
function addMonthsClamped(date, months) {
  const day  = date.getUTCDate()
  const out  = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
  out.setUTCDate(Math.min(day, last))
  return out
}

/**
 * The next occurrence strictly after `today`, or null when the reminder does
 * not recur (frequency 'Once', missing, or a word we do not recognise).
 *
 * It steps forward until it passes today rather than adding a single interval,
 * so a reminder that has been sitting overdue for a year lands on its next real
 * occurrence instead of another date in the past.
 */
export function nextDueDate(dueDate, frequency, today) {
  const step = RECURRENCE[String(frequency || '').trim().toLowerCase()]
  if (!step) return null

  let d = new Date(`${dueDate}T00:00:00Z`)
  const limit = new Date(`${today}T00:00:00Z`)
  if (isNaN(d.getTime()) || isNaN(limit.getTime())) return null

  // Fixed-length intervals are computed in one step rather than walked. Walking
  // needs a loop bound, and any bound low enough to catch a malformed date is
  // also low enough to give up on a daily reminder a few years overdue --
  // which is exactly the long-neglected case this is here to handle.
  if (step.days) {
    const stepMs = step.days * 86_400_000
    if (d <= limit) {
      const skipped = Math.floor((limit.getTime() - d.getTime()) / stepMs) + 1
      d = new Date(d.getTime() + skipped * stepMs)
    }
    return d.toISOString().split('T')[0]
  }

  // Months have to be walked, because their length varies and each step clamps
  // to the end of the month. Every iteration advances at least 28 days, so this
  // bound is centuries of reminders and cannot spin.
  for (let i = 0; i < 5000 && d <= limit; i++) {
    d = addMonthsClamped(d, step.months)
  }
  return d > limit ? d.toISOString().split('T')[0] : null
}

// How far back to look for reminders that were due but never went out.
//
// The job used to match `due_date = today` exactly, so a morning it did not
// run -- or a send that failed, as every send did while the Resend domain was
// unverified -- lost that occurrence permanently. Seven days is long enough to
// ride out a missed run or an outage, and short enough that deploying this does
// not mail out months of backlog at once.
const CATCH_UP_DAYS = 7

// ── SMS text ──────────────────────────────────────────────────────────────────

function reminderSMSText(petName, reminders) {
  const list = reminders.map(r => `• ${r.type}${r.notes ? ': ' + r.notes : ''}`).join('\n')
  return `🐾 Pippy reminder for ${petName}:\n\n${list}\n\nOpen the app to mark these done.`
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req) {
  // This endpoint emails and texts every user with a reminder due, and reports
  // on what it sent. It was reachable by anyone: a plain GET returned 200 and,
  // on any day with reminders due, the response body listed each recipient.
  //
  // Vercel sends `Authorization: Bearer ${CRON_SECRET}` on scheduled runs when
  // CRON_SECRET is set on the project. Require it when it is set. When it is
  // not, run anyway rather than silently killing the morning reminders on
  // deploy — but say so on every single run, because that is the open state.
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== `Bearer ${CRON_SECRET}`) {
      console.warn('Rejected an unauthorised call to morning-reminders')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }
  } else {
    console.warn(
      'CRON_SECRET is not set — this endpoint is callable by anyone, who can ' +
      'trigger real emails and SMS to your users. Set CRON_SECRET in the ' +
      'project environment variables to close it.'
    )
  }

  console.log('Morning reminders job started at', new Date().toISOString())

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Today's date in YYYY-MM-DD (in IST, UTC+5:30)
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  const today = istNow.toISOString().split('T')[0]

  console.log('Checking reminders for date:', today)

  // ── Fetch reminders due today, plus anything recently missed ──────────────
  //
  // `notified_for_date` records the occurrence a notification actually went out
  // for. Without it, widening this from a single day to a window would re-send
  // every overdue reminder every morning for a week.
  const windowStart = new Date(`${today}T00:00:00Z`)
  windowStart.setUTCDate(windowStart.getUTCDate() - CATCH_UP_DAYS)
  const from = windowStart.toISOString().split('T')[0]

  const { data: pending, error: remErr } = await supabase
    .from('reminders')
    .select(`
      id, type, notes, due_date, email, whatsapp, frequency, notified_for_date,
      pet:pets ( id, name, user_id )
    `)
    .gte('due_date', from)
    .lte('due_date', today)
    .eq('is_done', false)

  if (remErr) {
    console.error('Failed to fetch reminders:', remErr)
    return new Response(JSON.stringify({ error: remErr.message }), { status: 500 })
  }

  // Drop the ones already delivered for the occurrence they are sitting on.
  const reminders = (pending || []).filter(r => r.notified_for_date !== r.due_date)

  if (reminders.length === 0) {
    console.log(`No reminders to send (${(pending || []).length} in window, all already notified).`)
    return new Response(JSON.stringify({ message: 'No reminders due', date: today }), { status: 200 })
  }

  console.log(`Found ${reminders.length} reminder(s) due today`)

  // ── Group reminders by user + pet ─────────────────────────────────────────
  // Also fetch user contact info from auth.users via our admin function
  const { data: users, error: usersErr } = await supabase.rpc('get_all_users_for_admin')
  const userMap = {}
  if (!usersErr && users) {
    users.forEach(u => { userMap[u.id] = u })
  }

  // Group: { petId: { pet, userContact, reminders[] } }
  const grouped = {}
  for (const r of reminders) {
    if (!r.pet) continue
    const petId = r.pet.id
    if (!grouped[petId]) {
      const userContact = userMap[r.pet.user_id] || {}
      grouped[petId] = {
        pet: r.pet,
        userEmail: r.email || userContact.email || null,
        userPhone: r.whatsapp || userContact.phone || null,
        reminders: [],
      }
    }
    grouped[petId].reminders.push(r)
  }

  // ── Send notifications ─────────────────────────────────────────────────────
  const results = []
  for (const group of Object.values(grouped)) {
    const { pet, userEmail, userPhone, reminders: rems } = group
    const petName = pet.name || 'your pet'
    const firstResult = results.length   // where this pet's results start
    console.log(`Processing ${rems.length} reminder(s) for ${petName}`)

    // Email
    if (userEmail) {
      try {
        await sendEmail(
          userEmail,
          `🐾 ${petName} has ${rems.length} reminder${rems.length > 1 ? 's' : ''} today`,
          reminderEmailHtml(petName, rems)
        )
        results.push({ pet: petName, channel: 'email', to: maskEmail(userEmail), status: 'sent' })
        console.log(`Email sent to ${maskEmail(userEmail)} for ${petName}`)
      } catch (e) {
        results.push({ pet: petName, channel: 'email', to: maskEmail(userEmail), status: 'failed', error: e.message })
        console.error(`Email failed for ${petName}:`, e.message)
      }
    }

    // SMS
    if (userPhone) {
      try {
        const phone = userPhone.replace(/\s/g, '')
        await sendSMS(phone, reminderSMSText(petName, rems))
        results.push({ pet: petName, channel: 'sms', to: maskPhone(phone), status: 'sent' })
        console.log(`SMS sent to ${maskPhone(phone)} for ${petName}`)
      } catch (e) {
        results.push({ pet: petName, channel: 'sms', to: maskPhone(userPhone), status: 'failed', error: e.message })
        console.error(`SMS failed for ${petName}:`, e.message)
      }
    }

    if (!userEmail && !userPhone) {
      console.log(`No contact info for ${petName} — skipping`)
    }

    // Push
    try {
      await sendPush(supabase, pet.user_id, petName, rems)
    } catch (e) {
      console.error(`Push failed for ${petName}:`, e.message)
    }

    // ── Record what went out, and roll recurring reminders forward ──────────
    //
    // Only on a real delivery. If every channel failed -- as every channel did
    // while the Resend sending domain was unverified -- we deliberately leave
    // the reminder untouched so tomorrow's run retries it inside the catch-up
    // window, rather than marking it done-with and losing the occurrence for
    // good. A reminder with no contact details at all is marked, because
    // retrying that cannot ever produce a different answer.
    const mine      = results.slice(firstResult)
    const delivered = mine.some(r => r.status === 'sent')
    const nothingToSend = !userEmail && !userPhone

    if (!delivered && !nothingToSend) {
      console.warn(`Nothing delivered for ${petName} — leaving it for tomorrow's run`)
      continue
    }

    for (const r of rems) {
      const patch = { notified_for_date: r.due_date }

      // A recurring reminder moves to its next occurrence. Because due_date
      // changes, it no longer matches notified_for_date, so the next one will
      // notify on its own with no further bookkeeping.
      const next = nextDueDate(r.due_date, r.frequency, today)
      if (next) patch.due_date = next

      const { error: updErr } = await supabase.from('reminders').update(patch).eq('id', r.id)
      if (updErr) {
        // Worth shouting about: the notification went out and we failed to
        // record it, so tomorrow's run would send the very same thing again.
        console.error(`Failed to record delivery for reminder ${r.id}:`, updErr.message)
      } else if (next) {
        console.log(`${petName}: ${r.type} rolls ${r.frequency} from ${r.due_date} to ${next}`)
      }
    }
  }

  // ── Log the run ────────────────────────────────────────────────────────────
  await supabase.from('agent_runs').insert({
    type: 'morning_reminders',
    date: today,
    reminders_found: reminders.length,
    notifications_sent: results.filter(r => r.status === 'sent').length,
    results: JSON.stringify(results),
  }).then(({ error }) => { if (error) console.log('agent_runs log skipped (table may not exist yet)') })

  return new Response(JSON.stringify({
    message: 'Morning reminders processed',
    date: today,
    remindersFound: reminders.length,
    results,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

export const config = {
  schedule: '30 1 * * *',  // 1:30 AM UTC = 7:00 AM IST every day
}
