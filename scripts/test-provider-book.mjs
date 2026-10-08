// The provider's own book — the pure logic. Run with: npm run test:book
//
// The grouping is what turns a list of bookings into a diary, and it has one
// rule that is easy to get wrong in the comfortable direction: a cancelled
// booking must not sit in "coming up", or a quiet week reads as a busy one and
// the provider plans staff around animals that are not arriving.

import { groupAppointments, bookSummary, APPOINTMENT_KINDS, APPOINTMENT_STATUS } from '../src/lib/providerBook.js'

let failed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const TODAY = '2026-11-10'
const A = (id, startsOn, endsOn, status = 'booked') => ({ id, startsOn, endsOn, status })

const BOOKINGS = [
  A('future',      '2026-11-20', '2026-11-25'),
  A('sooner',      '2026-11-12', '2026-11-14'),
  A('here-now',    '2026-11-05', '2026-11-15'),
  A('starts-today', TODAY,       '2026-11-15'),
  A('ends-today',  '2026-11-01', TODAY),
  A('day-only',    TODAY,         null),
  A('gone',        '2026-10-01', '2026-10-05'),
  A('cancelled',   '2026-11-20', '2026-11-25', 'cancelled'),
  A('no-show',     '2026-11-21', '2026-11-22', 'no_show'),
]
const g = groupAppointments(BOOKINGS, TODAY)

check('a stay spanning today is current',   g.current.map(a => a.id).includes('here-now'), true)
check('one starting today is current',      g.current.map(a => a.id).includes('starts-today'), true)
check('one ending today is still current',  g.current.map(a => a.id).includes('ends-today'), true)
check('a single-day booking today is current', g.current.map(a => a.id).includes('day-only'), true)
check('upcoming reads forwards',            g.upcoming.map(a => a.id), ['sooner', 'future'])
check('a finished stay is past',            g.past.map(a => a.id).includes('gone'), true)

// The one that matters.
check('a cancelled booking is NOT upcoming', g.upcoming.map(a => a.id).includes('cancelled'), false)
check('nor is a no-show',                    g.upcoming.map(a => a.id).includes('no-show'), false)
check('both are filed as past',
      g.past.map(a => a.id).includes('cancelled') && g.past.map(a => a.id).includes('no-show'), true)

check('every booking lands in exactly one bucket',
      g.current.length + g.upcoming.length + g.past.length, BOOKINGS.length)
check('nothing at all is survivable', groupAppointments([], TODAY),
      { current: [], upcoming: [], past: [] })
check('and undefined is too', groupAppointments(undefined, TODAY),
      { current: [], upcoming: [], past: [] })

check('the kinds a provider can pick', APPOINTMENT_KINDS,
      ['Boarding', 'Day care', 'Grooming', 'Walk', 'Other'])
check('and the statuses the CHECK allows', APPOINTMENT_STATUS,
      ['booked', 'completed', 'cancelled', 'no_show'])


// ── The numbers the dashboard leads with ────────────────────────────────────
//
// needsAttention is the one that earns a tile. A stay arriving within the week
// whose trial is not done or whose criteria are not met is the thing a boarder
// must act on BEFORE the animal turns up, and it is invisible in a plain list.

const S = (o) => ({ id: Math.random().toString(36), status: 'booked', ...o })
const SUM = [
  S({ startsOn: '2026-11-05', endsOn: '2026-11-15' }),                                  // here
  S({ startsOn: '2026-11-12', endsOn: '2026-11-14', trialDone: true,  criteriaMet: true }),  // soon, ready
  S({ startsOn: '2026-11-13', endsOn: '2026-11-15', trialDone: false, criteriaMet: true }),  // soon, no trial
  S({ startsOn: '2026-11-14', endsOn: '2026-11-16', trialDone: true,  criteriaMet: false }), // soon, no criteria
  S({ startsOn: '2026-12-20', endsOn: '2026-12-25', trialDone: false, criteriaMet: false }), // far off
  S({ startsOn: '2026-01-01', endsOn: '2026-01-05', status: 'completed' }),             // past
]
const sum = bookSummary({ customers: [1,2,3], pets: [1,2,3,4], appointments: SUM }, TODAY)

check('it counts who is in',            sum.here, 1)
check('and who is coming',              sum.upcoming, 4)
check('and what is behind',             sum.past, 1)
check('customers and pets come straight through', [sum.customers, sum.pets], [3, 4])
check('a stay within the week missing its trial needs attention',
      sum.needsAttention, 2)
check('one further out does NOT, yet',
      bookSummary({ appointments: [SUM[4]] }, TODAY).needsAttention, 0)
check('and a ready one never does',
      bookSummary({ appointments: [SUM[1]] }, TODAY).needsAttention, 0)
check('an empty book is all zeroes',
      bookSummary({}, TODAY),
      { here: 0, upcoming: 0, customers: 0, pets: 0, past: 0, needsAttention: 0 })

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
