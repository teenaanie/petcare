// src/lib/notify.js
//
// Letting whoever runs Pippy know that somebody signed up, or added a pet.
//
// FIRE AND FORGET, DELIBERATELY. Nothing here is awaited by the code that
// saves a pet, and every failure is swallowed. The person using the app is
// adding their dog; an alert to an ops inbox is not their business and must
// never be able to make their action look like it failed.
//
// The server does not believe any of this — see api/_lib/
// notify-owner.js. It re-checks the account age and the pet's ownership
// against the database before it sends anything, so this call is a nudge
// rather than an instruction.

import { getSupabase } from './supabase.js'

// One alert per browser per account. The server also refuses anything older
// than a few minutes, so this is about not being noisy rather than about
// correctness.
const SIGNUP_KEY = 'pippy_signup_announced'

async function post(payload) {
  const supabase = await getSupabase()
  if (!supabase) return                       // local-only mode: nobody to tell
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return
    await fetch('/api/notify-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
  } catch {
    // Intentionally silent. See the note at the top.
  }
}

/**
 * Call on sign-in. Only announces genuinely new accounts: the marker stops a
 * repeat from this browser, and the server independently checks how old the
 * account actually is.
 */
export function announceSignupOnce(user) {
  if (!user?.id) return
  try {
    const key = `${SIGNUP_KEY}:${user.id}`
    if (localStorage.getItem(key)) return
    localStorage.setItem(key, '1')
  } catch { /* private mode: at worst the server dedupes by account age */ }
  post({ event: 'signup' })
}

/** Call after a pet has actually been saved, with the id it came back with. */
export function announcePetAdded(petId) {
  if (!petId) return
  post({ event: 'pet_added', petId })
}
