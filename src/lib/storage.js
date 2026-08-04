// storage.js — uses Supabase when configured, falls back to localStorage.
// This means all devices stay in sync automatically once Supabase is connected.

import { supabase, isConfigured } from './supabase.js'

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
}

function lsGet(key)       { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } }
function lsSet(key, data) { localStorage.setItem(key, JSON.stringify(data)) }
function uid()            { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

// ── Pets ──────────────────────────────────────────────────────────────────────

export async function getPets() {
  if (isConfigured) {
    const { data, error } = await supabase.from('pets').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return data.map(fromSnakePet)
  }
  return lsGet(KEYS.pets)
}

export async function savePet(pet) {
  if (isConfigured) {
    if (pet.id) {
      const { data, error } = await supabase.from('pets').update(toSnake(pet)).eq('id', pet.id).select().single()
      if (error) throw error
      return fromSnakePet(data)
    } else {
      const { data, error } = await supabase.from('pets').insert(toSnake(pet)).select().single()
      if (error) throw error
      return fromSnakePet(data)
    }
  }
  // localStorage fallback
  const pets = lsGet(KEYS.pets)
  if (pet.id) {
    const idx = pets.findIndex(p => p.id === pet.id)
    if (idx >= 0) pets[idx] = pet; else pets.push(pet)
  } else {
    pet.id = uid(); pet.createdAt = new Date().toISOString(); pets.push(pet)
  }
  lsSet(KEYS.pets, pets)
  return pet
}

export async function deletePet(id) {
  if (isConfigured) {
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

export async function getMedicalHistory(petId) {
  if (isConfigured) {
    let q = supabase.from('medical_records').select('*').order('date', { ascending: false, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeMedical)
  }
  const all = lsGet(KEYS.medical)
  return petId ? all.filter(r => r.petId === petId) : all
}

export async function saveMedicalRecord(record) {
  if (isConfigured) {
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
    if (idx >= 0) all[idx] = record; else all.push(record)
  } else {
    record.id = uid(); record.createdAt = new Date().toISOString(); all.push(record)
  }
  lsSet(KEYS.medical, all)
  return record
}

export async function deleteMedicalRecord(id) {
  if (isConfigured) {
    const { error } = await supabase.from('medical_records').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.medical, lsGet(KEYS.medical).filter(r => r.id !== id))
}

// ── Vaccinations ──────────────────────────────────────────────────────────────

export async function getVaccinations(petId) {
  if (isConfigured) {
    let q = supabase.from('vaccinations').select('*').order('date_given', { ascending: false, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeVax)
  }
  const all = lsGet(KEYS.vaccinations)
  return petId ? all.filter(r => r.petId === petId) : all
}

export async function markVaccinationDone(id, isDone) {
  if (isConfigured) {
    const { data, error } = await supabase.from('vaccinations').update({ is_done: isDone }).eq('id', id).select().single()
    if (error) throw error
    return fromSnakeVax(data)
  }
  const all = lsGet(KEYS.vaccinations)
  const idx = all.findIndex(r => r.id === id)
  if (idx >= 0) { all[idx].isDone = isDone; lsSet(KEYS.vaccinations, all) }
}

export async function saveVaccination(record) {
  if (isConfigured) {
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
    if (idx >= 0) all[idx] = record; else all.push(record)
  } else {
    record.id = uid(); record.createdAt = new Date().toISOString(); all.push(record)
  }
  lsSet(KEYS.vaccinations, all)
  return record
}

export async function deleteVaccination(id) {
  if (isConfigured) {
    const { error } = await supabase.from('vaccinations').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.vaccinations, lsGet(KEYS.vaccinations).filter(r => r.id !== id))
}

// ── Allergies ─────────────────────────────────────────────────────────────────

export async function getAllergies(petId) {
  if (isConfigured) {
    let q = supabase.from('allergies').select('*').order('created_at', { ascending: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeAllergy)
  }
  const all = lsGet(KEYS.allergies)
  return petId ? all.filter(r => r.petId === petId) : all
}

export async function saveAllergy(record) {
  if (isConfigured) {
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
    if (idx >= 0) all[idx] = record; else all.push(record)
  } else {
    record.id = uid(); record.createdAt = new Date().toISOString(); all.push(record)
  }
  lsSet(KEYS.allergies, all)
  return record
}

export async function deleteAllergy(id) {
  if (isConfigured) {
    const { error } = await supabase.from('allergies').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.allergies, lsGet(KEYS.allergies).filter(r => r.id !== id))
}

// ── Reminders ─────────────────────────────────────────────────────────────────

export async function getReminders(petId) {
  if (isConfigured) {
    let q = supabase.from('reminders').select('*').order('due_date', { ascending: true, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeReminder)
  }
  const all = lsGet(KEYS.reminders)
  return petId ? all.filter(r => r.petId === petId) : all
}

export async function markReminderDone(id, isDone) {
  if (isConfigured) {
    const { data, error } = await supabase.from('reminders').update({ is_done: isDone }).eq('id', id).select().single()
    if (error) throw error
    return fromSnakeReminder(data)
  }
  const all = lsGet(KEYS.reminders)
  const idx = all.findIndex(r => r.id === id)
  if (idx >= 0) { all[idx].isDone = isDone; lsSet(KEYS.reminders, all) }
}

export async function saveReminder(record) {
  if (isConfigured) {
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
    if (idx >= 0) all[idx] = record; else all.push(record)
  } else {
    record.id = uid(); record.createdAt = new Date().toISOString(); all.push(record)
  }
  lsSet(KEYS.reminders, all)
  return record
}

export async function deleteReminder(id) {
  if (isConfigured) {
    const { error } = await supabase.from('reminders').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.reminders, lsGet(KEYS.reminders).filter(r => r.id !== id))
}

// ── Weight Logs ───────────────────────────────────────────────────────────────

export async function getWeightLogs(petId) {
  if (isConfigured) {
    let q = supabase.from('weight_logs').select('*').order('date', { ascending: true })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeWeightLog)
  }
  const all = lsGet(KEYS.weightLogs)
  return petId ? all.filter(r => r.petId === petId) : all
}

export async function saveWeightLog(log) {
  if (isConfigured) {
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
    if (idx >= 0) all[idx] = log; else all.push(log)
  } else {
    log.id = uid(); log.createdAt = new Date().toISOString(); all.push(log)
  }
  lsSet(KEYS.weightLogs, all)
  return log
}

export async function deleteWeightLog(id) {
  if (isConfigured) {
    const { error } = await supabase.from('weight_logs').delete().eq('id', id)
    if (error) throw error
    return
  }
  lsSet(KEYS.weightLogs, lsGet(KEYS.weightLogs).filter(r => r.id !== id))
}

// ── Medicines ─────────────────────────────────────────────────────────────────

export async function getMedicines(petId) {
  if (isConfigured) {
    let q = supabase.from('medicines').select('*').order('start_date', { ascending: false, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeMedicine)
  }
  const all = lsGet(KEYS.medicines)
  return petId ? all.filter(r => r.petId === petId) : all
}

export async function saveMedicine(med) {
  if (isConfigured) {
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
    if (idx >= 0) all[idx] = med; else all.push(med)
  } else {
    med.id = uid(); med.createdAt = new Date().toISOString(); all.push(med)
  }
  lsSet(KEYS.medicines, all)
  return med
}

export async function deleteMedicine(id) {
  if (isConfigured) { const { error } = await supabase.from('medicines').delete().eq('id', id); if (error) throw error; return }
  lsSet(KEYS.medicines, lsGet(KEYS.medicines).filter(r => r.id !== id))
}

export async function markMedicineDone(id, isDone) {
  if (isConfigured) {
    const { data, error } = await supabase.from('medicines').update({ is_done: isDone }).eq('id', id).select().single()
    if (error) throw error
    return fromSnakeMedicine(data)
  }
  const all = lsGet(KEYS.medicines)
  const idx = all.findIndex(r => r.id === id)
  if (idx >= 0) { all[idx].isDone = isDone; lsSet(KEYS.medicines, all) }
}

// ── Bills ─────────────────────────────────────────────────────────────────────

export async function getBills(petId) {
  if (isConfigured) {
    let q = supabase.from('bills').select('*').order('date', { ascending: false, nullsFirst: false })
    if (petId) q = q.eq('pet_id', petId)
    const { data, error } = await q
    if (error) throw error
    return data.map(fromSnakeBill)
  }
  const all = lsGet(KEYS.bills)
  return petId ? all.filter(r => r.petId === petId) : all
}

export async function saveBill(bill) {
  if (isConfigured) {
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
    if (idx >= 0) all[idx] = bill; else all.push(bill)
  } else {
    bill.id = uid(); bill.createdAt = new Date().toISOString(); all.push(bill)
  }
  lsSet(KEYS.bills, all)
  return bill
}

export async function deleteBill(id) {
  if (isConfigured) { const { error } = await supabase.from('bills').delete().eq('id', id); if (error) throw error; return }
  lsSet(KEYS.bills, lsGet(KEYS.bills).filter(r => r.id !== id))
}

// ── Snake ↔ camelCase helpers ─────────────────────────────────────────────────

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
