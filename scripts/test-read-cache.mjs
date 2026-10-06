// The read-through cache behind the pet tabs. Run: npm run test:read-cache
//
// Tab switches unmount and remount, so every switch refetched rows that had
// not changed, over a 120-180 ms round trip to Seoul. Caching those reads is
// the fix -- and it is also the kind of fix that, done carelessly, shows a pet
// parent the vaccination date they just replaced and makes them think the app
// lost their record.
//
// So the test that matters here is not "does it cache". It is "can a save ever
// be followed by a stale read", and the answer has to be no by ordering rather
// than by timing.

import { createReadCache } from '../src/lib/readCache.js'

// `cached` hands the loader to a microtask, so that a loader throwing
// synchronously becomes a rejection rather than an exception out of the call.
// The cache entry is stored synchronously, so sharing is unaffected -- but a
// test that wants to see the loader having run has to let the queue drain.
const tick = () => new Promise(r => setTimeout(r, 0))

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

/** A loader that counts how many times it actually ran. */
function counter(value = () => [{ id: 1 }]) {
  const f = async () => { f.calls++; return value() }
  f.calls = 0
  return f
}

// A controllable clock, so nothing here has to sleep.
function clockAt(t = 1_000) {
  const c = () => c.t
  c.t = t
  return c
}

console.log('\nIt caches')
{
  const now = clockAt()
  const { cached } = createReadCache({ enabled: true, ttlMs: 30_000, now })
  const load = counter()

  await cached('vaccinations', 'pet-1', load)
  await cached('vaccinations', 'pet-1', load)
  await cached('vaccinations', 'pet-1', load)
  ok('three reads of the same thing make one request', load.calls === 1, load.calls)

  now.t += 29_999
  await cached('vaccinations', 'pet-1', load)
  ok('still cached just inside the TTL', load.calls === 1, load.calls)

  now.t += 2
  await cached('vaccinations', 'pet-1', load)
  ok('refetched once the TTL passes', load.calls === 2, load.calls)
}

console.log('\nScopes do not bleed into each other')
{
  const { cached } = createReadCache({ now: clockAt() })
  const a = counter(() => [{ pet: 'a' }])
  const b = counter(() => [{ pet: 'b' }])

  const ra = await cached('bills', 'pet-a', a)
  const rb = await cached('bills', 'pet-b', b)
  ok('two pets are two cache entries', a.calls === 1 && b.calls === 1)
  ok("one pet's bills are not served for another",
     ra[0].pet === 'a' && rb[0].pet === 'b', [ra, rb])

  const t1 = counter(), t2 = counter()
  await cached('bills', 'pet-a', t1)
  await cached('medicines', 'pet-a', t2)
  ok('two tables are two cache entries', t2.calls === 1, t2.calls)
}

console.log('\nConcurrent readers share one request')
{
  // The timeline asks for four tables at once. Without this, a tab mounting
  // while a prefetch is still in flight doubles the request rather than
  // joining it.
  const { cached } = createReadCache({ now: clockAt() })
  let calls = 0
  let release
  const slow = () => { calls++; return new Promise(r => { release = r }) }

  const a = cached('reminders', 'p', slow)
  const b = cached('reminders', 'p', slow)
  const c = cached('reminders', 'p', slow)
  await tick()
  ok('three simultaneous readers make ONE request', calls === 1, calls)

  release([{ id: 7 }])
  const [ra, rb, rc] = await Promise.all([a, b, c])
  ok('and all three get the answer',
     ra[0].id === 7 && rb[0].id === 7 && rc[0].id === 7, [ra, rb, rc])
}

