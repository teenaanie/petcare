import { useEffect, useState } from 'react'
import { Plus, Trash2, Stethoscope, TriangleAlert } from 'lucide-react'
import { getMedicalHistory, saveMedicalRecord, deleteMedicalRecord } from '../lib/storage.js'
import { format } from 'date-fns'

const TYPES = ['Checkup', 'Illness', 'Surgery', 'Injury', 'Dental', 'Lab Result', 'Prescription', 'Other']

export default function MedicalHistory({ pet }) {
  const [records, setRecords] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ date: '', type: 'Checkup', title: '', description: '', vet: '', cost: '' })

  function load() { getMedicalHistory(pet.id).then(setRecords).catch(console.error) }
  useEffect(load, [pet.id])

  async function handleSubmit(e) {
    e.preventDefault()
    await saveMedicalRecord({ ...form, petId: pet.id })
    setForm({ date: '', type: 'Checkup', title: '', description: '', vet: '', cost: '' })
    setShowForm(false)
    load()
  }

  async function handleDelete(id) {
    if (confirm('Delete this record?')) { await deleteMedicalRecord(id); load() }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">Medical History</h2>
        <button onClick={() => setShowForm(s => !s)} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> Add Record
        </button>
      </div>

      {showForm && (
        <div className="card mb-4">
          <h3 className="font-semibold mb-4">New Medical Record</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Date *</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} className="input" required />
            </div>
            <div>
              <label className="label">Type</label>
              <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))} className="input">
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Title / Diagnosis *</label>
              <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} className="input" required placeholder="e.g. Annual checkup — all clear" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Details / Notes</label>
              <textarea value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} className="input" rows={3} placeholder="Symptoms, treatment, medications prescribed..." />
            </div>
            <div>
              <label className="label">Vet / Clinic</label>
              <input value={form.vet} onChange={e => setForm(f => ({...f, vet: e.target.value}))} className="input" placeholder="Dr. Smith" />
            </div>
            <div>
              <label className="label">Cost</label>
              <input type="number" value={form.cost} onChange={e => setForm(f => ({...f, cost: e.target.value}))} className="input" placeholder="0.00" />
            </div>
            <div className="sm:col-span-2 flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Save Record</button>
            </div>
          </form>
        </div>
      )}

      {records.length === 0 && !showForm && (
        <div className="card flex flex-col items-center py-12 text-center text-gray-400">
          <Stethoscope className="w-10 h-10 mb-3 opacity-40" />
          <p className="font-medium">No medical records yet</p>
          <p className="text-sm mt-1">Add a record or use the document scanner.</p>
        </div>
      )}

      <div className="space-y-3">
        {records.sort((a, b) => new Date(b.date) - new Date(a.date)).map(r => (
          <div key={r.id} className={`card flex justify-between items-start group ${r.isAbnormal ? 'border-red-200 border' : ''}`}>
            <div className="flex gap-4 flex-1">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${r.isAbnormal ? 'bg-red-50' : 'bg-blue-50'}`}>
                {r.isAbnormal
                  ? <TriangleAlert className="w-5 h-5 text-red-500" />
                  : <Stethoscope className="w-5 h-5 text-blue-500" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{r.title}</span>
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{r.type}</span>
                  {r.isAbnormal && (
                    <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                      <TriangleAlert className="w-3 h-3" /> {r.abnormalities?.length} Abnormal
                    </span>
                  )}
                </div>
                {r.date && <p className="text-sm text-gray-400 mt-0.5">{format(new Date(r.date), 'MMM d, yyyy')}{r.vet ? ` · ${r.vet}` : ''}{r.cost ? ` · $${r.cost}` : ''}</p>}
                {r.description && <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{r.description}</p>}

                {/* Abnormalities detail */}
                {r.isAbnormal && r.abnormalities?.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {r.abnormalities.map((a, i) => {
                      const color = { Severe: 'text-red-700 bg-red-50 border-red-200', Moderate: 'text-orange-700 bg-orange-50 border-orange-200', Mild: 'text-yellow-700 bg-yellow-50 border-yellow-200' }[a.severity] || 'text-red-700 bg-red-50 border-red-200'
                      return (
                        <div key={i} className={`text-xs rounded-lg border px-3 py-2 ${color}`}>
                          <span className="font-bold">{a.parameter}</span>: {a.value} {a.unit}
                          <span className="ml-2 font-semibold">[{a.status} · {a.severity}]</span>
                          <span className="ml-1 opacity-70">Normal: {a.referenceRange}</span>
                          {a.clinicalNote && <p className="mt-0.5 opacity-80">{a.clinicalNote}</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            <button onClick={() => handleDelete(r.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all ml-4 flex-shrink-0">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
