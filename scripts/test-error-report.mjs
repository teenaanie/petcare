// What leaves the browser in an error report. Run: npm run test:error-report
//
// The scrubbing is the part that matters. Pippy holds vaccination records and
// vet phone numbers; an error report is not worth one byte of that leaking.

// Browser globals the module reads at call time. Stubbed rather than pulling in
// a DOM, which keeps this runnable with plain node.
// defineProperty rather than assignment: node 24 ships its own read-only
// `navigator`, so a plain assignment throws before a single test runs.
const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
define('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1', onLine: true })
define('location',  { pathname: '/', search: '?token=abc', hash: '#x' })
define('__BUILD_ID__', 'abc1234')
define('window', undefined)

const { scrub, fingerprint, buildReport, reportError, reportHandled, isExpected } =
  await import('../src/lib/errorReport.js')

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

console.log('\nScrubbing personal data')
{
  ok('an email address is removed',
     !scrub('duplicate key: teena.anie9@gmail.com').includes('@gmail'),
     scrub('duplicate key: teena.anie9@gmail.com'))

  ok('a pet or user id is removed',
     scrub('pet fed72753-4106-4a77-bf9e-93936e4816f7 not found') === 'pet [id] not found',
     scrub('pet fed72753-4106-4a77-bf9e-93936e4816f7 not found'))

  ok('a phone number is removed',
     !/9876543210/.test(scrub('sms to +91 98765 43210 failed')),
     scrub('sms to +91 98765 43210 failed'))

  ok('a query string is removed',
     !scrub('GET https://x.supabase.co/rest/v1/pets?select=*&name=Bruno').includes('Bruno'),
     scrub('GET https://x.supabase.co/rest/v1/pets?select=*&name=Bruno'))

  ok('a JWT is removed',
     !scrub('bad token eyJhbGciOi.eyJzdWIi.SflKxwRJ').includes('eyJhbGciOi'),
     scrub('bad token eyJhbGciOi.eyJzdWIi.SflKxwRJ'))

  ok('a publishable key is removed',
     !scrub('key sb_publishable_F67mPHSoi1bEbn').includes('F67mPH'),
     scrub('key sb_publishable_F67mPHSoi1bEbn'))

  // Emails are handled before phone numbers, or the digits inside an address
  // get replaced first and the address stops matching at all.
  ok('an address containing digits still goes as an email',
     scrub('user123456789@example.com failed') === '[email] failed',
     scrub('user123456789@example.com failed'))

  ok('long messages are truncated', scrub('x'.repeat(500)).length === 300)
  ok('empty input is safe', scrub('') === '' && scrub(null) === '' && scrub(undefined) === '')
  ok('ordinary technical text is left alone',
     scrub('Cannot read properties of undefined (reading \'name\')')
       === 'Cannot read properties of undefined (reading \'name\')')
}

console.log('\nThe view is a closed set, not a string')
{
  // The lesson from analytics: a filter that accepts anything "shaped right"
  // passes real data through. A pet called Bruno is a perfectly ordinary word.
  ok('a known view is kept', buildReport(new Error('x'), { view: 'voice-update' }).view === 'voice-update')
  ok('a pet name is NOT forwarded as a view',
     buildReport(new Error('x'), { view: 'Bruno' }).view === 'unknown',
     buildReport(new Error('x'), { view: 'Bruno' }).view)
  ok('a missing view becomes unknown', buildReport(new Error('x')).view === 'unknown')
  ok('free text is rejected',
     buildReport(new Error('x'), { view: 'Mishka had a rash' }).view === 'unknown')
}

console.log('\nThe report itself')
{
  const r = buildReport(Object.assign(new Error('failed for bob@x.com'), {
    stack: 'Error: failed for bob@x.com\n    at save (/src/x.js:1:1)',
  }), { view: 'journal' })

  ok('the message is scrubbed', !r.message.includes('bob@x.com'), r.message)
  ok('the stack is scrubbed', !r.stack.includes('bob@x.com'), r.stack)
  ok('the build id is carried', r.build === 'abc1234')
  ok('the browser is coarse, not a full user-agent',
     r.browser === 'Safari on iOS', r.browser)
  ok('only the path is sent, never the query or hash',
     r.path === '/' && !JSON.stringify(r).includes('token=abc'), r.path)
  ok('a non-Error is handled', buildReport('just a string').name === 'Error')
  ok('null is handled', typeof buildReport(null).message === 'string')
}