console.log('\nA save is never followed by a stale read')
{
  // THE test. `bust` clears inside `finally`, which settles before the
  // returned promise does -- so a component that awaits its save and then
  // refetches cannot be handed the pre-save rows. If this ever fails, someone
  // sees the record they just corrected revert in front of them.
  const { cached, bust } = createReadCache({ now: clockAt() })
  let rows = [{ date: 'old' }]
  const load = counter(() => rows)

  const before = await cached('vaccinations', 'p', load)
  ok('the first read sees the old value', before[0].date === 'old', before)

  await bust('vaccinations', async () => { rows = [{ date: 'new' }] })

  const after = await cached('vaccinations', 'p', load)
  ok('the read straight after the save sees the NEW value',
     after[0].date === 'new', after)
  ok('which means it really refetched', load.calls === 2, load.calls)

  // The TTL plays no part in the guarantee above: the clock never moved.
}

console.log('\nA write that throws still clears')
{
  // A failed write may have applied anyway -- a timeout on the response says
  // nothing about whether Postgres committed. Keeping the old rows after that
  // is the worse guess.
  const { cached, bust } = createReadCache({ now: clockAt() })
  let rows = [{ v: 'old' }]
  const load = counter(() => rows)
  await cached('bills', 'p', load)

  let threw = false
  try {
    await bust('bills', async () => { rows = [{ v: 'maybe-applied' }]; throw new Error('timeout') })
  } catch { threw = true }

  ok('the error still reaches the caller', threw)
  const after = await cached('bills', 'p', load)
  ok('and the cache was cleared regardless', after[0].v === 'maybe-applied', after)
}

console.log('\nDeleting a pet clears everything')
{
  // The delete cascades in Postgres: the pet's records, vaccinations, bills
  // and reminders all go with it. Clearing only the pets table would leave
  // every other tab holding rows for an animal that no longer exists.
  const { cached, bust, size } = createReadCache({ now: clockAt() })
  await cached('pets', null, counter())
  await cached('vaccinations', 'p', counter())
  await cached('bills', 'p', counter())
  ok('three entries held', size() === 3, size())

  await bust('*', async () => {})
  ok('a cascading delete clears all of them', size() === 0, size())
}

console.log('\nA failed read is not remembered as a failure')
{
  const { cached } = createReadCache({ now: clockAt() })
  let attempt = 0
  const flaky = async () => {
    attempt++
    if (attempt === 1) throw new Error('network')
    return [{ ok: true }]
  }

  let first = null
  try { await cached('medicines', 'p', flaky) } catch (e) { first = e.message }
  ok('the failure is reported', first === 'network', first)

  const second = await cached('medicines', 'p', flaky)
  ok('the next read actually retries rather than replaying the error',
     second[0].ok === true, second)
}

console.log('\nCallers cannot corrupt the cache')
{
  // A tab that sorts its rows in place would otherwise reorder what every
  // later reader sees.
  const { cached } = createReadCache({ now: clockAt() })
  const load = counter(() => [{ id: 1, name: 'Poppy' }, { id: 2, name: 'Pino' }])

  const first = await cached('pets', null, load)
  first.reverse()
  first[0].name = 'MUTATED'

  const second = await cached('pets', null, load)
  ok('a mutated result does not change the next read',
     second[0].name === 'Poppy' && second[1].name === 'Pino', second)
  ok('and it was still served from cache', load.calls === 1, load.calls)
}

console.log('\nA read started before a save does not poison the one after')
{
  const { cached, bust } = createReadCache({ now: clockAt() })
  let rows = [{ v: 'old' }]
  let release
  const slow = () => new Promise(r => { release = () => r(rows) })

  const inFlight = cached('reminders', 'p', slow)      // started first
  await tick()                                         // let it actually begin
  await bust('reminders', async () => { rows = [{ v: 'new' }] })
  release()
  await inFlight

  const after = await cached('reminders', 'p', async () => rows)
  ok('the entry the save cleared is not reinstated by the older read',
     after[0].v === 'new', after)
}

console.log('\nLocal mode is passed straight through')
{
  // No Supabase: reads are synchronous localStorage and caching them would add
  // a staleness risk in exchange for nothing.
  const { cached, bust, size } = createReadCache({ enabled: false, now: clockAt() })
  const load = counter()
  await cached('pets', null, load)
  await cached('pets', null, load)
  ok('nothing is cached', load.calls === 2 && size() === 0, [load.calls, size()])

  let ran = false
  const out = await bust('pets', async () => { ran = true; return 'saved' })
  ok('writes still run and still return their value', ran && out === 'saved', out)
}

