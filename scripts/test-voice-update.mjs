// What a spoken update turns into. Run: npm run test:voice-update
//
// The parse comes back from a language model, so the interesting cases are the
// ones where it gets something slightly wrong: a medicine with no name, a
// follow-up with no date, a weight as a string. None of those should reach a
// record a vet reads.

import { RECORD_KINDS, groupParsed, todayIST, VOCAB } from '../src/lib/voiceUpdateRecords.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}
const kind = k => RECORD_KINDS.find(x => x.key === k)
const PET = 'pet-1'

console.log('\nNothing is dropped now that every kind can be corrected')
{
  // This block used to assert that rows like these were thrown away. That was
  // right when they could not be fixed: an empty medicine was noise. Now every
  // kind is editable, so the same rows are OFFERED instead, exactly as a
  // dateless reminder is -- the AI heard that a medicine was mentioned, and
  // discarding that silently is worse than showing an empty row to complete.
  const g = groupParsed({
    medicines:    [{ name: '', dosage: 'one tablet' }],          // heard "some tablets"
    vaccinations: [{ name: '  ', dateGiven: '2026-09-28' }],
    allergies:    [{ allergen: '', severity: 'Mild' }],
    // (a dateless reminder is NOT here any more -- it is now offered for
    //  correction rather than dropped. See "Reminders can be corrected".)
    weights:      [{ weight: 0 }, { weight: 'nineteen' }],
    bills:        [{ date: '2026-09-28' }],                      // no amount, no clinic
    medical:      [{ type: '', title: '', description: '' }],
  })
  ok('all of them are offered rather than discarded', g.length === 6, g.map(x => x.kind.key))
  ok('and not one of them is savable as it stands',
     g.every(({ kind, rows }) => rows.every(r => !kind.usable(r))))
}

console.log('\nReminders can be corrected')
{
  const kind = RECORD_KINDS.find(k => k.key === 'reminders')

  // A reminder's whole purpose is its date, and a misheard date used to take
  // the entire reminder with it: the row failed `usable`, groupParsed dropped
  // it, and nothing was shown. Now it is offered so the date can be supplied.
  const g = groupParsed({ reminders: [{ type: 'Vet Checkup', dueDate: '', notes: 'come back soon' }] })
  ok('a dateless reminder is offered rather than silently dropped',
     g.length === 1 && g[0].rows.length === 1, g.map(x => x.kind.key))
  ok('but it is still not usable, so it cannot be saved as it stands',
     kind.usable(g[0].rows[0]) === false)
  ok('supplying a date makes it usable',
     kind.usable({ ...g[0].rows[0], dueDate: '2026-10-08' }) === true)

  ok('the fields offered are the text, date, repeat and note',
     kind.editable.map(f => f.field).join() === 'type,dueDate,frequency,notes',
     kind.editable?.map(f => f.field))
  ok('the date is marked required',
     kind.editable.find(f => f.field === 'dueDate')?.required === true)
  ok('the date uses a date input rather than free text',
     kind.editable.find(f => f.field === 'dueDate')?.type === 'date')

  // An edited row must reach the database as edited.
  const edited = { type: 'Dental scaling', dueDate: '2026-10-08', notes: 'recheck' }
  const payload = kind.payload(edited, 'pet-1')
  ok('an edited reminder saves what was typed, not what was heard',
     payload.type === 'Dental scaling' && payload.dueDate === '2026-10-08' && payload.notes === 'recheck',
     payload)

  // Only reminders are editable for now. Offering an unusable row for a kind
  // that cannot be corrected would just put noise on the screen.
}

