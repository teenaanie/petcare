// src/lib/analytics.js
//
// Microsoft Clarity, loaded only if the user has said yes.
//
// WHY THIS IS NOT A SCRIPT TAG ANY MORE. Clarity was in index.html, in <head>,
// running before the app had even mounted — on every visit, for everyone. It
// records session replays: what is on screen, and what the user does with it.
// On this app that screen holds vaccination records, medicine names, a vet's
// phone number and free-text notes about a pet's skin condition.
//
// Replay of health records to a third party is not something to switch on by
// default and mention in a footer. So: nothing loads until somebody chooses
// it, the choice defaults to no, and declining is one tap and permanent.
//
// Masking is belt and braces on top. `data-clarity-mask` on the app shell
// means that even with analytics ON, the recording carries layout and clicks
// rather than the contents of anybody's records.

const CLARITY_ID = 'y24xaz7ubd'

// Google Analytics 4. Env-driven rather than hard-coded, so a deployment
// without a measurement ID simply has no Google on it — which is the right
// default for a fork, a preview build, or local development.
const GA_ID = import.meta.env?.VITE_GA_MEASUREMENT_ID || ''
export const CONSENT_KEY = 'pippy_analytics_consent'   // 'granted' | 'denied'

export function consentState() {
  try { return localStorage.getItem(CONSENT_KEY) } catch { return null }
}

export function setConsent(granted) {
  try { localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied') } catch { /* private mode */ }
  if (granted) startAnalytics()
  // Revoking mid-session deliberately does NOT tear Clarity down: the script is
  // already loaded and pretending otherwise would be a worse lie than saying
  // the change applies from the next visit. The banner says so.
}

let started = false

export function startAnalytics() {
  if (started || typeof window === 'undefined') return
  if (consentState() !== 'granted') return
  started = true

  // Clarity's own loader, unchanged apart from being called on demand.
  ;(function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments) }
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y)
  })(window, document, 'clarity', 'script', CLARITY_ID)

  startGA()
}

// ── Google Analytics ─────────────────────────────────────────────────────────
//
// Behind exactly the same gate as Clarity, for the same reason: this app's
// screens hold vaccination records, medicine names and notes about a pet's
// health, and none of that is anybody else's by default.
//
// Three settings are not defaults and are deliberate:
//   anonymize_ip                       do not store the full IP
//   allow_google_signals: false        no cross-device advertising identity
//   allow_ad_personalization_signals   the data is not for building ad audiences
// Measurement is the point; advertising is not, and the notice says so.

function startGA() {
  if (!GA_ID) return

  window.dataLayer = window.dataLayer || []
  function gtag() { window.dataLayer.push(arguments) }
  window.gtag = gtag

  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`
  document.head.appendChild(s)

  gtag('js', new Date())
  gtag('config', GA_ID, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  })
}

// Event names this app is allowed to send. A CLOSED LIST on purpose.
//
// The danger with analytics in a health app is not the tool, it is what gets
// passed to it by accident — a pet's name as a label, a medicine in an event
// parameter, a condition in a page title. Nothing reaches Google unless it is
// named here, and no free text is ever forwarded.
const EVENTS = new Set([
  'pet_added', 'voice_intake_used', 'voice_update_used', 'document_scanned',
  'reminder_created', 'reminder_done', 'health_brief_generated',
  'boarding_pack_shared', 'emergency_card_opened', 'provider_searched',
  'photo_added', 'pet_shared',
])

/**
 * Record that something happened. Never what it was about.
 *
 * @param {string} name  one of EVENTS
 * @param {object} [params] numbers and short enums only — see the filter below
 */
export function trackEvent(name, params = {}) {
  if (!EVENTS.has(name)) {
    console.warn(`analytics: refusing unknown event "${name}"`)
    return
  }
  if (typeof window === 'undefined' || !window.gtag) return
  if (consentState() !== 'granted') return

  // Numbers pass. Strings pass ONLY if short and drawn from a safe shape —
  // no spaces, no punctuation — which lets through 'Dog' or 'Vaccination' and
  // stops a pet's name, a note, or a drug name.
  const safe = {}
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'number' && Number.isFinite(v)) safe[k] = v
    else if (typeof v === 'boolean') safe[k] = v
    else if (typeof v === 'string' && /^[A-Za-z][A-Za-z/_-]{0,24}$/.test(v)) safe[k] = v
  }
  window.gtag('event', name, safe)
}

/** Load on boot for someone who already agreed, without asking again. */
export function startAnalyticsIfConsented() {
  if (consentState() === 'granted') startAnalytics()
}
