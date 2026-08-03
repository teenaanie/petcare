import { useState } from 'react'
import { Upload, CheckCircle, AlertCircle, Loader2, Database, X } from 'lucide-react'
import { supabase, isConfigured } from '../lib/supabase.js'

// Read everything that exists in localStorage
function readLocalData() {
  function parse(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
  }
  return {
    pets:         parse('mypetcare_pets'),
    medical:      parse('mypetcare_medical'),
    vaccinations: parse('mypetcare_vaccinations'),
    allergies:    parse('mypetcare_allergies'),
    reminders:    parse('mypetcare_reminders'),
  }
}

async function migrateToSupabase(localData, onProgress) {
  const idMap = {} // old localStorage id → new Supabase uuid

  // ── Pets ──
  onProgress('Migrating pets...')
  for (const pet of localData.pets) {
    const { data, error } = await supabase.from('pets').insert({
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
    }).select().single()
    if (error) throw new Error(`Pet "${pet.name}": ${error.message}`)
    idMap[pet.id] = data.id
  }

  // ── Medical records ──
  onProgress('Migrating medical records...')
  for (const r of localData.medical) {
    const newPetId = idMap[r.petId]
    if (!newPetId) continue
    const { error } = await supabase.from('medical_records').insert({
      pet_id:        newPetId,
      date:          r.date          || null,
      type:          r.type,
      title:         r.title,
      description:   r.description,
      vet:           r.vet,
      cost:          r.cost          ? parseFloat(r.cost) : null,
      is_abnormal:   r.isAbnormal    || false,
      abnormalities: r.abnormalities || [],
    })
    if (error) throw new Error(`Medical record "${r.title}": ${error.message}`)
  }

  // ── Vaccinations ──
  onProgress('Migrating vaccinations...')
  for (const r of localData.vaccinations) {
    const newPetId = idMap[r.petId]
    if (!newPetId) continue
    const { error } = await supabase.from('vaccinations').insert({
      pet_id:       newPetId,
      name:         r.name,
      date_given:   r.dateGiven    || null,
      next_due:     r.nextDue      || null,
      batch_number: r.batchNumber,
      vet:          r.vet,
      notes:        r.notes,
    })
    if (error) throw new Error(`Vaccination "${r.name}": ${error.message}`)
  }

  // ── Allergies ──
  onProgress('Migrating allergies...')
  for (const r of localData.allergies) {
    const newPetId = idMap[r.petId]
    if (!newPetId) continue
    const { error } = await supabase.from('allergies').insert({
      pet_id:         newPetId,
      allergen:       r.allergen,
      type:           r.type,
      severity:       r.severity,
      reactions:      r.reactions     || [],
      notes:          r.notes,
      diagnosed_date: r.diagnosedDate || null,
    })
    if (error) throw new Error(`Allergy "${r.allergen}": ${error.message}`)
  }

  // ── Reminders ──
  onProgress('Migrating reminders...')
  for (const r of localData.reminders) {
    const newPetId = idMap[r.petId]
    if (!newPetId) continue
    const { error } = await supabase.from('reminders').insert({
      pet_id:    newPetId,
      type:      r.type,
      due_date:  r.dueDate   || null,
      frequency: r.frequency,
      email:     r.email,
      whatsapp:  r.whatsapp,
      notes:     r.notes,
    })
    if (error) throw new Error(`Reminder "${r.type}": ${error.message}`)
  }
}

export default function MigrateData({ onClose, onDone }) {
  const local = readLocalData()
  const total = local.pets.length + local.medical.length +
    local.vaccinations.length + local.allergies.length + local.reminders.length

  const [status, setStatus]     = useState('idle') // idle | running | done | error
  const [progress, setProgress] = useState('')
  const [error, setError]       = useState(null)

  async function handleMigrate() {
    setStatus('running')
    setError(null)
    try {
      await migrateToSupabase(local, setProgress)
      setStatus('done')
      // Clear localStorage so there's no confusion going forward
      Object.keys(localStorage)
        .filter(k => k.startsWith('mypetcare_'))
        .forEach(k => localStorage.removeItem(k))
    } catch (e) {
      setStatus('error')
      setError(e.message)
    }
  }

  if (!isConfigured) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-lg">Migrate Data</h2>
            <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
          </div>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
            Supabase is not configured yet. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your <code>.env</code> file first.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-lg">Migrate Local Data to Cloud</h2>
          <button onClick={onClose} disabled={status === 'running'}>
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Summary */}
        {total === 0 ? (
          <div className="p-4 bg-gray-50 rounded-lg text-gray-500 text-sm text-center mb-4">
            No local data found — nothing to migrate.
          </div>
        ) : (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5 space-y-1.5 text-sm">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-4 h-4 text-blue-500" />
              <span className="font-semibold text-blue-800">Found {total} records in local storage</span>
            </div>
            {local.pets.length > 0         && <p className="text-blue-700">🐾 {local.pets.length} pet{local.pets.length > 1 ? 's' : ''}</p>}
            {local.medical.length > 0      && <p className="text-blue-700">🩺 {local.medical.length} medical record{local.medical.length > 1 ? 's' : ''}</p>}
            {local.vaccinations.length > 0 && <p className="text-blue-700">💉 {local.vaccinations.length} vaccination{local.vaccinations.length > 1 ? 's' : ''}</p>}
            {local.allergies.length > 0    && <p className="text-blue-700">⚠️ {local.allergies.length} allerg{local.allergies.length > 1 ? 'ies' : 'y'}</p>}
            {local.reminders.length > 0    && <p className="text-blue-700">🔔 {local.reminders.length} reminder{local.reminders.length > 1 ? 's' : ''}</p>}
          </div>
        )}

        {/* Progress */}
        {status === 'running' && (
          <div className="flex items-center gap-3 text-primary-600 text-sm mb-4">
            <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
            {progress}
          </div>
        )}

        {status === 'done' && (
          <div className="flex items-center gap-3 text-green-600 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm mb-4">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Migration complete!</p>
              <p className="text-green-500 mt-0.5">All {total} records are now in Supabase and will sync across all your devices.</p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-start gap-3 text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm mb-4">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Migration failed</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3">
          {status === 'done' ? (
            <button onClick={onDone} className="btn-primary">Done</button>
          ) : (
            <>
              <button onClick={onClose} disabled={status === 'running'} className="btn-secondary">Cancel</button>
              {total > 0 && status !== 'running' && (
                <button onClick={handleMigrate} className="btn-primary flex items-center gap-2">
                  <Upload className="w-4 h-4" /> Migrate to Cloud
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
