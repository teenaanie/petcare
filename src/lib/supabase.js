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

// ── The provider shell's own client ─────────────────────────────────────────
//
// The shell at /business signs in separately, with its own session. Same
// project, same anon key, and — deliberately — the same email address: a
// boarder is often also a pet parent, and Supabase will not create two
// auth.users rows for one address anyway. What differs is the storage key, so
// signing into one side does not sign you into the other.
//
// This is a UI and session boundary, NOT a security boundary. Both sessions
// carry the same auth.uid(), so no RLS policy can tell "signed in as a
// provider" from "signed in as a pet parent". What it buys: no accidental
// crossover, and a kennel's shared computer signed into /business does not
// expose the owner's own pet records. What it does not buy: any restriction on
// the person themselves — they are the same user, and reaching their own data
// from either session is not a leak. Do not build anything on the assumption
// that the database can tell these two apart.
//
// Lazy for the same reason as the one above, and it matters MORE here: this
// client is only ever wanted at /business, so an eager one would have put all
// 211 kB back on the critical path of every pet parent to serve a page they
// will never open. It shares the same dynamic import, so the second shell to
// ask for it pays nothing.

let providerClientPromise = null

/** The provider shell's client, built once. Null when Supabase is unconfigured. */
export function getSupabaseProvider() {
  if (!isConfigured) return Promise.resolve(null)
  if (!providerClientPromise) {
    providerClientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) =>
        createClient(url, key, { auth: { storageKey: 'pippy-provider-auth' } }))
      .catch(e => { providerClientPromise = null; throw e })
  }
  return providerClientPromise
}
