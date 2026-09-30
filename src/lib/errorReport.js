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

const MAX_PER_SESSION = 10      // an error inside a render loop must not flood
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
])

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
export function buildReport(error, { view } = {}) {
  const e = error || {}
  return {
    name:    String(e.name || 'Error').slice(0, 60),
    message: scrub(e.message || String(e)),
    stack:   scrub(e.stack).slice(0, MAX_STACK),
    // A closed set, never a free string. See the note at the top of this file.
    view:    VIEWS.has(view) ? view : 'unknown',
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
export function reportError(error, opts = {}) {
  try {
    if (sentCount >= MAX_PER_SESSION) return
    const report = buildReport(error, { view: opts.view || currentView })
    const fp = fingerprint(error || {})
    if (seen.has(fp)) return
    seen.add(fp)
    sentCount++

    const body = JSON.stringify(report)
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
