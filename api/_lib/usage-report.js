// api/_lib/usage-report.js
//
// Runs daily. Records a usage snapshot, and emails only when something needs
// attention.
//
// Deliberately NOT a daily "all is well" email. Pippy's current spend is under
// a cent a month and its database is at 3% of the free tier, so a daily report
// would be the same reassuring numbers every morning for months. People stop
// reading those, and then the one that matters goes unread too. So: silence
// unless a threshold is crossed, plus one summary a week so you can see the
// trend and know the job is still alive.

import { createClient } from '@supabase/supabase-js'
import { sendEmail, emailConfigured, fromDomain } from './_email.js'
// One source of truth for the limits, shared with the admin dashboard. Two
// copies would drift and then the email and the screen would disagree.
import { THRESHOLDS, breaches, shouldEmail, pctOf, MB } from '../../src/lib/usageLimits.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
const CRON_SECRET  = process.env.CRON_SECRET
const ALERT_EMAIL  = process.env.OWNER_ALERT_EMAIL || 'hello@pippypets.com'

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function reportHtml({ metrics, found, trend = [] }) {
  const row = (key) => {
    const t = THRESHOLDS[key]
    const pct = pctOf(key, metrics[key])
    const over = found.some(b => b.key === key)
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #F0E6C8;color:#4A2C0A">
          <strong>${esc(t.label)}</strong>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #F0E6C8;text-align:right;color:${over ? '#c0392b' : '#4A2C0A'};font-weight:700">
          ${esc(t.fmt(metrics[key]))}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #F0E6C8;text-align:right;color:#B8A080;font-size:13px">
          ${pct}% of ${esc(t.fmt(t.limit))}
        </td>
      </tr>`
  }

  const trendRows = trend.map(s => `
    <tr>
      <td style="padding:6px 12px;color:#B8A080;font-size:13px">${esc(s.day)}</td>
      <td style="padding:6px 12px;text-align:right;font-size:13px">$${Number(s.openai_cost_mtd_usd).toFixed(4)}</td>
      <td style="padding:6px 12px;text-align:right;font-size:13px">${(s.db_bytes / MB).toFixed(1)} MB</td>
      <td style="padding:6px 12px;text-align:right;font-size:13px">${(s.storage_bytes / MB).toFixed(1)} MB</td>
    </tr>`).join('')

  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#FFFEF8;border:1px solid #F0E6C8;border-radius:16px;overflow:hidden">
      <div style="background:${found.length ? '#fdeaea' : '#F9D548'};padding:20px 24px">
        <h1 style="margin:0;color:#4A2C0A;font-size:20px">
          ${found.length ? '&#9888;&#65039; Pippy usage: over a threshold' : 'Pippy weekly usage'}
        </h1>
        <p style="margin:4px 0 0;color:#6B4C1E;font-size:14px">
          ${esc(new Date().toISOString().split('T')[0])}
        </p>
      </div>
      <div style="padding:20px 24px">
        ${found.length ? `<p style="color:#c0392b;font-weight:bold;margin:0 0 12px">
            ${found.map(b => esc(b.text)).join('<br>')}
          </p>` : ''}
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;border:1px solid #F0E6C8">
          ${Object.keys(THRESHOLDS).map(row).join('')}
        </table>
        <p style="color:#4A2C0A;font-size:13px;margin:16px 0 4px">
          ${metrics.openai_calls_mtd} AI calls this month &middot;
          ${metrics.users_total} users &middot; ${metrics.pets_total} pets &middot;
          ${(metrics.photo_bytes / 1024).toFixed(0)} kB of that database is pet photos
        </p>
        ${trendRows ? `
          <p style="color:#4A2C0A;font-weight:bold;font-size:13px;margin:16px 0 4px">Last 7 snapshots</p>
          <table style="width:100%;border-collapse:collapse">${trendRows}</table>` : ''}
        <p style="color:#B8A080;font-size:12px;margin-top:16px">
          Spend is Pippy's own estimate from logged token counts, not OpenAI's bill.
          The cap on the OpenAI account is the real backstop.
        </p>
      </div>
    </div>`
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // Same rule as morning-reminders: require the secret when it is set, and say
  // loudly on every run when it is not, because this endpoint reports totals
  // about the whole service.
  if (CRON_SECRET) {
    if ((req.headers.get('authorization') || '') !== `Bearer ${CRON_SECRET}`) {
      return json({ error: 'Unauthorized' }, 401)
    }
  } else {
    console.warn('CRON_SECRET is not set — /api/usage-report is callable by anyone.')
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase.rpc('get_usage_metrics_for_admin')
  if (error) {
    console.error('usage metrics failed:', error.message)
    return json({ error: error.message }, 500)
  }
  // The function returns no rows rather than an error when the caller is not
  // permitted, so an empty result means the service key was refused, not that
  // Pippy has no usage.
  const metrics = Array.isArray(data) ? data[0] : data
  if (!metrics) {
    return json({ error: 'No metrics returned — check the service key and that usage_tracking.sql has been run.' }, 500)
  }

  const today = new Date().toISOString().split('T')[0]

  // Upsert so a re-run on the same day corrects that day rather than failing.
  const { error: snapErr } = await supabase.from('usage_snapshots').upsert({
    day: today,
    openai_cost_mtd_usd: metrics.openai_cost_mtd_usd,
    openai_calls_mtd:    metrics.openai_calls_mtd,
    db_bytes:            metrics.db_bytes,
    storage_bytes:       metrics.storage_bytes,
    photo_bytes:         metrics.photo_bytes,
    users_total:         metrics.users_total,
    pets_total:          metrics.pets_total,
  }, { onConflict: 'day' })
  if (snapErr) console.error('snapshot write failed:', snapErr.message)

  const found = breaches(metrics)
  const send  = shouldEmail(found)

  let emailed = false
  let emailError = null
  if (send) {
    const { data: trend } = await supabase
      .from('usage_snapshots')
      .select('day, openai_cost_mtd_usd, db_bytes, storage_bytes')
      .order('day', { ascending: false })
      .limit(7)

    try {
      const res = await sendEmail(
        ALERT_EMAIL,
        found.length ? `Pippy usage: ${found[0].label} over threshold` : 'Pippy weekly usage',
        reportHtml({ metrics, found, trend: (trend || []).reverse() })
      )
      emailed = res?.sent !== false
    } catch (e) {
      emailError = e.message
      console.error('usage email failed:', e.message)
    }
  }

  await supabase.from('agent_runs').insert({
    type: 'usage_report',
    date: today,
    reminders_found: 0,
    notifications_sent: emailed ? 1 : 0,
    results: JSON.stringify({
      breaches: found.map(b => b.text),
      emailed,
      emailError,
      email_configured: emailConfigured(),
      from_domain: fromDomain(),
    }),
  }).then(({ error: e }) => { if (e) console.log('agent_runs log skipped:', e.message) })

  return json({ date: today, metrics, breaches: found, emailed, emailError }, 200)
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
