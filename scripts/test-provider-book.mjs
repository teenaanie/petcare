// The provider's own book — the pure logic. Run with: npm run test:book
//
// The grouping is what turns a list of bookings into a diary, and it has one
// rule that is easy to get wrong in the comfortable direction: a cancelled
// booking must not sit in "coming up", or a quiet week reads as a busy one and
// the provider plans staff around animals that are not arriving.

import { groupAppointments, APPOINTMENT_KINDS, APPOINTMENT_STATUS } from '../src/lib/providerBook.js'

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

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
