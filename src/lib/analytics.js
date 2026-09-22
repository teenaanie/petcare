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
}

/** Load on boot for someone who already agreed, without asking again. */
export function startAnalyticsIfConsented() {
  if (consentState() === 'granted') startAnalytics()
}
