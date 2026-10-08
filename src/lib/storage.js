// storage.js — uses Supabase when configured, falls back to localStorage.
// This means all devices stay in sync automatically once Supabase is connected.

import { getSupabase, isConfigured } from './supabase.js'
import { deletePetPhotos } from './conditions.js'
import { deleteStayPhotos } from './stayUpdates.js'
import { createReadCache } from './readCache.js'
import { reportHandled } from './errorReport.js'

// ── localStorage helpers (fallback) ──────────────────────────────────────────

const KEYS = {
  pets:         'mypetcare_pets',
  medical:      'mypetcare_medical',
  vaccinations: 'mypetcare_vaccinations',
  allergies:    'mypetcare_allergies',
  reminders:    'mypetcare_reminders',
  weightLogs:   'mypetcare_weight_logs',
  medicines:    'mypetcare_medicines',
  bills:        'mypetcare_bills',
  boardingTrips:'mypetcare_boarding_trips',
}

function lsGet(key)       { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } }
function lsSet(key, data) { localStorage.setItem(key, JSON.stringify(data)) }
function uid()            { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

// ── Read-through cache ────────────────────────────────────────────────────────
//
// Tab switches unmount and remount, so every switch refetched rows that had
// not changed -- a measured 241 ms round trip to Seoul for a read with no rows
// in it. The getters below read through `cached` and every writer clears what
// it touched through `bust`.
// See src/lib/readCache.js for why the ordering in `bust` is the part that
// keeps a saved record from being shown stale.
//
// Off in local mode: localStorage is synchronous and has nothing to gain.

const { cached, bust, invalidateAll, installAwayInvalidation } =
  createReadCache({ enabled: isConfigured })

/** Forget every cached read. For writes that bypass this module -- the one-off
 *  localStorage→Supabase migration inserts rows directly. */
export { invalidateAll }

/** Drop the cache on returning to the app, so a write made on another device
 *  while this tab sat open is not papered over. Installed once from main.jsx. */
export { installAwayInvalidation }

// ── Pets ──────────────────────────────────────────────────────────────────────

export const getPets = (filterUserId = null) => cached('pets', filterUserId, () => _getPets(filterUserId))
async function _getPets(filterUserId = null) {
  if (isConfigured) {
    const supabase = await getSupabase()
    let q = supabase.from('pets').select('*').order('created_at', { ascending: false })
    if (filterUserId) q = q.eq('user_id', filterUserId)
    const { data, error } = await q
    if (error) throw error
    return withLatestWeights(data.map(fromSnakePet), supabase)
  }
  return withLatestWeights(lsGet(KEYS.pets))
}

/**
 * Attach each pet's most recent DATED weight reading.
 *
 * `pets.weight` is typed into the profile form and never dated, so on its own
 * it cannot be shown as a current weight -- and on the live data nine of the
 * eleven pets with readings disagree with it. Doing this here, in the one
 * place every screen gets its pets from, means the pet card, the pet header,
 * the emergency card, the boarding price bands and the admin list all see the
 * same figure without each one fetching it.
 *
 * Deliberately NOT a write. See src/lib/currentWeight.js for why reconciling
 * the two numbers automatically would have put "3.8 kg" on a Labrador's
 * emergency card.
 *
 * A failure here must not take the pet list down with it. It is an
 * enrichment: without it `currentWeight()` falls back to the profile figure,
 * which is exactly the old behaviour.
 */
async function withLatestWeights(pets, supabase) {
  if (!Array.isArray(pets) || pets.length === 0) return pets
  try {
    const ids = pets.map(p => p.id).filter(Boolean)
    if (!ids.length) return pets

    let rows
    if (supabase) {
      const { data, error } = await supabase
        .from('weight_logs').select('pet_id, weight, date, created_at')
        .in('pet_id', ids).not('date', 'is', null).not('weight', 'is', null)
      if (error) throw error
      rows = (data || []).map(r => ({
        petId: r.pet_id, weight: r.weight, date: r.date, createdAt: r.created_at,
      }))
    } else {
      rows = lsGet(KEYS.weightLogs)
        .filter(r => r && r.petId && r.date && r.weight != null)
        .map(r => ({ ...r, createdAt: r.createdAt || '' }))
    }

    // Latest per pet. Dates are compared as strings, which is correct for ISO
    // dates and avoids a timezone shifting a reading onto the wrong day.
    //
    // Two readings CAN share a date -- weighed twice, or a scanned document
    // and a typed entry on the same day. There are none today, but leaving
    // that to the order the rows happen to arrive in means the displayed
    // weight could change between loads. The later-entered one wins, which is
    // what somebody correcting a reading would expect.
    const latest = new Map()
    for (const r of rows) {
      const prev = latest.get(r.petId)
      if (!prev) { latest.set(r.petId, r); continue }
      const d = String(r.date).localeCompare(String(prev.date))
      if (d > 0 || (d === 0 && String(r.createdAt || '') > String(prev.createdAt || ''))) {
        latest.set(r.petId, r)
      }
    }
    return pets.map(p => {
      const l = latest.get(p.id)
      return l ? { ...p, latestWeight: l.weight, latestWeightOn: l.date } : p
    })
  } catch {
    return pets
  }
}

export async function getAdminUsers() {
  if (!isConfigured) return []
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('get_all_users_for_admin')
  if (error) throw error
  return data || []
}

// ── Provider claims (admin only) ─────────────────────────────────────────────
//
// A business claiming its directory listing lands status='pending' and a human
// decides. Both calls below are gated in the database, not here:
// admin_provider_claims() returns zero rows to a non-admin, and
// provider_accounts' UPDATE policy is is_admin() on both USING and WITH CHECK.
// Nothing in this file is a permission check.

export async function getProviderClaims() {
  if (!isConfigured) return []
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('admin_provider_claims')
  if (error) throw error
  return data || []
}

// ── Inform notes ────────────────────────────────────────────────────────────
//
// A note is the ENTIRE provider-side read surface. Nothing here grants a
// provider access to a pet row; the note carries its own copy of everything the
// provider will see, which is why pet_label and the contact fields are columns
// rather than joins.
//
// There is no updateProviderNote and no deleteProviderNote, and there never
// should be: the table has no UPDATE or DELETE policy, so either would fail
// silently with zero rows rather than erroring. A correction is a new note
// pointing at the old one through `supersedes`. See supabase/provider_notes.sql.

/**
 * Which of these providers can actually be informed?
 *
 * Takes the caller's own provider ids rather than scanning, so it cannot be
 * used to enumerate which businesses have signed up. Returns a Set for the
 * membership test the pet screen does per provider.
 *
 * A failure here must not take the pet screen down: the button simply does not
 * appear, which is the same thing the user sees when no provider is onboarded.
 */
export async function getOnboardedProviderIds(providerIds = []) {
  const ids = [...new Set((providerIds || []).filter(Boolean))]
  if (!isConfigured || ids.length === 0) return new Set()
  try {
    const supabase = await getSupabase()
    const { data, error } = await supabase.rpc('onboarded_provider_ids', { p_ids: ids })
    if (error) throw error
    return new Set((data || []).map(r => r.provider_id))
  } catch (e) {
    reportHandled(e, { view: 'inform-provider' })
    return new Set()
  }
}

/**
 * Send a note. `sent_by` is set here from the session rather than passed in,
 * because the INSERT policy requires it to equal auth.uid() and a caller that
 * got it wrong would see only a permission error.
 */
export const sendProviderNote = (note) => bust('provider_notes', () => _sendProviderNote(note))
async function _sendProviderNote(note) {
  if (!isConfigured) throw new Error('Supabase is not configured.')
  const supabase = await getSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) throw new Error('Please sign in again to send this.')

  const row = {
    provider_id:   note.providerId,
    pet_id:        note.petId,
    sent_by:       session.user.id,
    body:          (note.body || '').trim(),
    facts:         note.facts || {},
    pet_label:     (note.petLabel || '').trim(),
    contact_name:  note.contactName  || null,
    contact_phone: note.contactPhone || null,
    contact_email: note.contactEmail || null,
    starts_on:     note.startsOn || null,
    ends_on:       note.endsOn   || null,
    supersedes:    note.supersedes || null,
  }
  const { data, error } = await supabase
    .from('provider_notes').insert(row).select().single()
  if (error) throw error

  // Tell the business, and never let that fail the send. The note is already
  // saved and is what the provider actually reads — the mail only says one
  // landed. Before this, a provider who signs in once a week found out when the
  // dog did.
  //
  // Not awaited, for the same reason the stay-update mail is not: the customer
  // is waiting on a screen, and an SMTP round trip is slower than the insert
  // that matters.
  fetch('/api/provider-mail?op=inform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               authorization: `Bearer ${session.access_token || ''}` },
    body: JSON.stringify({ noteId: data.id }),
  }).catch(() => { /* the note is sent; the provider sees it when they sign in */ })

  return fromSnakeProviderNote(data)
}

