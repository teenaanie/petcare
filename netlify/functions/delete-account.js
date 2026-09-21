// netlify/functions/delete-account.js
// Permanently deletes the calling user's account and everything it owns.
//
// This has to run server-side: removing a row from auth.users needs the service
// role, which must never reach the browser. The client can only ask; it cannot
// perform the deletion itself, and it can only ever ask for its own account —
// the id comes from the verified JWT, never from the request body.
//
// pets.user_id -> auth.users is ON DELETE CASCADE, and every per-pet table
// cascades from pets, so removing the auth user removes the whole tree:
// pets, medical records, vaccinations, medicines, bills, weight logs,
// allergies, reminders, boarding trips, push subscriptions and api_usage.
//
// Two things do NOT cascade, and are handled explicitly below.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY   // service role — server only

function cors(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}
const json = (obj, status = 200) => cors(JSON.stringify(obj), status)

function missingEnv() {
  const missing = []
  if (!SUPABASE_URL) missing.push('SUPABASE_URL')
  if (!SERVICE_KEY)  missing.push('SUPABASE_SERVICE_KEY')
  return missing
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  const missing = missingEnv()
  if (missing.length) {
    console.error('Not configured — missing env: ' + missing.join(', '))
    return json({ error: `Server is misconfigured (missing ${missing.join(', ')}).` }, 503)
  }

  // 1. Authenticate. The account deleted is always the token's own.
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing auth token' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // 2. Require the confirmation phrase here too, not only in the UI. A client
  //    bug or a stray request must not be able to destroy an account.
  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  if (body?.confirm !== 'DELETE') {
    return json({ error: 'Confirmation phrase missing.' }, 400)
  }

  // 3. Record what is about to go, so the response can report it honestly.
  const { data: ownPets } = await supabase.from('pets').select('id').eq('user_id', user.id)
  const petIds = (ownPets || []).map(p => p.id)

  const counts = { pets: petIds.length }
  if (petIds.length) {
    for (const t of ['medical_records', 'vaccinations', 'medicines', 'bills',
                     'weight_logs', 'allergies', 'reminders', 'boarding_trips']) {
      const { count } = await supabase.from(t).select('*', { count: 'exact', head: true }).in('pet_id', petIds)
      counts[t] = count || 0
    }
  }

  // 4. Invitations are stored against an email address, and pet_members.user_id
  //    is nullable — someone invited who never signed in has a row with their
  //    email and no user_id at all. The cascade is on user_id, so those rows
  //    survive the account deletion and keep the address. Erasure has to mean
  //    the address goes too, both where they were invited and where they invited
  //    others.
  if (user.email) {
    const { error: memberErr, count: memberCount } = await supabase
      .from('pet_members').delete({ count: 'exact' }).eq('email', user.email)
    if (memberErr) {
      console.error('Failed to clear pet_members by email:', memberErr)
      return json({ error: 'Could not remove sharing records. Nothing was deleted.' }, 500)
    }
    counts.sharing_records = memberCount || 0
  }

  // 5. Remove the condition photos. Postgres cascades ROWS; stored objects sit
  //    outside that graph, and Supabase refuses deletes issued straight against
  //    storage.objects — a trigger that tried it raised on every pet delete.
  //    So the files come out here, through the Storage API, with the service
  //    role. Erasure that leaves photographs of a pet's skin condition behind
  //    is not erasure.
  if (petIds.length) {
    let photoPaths = []
    for (const petId of petIds) {
      // Objects live at <pet_id>/<condition_id>/<uuid>.jpg, so one listing per
      // condition folder under the pet.
      const { data: folders } = await supabase.storage.from('pet-photos').list(petId, { limit: 1000 })
      for (const folder of folders || []) {
        const { data: files } = await supabase.storage
          .from('pet-photos').list(`${petId}/${folder.name}`, { limit: 1000 })
        for (const f of files || []) photoPaths.push(`${petId}/${folder.name}/${f.name}`)
      }
    }
    if (photoPaths.length) {
      const { error: rmErr } = await supabase.storage.from('pet-photos').remove(photoPaths)
      if (rmErr) {
        console.error('Failed to remove condition photos:', rmErr)
        return json({ error: 'Could not remove your photos. Nothing was deleted.' }, 500)
      }
    }
    counts.photos = photoPaths.length
  }

  // 6. Delete the account. Everything above cascades from here.
  //    admin.deleteUser THROWS on a malformed id rather than returning an
  //    error, so an unguarded call turns any surprise into an opaque
  //    FUNCTION_INVOCATION_FAILED — the user would see a blank 500 and have no
  //    idea whether their account had been deleted or not.
  try {
    const { error: delErr } = await supabase.auth.admin.deleteUser(user.id)
    if (delErr) throw delErr
  } catch (e) {
    console.error('Account deletion failed:', e?.message || e)
    return json({ error: `Could not delete the account: ${e?.message || 'unexpected error'}` }, 500)
  }

  // Deliberately no user id or email in this log line — see _redact.js.
  console.log('Account deleted:', JSON.stringify(counts))

  return json({ deleted: true, counts })
}
