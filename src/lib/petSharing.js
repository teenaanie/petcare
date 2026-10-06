// src/lib/petSharing.js
//
// The write and the wording behind the Share screen, kept out of the component
// so they can be tested in plain node -- the same reason voiceUpdateRecords.js
// exists. The retry below has a case that is easy to get backwards, and it is
// not one you would notice by using the screen once.

import { withRetry, isNetworkError } from './net.js'

/**
 * Invite someone to a pet, returning the new membership's id.
 *
 * The invite is stored against the email alone. There used to be a lookup
 * against profiles to resolve a user_id first, but profiles holds only
 * (id, is_admin, created_at) — it has no email column, so that query failed
 * every single time and its error was discarded. Access is granted by matching
 * the email anyway: see is_pet_member() in supabase/pet_members.sql.
 *
 * The id comes back because the invite email is sent BY id: the server re-reads
 * the row and emails the address it finds there, rather than one passed in a
 * request body.
 *
 * Retried, for the failure actually reported: sharing with an address showed
 * "Load failed" on the first press and worked on the second. That is the WebKit
 * behaviour net.js was written for — a connection in the pool goes away and the
 * next fetch onto it fails before a byte is sent. Every other write path in the
 * app already had this. Sharing did not.
 *
 * @param {object} supabase a client, passed in so a test can stub it
 */
export async function inviteMember(supabase, petId, email, role = 'viewer') {
  return await withRetry(async (attempt) => {
    const { data, error } = await supabase.from('pet_members').insert({
      pet_id: petId,
      email,
      role,
    }).select('id').single()
    if (!error) return data?.id

    // An INSERT is not normally safe to repeat, and net.js is explicit about
    // why: from the client, a request that never left the phone and one whose
    // RESPONSE was lost look identical. What makes this one safe is the unique
    // constraint on (pet_id, email) in supabase/pet_members.sql. A second write
    // cannot create a second membership; it can only be refused.
    //
    // That refusal must not reach the owner. On a RETRY it means this invite
    // already succeeded and we never heard back, so the existing row's id is
    // what the caller asked for. Without this the owner presses Send, sees it
    // fail, presses again, and is told the address already has access — which
    // is true, and entirely their own doing.
    //
    // Only on a retry. A duplicate on the FIRST attempt is the ordinary case
    // of inviting somebody twice, and they should be told.
    if (attempt > 1 && isDuplicate(error)) {
      const { data: existing } = await supabase.from('pet_members')
        .select('id').eq('pet_id', petId).eq('email', email).maybeSingle()
      if (existing?.id) return existing.id
    }
    throw error
  }, { attempts: 2 })
}

/** The unique constraint on (pet_id, email), however the driver words it. */
export function isDuplicate(error) {
  if (!error) return false
  if (String(error.code || '') === '23505') return true
  return /duplicate key|unique constraint/i.test(error.message || '')
}

/**
 * Turn a failure into something the person sharing their dog can act on.
 *
 * Postgres errors are written for whoever wrote the schema. This takes the
 * ERROR rather than its message, because the commonest failure here is not a
 * Postgres one at all: a dropped request arrives as Safari's "Load failed",
 * which the Share screen used to pass straight through. That reads as the app
 * being broken, when the request simply never left the phone.
 */
export function friendlyShareError(e) {
  const message = e?.message || String(e ?? '')

  if (isNetworkError(e)) {
    return "Couldn't reach the server — that usually clears on its own, so try once more."
  }
  if (/permission denied|row-level security|violates row-level/i.test(message)) {
    return "You don't have permission to change who can see this pet — only its owner can."
  }
  if (isDuplicate(message ? { message } : null)) {
    return 'That email already has access to this pet.'
  }
  if (/does not exist|schema cache|column/i.test(message)) {
    return 'Sharing isn\'t set up on this database yet. Run supabase/pet_members.sql in the Supabase SQL editor.'
  }
  return message
}
