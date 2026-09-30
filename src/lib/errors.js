// src/lib/errors.js

import { isNetworkError } from './net.js'
import { reportError } from './errorReport.js'

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

  // Always leave the real error somewhere a bug report can find it. This used
  // to return the friendly string and drop the original entirely, so a genuine
  // fault was indistinguishable from a flaky connection — including to whoever
  // was trying to debug it from a screenshot of the message.
  if (e) {
    console.error('Pippy error:', e)
    // A connection that dropped is not a fault worth a report -- it is the
    // normal weather of mobile, and reporting it would bury the real faults
    // under thousands of rows of "the wifi went".
    if (!isNetworkError(e)) reportError(e)
  }

  // `e instanceof TypeError` used to be enough on its own to call something a
  // connection problem. It is not: reading a property of undefined is also a
  // TypeError, so an ordinary bug in our own code told the user their internet
  // was down and sent them to check their wifi. Only wording that actually
  // means "the request got no reply" counts, whatever the error's class.
  if (isNetworkError(e)) {
    return "Couldn't reach the server — that usually clears on its own, so try once more."
  }

  // A TypeError that is NOT a failed fetch is a fault in the app. Say so
  // honestly rather than blaming the network.
  if (e instanceof TypeError) {
    return `Something went wrong in the app (${msg}). If it keeps happening, that is a bug worth reporting.`
  }

  return msg
}
