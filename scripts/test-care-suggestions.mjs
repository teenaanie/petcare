// The reminders offered when a pet is added. Run: npm run test:care-suggestions
//
// A customer added their dog and found a vaccination reminder waiting that
// they had never asked for, for a jab the dog had already had. The screen
// offering these was real, but every row arrived pre-ticked under the words
// "We've pre-selected common care reminders", above a button reading "Add 6
// Reminders". Tapping the obvious way forward added all six.
//
// Two separate faults, and the second is the one that made it wrong rather
// than merely unwanted: "Annual vaccination booster, due in 12 months" is only
// true if the animal was vaccinated that day. For a dog done eight months ago
// the booster is due in four, and Pippy would have reminded them four months
// late -- worse than silence, because it looks like a record.

import {
  suggestionsFor, remindersToSave, suggestionKey, SUGGESTED_SPECIES,
} from '../src/lib/careSuggestions.js'
import { nextDueDate } from '../api/_lib/morning-reminders.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

const TODAY = '2026-10-12'

console.log('\nNothing is chosen for the owner')
{
  // The whole point of the change. If a default selection ever comes back,
  // the complaint comes back with it.
  const saved = remindersToSave(suggestionsFor('Dog', TODAY), new Set(), 'pet-1')
  ok('an owner who ticks nothing gets nothing', saved.length === 0, saved.length)

  const one = remindersToSave(
    suggestionsFor('Dog', TODAY), [suggestionKey('Dog', 'Deworming')], 'pet-1')
  ok('ticking one saves exactly one', one.length === 1, one.length)
  ok('and it is the one they ticked', one[0].type === 'Deworming', one[0]?.type)
  ok('against the right pet', one[0].petId === 'pet-1')
}

console.log('\nThe date can be corrected, which is what was actually wrong')
{
  const sugg = suggestionsFor('Dog', TODAY)
  const vax  = sugg.find(s => s.type === 'Vaccination')

  ok('the booster is dated a year out by default',
     vax.dueDate === '2027-10-12', vax.dueDate)
  ok('and it admits that assumes today',
     vax.assumesToday === true)

  // The customer's case: vaccinated in March, so the booster is due next March.
  const saved = remindersToSave(sugg, [vax.key], 'pet-1', { [vax.key]: '2027-03-04' })
  ok('an owner-supplied date wins', saved[0].dueDate === '2027-03-04', saved[0].dueDate)
  ok('and the rest of the reminder is unchanged',
     saved[0].frequency === 'Yearly' && saved[0].type === 'Annual vaccination booster', saved[0])

  // Only the ones that continue something already done claim this.
  const flea = sugg.find(s => s.type === 'Flea & Tick')
  ok('a fresh routine makes no such claim', flea.assumesToday === false)
  ok('every species that suggests a vaccination flags it',
     SUGGESTED_SPECIES.every(sp =>
       suggestionsFor(sp, TODAY).filter(s => s.type === 'Vaccination')
         .every(s => s.assumesToday)),
     SUGGESTED_SPECIES.filter(sp =>
       suggestionsFor(sp, TODAY).some(s => s.type === 'Vaccination' && !s.assumesToday)))
}

console.log('\nSwitching species does not move the ticks')
{
  // Selection used to be a Set of array INDEXES. Index 0 is the vaccination
  // booster for a dog and the wellness exam for a bird, so unticking
  // "vaccination" and then choosing Bird silently unticked something else.
  const dogVax = suggestionKey('Dog', 'Annual vaccination booster')
  const bird   = suggestionsFor('Bird', TODAY)
  const saved  = remindersToSave(bird, [dogVax], 'pet-1')
  ok('a tick made for a dog saves nothing for a bird', saved.length === 0, saved)

  ok('keys are unique within a species',
     new Set(suggestionsFor('Dog', TODAY).map(s => s.key)).size
       === suggestionsFor('Dog', TODAY).length)
  ok('and do not collide across species',
     suggestionKey('Dog', 'Deworming') !== suggestionKey('Cat', 'Deworming'))
}

console.log('\nEvery frequency offered is one the reminder job understands')
{
  // 'Every 2 months' was not in RECURRENCE, so grooming, rabbit nail trims and
  // reptile shedding checks fired once and silently never came round again.
  const bad = []
  for (const sp of SUGGESTED_SPECIES) {
    for (const s of suggestionsFor(sp, TODAY)) {
      if (s.frequency === 'Once') continue
      if (nextDueDate('2026-01-15', s.frequency, '2026-10-12') === null) {
        bad.push(`${sp}/${s.label}: ${s.frequency}`)
      }
    }
  }
  ok('no suggestion recurs on a frequency the job cannot step', bad.length === 0, bad)
  ok("'Every 2 months' specifically now recurs",
     nextDueDate('2026-01-15', 'Every 2 months', '2026-10-12') === '2026-11-15',
     nextDueDate('2026-01-15', 'Every 2 months', '2026-10-12'))
}

