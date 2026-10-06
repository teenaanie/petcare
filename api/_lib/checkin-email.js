// api/_lib/checkin-email.js
//
// Asks somebody who has gone quiet whether everything is alright.
//
// Same trust model as share-invite.js: the client asks, the server believes
// nothing. The browser sends a user id and that is all it gets to decide. The
// address, whether that person is actually inactive, and whether they have
// already been written to are every one of them looked up here.
//
// ── Why the re-derivation matters ───────────────────────────────────────────
//
// "Send an email to this user id" is, on its own, a button that emails any
// account in the database. So eligibility is recomputed from
// get_inactive_users_for_admin -- the SAME function the admin screen lists
// from, so the two can never disagree -- and a user who does not come back in
// that list is refused. A stale browser tab, a doctored request, or a user who
// came back since the page loaded all land on the same refusal.
//
// ── Why inactivity is not last_sign_in_at ───────────────────────────────────
//
// Supabase refreshes a session's token without touching `last_sign_in_at`, so
// somebody who stays signed in on their phone looks dormant forever. One live
// account last signed in 58 days ago and was creating records 13 days ago.
// The SQL function handles this; it is repeated here because anyone changing
// this file will be tempted to "simplify" it back to the broken version.

import { createClient } from '@supabase/supabase-js'
import { sendEmail, emailConfigured, fromDomain } from './_email.js'
import { maskEmail } from './_redact.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
const APP_URL      = process.env.APP_URL || 'https://pippyapp.vercel.app'

// Whose name it is signed with. A check-in from a person gets a reply; one
// from "the team" does not.
const SIGN_OFF = process.env.CHECKIN_FROM_NAME || 'Pippy'

// The floor, regardless of what the screen was showing. The request was "not
// active at all for more than a month", and an admin browsing a 7-day view
// must not be one click from emailing somebody who paused for a week.
export const MIN_IDLE_DAYS = 30

// Don't ask the same person twice in a season. Being chased about an app you
// have quietly stopped using is its own reason never to come back.
export const COOLDOWN_DAYS = 90

// A runaway guard, not a quota. Pippy has 17 users; a day that tries to send
// 50 check-ins is a bug or a loop, not a busy afternoon.
export const MAX_PER_DAY = 25

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

