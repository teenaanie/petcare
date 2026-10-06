// Thresholds, alert rules and the weekly rollup. Run: npm run test:usage-limits

import { THRESHOLDS, breaches, shouldEmail, pctOf, byWeek, MB } from '../src/lib/usageLimits.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

// Roughly what Pippy actually looks like today, so the quiet case is the real one.
const CALM = { openai_cost_mtd_usd: 0.0048, db_bytes: 16 * MB, storage_bytes: 0 }

console.log('\nBreaches')
{
  ok('nothing fires at current usage', breaches(CALM).length === 0, breaches(CALM))

  const b = breaches({ ...CALM, openai_cost_mtd_usd: 9 })
  ok('spend over $5 fires', b.length === 1 && b[0].key === 'openai_cost_mtd_usd', b)
  ok('the message names value and limit',
     b[0].text.includes('$9.0000') && b[0].text.includes('$5.0000'), b[0].text)

  ok('several at once are all reported',
     breaches({ openai_cost_mtd_usd: 9, db_bytes: 400 * MB, storage_bytes: 900 * MB }).length === 3)

  // Exactly at the limit is not over it. Without this, a threshold set to a
  // round number would alert on the day it is merely reached.
  ok('exactly at the limit does not fire',
     breaches({ ...CALM, db_bytes: 250 * MB }).length === 0)
  ok('one byte over does fire',
     breaches({ ...CALM, db_bytes: 250 * MB + 1 }).length === 1)

  // The job must never crash on a metrics row that came back short.
  ok('missing metrics are treated as zero, not as a crash', breaches({}).length === 0)
  ok('null metrics do not throw', breaches(null).length === 0)
}

console.log('\nWhen to email')
{
  const mon = new Date('2026-10-05T02:00:00Z')  // Monday
  const tue = new Date('2026-10-06T02:00:00Z')
  const sun = new Date('2026-10-11T02:00:00Z')

  ok('weekly summary goes out on Monday', shouldEmail([], mon) === true)
  ok('an ordinary day sends nothing', shouldEmail([], tue) === false)
  ok('Sunday sends nothing', shouldEmail([], sun) === false)
  ok('a breach sends on any day', shouldEmail([{ text: 'over' }], tue) === true)
  ok('the weekly day is configurable', shouldEmail([], tue, 2) === true)
}

console.log('\nPercentages')
{
  ok('16 MB is 6.4% of the 250 MB threshold', pctOf('db_bytes', 16 * MB) === 6.4, pctOf('db_bytes', 16 * MB))
  ok('zero is 0%', pctOf('db_bytes', 0) === 0)
  // Capped so a bar cannot render past its track when something is far over.
  ok('far over the limit caps at 100%', pctOf('db_bytes', 5000 * MB) === 100)
  ok('an unknown key is 0 rather than NaN', pctOf('nope', 5) === 0)
  ok('undefined value is 0 rather than NaN', pctOf('db_bytes', undefined) === 0)
}

console.log('\nFormatting')
{
  ok('spend shows four decimals', THRESHOLDS.openai_cost_mtd_usd.fmt(0.0048) === '$0.0048')
  ok('sizes show one decimal in MB', THRESHOLDS.db_bytes.fmt(16 * MB) === '16.0 MB')
  ok('null formats as zero, not NaN', THRESHOLDS.db_bytes.fmt(null) === '0.0 MB')
}

console.log('\nWeekly rollup')
{
  const snaps = [
    { day: '2026-09-28', db_bytes: 1 },  // Monday
    { day: '2026-09-30', db_bytes: 2 },  // same week, later
    { day: '2026-10-05', db_bytes: 3 },  // next Monday
  ]
  const w = byWeek(snaps)
  ok('days collapse into their weeks', w.length === 2, w.map(x => x.weekStart))
  ok('newest week comes first', w[0].weekStart === '2026-10-05', w[0].weekStart)

  // These are running totals and current sizes, so a week's figure is its last
  // reading. Summing the days would invent usage that never happened.
  ok('a week keeps its LAST reading, not the sum', w[1].db_bytes === 2, w[1].db_bytes)

  ok('weeks start on Monday',
     byWeek([{ day: '2026-10-04', db_bytes: 9 }])[0].weekStart === '2026-09-28',
     byWeek([{ day: '2026-10-04', db_bytes: 9 }])[0].weekStart)

  ok('an unparseable day is skipped rather than crashing',
     byWeek([{ day: 'not-a-date', db_bytes: 1 }, { day: '2026-10-05', db_bytes: 3 }]).length === 1)
  ok('no snapshots gives an empty list', byWeek([]).length === 0)
  ok('undefined input does not throw', byWeek().length === 0)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
