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

// Google Analytics 4.
//
// A measurement ID is NOT a secret — it is readable in the page source of any
// site that uses one, and it grants nothing. It is written here rather than
// left to an env var so that the property is configured in one place, in the
// repository, instead of in a dashboard where a missed redeploy silently turns
// measurement off. VITE_* is inlined at BUILD time, so an env var set after a
// deploy does nothing until the next one — that has already caught FROM_EMAIL
// out once on this project.
//
// VITE_GA_MEASUREMENT_ID still overrides it, and setting that to a different
// property is how a fork avoids reporting into this one.
//
// None of this loads until the visitor accepts the consent banner.
const GA_ID = import.meta.env?.VITE_GA_MEASUREMENT_ID || 'G-XLY5YRFZ8Y'
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

// Parameter KEYS that may be sent. Also a closed list, and the one that
// actually makes the promise in the privacy notice true.
//
// Filtering by the SHAPE of the value is not enough, and this was caught by
// watching a real event reach gtag rather than by reading the code: a pet
// called "Bruno" is one short word of letters, indistinguishable from the enum
// "Dog". `{ pet_name: 'Bruno' }` sailed through a shape-only filter, while the
// notice tells people a pet's name cannot reach Google.
//
// A key cannot be mistaken for another key, so this is a guarantee rather than
// a heuristic. Adding a key here is a deliberate act; passing a new one by
// accident does nothing.
const PARAMS = new Set([
  'species',      // Dog, Cat, … — a fixed list from AddPetModal
  'method',       // form | voice
  'mode',         // speak | type
  'type',         // reminder type, slugified: Vet_Checkup
  'frequency',    // Once | Weekly | Monthly | Yearly
  'role',         // viewer | editor
  'via',          // sheet | clipboard | link
  'from',         // where in the UI an action was taken, e.g. bell
  'records',      // how many records one voice note produced
  'vaccinations', // counts from a scan
  'medicines',
  'results',      // how many providers a search returned
  'has_bill',     // booleans
  'searched',
])

/**
 * Record that something happened. Never what it was about.
 *
 * @param {string} name  one of EVENTS
 * @param {object} [params] keys from PARAMS; numbers, booleans and short enums
 */
export function trackEvent(name, params = {}) {
  if (!EVENTS.has(name)) {
    console.warn(`analytics: refusing unknown event "${name}"`)
    return
  }
  if (typeof window === 'undefined' || !window.gtag) return
  if (consentState() !== 'granted') return

  const safe = {}
  for (const [k, v] of Object.entries(params)) {
    // The key gate first. Whatever `pet_name` or `note` happens to contain,
    // it is not going anywhere.
    if (!PARAMS.has(k)) {
      console.warn(`analytics: dropping unexpected parameter "${k}"`)
      continue
    }
    // Then the shape gate, still worth having: it stops a key on the list
    // being handed free text by mistake, e.g. a `type` that came from a
    // text field rather than a dropdown.
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
