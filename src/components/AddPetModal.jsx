import { useState } from 'react'
import { X } from 'lucide-react'
import { savePet } from '../lib/storage.js'

const SPECIES = ['Dog', 'Cat', 'Bird', 'Rabbit', 'Hamster', 'Fish', 'Reptile', 'Other']
const GENDERS = ['Male', 'Female', 'Unknown']

export default function AddPetModal({ onClose, onSaved, pet: existing }) {
  const [form, setForm] = useState({
    name: existing?.name || '',
    species: existing?.species || 'Dog',
    breed: existing?.breed || '',
    gender: existing?.gender || 'Male',
    dob: existing?.dob || '',
    weight: existing?.weight || '',
    color: existing?.color || '',
    microchipId: existing?.microchipId || '',
    insurancePolicy: existing?.insurancePolicy || '',
    vetName: existing?.vetName || '',
    vetPhone: existing?.vetPhone || '',
    vetEmail: existing?.vetEmail || '',
    notes: existing?.notes || '',
    ...(existing?.id ? { id: existing.id, createdAt: existing.createdAt } : {}),
  })

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    savePet(form)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-bold">{existing ? 'Edit Pet' : 'Add New Pet'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Pet Name *</label>
              <input name="name" value={form.name} onChange={handleChange} className="input" required placeholder="e.g. Buddy" />
            </div>
            <div>
              <label className="label">Species</label>
              <select name="species" value={form.species} onChange={handleChange} className="input">
                {SPECIES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Breed</label>
              <input name="breed" value={form.breed} onChange={handleChange} className="input" placeholder="e.g. Golden Retriever" />
            </div>
            <div>
              <label className="label">Gender</label>
              <select name="gender" value={form.gender} onChange={handleChange} className="input">
                {GENDERS.map(g => <option key={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date of Birth</label>
              <input type="date" name="dob" value={form.dob} onChange={handleChange} className="input" />
            </div>
            <div>
              <label className="label">Weight (kg)</label>
              <input type="number" step="0.1" name="weight" value={form.weight} onChange={handleChange} className="input" placeholder="e.g. 5.2" />
            </div>
            <div>
              <label className="label">Color / Markings</label>
              <input name="color" value={form.color} onChange={handleChange} className="input" placeholder="e.g. Golden with white patch" />
            </div>
            <div>
              <label className="label">Microchip ID</label>
              <input name="microchipId" value={form.microchipId} onChange={handleChange} className="input" placeholder="Optional" />
            </div>
          </div>

          {/* Insurance */}
          <div>
            <label className="label">Insurance Policy #</label>
            <input name="insurancePolicy" value={form.insurancePolicy} onChange={handleChange} className="input" placeholder="Optional" />
          </div>

          {/* Vet info */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Veterinarian</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Vet Name</label>
                <input name="vetName" value={form.vetName} onChange={handleChange} className="input" placeholder="Dr. Smith" />
              </div>
              <div>
                <label className="label">Vet Phone</label>
                <input name="vetPhone" value={form.vetPhone} onChange={handleChange} className="input" placeholder="+1 555 0000" />
              </div>
              <div>
                <label className="label">Vet Email</label>
                <input type="email" name="vetEmail" value={form.vetEmail} onChange={handleChange} className="input" placeholder="vet@clinic.com" />
              </div>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} className="input" rows={3} placeholder="Any other details..." />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{existing ? 'Save Changes' : 'Add Pet'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
