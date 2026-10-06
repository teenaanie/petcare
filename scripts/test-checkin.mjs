// The check-in email: who may be written to, and what it says.
// Run: npm run test:checkin
//
// This is the first feature in Pippy that emails a customer unprompted. A bug
// in the error reporter loses a diagnostic; a bug here writes to a real person
// who is using the app perfectly happily and asks if something is wrong. So
// the refusal chain is tested harder than the happy path.

import {
  refuseReason, compose, listNames,
  MIN_IDLE_DAYS, COOLDOWN_DAYS, MAX_PER_DAY,
} from '../api/_lib/checkin-email.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

// The HTML is written as indented template literals, so a phrase can wrap
// across a newline. Collapse whitespace before asserting on wording, or the
// test is really checking where the source happens to break lines.
const text = (html) => String(html).replace(/\s+/g, ' ')

const NOW = Date.parse('2026-10-05T12:00:00Z')
const daysAgo = (d) => new Date(NOW - d * 86400_000).toISOString()

/** An eligible row, as get_inactive_users_for_admin would return it. */
const eligible = (over = {}) => ({
  id: '275f153a-0000-4000-8000-000000000000',
  email: 'someone@example.com',
  contactable: true,
  idle_days: 57,
  kind: 'went_quiet',
  last_checkin_at: null,
  ...over,
})

console.log('\nThe happy path')
{
  ok('an eligible person may be written to',
     refuseReason(eligible(), { now: NOW }) === null,
     refuseReason(eligible(), { now: NOW }))

  ok('exactly at the threshold is allowed',
     refuseReason(eligible({ idle_days: MIN_IDLE_DAYS }), { now: NOW }) === null)
}

console.log('\nRefusals that protect a real person')
{
  // The one that matters most. If the browser asks about somebody who is not
  // in the server's own list, the answer is no -- whatever the browser thinks.
  ok('a user absent from the list is refused',
     refuseReason(undefined, { now: NOW }) === 'not_inactive')
  ok('null is refused the same way',
     refuseReason(null, { now: NOW }) === 'not_inactive')

  ok('one day under the threshold is refused',
     refuseReason(eligible({ idle_days: MIN_IDLE_DAYS - 1 }), { now: NOW }) === 'too_recent')

  // Phone-only accounts are real. There is nothing to write to.
  ok('a phone-only account is refused',
     refuseReason(eligible({ contactable: false, email: null }), { now: NOW }) === 'no_email')
  ok('contactable but with no address is still refused',
     refuseReason(eligible({ email: '' }), { now: NOW }) === 'no_email')
  ok('an address with contactable false is refused',
     refuseReason(eligible({ contactable: false }), { now: NOW }) === 'no_email')
}

console.log('\nNobody is chased')
{
  ok('somebody asked yesterday is not asked again',
     refuseReason(eligible({ last_checkin_at: daysAgo(1) }), { now: NOW }) === 'already_contacted')

  ok('still refused one day inside the cooldown',
     refuseReason(eligible({ last_checkin_at: daysAgo(COOLDOWN_DAYS - 1) }), { now: NOW })
       === 'already_contacted')

  ok('allowed once the cooldown has fully passed',
     refuseReason(eligible({ last_checkin_at: daysAgo(COOLDOWN_DAYS + 1) }), { now: NOW }) === null)

  // A NaN comparison is false, so a malformed timestamp would otherwise wave
  // the send straight through -- the opposite of what a broken record implies.
  ok('an unparseable last-contacted date refuses rather than allows',
     refuseReason(eligible({ last_checkin_at: 'not a date' }), { now: NOW }) === 'already_contacted')
  ok('a garbage non-string date also refuses',
     refuseReason(eligible({ last_checkin_at: {} }), { now: NOW }) === 'already_contacted')
}

console.log('\nThe runaway guard')
{
  ok('under the daily cap is fine',
     refuseReason(eligible(), { now: NOW, todayCount: MAX_PER_DAY - 1 }) === null)
  ok('at the cap it stops',
     refuseReason(eligible(), { now: NOW, todayCount: MAX_PER_DAY }) === 'daily_cap')
  ok('over the cap it stops',
     refuseReason(eligible(), { now: NOW, todayCount: MAX_PER_DAY + 99 }) === 'daily_cap')

  // Pippy has 17 users. A day attempting dozens of check-ins is a loop.
  ok('the cap is small enough to catch a loop on a 17-user app', MAX_PER_DAY <= 50, MAX_PER_DAY)
  ok('the threshold really is "more than a month"', MIN_IDLE_DAYS >= 30, MIN_IDLE_DAYS)
}

console.log('\nMissing or odd fields do not become a send')
{
  ok('no idle_days at all is refused',
     refuseReason({ email: 'a@b.com', contactable: true }, { now: NOW }) === 'too_recent')
  ok('a non-numeric idle_days is refused',
     refuseReason(eligible({ idle_days: 'lots' }), { now: NOW }) === 'too_recent')
  ok('an empty object is refused',
     refuseReason({}, { now: NOW }) === 'no_email')
  ok('refuseReason never throws on junk',
     (() => { try { refuseReason({ idle_days: NaN, email: 1, contactable: 1 }, { now: NOW }); return true } catch { return false } })())
}

