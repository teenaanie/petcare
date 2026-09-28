// src/lib/net.js
//
// Retrying the requests that WebKit drops.
//
// Measured, not guessed. On 2026-09-28 an iPhone (iOS 18.7, Safari 26.6) saved
// a voice update as three writes in a row. Supabase's edge log shows:
//
//   11:57:04.073  POST medical_records  201
//   11:57:04.701  POST vaccinations     201
//                 third write — no log entry at all
//   11:57:34.043  POST weight_logs      201   (the user's own retry)
//
// The third request never reached the server. No status, no row, nothing —
// it failed on the phone, which is why it surfaced as `TypeError: Load failed`
// rather than any HTTP error. Retrying it by hand worked immediately.
//
// This is the same WebKit behaviour friendlyError() was written for: a
// connection in the pool goes away — after a pause, after the app was in the
// background, after a network handover — and the next fetch onto it fails
// before a byte is sent. The browser does not retry it for us.
//
// SO ONLY RETRY WHAT IS SAFE TO REPEAT. A request that never left the phone
// cannot have changed anything, but from the client a dropped connection and a
// lost RESPONSE look identical, and retrying an INSERT whose response was lost
// writes the record twice. Callers say which case they are in.

/**
 * True when an error means "this never got a reply", rather than "the server
 * said no". Every engine words it differently:
 *   Safari / iOS   "Load failed"
 *   Chrome / Edge  "Failed to fetch"
 *   Firefox        "NetworkError when attempting to fetch resource"
 *
 * A PostgREST or Supabase refusal arrives as a normal object with a real
 * message and a code, and must NOT be retried — it will be refused again.
 */
export function isNetworkError(e) {
  if (!e) return false
  const msg = (e.message || String(e)).toLowerCase()
  // A PostgREST error carries a code (e.g. PGRST116, 42703). Those are answers,
  // not failures to reach anything.
  if (e.code && !/^(econn|enet|etimedout|fetch)/i.test(String(e.code))) return false
  return /load failed|failed to fetch|networkerror|network request failed|connection|timeout|timed out/.test(msg)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Run `fn`, retrying only network-class failures.
 *
 * @param {Function} fn        the call to make; receives the attempt number
 * @param {object}   [opts]
 * @param {number}   [opts.attempts=3]  total attempts, including the first
 * @param {number}   [opts.delayMs=400] wait before retry 1; doubles after
 *
 * The delay matters. Retrying instantly onto the same dead connection usually
 * fails the same way; a few hundred milliseconds is enough for WebKit to open
 * a new one.
 */
export async function withRetry(fn, { attempts = 3, delayMs = 400 } = {}) {
  let last
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i)
    } catch (e) {
      last = e
      if (!isNetworkError(e) || i === attempts) throw e
      // Worth seeing in a bug report: it says the app recovered rather than
      // that nothing happened.
      console.warn(`Request failed to reach the server (attempt ${i}/${attempts}), retrying:`, e?.message || e)
      await sleep(delayMs * 2 ** (i - 1))
    }
  }
  throw last
}
