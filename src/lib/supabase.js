import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key ? createClient(url, key) : null
export const isConfigured = !!supabase

// The provider shell signs in separately, at /business, with its own session.
//
// Same project, same anon key, and — deliberately — the same email address: a
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
export const supabaseProvider = url && key
  ? createClient(url, key, { auth: { storageKey: 'pippy-provider-auth' } })
  : null