console.log('\nTwo different conversations')
{
  const quiet = compose({ kind: 'went_quiet', petNames: ['Poppy'] })
  const never = compose({ kind: 'never_used', petNames: [] })

  ok('somebody who went quiet is asked about their pet',
     quiet.subject.includes('Poppy'), quiet.subject)
  ok('somebody who never started is asked about getting stuck',
     /stuck/i.test(never.subject), never.subject)
  ok('the two messages are not the same letter',
     quiet.html !== never.html && quiet.subject !== never.subject)

  // Asking "how is your pet?" of somebody who never told us about one is the
  // tell of a form letter.
  ok('the never-used message does not pretend to know about a pet',
     !/how is/i.test(never.subject) && !never.html.includes('Poppy'), never.subject)

  ok('both say how to get out of it',
     /rather not hear from us/i.test(text(quiet.html)) &&
     /rather not hear from us/i.test(text(never.html)),
     [text(quiet.html).match(/.{0,50}rather not.{0,30}/)?.[0],
      text(never.html).match(/.{0,50}rather not.{0,30}/)?.[0]])
  ok('both invite a reply rather than only a click',
     /reply/i.test(quiet.html) && /reply/i.test(never.html))
}

console.log('\nPet names are the owner\'s text, so they are escaped')
{
  // The owner types the pet's name. It goes into an HTML email.
  const evil = compose({
    kind: 'went_quiet',
    petNames: ['<script>alert(1)</script>'],
  })
  ok('a script tag in a pet name cannot reach the HTML',
     !evil.html.includes('<script>'), evil.html.match(/.{0,40}script.{0,40}/)?.[0])
  ok('it is escaped, not dropped',
     evil.html.includes('&lt;script&gt;'))

  const quoted = compose({ kind: 'went_quiet', petNames: ['Bo"bby'] })
  ok('a quote cannot break out of an attribute',
     !quoted.html.includes('Bo"bby') && quoted.html.includes('Bo&quot;bby'))

  const amp = compose({ kind: 'went_quiet', petNames: ['Salt & Pepper'] })
  ok('an ampersand is escaped in the body', amp.html.includes('Salt &amp; Pepper'))
  // But NOT in the subject: an inbox would show "Salt &amp; Pepper" literally.
  ok('the subject keeps a readable ampersand',
     amp.subject.includes('Salt & Pepper'), amp.subject)
}

console.log('\nThe subject line is a header, not HTML')
{
  // A newline in a header is how header injection works. Resend takes JSON and
  // encodes it itself, so this is depth rather than a known hole.
  const nl = compose({ kind: 'went_quiet', petNames: ['Bo\nBcc: someone@evil.com'] })
  ok('a newline cannot reach the subject',
     !/[\r\n]/.test(nl.subject), JSON.stringify(nl.subject))
  ok('the rest of the name survives', nl.subject.includes('Bo'), nl.subject)

  const ctrl = compose({ kind: 'went_quiet', petNames: ['A\u0000B\u001fC'] })
  ok('control characters are stripped from the subject',
     !/[\u0000-\u001f]/.test(ctrl.subject), JSON.stringify(ctrl.subject))

  const long = compose({ kind: 'went_quiet', petNames: ['x'.repeat(400)] })
  ok('an absurd pet name does not become the whole subject',
     long.subject.length < 120, long.subject.length)

  const blank = compose({ kind: 'went_quiet', petNames: ['   ', '\n'] })
  ok('names that are only whitespace fall back rather than making "How is  doing?"',
     blank.subject === 'Checking in about your pets', blank.subject)
}

console.log('\nNames read the way a person would say them')
{
  ok('one pet', listNames(['Poppy']) === 'Poppy')
  ok('two pets', listNames(['Poppy', 'Pino']) === 'Poppy and Pino')
  ok('three pets',
     listNames(['Poppy', 'Pino', 'Mapple']) === 'Poppy, Pino and Mapple',
     listNames(['Poppy', 'Pino', 'Mapple']))
  ok('none', listNames([]) === '')
  ok('blanks are dropped rather than becoming ", and"',
     listNames(['Poppy', '', null, 'Pino']) === 'Poppy and Pino',
     listNames(['Poppy', '', null, 'Pino']))
}

console.log('\nNo pets on file still produces a sane letter')
{
  const c = compose({ kind: 'went_quiet', petNames: [] })
  ok('the subject does not trail off', !/^How is\s*doing/.test(c.subject), c.subject)
  ok('the body falls back to a general phrase',
     text(c.html).includes('your pets'), text(c.html).match(/.{0,30}your pets.{0,20}/)?.[0])
  ok('and it is still addressed to somebody', /Hello/.test(c.html))
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
