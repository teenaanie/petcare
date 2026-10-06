// What the AI brief is actually told about weight. Run: npm run test:health-prompt
//
// A customer reported the brief saying Mapple's weight had "reduced from 2.6
// to 1.7" when it had in fact gone UP from 1.6 to 2.6. The model was not
// hallucinating. It was handed two weights with no way to tell which was
// current:
//
//   Recorded weight: 1.7 kg          <- pets.weight, typed in months earlier
//   WEIGHT READINGS:
//     • 2026-09-28: 2.6 kg           <- the real current weight
//
// The undated one reads as current because it is stated first. Five of the
// seven pets with weight logs have a profile weight that disagrees with their
// latest reading, so this was not a one-off.

import { healthSummaryPrompt } from '../api/_lib/ai-complete.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

const MAPPLE = { name: 'Mapple', species: 'Cat', breed: 'Indie', weight: 1.7 }

console.log('\nThe reported bug')
{
  const p = healthSummaryPrompt({
    pet: MAPPLE,
    data: { weightLogs: [{ date: '2026-08-06', weight: 1.6 }, { date: '2026-09-28', weight: 2.6 }] },
    periodLabel: '90 days',
  })
  ok('the stale profile weight is not shown at all when readings exist',
     !p.includes('1.7'), p.split('\n').filter(l => l.includes('1.7')))
  ok('the current weight is named explicitly',
     p.includes('Current weight is 2.6 kg'), p.match(/Current weight[^\n]*/)?.[0])
  ok('the direction is stated as UP, not left to be inferred',
     p.includes('gone UP'), p.match(/gone \w+[^\n]*/)?.[0])
  ok('the size of the change is given', p.includes('1.00 kg'))
}

console.log('\nOne reading is not a trend')
{
  const p = healthSummaryPrompt({
    pet: MAPPLE, data: { weightLogs: [{ date: '2026-09-28', weight: 2.6 }] }, periodLabel: '30 days',
  })
  ok('still refuses to show the stale profile weight', !p.includes('1.7'))
  ok('says outright that no trend can be stated',
     p.includes('no trend can be stated'), p.match(/no trend[^\n]*/)?.[0])
  ok('the single reading is still named as current', p.includes('Current weight is 2.6 kg'))
}

console.log('\nNo readings at all')
{
  const p = healthSummaryPrompt({ pet: MAPPLE, data: {}, periodLabel: '30 days' })
  // With nothing better, the profile weight is the only figure there is -- but
  // it is labelled so the model does not treat it as a measurement.
  ok('the profile weight IS shown when there is nothing else', p.includes('1.7 kg'))
  ok('and it is labelled as possibly out of date',
     /may be out of date/.test(p), p.match(/.*1\.7 kg.*/)?.[0])
  ok('no weight readings section is invented', !p.includes('WEIGHT READINGS'))
}

console.log('\nOrder is enforced, not trusted')
{
  // The caller sorts ascending today, but a prompt that only reads correctly
  // when its input happens to be sorted is one refactor away from lying again.
  const p = healthSummaryPrompt({
    pet: { name: 'X' },
    data: { weightLogs: [
      { date: '2026-09-28', weight: 2.6 },
      { date: '2026-08-06', weight: 1.6 },
      { date: '2026-07-01', weight: 1.2 },
    ] },
  })
  const body = p.split('WEIGHT READINGS')[1]
  ok('readings are re-sorted oldest first',
     body.indexOf('2026-07-01') < body.indexOf('2026-08-06') &&
     body.indexOf('2026-08-06') < body.indexOf('2026-09-28'))
  ok('direction is computed from the sorted ends, not the given order',
     p.includes('gone UP') && p.includes('1.2 kg on 2026-07-01'), p.match(/gone \w+[^\n]*/)?.[0])
}

console.log('\nA genuine fall still reads as a fall')
{
  const p = healthSummaryPrompt({
    pet: { name: 'Poppy', weight: 6 },
    data: { weightLogs: [{ date: '2026-01-01', weight: 6 }, { date: '2026-09-01', weight: 5 }] },
  })
  ok('a real decrease is reported as DOWN', p.includes('gone DOWN'), p.match(/gone \w+[^\n]*/)?.[0])
  ok('the decrease size is right', p.includes('1.00 kg'))
}

console.log('\nAwkward input does not break it')
{
  const p = healthSummaryPrompt({
    pet: { name: 'X' },
    data: { weightLogs: [
      { date: '2026-01-01', weight: 3 }, { date: null, weight: 9 },
      { weight: null, date: '2026-02-01' }, { date: '2026-03-01', weight: 3 },
    ] },
  })
  ok('rows with no date or no weight are dropped',
     !p.includes('9 kg'), p.match(/•[^\n]*/g))
  ok('an unchanged weight is not called a rise or a fall',
     p.includes('UNCHANGED'), p.match(/gone \w+[^\n]*/)?.[0])
  ok('empty data does not throw',
     typeof healthSummaryPrompt({ pet: {}, data: { weightLogs: [] } }) === 'string')
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