console.log('\nAwkward input does not break it')
{
  const { cached } = createReadCache({ now: clockAt() })
  const n = counter(() => null)
  ok('a null result is handled', (await cached('x', 'p', n)) === null)

  const u = counter(() => undefined)
  ok('an undefined result is handled', (await cached('y', 'p', u)) === undefined)

  // A null scope and the string '*' land on the same key by design: both mean
  // "every row", which is what getPets() with no filter asks for.
  const a = counter(() => [{ s: 'all' }])
  await cached('z', null, a)
  const r = await cached('z', undefined, a)
  ok('null and undefined scope share one entry', a.calls === 1 && r[0].s === 'all', a.calls)

  const nonObj = counter(() => 42)
  ok('a non-array result is handled', (await cached('w', 'p', nonObj)) === 42)
}

console.log('\nComing back after being away drops the cache')
{
  // The case: you mark a vaccination done on your phone, then look at the
  // laptop tab you left open this morning. The laptop never saw that write.
  //
  // A fake document and window, so the listeners can be driven directly.
  const fake = () => {
    const ls = {}
    return {
      visibilityState: 'visible',
      addEventListener: (k, f) => { (ls[k] ||= []).push(f) },
      removeEventListener: (k, f) => { ls[k] = (ls[k] || []).filter(g => g !== f) },
      fire: (k) => (ls[k] || []).forEach(f => f()),
      count: (k) => (ls[k] || []).length,
    }
  }

  {
    const now = clockAt()
    const { cached, size, installAwayInvalidation } = createReadCache({ now })
    const doc = fake(), win = fake()
    installAwayInvalidation({ doc, win, minAwayMs: 10_000 })

    await cached('vaccinations', 'p', counter())
    await cached('bills', 'p', counter())
    ok('two entries held before going away', size() === 2, size())

    doc.visibilityState = 'hidden'; doc.fire('visibilitychange')
    now.t += 60_000                                   // a minute on your phone
    doc.visibilityState = 'visible'; doc.fire('visibilitychange')
    ok('coming back after a minute drops everything', size() === 0, size())
  }

  {
    // The threshold is the whole point of the parameter: alt-tabbing to copy a
    // vet's phone number must not throw the cache away and re-fetch every tab.
    const now = clockAt()
    const { cached, size, installAwayInvalidation } = createReadCache({ now })
    const doc = fake(), win = fake()
    installAwayInvalidation({ doc, win, minAwayMs: 10_000 })

    const load = counter()
    await cached('vaccinations', 'p', load)
    doc.visibilityState = 'hidden'; doc.fire('visibilitychange')
    now.t += 2_000                                    // a two-second glance
    doc.visibilityState = 'visible'; doc.fire('visibilitychange')
    ok('a brief glance away keeps the cache', size() === 1, size())

    await cached('vaccinations', 'p', load)
    ok('and still serves it without a request', load.calls === 1, load.calls)
  }

  {
    // Desktop app-switching fires blur/focus with NO visibilitychange, because
    // the page stays visible. Listening to only one of the two pairs would
    // miss half the cases.
    const now = clockAt()
    const { cached, size, installAwayInvalidation } = createReadCache({ now })
    const doc = fake(), win = fake()
    installAwayInvalidation({ doc, win, minAwayMs: 10_000 })

    await cached('reminders', 'p', counter())
    win.fire('blur')
    now.t += 30_000
    win.fire('focus')
    ok('window blur/focus alone also drops it', size() === 0, size())
  }

  {
    // Mobile backgrounding fires BOTH pairs. The away clock must not be
    // restarted by the second one, or a long absence reads as a short one.
    const now = clockAt()
    const { cached, size, installAwayInvalidation } = createReadCache({ now })
    const doc = fake(), win = fake()
    installAwayInvalidation({ doc, win, minAwayMs: 10_000 })

    await cached('medicines', 'p', counter())
    win.fire('blur')
    doc.visibilityState = 'hidden'; doc.fire('visibilitychange')   // both fire
    now.t += 60_000
    doc.visibilityState = 'visible'; doc.fire('visibilitychange')
    win.fire('focus')
    ok('overlapping signals still count the full absence', size() === 0, size())
  }

  {
    // A focus with no preceding blur -- the first focus after load -- must not
    // be read as "returned from an infinitely long absence" and clear a cache
    // that was just filled.
    const now = clockAt()
    const { cached, size, installAwayInvalidation } = createReadCache({ now })
    const doc = fake(), win = fake()
    installAwayInvalidation({ doc, win, minAwayMs: 10_000 })

    await cached('bills', 'p', counter())
    win.fire('focus')
    ok('a focus with no blur before it changes nothing', size() === 1, size())
  }

  {
    const { installAwayInvalidation } = createReadCache({ now: clockAt() })
    const doc = fake(), win = fake()
    const stop = installAwayInvalidation({ doc, win })
    ok('listeners are attached', doc.count('visibilitychange') === 1 && win.count('blur') === 1)
    stop()
    ok('and the returned function removes them',
       doc.count('visibilitychange') === 0 && win.count('blur') === 0)
  }

  {
    // Local mode has no cache, so there is nothing to install.
    const { installAwayInvalidation } = createReadCache({ enabled: false, now: clockAt() })
    const doc = fake(), win = fake()
    installAwayInvalidation({ doc, win })
    ok('nothing is attached when the cache is off',
       doc.count('visibilitychange') === 0 && win.count('blur') === 0)
  }

  {
    // Node, SSR, a locked-down embed: no document and no window at all.
    const { installAwayInvalidation } = createReadCache({ now: clockAt() })
    let threw = false
    try { installAwayInvalidation({ doc: null, win: null }) } catch { threw = true }
    ok('no document or window does not throw', !threw)
  }
}

