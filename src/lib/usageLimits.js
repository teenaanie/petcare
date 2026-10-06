// What counts as "too much", in one place.
//
// Both the nightly job (api/_lib/usage-report.js) and the admin dashboard read
// these. Keeping two copies would guarantee they drift, and then the email and
// the screen would disagree about whether anything is wrong.
//
// Pure: no imports, no DOM, no Node APIs, so it is safe in the browser bundle
// and inside a Vercel function alike.

export const MB = 1024 * 1024

// Set where they give useful warning, not where they would fire today. Pippy's
// spend is currently a fraction of a cent a month and the database is at ~3% of
// the free tier, so all of these have a long way to run.
//
// The OpenAI number is deliberately far below the $50 cap set on the OpenAI
// account itself: this is the early nudge, that is the hard backstop.
export const THRESHOLDS = {
  openai_cost_mtd_usd: {
    limit: 5,
    label: 'OpenAI spend this month',
    fmt: v => `$${Number(v || 0).toFixed(4)}`,
  },
  db_bytes: {
    limit: 250 * MB,
    label: 'Database size',
    note: 'Supabase free tier allows 500 MB',
    fmt: v => `${(Number(v || 0) / MB).toFixed(1)} MB`,
  },
  storage_bytes: {
    limit: 500 * MB,
    label: 'File storage',
    note: 'Supabase free tier allows 1 GB',
    fmt: v => `${(Number(v || 0) / MB).toFixed(1)} MB`,
  },
}

/** Metrics that are over their limit. An empty array means nothing to report. */
export function breaches(metrics) {
  return Object.entries(THRESHOLDS)
    .filter(([key]) => Number(metrics?.[key] ?? 0) > THRESHOLDS[key].limit)
    .map(([key, t]) => ({
      key,
      label: t.label,
      value: Number(metrics[key]),
      limit: t.limit,
      text: `${t.label} is ${t.fmt(metrics[key])}, over the ${t.fmt(t.limit)} threshold`,
    }))
}

/**
 * Whether the nightly job should send anything.
 *
 * A breach always sends. Otherwise only the weekly summary day does, so an
 * ordinary day produces no mail at all and the absence of mail carries meaning.
 * A daily "everything is fine" note would be the same numbers for months, and
 * an email nobody reads is worse than no email.
 */
export function shouldEmail(found, date = new Date(), weeklyOnDay = 1) {
  return found.length > 0 || date.getUTCDay() === weeklyOnDay
}

/** How much of a threshold is used, capped at 100 so a progress bar cannot overflow. */
export function pctOf(key, value) {
  const t = THRESHOLDS[key]
  if (!t) return 0
  return Math.min(100, Math.round((Number(value || 0) / t.limit) * 1000) / 10)
}

/**
 * Roll daily snapshots up into weeks, newest first.
 *
 * Snapshots are taken daily because a daily series can always be reduced to
 * weeks while the reverse is impossible. The dashboard shows weeks because a
 * week is the scale at which a trend in this data is actually readable.
 */
export function byWeek(snapshots = []) {
  const weeks = new Map()
  for (const s of snapshots) {
    const d = new Date(`${s.day}T00:00:00Z`)
    if (isNaN(d.getTime())) continue
    // Monday as the first day of the week.
    const offset = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - offset)
    const key = d.toISOString().split('T')[0]
    const prev = weeks.get(key)
    // Keep the LAST snapshot of each week: these are running totals and sizes,
    // so the latest reading is the week's position, not the sum of the days.
    if (!prev || s.day > prev.day) weeks.set(key, { ...s, weekStart: key })
  }
  return [...weeks.values()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
}
