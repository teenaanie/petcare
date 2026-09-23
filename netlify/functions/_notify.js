// netlify/functions/_notify.js
// The three outbound channels, in one place.
//
// These lived inside morning-reminders.js, which was the only thing that sent
// anything. The provider platform sends too — invites, message alerts, daily
// updates, broadcasts — and a second copy of the Resend call is a second place
// for the sending domain to drift out of step. Extracted verbatim; the only
// change is sendPush's signature (see below).

import webPush from 'web-push'
import { maskEmail, maskPhone, bodyShape } from './_redact.js'

const TWILIO_SID     = process.env.TWILIO_ACCOUNT_SID
const TWILIO_TOKEN   = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM    = process.env.TWILIO_PHONE_NUMBER
const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL     = process.env.FROM_EMAIL || 'reminders@teenaspetcare.com'
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT || 'mailto:teena.anie9@gmail.com'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

// The domain every reminder depends on. Logged by callers on boot because a
// Resend dashboard fix does not reach a running deployment until it redeploys,
// and an unverified sending domain fails every send silently.
export const fromDomain = () => (FROM_EMAIL.split('@')[1] || 'unset').trim()

export const emailConfigured = () => !!RESEND_API_KEY
export const pushConfigured  = () => !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)

// ── Email via Resend ──────────────────────────────────────────────────────────

export async function sendEmail(to, subject, html, extraHeaders) {
  if (!RESEND_API_KEY) {
    console.log(`[EMAIL SKIPPED] No RESEND_API_KEY. Would send to ${maskEmail(to)}`)
    return
  }
  // replyTo and headers are for provider mail: a broadcast sets Reply-To to the
  // business so replies reach a human, and List-Unsubscribe so a recipient can
  // opt out from their mail client rather than marking it spam. Reminders pass
  // neither and behave exactly as before.
  const { replyTo, headers } = extraHeaders || {}
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL, to, subject, html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(headers ? { headers } : {}),
    }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Email failed: ${err.message}`)
  }
}

// ── SMS via Twilio ────────────────────────────────────────────────────────────

export async function sendSMS(to, body) {
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

// ── Web Push ──────────────────────────────────────────────────────────────────
//
// Takes the notification rather than building it. The old version hardcoded the
// reminder wording, which is why it could not be reused.
//
// `scope` is opt-in and filters push_subscriptions on a column that does not
// exist yet. Passing nothing queries exactly as before, so this is safe to ship
// ahead of the column: once one browser can hold both a pet-parent and a
// provider subscription, the two have to be told apart, and the caller that
// needs that will pass it.

export async function sendPush(supabase, userId, notification, options) {
  if (!pushConfigured()) {
    console.log('[PUSH SKIPPED] VAPID keys not configured.')
    return
  }
  const { scope } = options || {}

  let query = supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (scope) query = query.eq('scope', scope)

  const { data: subs, error } = await query
  if (error || !subs || subs.length === 0) return

  const payload = JSON.stringify({
    title: notification.title,
    body:  notification.body,
    url:   notification.url || '/',
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
