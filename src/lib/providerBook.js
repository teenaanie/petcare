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
  trialDone: !!r.trial_done, criteriaMet: !!r.criteria_met,
  // Kept as whatever the column holds — null when nobody typed one. NOT
  // defaulted to 0: "no price recorded" and "this one was free" are different
  // facts, and every total downstream reports which rows it could see.
  amount: r.amount ?? null,
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
    trialDone, criteriaMet, amount,
  } = fields
  if (!startsOn) throw new Error('A booking needs a start date.')
  if (endsOn && endsOn < startsOn) throw new Error('The end date is before the start date.')
  const row = {
    provider_id: providerId, customer_id: customerId,
    provider_pet_id: providerPetId || null,
    kind: kind || 'Boarding', starts_on: startsOn, ends_on: endsOn || null,
    starts_at: startsAt || null, status: status || 'booked',
    notes: notes?.trim() || null,
    trial_done: !!trialDone, criteria_met: !!criteriaMet,
    // An empty box means "not said", not zero. `Number('')` is 0, which would
    // quietly record every unpriced booking as free and make a year's takings
    // read as complete when it is not.
    amount: amount === '' || amount === null || amount === undefined ? null : Number(amount),
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

// ── The day log ─────────────────────────────────────────────────────────────
//
// Written one entry at a time over the days of a stay, by whoever is on shift.
// A row each rather than a blob on the booking: two people with the same stay
// open would otherwise overwrite each other's line.

const fromLog = r => ({
  id: r.id, appointmentId: r.appointment_id, providerId: r.provider_id,
  onDate: r.on_date, body: r.body, createdAt: r.created_at,
})

export async function getLogs(supabase, appointmentId) {
  if (!supabase || !appointmentId) return []
  const { data, error } = await supabase
    .from('provider_appointment_logs').select('*')
    .eq('appointment_id', appointmentId)
    .order('on_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(fromLog)
}

export async function saveLog(supabase, fields) {
  const { appointmentId, providerId, onDate, body, createdBy } = fields
  const text = (body || '').trim()
  if (!text) throw new Error('Write something first.')
  const { data, error } = await supabase.from('provider_appointment_logs').insert({
    appointment_id: appointmentId, provider_id: providerId,
    on_date: onDate || undefined, body: text, created_by: createdBy,
  }).select().single()
  if (error) throw error
  return fromLog(data)
}

export async function deleteLog(supabase, id) {
  const { error } = await supabase.from('provider_appointment_logs').delete().eq('id', id)
  if (error) throw error
}

/**
 * The numbers the dashboard leads with.
 *
 * Counts, not a chart: a handful of headline figures is a KPI row, and a
 * one-bar bar chart of "5 pets here" would be a worse way to say five.
 *
 * `needsAttention` is the one that earns its place. A stay starting within the
 * week whose trial is not done or whose criteria are not met is the thing a
 * boarder must act on BEFORE the animal arrives, and it is invisible in a plain
 * list of bookings.
 */
export function bookSummary({ customers = [], pets = [], appointments = [] }, today, { flags = true } = {}) {
  const g = groupAppointments(appointments, today)
  const soon = new Date(`${today}T00:00:00Z`)
  soon.setUTCDate(soon.getUTCDate() + 7)
  const within7 = soon.toISOString().slice(0, 10)

  // `flags` is off for every business that has no trial day and no boarding
  // criteria — a vet or a shop. Without this they would open the app to find
  // EVERY upcoming visit flagged as needing attention, because two booleans
  // nobody ever ticks are false, and the one tile that is meant to mean
  // "act now" would mean nothing at all.
  const needsAttention = flags ? g.upcoming.filter(
    a => a.startsOn <= within7 && (!a.trialDone || !a.criteriaMet)).length : 0

  return {
    here:      g.current.length,
    upcoming:  g.upcoming.length,
    customers: customers.length,
    pets:      pets.length,
    past:      g.past.length,
    needsAttention,
  }
}
