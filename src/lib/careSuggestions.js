// The care reminders Pippy offers when a pet is added.
//
// ── Why this is a module and not a constant in the modal ────────────────────
//
// A customer added their dog and found a vaccination reminder waiting for them
// that they had never asked for, for a jab the dog had already had. The screen
// offering these was real, but every row arrived pre-ticked under the words
// "We've pre-selected common care reminders", above a primary button reading
// "Add 6 Reminders". Tapping the obvious way forward added all six. That is
// automatic in everything but name.
//
// So nothing is selected by default now, and the parts worth testing live
// here rather than inside a component node cannot import.
//
// ── The date is the part that was actually wrong ────────────────────────────
//
// "Annual vaccination booster, due in 12 months" is only true if the animal
// was vaccinated the day it was added to the app. For a dog vaccinated eight
// months ago the booster is due in four, and Pippy would have reminded them
// four months late — worse than silence, because it looks like a record.
//
// Suggestions that start a fresh routine (deworming, flea and tick, grooming)
// can sensibly count from today. Ones that continue something that already
// happened cannot, and are marked `assumesToday` so the screen can say so and
// invite a correction.

import { todayIST, addMonthsISO, addDaysISO } from './dates.js'

/**
 * Offsets, not dates.
 *
 * These used to be computed once, at module load, by calling addMonths() in
 * the constant itself. Pippy is installed as a PWA and a session can stay open
 * for days, so the dates slowly became "12 months from whenever the app was
 * last launched". They are worked out per call now.
 *
 * `frequency` strings must be ones RECURRENCE in api/_lib/morning-reminders.js
 * knows, or the reminder fires once and silently never repeats. 'Every 2
 * months' was missing from that list, which is why grooming, nail trims and
 * shedding checks never came round a second time.
 */
const RECOMMENDATIONS = {
  Dog: [
    { type: 'Vaccination',  label: 'Annual vaccination booster',      months: 12, frequency: 'Yearly',         assumesToday: true,  notes: 'Core vaccines: Distemper, Parvovirus, Hepatitis, Rabies' },
    { type: 'Deworming',    label: 'Deworming',                       months: 3,  frequency: 'Every 3 months', assumesToday: true,  notes: 'Regular deworming for intestinal parasites' },
    { type: 'Flea & Tick',  label: 'Flea & tick prevention',          months: 1,  frequency: 'Monthly',        notes: 'Apply topical/oral flea & tick treatment' },
    { type: 'Dental',       label: 'Dental checkup & cleaning',       months: 12, frequency: 'Yearly',         notes: 'Professional dental scaling if needed' },
    { type: 'Health Check', label: 'Annual wellness exam',            months: 12, frequency: 'Yearly',         notes: 'Full physical exam with blood work' },
    { type: 'Grooming',     label: 'Grooming session',                months: 2,  frequency: 'Every 2 months', notes: 'Bath, trim nails, clean ears' },
  ],
  Cat: [
    { type: 'Vaccination',  label: 'Annual vaccination booster',      months: 12, frequency: 'Yearly',         assumesToday: true,  notes: 'Core vaccines: Feline Herpesvirus, Calicivirus, Panleukopenia, Rabies' },
    { type: 'Deworming',    label: 'Deworming',                       months: 3,  frequency: 'Every 3 months', assumesToday: true,  notes: 'Regular deworming for intestinal parasites' },
    { type: 'Flea & Tick',  label: 'Flea prevention',                 months: 1,  frequency: 'Monthly',        notes: 'Topical or oral flea treatment' },
    { type: 'Dental',       label: 'Dental checkup',                  months: 12, frequency: 'Yearly',         notes: 'Check for tartar buildup and gum disease' },
    { type: 'Health Check', label: 'Annual wellness exam',            months: 12, frequency: 'Yearly',         notes: 'Full physical with blood panel' },
  ],
  Bird: [
    { type: 'Health Check', label: 'Annual wellness exam',            months: 12, frequency: 'Yearly',         notes: 'Full avian check-up with vet' },
    { type: 'Grooming',     label: 'Nail & beak trim',                months: 3,  frequency: 'Every 3 months', notes: 'Keep nails and beak at safe length' },
    { type: 'Vaccination',  label: 'PBFD / Polyomavirus test',        months: 12, frequency: 'Yearly',         assumesToday: true,  notes: 'Screening for common avian viruses' },
  ],
  Rabbit: [
    { type: 'Vaccination',  label: 'Annual vaccination (RHDV & VHD)', months: 12, frequency: 'Yearly',         assumesToday: true,  notes: 'Rabbit Haemorrhagic Disease & Myxomatosis vaccines' },
    { type: 'Health Check', label: 'Bi-annual wellness exam',         months: 6,  frequency: 'Every 6 months', notes: 'Dental and full physical check' },
    { type: 'Grooming',     label: 'Nail trim',                       months: 2,  frequency: 'Every 2 months', notes: 'Trim nails to prevent overgrowth' },
    { type: 'Deworming',    label: 'E. cuniculi treatment',           months: 6,  frequency: 'Every 6 months', assumesToday: true,  notes: 'Fenbendazole course as preventative' },
  ],
  Hamster: [
    { type: 'Health Check', label: 'Monthly health check',            months: 1,  frequency: 'Monthly',        notes: 'Check weight, coat, teeth, and behaviour' },
    { type: 'Grooming',     label: 'Cage deep clean',                 days: 30,   frequency: 'Monthly',        notes: 'Full bedding change and cage sanitise' },
  ],
  Fish: [
    { type: 'Health Check', label: 'Water quality test',              days: 14,   frequency: 'Every 2 weeks',  notes: 'Check pH, ammonia, nitrite, nitrate levels' },
    { type: 'Grooming',     label: 'Tank deep clean',                 months: 1,  frequency: 'Monthly',        notes: 'Gravel vacuum, filter clean, partial water change' },
  ],
  Reptile: [
    { type: 'Health Check', label: 'Annual wellness exam',            months: 12, frequency: 'Yearly',         notes: 'Reptile-specialist vet check' },
    { type: 'Deworming',    label: 'Parasite screening',              months: 6,  frequency: 'Every 6 months', assumesToday: true,  notes: 'Fecal test for internal parasites' },
    { type: 'Grooming',     label: 'Shedding check',                  months: 2,  frequency: 'Every 2 months', notes: 'Ensure full shed, check for retained skin' },
  ],
  Other: [
    { type: 'Health Check', label: 'Annual wellness exam',            months: 12, frequency: 'Yearly',         notes: 'Full health check with a vet' },
    { type: 'Deworming',    label: 'Deworming',                       months: 3,  frequency: 'Every 3 months', assumesToday: true,  notes: 'Check with vet for appropriate treatment' },
  ],
}

