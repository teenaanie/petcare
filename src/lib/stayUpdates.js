// Stay updates: the boarder writing back during a stay.
//
// Every function here takes the supabase client as its first argument, which is
// unusual in this codebase and deliberate. This is the only feature both sides
// touch: the customer reads through getSupabase(), the provider writes through
// getSupabaseProvider(), and those are different sessions under different
// storage keys. A module that reached for one of them itself would work in
// testing and then silently read as the wrong person — the provider shell would
// query as a signed-out pet parent and see nothing, with no error to explain it.
// Passing the client makes the choice visible at every call site.
//
// Photos live in the private `stay-photos` bucket at
//   <note_id>/<uuid>.jpg
// so storage RLS resolves the note straight out of the path, the same shape
// src/lib/conditions.js uses for pet-photos. A SEPARATE bucket from that one on
// purpose: pet-photos holds photographs of skin conditions, and widening its
// policies to admit boarders would be a large blast radius for a picture of a
// dog on a sofa.

import { compressImage } from './image.js'

export const BUCKET = 'stay-photos'

// An hour: long enough to look through a stay, short enough that a copied link
// is not a permanent leak. Same reasoning as the condition journal.
const SIGNED_URL_TTL = 60 * 60

const fromRow = r => ({
  id: r.id, noteId: r.note_id, providerId: r.provider_id, petId: r.pet_id,
  postedBy: r.posted_by, body: r.body, photoPath: r.photo_path,
  createdAt: r.created_at,
})

/** Everything posted about this pet, newest first. The customer's view. */
export async function getStayUpdatesForPet(supabase, petId) {
  if (!supabase || !petId) return []
  const { data, error } = await supabase
    .from('stay_updates').select('*')
    .eq('pet_id', petId).order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(fromRow)
}

/** Everything posted against one note. The provider's view of one stay. */
export async function getStayUpdatesForNote(supabase, noteId) {
  if (!supabase || !noteId) return []
  const { data, error } = await supabase
    .from('stay_updates').select('*')
    .eq('note_id', noteId).order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(fromRow)
}

/**
 * Post an update. Provider side.
 *
 * The photo is uploaded FIRST and the row written second, because the opposite
 * order leaves a row pointing at a file that never arrived — a broken image in
 * someone's pet screen, with nothing to say why. A failed upload here means no
 * row at all, which the caller can report honestly.
 *
 * note_id, provider_id and pet_id must describe a real note or the INSERT
 * policy refuses it; they are passed rather than derived so the caller can only
 * post against a note it actually read.
 */
export async function postStayUpdate(supabase, { noteId, providerId, petId, postedBy, body, file }) {
  if (!supabase) throw new Error('Not connected.')
  const text = (body || '').trim()
  if (!text && !file) throw new Error('Write something, or add a photo.')

  let photoPath = null
  if (file) {
    const blob = await compressImage(file)
    photoPath = `${noteId}/${crypto.randomUUID()}.jpg`
    const { error: upErr } = await supabase.storage.from(BUCKET)
      .upload(photoPath, blob, { contentType: 'image/jpeg', upsert: false })
    if (upErr) throw upErr
  }

  const { data, error } = await supabase.from('stay_updates').insert({
    note_id: noteId, provider_id: providerId, pet_id: petId,
    posted_by: postedBy, body: text || null, photo_path: photoPath,
  }).select().single()

  if (error) {
    // Do not leave the photo behind when the row was refused. Best effort: the
    // row is what matters, and a failure here is already being reported.
    if (photoPath) {
      try { await supabase.storage.from(BUCKET).remove([photoPath]) } catch { /* ignore */ }
    }
    throw error
  }
  return fromRow(data)
}

/**
 * Take an update down. Provider side only — the customer relies on nothing
 * here, and the realistic failure is photographing the wrong dog, which must
 * be fixable.
 *
 * The object goes first for the same reason conditions.js removes files before
 * rows: delete the row first and the file is orphaned with nothing left
 * pointing at it.
 */
export async function deleteStayUpdate(supabase, { id, photoPath }) {
  if (!supabase) throw new Error('Not connected.')
  if (photoPath) {
    const { error } = await supabase.storage.from(BUCKET).remove([photoPath])
    if (error) throw error
  }
  const { error } = await supabase.from('stay_updates').delete().eq('id', id)
  if (error) throw error
}

/** A short-lived link for one photo. The bucket is private; there is no URL. */
export async function signedPhotoUrl(supabase, path) {
  if (!supabase || !path) return null
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL)
  if (error) return null          // a missing photo must not break the list
  return data?.signedUrl || null
}

/**
 * Remove every stay photo belonging to a pet.
 *
 * The ROWS cascade when the pet goes; the OBJECTS do not. Supabase refuses
 * deletes issued straight against storage.objects, which is the exact trap
 * src/lib/conditions.js documents — deleting a pet there once left photographs
 * of its skin condition sitting in the bucket. So the paths are collected from
 * the rows while they still exist, and removed through the storage API.
 *
 * MUST run before the pet is deleted, for that reason.
 */
export async function deleteStayPhotos(supabase, petId) {
  if (!supabase || !petId) return
  const { data, error } = await supabase
    .from('stay_updates').select('photo_path')
    .eq('pet_id', petId).not('photo_path', 'is', null)
  if (error) return                       // erasure of the pet must still proceed
  const paths = (data || []).map(r => r.photo_path).filter(Boolean)
  if (!paths.length) return
  await supabase.storage.from(BUCKET).remove(paths)
}