console.log('\nFingerprinting, so one bug reports once')
{
  const a = { name: 'TypeError', message: 'x is undefined', stack: 'TypeError\n  at f (/a.js:1:1)' }
  const b = { name: 'TypeError', message: 'x is undefined', stack: 'TypeError\n  at f (/a.js:1:1)' }
  ok('the same fault fingerprints the same', fingerprint(a) === fingerprint(b))

  ok('a different fault fingerprints differently',
     fingerprint(a) !== fingerprint({ ...a, message: 'y is undefined' }))

  // Without this, the same bug hitting two people would look like two bugs,
  // because their addresses differ.
  const u1 = { name: 'E', message: 'save failed for ann@x.com', stack: 'E\n  at s (/a.js:1:1)' }
  const u2 = { name: 'E', message: 'save failed for bob@y.com', stack: 'E\n  at s (/a.js:1:1)' }
  ok('the same bug hitting two people is ONE fingerprint',
     fingerprint(u1) === fingerprint(u2), [fingerprint(u1), fingerprint(u2)])

  ok('a missing stack does not throw',
     typeof fingerprint({ name: 'E', message: 'm' }) === 'string')
}

console.log('\nBrowser housekeeping is not a fault')
{
  // The first three reports Pippy ever collected were all service worker
  // update failures -- aborted updates and "newestWorker is null" on iOS.
  // Nobody experienced any of them, and a list of those is a list nobody
  // reads. Their source is fixed too; this is the net.
  const sent = []
  const realBeacon = globalThis.navigator.sendBeacon
  globalThis.navigator.sendBeacon = (u, b) => { sent.push(b); return true }

  for (const msg of [
    "Failed to update a ServiceWorker for scope ('https://pippypets.com/') with script ('https://pippypets.com/sw.js'): Operation has been aborted",
    'newestWorker is null',
    "Failed to register a ServiceWorker for scope ('https://x/')",
  ]) reportError(Object.assign(new Error(msg), { name: 'AbortError' }))

  ok('service worker noise is not reported', sent.length === 0, sent.length)

  // The narrowness matters: a real fault that merely mentions a worker, or any
  // ordinary error, must still get through.
  reportError(new Error('Cannot read properties of undefined (reading name)'))
  ok('a genuine fault still is', sent.length === 1, sent.length)

  globalThis.navigator.sendBeacon = realBeacon
}

console.log('\nA caught fault is reported, and says so')
{
  // The bug this whole section exists for. PetSharing's getMembers() threw
  // this on EVERY open of the share panel, the component caught it and
  // rendered it, and because nothing rethrew it client_errors held zero rows.
  // A customer had to report it.
  const sent = []
  const realBeacon = globalThis.navigator.sendBeacon
  globalThis.navigator.sendBeacon = (u, b) => { sent.push(b); return true }

  reportHandled(new ReferenceError("Can't find variable: supabase"), { view: 'sharing' })
  ok('a caught fault IS reported', sent.length === 1, sent.length)

  globalThis.navigator.sendBeacon = realBeacon
}

console.log('\nWhich kind of fault it was')
{
  ok('a caught-and-shown fault is marked handled',
     buildReport(new Error('x'), { kind: 'handled' }).kind === 'handled')
  ok('a crash is marked uncaught',
     buildReport(new Error('x')).kind === 'uncaught')
  // Closed like `view`, for the same reason: a caller must not be able to put
  // arbitrary text in a stored column.
  ok('an unrecognised kind reads as a crash',
     buildReport(new Error('x'), { kind: 'Bruno' }).kind === 'uncaught',
     buildReport(new Error('x'), { kind: 'Bruno' }).kind)
  ok('the window listeners still report uncaught',
     buildReport(new Error('x'), { view: 'sharing' }).kind === 'uncaught')
}

