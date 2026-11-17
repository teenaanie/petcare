// Where /api lives, which stops being obvious the moment this runs in an app.
//
// On the web the page and the functions share an origin, so "/api/x" is both
// correct and the only thing that works on preview deployments, where the
// origin changes with every push.
//
// Inside a native WebView there is no such origin. Capacitor serves the bundle
// from capacitor://localhost (iOS) or http://localhost (Android), so "/api/x"
// resolves to a file in the app that does not exist. Every call has to name the
// server outright.
//
// One function, because twelve call sites each deciding this is twelve chances
// to get it wrong, and the one that gets it wrong is a feature that silently
// stops working in the store build and nowhere else.

// Set at build time for the native bundles. Left unset for the web build, which
// is what keeps preview deployments calling their own origin rather than
// production.
//
// Read from whichever of the two exists. Vite injects import.meta.env into the
// bundle, so the browser gets the value there; node, where this module's tests
// run, has only process.env and no import.meta.env at all -- which is why the
// first version of this file could not be tested: CONFIGURED was always empty
// and every native assertion passed for the wrong reason.
function configuredBase() {
  let env = {}
  try { if (typeof import.meta !== 'undefined' && import.meta.env) env = import.meta.env } catch { /* not a module env */ }
  // eslint-disable-next-line no-undef -- node only; guarded, and absent in the browser bundle
  const proc = typeof process !== 'undefined' ? process : undefined
  if (!env.VITE_API_BASE_URL && proc?.env) env = proc.env
  return String(env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
}

const CONFIGURED = configuredBase()

/**
 * Is this page running inside a native shell rather than a browser tab?
 *
 * Capacitor sets window.Capacitor. The protocol check is the backstop: a
 * WebView that loads the bundle from a file or capacitor scheme is native
 * whatever else is or is not on window, and a wrong answer here is a feature
 * that works everywhere except the app nobody can debug.
 */
export function isNativeShell(win = typeof window === 'undefined' ? undefined : window) {
  if (!win) return false
  if (win.Capacitor?.isNativePlatform?.() === true) return true
  const proto = win.location?.protocol || ''
  return proto === 'capacitor:' || proto === 'file:'
}

/**
 * The absolute base for /api calls, or '' when a relative path is right.
 *
 * Empty string on the web ON PURPOSE. Hard-coding production there would send
 * every preview deployment's calls to the live site, so a change to an endpoint
 * could never be tested before it shipped.
 */
export function apiBase(win = typeof window === 'undefined' ? undefined : window) {
  if (!isNativeShell(win)) return ''
  return CONFIGURED
}

/**
 * Resolve an API path for fetch().
 *
 * Takes what the call sites already pass -- '/api/thing', query string and all.
 * A path that is already absolute is returned untouched, so a caller that has
 * its own reason to name a host is not second-guessed.
 */
export function apiUrl(path, win = typeof window === 'undefined' ? undefined : window) {
  const p = String(path || '')
  // Nothing to call. Returning the base alone would turn a bug at the call
  // site into a request to the site root, which answers 200 with HTML and so
  // fails much further downstream than it should.
  if (!p) return p
  if (/^https?:\/\//i.test(p)) return p
  const base = apiBase(win)
  if (!base) return p
  return base + (p.startsWith('/') ? p : `/${p}`)
}

/**
 * True when the app is native but nobody told it where the server is.
 *
 * Worth asking about explicitly: the failure is every network feature at once,
 * and the error it produces ("Could not reach the server") points at the user's
 * connection rather than at the build that forgot a variable.
 */
export function nativeApiMisconfigured(win = typeof window === 'undefined' ? undefined : window) {
  return isNativeShell(win) && !CONFIGURED
}