/** Everything ever sent about this pet, newest first. The whole chain. */
export const getProviderNotes = (petId) => cached('provider_notes', petId, () => _getProviderNotes(petId))
async function _getProviderNotes(petId) {
  if (!isConfigured || !petId) return []
  const supabase = await getSupabase()
  const { data, error } = await supabase
    .from('provider_notes').select('*')
    .eq('pet_id', petId).order('sent_at', { ascending: false })
  if (error) throw error
  return (data || []).map(fromSnakeProviderNote)
}

function fromSnakeProviderNote(r) {
  return {
    id: r.id, providerId: r.provider_id, petId: r.pet_id, sentBy: r.sent_by,
    body: r.body, facts: r.facts || {}, petLabel: r.pet_label,
    contactName: r.contact_name, contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    startsOn: r.starts_on, endsOn: r.ends_on,
    sentAt: r.sent_at, supersedes: r.supersedes,
  }
}

export async function setProviderClaimStatus(id, status) {
  if (!isConfigured) throw new Error('Supabase is not configured.')
  const supabase = await getSupabase()

  // Approving is its own RPC because it does two things: activates the account
  // AND publishes the listing, if that listing was self-registered and still
  // unpublished. As two client-side updates the second could fail on its own,
  // leaving an active account whose business is invisible in the directory and
  // nothing saying so. Suspending and returning to pending touch only the
  // account, so they stay plain updates.
  if (status === 'active') {
    const { error } = await supabase.rpc('approve_provider_claim', { p_account_id: id })
    if (error) throw error
    return
  }

  const now = new Date().toISOString()

  // Suspending KEEPS the grant stamp, because "who approved this, and when" is
  // the thing you want most once an account has turned out to be trouble. Only
  // a return to pending clears all three, which is the one case where no
  // approval has happened. ('active' never reaches here — see above.)
  const row = { status }
  if (status === 'suspended') Object.assign(row, { revoked_at: now })
  if (status === 'pending')   Object.assign(row, { granted_by: null, granted_at: null, revoked_at: null })

  const { error } = await supabase.from('provider_accounts').update(row).eq('id', id)
  if (error) throw error
}

