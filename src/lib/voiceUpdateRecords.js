// src/lib/voiceUpdateRecords.js
//
// What a spoken update turns into, kept apart from the screen that shows it so
// it can be tested without a browser — see scripts/test-voice-update.mjs.
//
// One entry per kind of record the owner can add by talking. Each knows how to
// label a parsed row for the review screen, whether the row is worth offering
// at all, and what payload the matching storage.js function wants. The icons
// live with the component, because they are the only part of this that is JSX.

// A weight with no date plots at NaN and breaks the whole chart, so a dateless
// weight is dated here rather than left empty. The prompt already says a weight
// is measured when it is spoken; this is the guard for when it forgets.
import { todayIST } from './dates.js'
export { todayIST }

const num = v => (v === null || v === undefined || v === '' ? '' : v)

// The fixed vocabularies the rest of the app uses. Mirrored here because a lib
// must not import from components; scripts/test-voice-update.mjs compares these
// against the component constants so the two cannot drift apart unnoticed.
//
// A value the AI produced that is NOT on one of these lists is still kept: the
// review row adds it as an option rather than quietly rewriting it to whatever
// happens to be first. Silently changing a record while showing it for approval
// would be worse than leaving it odd.
// 'Observation' exists because of a real gap: a customer said "limping has
// reduced" and nothing was recorded. Every other type here describes an
// EVENT -- a visit, a procedure, a result -- so a plain observation about how
// the animal is doing had no home, and the model put it in "unclear", which
// is shown and then dropped. It belongs in the medical timeline: it is
// exactly the kind of thing a vet wants to read back.
const MEDICAL_TYPES  = ['Checkup', 'Illness', 'Surgery', 'Injury', 'Dental', 'Lab Result', 'Prescription', 'Observation', 'Other']
const MEDICINE_CATS  = ['Deworming', 'Flea/Tick', 'Antibiotic', 'Anti-inflammatory', 'Supplement', 'Vaccination', 'Other']
const ALLERGY_TYPES  = ['Food', 'Environmental', 'Medication', 'Contact', 'Insect', 'Other']
const ALLERGY_SEVERITY = ['Mild', 'Moderate', 'Severe']
const REMINDER_TYPES = ['Vaccination', 'Grooming', 'Vet Checkup', 'Medication', 'Boarding', 'Other']
const REMINDER_FREQ  = ['Once', 'Weekly', 'Monthly', 'Yearly']
export const VOCAB = { MEDICAL_TYPES, MEDICINE_CATS, ALLERGY_TYPES, ALLERGY_SEVERITY, REMINDER_TYPES, REMINDER_FREQ }

/** A description used as a title: first clause, kept short enough to read. */
function trunc(text) {
  const t = String(text ?? '').trim().split(/[.;\n]/)[0].trim()
  if (!t) return ''
  return t.length > 60 ? t.slice(0, 57).trimEnd() + '…' : t
}

