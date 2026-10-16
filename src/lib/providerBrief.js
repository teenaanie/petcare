// The facts block of an inform note, composed in code from the pet's own rows.
//
// NO LANGUAGE MODEL TOUCHES THIS, and that is the point rather than a
// simplification. A model restating a rabies date can get it wrong, and the
// customer is the only check — people do not proofread machine text carefully,
// least of all text that looks authoritative and is about to be sent. A wrong
// date in a note a boarder acts on is the one failure in this feature that
// could hurt an animal. These are structured rows; there is no reason to put a
// language model between them and a kennel.
//
// The covering prose above the facts IS generated, because it restates nothing.
// See the `provider_brief` task in api/_lib/ai-complete.js.
//
// What goes in, and what deliberately does not (decision 4 of
// docs/provider-platform-plan.md):
//
//   IN   name, species, breed, age, latest vaccination per type with its date,
//        allergies, current medicines with dose, the boarding profile, the most
//        recent medical record's TITLE AND DATE ONLY, vet name and phone.
//   OUT  medical record detail and attachments, bills, weight history,
//        condition journal notes, reminders, documents.
//
// The medical line is a headline, not a record: "Ear infection — 12 Aug 2026"
// tells a boarder there was something recent and lets them ask, without handing
// over what the vet wrote. A customer who wants to say more types it.
//
// All of this is a DEFAULT, not a boundary. The customer edits the text before
// sending, which is what makes it safe to have a default at all.

import { todayIST } from './dates.js'

const nonEmpty = v => typeof v === 'string' && v.trim() !== ''

/**
 * Is this a usable calendar day, given as a YYYY-MM-DD string?
 *
 * Deliberately NOT dates.js's isRealDate, which takes a Date OBJECT: handed a
 * string it returns false for every value, valid ones included. That failure is
 * silent — dates simply vanish from the note — and it was caught here only
 * because test:brief asserts that a finished course is excluded. Everything in
 * these rows is a plain date string, so the check belongs on strings.
 *
 * Round-tripping through toISOString is what rejects '2026-02-31', which Date
 * otherwise rolls forward into March rather than refusing.
 */
