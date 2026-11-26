// api/_lib/_fetch.js
//
// fetch() with a deadline. Node's fetch has no timeout of its own, so a
// provider that accepts the connection and then stalls would hold a serverless
// function open until the platform kills it, and the user would get nothing
// but a spinner.
//
// `retries` is for calls that are safe to repeat (an AI completion costs a few
// cents twice; it does not do anything twice). It is OFF by default, and must
// stay off for sends: a timed-out email or SMS may still have been delivered,
// and a retry would send it again.
//
// A timeout surfaces as an Error whose message says so, so the callers' existing
// `catch (e) { ... e.message }` paths show something readable.

export async function fetchWithTimeout(url, options = {}, { timeoutMs = 30000, retries = 0 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
      // Retry only the transient statuses, and only if a try remains.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastErr = new Error(`status ${res.status}`)
        continue
      }
      return res
    } catch (e) {
      lastErr = e?.name === 'TimeoutError'
        ? new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)
        : e
    }
  }
  throw lastErr
}