export const RECORD_KINDS = [
  {
    key: 'medical', label: 'Medical', saver: 'saveMedicalRecord',
    // Falling back to 'Vet visit' would put words in the owner's mouth when
    // what they actually said was "limping has reduced" and no visit
    // happened. Prefer their own description.
    title:  r => r.title || r.type || trunc(r.description) || 'Vet visit',
    detail: r => [r.type, r.date, r.vet && `with ${r.vet}`,
                  r.cost != null && `₹${r.cost}`, r.description].filter(Boolean).join(' · '),
    usable: r => !!String(r.title || r.type || r.description || '').trim(),
    needs: 'a title or a description',
    editable: [
      { field: 'title',       label: 'Title',       type: 'text' },
      { field: 'type',        label: 'Type',        type: 'select', options: MEDICAL_TYPES },
      { field: 'date',        label: 'Date',        type: 'date' },
      { field: 'vet',         label: 'Vet',         type: 'text' },
      { field: 'description', label: 'Description', type: 'text' },
      { field: 'cost',        label: 'Cost (₹)',    type: 'number' },
    ],
    payload: (r, petId) => ({
      petId, date: r.date || '', type: r.type || 'Other',
      title: r.title || r.type || trunc(r.description) || 'Vet visit',
      description: r.description || '',
      vet: r.vet || '', cost: num(r.cost),
    }),
  },
  {
    key: 'vaccinations', label: 'Vaccination', saver: 'saveVaccination',
    title:  r => r.name,
    detail: r => [r.dateGiven && `given ${r.dateGiven}`, r.nextDue && `next ${r.nextDue}`]
      .filter(Boolean).join(' · ') || 'No dates given',
    usable: r => !!String(r.name || '').trim(),
    needs: 'a name',
    editable: [
      { field: 'name',      label: 'Vaccine',   type: 'text', required: true },
      { field: 'dateGiven', label: 'Given on',  type: 'date' },
      { field: 'nextDue',   label: 'Next due',  type: 'date' },
    ],
    payload: (r, petId) => ({
      petId, name: r.name, dateGiven: r.dateGiven || '', nextDue: r.nextDue || '',
    }),
  },
  {
    key: 'medicines', label: 'Medicine', saver: 'saveMedicine',
    title:  r => r.name,
    detail: r => [r.dosage, r.frequency, r.category].filter(Boolean).join(' · '),
    usable: r => !!String(r.name || '').trim(),
    needs: 'a name',
    editable: [
      { field: 'name',      label: 'Medicine',  type: 'text', required: true },
      { field: 'dosage',    label: 'Dosage',    type: 'text', placeholder: 'e.g. one tablet' },
      // Free text, not a list: a medicine's frequency is whatever the vet said.
      { field: 'frequency', label: 'How often', type: 'text', placeholder: 'e.g. twice daily' },
      { field: 'category',  label: 'Category',  type: 'select', options: MEDICINE_CATS },
    ],
    payload: (r, petId) => ({
      petId, name: r.name, dosage: r.dosage || '', frequency: r.frequency || '',
      category: r.category || 'Other',
    }),
  },
  {
    key: 'allergies', label: 'Allergy', saver: 'saveAllergy',
    title:  r => r.allergen,
    detail: r => [r.type, r.severity, (r.reactions || []).join(', ')].filter(Boolean).join(' · '),
    usable: r => !!String(r.allergen || '').trim(),
    needs: 'what the allergy is to',
    editable: [
      { field: 'allergen',  label: 'Allergic to', type: 'text', required: true },
      { field: 'type',      label: 'Type',        type: 'select', options: ALLERGY_TYPES },
      { field: 'severity',  label: 'Severity',    type: 'select', options: ALLERGY_SEVERITY },
      { field: 'reactions', label: 'Reactions',   type: 'text', placeholder: 'comma separated' },
    ],
    payload: (r, petId) => ({
      petId, allergen: r.allergen, type: r.type || 'Other', severity: r.severity || 'Mild',
      // reactions is an array column — a single reaction is still an array, and
      // a comma-separated line typed into the review screen becomes several.
      reactions: Array.isArray(r.reactions)
        ? r.reactions
        : String(r.reactions || '').split(',').map(s => s.trim()).filter(Boolean),
    }),
  },
  {
    key: 'weights', label: 'Weight', saver: 'saveWeightLog',
    title:  r => `${r.weight} kg`,
    detail: r => [r.date || todayIST(), r.notes].filter(Boolean).join(' · '),
    usable: r => Number.isFinite(Number(r.weight)) && Number(r.weight) > 0,
    needs: 'a weight above zero',
    editable: [
      { field: 'weight', label: 'Weight (kg)', type: 'number', required: true, step: '0.01' },
      { field: 'date',   label: 'Measured on', type: 'date' },
      { field: 'notes',  label: 'Note',        type: 'text' },
    ],
    payload: (r, petId) => ({
      petId, date: r.date || todayIST(), weight: r.weight, notes: r.notes || '',
    }),
  },
  {
    key: 'bills', label: 'Bill', saver: 'saveBill',
    title:  r => (r.totalAmount != null ? `₹${r.totalAmount}` : 'Bill'),
    detail: r => [r.clinic, r.date, r.notes].filter(Boolean).join(' · '),
    usable: r => r.totalAmount != null || !!String(r.clinic || '').trim(),
    needs: 'an amount or a clinic',
    editable: [
      { field: 'totalAmount', label: 'Amount (₹)', type: 'number' },
      { field: 'clinic',      label: 'Clinic',     type: 'text' },
      { field: 'date',        label: 'Date',       type: 'date' },
      { field: 'notes',       label: 'Note',       type: 'text' },
    ],
    payload: (r, petId) => ({
      petId, date: r.date || '', clinic: r.clinic || '', totalAmount: num(r.totalAmount),
      lineItems: [], currency: 'INR', notes: r.notes || '',
    }),
  },
  {
    key: 'reminders', label: 'Reminder', saver: 'saveReminder',
    title:  r => r.type || 'Reminder',
    detail: r => [r.dueDate && `due ${r.dueDate}`, r.frequency, r.notes].filter(Boolean).join(' · '),
    // A reminder with no date can never fire, so it cannot be SAVED — but it
    // can now be shown and corrected, which is why `editable` exists below.
    // Dropping it outright is what made a misheard date lose the whole
    // reminder with nothing to show for it.
    usable: r => !!String(r.dueDate || '').trim(),
    // What a human may correct before saving. Transcription gets dates wrong
    // more than anything else here -- "the eighth" and "the eighteenth" are one
    // vowel apart -- and a reminder is the one record whose whole purpose is
    // the date being right.
    needs: 'a date',
    editable: [
      { field: 'type',      label: 'Reminder',  type: 'select', options: REMINDER_TYPES },
      { field: 'dueDate',   label: 'Due date',  type: 'date', required: true },
      { field: 'frequency', label: 'Repeats',   type: 'select', options: REMINDER_FREQ },
      { field: 'notes',     label: 'Note',      type: 'text', placeholder: 'Optional detail' },
    ],
    payload: (r, petId) => ({
      petId, type: r.type || 'Other', dueDate: r.dueDate || '',
      frequency: r.frequency || 'Once', email: '', whatsapp: '', notes: r.notes || '',
    }),
  },
]

/**
 * Turn one AI parse into the groups the review screen shows.
 * Rows that are not worth offering are dropped here, so the indexes the
 * tick-boxes use always match the rows that get saved.
 */
export function groupParsed(parsed = {}) {
  return RECORD_KINDS
    .map(kind => ({
      kind,
      // A row that cannot be saved is still OFFERED when its kind can be
      // edited, so the owner can supply what is missing. For every other kind
      // an unusable row is noise -- a medicine with no name says nothing -- and
      // is dropped as before.
      //
      // The indexes here are what the tick-boxes are keyed on, so this list and
      // the list that gets saved must stay the same list.
      rows: (parsed[kind.key] || []).filter(r => r && (kind.usable(r) || !!kind.editable)),
    }))
    .filter(g => g.rows.length)
}