export const savePet = (pet) => bust('pets', () => _savePet(pet))
async function _savePet(pet) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    const row = { ...toSnake(pet) }
    // Only set user_id on insert (don't overwrite on update)
    if (!pet.id && user) row.user_id = user.id
    if (pet.id) {
      const { data, error } = await supabase.from('pets').update(row).eq('id', pet.id).select().single()
      if (error) throw error
      return fromSnakePet(data)
    } else {
      const { data, error } = await supabase.from('pets').insert(row).select().single()
      if (error) throw error
      return fromSnakePet(data)
    }
  }
  // localStorage fallback
  const pets = lsGet(KEYS.pets)
  if (pet.id) {
    const idx = pets.findIndex(p => p.id === pet.id)
    // Merge rather than replace: callers pass a fixed field whitelist (the edit
    // form doesn't know about the boarding profile, for instance), so a
    // wholesale swap would drop every field the caller didn't happen to carry.
    // Empty strings still clear a field — only `undefined` is preserved.
    if (idx >= 0) pets[idx] = { ...pets[idx], ...pet }; else pets.push(pet)
  } else {
    pet.id = uid(); pet.createdAt = new Date().toISOString(); pets.push(pet)
  }
  lsSet(KEYS.pets, pets)
  return pet
}

export const deletePet = (id) => bust('*', () => _deletePet(id))
async function _deletePet(id) {
  if (isConfigured) {
    const supabase = await getSupabase()
    // Photos first, and the row only if they went. Deleting the row cascades
    // the condition threads that name these files, so doing it the other way
    // round would leave images in the bucket with nothing pointing at them —
    // unreachable and permanently undeletable. Failing here leaves the pet
    // intact and recoverable, which is the better of the two failures.
    await deletePetPhotos(id)
    // Stay photos live in their own bucket and are orphaned by exactly the same
    // mechanism: the stay_updates rows cascade when the pet goes, taking the
    // only record of these paths with them. Collected and removed first, for
    // the reason above.
    await deleteStayPhotos(supabase, id)
    const { error } = await supabase.from('pets').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.pets, lsGet(KEYS.pets).filter(p => p.id !== id))
  lsSet(KEYS.medical, lsGet(KEYS.medical).filter(r => r.petId !== id))
  lsSet(KEYS.vaccinations, lsGet(KEYS.vaccinations).filter(r => r.petId !== id))
  lsSet(KEYS.allergies, lsGet(KEYS.allergies).filter(r => r.petId !== id))
}

// ── Medical History ───────────────────────────────────────────────────────────

export const getMedicalHistory = (petId) => cached('medical_records', petId, () => _getMedicalHistory(petId))
async function _getMedicalHistory(petId) {
  if (isConfigured) {
    const supabase = await getSupabase()
    let q = supabase.from('medical_records').select('*').order('date', { ascending: false, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeMedical)
  }
  const all = lsGet(KEYS.medical)
  return petId ? all.filter(r => r.petId === petId) : all
}

export const saveMedicalRecord = (record) => bust('medical_records', () => _saveMedicalRecord(record))
async function _saveMedicalRecord(record) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const row = {
      pet_id:        record.petId,
      date:          record.date || null,
      type:          record.type,
      title:         record.title,
      description:   record.description,
      vet:           record.vet,
      cost:          record.cost ? parseFloat(record.cost) : null,
      is_abnormal:   record.isAbnormal || false,
      abnormalities: record.abnormalities || [],
    }
    if (record.id) {
      const { data, error } = await supabase.from('medical_records').update(row).eq('id', record.id).select().single()
      if (error) throw error
      return fromSnakeMedical(data)
    } else {
      const { data, error } = await supabase.from('medical_records').insert(row).select().single()
      if (error) throw error
      return fromSnakeMedical(data)
    }
  }
  const all = lsGet(KEYS.medical)
  if (record.id) {
    const idx = all.findIndex(r => r.id === record.id)
    if (idx >= 0) all[idx] = { ...all[idx], ...record }; else all.push(record)
  } else {
    record.id = uid(); record.createdAt = new Date().toISOString(); all.push(record)
  }
  lsSet(KEYS.medical, all)
  return record
}