console.log('\nThings the app is MEANT to hit are not faults')
{
  // The Errors tab has been made unreadable once already, by three rows of
  // service worker housekeeping nobody experienced. A catch block fires on far
  // more than defects, so every one of these has to be dropped or the tab
  // fills with the ordinary business of using a phone.
  const expected = [
    ['a dropped request',        new Error('Load failed')],
    ['Chrome\'s wording for it', new Error('Failed to fetch')],
    ['an AI quota',              Object.assign(new Error('Monthly limit reached'), { limitReached: true })],
    ['a 429',                    Object.assign(new Error('Server error 429'), { status: 429 })],
    ['a rate limit by wording',  new Error('Email rate limit exceeded')],
    ['a cancelled request',      Object.assign(new Error('cancelled'), { name: 'AbortError' })],
    ['a denied microphone',      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })],
    ['no microphone at all',     Object.assign(new Error('No device'), { name: 'NotFoundError' })],
    ['an empty result',          Object.assign(new Error('no rows returned'), { code: 'PGRST116' })],
    ['an address already shared', Object.assign(new Error('duplicate key value'), { code: '23505' })],
    ['an AI call that timed out', new Error('That took longer than 45 seconds and was stopped. Tap to try again.')],
    ['an unreachable server',    new Error('Could not reach the server. Check your connection and try again.')],
    ['nobody signed in yet',     new Error('Please sign in to use this feature.')],
  ]
  for (const [label, e] of expected) ok(`${label} is not a fault`, isExpected(e), e.message)

  // And the other half: the things that ARE defects must still get through,
  // or this filter has quietly turned the reporter back off.
  const faults = [
    ['the share panel bug',   new ReferenceError("Can't find variable: supabase")],
    ['an ordinary TypeError', new TypeError("undefined is not an object (evaluating 'pet.name')")],
    // Looks like an ordinary "no", but a refusal the user READS means the
    // screen offered an action they were never allowed to take.
    ['an RLS refusal',        Object.assign(new Error('new row violates row-level security policy'), { code: '42501' })],
    // A migration nobody ran. Exactly the sort of thing that should not need a
    // customer to notice it.
    ['a missing column',      Object.assign(new Error("column pets.colour does not exist"), { code: '42703' })],
    ['a missing table',       new Error('relation "public.conditions" does not exist (schema cache)')],
  ]
  for (const [label, e] of faults) ok(`${label} IS a fault`, !isExpected(e), e.message)

  ok('a missing error is not a fault', isExpected(null) && isExpected(undefined))
}

console.log('\nBeing offline makes nothing diagnosable')
{
  // While offline every request fails for the same uninteresting reason, so
  // nothing learned from one is worth a row.
  const online = globalThis.navigator.onLine
  globalThis.navigator.onLine = false
  ok('an offline fault is not reported',
     isExpected(new TypeError('whatever went wrong here')) === true)
  globalThis.navigator.onLine = online
  ok('and is again once back online',
     isExpected(new TypeError('whatever went wrong here')) === false)
}

console.log('\nExpected conditions never reach the network')
{
  const sent = []
  const realBeacon = globalThis.navigator.sendBeacon
  globalThis.navigator.sendBeacon = (u, b) => { sent.push(b); return true }

  reportHandled(new Error('Load failed'), { view: 'medical' })
  reportHandled(Object.assign(new Error('nope'), { name: 'AbortError' }), { view: 'scanner' })
  reportHandled(Object.assign(new Error('duplicate key value'), { code: '23505' }), { view: 'sharing' })
  ok('none of them was sent', sent.length === 0, sent.length)

  // Not a swallow-everything filter: a real one still goes.
  reportHandled(new TypeError("undefined is not an object (evaluating 'r.dueDate')"),
                { view: 'reminders' })
  ok('a real fault beside them still goes', sent.length === 1, sent.length)

  // sendBeacon is handed a Blob, so the body has to be read back out of it.
  const body = JSON.parse(await sent[0].text())
  ok('and it carries the screen it happened on', body.view === 'reminders', body.view)
  ok('and says it was shown to the user', body.kind === 'handled', body.kind)

  globalThis.navigator.sendBeacon = realBeacon
}

console.log('\nreportHandled never becomes the problem itself')
{
  // A reporter that throws inside a catch block replaces the message the user
  // was about to read with a blank screen. That must not be possible.
  const realBeacon = globalThis.navigator.sendBeacon
  globalThis.navigator.sendBeacon = () => { throw new Error('beacon exploded') }
  let threw = false
  try { reportHandled(new TypeError('a genuine fault with a dead beacon')) }
  catch { threw = true }
  ok('a throwing beacon does not escape', !threw)
  globalThis.navigator.sendBeacon = realBeacon
}

