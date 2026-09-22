// src/lib/dates.js

/**
 * The first of `candidates` that is a real, finite Date — or null.
 *
 * `new Date(undefined)`, `new Date('')` and `new Date('not-a-date')` all return
 * an Invalid Date rather than throwing, and an Invalid Date behaves like a Date
 * until something formats it. date-fns `format()` then throws
 * `RangeError: Invalid time value`, and with no error boundary above it that
 * takes the whole screen down.
 *
 * That is not hypothetical: a record with no date of its own fell back to its
 * `createdAt`, and a record whose `createdAt` had been dropped produced exactly
 * this — the pet's timeline, and the entire pet screen, went blank.
 *
 * So dates that feed a formatter come through here, and "no date" is null, a
 * thing the caller has to handle, instead of a Date-shaped object that looks
 * fine until it is rendered.
 *
 * Note `new Date('20206-03-12')` is VALID — V8 reads it as the year 20206 — so
 * a five-digit year is a display problem, not a crash. This is about absence.
 */
export function firstValidDate(...candidates) {
  for (const c of candidates) {
    if (c === null || c === undefined || c === '') continue
    const d = c instanceof Date ? c : new Date(c)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

/** True when `d` is a Date that can safely be formatted. */
export function isRealDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}