console.log('\nDates are worked out now, not when the module loaded')
{
  // These used to be baked into a module-level constant, so a PWA session left
  // open for days handed out dates counted from whenever it was launched.
  const a = suggestionsFor('Dog', '2026-10-12')
  const b = suggestionsFor('Dog', '2026-11-20')
  ok('a different day gives different dates',
     a[0].dueDate !== b[0].dueDate, [a[0].dueDate, b[0].dueDate])
  ok('each is a year from the day asked about',
     a[0].dueDate === '2027-10-12' && b[0].dueDate === '2027-11-20',
     [a[0].dueDate, b[0].dueDate])

  // The month-end case, matching how the reminder job steps months.
  const jan31 = suggestionsFor('Dog', '2026-01-31')
  const monthly = jan31.find(s => s.frequency === 'Monthly')
  ok('31 January plus a month clamps to 28 February, not 3 March',
     monthly.dueDate === '2026-02-28', monthly.dueDate)
}

console.log('\nEvery species produces something sane')
{
  for (const sp of SUGGESTED_SPECIES) {
    const list = suggestionsFor(sp, TODAY)
    const bad = list.filter(s =>
      !s.key || !s.label || !s.type || !s.frequency ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.dueDate) || s.dueDate <= TODAY)
    ok(`${sp}: ${list.length} suggestions, all complete and in the future`,
       list.length > 0 && bad.length === 0, bad)
  }
  ok('an unknown species falls back rather than returning nothing',
     suggestionsFor('Axolotl', TODAY).length > 0)
  ok('and the fallback is the generic list',
     suggestionsFor('Axolotl', TODAY).length === suggestionsFor('Other', TODAY).length)
}

console.log('\nWhat gets saved matches what storage expects')
{
  const sugg = suggestionsFor('Cat', TODAY)
  const all  = remindersToSave(sugg, sugg.map(s => s.key), 'pet-9')
  ok('every row has the fields saveReminder writes',
     all.every(r => r.petId && r.type && r.dueDate && r.frequency &&
                    r.isDone === false && r.email === '' && r.whatsapp === ''),
     all[0])
  // `type` carries the readable label on purpose: the reminders screen shows
  // reminder.type as the name.
  ok('the saved name is the descriptive label, not the category',
     all[0].type === 'Annual vaccination booster', all[0].type)
  ok('ticking everything saves everything', all.length === sugg.length)
  ok('an unknown key in the selection is ignored',
     remindersToSave(sugg, ['nonsense'], 'pet-9').length === 0)
}

console.log('\nEditing a suggested reminder must not rename it')
{
  // A reminder's `type` is its displayed NAME, and the ones offered here carry
  // a descriptive label. Those labels are deliberately NOT in the reminder
  // screen's own TYPES list, so a <select> restricted to TYPES would show the
  // first option instead and saving would rename "Annual vaccination booster"
  // to "Vaccination". This pins the coupling, because the fix is a two-line
  // ternary that looks like noise to anyone tidying up.
  const screen = readFileSync('src/components/Reminders.jsx', 'utf8')
  const TYPES = (screen.match(/const TYPES = \[([^\]]+)\]/)?.[1] || '')
    .split(',').map(t => t.trim().replace(/^'|'$/g, ''))

  const labels = [...new Set(
    SUGGESTED_SPECIES.flatMap(sp => suggestionsFor(sp, TODAY).map(s => s.label)))]
  const outsideVocab = labels.filter(l => !TYPES.includes(l))
  ok('the suggested names are outside the reminder screen vocabulary',
     outsideVocab.length === labels.length, { labels: labels.length, outsideVocab: outsideVocab.length })

  // The guard itself: the type select must consider the CURRENT value, not
  // just the fixed list.
  const select = screen.match(/<select value=\{form\.type\}[\s\S]{0,400}?<\/select>/)?.[0] || ''
  ok('the type dropdown keeps a value it does not list',
     /!TYPES\.includes\(form\.type\)/.test(select),
     select.replace(/\s+/g, ' ').slice(0, 160))

  // And the edit path must carry isDone, because saveReminder writes
  // `is_done: record.isDone || false` -- omitting it un-completes a reminder
  // that was already ticked off.
  ok('the edit form carries isDone so a done reminder stays done',
     /isDone:\s*!!r\.isDone/.test(screen))
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