console.log('\nThe real friendlyError path, which five screens go through')
{
  // Not a stand-in for the reporter: this is the function DocumentScanner,
  // ConditionJournal, VoiceUpdate, NotificationBell and PetAvatar actually
  // call, and whose return value is the sentence the pet parent reads. If a
  // report does not leave here, those screens are silent again.
  const { friendlyError } = await import('../src/lib/errors.js')

  const sent = []
  const realBeacon = globalThis.navigator.sendBeacon
  const realError  = console.error
  globalThis.navigator.sendBeacon = (u, b) => { sent.push(b); return true }
  console.error = () => {}   // friendlyError logs by design; not under test

  const shown = friendlyError(
    new TypeError("undefined is not an object (evaluating 'result.vaccinations')"),
    { view: 'scanner' })

  console.error = realError
  globalThis.navigator.sendBeacon = realBeacon

  ok('the user still gets a message', /went wrong in the app/.test(shown), shown)
  ok('and a report was produced too', sent.length === 1, sent.length)

  const body = JSON.parse(await sent[0].text())
  ok('attributed to the screen it happened on', body.view === 'scanner', body.view)
  ok('marked as shown to the user, not a crash', body.kind === 'handled', body.kind)
  ok('posted to the reporting endpoint', !!body.name && !!body.message, body)

  // The other half of the same function: a dropped connection still gets the
  // user a message and still produces nothing.
  const quiet = []
  const b2 = globalThis.navigator.sendBeacon
  globalThis.navigator.sendBeacon = (u, b) => { quiet.push(b); return true }
  console.error = () => {}
  const offlineMsg = friendlyError(new TypeError('Load failed'), { view: 'scanner' })
  console.error = realError
  globalThis.navigator.sendBeacon = b2

  ok('a dropped connection still explains itself', /try once more/.test(offlineMsg), offlineMsg)
  ok('and still reports nothing', quiet.length === 0, quiet.length)
}

console.log('\nEvery screen name a caller passes is a real one')
{
  // The closed set is a defence, but it fails SILENTLY: a typo does not throw,
  // it reports as 'unknown', and the fault is then unattributable in exactly
  // the case you came to the dashboard to read. So the call sites are checked
  // against the set rather than trusted.
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')

  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(join(dir, d.name))
      : /\.(js|jsx)$/.test(d.name) ? [join(dir, d.name)] : [])

  const source   = readFileSync('src/lib/errorReport.js', 'utf8')
  const declared = new Set(
    [...source.matchAll(/const (?:VIEWS) = new Set\(\[([\s\S]*?)\]\)/g)]
      .flatMap(m => [...m[1].matchAll(/'([a-z-]+)'/g)].map(x => x[1])))

  ok('the closed set was found in the source', declared.size > 10, declared.size)

  const bad = []
  for (const file of walk('src')) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/view:\s*'([^']*)'/g)) {
      if (!declared.has(m[1])) bad.push(`${file}: '${m[1]}'`)
    }
  }
  ok('no caller passes a view the set does not know', bad.length === 0, bad)
}

// LAST in the file on purpose: this section deliberately exhausts the session
// budget, so anything after it would be testing a reporter that has stopped.
console.log('\nA crash is never dropped to make room for a handled fault')
{
  // The budget was 10 when only crashes could reach the reporter. About forty
  // caught paths now feed it, and a session that spends the lot on handled
  // faults would silently drop the crash that followed -- the one report
  // nobody can reconstruct afterwards, because the screen went white and the
  // user closed the tab.
  const sent = []
  const realBeacon = globalThis.navigator.sendBeacon
  globalThis.navigator.sendBeacon = (u, b) => { sent.push(b); return true }

  // Flood it. Distinct messages, because the fingerprint dedupe would
  // otherwise collapse these into one and prove nothing about the budget.
  for (let i = 0; i < 60; i++) {
    reportHandled(new TypeError(`handled fault number ${i} in a render loop`),
                  { view: 'pet-list' })
  }
  const handled = sent.length
  // 15 is MAX_HANDLED_PER_SESSION. Pinned rather than bounded loosely, because
  // the whole guarantee is the DIFFERENCE between the two caps: a looser
  // assertion would still pass if handled faults could take the lot.
  ok('handled faults stop at their own budget', handled > 0 && handled <= 15, handled)

  // The point of the whole section.
  sent.length = 0
  reportError(new TypeError('the crash that arrived after all that noise'))
  ok('a crash still gets through afterwards', sent.length === 1, sent.length)

  // Not one lucky slot: the reserve is real, so several crashes fit.
  for (let i = 0; i < 5; i++) reportError(new TypeError(`a later crash, number ${i}`))
  ok('and so do the crashes after it', sent.length === 6, sent.length)

  const body = JSON.parse(await sent[0].text())
  ok('and they are recorded as crashes', body.kind === 'uncaught', body.kind)

  globalThis.navigator.sendBeacon = realBeacon
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
