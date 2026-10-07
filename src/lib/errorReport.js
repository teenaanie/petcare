// src/lib/errorReport.js
//
// When something breaks in a pet parent's browser, this is what tells us.
//
// The motivating case: a customer reported the voice feature hanging. The only
// reason it could be diagnosed at all was that the SUCCESSFUL call left a row
// in api_usage and the failed one left nothing — the cause was deduced from an
// absence. A hang, a crash, a white screen: none of them leave any trace today.
//
// ── What this must never do ─────────────────────────────────────────────────
//
// Pippy holds vaccination records, medicine names, vet phone numbers and
// people's own notes about their animals. An error report is not worth one
// byte of that leaking, so everything is scrubbed HERE, in the browser, before
// it is sent. The server scrubs again, but the guarantee that matters is that
// the data never leaves the device in the first place.
//
// The specific trap, learned the hard way on this project: a filter that
// accepts anything "shaped right" will pass real data through. A pet's name
// reached Google Analytics because "Bruno" is a plain word and the shape filter
// saw nothing wrong with it. So `view` below is a CLOSED SET, not a string —
// an unrecognised value is dropped rather than forwarded.

import { isNetworkError } from './net.js'

// How much one session may send. The cap exists because an error inside a
// render loop must not flood, and the per-fingerprint dedupe below means
// reaching either number takes that many DISTINCT faults.
//
// It was 10 when only uncaught faults could get here. Now that about forty
// caught paths feed the same budget, 10 is too tight: a session that hits
// several handled faults could spend the lot and then silently drop the crash
// that followed -- which is the one report nobody can reconstruct afterwards,
// because the user's screen went white and they closed the tab.
const MAX_PER_SESSION = 25

// Raising the ceiling alone does not fix that, it only makes it less likely.
// Handled faults are the common kind by far, so they get their own smaller
// budget and uncaught faults keep the difference -- at least
// MAX_PER_SESSION - MAX_HANDLED_PER_SESSION of headroom that no amount of
// caught-and-shown noise can touch. A crash is never dropped to make room for
// a message somebody already read.
const MAX_HANDLED_PER_SESSION = 15

// Browser housekeeping that fails in ways nobody experiences.
//
// A service worker update that aborts -- the tab closed, another update was
// already in flight, iOS had no installed worker to compare against -- is not a
// fault. It is routine, it is invisible to the user, and there is nothing to
// fix. The first three reports Pippy ever collected were all of this, which is
// exactly how a useful list becomes one nobody reads.
//
// The source of those is fixed too (index.html now catches them), so this is
// the net rather than the fix. It is kept deliberately narrow: anything that
// is not plainly service-worker lifecycle still gets through.
const IGNORED = [
  /failed to (update|register) a serviceworker/i,
  /newestworker is null/i,
  /the operation was aborted.*serviceworker/i,
]
const MAX_MESSAGE     = 300
const MAX_STACK       = 1500

// Everywhere a report may say it came from. Anything not on this list becomes
// 'unknown'. This is the closed set, and it is the whole defence against a
// caller one day passing something like a pet's name as context.
const VIEWS = new Set([
  'landing', 'sign-in', 'pet-list', 'pet-detail', 'timeline', 'medical',
  'vaccinations', 'medicines', 'weight', 'bills', 'allergies', 'journal',
  'scanner', 'reminders', 'boarding', 'voice-update', 'voice-intake',
  'health-summary', 'emergency-card', 'sharing', 'providers', 'my-providers',
  'admin', 'provider-registration', 'shared-import', 'unknown',
  // Added when the caught-error paths were wired up: each of these screens
  // shows a fault in its own UI, so a report from one needs somewhere to say
  // so. A name is added here rather than passed as free text, for the reason
  // at the top of this file.
  'delete-account', 'migrate-data', 'notifications', 'boarding-rules',
  'pet-photo',
  // The provider platform, phases 3-6. These shipped without being added here,
  // so every fault in the inform-note and stay-update paths was filed as
  // 'unknown' — which is the one screen attribution you most want when the
  // first real boarder hits a bug. test:error-report caught it; it was run
  // late because the provider phases were verified with the provider suites
  // rather than the whole suite.
  'inform-provider', 'inform-provider-draft', 'inform-provider-send',
  'stay-updates', 'stay-update-post', 'stay-update-delete',
  'provider-inbox', 'provider-broadcast', 'provider-sign-in',
])

// How a report reached us. Two values, and deliberately a closed set like
// `view` above rather than a free label.
//
//   'uncaught'  nobody handled it: the window-level listeners below caught it,
//               or an error boundary did. These produce a white screen.
//   'handled'   a component caught it and showed the user a message. The
//               feature failed but the app stayed up.
//
// The distinction is worth storing because for a year the Errors tab held only
// the first kind, which are the MINORITY. The PetSharing bug below broke the
// share panel on every single open and left zero rows, because getMembers()
// threw, the component caught it and rendered it, and window.onerror never
// fired. A customer had to report it. On the dashboard these two want reading
// differently: an uncaught fault is an outage, a handled one is a feature that
// is quietly broken for everybody who tries it.
const KINDS = new Set(['uncaught', 'handled'])