function isDay(v) {
  if (typeof v !== 'string') return false
  const s = v.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** "12 Aug 2026", or null when the date is missing or junk. */
export function formatDay(iso) {
  if (!isDay(iso)) return null
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/** "3 years", "7 months", or null. Whole units — a boarder does not need days. */
export function ageLabel(dob, today = todayIST()) {
  if (!isDay(dob)) return null
  const born = new Date(`${String(dob).slice(0, 10)}T00:00:00Z`)
  const now  = new Date(`${String(today).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(born.getTime()) || Number.isNaN(now.getTime()) || born > now) return null
  let months = (now.getUTCFullYear() - born.getUTCFullYear()) * 12
             + (now.getUTCMonth() - born.getUTCMonth())
  if (now.getUTCDate() < born.getUTCDate()) months -= 1
  if (months < 1)  return 'under a month'
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'}`
}

/**
 * The latest shot of each kind.
 *
 * Grouped case-insensitively on the name, because "Rabies" and "rabies" are the
 * same vaccine typed on two different days, and showing both would make a
 * current pet look overdue. Undated rows are dropped rather than shown without
 * a date: "Rabies" with no date tells a boarder nothing and implies something.
 */
export function latestVaccinations(vaccinations = []) {
  const best = new Map()
  for (const v of vaccinations) {
    if (!nonEmpty(v?.name) || !isDay(v?.dateGiven)) continue
    const key = v.name.trim().toLowerCase()
    const prev = best.get(key)
    if (!prev || String(v.dateGiven) > String(prev.dateGiven)) {
      best.set(key, { name: v.name.trim(), dateGiven: String(v.dateGiven).slice(0, 10) })
    }
  }
  // Most recent first. This used to sort by name, which read as a jumble:
  // for one real pet it ran Antirab 2023, Antirabies 2023, Canigen 2021,
  // Coronavirus 2026, DPPvL 2021, CCV 2025 -- eighteen rows in alphabetical
  // order with the dates scattered through them. A boarder reads this list to
  // answer one question, "is this dog covered right now", and the answer is at
  // the top when the newest shot is at the top. Name breaks ties so two shots
  // on the same day still have a stable order.
  return [...best.values()].sort((a, b) =>
    (a.dateGiven < b.dateGiven ? 1 : a.dateGiven > b.dateGiven ? -1 : 0) ||
    a.name.localeCompare(b.name))
}

/**
 * Medicines the pet is actually on.
 *
 * A course that finished last year is not something a boarder should be given,
 * and a note listing it invites them to administer it. So: not marked done, and
 * either open-ended or not yet ended. A missing start date does not disqualify —
 * plenty of rows have one typed and the other not.
 */
export function currentMedicines(medicines = [], today = todayIST()) {
  const rows = (medicines || [])
    .filter(m => nonEmpty(m?.name))
    .filter(m => !m.isDone)
    .filter(m => !isDay(m.endDate) || String(m.endDate).slice(0, 10) >= today)
    .map(m => ({
      name:      m.name.trim(),
      dosage:    nonEmpty(m.dosage)    ? m.dosage.trim()    : null,
      frequency: nonEmpty(m.frequency) ? m.frequency.trim() : null,
    }))
  return dedupeMedicines(rows)
}

// Indian prescriptions prefix the dosage form onto the drug: Tab. Bravecto,
// Syp. Ondem, Inj. Melonex. It is the same medicine either way, so the prefix
// comes off the grouping key but stays out of nobody's way on screen.
const FORM_PREFIX = /^(tab|tabs|tablet|cap|caps|capsule|syp|syr|syrup|susp|suspension|inj|injection|oint|ointment|drops?|sol|soln|solution|lot|lotion|cream|gel|powder|sachet)\b[.\s-]*/i

const medKey = name => String(name).toLowerCase()
  .replace(FORM_PREFIX, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

/**
 * One line per medicine, not one line per time it was written down.
 *
 * A real pet's brief listed "Bravecto" three times and then "Tab. Bravecto".
 * The three were byte-identical rows -- same null dosage, same null frequency
 * -- logged on three different days, because each dose was recorded as a new
 * medicine rather than as a dose of the existing one. To a boarder reading
 * the note, four lines naming the same flea treatment reads as four things to
 * give.
 *
 * Two rules, in order:
 *
 *   1. Rows identical in name, dosage and frequency are one row. This is the
 *      repeated-entry case and it is never anything else.
 *   2. Within one medicine, a row carrying a dose absorbs the rows carrying
 *      nothing. "Bravecto" with no dose beside "Tab. Bravecto — > 10-20 kg"
 *      is the second row's dose, written down twice.
 *
 * What it will NOT do is merge two rows that each state a dose. Two live
 * doses of the same drug is either a real split regimen or a data problem,
 * and both of those are the owner's to resolve -- quietly dropping one could
 * mean a boarder gives half of what was intended. Those stay as separate
 * lines, which is also the signal that something needs a look.
 */
export function dedupeMedicines(rows = []) {
  const groups = new Map()
  for (const m of rows) {
    const key = medKey(m.name) || String(m.name).toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(m)
  }

  const out = []
  for (const group of groups.values()) {
    // Rule 1: collapse byte-identical rows.
    const seen = new Map()
    for (const m of group) {
      const exact = `${m.name.toLowerCase()}|${m.dosage ?? ''}|${m.frequency ?? ''}`
      if (!seen.has(exact)) seen.set(exact, m)
    }
    const distinct = [...seen.values()]

    // Rule 2: detailed rows absorb the bare ones.
    const detailed = distinct.filter(m => m.dosage || m.frequency)
    out.push(...(detailed.length ? detailed : distinct))
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// How many vaccination lines the note carries before it summarises the rest.
export const VACCINATION_LINES = 6

/** The most recent medical record, as a headline. Title and date, nothing else. */
export function lastMedicalHeadline(records = []) {
  const dated = (records || []).filter(r => nonEmpty(r?.title) && isDay(r?.date))
  if (!dated.length) return null
  const latest = dated.reduce((a, b) => (String(b.date) > String(a.date) ? b : a))
  // Only these two fields are ever read. `description` is in scope of the row
  // and deliberately out of scope of the note.
  return { title: latest.title.trim(), date: String(latest.date).slice(0, 10) }
}

/**
 * The whole facts block, as stored in provider_notes.facts.
 *
 * Stored as sent, so a note still renders years later even if the pet's records
 * have moved on — the same reason pet_label and the contact fields are
 * denormalised onto the row.
 */
export function composeFacts({
  pet, vaccinations = [], allergies = [], medicines = [], medicalRecords = [],
} = {}, today = todayIST()) {
  if (!pet) return null
  return {
    pet: {
      name:    pet.name || '',
      species: pet.species || null,
      breed:   nonEmpty(pet.breed) ? pet.breed.trim() : null,
      sex:     nonEmpty(pet.gender) ? pet.gender.trim() : null,
      age:     ageLabel(pet.dob, today),
    },
    vaccinations: latestVaccinations(vaccinations),
    allergies: (allergies || [])
      .filter(a => nonEmpty(a?.allergen))
      .map(a => ({
        allergen:  a.allergen.trim(),
        severity:  nonEmpty(a.severity) ? a.severity.trim() : null,
        reactions: Array.isArray(a.reactions) ? a.reactions.filter(nonEmpty) : [],
      })),
    medicines: currentMedicines(medicines, today),
    boarding: {
      feedingSchedule:    nonEmpty(pet.feedingSchedule) ? pet.feedingSchedule.trim() : null,
      dietNotes:          nonEmpty(pet.dietNotes)       ? pet.dietNotes.trim()       : null,
      foodPreferences:    Array.isArray(pet.foodPreferences) ? pet.foodPreferences.filter(nonEmpty) : [],
      temperament:        nonEmpty(pet.temperament)     ? pet.temperament.trim()     : null,
      anxietyNotes:       nonEmpty(pet.anxietyNotes)    ? pet.anxietyNotes.trim()    : null,
      triggers:           Array.isArray(pet.triggers) ? pet.triggers.filter(nonEmpty) : [],
      handlingNotes:      nonEmpty(pet.handlingNotes)   ? pet.handlingNotes.trim()   : null,
      socialisesWithDogs: typeof pet.socialisesWithDogs === 'boolean' ? pet.socialisesWithDogs : null,
    },
    lastMedical: lastMedicalHeadline(medicalRecords),
    vet: {
      name:  nonEmpty(pet.vetName)  ? pet.vetName.trim()  : null,
      phone: nonEmpty(pet.vetPhone) ? pet.vetPhone.trim() : null,
    },
  }
}

/**
 * The facts block as the text the customer reads, edits and sends.
 *
 * Plain lines rather than markdown: this is read in a textarea, pasted into
 * WhatsApp, and printed out by kennels. Headings a person would write.
 */
export function factsToText(facts) {
  if (!facts) return ''
  const out = []
  const line = s => out.push(s)

  const { pet, vaccinations, allergies, medicines, boarding, lastMedical, vet } = facts

  const ident = [pet.breed, pet.species, pet.sex, pet.age && `${pet.age} old`]
    .filter(Boolean).join(' · ')
  line(pet.name + (ident ? ` — ${ident}` : ''))

  if (vaccinations?.length) {
    line('')
    line('Vaccinations')
    // Six, then a count.
    //
    // One real pet carried eighteen rows, and they were not eighteen
    // vaccines: Antirab, Antirabies, Rabisin, Nobivac Rabies and R/L MSD are
    // all the rabies shot under different brand names, and five more rows are
    // all the core DHPP one. Collapsing those properly needs a brand-to-
    // vaccine mapping, which is veterinary knowledge this file is not the
    // place to invent -- so instead of pretending to know, show the newest
    // six and say honestly how many are behind them.
    //
    // Six because the list is sorted newest first and a dog's current cover
    // is its last few shots; the rest is history a boarder does not act on.
    // The count stays visible so nothing looks hidden.
    const shown = vaccinations.slice(0, VACCINATION_LINES)
    for (const v of shown) line(`  ${v.name} — ${formatDay(v.dateGiven) || v.dateGiven}`)
    const rest = vaccinations.length - shown.length
    if (rest > 0) line(`  …and ${rest} earlier ${rest === 1 ? 'shot' : 'shots'}`)
  }

  if (allergies?.length) {
    line('')
    line('Allergies')
    for (const a of allergies) {
      const extra = [a.severity, a.reactions?.length ? a.reactions.join(', ') : null]
        .filter(Boolean).join(' · ')
      line(`  ${a.allergen}${extra ? ` (${extra})` : ''}`)
    }
  }

  if (medicines?.length) {
    line('')
    line('Currently on')
    for (const m of medicines) {
      const extra = [m.dosage, m.frequency].filter(Boolean).join(', ')
      line(`  ${m.name}${extra ? ` — ${extra}` : ''}`)
    }
  }

  const b = boarding || {}
  const careLines = []
  if (b.feedingSchedule) careLines.push(`  Feeding: ${b.feedingSchedule}`)
  if (b.foodPreferences?.length) careLines.push(`  Food: ${b.foodPreferences.join(', ')}`)
  if (b.dietNotes) careLines.push(`  Diet notes: ${b.dietNotes}`)
  if (b.temperament) careLines.push(`  Temperament: ${b.temperament}`)
  if (b.anxietyNotes) careLines.push(`  Anxiety: ${b.anxietyNotes}`)
  if (b.triggers?.length) careLines.push(`  Triggers: ${b.triggers.join(', ')}`)
  if (b.handlingNotes) careLines.push(`  Handling: ${b.handlingNotes}`)
  if (b.socialisesWithDogs !== null && b.socialisesWithDogs !== undefined) {
    careLines.push(`  With other dogs: ${b.socialisesWithDogs ? 'fine' : 'keep separate'}`)
  }
  if (careLines.length) {
    line('')
    line('Care')
    out.push(...careLines)
  }

  if (lastMedical) {
    line('')
    line('Most recent vet visit')
    line(`  ${lastMedical.title} — ${formatDay(lastMedical.date) || lastMedical.date}`)
  }

  if (vet?.name || vet?.phone) {
    line('')
    line('Vet')
    line(`  ${[vet.name, vet.phone].filter(Boolean).join(' · ')}`)
  }

  return out.join('\n')
}

/**
 * The covering line used when the generated one is unavailable.
 *
 * Deliberately dull and deliberately not a summary of the facts: the facts are
 * right underneath. If the model is down, over budget, or the customer is
 * offline, the feature still works — generation is an improvement to this
 * sentence, never a dependency of sending.
 */
export function fallbackCoveringNote(petName, providerName) {
  const who = nonEmpty(petName) ? petName.trim() : 'my pet'
  const to  = nonEmpty(providerName) ? ` ${providerName.trim()}` : ''
  return `Hi${to}, here are ${who}'s current details so you have them on file. `
       + `Please call me if anything looks out of date.`
}
