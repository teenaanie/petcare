import { useEffect, useState } from 'react'
import { Plus, Trash2, Stethoscope } from 'lucide-react'
import { getMedicalHistory, saveMedicalRecord, deleteMedicalRecord } from '../lib/storage.js'
import { format } from 'date-fns'

const TYPES = ['Checkup', 'Illness', 'Surgery', 'Injury', 'Dental', 'Lab Result', 'Prescription', 'Other']

export default function MedicalHistory({ pet }) {
  const [records, setRecords] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ date: '', type: 'Checkup', title: '', description: '', vet: '', cost: '' })

  function load() { setRecords(getMedicalHistory(pet.id)) }
  useEffect(load, [pet.id])

  function handleSubmit(e) {
    e.preventDefault()
    saveMedicalRecord({ ...form, petId: pet.id })
    setForm({ date: '', type: 'Checkup', title: '', description: '', vet: '', cost: '' })
    setShowForm(false)
    load()
  }

  function handleDelete(id) {
    if (confirm('Delete this record?')) { deleteMedicalRecord(id); load() }
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
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
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
            <div className="col-span-2">
              <label className="label">Title / Diagnosis *</label>
              <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} className="input" required placeholder="e.g. Annual checkup — all clear" />
            </div>
            <div className="col-span-2">
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
            <div className="col-span-2 flex justify-end gap-3">
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
          <div key={r.id} className="card flex justify-between items-start group">
            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Stethoscope className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{r.title}</span>
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{r.type}</span>
                </div>
                {r.date && <p className="text-sm text-gray-400 mt-0.5">{format(new Date(r.date), 'MMM d, yyyy')}{r.vet ? ` · ${r.vet}` : ''}{r.cost ? ` · $${r.cost}` : ''}</p>}
                {r.description && <p className="text-sm text-gray-600 mt-1">{r.description}</p>}
              </div>
            </div>
            <button onClick={() => handleDelete(r.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all ml-4">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
