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

export const RECORD_KINDS = [
  {
    key: 'medical', label: 'Visit', saver: 'saveMedicalRecord',
    title:  r => r.title || r.type || 'Vet visit',
    detail: r => [r.type, r.date, r.vet && `with ${r.vet}`,
                  r.cost != null && `₹${r.cost}`, r.description].filter(Boolean).join(' · '),
    usable: r => !!String(r.title || r.type || r.description || '').trim(),
    payload: (r, petId) => ({
      petId, date: r.date || '', type: r.type || 'Other',
      title: r.title || r.type || 'Vet visit', description: r.description || '',
      vet: r.vet || '', cost: num(r.cost),
    }),
  },
  {
    key: 'vaccinations', label: 'Vaccination', saver: 'saveVaccination',
    title:  r => r.name,
    detail: r => [r.dateGiven && `given ${r.dateGiven}`, r.nextDue && `next ${r.nextDue}`]
      .filter(Boolean).join(' · ') || 'No dates given',
    usable: r => !!String(r.name || '').trim(),
    payload: (r, petId) => ({
      petId, name: r.name, dateGiven: r.dateGiven || '', nextDue: r.nextDue || '',
    }),
  },
  {
    key: 'medicines', label: 'Medicine', saver: 'saveMedicine',
    title:  r => r.name,
    detail: r => [r.dosage, r.frequency, r.category].filter(Boolean).join(' · '),
    usable: r => !!String(r.name || '').trim(),
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
    payload: (r, petId) => ({
      petId, allergen: r.allergen, type: r.type || 'Other', severity: r.severity || 'Mild',
      // reactions is an array column — a single reaction is still an array.
      reactions: Array.isArray(r.reactions) ? r.reactions : (r.reactions ? [r.reactions] : []),
    }),
  },
  {
    key: 'weights', label: 'Weight', saver: 'saveWeightLog',
    title:  r => `${r.weight} kg`,
    detail: r => [r.date || todayIST(), r.notes].filter(Boolean).join(' · '),
    usable: r => Number.isFinite(Number(r.weight)) && Number(r.weight) > 0,
    payload: (r, petId) => ({
      petId, date: r.date || todayIST(), weight: r.weight, notes: r.notes || '',
    }),
  },
  {
    key: 'bills', label: 'Bill', saver: 'saveBill',
    title:  r => (r.totalAmount != null ? `₹${r.totalAmount}` : 'Bill'),
    detail: r => [r.clinic, r.date, r.notes].filter(Boolean).join(' · '),
    usable: r => r.totalAmount != null || !!String(r.clinic || '').trim(),
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
    editable: [
      { field: 'type',    label: 'Reminder', type: 'text', placeholder: 'What is it for' },
      { field: 'dueDate', label: 'Due date', type: 'date', required: true },
      { field: 'notes',   label: 'Note',     type: 'text', placeholder: 'Optional detail' },
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
