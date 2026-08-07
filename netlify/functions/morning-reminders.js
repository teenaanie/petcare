// netlify/functions/morning-reminders.js
// Scheduled function — runs daily at 7:00 AM IST (1:30 AM UTC)
// Checks all reminders due today, sends email + SMS to each user

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL   = process.env.SUPABASE_URL
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY
const TWILIO_SID     = process.env.TWILIO_ACCOUNT_SID
const TWILIO_TOKEN   = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM    = process.env.TWILIO_PHONE_NUMBER
const RESEND_API_KEY = process.env.RESEND_API_KEY        // free at resend.com
const FROM_EMAIL     = process.env.FROM_EMAIL || 'reminders@teenaspetcare.com'

// ── Email via Resend ──────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log(`[EMAIL SKIPPED] No RESEND_API_KEY. Would send to ${to}: ${subject}`)
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
    console.log(`[SMS SKIPPED] Twilio not configured. Would send to ${to}: ${body}`)
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

// ── SMS text ──────────────────────────────────────────────────────────────────

function reminderSMSText(petName, reminders) {
  const list = reminders.map(r => `• ${r.type}${r.notes ? ': ' + r.notes : ''}`).join('\n')
  return `🐾 Pippy reminder for ${petName}:\n\n${list}\n\nOpen the app to mark these done.`
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req) {
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

  // ── Fetch all reminders due today that are not done ───────────────────────
  const { data: reminders, error: remErr } = await supabase
    .from('reminders')
    .select(`
      id, type, notes, due_date, email, whatsapp, frequency,
      pet:pets ( id, name, user_id )
    `)
    .eq('due_date', today)
    .eq('is_done', false)

  if (remErr) {
    console.error('Failed to fetch reminders:', remErr)
    return new Response(JSON.stringify({ error: remErr.message }), { status: 500 })
  }

  if (!reminders || reminders.length === 0) {
    console.log('No reminders due today.')
    return new Response(JSON.stringify({ message: 'No reminders due today', date: today }), { status: 200 })
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
    console.log(`Processing ${rems.length} reminder(s) for ${petName}`)

    // Email
    if (userEmail) {
      try {
        await sendEmail(
          userEmail,
          `🐾 ${petName} has ${rems.length} reminder${rems.length > 1 ? 's' : ''} today`,
          reminderEmailHtml(petName, rems)
        )
        results.push({ pet: petName, channel: 'email', to: userEmail, status: 'sent' })
        console.log(`Email sent to ${userEmail} for ${petName}`)
      } catch (e) {
        results.push({ pet: petName, channel: 'email', to: userEmail, status: 'failed', error: e.message })
        console.error(`Email failed for ${petName}:`, e.message)
      }
    }

    // SMS
    if (userPhone) {
      try {
        const phone = userPhone.replace(/\s/g, '')
        await sendSMS(phone, reminderSMSText(petName, rems))
        results.push({ pet: petName, channel: 'sms', to: phone, status: 'sent' })
        console.log(`SMS sent to ${phone} for ${petName}`)
      } catch (e) {
        results.push({ pet: petName, channel: 'sms', to: userPhone, status: 'failed', error: e.message })
        console.error(`SMS failed for ${petName}:`, e.message)
      }
    }

    if (!userEmail && !userPhone) {
      console.log(`No contact info for ${petName} — skipping`)
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
