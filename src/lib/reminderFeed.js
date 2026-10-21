// src/lib/reminderFeed.js
//
// What the notification bell shows, kept apart from the bell itself so it can
// be tested in plain node — see scripts/test-reminder-feed.mjs.
//
// SOURCE OF TRUTH: whatever the nightly email job sends, and nothing else.
// A bell that says 5 when the email sends 3 teaches people to distrust both.
//
// That used to mean the `reminders` table alone. It no longer does: the email
// job now also reads vaccinations.next_due and medicines.next_due, because a
// due date the app displays and never mentions again is worse than no due
// date. The bell was not updated at the same time, and the owner got the email
// for Daisy's booster with no badge on the bell -- the exact disagreement this
// comment was written to prevent.
//
// So the rule for which records count is shared, in src/lib/dueOnRecord.js,
// and both sides import it. Do not reimplement it here.

import { todayIST, addDaysISO } from './dates.js'
import { recordDueItems } from './dueOnRecord.js'

// How far ahead "coming up" looks. Long enough to be useful for a vet
// appointment, short enough that the list is still readable.
export const SOON_DAYS = 7

// The badge counts ONLY what needs attention now — overdue and due today.
//
// Counting the whole week would light the badge permanently for anyone with a
// monthly flea treatment, and a badge that is never zero is one nobody reads.
// The week's reminders are still in the panel; they just do not nag.
export function badgeCount(groups) {
  return groups.overdue.length + groups.today.length
}

const isDone = r => r.isDone === true || r.is_done === true

/**
 * Bucket reminders into overdue / today / soon / later.
 *
 * @param {Array}  reminders  rows from getReminders() — every pet's
 * @param {Array}  pets       for showing whose reminder it is
 * @param {string} today      YYYY-MM-DD; defaults to today in India
 */
export function groupReminders(reminders = [], pets = [], today = todayIST()) {
  const petById = new Map(pets.map(p => [p.id, p]))
  const horizon = addDaysISO(today, SOON_DAYS)

  const groups = { overdue: [], today: [], soon: [], later: [] }

  for (const r of reminders) {
    if (isDone(r)) continue

    const due = (r.dueDate || '').trim()
    // A reminder with no date can never come due, so it cannot be overdue
    // either — it would otherwise sort to the top and sit there for ever.
    if (!due) continue

    const item = { ...r, pet: petById.get(r.petId) || null, dueDate: due }

    if (due < today)          groups.overdue.push(item)
    else if (due === today)   groups.today.push(item)
    else if (due <= horizon)  groups.soon.push(item)
    else                      groups.later.push(item)
  }

  // Overdue reads worst-first: the thing missed longest is the thing to chase.
  groups.overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  // Everything ahead reads soonest-first.
  for (const k of ['today', 'soon', 'later']) {
    groups[k].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }

  return groups
}

/**
 * Everything the bell should show: the owner's reminders, plus due dates that
 * live on a vaccination or medicine record.
 *
 * The horizon for RECORDS stops at the same `soon` boundary the panel treats
 * as actionable. A reminder is something the owner asked to be reminded
 * about, so a distant one still belongs under "later"; a booster due in eight
 * months is a fact the timeline already draws, and listing it here would bury
 * what actually needs doing. What matters is that the badge -- overdue and
 * today -- counts exactly what the email sends.
 */
export function feedItems({ reminders = [], vaccinations = [], medicines = [], today = todayIST() } = {}) {
  const horizon = addDaysISO(today, SOON_DAYS)
  return [
    ...reminders,
    ...recordDueItems({
      vaccinations,
      medicines,
      reminders,
      // No lower bound: a booster missed three months ago is still overdue and
      // still worth chasing, exactly as an old reminder is.
      within: due => due <= horizon,
      // The bell keeps showing a thing until it is actually done. Having been
      // emailed about it this morning does not make it done.
      skipNotified: false,
    }),
  ]
}

/** How a single row describes its own timing, in words rather than a date. */
export function dueLabel(dueDate, today = todayIST()) {
  if (!dueDate) return ''
  if (dueDate === today) return 'Today'
  const tomorrow = addDaysISO(today, 1)
  if (dueDate === tomorrow) return 'Tomorrow'

  const days = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if (Number.isNaN(days)) return ''

  if (days < 0) {
    const n = Math.abs(days)
    if (n === 1) return 'Yesterday'
    if (n < 7)   return `${n} days ago`
    if (n < 31)  return `${Math.round(n / 7)} week${Math.round(n / 7) === 1 ? '' : 's'} ago`
    return 'Over a month ago'
  }
  if (days < 7) return `In ${days} days`
  return `In ${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? '' : 's'}`
}
