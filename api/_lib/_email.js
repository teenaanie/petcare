// api/_lib/_email.js
//
// One way to send an email, so the sending address and the failure handling
// are the same wherever a message comes from. This lived inside
// morning-reminders.js; notify-owner.js needed the same thing, and a second
// copy of it would have drifted the way the microphone code did.

import { maskEmail } from './_redact.js'

const RESEND_API_KEY = process.env.RESEND_API_KEY
export const FROM_EMAIL = process.env.FROM_EMAIL || 'Pippy <reminders@pippypets.com>'

export const emailConfigured = () => !!RESEND_API_KEY

/** The domain we are sending as — logged so a misconfigured FROM is visible. */
export const fromDomain = () =>
  (FROM_EMAIL.split('@')[1] || 'unset').replace('>', '').trim()

export async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    // Never throw for this. A missing key is a deployment problem, and the
    // caller's real work (saving a pet, sending a reminder) must not fail
    // because an alert could not go out.
    console.log(`[EMAIL SKIPPED] No RESEND_API_KEY. Would send to ${maskEmail(to)}`)
    return { sent: false, reason: 'no_api_key' }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  if (!res.ok) {
    let msg = `status ${res.status}`
    try { msg = (await res.json())?.message || msg } catch { /* keep the status */ }
    throw new Error(`Email failed: ${msg}`)
  }
  return { sent: true }
}