console.log('\nEvery kind can be corrected')
{
  // Every record type is editable now, so an unusable row of ANY kind is shown
  // for fixing rather than dropped. The thing that must not happen is a field
  // being offered that the payload then ignores.
  for (const kind of RECORD_KINDS) {
    ok(`${kind.key}: has fields and a reason it can be invalid`,
       Array.isArray(kind.editable) && kind.editable.length > 0 && !!kind.needs,
       { fields: kind.editable?.length, needs: kind.needs })

    const fields = kind.editable.map(f => f.field)
    // Build a row from the editable fields alone and check each one survives
    // into the payload -- an input nobody saves is worse than no input.
    const row = Object.fromEntries(fields.map(f => [f, f === 'cost' || f === 'totalAmount' || f === 'weight' ? 5 : 'x']))
    const payload = kind.payload(row, 'pet-1')
    const lost = fields.filter(f => !(f in payload))
    ok(`${kind.key}: every editable field reaches the payload`, lost.length === 0, lost)

    const bad = kind.editable.filter(f => !['text', 'date', 'number', 'select'].includes(f.type))
    ok(`${kind.key}: field types are all renderable`, bad.length === 0, bad.map(f => f.type))

    const selectsWithoutOptions = kind.editable.filter(f => f.type === 'select' && !f.options?.length)
    ok(`${kind.key}: every dropdown has options`, selectsWithoutOptions.length === 0,
       selectsWithoutOptions.map(f => f.field))
  }
}

console.log('\nUnusable rows of every kind are now offered, not dropped')
{
  const g = groupParsed({
    medicines:    [{ name: '' }],
    vaccinations: [{ name: '  ' }],
    allergies:    [{ allergen: '' }],
    reminders:    [{ type: 'Vet Checkup', dueDate: '' }],
    weights:      [{ weight: 0 }],
    bills:        [{ date: '2026-09-28' }],
    medical:      [{ type: '', title: '', description: '' }],
  })
  ok('all seven are shown so they can be corrected', g.length === 7, g.map(x => x.kind.key))
  ok('and every one of them is still marked unusable',
     g.every(({ kind, rows }) => rows.every(r => !kind.usable(r))))
}

console.log('\nAllergy reactions survive editing')
{
  const kind = RECORD_KINDS.find(k => k.key === 'allergies')
  ok('a typed comma-separated line becomes several reactions',
     JSON.stringify(kind.payload({ allergen: 'chicken', reactions: 'itching, swelling' }, 'p').reactions)
       === JSON.stringify(['itching', 'swelling']))
  ok('a single typed reaction is still an array',
     JSON.stringify(kind.payload({ allergen: 'x', reactions: 'itching' }, 'p').reactions)
       === JSON.stringify(['itching']))
  ok('an array from the parse is left alone',
     JSON.stringify(kind.payload({ allergen: 'x', reactions: ['a', 'b'] }, 'p').reactions)
       === JSON.stringify(['a', 'b']))
  ok('empty reactions stay an empty array',
     JSON.stringify(kind.payload({ allergen: 'x' }, 'p').reactions) === JSON.stringify([]))
}

