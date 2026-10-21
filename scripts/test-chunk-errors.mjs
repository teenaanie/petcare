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
import { retryImport } from '../src/lib/lazyRetry.js'

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

console.log('\nRetrying a chunk before giving up')
{
  // The reported fault: editing a record sometimes showed a load error, and
  // clicking again worked. Measured in a browser, what happened was a chunk
  // import failing, the boundary force-reloading, and the reload landing on
  // the PET LIST -- so a dropped request read as "it threw me out".
  const chunkErr = () => new Error('Failed to fetch dynamically imported module: /assets/Vaccinations-x.js')

  const flaky = (failures, err = chunkErr) => {
    let calls = 0
    const fn = async () => { calls++; if (calls <= failures) throw err(); return { default: 'MODULE' } }
    return { fn, calls: () => calls }
  }

  {
    // try/catch so a regression here reports a failed assertion rather than
    // crashing the run on an unhandled rejection -- a crash is detection, but
    // it tells you nothing about which guarantee broke.
    const f = flaky(1)
    let loaded = null, threw = null
    try { loaded = await retryImport(f.fn, { sleep: async () => {} })() } catch (e) { threw = e }
    ok('one transient failure is retried and succeeds',
       threw === null && loaded?.default === 'MODULE', threw?.message ?? loaded)
    ok('and it took exactly two attempts', f.calls() === 2, f.calls())
  }

  {
    const f = flaky(0)
    await retryImport(f.fn, { sleep: async () => {} })()
    ok('a chunk that loads first time is not fetched twice', f.calls() === 1, f.calls())
  }

  {
    const f = flaky(5)
    let threw = null
    try { await retryImport(f.fn, { sleep: async () => {} })() } catch (e) { threw = e }
    ok('a chunk that stays broken still throws', !!threw, threw?.message)
    ok('it gives up after the configured attempts, not forever', f.calls() === 2, f.calls())
    ok('the error that propagates is the chunk error itself',
       isChunkLoadError(threw), threw?.message)
  }

  {
    // A real bug inside the module must NOT be retried. Running it twice runs
    // any side effect it managed before throwing twice, and it is going to
    // fail identically anyway.
    let calls = 0
    const bug = async () => { calls++; throw new TypeError("Cannot read properties of undefined (reading 'x')") }
    let threw = null
    try { await retryImport(bug, { sleep: async () => {} })() } catch (e) { threw = e }
    ok('an ordinary error is not retried', calls === 1, calls)
    ok('and it propagates unchanged', threw instanceof TypeError, threw?.name)
  }

  {
    // It waits between attempts rather than hammering a network that just
    // dropped a request.
    const waits = []
    const f = flaky(1)
    await retryImport(f.fn, { delayMs: 400, sleep: async ms => { waits.push(ms) } })()
    ok('it pauses before retrying', JSON.stringify(waits) === '[400]', waits)
  }
}

console.log('\nComing back to where the reload interrupted you')
{
  // sessionStorage, stubbed, because this is the handoff across a reload and
  // node has no such thing.
  const store = new Map()
  globalThis.sessionStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  }
  const { rememberPlace, reloadOnceForChunkError, takeRememberedPlace, resetRememberedPlaceForTests } =
    await import('../src/lib/chunkErrors.js')

  globalThis.location = { reload: () => {} }

  resetRememberedPlaceForTests()
  store.clear()
  rememberPlace({ petId: 'pet-1', tab: 'vaccinations' })
  ok('the reload is taken', reloadOnceForChunkError() === true)

  resetRememberedPlaceForTests()
  const back = takeRememberedPlace()
  ok('the pet comes back', back?.petId === 'pet-1', back)
  ok('and the tab comes back', back?.tab === 'vaccinations', back)

  // The read must be stable for the whole page load. React renders a component
  // many times and StrictMode mounts it twice; a read-once-and-forget gave the
  // place to the first mount and null to the second, so the restore silently
  // never happened. That is a real bug this caught.
  ok('a second read in the same load still answers',
     takeRememberedPlace()?.petId === 'pet-1', takeRememberedPlace())
  ok('but storage is cleared, so the NEXT load does not resume',
     store.has('pippy_chunk_resume') === false, store.get('pippy_chunk_resume'))

  // A fresh load with nothing stashed must not navigate anywhere.
  resetRememberedPlaceForTests()
  store.clear()
  ok('an ordinary load has no resume point', takeRememberedPlace() === null, takeRememberedPlace())

  // Only one reload, however many chunks fail.
  resetRememberedPlaceForTests()
  store.clear()
  rememberPlace({ petId: 'pet-2', tab: 'medicines' })
  reloadOnceForChunkError()
  ok('a second chunk failure does not reload again', reloadOnceForChunkError() === false)

  // Nothing worth resuming when the user is not inside a pet.
  resetRememberedPlaceForTests()
  store.clear()
  rememberPlace(null)
  reloadOnceForChunkError()
  resetRememberedPlaceForTests()
  ok('no pet open means no resume point', takeRememberedPlace() === null, takeRememberedPlace())

  // Junk in storage steers navigation on boot, so it is dropped, not trusted.
  for (const junk of ['not json', '{}', '{"petId":123}', 'null', '[]']) {
    resetRememberedPlaceForTests()
    store.clear()
    store.set('pippy_chunk_resume', junk)
    ok(`junk resume point is ignored: ${junk}`, takeRememberedPlace() === null, takeRememberedPlace())
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
