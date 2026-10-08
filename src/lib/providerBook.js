// The provider's own book: customers, their animals, and bookings.
//
// Every function takes the supabase client, for the same reason
// src/lib/stayUpdates.js does: the provider shell signs in under its own
// storage key, and a module that reached for getSupabase() itself would query
// as a signed-out pet parent, see nothing, and give no error explaining why.
//
// Nothing here touches public.pets, auth.users, or any table a pet parent owns.
// These are the provider's records about their own business, and RLS scopes
// every one of them to `is_provider_member(provider_id)`.

const fromCustomer = r => ({
  id: r.id, providerId: r.provider_id, name: r.name,
  phone: r.phone, email: r.email, notes: r.notes, createdAt: r.created_at,
})

const fromPet = r => ({
  id: r.id, providerId: r.provider_id, customerId: r.customer_id,
  name: r.name, species: r.species, breed: r.breed, notes: r.notes,
  noteId: r.note_id, createdAt: r.created_at,
})

const fromAppointment = r => ({
  id: r.id, providerId: r.provider_id, customerId: r.customer_id,
  providerPetId: r.provider_pet_id, kind: r.kind,
  startsOn: r.starts_on, endsOn: r.ends_on, startsAt: r.starts_at,
  status: r.status, notes: r.notes, createdAt: r.created_at,
})

export const APPOINTMENT_KINDS  = ['Boarding', 'Day care', 'Grooming', 'Walk', 'Other']
export const APPOINTMENT_STATUS = ['booked', 'completed', 'cancelled', 'no_show']

/** Everything in the book for these businesses, in one round trip each. */
export async function getBook(supabase, providerIds = []) {
  const ids = [...new Set((providerIds || []).filter(Boolean))]
  if (!supabase || ids.length === 0) return { customers: [], pets: [], appointments: [] }

  const [c, p, a] = await Promise.all([
    supabase.from('provider_customers').select('*').in('provider_id', ids).order('name'),
    supabase.from('provider_pets').select('*').in('provider_id', ids).order('name'),
    supabase.from('provider_appointments').select('*').in('provider_id', ids)
      .order('starts_on', { ascending: false }),
  ])
  for (const r of [c, p, a]) if (r.error) throw r.error

  return {
    customers:    (c.data || []).map(fromCustomer),
    pets:         (p.data || []).map(fromPet),
    appointments: (a.data || []).map(fromAppointment),
  }
}

export async function saveCustomer(supabase, { id, providerId, name, phone, email, notes, createdBy }) {
  const row = {
    provider_id: providerId, name: (name || '').trim(),
    phone: phone?.trim() || null, email: email?.trim() || null,
    notes: notes?.trim() || null,
  }
  if (!row.name) throw new Error('A customer needs a name.')
  const q = id
    ? supabase.from('provider_customers').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
    : supabase.from('provider_customers').insert({ ...row, created_by: createdBy })
  const { data, error } = await q.select().single()
  if (error) throw error
  return fromCustomer(data)
}

export async function savePet(supabase, { id, providerId, customerId, name, species, breed, notes, noteId }) {
  const row = {
    provider_id: providerId, customer_id: customerId, name: (name || '').trim(),
    species: species?.trim() || null, breed: breed?.trim() || null,
    notes: notes?.trim() || null, note_id: noteId || null,
  }
  if (!row.name) throw new Error('A pet needs a name.')
  const q = id
    ? supabase.from('provider_pets').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
    : supabase.from('provider_pets').insert(row)
  const { data, error } = await q.select().single()
  if (error) throw error
  return fromPet(data)
}

// `fields` is destructured in the BODY rather than in the signature, which is
// not a style preference. check:supabase-binding looks only a short way back
// from a function's opening brace to find what binds `supabase`, so a long
// destructured parameter list pushes the binding out of its window and the
// check reports two unbound uses against perfectly valid code. Reproduced
// against the checker in isolation: the same function with a shorter parameter
// list passes.
//
// Fixed here rather than in the checker on purpose. Its own header records two
// occasions when widening a pattern made it miss a real ReferenceError, and a
// short signature costs nothing.
export async function saveAppointment(supabase, fields) {
  const {
    id, providerId, customerId, providerPetId, kind,
    startsOn, endsOn, startsAt, status, notes, createdBy,
  } = fields
  if (!startsOn) throw new Error('A booking needs a start date.')
  if (endsOn && endsOn < startsOn) throw new Error('The end date is before the start date.')
  const row = {
    provider_id: providerId, customer_id: customerId,
    provider_pet_id: providerPetId || null,
    kind: kind || 'Boarding', starts_on: startsOn, ends_on: endsOn || null,
    starts_at: startsAt || null, status: status || 'booked',
    notes: notes?.trim() || null,
  }
  const q = id
    ? supabase.from('provider_appointments').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
    : supabase.from('provider_appointments').insert({ ...row, created_by: createdBy })
  const { data, error } = await q.select().single()
  if (error) throw error
  return fromAppointment(data)
}

/**
 * Removing a customer takes their animals and bookings with them, by cascade.
 * Said out loud at the call site rather than here, because it is the kind of
 * delete somebody regrets.
 */
export async function deleteCustomer(supabase, id) {
  const { error } = await supabase.from('provider_customers').delete().eq('id', id)
  if (error) throw error
}

export async function deleteAppointment(supabase, id) {
  const { error } = await supabase.from('provider_appointments').delete().eq('id', id)
  if (error) throw error
}

/**
 * The diary: bookings split the way a provider thinks about their week.
 *
 * Deliberately the same four buckets the inform-note inbox uses, so the two
 * halves of the dashboard read alike. Cancelled and no-show bookings drop out
 * of the forward view entirely — they are history the moment they happen, and
 * leaving them in "coming up" makes a quiet week look busy.
 */
export function groupAppointments(appointments = [], today) {
  const out = { current: [], upcoming: [], past: [] }
  for (const a of appointments) {
    if (a.status === 'cancelled' || a.status === 'no_show') { out.past.push(a); continue }
    const end = a.endsOn || a.startsOn
    if (a.startsOn > today)                     out.upcoming.push(a)
    else if (end >= today)                      out.current.push(a)
    else                                        out.past.push(a)
  }
  out.upcoming.sort((x, y) => String(x.startsOn).localeCompare(String(y.startsOn)))
  out.current.sort((x, y) => String(x.startsOn).localeCompare(String(y.startsOn)))
  return out
}
