// How notes become a provider's diary. Run with: npm run test:inbox
//
// The three rules worth pinning, because each has a wrong answer that looks
// reasonable:
//
//   * a superseded note must NOT be shown — a correction's old half is a fact
//     the customer has already retracted, and showing it is worse than showing
//     nothing;
//   * a note with no stay window is not "past" — filed there, a note sent an
//     hour ago reads as a bug, and it is the majority case for a groomer;
//   * an open-ended stay is still current — a boarder who typed no end date has
//     not told us the pet went home, and guessing it did drops a pet that is
//     still in the kennel.

import {
  bucketFor, currentNotes, ageInDays, groupNotes, INBOX_SECTIONS,
} from '../src/lib/providerInbox.js'

let failed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const TODAY = '2026-11-10'

// ── Which section ───────────────────────────────────────────────────────────

check('a stay that has not started',  bucketFor({ startsOn: '2026-11-20', endsOn: '2026-11-25' }, TODAY), 'upcoming')
check('a stay spanning today',        bucketFor({ startsOn: '2026-11-05', endsOn: '2026-11-15' }, TODAY), 'current')
check('a stay that ended',            bucketFor({ startsOn: '2026-10-01', endsOn: '2026-10-05' }, TODAY), 'past')
check('starting today is current',    bucketFor({ startsOn: TODAY, endsOn: '2026-11-15' }, TODAY), 'current')
check('ending today is still current',bucketFor({ startsOn: '2026-11-01', endsOn: TODAY }, TODAY), 'current')
check('an open-ended stay stays current',
      bucketFor({ startsOn: '2026-11-01', endsOn: null }, TODAY), 'current')
check('an open-ended future stay is upcoming',
      bucketFor({ startsOn: '2026-12-01', endsOn: null }, TODAY), 'upcoming')
check('an end with no start, still to come',
      bucketFor({ startsOn: null, endsOn: '2026-11-20' }, TODAY), 'current')
check('no window at all is its own thing, NOT past',
      bucketFor({ startsOn: null, endsOn: null }, TODAY), 'undated')
check('a junk note does not throw',   bucketFor(null, TODAY), 'undated')

// ── Supersession ────────────────────────────────────────────────────────────

const CHAIN = [
  { id: 'n3', supersedes: 'n2', body: 'third' },
  { id: 'n2', supersedes: 'n1', body: 'second' },
  { id: 'n1', supersedes: null, body: 'first' },
  { id: 'x1', supersedes: null, body: 'unrelated' },
]
check('only the end of a chain survives',
      currentNotes(CHAIN).map(n => n.id), ['n3', 'x1'])
check('an unrelated note is untouched',
      currentNotes([{ id: 'a' }, { id: 'b' }]).map(n => n.id), ['a', 'b'])
check('a dangling supersedes does not eat anything',
      currentNotes([{ id: 'a', supersedes: 'gone' }]).map(n => n.id), ['a'])
check('nothing at all is survivable', currentNotes([]), [])
check('and so is undefined',          currentNotes(), [])

// ── Age ─────────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-11-10T12:00:00Z')
check('sent this morning is 0 days',  ageInDays('2026-11-10T06:00:00Z', NOW), 0)
check('yesterday is 1',               ageInDays('2026-11-09T06:00:00Z', NOW), 1)
check('a month ago',                  ageInDays('2026-10-10T12:00:00Z', NOW), 31)
check('a clock skewed into the future clamps at 0',
      ageInDays('2026-11-11T00:00:00Z', NOW), 0)
check('an unusable timestamp is null', ageInDays('whenever', NOW), null)
check('and so is a missing one',       ageInDays(null, NOW), null)

// ── The whole grouping ──────────────────────────────────────────────────────

const NOTES = [
  { id: 'a', petLabel: 'Pippin', startsOn: '2026-11-20', endsOn: '2026-11-25', supersedes: null },
  { id: 'b', petLabel: 'Mo',     startsOn: '2026-11-12', endsOn: '2026-11-14', supersedes: null },
  { id: 'c', petLabel: 'Rex',    startsOn: '2026-11-05', endsOn: '2026-11-15', supersedes: null },
  { id: 'd', petLabel: 'Ivy',    startsOn: null,         endsOn: null,         supersedes: null },
  { id: 'e', petLabel: 'Old',    startsOn: '2026-01-01', endsOn: '2026-01-05', supersedes: null },
  // A correction of Rex's note: only this one should appear, and in current.
  { id: 'f', petLabel: 'Rex',    startsOn: '2026-11-05', endsOn: '2026-11-15', supersedes: 'c' },
]
const g = groupNotes(NOTES, TODAY)
check('current holds only the correction', g.current.map(n => n.id), ['f'])
check('upcoming reads forwards, nearest first', g.upcoming.map(n => n.id), ['b', 'a'])
check('undated is its own section',        g.undated.map(n => n.id), ['d'])
check('past is past',                      g.past.map(n => n.id), ['e'])
check('the superseded note appears nowhere',
      Object.values(g).flat().some(n => n.id === 'c'), false)
check('every note is in exactly one section',
      Object.values(g).flat().length, 5)
check('the sections are the ones the UI renders',
      INBOX_SECTIONS.map(s => s.key), ['current', 'upcoming', 'undated', 'past'])
check('and grouping returns exactly those keys',
      Object.keys(groupNotes([], TODAY)).sort(), ['current', 'past', 'undated', 'upcoming'])

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