// Pet names are typed by the owner and go straight into HTML.
const esc = s => String(s ?? '').replace(/[<>&"]/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))

/**
 * Safe to put in a Subject line.
 *
 * `esc` handles HTML, which is the body's problem. A subject has a different
 * one: a newline or carriage return in a header is how header injection
 * works. Resend takes JSON and does its own encoding, so this is defence in
 * depth rather than a known hole -- but a pet called "Bo\nBcc: ..." should
 * never be the thing standing between us and a mail bug. Length is capped
 * too, because a 400-character pet name makes a subject nothing but noise.
 */
const oneLine = s => String(s ?? '')
  .replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 60)

/** Join names the way a person would: "Poppy", "Poppy and Pino", "A, B and C". */
export function listNames(names) {
  const n = names.filter(Boolean).map(esc)
  if (n.length === 0) return ''
  if (n.length === 1) return n[0]
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

const wrap = (inner) => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
              max-width:480px;margin:0 auto;padding:24px;color:#4a4a3f;line-height:1.55">
    ${inner}
    <p style="font-size:12px;color:#8a8a7a;margin-top:28px;border-top:1px solid #ebe3d3;padding-top:14px">
      You are getting this because you have a Pippy account. If you would rather
      not hear from us again, reply saying so and we will not write again.
    </p>
  </div>`

const button = (href, label) => `
  <p style="margin:22px 0">
    <a href="${href}" style="background:#ffde59;color:#7a4900;text-decoration:none;
       padding:11px 20px;border-radius:12px;font-weight:bold;display:inline-block">${label}</a>
  </p>`

/**
 * Two different conversations.
 *
 * Somebody who never added a pet got stuck somewhere in setup, and asking
 * "how is your pet?" of a person who never told us about one reads as a form
 * letter. Somebody who used it for a while and stopped has a different reason.
 */
export function compose({ kind, petNames }) {
  if (kind === 'never_used') {
    return {
      subject: 'Did you get stuck setting up Pippy?',
      html: wrap(`
        <p>Hello,</p>
        <p>You made a Pippy account a while ago, but it looks like you never got
           as far as adding a pet. Usually that means something got in the way.</p>
        <p>If the sign-in code never arrived, or a screen would not load, or it
           simply was not what you were after, I would like to know which. A
           reply to this email reaches a person, not a form.</p>
        ${button(APP_URL, 'Add your first pet')}
        <p style="margin-bottom:0">Thanks,<br>${esc(SIGN_OFF)}</p>`),
    }
  }
  const who = petNames.length ? listNames(petNames) : 'your pets'
  // The subject is a header, so it gets oneLine rather than esc: HTML entities
  // would show up literally as "&amp;" in an inbox.
  const subjectNames = petNames.map(oneLine).filter(Boolean)
  return {
    subject: subjectNames.length ? `How is ${subjectNames.join(' and ')} doing?`
                                 : 'Checking in about your pets',
    html: wrap(`
      <p>Hello,</p>
      <p>It has been a little while since you were last in Pippy, and I wanted
         to check that nothing has gone wrong at our end.</p>
      <p>If the reminders stopped arriving, or something broke, or it just was
         not useful enough to keep up, I would genuinely like to hear it. You
         can reply straight to this email.</p>
      <p>And if all is well with ${who} and you simply have not needed it, that
         is a perfectly good answer too.</p>
      ${button(APP_URL, 'Open Pippy')}
      <p style="margin-bottom:0">Thanks,<br>${esc(SIGN_OFF)}</p>`),
  }
}

/**
 * May this person be written to?
 *
 * Pulled out of the handler and exported because it is the whole safety
 * argument, and a safety argument buried in an async function behind an
 * admin check and two network calls is one nobody ever tests.
 *
 * `target` is a row from get_inactive_users_for_admin -- that is, already
 * re-derived server-side. Every check here is a SECOND opinion on top of it.
 *
 * Returns null when sending is allowed, or a reason string when it is not.
 */
export function refuseReason(target, { now = Date.now(), todayCount = 0 } = {}) {
  // Not in the list at all: came back since the page loaded, is an admin, or
  // was never eligible. The browser asked for somebody it should not have.
  if (!target) return 'not_inactive'
  if (!target.contactable || !target.email) return 'no_email'
  // Belt and braces over the SQL's own threshold.
  if (!(target.idle_days >= MIN_IDLE_DAYS)) return 'too_recent'
  if (target.last_checkin_at) {
    const since = now - new Date(target.last_checkin_at).getTime()
    // An unparseable date reads as NaN, and NaN < x is false, so a bad
    // timestamp would wave the send through. Refuse instead.
    if (!Number.isFinite(since) || since < COOLDOWN_DAYS * 86400_000) {
      return 'already_contacted'
    }
  }
  if (todayCount >= MAX_PER_DAY) return 'daily_cap'
  return null
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 503)
  if (!emailConfigured()) {
    return json({ ok: false, sent: false, reason: 'email_not_configured' })
  }

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing auth token' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user: caller }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !caller) return json({ error: 'Unauthorized' }, 401)

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  const userId = String(body?.userId || '')
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'userId required' }, 400)

  try {
    // ── Is the caller an admin? ────────────────────────────────────────────
    // Gated the same way public.is_admin() gates: the admins table, not
    // revoked, matched by id or by address. Checked here rather than relying
    // on RLS, because everything below runs with the service key.
    const { data: adminRows, error: adminErr } = await supabase
      .from('admins').select('user_id, email, revoked_at').is('revoked_at', null)
    if (adminErr) throw adminErr
    const isAdmin = (adminRows || []).some(a =>
      a.user_id === caller.id ||
      (!a.user_id && a.email && caller.email &&
       a.email.toLowerCase() === caller.email.toLowerCase()))
    if (!isAdmin) return json({ error: 'Forbidden' }, 403)

    // ── Is this person actually inactive? ─────────────────────────────────
    // Recomputed from the same function the screen lists from. The browser's
    // opinion is not consulted.
    const { data: inactive, error: listErr } = await supabase
      .rpc('get_inactive_users_for_admin', { days: MIN_IDLE_DAYS })
    if (listErr) throw listErr

    const target = (inactive || []).find(r => r.id === userId)

    // How many have gone out in the last day, for the runaway guard.
    const dayAgo = new Date(Date.now() - 86400_000).toISOString()
    const { count: todayCount, error: cntErr } = await supabase
      .from('inactive_checkins').select('id', { count: 'exact', head: true })
      .gte('sent_at', dayAgo)
    if (cntErr) throw cntErr

    const refusal = refuseReason(target, { todayCount: todayCount || 0 })
    if (refusal) {
      return json({
        ok: false, sent: false, reason: refusal,
        ...(refusal === 'already_contacted' ? { lastCheckinAt: target.last_checkin_at } : {}),
      }, refusal === 'daily_cap' ? 429 : 409)
    }

    // Pet names, for a message that sounds like it is about their animal
    // rather than about their account. Owner-typed, so escaped at use.
    let petNames = []
    if (target.kind !== 'never_used') {
      const { data: pets } = await supabase
        .from('pets').select('name').eq('user_id', userId).limit(4)
      petNames = (pets || []).map(p => p.name).filter(Boolean)
    }

    const { subject, html } = compose({ kind: target.kind, petNames })
    await sendEmail(target.email, subject, html)

    // Recorded only after the send succeeded, so a failure does not block a
    // retry. sendEmail throws on a non-OK response, so reaching here means
    // Resend accepted it.
    const { error: insErr } = await supabase.from('inactive_checkins').insert({
      user_id: userId,
      sent_by: caller.id,
      sent_to: target.email,
      kind: target.kind,
      idle_days: target.idle_days,
    })
    // A lost record is bad (it is what prevents a repeat) but the email has
    // gone, and reporting failure would invite exactly that repeat.
    if (insErr) console.error('[checkin] sent but not recorded:', insErr.message)

    console.log(`[checkin] ${target.kind} to ${maskEmail(target.email)} ` +
                `(${target.idle_days}d idle) from ${fromDomain()}`)
    return json({ ok: true, sent: true, kind: target.kind, recorded: !insErr })
  } catch (e) {
    console.error('[checkin] failed:', e.message)
    return json({ error: e.message || 'Failed to send' }, 500)
  }
}