export const SUGGESTED_SPECIES = Object.keys(RECOMMENDATIONS)

/**
 * A stable identity for one suggestion.
 *
 * Selection used to be held as a Set of array INDEXES. Switching species after
 * ticking carried the ticks onto whatever happened to sit at the same
 * position: index 0 is the vaccination booster for a dog and the wellness exam
 * for a bird, so unticking "vaccination" and changing to Bird silently
 * unticked something else. Keyed by species and label, a species change simply
 * stops matching, which is the behaviour anyone would expect.
 */
export const suggestionKey = (species, label) => `${species}::${label}`

/**
 * The reminders to offer for a species, dated from today.
 *
 * @param species  Anything not recognised falls back to the generic list.
 * @param today    YYYY-MM-DD. Defaults to today in IST, because every date the
 *                 app stores is a plain Indian calendar date — computing it
 *                 from UTC made every suggestion a day early for anyone adding
 *                 a pet between midnight and half past five in the morning.
 */
export function suggestionsFor(species, today = todayIST()) {
  const list = RECOMMENDATIONS[species] || RECOMMENDATIONS.Other
  return list.map(r => ({
    key:          suggestionKey(species, r.label),
    type:         r.type,
    label:        r.label,
    frequency:    r.frequency,
    notes:        r.notes,
    assumesToday: !!r.assumesToday,
    dueDate:      r.days != null ? addDaysISO(today, r.days) : addMonthsISO(today, r.months),
  }))
}

/**
 * What actually gets saved, for the suggestions the owner ticked.
 *
 * `type` carries the LABEL rather than the category, because the reminders
 * screen shows `reminder.type` as the reminder's name — "Annual vaccination
 * booster" reads better there than "Vaccination". That is deliberate, and
 * Reminders.jsx keeps an unrecognised value in its dropdown so opening one to
 * edit it does not silently rename it.
 *
 * @param chosen  Keys the owner ticked.
 * @param dates   Optional { [key]: 'YYYY-MM-DD' } overriding a suggested date,
 *                which is how somebody says "he was vaccinated in March".
 */
export function remindersToSave(suggestions, chosen, petId, dates = {}) {
  const picked = new Set(chosen)
  return suggestions
    .filter(s => picked.has(s.key))
    .map(s => ({
      petId,
      type:      s.label,
      dueDate:   dates[s.key] || s.dueDate,
      frequency: s.frequency,
      notes:     s.notes,
      isDone:    false,
      email:     '',
      whatsapp:  '',
    }))
}