console.log('\nOne write can clear more than one table')
{
  // The bug this covers: getPets() carries each pet's latest weight, read from
  // weight_logs. saveWeightLog cleared only 'weight_logs', so recording a
  // weight left the pet card and the emergency card showing the PREVIOUS
  // figure for up to the TTL -- which is the exact complaint the derived
  // weight was added to fix, reappearing in a 30-second window.
  const now = clockAt()
  const { cached, bust, size } = createReadCache({ now })

  const pets = counter(() => [{ name: 'Mapple', latestWeight: 1.7 }])
  const logs = counter(() => [{ weight: 1.7 }])
  await cached('pets', null, pets)
  await cached('weight_logs', 'p', logs)
  ok('both are cached', size() === 2, size())

  await bust(['weight_logs', 'pets'], async () => {})
  ok('an array clears every table named', size() === 0, size())

  // And the single-table form still behaves.
  await cached('pets', null, pets)
  await cached('weight_logs', 'p', logs)
  await bust('weight_logs', async () => {})
  ok('a plain string still clears exactly one', size() === 1, size())

  // '*' inside an array still means everything, so a cascading delete that
  // also names a table cannot accidentally narrow itself.
  await cached('bills', 'p', counter())
  await bust(['pets', '*'], async () => {})
  ok("'*' anywhere in the array clears everything", size() === 0, size())

  // An array write still clears before the caller's await returns, which is
  // the ordering the whole module rests on.
  let rows = [{ v: 'old' }]
  const load = counter(() => rows)
  await cached('pets', null, load)
  await bust(['weight_logs', 'pets'], async () => { rows = [{ v: 'new' }] })
  const after = await cached('pets', null, load)
  ok('the read straight after an array write is fresh', after[0].v === 'new', after)

  // A single-element array is the same as the string.
  await cached('medicines', 'p', counter())
  await bust(['medicines'], async () => {})
  ok('a one-element array works', size() === 1, size())
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