export const deleteMedicalRecord = (id) => bust('medical_records', () => _deleteMedicalRecord(id))
async function _deleteMedicalRecord(id) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('medical_records').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.medical, lsGet(KEYS.medical).filter(r => r.id !== id))
}

// ── Vaccinations ──────────────────────────────────────────────────────────────

export const getVaccinations = (petId) => cached('vaccinations', petId, () => _getVaccinations(petId))
async function _getVaccinations(petId) {
  if (isConfigured) {
    const supabase = await getSupabase()
    let q = supabase.from('vaccinations').select('*').order('date_given', { ascending: false, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeVax)
  }
  const all = lsGet(KEYS.vaccinations)
  return petId ? all.filter(r => r.petId === petId) : all
}

export const markVaccinationDone = (id, isDone) => bust('vaccinations', () => _markVaccinationDone(id, isDone))
async function _markVaccinationDone(id, isDone) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const { data, error } = await supabase.from('vaccinations').update({ is_done: isDone }).eq('id', id).select().single()
    if (error) throw error
    return fromSnakeVax(data)
  }
  const all = lsGet(KEYS.vaccinations)
  const idx = all.findIndex(r => r.id === id)
  if (idx >= 0) { all[idx].isDone = isDone; lsSet(KEYS.vaccinations, all) }
}

export const saveVaccination = (record) => bust('vaccinations', () => _saveVaccination(record))
async function _saveVaccination(record) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const row = {
      pet_id:       record.petId,
      name:         record.name,
      date_given:   record.dateGiven || null,
      next_due:     record.nextDue   || null,
      batch_number: record.batchNumber,
      vet:          record.vet,
      notes:        record.notes,
      is_done:      record.isDone || false,
    }
    if (record.id) {
      const { data, error } = await supabase.from('vaccinations').update(row).eq('id', record.id).select().single()
      if (error) throw error
      return fromSnakeVax(data)
    } else {
      const { data, error } = await supabase.from('vaccinations').insert(row).select().single()
      if (error) throw error
      return fromSnakeVax(data)
    }
  }
  const all = lsGet(KEYS.vaccinations)
  if (record.id) {
    const idx = all.findIndex(r => r.id === record.id)
    if (idx >= 0) all[idx] = { ...all[idx], ...record }; else all.push(record)
  } else {
    record.id = uid(); record.createdAt = new Date().toISOString(); all.push(record)
  }
  lsSet(KEYS.vaccinations, all)
  return record
}

export const deleteVaccination = (id) => bust('vaccinations', () => _deleteVaccination(id))
async function _deleteVaccination(id) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('vaccinations').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.vaccinations, lsGet(KEYS.vaccinations).filter(r => r.id !== id))
}

// ── Allergies ─────────────────────────────────────────────────────────────────

export const getAllergies = (petId) => cached('allergies', petId, () => _getAllergies(petId))
async function _getAllergies(petId) {
  if (isConfigured) {
    const supabase = await getSupabase()
    let q = supabase.from('allergies').select('*').order('created_at', { ascending: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeAllergy)
  }
  const all = lsGet(KEYS.allergies)
  return petId ? all.filter(r => r.petId === petId) : all
}

export const saveAllergy = (record) => bust('allergies', () => _saveAllergy(record))
async function _saveAllergy(record) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const row = {
      pet_id:        record.petId,
      allergen:      record.allergen,
      type:          record.type,
      severity:      record.severity,
      reactions:     record.reactions || [],
      notes:         record.notes,
      diagnosed_date: record.diagnosedDate || null,
    }
    if (record.id) {
      const { data, error } = await supabase.from('allergies').update(row).eq('id', record.id).select().single()
      if (error) throw error
      return fromSnakeAllergy(data)
    } else {
      const { data, error } = await supabase.from('allergies').insert(row).select().single()
      if (error) throw error
      return fromSnakeAllergy(data)
    }
  }
  const all = lsGet(KEYS.allergies)
  if (record.id) {
    const idx = all.findIndex(r => r.id === record.id)
    if (idx >= 0) all[idx] = { ...all[idx], ...record }; else all.push(record)
  } else {
    record.id = uid(); record.createdAt = new Date().toISOString(); all.push(record)
  }
  lsSet(KEYS.allergies, all)
  return record
}

export const deleteAllergy = (id) => bust('allergies', () => _deleteAllergy(id))
async function _deleteAllergy(id) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('allergies').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.allergies, lsGet(KEYS.allergies).filter(r => r.id !== id))
}

// ── Reminders ─────────────────────────────────────────────────────────────────

