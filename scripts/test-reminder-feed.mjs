// What the notification bell shows. Run: npm run test:reminder-feed

import { groupReminders, badgeCount, dueLabel, SOON_DAYS, feedItems } from '../src/lib/reminderFeed.js'
import { recordDueItems } from '../src/lib/dueOnRecord.js'
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

console.log('\nThe bell and the email must agree')
{
  // The regression this exists for: the morning job was taught to read
  // vaccinations.next_due and the bell was not, so Daisy's booster arrived by
  // email with no badge on the bell. The badge counts overdue + today, which
  // is exactly the set the email sends.
  const TODAY = '2026-10-20'
  const pets = [{ id: 'p1', name: 'Daisy' }]

  const vax = [{ id: 'v1', petId: 'p1', name: 'Felocell', nextDue: TODAY, isDone: false }]
  const items = feedItems({ reminders: [], vaccinations: vax, medicines: [], today: TODAY })
  const g = groupReminders(items, pets, TODAY)

  ok('a vaccination due today reaches the bell', g.today.length === 1, g.today)
  ok('and it names the vaccine', /Felocell/.test(g.today[0]?.notes || ''), g.today[0]?.notes)
  ok('so the badge is not zero', badgeCount(g) === 1, badgeCount(g))
  ok('it is attributed to the right pet', g.today[0]?.pet?.name === 'Daisy', g.today[0]?.pet)

  // Records are bounded at both ends. 19 of the owner's 22 badged items were
  // boosters from 2023-24 whose follow-up shots had already been filed as new
  // rows -- never missed, superseded -- and a badge that is never zero is one
  // nobody reads.
  const stale = [{ id: 'v2', petId: 'p1', name: 'Rabies', nextDue: '2026-06-01', isDone: false }]
  const gStale = groupReminders(feedItems({ vaccinations: stale, today: TODAY }), pets, TODAY)
  ok('a booster long past due is left to the record and the timeline',
     gStale.overdue.length === 0, gStale.overdue)

  // The boundary, both sides of it, so the window cannot quietly widen or
  // close. CATCH_UP_DAYS is 7 and TODAY is 2026-10-20.
  const at   = [{ id: 'v6', petId: 'p1', name: 'Edge in',  nextDue: '2026-10-13', isDone: false }]
  const past = [{ id: 'v7', petId: 'p1', name: 'Edge out', nextDue: '2026-10-12', isDone: false }]
  ok('a record exactly at the catch-up edge still shows',
     groupReminders(feedItems({ vaccinations: at, today: TODAY }), pets, TODAY).overdue.length === 1)
  ok('a record one day beyond it does not',
     groupReminders(feedItems({ vaccinations: past, today: TODAY }), pets, TODAY).overdue.length === 0)

  // A REMINDER the owner typed keeps no lower bound -- it still means what it
  // said, however old.
  const oldReminder = [{ id: 'r9', petId: 'p1', type: 'Vet Visit', dueDate: '2025-01-01' }]
  ok('an old reminder the owner made is still shown',
     groupReminders(feedItems({ reminders: oldReminder, today: TODAY }), pets, TODAY).overdue.length === 1)

  // A medicine behaves identically -- same column, same gap.
  const meds = [{ id: 'm1', petId: 'p1', name: 'Bravecto', nextDue: TODAY, isDone: false }]
  const gMed = groupReminders(feedItems({ medicines: meds, today: TODAY }), pets, TODAY)
  ok('a medicine due today reaches the bell', gMed.today.length === 1, gMed.today)

  // Done, and dateless, are not due.
  const noise = [
    { id: 'v3', petId: 'p1', name: 'Done',    nextDue: TODAY, isDone: true },
    { id: 'v4', petId: 'p1', name: 'No date', nextDue: null,  isDone: false },
  ]
  ok('finished and dateless records are not counted',
     badgeCount(groupReminders(feedItems({ vaccinations: noise, today: TODAY }), pets, TODAY)) === 0)

  // Said once, not twice, when the owner also made a reminder for it.
  const own = [{ id: 'r1', petId: 'p1', type: 'Vaccination', dueDate: TODAY, notes: 'Felocell booster' }]
  const gBoth = groupReminders(
    feedItems({ reminders: own, vaccinations: vax, today: TODAY }), pets, TODAY)
  ok('a record the owner already has a reminder for is not doubled',
     badgeCount(gBoth) === 1, gBoth.today.map(i => i.notes))

  // Far-future records do not pad the panel; the timeline already draws them.
  const future = [{ id: 'v5', petId: 'p1', name: 'Next year', nextDue: '2027-06-01', isDone: false }]
  const gFuture = groupReminders(feedItems({ vaccinations: future, today: TODAY }), pets, TODAY)
  ok('a booster far ahead is left to the timeline',
     gFuture.later.length === 0 && gFuture.soon.length === 0, gFuture)

  // ...but a distant REMINDER still shows, because the owner asked for it.
  const farReminder = [{ id: 'r2', petId: 'p1', type: 'Vet Visit', dueDate: '2027-06-01' }]
  ok('a distant reminder the owner made still shows',
     groupReminders(feedItems({ reminders: farReminder, today: TODAY }), pets, TODAY).later.length === 1)

  // The guard inside recordDueItems, asserted directly. Downstream filters
  // happen to drop a dateless record too, so without this the guard could be
  // removed and every test would still pass.
  {
    const direct = recordDueItems({
      vaccinations: [{ id: 'x', petId: 'p1', name: 'No date', nextDue: null, isDone: false }],
      within: () => true,
    })
    ok('a record with no due date never becomes an item', direct.length === 0, direct)
    const orphan = recordDueItems({
      vaccinations: [{ id: 'y', petId: null, name: 'Orphan', nextDue: TODAY, isDone: false }],
      within: () => true,
    })
    ok('a record with no pet never becomes an item', orphan.length === 0, orphan)
  }

  // Nothing due means nothing shown -- the quiet case is the common one.
  ok('an empty day stays empty',
     badgeCount(groupReminders(feedItems({ today: TODAY }), pets, TODAY)) === 0)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
