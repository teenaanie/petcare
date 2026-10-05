// Recognising a stale chunk. Run: npm run test:chunk-errors
//
// A customer reported that clicking a pet showed a blank screen. The cause was
// a tab left open across a deploy: the old index.html asked for chunk names
// that no longer existed, the import rejected, and a <Suspense> boundary does
// not catch a rejection -- it only covers the pending state -- so React tore
// the subtree down.
//
// ChunkErrorBoundary now catches it and reloads once, which fetches an
// index.html naming chunks that exist. This classification is what decides
// whether that reload happens, so getting it wrong means either a blank screen
// again (false negative) or an app that reloads itself on an ordinary bug
// (false positive, and much worse -- the user never gets to read the error).
//
// Every browser words it differently, so the two messages Pippy ACTUALLY
// collected are both asserted here by their exact text.

import { isChunkLoadError } from '../src/lib/chunkErrors.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

console.log('\nThe two messages actually collected from real users')
{
  // From client_errors, build 054df7d, Chrome on macOS.
  const chrome = new TypeError(
    'Failed to fetch dynamically imported module: https://pippyapp.vercel.app/assets/Timeline-B1_kSx6E.js')
  ok('Chrome on macOS, the exact reported message', isChunkLoadError(chrome))

  // From client_errors, build 1cf32a5, Safari on iOS.
  const safari = new TypeError("'text/html' is not a valid JavaScript MIME type.")
  ok('Safari on iOS, the exact reported message', isChunkLoadError(safari))
}

console.log('\nThe other wordings for the same fault')
{
  for (const [label, msg] of [
    ['Vite preload helper',  'Failed to fetch dynamically imported module'],
    ['older Chrome',         'error loading dynamically imported module'],
    ['Safari module script', 'Importing a module script failed.'],
    ['Firefox',              'Loading failed for the module with source "x" — error loading a module script'],
    ['Firefox MIME',         'Expected a JavaScript module script but the server responded with a MIME type of "text/html".'],
  ]) ok(label, isChunkLoadError(new TypeError(msg)), msg)

  // Some tooling throws it as a NAME rather than in the message, so the name
  // has to be inspected too.
  const named = new Error('Loading chunk 42 failed.')
  named.name = 'ChunkLoadError'
  ok('ChunkLoadError carried in the name, not the message', isChunkLoadError(named))
}

console.log('\nOrdinary bugs must NOT trigger a self-reload')
{
  // This is the dangerous direction. An app that reloads on a real bug hides
  // the bug AND loses whatever the user was doing.
  for (const [label, err] of [
    ['a plain type error',      new TypeError("Cannot read properties of undefined (reading 'name')")],
    ['a thrown string',         'something went wrong'],
    ['a reference error',       new ReferenceError('Loader2 is not defined')],
    ['a Supabase failure',      new Error('duplicate key value violates unique constraint')],
    ['a generic fetch failure', new TypeError('Failed to fetch')],
    ['an abort',                Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })],
    ['a render loop',           new Error('Too many re-renders.')],
    ['the suspend warning',     new Error('A component suspended while responding to synchronous input.')],
  ]) ok(label + ' is not a chunk error', !isChunkLoadError(err), String(err?.message || err))

  // "Failed to fetch" on its own is an ordinary network error and must not
  // reload the app. Only the *dynamically imported module* form counts.
  ok('plain "Failed to fetch" is distinguished from the module form',
     !isChunkLoadError(new TypeError('Failed to fetch')) &&
     isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /a.js')))
}

console.log('\nJunk does not throw and does not reload')
{
  ok('null', isChunkLoadError(null) === false)
  ok('undefined', isChunkLoadError(undefined) === false)
  ok('an empty object', isChunkLoadError({}) === false)
  ok('a number', isChunkLoadError(42) === false)
  ok('an error with no message', isChunkLoadError(new Error()) === false)
  ok('never throws',
     (() => { try { for (const v of [null, undefined, 0, '', [], {}, new Error()]) isChunkLoadError(v); return true }
              catch { return false } })())
}

console.log('\nCase and surrounding text do not matter')
{
  ok('upper case', isChunkLoadError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE: /x.js')))
  ok('embedded in a longer stack-ish string',
     isChunkLoadError(new Error('TypeError: Failed to fetch dynamically imported module: /assets/Bills-x.js at foo')))
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