export const getReminders = (petId) => cached('reminders', petId, () => _getReminders(petId))
async function _getReminders(petId) {
  if (isConfigured) {
    const supabase = await getSupabase()
    let q = supabase.from('reminders').select('*').order('due_date', { ascending: true, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeReminder)
  }
  const all = lsGet(KEYS.reminders)
  return petId ? all.filter(r => r.petId === petId) : all
}

export const markReminderDone = (id, isDone) => bust('reminders', () => _markReminderDone(id, isDone))
async function _markReminderDone(id, isDone) {
  if (isConfigured) {
    // maybeSingle, not single. An UPDATE that matches no visible row is not a
    // malformed request, and `.single()` reported it as "Cannot coerce the
    // result to a single JSON object" — which tells a pet parent nothing.
    //
    // It really happens: the notification bell lists reminders for every pet
    // including ones SHARED with you, and `shared_select_reminders` lets a
    // viewer read them while `shared_update_reminders` (is_pet_editor) refuses
    // the write. Ticking one off returned zero rows.
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('reminders').update({ is_done: isDone }).eq('id', id).select().maybeSingle()
    if (error) throw error
    if (!data) throw new Error("That reminder belongs to a pet you can view but not edit — ask whoever shared it to mark it done.")
    return fromSnakeReminder(data)
  }
  const all = lsGet(KEYS.reminders)
  const idx = all.findIndex(r => r.id === id)
  if (idx >= 0) { all[idx].isDone = isDone; lsSet(KEYS.reminders, all) }
}

export const saveReminder = (record) => bust('reminders', () => _saveReminder(record))
async function _saveReminder(record) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const row = {
      pet_id:    record.petId,
      type:      record.type,
      due_date:  record.dueDate  || null,
      frequency: record.frequency,
      email:     record.email,
      whatsapp:  record.whatsapp,
      notes:     record.notes,
      is_done:   record.isDone || false,
    }
    if (record.id) {
      const { data, error } = await supabase.from('reminders').update(row).eq('id', record.id).select().single()
      if (error) throw error
      return fromSnakeReminder(data)
    } else {
      const { data, error } = await supabase.from('reminders').insert(row).select().single()
      if (error) throw error
      return fromSnakeReminder(data)
    }
  }
  const all = lsGet(KEYS.reminders)
  if (record.id) {
    const idx = all.findIndex(r => r.id === record.id)
    if (idx >= 0) all[idx] = { ...all[idx], ...record }; else all.push(record)
  } else {
    record.id = uid(); record.createdAt = new Date().toISOString(); all.push(record)
  }
  lsSet(KEYS.reminders, all)
  return record
}

export const deleteReminder = (id) => bust('reminders', () => _deleteReminder(id))
async function _deleteReminder(id) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('reminders').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.reminders, lsGet(KEYS.reminders).filter(r => r.id !== id))
}

// ── Weight Logs ───────────────────────────────────────────────────────────────

export const getWeightLogs = (petId) => cached('weight_logs', petId, () => _getWeightLogs(petId))
async function _getWeightLogs(petId) {
  if (isConfigured) {
    const supabase = await getSupabase()
    let q = supabase.from('weight_logs').select('*').order('date', { ascending: true })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeWeightLog)
  }
  const all = lsGet(KEYS.weightLogs)
  return petId ? all.filter(r => r.petId === petId) : all
}

// Also clears `pets`: getPets() carries each pet's latest weight, derived
// from these rows, so the pet card and the emergency card would otherwise
// keep showing the previous figure until the TTL lapsed.
export const saveWeightLog = (log) => bust(['weight_logs', 'pets'], () => _saveWeightLog(log))
async function _saveWeightLog(log) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const row = { pet_id: log.petId, date: log.date, weight: parseFloat(log.weight), notes: log.notes || null }
    if (log.id) {
      const { data, error } = await supabase.from('weight_logs').update(row).eq('id', log.id).select().single()
      if (error) throw error
      return fromSnakeWeightLog(data)
    } else {
      const { data, error } = await supabase.from('weight_logs').insert(row).select().single()
      if (error) throw error
      return fromSnakeWeightLog(data)
    }
  }
  const all = lsGet(KEYS.weightLogs)
  if (log.id) {
    const idx = all.findIndex(r => r.id === log.id)
    if (idx >= 0) all[idx] = { ...all[idx], ...log }; else all.push(log)
  } else {
    log.id = uid(); log.createdAt = new Date().toISOString(); all.push(log)
  }
  lsSet(KEYS.weightLogs, all)
  return log
}

// Also clears `pets`: getPets() carries each pet's latest weight, derived
// from these rows, so the pet card and the emergency card would otherwise
// keep showing the previous figure until the TTL lapsed.
export const deleteWeightLog = (id) => bust(['weight_logs', 'pets'], () => _deleteWeightLog(id))
async function _deleteWeightLog(id) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('weight_logs').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.weightLogs, lsGet(KEYS.weightLogs).filter(r => r.id !== id))
}

// ── Medicines ─────────────────────────────────────────────────────────────────

