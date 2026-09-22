// scripts/test-recurrence.mjs
//
// Date arithmetic for recurring reminders. Run with: npm run test:recurrence
//
// This is here because the rollover is the one piece of the reminder job that
// is pure, easy to get subtly wrong, and impossible to notice when it is wrong:
// a reminder that rolls to the wrong date just fails to arrive, months later,
// with nothing in the logs. Month-end clamping and long-overdue reminders are
// the two cases that bite.

import { nextDueDate } from '../netlify/functions/morning-reminders.js'

const T = '2026-09-22'
let failed = 0

function check(due, freq, today, want) {
  let got
  try { got = nextDueDate(due, freq, today) }
  catch (e) { got = `THREW: ${e.message}` }
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${due} ${JSON.stringify(freq).padEnd(17)} -> ${got}` +
              (ok ? '' : `   (wanted ${want})`))
}

// Non-recurring, and anything we do not recognise, must not roll.
check('2026-09-22', 'Once',           T, null)
check('2026-09-22', '',               T, null)
check('2026-09-22', 'Every 5 moons',  T, null)

// The frequencies the app actually writes.
check('2026-09-22', 'Weekly',         T, '2026-09-29')
check('2026-09-22', 'Monthly',        T, '2026-10-22')
check('2026-09-22', 'Every 3 months', T, '2026-12-22')
check('2026-09-22', 'Yearly',         T, '2027-09-22')
check('2026-09-22', 'monthly',        T, '2026-10-22')   // case-insensitive

// Long overdue must land on the NEXT occurrence, never another date in the past.
check('2025-01-15', 'Monthly',        T, '2026-10-15')
check('2020-03-01', 'Yearly',         T, '2027-03-01')

// Month-end clamping: 31 Jan + 1 month is the end of February, not March.
check('2026-01-31', 'Monthly', '2026-01-31', '2026-02-28')
check('2028-01-31', 'Monthly', '2028-01-31', '2028-02-29')   // leap year
check('2028-02-29', 'Yearly',  '2028-02-29', '2029-02-28')   // leap day

// Malformed dates must return null rather than throwing or hanging. The year
// 20206 is not hypothetical — there is a row in the database with that date.
check('20206-09-01', 'Monthly', T, null)
check('not-a-date',  'Monthly', T, null)

// Whatever the frequency, a rolled date is always in the future. This is the
// property that actually matters: a rollover into the past would make the
// reminder fire again immediately, every morning, forever.
for (const freq of ['Daily', 'Weekly', 'Fortnightly', 'Monthly',
                    'Every 3 months', 'Every 6 months', 'Yearly']) {
  const got = nextDueDate('2019-07-13', freq, T)
  if (!(got > T)) {
    console.log(`FAIL  ${freq} rolled a 7-year-old reminder to ${got}, not past ${T}`)
    failed++
  } else {
    console.log(`ok    ${freq.padEnd(15)} 7 years overdue -> ${got}`)
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
