// What the book adds up to — the pure arithmetic. Run: npm run test:stats
//
// These are the numbers a provider will quote at somebody, so the ones pinned
// hardest are the ones that are flattering when wrong:
//
//   · a cancelled stay must never count as business done
//   · "nights" means sleeps, not dates touched — in 14th out 18th is FOUR
//   · the busiest day is not the number of stays that month
//   · a month with nothing in it still has a row, or the chart draws a straight
//     line through the gap and calls it steady business
//   · a total of amounts says how many rows it could see a price for

import {
  nightsIn, customerStats, monthsBack, peakDay, bookYear, rupees, isLost,
} from '../src/lib/providerStats.js'
import { bookWords } from '../src/lib/providerTypes.js'

let failed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const TODAY = '2026-10-08'
const A = (o) => ({ customerId: 'c1', kind: 'Boarding', status: 'completed', ...o })

// ── Nights ──────────────────────────────────────────────────────────────────
check('in 14th, out 18th is four nights', nightsIn({ startsOn: '2026-09-14', endsOn: '2026-09-18' }), 4)
check('one night',                        nightsIn({ startsOn: '2026-09-14', endsOn: '2026-09-15' }), 1)
check('same day is none',                 nightsIn({ startsOn: '2026-09-14', endsOn: '2026-09-14' }), 0)
check('open ended is none',               nightsIn({ startsOn: '2026-09-14', endsOn: null }), 0)
check('backwards is none, not negative',  nightsIn({ startsOn: '2026-09-18', endsOn: '2026-09-14' }), 0)

check('a cancellation is lost',  isLost({ status: 'cancelled' }), true)
check('so is a no-show',         isLost({ status: 'no_show' }), true)
check('a completed stay is not', isLost({ status: 'completed' }), false)

// ── One customer ────────────────────────────────────────────────────────────
const HISTORY = [
  A({ startsOn: '2026-09-01', endsOn: '2026-09-05', amount: '4500' }),   // 4 nights
  A({ startsOn: '2026-06-10', endsOn: '2026-06-12' }),                   // 2 nights, unpriced
  A({ startsOn: '2026-07-04', endsOn: null, kind: 'Grooming' }),         // a visit, no nights
  A({ startsOn: '2026-10-01', endsOn: '2026-10-03', status: 'cancelled' }),
  A({ startsOn: '2026-08-02', endsOn: '2026-08-03', status: 'no_show' }),
  A({ startsOn: '2024-05-01', endsOn: '2024-05-08' }),                   // older than the window
]
const cs = customerStats(HISTORY, TODAY)

check('visits in the last year',        cs.visits, 3)
check('and all time',                   cs.visitsAllTime, 4)
check('nights in the last year',        cs.nights, 6)
// Averaged over the stays that HAVE nights: a groom must not drag it to 2.
check('average stay, grooms excluded',  cs.avgNights, 3)
check('split by what they came for',    cs.byKind, [['Boarding', 2], ['Grooming', 1]])
check('a cancellation is counted apart', [cs.cancelled, cs.noShows], [1, 1])
check('and is NOT business done',       cs.visits, 3)
check('first seen is the oldest',       cs.first, '2024-05-01')
// The newest stay they actually TOOK. The October row is cancelled, and
// "last seen 1 Oct" about a customer who cancelled would be a lie a provider
// would repeat out loud.
check('last seen skips the cancellation', cs.last, '2026-09-01')
check('money says what it could see',   cs.money, { total: 4500, priced: 1, of: 3 })

// A customer with nothing must not throw, and must not report NaN.
const empty = customerStats([], TODAY)
check('an empty history is zeroes',
      [empty.visits, empty.nights, empty.avgNights, empty.first, empty.money.total],
      [0, 0, 0, null, 0])

// ── Months ──────────────────────────────────────────────────────────────────
const months = monthsBack(HISTORY, TODAY, 12)
check('twelve rows, quiet ones included', months.length, 12)
check('oldest first, newest last',        [months[0].key, months[11].key], ['2025-11', '2026-10'])
check('September carries its stay',       months.find(m => m.key === '2026-09').nights, 4)
check('a quiet month is zero, not absent', months.find(m => m.key === '2026-05').visits, 0)
check('the cancelled October stay is out', months.find(m => m.key === '2026-10').visits, 0)
check('and out of the money too',          months.find(m => m.key === '2026-10').amount, 0)

