// Which weight a screen shows, and when it admits it does not know.
// Run: npm run test:current-weight
//
// A customer noticed her cat's card said 1.7 kg while the chart said 2.6 kg.
// Pippy stores a pet's weight twice: `pets.weight`, typed into the profile
// form with no date, and `weight_logs`, dated readings. Nothing kept them in
// step, and on the live database NINE of the eleven pets with readings
// disagreed with their profile figure.
//
// The obvious fix -- "the latest reading wins", as a trigger or a backfill --
// is the one these tests exist to prevent. Two live rows killed it:
//
//   Hunter, a Labrador : profile 40 kg, latest reading 3.8 kg (24 Sep)
//   Poppy              : profile 6 kg,  latest reading 5 kg (6 Aug 2024)
//
// Hunter's reading looks like 38 typed as 3.8, and propagating it would print
// 3.8 kg on the emergency card a vet reads to work out a dose. Poppy's reading
// is real but two years old, so the profile is probably the better number.
// Wrong in both cases, in opposite directions. So nothing is overwritten: the
// dated reading is preferred for display, its date travels with it, and a
// material disagreement is surfaced for a person to settle.

import {
  currentWeight, weightConflict, formatWeight, describeWeight,
} from '../src/lib/currentWeight.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

console.log('\nThe reported bug')
{
  // Mapple, exactly as the live row reads.
  const mapple = { name: 'Mapple', weight: 1.7, latestWeight: 2.6, latestWeightOn: '2026-09-28' }
  ok('the card shows the measured weight, not the profile figure',
     formatWeight(mapple) === '2.6 kg', formatWeight(mapple))
  ok('and it knows the figure was measured', currentWeight(mapple).measured === true)
  ok('the date travels with it', currentWeight(mapple).on === '2026-09-28')
}

console.log('\nNo readings: the profile figure, admitted as such')
{
  const p = { name: 'Dory', weight: 25 }
  ok('it is still shown rather than hidden', formatWeight(p) === '25 kg', formatWeight(p))
  ok('but it is not claimed as a measurement', currentWeight(p).measured === false)
  ok('and there is no date to pretend about', currentWeight(p).on === null)
  // The emergency card has room to say where a number came from.
  ok('a vet is told it was not measured',
     /not measured/.test(describeWeight(p)), describeWeight(p))
}

console.log('\nNothing known at all')
{
  ok('no weight anywhere gives null, not 0 or NaN',
     currentWeight({}).kg === null && formatWeight({}) === null && describeWeight({}) === null)
  ok('a null weight is not treated as a reading', currentWeight({ weight: null }).kg === null)
  ok('a zero weight is rejected rather than shown as 0 kg',
     currentWeight({ weight: 0 }).kg === null, currentWeight({ weight: 0 }))
  ok('a negative weight is rejected', currentWeight({ latestWeight: -3 }).kg === null)
  ok('a non-numeric weight is rejected', currentWeight({ weight: 'heavy' }).kg === null)
  ok('a numeric STRING is accepted, because Postgres returns numerics as strings',
     currentWeight({ latestWeight: '2.6' }).kg === 2.6, currentWeight({ latestWeight: '2.6' }))
}

console.log('\nThe two rows that ruled out automatic reconciliation')
{
  // If either of these ever stops being reported as a conflict, the next
  // person will "simplify" this into a trigger.
  const hunter = { name: 'Hunter', breed: 'Labrador', weight: 40,
                   latestWeight: 3.8, latestWeightOn: '2026-09-24' }
  const c1 = weightConflict(hunter)
  ok('a Labrador at 40 kg vs a 3.8 kg reading is a conflict', !!c1)
  ok('both figures are reported so a human can judge',
     c1.profile === 40 && c1.measured === 3.8, c1)
  ok('the emergency card states the disagreement rather than choosing',
     /profile/.test(describeWeight(hunter)) === false, describeWeight(hunter))

  const poppy = { name: 'Poppy', weight: 6, latestWeight: 5, latestWeightOn: '2024-08-06' }
  const c2 = weightConflict(poppy)
  ok('a two-year-old reading 1 kg below the profile is a conflict', !!c2)
  ok('its age is visible, so it can be discounted',
     describeWeight(poppy).includes('2024-08-06'), describeWeight(poppy))
}

console.log('\nNormal fluctuation is not a conflict')
{
  // Relative, not absolute: 0.2 kg is nothing on a 40 kg dog and a tenth of a
  // kitten. These are real live rows.
  ok('Zorro, 5 kg profile vs 5.2 measured, is not flagged',
     weightConflict({ weight: 5, latestWeight: 5.2 }) === null)
  ok('Pino, 19.5 vs 17.8, is not flagged (8.7%)',
     weightConflict({ weight: 19.5, latestWeight: 17.8 }) === null,
     weightConflict({ weight: 19.5, latestWeight: 17.8 }))
  ok('Mapple, 1.7 vs 2.6, IS flagged (35%)',
     !!weightConflict({ weight: 1.7, latestWeight: 2.6 }))
  ok('Pebble, 1 vs 2.3, IS flagged',
     !!weightConflict({ weight: 1, latestWeight: 2.3 }))

  // The same absolute gap, judged differently by size. This is the point of
  // using a fraction.
  ok('0.3 kg on a kitten is a conflict',
     !!weightConflict({ weight: 1, latestWeight: 1.3 }))
  ok('0.3 kg on a big dog is not',
     weightConflict({ weight: 30, latestWeight: 30.3 }) === null)
}

console.log('\nA conflict needs two numbers')
{
  ok('no profile figure is not a conflict',
     weightConflict({ latestWeight: 2.6 }) === null)
  ok('no reading is not a conflict',
     weightConflict({ weight: 2.6 }) === null)
  ok('neither is not a conflict', weightConflict({}) === null)
  ok('agreement is not a conflict',
     weightConflict({ weight: 2.7, latestWeight: 2.7 }) === null)
  ok('junk does not throw',
     (() => { try { weightConflict(null); weightConflict(undefined); currentWeight(null); return true }
              catch { return false } })())
}

console.log('\nFormatting does not invent precision')
{
  ok('a whole number does not read as 5.00 kg',
     formatWeight({ latestWeight: 5 }) === '5 kg', formatWeight({ latestWeight: 5 }))
  ok('a trailing zero is trimmed',
     formatWeight({ latestWeight: 2.50 }) === '2.5 kg', formatWeight({ latestWeight: 2.5 }))
  ok('a long decimal is rounded, not printed in full',
     formatWeight({ latestWeight: 2.666666 }) === '2.67 kg', formatWeight({ latestWeight: 2.666666 }))
  ok('a measured weight reads with its date',
     describeWeight({ latestWeight: 17.8, latestWeightOn: '2026-10-05' })
       === '17.8 kg (measured 2026-10-05)',
     describeWeight({ latestWeight: 17.8, latestWeightOn: '2026-10-05' }))
  ok('a reading with no date still reads sensibly',
     describeWeight({ latestWeight: 17.8 }) === '17.8 kg',
     describeWeight({ latestWeight: 17.8 }))
}

console.log('\nAn un-enriched pet degrades to the old behaviour')
{
  // savePet() returns a bare row with no latestWeight, and PetDetail sets its
  // pet from that after an edit. Showing nothing there would be a regression.
  const bare = { id: 'p1', name: 'Tutu', weight: 4 }
  ok('it still shows a weight', formatWeight(bare) === '4 kg')
  ok('and does not claim it was measured', currentWeight(bare).measured === false)
  ok('and reports no conflict it cannot know about', weightConflict(bare) === null)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
