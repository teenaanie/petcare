// What the notification bell shows. Run: npm run test:reminder-feed

import { groupReminders, badgeCount, dueLabel, SOON_DAYS } from '../src/lib/reminderFeed.js'
import { todayIST, addDaysISO } from '../src/lib/dates.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

const TODAY = '2026-09-28'
const d = n => addDaysISO(TODAY, n)
const PETS = [{ id: 'p1', name: 'Bruno' }, { id: 'p2', name: 'Mishka' }]
const rem = (o) => ({ id: Math.random().toString(36).slice(2), petId: 'p1', type: 'Vaccination', ...o })

console.log('\nBucketing')
{
  const g = groupReminders([
    rem({ dueDate: d(-30) }), rem({ dueDate: d(-1) }),
    rem({ dueDate: TODAY }),
    rem({ dueDate: d(1) }), rem({ dueDate: d(SOON_DAYS) }),
    rem({ dueDate: d(SOON_DAYS + 1) }), rem({ dueDate: d(400) }),
  ], PETS, TODAY)
  ok('two overdue', g.overdue.length === 2, g.overdue.map(r => r.dueDate))
  ok('one today',   g.today.length === 1,   g.today.map(r => r.dueDate))
  ok('two soon',    g.soon.length === 2,    g.soon.map(r => r.dueDate))
  ok('two later',   g.later.length === 2,   g.later.map(r => r.dueDate))
  ok(`the ${SOON_DAYS}th day is still "soon", the next is not`,
     g.soon.at(-1).dueDate === d(SOON_DAYS) && g.later[0].dueDate === d(SOON_DAYS + 1),
     [g.soon.at(-1).dueDate, g.later[0].dueDate])
}

console.log('\nRows that must not appear')
{
  const g = groupReminders([
    rem({ dueDate: d(-5), isDone: true }),        // already done
    rem({ dueDate: d(-5), is_done: true }),       // done, snake_case straight from the DB
    rem({ dueDate: '' }),                         // never given a date
    rem({ dueDate: null }),
    rem({}),
  ], PETS, TODAY)
  const total = Object.values(g).flat().length
  ok('none of them are shown', total === 0, g)
  ok('a dateless reminder is NOT counted overdue', g.overdue.length === 0, g.overdue)
}

console.log('\nOrdering')
{
  const g = groupReminders([
    rem({ dueDate: d(-2) }), rem({ dueDate: d(-40) }), rem({ dueDate: d(-9) }),
    rem({ dueDate: d(5) }),  rem({ dueDate: d(2) }),
  ], PETS, TODAY)
  ok('overdue is worst-first',
     g.overdue.map(r => r.dueDate).join() === [d(-40), d(-9), d(-2)].join(),
     g.overdue.map(r => r.dueDate))
  ok('upcoming is soonest-first',
     g.soon.map(r => r.dueDate).join() === [d(2), d(5)].join(),
     g.soon.map(r => r.dueDate))
}

console.log('\nThe badge only counts what needs attention now')
{
  const g = groupReminders([
    rem({ dueDate: d(-3) }), rem({ dueDate: TODAY }),
    rem({ dueDate: d(3) }), rem({ dueDate: d(90) }),
  ], PETS, TODAY)
  ok('overdue + today, not the whole week', badgeCount(g) === 2, badgeCount(g))

  const quiet = groupReminders([rem({ dueDate: d(3) }), rem({ dueDate: d(60) })], PETS, TODAY)
  ok('a week of upcoming reminders leaves the badge dark', badgeCount(quiet) === 0, badgeCount(quiet))

  ok('nothing at all is zero', badgeCount(groupReminders([], PETS, TODAY)) === 0, null)
}

console.log('\nEach row knows whose it is')
{
  const g = groupReminders([rem({ petId: 'p2', dueDate: TODAY }), rem({ petId: 'gone', dueDate: TODAY })], PETS, TODAY)
  ok('pet is attached', g.today[0].pet?.name === 'Mishka', g.today[0].pet)
  ok('a reminder whose pet is missing still shows, with no pet',
     g.today.length === 2 && g.today[1].pet === null, g.today[1])
}

console.log('\nWording')
{
  ok('today',      dueLabel(TODAY, TODAY) === 'Today', dueLabel(TODAY, TODAY))
  ok('tomorrow',   dueLabel(d(1), TODAY) === 'Tomorrow', dueLabel(d(1), TODAY))
  ok('yesterday',  dueLabel(d(-1), TODAY) === 'Yesterday', dueLabel(d(-1), TODAY))
  ok('in 3 days',  dueLabel(d(3), TODAY) === 'In 3 days', dueLabel(d(3), TODAY))
  ok('3 days ago', dueLabel(d(-3), TODAY) === '3 days ago', dueLabel(d(-3), TODAY))
  ok('in 2 weeks', dueLabel(d(14), TODAY) === 'In 2 weeks', dueLabel(d(14), TODAY))
  ok('2 weeks ago',dueLabel(d(-14), TODAY) === '2 weeks ago', dueLabel(d(-14), TODAY))
  ok('long ago',   dueLabel(d(-200), TODAY) === 'Over a month ago', dueLabel(d(-200), TODAY))
  ok('no date says nothing', dueLabel('', TODAY) === '', dueLabel('', TODAY))
  ok('a nonsense date does not throw or say NaN',
     dueLabel('not-a-date', TODAY) === '', dueLabel('not-a-date', TODAY))
}

console.log('\nIST boundary')
{
  // 19:00 UTC on the 28th is 00:30 on the 29th in India. A reminder due on the
  // 29th is due TODAY then — not tomorrow.
  const evening = Date.parse('2026-09-28T19:00:00Z')
  ok('the day has already rolled over in India', todayIST(evening) === '2026-09-29', todayIST(evening))
  const g = groupReminders([rem({ dueDate: '2026-09-29' })], PETS, todayIST(evening))
  ok('so that reminder is due today, not tomorrow', g.today.length === 1 && g.soon.length === 0, g)
}

console.log('\nDefaults to the real today without throwing')
{
  const g = groupReminders([rem({ dueDate: todayIST() })], PETS)
  ok('today is today', g.today.length === 1, g)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