// ── The busiest day ─────────────────────────────────────────────────────────
//
// Three stays over one month, overlapping on the 3rd. The answer is 3 animals
// on one day, which is NOT the same as the 3 stays in the month.
const OVERLAP = [
  A({ startsOn: '2026-10-01', endsOn: '2026-10-04' }),
  A({ startsOn: '2026-10-02', endsOn: '2026-10-05' }),
  A({ startsOn: '2026-10-03', endsOn: '2026-10-04' }),
  A({ startsOn: '2026-10-03', endsOn: '2026-10-06', status: 'cancelled' }),
]
check('the busiest day counts animals, not stays', peakDay(OVERLAP, '2026-10'), { on: '2026-10-03', count: 3 })
// Checkout morning is not another day of care: a stay in on the 1st and out on
// the 2nd occupies the 1st alone.
check('checkout morning is not a day of care',
      peakDay([A({ startsOn: '2026-10-01', endsOn: '2026-10-02' })], '2026-10'), { on: '2026-10-01', count: 1 })
check('a day visit still occupies its day',
      peakDay([A({ startsOn: '2026-10-07', endsOn: null })], '2026-10'), { on: '2026-10-07', count: 1 })

// ── The dashboard's year ────────────────────────────────────────────────────
const BOOK = {
  customers: [
    { id: 'c1', createdAt: '2026-10-02T00:00:00Z' },
    { id: 'c2', createdAt: '2025-01-02T00:00:00Z' },
    { id: 'c3', createdAt: '2026-10-07T00:00:00Z' },
  ],
  appointments: [
    A({ customerId: 'c1', startsOn: '2026-10-01', endsOn: '2026-10-04', amount: '3000' }),
    A({ customerId: 'c1', startsOn: '2026-09-01', endsOn: '2026-09-03' }),
    A({ customerId: 'c2', startsOn: '2026-10-02', endsOn: '2026-10-03' }),
    A({ customerId: 'c2', startsOn: '2026-02-02', endsOn: '2026-02-09', status: 'cancelled' }),
  ],
}
const y = bookYear(BOOK, TODAY)
check('this month counts its stays',   y.thisMonth.visits, 2)
check('and its nights',                y.thisMonth.nights, 4)
check('and its busiest day',           y.thisMonth.peak.count, 2)
check('the year totals the months',    [y.year.visits, y.year.nights], [3, 6])
check('money carries its denominator', [y.year.amount, y.year.priced], [3000, 1])
check('who came back',                 [y.returning, y.booked], [1, 2])
// c3 was typed in this month and has never been booked: new, and not counted
// as a lost customer by `booked`.
check('new customers this month',      y.newThisMonth, 2)
check('the busiest month is named',    y.busiest.key, '2026-10')

// ── Money, written the way it is read here ──────────────────────────────────
check('indian grouping', rupees(123456), '₹1,23,456')
check('rounds to rupees', rupees(4500.4), '₹4,500')
check('nothing is not blank', rupees(0), '₹0')

// ── The vocabularies ────────────────────────────────────────────────────────
//
// A vet asked about boarding criteria would reasonably decide the app was not
// built for them.
check('a boarder has the trial gate',  bookWords('Boarder').flags, true)
check('a vet does not',                bookWords('Vet').flags, false)
check('a shop does not',               bookWords('Store').flags, false)
check('a boarder counts nights',       bookWords('Boarder').counts, 'nights')
check('a vet counts visits',           bookWords('Vet').counts, 'visits')
check('a shop counts purchases',       bookWords('Store').counts, 'purchases')
check('a vet records a visit',         bookWords('Vet').addLabel, 'Record a visit')
check('a shop records a purchase',     bookWords('Store').addLabel, 'Record a purchase')
check('a vet logs what was given',     bookWords('Vet').logTitle, 'Given on the day')
check('a shop logs what was bought',   bookWords('Store').logTitle, 'What was bought')
// An unknown type must not inherit the kennel's questions.
check('an unknown type is generic',    bookWords('Something Else').flags, false)
check('and so is a missing one',       bookWords(undefined).entry, 'visit')

console.log(failed ? `\n${failed} FAILED` : '\nthe arithmetic holds')
process.exit(failed ? 1 : 0)
