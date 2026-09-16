// netlify/functions/register-provider.js
// Public endpoint — anyone with the /register-provider link can submit a provider
// listing. Always saved with is_approved=false; admin reviews in the Admin panel.

import { createClient } from '@supabase/supabase-js'
import { maskEmail } from './_redact.js'

const SUPABASE_URL   = process.env.SUPABASE_URL
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL     = process.env.FROM_EMAIL || 'reminders@teenaspetcare.com'
const ADMIN_EMAIL    = 'teena.anie9@gmail.com'

const PROVIDER_TYPES = ['Vet', 'Groomer', 'Store', 'Boarder', 'Special Services', 'Pet Loss & Memorial Services']

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function cleanString(value, maxLen) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLen)
}

function isValidUrl(value) {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://')) && value.length <= 500
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
    const err = await res.json().catch(() => ({}))
    throw new Error(`Email failed: ${err.message || res.statusText}`)
  }
}

function notificationHtml(p) {
  const row = (label, value) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #F0E6C8;color:#B8A080;font-size:12px;white-space:nowrap">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #F0E6C8;color:#4A2C0A;font-size:13px">${value || '—'}</td>
    </tr>`

  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#FFFEF8;border:1px solid #F0E6C8;border-radius:16px;overflow:hidden">
      <div style="background:#F9D548;padding:20px 24px">
        <h1 style="margin:0;color:#4A2C0A;font-size:20px">🐾 New Provider Submission</h1>
      </div>
      <div style="padding:20px 24px">
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;border:1px solid #F0E6C8">
          ${row('Name', p.name)}
          ${row('Type', p.type)}
          ${row('Area', p.area)}
          ${row('City', p.city)}
          ${row('Address', p.address)}
          ${row('Phone', p.phone)}
          ${row('WhatsApp', p.whatsapp)}
          ${row('Hours', p.hours)}
          ${row('Description', p.description)}
          ${row('Maps URL', p.maps_url)}
        </table>
        <p style="color:#B8A080;font-size:12px;margin-top:16px">Review and approve it in the Pippy Admin panel.</p>
      </div>
    </div>`
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid request body' })
  }

  // Honeypot — real users never fill this in. Bots get an identical success
  // response so they get no signal they were caught.
  if (typeof body.url === 'string' && body.url.trim()) {
    return json(200, { success: true })
  }

  const name = cleanString(body.name, 120)
  if (!name) return json(400, { error: 'Please enter a name' })

  if (!PROVIDER_TYPES.includes(body.type)) {
    return json(400, { error: 'Invalid provider type' })
  }

  const phone = cleanString(body.phone, 30)
  if (!phone) return json(400, { error: 'Please enter a phone number' })

  const area        = cleanString(body.area, 120)
  const city        = cleanString(body.city, 200)
  const address     = cleanString(body.address, 200)
  const whatsapp    = cleanString(body.whatsapp, 30)
  const hours       = cleanString(body.hours, 200)
  const description = cleanString(body.description, 300)

  let maps_url = null
  if (body.maps_url) {
    if (!isValidUrl(body.maps_url)) return json(400, { error: 'Please enter a valid Google Maps URL' })
    maps_url = body.maps_url.trim()
  }

  let photo_url = null
  if (body.photo_url) {
    if (!isValidUrl(body.photo_url)) return json(400, { error: 'Please enter a valid photo URL' })
    photo_url = body.photo_url.trim()
  }

  const provider = {
    name, type: body.type, area, city, address, phone, whatsapp, hours,
    maps_url, photo_url, description, is_approved: false, source: 'self_registered',
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error } = await supabase.from('providers').insert(provider)
  if (error) {
    console.error('Failed to insert provider:', error)
    return json(500, { error: 'Something went wrong, please try again.' })
  }

  try {
    await sendEmail(ADMIN_EMAIL, `🐾 New provider submission: ${name} (${body.type})`, notificationHtml(provider))
  } catch (e) {
    console.error('Admin notification email failed:', e.message)
  }

  return json(200, { success: true })
}