export const getMedicines = (petId) => cached('medicines', petId, () => _getMedicines(petId))
async function _getMedicines(petId) {
  if (isConfigured) {
    const supabase = await getSupabase()
    let q = supabase.from('medicines').select('*').order('start_date', { ascending: false, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeMedicine)
  }
  const all = lsGet(KEYS.medicines)
  return petId ? all.filter(r => r.petId === petId) : all
}

export const saveMedicine = (med) => bust('medicines', () => _saveMedicine(med))
async function _saveMedicine(med) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const row = {
      pet_id: med.petId, name: med.name, dosage: med.dosage || null,
      frequency: med.frequency || null, category: med.category || 'Other',
      start_date: med.startDate || null, end_date: med.endDate || null,
      next_due: med.nextDue || null, prescribed_by: med.prescribedBy || null,
      reason: med.reason || null, notes: med.notes || null, is_done: med.isDone || false,
    }
    if (med.id) {
      const { data, error } = await supabase.from('medicines').update(row).eq('id', med.id).select().single()
      if (error) throw error
      return fromSnakeMedicine(data)
    } else {
      const { data, error } = await supabase.from('medicines').insert(row).select().single()
      if (error) throw error
      return fromSnakeMedicine(data)
    }
  }
  const all = lsGet(KEYS.medicines)
  if (med.id) {
    const idx = all.findIndex(r => r.id === med.id)
    if (idx >= 0) all[idx] = { ...all[idx], ...med }; else all.push(med)
  } else {
    med.id = uid(); med.createdAt = new Date().toISOString(); all.push(med)
  }
  lsSet(KEYS.medicines, all)
  return med
}

export const deleteMedicine = (id) => bust('medicines', () => _deleteMedicine(id))
async function _deleteMedicine(id) {
  if (isConfigured) { const supabase = await getSupabase(); const { error } = await supabase.from('medicines').delete().eq('id', id); if (error) throw error; return }
  lsSet(KEYS.medicines, lsGet(KEYS.medicines).filter(r => r.id !== id))
}

export const markMedicineDone = (id, isDone) => bust('medicines', () => _markMedicineDone(id, isDone))
async function _markMedicineDone(id, isDone) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const { data, error } = await supabase.from('medicines').update({ is_done: isDone }).eq('id', id).select().single()
    if (error) throw error
    return fromSnakeMedicine(data)
  }
  const all = lsGet(KEYS.medicines)
  const idx = all.findIndex(r => r.id === id)
  if (idx >= 0) { all[idx].isDone = isDone; lsSet(KEYS.medicines, all) }
}

// ── Bills ─────────────────────────────────────────────────────────────────────

export const getBills = (petId) => cached('bills', petId, () => _getBills(petId))
async function _getBills(petId) {
  if (isConfigured) {
    const supabase = await getSupabase()
    let q = supabase.from('bills').select('*').order('date', { ascending: false, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeBill)
  }
  const all = lsGet(KEYS.bills)
  return petId ? all.filter(r => r.petId === petId) : all
}

export const saveBill = (bill) => bust('bills', () => _saveBill(bill))
async function _saveBill(bill) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const row = {
      pet_id: bill.petId, date: bill.date || null, clinic: bill.clinic || null,
      invoice_number: bill.invoiceNumber || null, line_items: bill.lineItems || [],
      total_amount: bill.totalAmount ? parseFloat(bill.totalAmount) : null,
      currency: bill.currency || 'INR', notes: bill.notes || null,
    }
    if (bill.id) {
      const { data, error } = await supabase.from('bills').update(row).eq('id', bill.id).select().single()
      if (error) throw error
      return fromSnakeBill(data)
    } else {
      const { data, error } = await supabase.from('bills').insert(row).select().single()
      if (error) throw error
      return fromSnakeBill(data)
    }
  }
  const all = lsGet(KEYS.bills)
  if (bill.id) {
    const idx = all.findIndex(r => r.id === bill.id)
    if (idx >= 0) all[idx] = { ...all[idx], ...bill }; else all.push(bill)
  } else {
    bill.id = uid(); bill.createdAt = new Date().toISOString(); all.push(bill)
  }
  lsSet(KEYS.bills, all)
  return bill
}

export const deleteBill = (id) => bust('bills', () => _deleteBill(id))
async function _deleteBill(id) {
  if (isConfigured) { const supabase = await getSupabase(); const { error } = await supabase.from('bills').delete().eq('id', id); if (error) throw error; return }
  lsSet(KEYS.bills, lsGet(KEYS.bills).filter(r => r.id !== id))
}

