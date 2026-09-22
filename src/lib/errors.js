// src/lib/errors.js

/**
 * Turns a thrown error into something a pet parent can act on.
 *
 * A fetch that never completes throws a TypeError carrying the browser's own
 * wording, and every browser picks a different one:
 *
 *   Safari / iOS   "Load failed"
 *   Chrome / Edge  "Failed to fetch"
 *   Firefox        "NetworkError when attempting to fetch resource"
 *
 * All three mean the same thing and none of them mean anything to the person
 * reading them. "Load failed" in particular reads like the app is broken, when
 * the request simply never left the phone.
 *
 * This is ordinary on mobile rather than exotic. An installed PWA that has been
 * in the background has its connections torn down, so the first request after
 * the user switches back can fail this way — write a note, take a call, come
 * back, tap Save, "Load failed". Tapping again usually just works, which is
 * exactly what the message needs to say.
 *
 * Anything that reached the server — a permissions refusal, a validation error —
 * arrives as a normal error with a real message, and is passed through
 * untouched. Only the unreachable case is rewritten.
 */
export function friendlyError(e) {
  const msg = e?.message || String(e ?? '')
  const looksNetwork =
    e instanceof TypeError ||
    /load failed|failed to fetch|networkerror|network request failed/i.test(msg)

  return looksNetwork
    ? "Couldn't reach the server — check your connection and try again."
    : msg
}