console.log('\nDropdown options match the rest of the app')
{
  // These lists are mirrored in voiceUpdateRecords.js because a lib must not
  // import from a component. Mirrored constants drift, so they are compared
  // here against the components they came from.
  const constIn = (file, name) => {
    const m = readFileSync(`src/components/${file}`, 'utf8')
      .match(new RegExp(`const ${name} *= *(\\[[^\\]]*\\])`))
    return m ? JSON.parse(m[1].replace(/'/g, '"')) : null
  }
  const pairs = [
    ['Allergies.jsx',      'SEVERITY',   VOCAB.ALLERGY_SEVERITY],
    ['Allergies.jsx',      'TYPES',      VOCAB.ALLERGY_TYPES],
    ['Medicines.jsx',      'CATEGORIES', VOCAB.MEDICINE_CATS],
    ['Reminders.jsx',      'TYPES',      VOCAB.REMINDER_TYPES],
    ['Reminders.jsx',      'FREQ',       VOCAB.REMINDER_FREQ],
    ['MedicalHistory.jsx', 'TYPES',      VOCAB.MEDICAL_TYPES],
  ]
  for (const [file, name, mine] of pairs) {
    const theirs = constIn(file, name)
    ok(`${file} ${name} still matches`,
       theirs && JSON.stringify(theirs) === JSON.stringify(mine), { theirs, mine })
  }
}

console.log('\nRows that must be kept')
{
  const g = groupParsed({
    medicines:    [{ name: 'Otibact', dosage: '3 drops' }],
    reminders:    [{ type: 'Vet Checkup', dueDate: '2026-10-08' }],
    weights:      [{ weight: 19.4 }],
    bills:        [{ totalAmount: 1800 }],
    medical:      [{ description: 'seemed off colour' }],        // description alone is enough
  })
  ok('five kinds survive', g.length === 5, g.map(x => x.kind.key))
  ok('order follows RECORD_KINDS',
     g.map(x => x.kind.key).join() === 'medical,medicines,weights,bills,reminders',
     g.map(x => x.kind.key))
}

console.log('\nIndexes address the row the user is looking at')
{
  // The tick-boxes are keyed by position in the list groupParsed returns, and
  // that same list is what save() walks. The two must be the same list in the
  // same order, or unticking row 1 would withhold row 0.
  //
  // This used to be guaranteed by filtering before the indexes were taken. Now
  // nothing is filtered for an editable kind, so it is guaranteed by the rows
  // being handed through untouched -- which is what this checks.
  const input = [{ name: '' }, { name: 'Otibact' }, { name: '' }, { name: 'Simparica' }]
  const g = groupParsed({ medicines: input })
  ok('every row is offered, in the order it arrived',
     g[0].rows.length === 4 && g[0].rows.map(r => r.name).join() === ',Otibact,,Simparica',
     g[0].rows.map(r => r.name))
  ok('position 1 is still Otibact, so key medicines-1 edits Otibact',
     g[0].rows[1].name === 'Otibact')
  ok('the savable ones are exactly the named ones',
     g[0].rows.map(r => g[0].kind.usable(r)).join() === 'false,true,false,true')
}

console.log('\nPayloads match what storage.js expects')
{
  const p = kind('medical').payload(
    { date: '2026-09-28', type: 'Illness', title: 'Ear infection', vet: 'Dr Sharma', cost: 1800 }, PET)
  ok('medical keeps petId and cost', p.petId === PET && p.cost === 1800, p)

  const noCost = kind('medical').payload({ title: 'Checkup' }, PET)
  ok('missing cost becomes empty, never null', noCost.cost === '', noCost)
  ok('missing type falls back to Other', noCost.type === 'Other', noCost)

  const one = kind('allergies').payload({ allergen: 'Beef', reactions: 'itching' }, PET)
  ok('a single reaction is still an array', Array.isArray(one.reactions) && one.reactions[0] === 'itching', one)

  const none = kind('allergies').payload({ allergen: 'Beef' }, PET)
  ok('no reactions is an empty array', Array.isArray(none.reactions) && none.reactions.length === 0, none)

  const w = kind('weights').payload({ weight: 19.4 }, PET)
  ok('a dateless weight takes today, not undefined', w.date === todayIST(), w)
  ok('that date parses', !Number.isNaN(new Date(w.date).getTime()), w.date)

  const wd = kind('weights').payload({ weight: 19.4, date: '2026-09-01' }, PET)
  ok('a given weight date is kept', wd.date === '2026-09-01', wd)

  const b = kind('bills').payload({ totalAmount: 1800, clinic: 'Happy Paws' }, PET)
  ok('bill is INR with an empty line-item array',
     b.currency === 'INR' && Array.isArray(b.lineItems) && b.lineItems.length === 0, b)

  const r = kind('reminders').payload({ dueDate: '2026-10-08' }, PET)
  ok('reminder defaults to Once and sends to nobody',
     r.frequency === 'Once' && r.email === '' && r.whatsapp === '', r)
}

console.log('\nIST date boundary')
{
  // 19:00 UTC on the 28th is 00:30 on the 29th in India. A weight logged then
  // must not be dated yesterday.
  const utcEvening = Date.parse('2026-09-28T19:00:00Z')
  ok('after 18:30 UTC the date has already rolled over',
     todayIST(utcEvening) === '2026-09-29', todayIST(utcEvening))
  const utcMorning = Date.parse('2026-09-28T06:00:00Z')
  ok('before that it has not', todayIST(utcMorning) === '2026-09-28', todayIST(utcMorning))
}

console.log('\nEvery kind has a storage function and a look-up key')
{
  const savers = ['saveMedicalRecord','saveVaccination','saveMedicine','saveAllergy',
                  'saveWeightLog','saveBill','saveReminder']
  ok('all savers are real names', RECORD_KINDS.every(k => savers.includes(k.saver)),
     RECORD_KINDS.map(k => k.saver))
  ok('every kind labels a row without throwing',
     RECORD_KINDS.every(k => typeof k.title({ weight: 1 }) === 'string'
                          || k.title({ weight: 1 }) === undefined), null)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
