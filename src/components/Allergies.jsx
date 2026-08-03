import { useEffect, useState } from 'react'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { getAllergies, saveAllergy, deleteAllergy } from '../lib/storage.js'

const SEVERITY = ['Mild', 'Moderate', 'Severe']
const TYPES = ['Food', 'Environmental', 'Medication', 'Contact', 'Insect', 'Other']
const REACTIONS = ['Itching / Scratching', 'Hives / Rash', 'Swelling', 'Vomiting', 'Diarrhea', 'Sneezing', 'Difficulty breathing', 'Anaphylaxis', 'Other']

const SEVERITY_COLOR = {
  Mild:     'bg-yellow-50 text-yellow-700 border-yellow-200',
  Moderate: 'bg-orange-50 text-orange-700 border-orange-200',
  Severe:   'bg-red-50 text-red-700 border-red-200',
}

export default function Allergies({ pet }) {
  const [records, setRecords] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ allergen: '', type: 'Food', severity: 'Mild', reactions: [], notes: '', diagnosedDate: '' })

  function load() { setRecords(getAllergies(pet.id)) }
  useEffect(load, [pet.id])

  function toggleReaction(r) {
    setForm(f => ({
      ...f,
      reactions: f.reactions.includes(r) ? f.reactions.filter(x => x !== r) : [...f.reactions, r]
    }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    saveAllergy({ ...form, petId: pet.id })
    setForm({ allergen: '', type: 'Food', severity: 'Mild', reactions: [], notes: '', diagnosedDate: '' })
    setShowForm(false)
    load()
  }

  function handleDelete(id) {
    if (confirm('Delete this allergy record?')) { deleteAllergy(id); load() }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">Allergies</h2>
        <button onClick={() => setShowForm(s => !s)} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> Add Allergy
        </button>
      </div>

      {showForm && (
        <div className="card mb-4">
          <h3 className="font-semibold mb-4">New Allergy Record</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-3">
                <label className="label">Allergen *</label>
                <input value={form.allergen} onChange={e => setForm(f => ({...f, allergen: e.target.value}))} className="input" required placeholder="e.g. Chicken, Pollen, Penicillin" />
              </div>
              <div>
                <label className="label">Type</label>
                <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))} className="input">
                  {TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Severity</label>
                <select value={form.severity} onChange={e => setForm(f => ({...f, severity: e.target.value}))} className="input">
                  {SEVERITY.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Diagnosed Date</label>
                <input type="date" value={form.diagnosedDate} onChange={e => setForm(f => ({...f, diagnosedDate: e.target.value}))} className="input" />
              </div>
            </div>
            <div>
              <label className="label">Reactions</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {REACTIONS.map(r => (
                  <button
                    key={r} type="button"
                    onClick={() => toggleReaction(r)}
                    className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                      form.reactions.includes(r)
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} className="input" rows={2} />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}

      {records.length === 0 && !showForm && (
        <div className="card flex flex-col items-center py-12 text-center text-gray-400">
          <AlertTriangle className="w-10 h-10 mb-3 opacity-40" />
          <p className="font-medium">No allergies recorded</p>
        </div>
      )}

      <div className="space-y-3">
        {records.map(r => (
          <div key={r.id} className={`card border flex justify-between items-start group ${SEVERITY_COLOR[r.severity]}`}>
            <div className="flex gap-4">
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{r.allergen}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/60 border">{r.type}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/60 border font-medium">{r.severity}</span>
                </div>
                {r.reactions?.length > 0 && (
                  <p className="text-sm mt-1">Reactions: {r.reactions.join(', ')}</p>
                )}
                {r.notes && <p className="text-sm mt-1 opacity-80">{r.notes}</p>}
              </div>
            </div>
            <button onClick={() => handleDelete(r.id)} className="opacity-0 group-hover:opacity-100 ml-4 transition-all">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
