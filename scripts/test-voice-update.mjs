// What a spoken update turns into. Run: npm run test:voice-update
//
// The parse comes back from a language model, so the interesting cases are the
// ones where it gets something slightly wrong: a medicine with no name, a
// follow-up with no date, a weight as a string. None of those should reach a
// record a vet reads.

import { RECORD_KINDS, groupParsed, todayIST } from '../src/lib/voiceUpdateRecords.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}
const kind = k => RECORD_KINDS.find(x => x.key === k)
const PET = 'pet-1'

console.log('\nRows that must be dropped')
{
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
  ok('nothing survives', g.length === 0, g.map(x => x.kind.key))
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

  ok('the fields offered are the text, the date and the note',
     kind.editable.map(f => f.field).join() === 'type,dueDate,notes',
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
  const others = RECORD_KINDS.filter(k => k.key !== 'reminders' && k.editable)
  ok('no other kind claims to be editable yet', others.length === 0, others.map(k => k.key))
  ok('an unusable row of a non-editable kind is still dropped',
     groupParsed({ medicines: [{ name: '' }] }).length === 0)
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

console.log('\nIndexes line up after filtering')
{
  // The tick-boxes are keyed by position in the FILTERED list. If groupParsed
  // ever returned unfiltered rows, unticking row 1 would delete row 0's data.
  const g = groupParsed({ medicines: [
    { name: '' }, { name: 'Otibact' }, { name: '' }, { name: 'Simparica' },
  ] })
  ok('two kept, in order',
     g[0].rows.length === 2 && g[0].rows[0].name === 'Otibact' && g[0].rows[1].name === 'Simparica',
     g[0].rows)
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