/**
 * Strip anything that could identify a person or their animal.
 *
 * Errors carry user data far more often than you would expect: a Postgres
 * unique-violation quotes the offending value, a parse failure quotes the
 * transcript, a fetch error carries the full URL with its query string.
 */
export function scrub(text) {
  if (!text) return ''
  return String(text)
    // Order matters: emails before phone numbers, or the digits inside an
    // address get mangled first and the address stops matching.
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[email]')
    // A UUID is a pet or user id. Not a name, but it points straight at one.
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    // Long digit runs: phone numbers, account numbers, anything of that shape.
    .replace(/(?:\+?\d[\d\s-]{6,}\d)/g, '[number]')
    // Query strings and fragments carry whatever the app put in them.
    .replace(/([?#])[^\s"')]+/g, '$1[redacted]')
    // Bearer tokens and keys, in case one is ever quoted back in an error.
    .replace(/\b(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_[a-z]+_[\w-]+|sk-[\w-]+)/g, '[token]')
    .slice(0, MAX_MESSAGE)
}

/** Coarse browser identification. Deliberately not the full user-agent string. */
function browserLabel() {
  const ua = navigator.userAgent || ''
  const engine =
    /CriOS|Chrome/.test(ua) ? 'Chrome' :
    /FxiOS|Firefox/.test(ua) ? 'Firefox' :
    /Edg/.test(ua) ? 'Edge' :
    /Safari/.test(ua) ? 'Safari' : 'other'
  const os =
    /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
    /Android/.test(ua) ? 'Android' :
    /Mac OS/.test(ua) ? 'macOS' :
    /Windows/.test(ua) ? 'Windows' : 'other'
  return `${engine} on ${os}`
}

/**
 * A stable identity for "the same bug", used to send each one once per session.
 *
 * Built from the error's name, its scrubbed message and its first stack frame,
 * so the same fault repeating in a loop reports once rather than ten thousand
 * times.
 */
export function fingerprint({ name, message, stack }) {
  const frame = String(stack || '').split('\n')[1]?.trim().slice(0, 120) || ''
  return `${name || 'Error'}|${scrub(message)}|${scrub(frame)}`
}

/** What actually gets sent. Exported so a test can assert on it directly. */
export function buildReport(error, { view, kind } = {}) {
  const e = error || {}
  return {
    name:    String(e.name || 'Error').slice(0, 60),
    message: scrub(e.message || String(e)),
    stack:   scrub(e.stack).slice(0, MAX_STACK),
    // A closed set, never a free string. See the note at the top of this file.
    view:    VIEWS.has(view) ? view : 'unknown',
    // Likewise closed. Anything unrecognised is treated as uncaught, which is
    // the pessimistic reading and the one that was true before this existed.
    kind:    KINDS.has(kind) ? kind : 'uncaught',
    // Only the path, never the query or the hash.
    path:    String(location.pathname || '/').slice(0, 80),
    build:   typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev',
    browser: browserLabel(),
    online:  navigator.onLine !== false,
    at:      new Date().toISOString(),
  }
}

// ── The reporter ────────────────────────────────────────────────────────────

const seen = new Set()
let sentCount = 0
let handledCount = 0
let currentView = 'unknown'
let installed = false

/** Tell the reporter which screen the user is on. Ignored unless recognised. */
export function setErrorView(view) {
  currentView = VIEWS.has(view) ? view : 'unknown'
}

/**
 * Report one error. Never throws and never rejects: a failure to report a
 * problem must not itself become a problem the user sees.
 */
/** The token of whoever is signed in, so a report can be attributed. */
let authToken = null

/**
 * Tell the reporter who is signed in.
 *
 * sendBeacon cannot set headers, so the token travels in the body instead --
 * which is why this exists at all. Without it every report arrives anonymous
 * and the dashboard says "0 people" for faults that in fact hit someone
 * specific, which is what it said for every report until now.
 */
export function setErrorUser(token) { authToken = token || null }

export function reportError(error, opts = {}) {
  try {
    if (sentCount >= MAX_PER_SESSION) return
    // Resolved before the budget check, because which budget applies depends
    // on it. An unrecognised value reads as 'uncaught' here exactly as it does
    // in buildReport, so a caller cannot reach the reserved headroom by
    // passing something the set does not know.
    const kind = KINDS.has(opts.kind) ? opts.kind : 'uncaught'
    if (kind === 'handled' && handledCount >= MAX_HANDLED_PER_SESSION) return
    const raw = String(error?.message || error || '')
    if (IGNORED.some(re => re.test(raw))) return
    const report = buildReport(error, { view: opts.view || currentView, kind })
    const fp = fingerprint(error || {})
    if (seen.has(fp)) return
    seen.add(fp)
    sentCount++
    if (kind === 'handled') handledCount++

    // The token goes in the body because sendBeacon cannot set headers. The
    // endpoint verifies it the same way either way, so nothing is weakened --
    // and a body is not written to access logs the way a URL would be.
    const body = JSON.stringify(authToken ? { ...report, token: authToken } : report)
    // sendBeacon survives the page being closed, which is exactly when a fatal
    // error tends to happen. It is fire-and-forget by design: there is no
    // response to wait for and nothing useful to do if it fails.
    if (navigator.sendBeacon?.(
      '/api/report-error', new Blob([body], { type: 'application/json' }))) return

    fetch('/api/report-error', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body, keepalive: true,
    }).catch(() => { /* reporting is best effort */ })
  } catch { /* never let the reporter break the app */ }
}

// ── Faults a component caught and showed the user ───────────────────────────
//
// reportError above is reached by the window-level listeners, so for a year it
// saw only crashes. The faults that reach a person as a red message in the UI
// never reached it at all, and those are the majority.
//
// So this exists, and the only hard part is the filter. The Errors tab has
// already been made unreadable once -- its first three rows were all service
// worker housekeeping nobody experienced -- and a catch block fires on far
// more than defects. Everything below is a condition the app is SUPPOSED to
// hit, which a pet parent causes in the ordinary course of using Pippy, and
// which there is nothing to fix about.

// DOMException names that mean a device or a person said no, not that the code
// is wrong. A denied microphone permission is a choice; a missing microphone is
// a laptop.
const EXPECTED_NAMES = new Set([
  'AbortError', 'NotAllowedError', 'NotFoundError', 'NotReadableError',
  'OverconstrainedError', 'SecurityError',
])

// Postgres and PostgREST answers that are a "no", not a breakage.
//   PGRST116  no rows where one was expected -- an empty result
//   23505     unique violation: "that email already has access to this pet"
//   23514     check violation: a value the schema refuses, i.e. validation
const EXPECTED_CODES = new Set(['PGRST116', '23505', '23514'])

const EXPECTED_MESSAGES = [
  // Rate limits and quotas. Hitting the OpenAI cap is the cap working.
  /\b429\b|too many requests|rate limit|quota (exceeded|reached)|limit reached/i,
  // Somebody closed the sheet, or the browser stopped a request we started.
  /\bcancell?ed\b|\baborted\b|user denied|permission (denied|dismissed) by/i,
  // ai.js rewrites its own timeout into this. A 45-second AI call that does not
  // come back on a phone train is the network, not a defect.
  /took longer than \d+ seconds/i,
  // ai.js rewrites an unreachable server into this before it is ever thrown,
  // so isNetworkError() cannot see the original TypeError any more.
  /could not reach the server/i,
  // Nobody is signed in yet. Expected on every first load of a protected view.
  /please sign in|not authenticated|no session|jwt expired/i,
]

/**
 * Whether a caught error is a condition the app is meant to hit.
 *
 * Exported so a test can pin each case down: the cost of getting this wrong is
 * a dashboard nobody reads, which is the same as no dashboard.
 *
 * Two things are deliberately NOT treated as expected, because both look like
 * an ordinary "no" and neither is:
 *
 *   A permissions or row-level-security refusal. A refusal that reaches the
 *   user means the screen offered an action they were never allowed to take,
 *   and that is a bug in the screen.
 *
 *   A missing table or column ("schema cache", "does not exist"). That is a
 *   migration nobody ran, which is exactly the sort of thing that should not
 *   need a customer to notice it.
 */
export function isExpected(error) {
  if (!error) return true

  // Offline is not a defect, and while offline NOTHING is diagnosable -- every
  // request fails for the same uninteresting reason.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true

  // A request that got no reply. Already excluded from friendlyError() for the
  // same reason: this is the normal weather of a phone, and reporting it would
  // bury the real faults under thousands of rows of "the wifi went".
  if (isNetworkError(error)) return true

  // ai.js sets this when the server says the usage cap is reached.
  if (error.limitReached) return true

  if (EXPECTED_NAMES.has(error.name)) return true
  if (error.code && EXPECTED_CODES.has(String(error.code))) return true
  if (error.status === 429 || error.statusCode === 429) return true

  const msg = String(error.message || error)
  return EXPECTED_MESSAGES.some(re => re.test(msg))
}

/**
 * Report a fault that a component caught and showed to the user.
 *
 * Call this from a catch block that sets a user-visible error state -- next to
 * the setError(), not instead of it. Conditions the app is meant to hit are
 * dropped here rather than at each call site, so a caller does not have to
 * remember the list; a caller's own validation message is not an error object
 * and should never be passed in at all.
 *
 * Never throws: it is wrapped exactly as reportError is.
 */
export function reportHandled(error, opts = {}) {
  try {
    if (isExpected(error)) return
    reportError(error, { ...opts, kind: 'handled' })
  } catch { /* never let the reporter break the app */ }
}

/**
 * Catch what no component caught: uncaught exceptions and rejected promises
 * nobody handled. These are the ones that produce a white screen or a control
 * that silently stops working, and they are invisible today.
 */
export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (e) => {
    // Resource load failures (a broken <img>) also fire this with no error
    // object. They are not faults worth a report.
    if (!e.error) return
    reportError(e.error)
  })

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    reportError(r instanceof Error ? r : { name: 'UnhandledRejection', message: String(r) })
  })
}
