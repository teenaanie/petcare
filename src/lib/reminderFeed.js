// src/lib/reminderFeed.js
//
// What the notification bell shows, kept apart from the bell itself so it can
// be tested in plain node — see scripts/test-reminder-feed.mjs.
//
// SOURCE OF TRUTH: the `reminders` table, and only that. The nightly email job
// (netlify/functions/morning-reminders.js) reads the same table and nothing
// else, so the bell and the email always agree about what is due. A vaccination
// with a `nextDue` date is NOT counted here even though the timeline draws one,
// because a bell that says 5 when the email sends 3 teaches people to distrust
// both.

import { todayIST, addDaysISO } from './dates.js'

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
