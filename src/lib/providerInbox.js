// How a pile of inform notes becomes a provider's diary.
//
// Kept out of the component so it can be tested in plain node, like everything
// else in scripts/. These three functions are the whole of the inbox's logic;
// ProviderInbox.jsx is rendering.

import { todayIST } from './dates.js'

const DAY = 86400000

/**
 * Which section a note belongs in.
 *
 * This is what makes the note model a dashboard with no booking system: a
 * future start is upcoming, a window spanning today is current, a finished one
 * is past.
 *
 * Two cases the one-line version of that rule gets wrong:
 *
 *   A note with NO window is not a stay, and must not fall into "past" — a note
 *   sent an hour ago filed under Past reads as a bug, and it is the MAJORITY
 *   case for a groomer, who has no stay at all. It gets its own section.
 *
 *   An open-ended window (a start, no end) stays current from its start date
 *   onwards. A boarder who did not type an end date has not told us the pet
 *   went home, and guessing it did would drop a pet that is still there.
 */
export function bucketFor(note, today = todayIST()) {
  const { startsOn, endsOn } = note || {}
  if (!startsOn && !endsOn) return 'undated'
  if (startsOn && startsOn > today) return 'upcoming'
  if (endsOn && endsOn < today)     return 'past'
  return 'current'
}

/**
 * Only the notes nothing else supersedes.
 *
 * A re-send is how a customer corrects a note, since nothing can be edited or
 * withdrawn. Showing both halves of a correction shows the provider a fact the
 * customer has already retracted, which is worse than showing nothing at all.
 * The customer's own history keeps the whole chain.
 */
export function currentNotes(notes = []) {
  const replaced = new Set((notes || []).map(n => n?.supersedes).filter(Boolean))
  return (notes || []).filter(n => n && !replaced.has(n.id))
}

/** Whole days since the note was sent, or null when the timestamp is unusable. */
export function ageInDays(sentAt, now = Date.now()) {
  const t = Date.parse(sentAt)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now - t) / DAY))
}

/** Sections, in the order a provider cares about them. */
export const INBOX_SECTIONS = [
  { key: 'current',  title: 'With you now' },
  { key: 'upcoming', title: 'Coming up' },
  { key: 'undated',  title: 'No dates given' },
  { key: 'past',     title: 'Past' },
]

/** The notes, deduplicated by supersession and split into those sections. */
export function groupNotes(notes = [], today = todayIST()) {
  const out = { current: [], upcoming: [], undated: [], past: [] }
  for (const n of currentNotes(notes)) out[bucketFor(n, today)].push(n)
  // Upcoming reads forwards — the next arrival first. Every other section keeps
  // the newest-first order the query already returns.
  out.upcoming.sort((a, b) => String(a.startsOn).localeCompare(String(b.startsOn)))
  return out
}
