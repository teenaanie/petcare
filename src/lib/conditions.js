// src/lib/conditions.js
// Condition threads: a titled thing being watched ("Left paw infection") with
// dated notes and photos underneath it.
//
// Threads rather than a flat list because the question a vet asks is "is it
// bigger than it was?", and that needs two dated photos of the same spot side
// by side.
//
// Photos live in the private `pet-photos` bucket at
//   <pet_id>/<condition_id>/<uuid>.jpg
// so storage RLS can read the pet id straight out of the path and reuse the
// same is_pet_member / is_pet_editor rules as every other record type. The
// browser never gets a public URL — only a short-lived signed one.

import { supabase, isConfigured } from './supabase.js'
import { compressImage } from './image.js'

export const BUCKET = 'pet-photos'
export const STATUSES = ['active', 'monitoring', 'resolved']
const SIGNED_URL_TTL = 60 * 60   // an hour: long enough to browse, short enough
                                 // that a copied link is not a permanent leak

function requireCloud() {
  if (!isConfigured) {
    throw new Error('Photos need the cloud database. Sign in to use the journal.')
  }
}

const fromCondition = r => ({
  id: r.id, petId: r.pet_id, title: r.title, bodyPart: r.body_part,
  status: r.status, startedOn: r.started_on, resolvedOn: r.resolved_on,
  notes: r.notes, createdAt: r.created_at,
})

const fromNote = r => ({
  id: r.id, conditionId: r.condition_id, observedOn: r.observed_on,
  description: r.description, photoPaths: r.photo_paths || [], createdAt: r.created_at,
})

// ── Conditions ───────────────────────────────────────────────────────────────

export async function getConditions(petId) {
  requireCloud()
  const { data, error } = await supabase
    .from('conditions').select('*').eq('pet_id', petId)
    .order('status').order('started_on', { ascending: false })
  if (error) throw error
  return (data || []).map(fromCondition)
}

export async function saveCondition(c) {
  requireCloud()
  const row = {
    pet_id: c.petId, title: (c.title || '').trim(), body_part: c.bodyPart || null,
    status: c.status || 'active',
    started_on: c.startedOn || new Date().toISOString().split('T')[0],
    // Only a resolved thread carries a resolution date; clearing the status has
    // to clear the date too, or the card claims it ended on a day it did not.
    resolved_on: c.status === 'resolved' ? (c.resolvedOn || new Date().toISOString().split('T')[0]) : null,
    notes: c.notes || null,
  }
  const q = c.id
    ? supabase.from('conditions').update(row).eq('id', c.id).select().single()
    : supabase.from('conditions').insert(row).select().single()
  const { data, error } = await q
  if (error) throw error
  return fromCondition(data)
}

/**
 * Deletes the thread, its notes (by cascade) and its photos.
 *
 * Photos must go first and explicitly: Postgres cascades rows, but stored
 * objects are outside that graph, and Supabase refuses deletes issued straight
 * against storage.objects. Removing the row first would orphan the images with
 * nothing left pointing at them.
 */
export async function deleteCondition(condition) {
  requireCloud()
  const notes = await getNotes(condition.id)
  const paths = notes.flatMap(n => n.photoPaths)
  if (paths.length) await deletePhotos(paths)
  const { error } = await supabase.from('conditions').delete().eq('id', condition.id)
  if (error) throw error
}

// ── Notes ────────────────────────────────────────────────────────────────────

export async function getNotes(conditionId) {
  requireCloud()
  const { data, error } = await supabase
    .from('condition_notes').select('*').eq('condition_id', conditionId)
    .order('observed_on', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(fromNote)
}

export async function saveNote(n) {
  requireCloud()
  const row = {
    condition_id: n.conditionId,
    observed_on: n.observedOn || new Date().toISOString().split('T')[0],
    description: n.description || null,
    photo_paths: n.photoPaths || [],
  }
  const q = n.id
    ? supabase.from('condition_notes').update(row).eq('id', n.id).select().single()
    : supabase.from('condition_notes').insert(row).select().single()
  const { data, error } = await q
  if (error) throw error
  return fromNote(data)
}

export async function deleteNote(note) {
  requireCloud()
  if (note.photoPaths?.length) await deletePhotos(note.photoPaths)
  const { error } = await supabase.from('condition_notes').delete().eq('id', note.id)
  if (error) throw error
}

// ── Photos ───────────────────────────────────────────────────────────────────

export async function uploadPhoto(petId, conditionId, file) {
  requireCloud()
  const blob = await compressImage(file)
  const path = `${petId}/${conditionId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return path
}

/**
 * Signed URLs for a batch of paths, as { path: url }.
 *
 * The bucket is private, so there is no URL to construct — every view needs a
 * fresh signature. Batched because a thread with a dozen photos should not mean
 * a dozen round trips.
 */
export async function signedUrls(paths) {
  requireCloud()
  if (!paths?.length) return {}
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL)
  if (error) throw error
  const out = {}
  for (const d of data || []) if (d.signedUrl && !d.error) out[d.path] = d.signedUrl
  return out
}

export async function deletePhotos(paths) {
  requireCloud()
  if (!paths?.length) return
  const { error } = await supabase.storage.from(BUCKET).remove(paths)
  if (error) throw error
}
