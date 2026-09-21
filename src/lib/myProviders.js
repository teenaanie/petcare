// src/lib/myProviders.js
// Each account's own list of vets, boarders, groomers and shops.
//
// This replaces vet_name / vet_phone / vet_email on `pets`, which allowed
// exactly one vet per pet and no groomer, boarder or store at all.
//
// A row either points at the shared directory (provider_id set) or is one the
// owner typed in themselves (provider_id null). Either way `name` and the
// contact fields are a SNAPSHOT taken when it was added. That is deliberate:
//
//   · the list renders without joining 976 rows,
//   · it survives a directory entry being renamed or removed, and
//   · editing your entry never writes to the row every other user sees.
//
// pet_id null means the whole household; set means that pet overrides the
// household choice, for a pet that sees its own specialist.

import { supabase, isConfigured } from './supabase.js'

const KEY = 'mypetcare_user_providers'   // localStorage fallback, as elsewhere

const lsGet = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
const lsSet = rows => { try { localStorage.setItem(KEY, JSON.stringify(rows)) } catch { /* private mode */ } }
const uid   = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()))

function fromRow(r) {
  return {
    id: r.id, userId: r.user_id, providerId: r.provider_id, petId: r.pet_id,
    category: r.category, name: r.name,
    phone: r.phone, whatsapp: r.whatsapp, email: r.email,
    address: r.address, website: r.website,
    nickname: r.nickname, notes: r.notes,
    isPrimary: r.is_primary, createdAt: r.created_at,
  }
}

function toRow(p, userId) {
  return {
    user_id: userId, provider_id: p.providerId || null, pet_id: p.petId || null,
    category: p.category, name: (p.name || '').trim(),
    phone: p.phone || null, whatsapp: p.whatsapp || null, email: p.email || null,
    address: p.address || null, website: p.website || null,
    nickname: p.nickname || null, notes: p.notes || null,
    is_primary: !!p.isPrimary,
  }
}

export async function getMyProviders() {
  if (!isConfigured) return lsGet()
  const { data, error } = await supabase
    .from('user_providers').select('*')
    .order('category').order('is_primary', { ascending: false }).order('name')
  if (error) throw error
  return (data || []).map(fromRow)
}

/**
 * Only one primary per category per scope, enforced by a unique index. Clearing
 * the old one first turns what would be a constraint violation into the
 * behaviour a user expects: picking a new primary demotes the previous one.
 */
async function clearPrimary(userId, category, petId, exceptId) {
  let q = supabase.from('user_providers')
    .update({ is_primary: false })
    .eq('user_id', userId).eq('category', category).eq('is_primary', true)
  q = petId ? q.eq('pet_id', petId) : q.is('pet_id', null)
  if (exceptId) q = q.neq('id', exceptId)
  const { error } = await q
  if (error) throw error
}

export async function saveMyProvider(p) {
  if (!isConfigured) {
    const all = lsGet()
    if (p.isPrimary) {
      all.forEach(r => {
        if (r.category === p.category && (r.petId || null) === (p.petId || null) && r.id !== p.id) r.isPrimary = false
      })
    }
    const idx = all.findIndex(r => r.id === p.id)
    if (idx >= 0) all[idx] = { ...all[idx], ...p }
    else all.push({ ...p, id: uid(), createdAt: new Date().toISOString() })
    lsSet(all)
    return all[idx >= 0 ? idx : all.length - 1]
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Please sign in.')

  if (p.isPrimary) await clearPrimary(user.id, p.category, p.petId, p.id)

  const row = toRow(p, user.id)
  const q = p.id
    ? supabase.from('user_providers').update(row).eq('id', p.id).select().single()
    : supabase.from('user_providers').insert(row).select().single()

  const { data, error } = await q
  if (error) {
    // The unique index has a name a user should never see.
    if (/user_providers_no_dupe/.test(error.message)) {
      throw new Error('That provider is already in your list.')
    }
    throw error
  }
  return fromRow(data)
}

export async function deleteMyProvider(id) {
  if (!isConfigured) { lsSet(lsGet().filter(r => r.id !== id)); return }
  const { error } = await supabase.from('user_providers').delete().eq('id', id)
  if (error) throw error
}

export async function setPrimary(p) {
  return saveMyProvider({ ...p, isPrimary: true })
}

/** Turn a directory listing into an entry, snapshotting its contact details. */
export function fromDirectory(provider, { category, petId = null } = {}) {
  return {
    providerId: provider.id,
    petId,
    category: category || provider.type,
    name: provider.name,
    phone: provider.phone || '',
    whatsapp: provider.whatsapp || '',
    email: provider.email || '',
    address: [provider.address, provider.area].filter(Boolean).join(', '),
    website: provider.website || '',
    nickname: '', notes: '', isPrimary: false,
  }
}

/**
 * The number to open WhatsApp on. Falls back to the phone number, since most
 * Indian businesses use the same one for both — matching what the directory
 * already does in ProviderDirectory.jsx.
 */
export function whatsappLink(p, message) {
  const n = (p.whatsapp || p.phone || '').replace(/\D/g, '')
  if (!n) return null
  const withCountry = n.length === 10 ? `91${n}` : n
  return `https://wa.me/${withCountry}${message ? `?text=${encodeURIComponent(message)}` : ''}`
}

export function telLink(p) {
  const n = (p.phone || p.whatsapp || '').replace(/[^\d+]/g, '')
  return n ? `tel:${n}` : null
}
