// The facts block of an inform note. Run with: npm run test:brief
//
// This is the half of the draft that no language model touches, so these are
// the assertions standing between a kennel and a wrong date. The ones that
// matter most are not the formatting checks — they are:
//
//   * only the LATEST shot of each kind is shown, so a current pet never reads
//     as overdue because an old row sorted first;
//   * a finished course is never listed, because a note listing it invites a
//     boarder to administer it;
//   * the medical line carries a title and a date and NOTHING else — the whole
//     record is in scope of the row and out of scope of the note.

import {
  composeFacts, factsToText, latestVaccinations, currentMedicines,
  lastMedicalHeadline, ageLabel, formatDay, fallbackCoveringNote,
} from '../src/lib/providerBrief.js'

let failed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const TODAY = '2026-10-07'

// ── Latest shot of each kind ────────────────────────────────────────────────

check('one row per vaccine, latest wins',
  latestVaccinations([
    { name: 'Rabies', dateGiven: '2024-01-01' },
    { name: 'Rabies', dateGiven: '2026-06-15' },
    { name: 'DHPP',   dateGiven: '2026-02-02' },
  ]),
  [{ name: 'DHPP', dateGiven: '2026-02-02' }, { name: 'Rabies', dateGiven: '2026-06-15' }])

check('case is not a different vaccine',
  latestVaccinations([
    { name: 'rabies', dateGiven: '2026-06-15' },
    { name: 'Rabies', dateGiven: '2024-01-01' },
  ]).length, 1)

check('an undated shot is dropped, not shown dateless',
  latestVaccinations([{ name: 'Rabies', dateGiven: null }]), [])
check('and so is a junk date',
  latestVaccinations([{ name: 'Rabies', dateGiven: 'soon' }]), [])

// ── Only what the pet is actually on ────────────────────────────────────────

const MEDS = [
  { name: 'Apoquel',   dosage: '16mg', frequency: 'twice daily', endDate: null,         isDone: false },
  { name: 'Amoxicillin', dosage: '250mg', frequency: 'daily',    endDate: '2026-01-01', isDone: false },
  { name: 'Panacur',   dosage: '1 sachet', frequency: 'daily',   endDate: null,         isDone: true  },
  { name: 'Carprofen', dosage: '50mg', frequency: 'daily',       endDate: '2026-12-31', isDone: false },
]
check('a finished course is not listed',
  currentMedicines(MEDS, TODAY).map(m => m.name), ['Apoquel', 'Carprofen'])
check('a course ending today still counts',
  currentMedicines([{ name: 'X', endDate: TODAY, isDone: false }], TODAY).map(m => m.name), ['X'])
check('dose and frequency ride along',
  currentMedicines([MEDS[0]], TODAY), [{ name: 'Apoquel', dosage: '16mg', frequency: 'twice daily' }])

// ── The medical line is a headline, never a record ──────────────────────────

const RECORDS = [
  { title: 'Annual check',   date: '2025-03-01', description: 'all normal',        type: 'checkup' },
  { title: 'Ear infection',  date: '2026-08-12', description: 'SECRET VET PROSE',  type: 'illness',
    vet: 'Dr Who', cost: 2400, isAbnormal: true, abnormalities: ['left ear'] },
]
check('the most recent one is chosen',
  lastMedicalHeadline(RECORDS), { title: 'Ear infection', date: '2026-08-12' })
check('and carries exactly two fields',
  Object.keys(lastMedicalHeadline(RECORDS)).sort(), ['date', 'title'])
check('no records at all is survivable', lastMedicalHeadline([]), null)

// ── Age ─────────────────────────────────────────────────────────────────────

check('years, once there are two',        ageLabel('2023-10-07', TODAY), '3 years')
check('months, under two years',          ageLabel('2026-03-07', TODAY), '7 months')
check('a singular month reads right',     ageLabel('2026-09-07', TODAY), '1 month')
check('a newborn',                        ageLabel('2026-10-01', TODAY), 'under a month')
check('a birthday later this month',      ageLabel('2023-10-20', TODAY), '2 years')
check('no dob is not an age',             ageLabel(null, TODAY), null)
check('a dob in the future is refused',   ageLabel('2027-01-01', TODAY), null)
check('a day formats for a human',        formatDay('2026-08-12'), '12 Aug 2026')
check('and a junk day does not',          formatDay('whenever'), null)

// ── The whole block ─────────────────────────────────────────────────────────

const PET = {
  name: 'Pippin', species: 'Dog', breed: 'Beagle', gender: 'Male', dob: '2023-10-07',
  vetName: 'Dr Rao', vetPhone: '9876500000',
  feedingSchedule: '8am and 7pm', dietNotes: 'no chicken', foodPreferences: ['kibble'],
  temperament: 'friendly', anxietyNotes: 'hates thunder', triggers: ['fireworks'],
  handlingNotes: 'harness not collar', socialisesWithDogs: true,
  // Things that must NOT reach the note, present on the row:
  notes: 'PRIVATE OWNER NOTE', microchipId: '900123456789', insurancePolicy: 'POLICY-1',
  weight: 12.4,
}
const facts = composeFacts({
  pet: PET, vaccinations: [{ name: 'Rabies', dateGiven: '2026-06-15' }],
  allergies: [{ allergen: 'Chicken', severity: 'Severe', reactions: ['itching'] }],
  medicines: MEDS, medicalRecords: RECORDS,
}, TODAY)

const blob = JSON.stringify(facts)
check('the vet prose never reaches the note', blob.includes('SECRET VET PROSE'), false)
check('nor the owner\'s private notes',       blob.includes('PRIVATE OWNER NOTE'), false)
check('nor the microchip',                    blob.includes('900123456789'), false)
check('nor the insurance policy',             blob.includes('POLICY-1'), false)
check('nor the vet bill',                     blob.includes('2400'), false)
check('nor the weight',                       blob.includes('12.4'), false)
check('the facts block has a fixed shape',    Object.keys(facts).sort(),
      ['allergies', 'boarding', 'lastMedical', 'medicines', 'pet', 'vaccinations', 'vet'])
check('no pet means no facts', composeFacts({ pet: null }), null)

const text = factsToText(facts)
check('the text names the pet',        text.startsWith('Pippin — Beagle · Dog · Male · 3 years old'), true)
check('shows the shot with its date',  text.includes('Rabies — 15 Jun 2026'), true)
check('shows the allergy',             text.includes('Chicken (Severe · itching)'), true)
check('shows only current medicine',
      text.includes('Apoquel — 16mg, twice daily') && !text.includes('Amoxicillin'), true)
check('shows the care profile',        text.includes('Handling: harness not collar'), true)
check('spells out the dog question',   text.includes('With other dogs: fine'), true)
check('shows the visit as a headline', text.includes('Ear infection — 12 Aug 2026'), true)
check('and not the vet\'s prose',      text.includes('SECRET VET PROSE'), false)
check('shows the vet to call',         text.includes('Dr Rao · 9876500000'), true)

// A pet with nothing filled in must still produce something sendable rather
// than a wall of empty headings.
const bare = composeFacts({ pet: { name: 'Mo', species: 'Cat' } }, TODAY)
check('a bare pet is one line', factsToText(bare), 'Mo — Cat')

check('the fallback note addresses the business',
      fallbackCoveringNote('Pippin', 'Unleash'),
      "Hi Unleash, here are Pippin's current details so you have them on file. "
      + 'Please call me if anything looks out of date.')
check('and survives knowing neither name',
      fallbackCoveringNote('', '').startsWith('Hi, here are my pet\'s current details'), true)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
