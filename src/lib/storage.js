// Local storage helpers — works without any backend.
// Replace these with Supabase calls once you connect your account.

const KEYS = {
  pets: 'mypetcare_pets',
  medical: 'mypetcare_medical',
  vaccinations: 'mypetcare_vaccinations',
  allergies: 'mypetcare_allergies',
  reminders: 'mypetcare_reminders',
}

function get(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}

function set(key, data) {
  localStorage.setItem(key, JSON.stringify(data))
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// ── Pets ──────────────────────────────────────────────────────────────────────

export function getPets() { return get(KEYS.pets) }

export function savePet(pet) {
  const pets = getPets()
  if (pet.id) {
    const idx = pets.findIndex(p => p.id === pet.id)
    if (idx >= 0) pets[idx] = pet; else pets.push(pet)
  } else {
    pet.id = uid()
    pet.createdAt = new Date().toISOString()
    pets.push(pet)
  }
  set(KEYS.pets, pets)
  return pet
}

export function deletePet(id) {
  set(KEYS.pets, getPets().filter(p => p.id !== id))
  // cascade
  set(KEYS.medical, getMedicalHistory().filter(r => r.petId !== id))
  set(KEYS.vaccinations, getVaccinations().filter(r => r.petId !== id))
  set(KEYS.allergies, getAllergies().filter(r => r.petId !== id))
}

// ── Medical History ───────────────────────────────────────────────────────────

export function getMedicalHistory(petId) {
  const all = get(KEYS.medical)
  return petId ? all.filter(r => r.petId === petId) : all
}

export function saveMedicalRecord(record) {
  const all = get(KEYS.medical)
  if (record.id) {
    const idx = all.findIndex(r => r.id === record.id)
    if (idx >= 0) all[idx] = record; else all.push(record)
  } else {
    record.id = uid()
    record.createdAt = new Date().toISOString()
    all.push(record)
  }
  set(KEYS.medical, all)
  return record
}

export function deleteMedicalRecord(id) {
  set(KEYS.medical, get(KEYS.medical).filter(r => r.id !== id))
}

// ── Vaccinations ──────────────────────────────────────────────────────────────

export function getVaccinations(petId) {
  const all = get(KEYS.vaccinations)
  return petId ? all.filter(r => r.petId === petId) : all
}

export function saveVaccination(record) {
  const all = get(KEYS.vaccinations)
  if (record.id) {
    const idx = all.findIndex(r => r.id === record.id)
    if (idx >= 0) all[idx] = record; else all.push(record)
  } else {
    record.id = uid()
    record.createdAt = new Date().toISOString()
    all.push(record)
  }
  set(KEYS.vaccinations, all)
  return record
}

export function deleteVaccination(id) {
  set(KEYS.vaccinations, get(KEYS.vaccinations).filter(r => r.id !== id))
}

// ── Allergies ─────────────────────────────────────────────────────────────────

export function getAllergies(petId) {
  const all = get(KEYS.allergies)
  return petId ? all.filter(r => r.petId === petId) : all
}

export function saveAllergy(record) {
  const all = get(KEYS.allergies)
  if (record.id) {
    const idx = all.findIndex(r => r.id === record.id)
    if (idx >= 0) all[idx] = record; else all.push(record)
  } else {
    record.id = uid()
    record.createdAt = new Date().toISOString()
    all.push(record)
  }
  set(KEYS.allergies, all)
  return record
}

export function deleteAllergy(id) {
  set(KEYS.allergies, get(KEYS.allergies).filter(r => r.id !== id))
}

// ── Reminders ─────────────────────────────────────────────────────────────────

export function getReminders(petId) {
  const all = get(KEYS.reminders)
  return petId ? all.filter(r => r.petId === petId) : all
}

export function saveReminder(reminder) {
  const all = get(KEYS.reminders)
  if (reminder.id) {
    const idx = all.findIndex(r => r.id === reminder.id)
    if (idx >= 0) all[idx] = reminder; else all.push(reminder)
  } else {
    reminder.id = uid()
    reminder.createdAt = new Date().toISOString()
    all.push(reminder)
  }
  set(KEYS.reminders, all)
  return reminder
}

export function deleteReminder(id) {
  set(KEYS.reminders, get(KEYS.reminders).filter(r => r.id !== id))
}
