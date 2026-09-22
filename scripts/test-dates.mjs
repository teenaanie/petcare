// scripts/test-dates.mjs
//
//   npm run test:dates
//
// An Invalid Date is the dangerous kind of bad value: `new Date(undefined)`
// does not throw, and the result passes `instanceof Date`, so it travels
// through the app looking like a date and only fails at the very end, inside
// date-fns `format()`, as `RangeError: Invalid time value`. With no error
// boundary above it, that unmounts the whole pet screen.
//
// That is not theoretical — it happened: a record with no date of its own fell
// back to `createdAt`, and localStorage edits were dropping `createdAt`, so one
// edited allergy blanked the timeline.

import { firstValidDate, isRealDate } from '../src/lib/dates.js'

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const iso = d => (d ? d.toISOString().slice(0, 10) : null)

// The absences that produce an Invalid Date.
check('undefined -> null',      firstValidDate(undefined) === null)
check('null -> null',           firstValidDate(null) === null)
check('empty string -> null',   firstValidDate('') === null)
check('gibberish -> null',      firstValidDate('not-a-date') === null)
check('impossible date -> null', firstValidDate('2026-13-45') === null)
check('nothing at all -> null', firstValidDate() === null)

// Real values still come through.
check('a date string',   iso(firstValidDate('2026-03-12')) === '2026-03-12')
check('a Date object',   iso(firstValidDate(new Date('2026-03-12'))) === '2026-03-12')
check('an ISO datetime', iso(firstValidDate('2026-03-12T09:30:00.000Z')) === '2026-03-12')

// The fallback chain: the real reason this exists. A record with no date of
// its own should fall back to createdAt, and to nothing if that is gone too.
check('falls through a missing first choice',
      iso(firstValidDate(null, '2026-06-04')) === '2026-06-04')
check('takes the first valid one, not the last',
      iso(firstValidDate('2026-01-01', '2026-06-04')) === '2026-01-01')
check('no date AND no createdAt is null, never an Invalid Date',
      firstValidDate(undefined, undefined) === null)

// A five-digit year is VALID in V8 — the year 20206 really is representable.
// Worth pinning: it is a display oddity, not a crash, and there is a row in the
// production database with exactly this date.
const big = firstValidDate('20206-03-12')
check('five-digit year is valid, not a crash', big !== null && isRealDate(big),
      big ? `parsed as year ${big.getUTCFullYear()}` : 'null')

// isRealDate is what render sites check before formatting.
check('isRealDate: a real date',      isRealDate(new Date('2026-03-12')) === true)
check('isRealDate: an Invalid Date',  isRealDate(new Date(undefined)) === false)
check('isRealDate: null',             isRealDate(null) === false)
check('isRealDate: a string',         isRealDate('2026-03-12') === false)

// The property that actually matters: nothing this returns can ever throw in
// a formatter.
for (const input of [undefined, null, '', 'nope', '2026-13-45', NaN, {}, [], 0]) {
  const d = firstValidDate(input)
  if (d !== null && !isRealDate(d)) {
    check(`firstValidDate(${JSON.stringify(input)}) returned an unformattable value`, false)
  }
}
check('no input produces an unformattable Date', true)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
