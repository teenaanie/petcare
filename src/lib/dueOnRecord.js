// Due dates that live on a vaccination or medicine record, not in `reminders`.
//
// WHY THIS IS SHARED. src/lib/reminderFeed.js used to say, correctly:
//
//   SOURCE OF TRUTH: the `reminders` table, and only that. The nightly email
//   job reads the same table and nothing else, so the bell and the email
//   always agree about what is due ... a bell that says 5 when the email
//   sends 3 teaches people to distrust both.
//
// Then the email job was taught to read vaccinations.next_due and
// medicines.next_due, and the bell was not. The owner got the email for
// Daisy's booster and no badge on the bell -- exactly the disagreement that
// comment warned about, one release after it was written.
//
// So the rule lives here once and both sides import it. They differ only in
// the window they ask for, which is a real difference: the morning job looks
// at a catch-up window ending today, the bell also looks ahead.

// How far back a due date still counts as something to act on.
//
// Shared, and that is the point. The morning job uses it as its catch-up
// window -- long enough to ride out a missed run, short enough that deploying
// it did not mail months of backlog. The bell uses the same number so the two
// surfaces draw the same line.
//
// It is also what keeps the badge readable. Without a lower bound the bell
// counted 22, of which 19 were historical rows -- boosters from 2023 and 2024,
// up to 1298 days past due, whose follow-up shots were recorded later as new
// rows. They were never missed, they were superseded, and a badge that is
// never zero is one nobody reads.
//
// What this deliberately does NOT do is decide that one vaccine supersedes
// another. That is a veterinary judgement, and the data contains a row that
// would defeat any such rule: a "vaccination" reading
// "caftago + lautac + catasm" with no due date, which looks like a
// prescription filed in the wrong table. A date cut is blunt, but it cannot
// silently decide a rabies booster has been covered.
//
// The cost, stated plainly: a genuinely missed booster older than a week stops
// being badged. It stays in the pet's record and on the timeline.
export const CATCH_UP_DAYS = 7

/** The record tables that carry their own due date, and what to call them. */
export const RECORD_SOURCES = [
  { table: 'vaccinations', type: 'Vaccination', fallback: 'Vaccination' },
  { table: 'medicines',    type: 'Medication',  fallback: 'Medication' },
]

const TYPE_BY_TABLE = Object.fromEntries(RECORD_SOURCES.map(s => [s.table, s]))

/** camelCase from storage.js, snake_case from a Supabase query: accept both. */
function normalise(r, table) {
  const pet = r.pet && typeof r.pet === 'object' ? r.pet : null
  return {
    id:        r.id,
    petId:     r.petId ?? r.pet_id ?? pet?.id ?? null,
    pet,
    name:      r.name || '',
    dueDate:   r.nextDue ?? r.next_due ?? null,
    isDone:    r.isDone === true || r.is_done === true,
    notifiedForDate: r.notifiedForDate ?? r.notified_for_date ?? null,
    table,
  }
}

/**
 * The pet/day/kind combinations the owner's own reminders already cover.
 *
 * A vaccination due the same day as a reminder the owner made for it is one
 * thing to be told, not two.
 */
export function coveredByReminders(reminders = []) {
  const out = new Set()
  for (const r of reminders) {
    const petId = r.petId ?? r.pet_id ?? r.pet?.id
    const due   = r.dueDate ?? r.due_date
    if (petId && due && r.type) out.add(`${petId}|${due}|${r.type}`)
  }
  return out
}

/**
 * Reminder-shaped items for every record due inside `within`.
 *
 * @param {object}   o
 * @param {Array}    o.vaccinations
 * @param {Array}    o.medicines
 * @param {Array}    o.reminders  the owner's own, for dedupe
 * @param {Function} o.within     (dueDate) => boolean — the caller's window
 * @param {boolean}  o.skipNotified  drop records already notified for that
 *                   exact date. True for the mailer, which must not send
 *                   twice; false for the bell, which keeps showing a thing
 *                   until it is actually done.
 */
export function recordDueItems({
  vaccinations = [], medicines = [], reminders = [], within = () => true, skipNotified = false,
} = {}) {
  const covered = coveredByReminders(reminders)
  const out = []

  for (const [table, rows] of [['vaccinations', vaccinations], ['medicines', medicines]]) {
    const src = TYPE_BY_TABLE[table]
    for (const raw of rows || []) {
      const r = normalise(raw, table)
      // A record with no pet has nobody to tell and nothing to group under.
      if (!r.petId || !r.dueDate) continue
      if (r.isDone) continue
      if (skipNotified && r.notifiedForDate === r.dueDate) continue
      if (!within(r.dueDate)) continue

      const key = `${r.petId}|${r.dueDate}|${src.type}`
      if (covered.has(key)) continue
      covered.add(key)   // two records saying the same thing on the same day

      out.push({
        id:       r.id,
        petId:    r.petId,
        pet:      r.pet,
        type:     src.type,
        notes:    `${r.name || src.fallback} due`,
        dueDate:  r.dueDate,
        due_date: r.dueDate,     // the mailer's shape
        isDone:   false,
        // 'Once' on purpose: a booster interval is a clinical claim, and the
        // next date comes from the next document, not arithmetic on this one.
        frequency: 'Once',
        notifiedForDate: r.notifiedForDate,
        _table:   table,
      })
    }
  }
  return out
}
