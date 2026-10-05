// The Supabase client, loaded on demand.
//
// @supabase/supabase-js and its dependencies are 211 kB of uncompressed JS
// (54 kB gzipped). Imported statically, every one of those bytes sat in the
// main bundle, on the critical path for somebody who had not signed in and
// might never sign in. So the import is dynamic and the client is built on
// first use.
//
// `isConfigured` stays synchronous — it only reads import.meta.env, and ~26
// modules branch on it before they do anything async.

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = !!(url && key)

// Which localStorage key holds the session. This reproduces exactly what
// supabase-js derives internally (`sb-<project ref>-auth-token`, from the
// hostname's first label) so that reading it here cannot disagree with the
// client, and so nobody gets signed out by this change. Pinning our own
// storageKey instead would have invalidated every session in the wild.
const storageKey = (() => {
  try { return `sb-${new URL(url).hostname.split('.')[0]}-auth-token` } catch { return null }
})()

// Is somebody plausibly signed in, answered without the client?
//
// This is what lets a signed-out visitor skip the download entirely. It is a
// hint, not an authority: a stale or malformed token still says "yes" here and
// is then rejected properly by getSession(). Wrong answers are safe — "yes"
// costs a fetch we would have made anyway, "no" is only ever returned when
// there is no token to validate.
export function hasStoredSession() {
  if (!isConfigured || !storageKey) return false
  try { return !!localStorage.getItem(storageKey) } catch { return false }
}

let clientPromise = null

/** The client, built once. Resolves to null when Supabase is not configured. */
export function getSupabase() {
  if (!isConfigured) return Promise.resolve(null)
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(url, key))
      .catch(e => { clientPromise = null; throw e })   // let a dropped chunk be retried
  }
  return clientPromise
}
