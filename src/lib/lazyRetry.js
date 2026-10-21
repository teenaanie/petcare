// Giving a lazy chunk a second chance before blaming the user's morning.
//
// The bug this exists for, measured rather than guessed: clicking a tab in a
// pet's record sometimes failed to import that tab's chunk. The boundary
// caught it, reloaded the page once -- and the reload landed on the PET LIST,
// because the open pet lives in React state and nothing survives a reload. So
// a transient fetch failure read as "it threw me out", and clicking back in
// worked, which is exactly what it was reported as.
//
// Most of these are transient: a dropped request on a phone changing cells, a
// chunk fetched in the seconds a deploy is swapping files. One retry turns
// almost all of them into a pause nobody notices, and leaves the reload for
// the genuinely stale case it was written for.
//
// Plain .js, no JSX, so node can run its test without a build step -- same
// reasoning as chunkErrors.js next door.

import { isChunkLoadError } from './chunkErrors.js'

export const RETRY_DELAY_MS = 400

/**
 * Wrap a `() => import(...)` so a chunk fault is retried once before it
 * propagates.
 *
 * Only chunk faults are retried. An ordinary error inside the module -- a
 * syntax error, a throw at module scope -- is a real bug, and running it twice
 * would double any side effect it had already managed before throwing.
 *
 * The returned function is what React.lazy expects, and it is NOT memoised
 * here: React.lazy already calls it exactly once and caches the result itself.
 */
export function retryImport(load, { attempts = 2, delayMs = RETRY_DELAY_MS, sleep } = {}) {
  const wait = sleep || (ms => new Promise(r => setTimeout(r, ms)))
  return async function loadWithRetry() {
    let lastErr
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await load()
      } catch (err) {
        lastErr = err
        if (!isChunkLoadError(err)) throw err
        if (attempt < attempts) await wait(delayMs)
      }
    }
    throw lastErr
  }
}
