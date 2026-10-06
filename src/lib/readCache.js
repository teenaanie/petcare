// src/lib/readCache.js
//
// A short-lived read-through cache for the pet record tables.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// Moving between a pet's tabs felt slow, and the bytes were not the reason.
// Each tab is a separate component that fetches on mount, and PetDetail
// renders them as `{activeTab === 'x' && <Tab/>}` -- so every switch unmounts
// the old tab and mounts the new one from scratch. Medical → Vaccinations →
// back to Medical fetched the medical records twice.
//
// The round trip is the cost, not the query. The database is in
// ap-northeast-2 (Seoul) and Pippy's users are in Pune. Measured against the
// live project, an empty indexed read of one pet's vaccinations takes 241 ms
// and of their reminders 259 ms -- almost all of it distance, since there are
// no rows to fetch. That was being paid again on every switch back to a tab,
// for rows that had not changed. Repeating the same read through this cache
// measured 0 ms.
//
// Two separate things are cached, and the second matters as much as the first:
//
//   1. A result is reused for `ttlMs`, so returning to a tab you just left is
//      instant.
//   2. The in-flight PROMISE is stored, not the resolved value. Two callers
//      asking for the same thing before the first answer arrives share one
//      request. The timeline asks for four tables at once, so this happens on
//      an ordinary page load rather than only in theory.
//
// ── The dangerous part ──────────────────────────────────────────────────────
//
// A stale read here is not a cosmetic glitch. It is a pet parent saving a
// vaccination date, being shown the old one, and concluding the app lost their
// record. The guarantee that prevents that is NOT the TTL -- it is the
// ordering in `bust`: a write clears its table before the caller's `await`
// returns, so a component that saves and then refetches cannot be served the
// pre-save rows. The TTL is only a backstop for writes made somewhere else
// entirely, like the nightly reminder cron or another device.
//
// `installAwayInvalidation` narrows that last case: coming back to the app
// after being away drops everything, so the next read goes to the database
// rather than to a cache filled before you left. See the note on it below for
// what it deliberately does NOT do.

export const DEFAULT_TTL_MS = 30_000

function clone(value) {
  // Rows are plain JSON from the snake↔camel helpers, so this costs
  // microseconds against a 150 ms round trip -- and it stops a caller that
  // sorts or mutates its result in place from corrupting what the next reader
  // sees.
  try { return structuredClone(value) } catch { return Array.isArray(value) ? value.slice() : value }
}

/**
 * @param enabled  Off entirely when false. Local (no Supabase) mode reads
 *                 localStorage synchronously and has nothing to gain.
 * @param ttlMs    How long a result may be reused.
 * @param now      Injectable clock, so a test need not sleep.
 */
export function createReadCache({ enabled = true, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  /** table -> Map(scope -> { at, promise }) */
  const cache = new Map()

  /** Read `table` for `scope`, going to `loader` only when nothing fresh is held. */
  function cached(table, scope, loader) {
    if (!enabled) return loader()
    const key = scope == null ? '*' : String(scope)
    let byScope = cache.get(table)
    if (!byScope) { byScope = new Map(); cache.set(table, byScope) }

    const hit = byScope.get(key)
    if (hit && now() - hit.at < ttlMs) return hit.promise.then(clone)

    const entry = { at: now() }
    entry.promise = Promise.resolve().then(loader).catch((err) => {
      // A rejection is never served from cache: the next attempt must really
      // try again. Only drop our own entry -- a bust may already have replaced
      // it, and clearing that would discard a newer, good result.
      if (byScope.get(key) === entry) byScope.delete(key)
      throw err
    })
    byScope.set(key, entry)
    return entry.promise.then(clone)
  }

  /**
   * Run a write, then drop what it could have changed.
   *
   * `finally` settles before the returned promise does, so by the time a
   * caller's `await save(...)` returns, the stale rows are already gone. This
   * ordering is the correctness argument for the whole module.
   *
   * It clears on failure too: a write that threw may have applied anyway.
   * Pass '*' for a write whose effects cross tables -- deleting a pet cascades
   * in Postgres.
   */
  function bust(table, run) {
    if (!enabled) return run()
    return Promise.resolve().then(run).finally(() => {
      if (table === '*') cache.clear()
      else cache.delete(table)
    })
  }

  /** Forget everything. For writes that do not go through this module at all. */
  function invalidateAll() { cache.clear() }

  /**
   * Drop the cache when the user comes back after being away.
   *
   * The case this closes: you mark a vaccination done on your phone, then look
   * at the laptop tab you left open this morning. The laptop never saw that
   * write, so without this it could serve rows from before it.
   *
   * ── What this does NOT do, on purpose ─────────────────────────────────────
   *
   * It does not re-render what is already on screen. Clearing the cache only
   * affects the NEXT read, so a tab you return to still shows what it fetched
   * when it mounted.
   *
   * That is a deliberate choice, not an oversight. Forcing a refresh would
   * mean remounting the tab -- `dataRefresh` feeds PetDetail's `tabKey`, which
   * is the React key -- and six of the tabs hold form state. Someone part-way
   * through typing a vaccination record, who switches apps to check the date
   * on the vet's card, would come back to an empty form. Losing their typing
   * is a worse failure than showing them a figure they already knew was from
   * before they left.
   *
   * So the guarantee is narrower and honest: returning from away never leaves
   * the cache able to serve older rows than the app would have shown anyway.
   *
   * @param minAwayMs  Below this, nothing is dropped. Alt-tabbing to copy a
   *                   phone number should not throw the cache away; editing on
   *                   another device takes longer than a few seconds.
   */
  function installAwayInvalidation({ doc, win, minAwayMs = 10_000 } = {}) {
    if (!enabled) return () => {}
    const d = doc ?? (typeof document !== 'undefined' ? document : null)
    const w = win ?? (typeof window   !== 'undefined' ? window   : null)

    let awayAt = null
    // Whichever signal arrives first starts the clock; whichever returns first
    // stops it. Desktop app-switching fires blur with no visibilitychange,
    // while backgrounding on a phone fires both, so neither alone is enough.
    const away = () => { if (awayAt === null) awayAt = now() }
    const back = () => {
      if (awayAt !== null && now() - awayAt >= minAwayMs) invalidateAll()
      awayAt = null
    }
    const onVisibility = () => (d.visibilityState === 'hidden' ? away() : back())

    const off = []
    try {
      if (d?.addEventListener) {
        d.addEventListener('visibilitychange', onVisibility)
        off.push(() => d.removeEventListener('visibilitychange', onVisibility))
      }
      if (w?.addEventListener) {
        w.addEventListener('blur', away)
        w.addEventListener('focus', back)
        off.push(() => { w.removeEventListener('blur', away); w.removeEventListener('focus', back) })
      }
    } catch { /* a cache hint must never be what breaks the app */ }

    return () => { for (const f of off) { try { f() } catch {} } }
  }

  /** Entries currently held, for tests and for the admin diagnostics. */
  function size() {
    let n = 0
    for (const byScope of cache.values()) n += byScope.size
    return n
  }

  return { cached, bust, invalidateAll, size, installAwayInvalidation }
}
