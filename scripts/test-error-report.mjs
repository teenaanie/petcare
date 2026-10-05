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

const { scrub, fingerprint, buildReport, reportError } = await import('../src/lib/errorReport.js')

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

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