export async function getFeedback() {
  if (!isConfigured) return []
  // Embed the business a provider's message is about. feedback.provider_id is a
  // real FK to providers, which is what lets PostgREST do this join, and the
  // admin reads providers through "Admin manages providers". A pet parent's
  // row has provider_id null and comes back with providers: null, unchanged.
  const supabase = await getSupabase()
  const { data, error } = await supabase
    .from('feedback')
    .select('*, providers(name, type, area)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ── Providers ────────────────────────────────────────────────────────────────

// Filtering, counting and paging all happen in Postgres — PostgREST caps
// responses at 1000 rows, so fetching everything and filtering in the browser
// silently drops providers once the table grows past that.
export async function getProviders({
  approvedOnly = true,
  type = null,
  area = null,
  search = '',
  limit = 60,
  offset = 0,
} = {}) {
  if (!isConfigured) return { rows: [], count: 0 }
  const supabase = await getSupabase()

  const { data, error } = await supabase.rpc('search_providers', {
    approved_only: approvedOnly,
    filter_type:   type,
    filter_area:   area,
    search_term:   search.trim() || null,
    page_limit:    limit,
    page_offset:   offset,
  })
  if (error) throw error

  const rows = (data || []).map(r => r.provider)
  // total_count comes from a window function, so it's identical on every row
  // and absent entirely when nothing matched.
  return { rows, count: data?.[0]?.total_count ?? 0 }
}

export async function getProviderFacets({ approvedOnly = true, area = null } = {}) {
  if (!isConfigured) return { total: 0, types: {}, areas: [] }
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('provider_facets', {
    approved_only: approvedOnly,
    filter_area: area,
  })
  if (error) throw error
  return data || { total: 0, types: {}, areas: [] }
}

export const saveProvider = (provider) => bust('boarders', () => _saveProvider(provider))
async function _saveProvider(provider) {
  if (!isConfigured) return provider
  const supabase = await getSupabase()
  const { id, ...rest } = provider
  if (id) {
    const { data, error } = await supabase.from('providers').update(rest).eq('id', id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('providers').insert(rest).select().single()
  if (error) throw error
  return data
}

export const deleteProvider = (id) => bust('boarders', () => _deleteProvider(id))
async function _deleteProvider(id) {
  if (!isConfigured) return
  const supabase = await getSupabase()
  const { error } = await supabase.from('providers').delete().eq('id', id)
  if (error) throw error
}

// ── Boarding trips ───────────────────────────────────────────────────────────
// One planned stay at a boarder. `checklist` holds the parent's manual answers
// keyed by requirement id, layered over whatever boarding.js can derive from
// the pet's own records — same jsonb-blob approach as bills.line_items, since
// the key set is fixed by the boarder's policy and is never queried across
// trips.

export const getBoardingTrips = (petId) => cached('boarding_trips', petId, () => _getBoardingTrips(petId))
async function _getBoardingTrips(petId) {
  if (isConfigured) {
    const supabase = await getSupabase()
    let q = supabase.from('boarding_trips').select('*').order('start_date', { ascending: false, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeBoardingTrip)
  }
  const all = lsGet(KEYS.boardingTrips)
  return petId ? all.filter(r => r.petId === petId) : all
}

export const saveBoardingTrip = (trip) => bust('boarding_trips', () => _saveBoardingTrip(trip))
async function _saveBoardingTrip(trip) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const row = {
      pet_id:        trip.petId,
      provider_id:   trip.providerId || null,
      provider_name: trip.providerName || null,
      start_date:    trip.startDate || null,
      start_slot:    trip.startSlot || null,
      end_date:      trip.endDate   || null,
      end_slot:      trip.endSlot   || null,
      trial_date:    trip.trialDate || null,
      is_first_stay: trip.isFirstStay ?? true,
      checklist:     trip.checklist || {},
      generated_reminder_ids: trip.generatedReminderIds || [],
      notes:         trip.notes || null,
    }
    if (trip.id) {
      const { data, error } = await supabase.from('boarding_trips').update(row).eq('id', trip.id).select().single()
      if (error) throw error
      return fromSnakeBoardingTrip(data)
    }
    const { data, error } = await supabase.from('boarding_trips').insert(row).select().single()
    if (error) throw error
    return fromSnakeBoardingTrip(data)
  }
  const all = lsGet(KEYS.boardingTrips)
  if (trip.id) {
    const idx = all.findIndex(r => r.id === trip.id)
    if (idx >= 0) all[idx] = { ...all[idx], ...trip }; else all.push(trip)
  } else {
    trip.id = uid(); trip.createdAt = new Date().toISOString(); all.push(trip)
  }
  lsSet(KEYS.boardingTrips, all)
  return trip
}

export const deleteBoardingTrip = (id) => bust('boarding_trips', () => _deleteBoardingTrip(id))
async function _deleteBoardingTrip(id) {
  if (isConfigured) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('boarding_trips').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.boardingTrips, lsGet(KEYS.boardingTrips).filter(r => r.id !== id))
}

// Every boarder, for the trip planner's search box. Fetched whole and ranked
// in the browser: Postgres ILIKE can't find "unleesh", and the phonetic
// matching that can is cheap over a few hundred rows held in memory.
export const getBoarders = () => cached('boarders', null, _getBoarders)
async function _getBoarders() {
  if (!isConfigured) return []
  const { rows } = await getProviders({ type: 'Boarder', limit: 500 })
  return rows
}

// ── Snake ↔ camelCase helpers ─────────────────────────────────────────────────

/**
 * A pet, in database column names.
 *
 * ── Pass the WHOLE pet to savePet(), never a partial object ────────────────
 *
 * Most fields below are left `undefined` when the caller does not carry them,
 * so JSON.stringify drops the key and the PATCH omits the column. But `dob`,
 * `weight` and `photo` use `|| null`, which means a partial object does not
 * omit those columns -- it sets them to NULL.
 *
 * So `savePet({ id, weight: 2.6 })` does not update only the weight. It also
 * erases the pet's date of birth and its photo. Every caller today spreads the
 * existing pet first (`savePet({ ...pet, weight })`), which is why this has
 * never bitten; it is written down because it nearly did.
 */
function toSnake(pet) {
  return {
    name:             pet.name,
    species:          pet.species,
    breed:            pet.breed,
    gender:           pet.gender,
    dob:              pet.dob       || null,
    weight:           pet.weight    ? parseFloat(pet.weight) : null,
    color:            pet.color,
    microchip_id:     pet.microchipId,
    insurance_policy: pet.insurancePolicy,
    vet_name:         pet.vetName,
    vet_phone:        pet.vetPhone,
    vet_email:        pet.vetEmail,
    notes:            pet.notes,
    photo:            pet.photo     || null,
    // Boarding profile — what a boarder, sitter or vet needs to know to look
    // after this animal for a few days. Left `undefined` when the caller
    // doesn't carry them, so JSON.stringify drops the keys and the PATCH
    // omits the columns; that keeps saves working before boarding.sql is run.
    food_preferences:      pet.foodPreferences,
    feeding_schedule:      pet.feedingSchedule,
    diet_notes:            pet.dietNotes,
    temperament:           pet.temperament,
    anxiety_notes:         pet.anxietyNotes,
    triggers:              pet.triggers,
    socialises_with_dogs:  pet.socialisesWithDogs,
    handling_notes:        pet.handlingNotes,
  }
}

// Used when reading pets back from Supabase
function fromSnakePet(r) {
  return {
    id:              r.id,
    name:            r.name,
    species:         r.species,
    breed:           r.breed,
    gender:          r.gender,
    dob:             r.dob,
    weight:          r.weight,
    color:           r.color,
    microchipId:     r.microchip_id,
    insurancePolicy: r.insurance_policy,
    vetName:         r.vet_name,
    vetPhone:        r.vet_phone,
    vetEmail:        r.vet_email,
    notes:           r.notes,
    photo:           r.photo || null,
    createdAt:       r.created_at,
    // Array columns are NULL for every pet created before boarding.sql ran,
    // so default them here rather than making every consumer guard a .map().
    foodPreferences:    r.food_preferences || [],
    feedingSchedule:    r.feeding_schedule || '',
    dietNotes:          r.diet_notes || '',
    temperament:        r.temperament || '',
    anxietyNotes:       r.anxiety_notes || '',
    triggers:           r.triggers || [],
    socialisesWithDogs: r.socialises_with_dogs ?? null,
    handlingNotes:      r.handling_notes || '',
  }
}

function fromSnakeMedical(r) {
  return {
    id:            r.id,
    petId:         r.pet_id,
    date:          r.date,
    type:          r.type,
    title:         r.title,
    description:   r.description,
    vet:           r.vet,
    cost:          r.cost,
    isAbnormal:    r.is_abnormal,
    abnormalities: r.abnormalities || [],
    createdAt:     r.created_at,
  }
}

function fromSnakeVax(r) {
  return {
    id:          r.id,
    petId:       r.pet_id,
    name:        r.name,
    dateGiven:   r.date_given,
    nextDue:     r.next_due,
    batchNumber: r.batch_number,
    vet:         r.vet,
    notes:       r.notes,
    isDone:      r.is_done || false,
    createdAt:   r.created_at,
  }
}

function fromSnakeAllergy(r) {
  return {
    id:           r.id,
    petId:        r.pet_id,
    allergen:     r.allergen,
    type:         r.type,
    severity:     r.severity,
    reactions:    r.reactions || [],
    notes:        r.notes,
    diagnosedDate: r.diagnosed_date,
    createdAt:    r.created_at,
  }
}

function fromSnakeReminder(r) {
  return {
    id:        r.id,
    petId:     r.pet_id,
    type:      r.type,
    dueDate:   r.due_date,
    frequency: r.frequency,
    email:     r.email,
    whatsapp:  r.whatsapp,
    notes:     r.notes,
    isDone:    r.is_done || false,
    createdAt: r.created_at,
  }
}

function fromSnakeMedicine(r) {
  return {
    id: r.id, petId: r.pet_id, name: r.name, dosage: r.dosage,
    frequency: r.frequency, category: r.category || 'Other',
    startDate: r.start_date, endDate: r.end_date, nextDue: r.next_due,
    prescribedBy: r.prescribed_by, reason: r.reason, notes: r.notes,
    isDone: r.is_done || false, createdAt: r.created_at,
  }
}

function fromSnakeBill(r) {
  return {
    id: r.id, petId: r.pet_id, date: r.date, clinic: r.clinic,
    invoiceNumber: r.invoice_number, lineItems: r.line_items || [],
    totalAmount: r.total_amount, currency: r.currency || 'INR',
    notes: r.notes, createdAt: r.created_at,
  }
}

function fromSnakeWeightLog(r) {
  return {
    id:        r.id,
    petId:     r.pet_id,
    date:      r.date,
    weight:    r.weight,
    notes:     r.notes,
    createdAt: r.created_at,
  }
}

function fromSnakeBoardingTrip(r) {
  return {
    id: r.id, petId: r.pet_id,
    providerId: r.provider_id, providerName: r.provider_name,
    startDate: r.start_date, startSlot: r.start_slot,
    endDate: r.end_date, endSlot: r.end_slot,
    trialDate: r.trial_date,
    isFirstStay: r.is_first_stay ?? true,
    checklist: r.checklist || {},
    generatedReminderIds: r.generated_reminder_ids || [],
    notes: r.notes, createdAt: r.created_at,
  }
}
