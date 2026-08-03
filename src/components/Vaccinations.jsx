import { useEffect, useState } from 'react'
import { Plus, Trash2, Syringe, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { getVaccinations, saveVaccination, deleteVaccination } from '../lib/storage.js'
import { format, addDays, isBefore, isAfter } from 'date-fns'

const COMMON_VACCINES = ['Rabies', 'DHPP (Distemper/Parvovirus)', 'Bordetella', 'Leptospirosis', 'Lyme Disease', 'Influenza', 'FVRCP (Cats)', 'FeLV (Cats)', 'Other']

function getStatus(nextDue) {
  if (!nextDue) return null
  const today = new Date()
  const due = new Date(nextDue)
  if (isBefore(due, today)) return 'overdue'
  if (isBefore(due, addDays(today, 30))) return 'due-soon'
  return 'ok'
}

const STATUS_CONFIG = {
  overdue:  { label: 'Overdue',   color: 'text-red-600 bg-red-50',    icon: AlertCircle },
  'due-soon': { label: 'Due Soon', color: 'text-orange-600 bg-orange-50', icon: Clock },
  ok:       { label: 'Up to date', color: 'text-green-600 bg-green-50', icon: CheckCircle },
}

export default function Vaccinations({ pet }) {
  const [records, setRecords] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: 'Rabies', dateGiven: '', nextDue: '', batchNumber: '', vet: '', notes: '' })

  function load() { getVaccinations(pet.id).then(setRecords).catch(console.error) }
  useEffect(load, [pet.id])

  async function handleSubmit(e) {
    e.preventDefault()
    await saveVaccination({ ...form, petId: pet.id })
    setForm({ name: 'Rabies', dateGiven: '', nextDue: '', batchNumber: '', vet: '', notes: '' })
    setShowForm(false)
    load()
  }

  async function handleDelete(id) {
    if (confirm('Delete this vaccination record?')) { await deleteVaccination(id); load() }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">Vaccinations</h2>
        <button onClick={() => setShowForm(s => !s)} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> Add Vaccination
        </button>
      </div>

      {showForm && (
        <div className="card mb-4">
          <h3 className="font-semibold mb-4">New Vaccination Record</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Vaccine *</label>
              <select value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="input">
                {COMMON_VACCINES.map(v => <option key={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date Given *</label>
              <input type="date" value={form.dateGiven} onChange={e => setForm(f => ({...f, dateGiven: e.target.value}))} className="input" required />
            </div>
            <div>
              <label className="label">Next Due Date</label>
              <input type="date" value={form.nextDue} onChange={e => setForm(f => ({...f, nextDue: e.target.value}))} className="input" />
            </div>
            <div>
              <label className="label">Batch / Lot Number</label>
              <input value={form.batchNumber} onChange={e => setForm(f => ({...f, batchNumber: e.target.value}))} className="input" placeholder="Optional" />
            </div>
            <div>
              <label className="label">Administering Vet</label>
              <input value={form.vet} onChange={e => setForm(f => ({...f, vet: e.target.value}))} className="input" placeholder="Dr. Smith" />
            </div>
            <div className="col-span-2">
              <label className="label">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} className="input" rows={2} />
            </div>
            <div className="col-span-2 flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}

      {records.length === 0 && !showForm && (
        <div className="card flex flex-col items-center py-12 text-center text-gray-400">
          <Syringe className="w-10 h-10 mb-3 opacity-40" />
          <p className="font-medium">No vaccination records yet</p>
        </div>
      )}

      <div className="space-y-3">
        {records.sort((a, b) => new Date(b.dateGiven) - new Date(a.dateGiven)).map(r => {
          const status = getStatus(r.nextDue)
          const cfg = status ? STATUS_CONFIG[status] : null
          const Icon = cfg?.icon
          return (
            <div key={r.id} className="card flex justify-between items-start group">
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                  <Syringe className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{r.name}</span>
                    {cfg && (
                      <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${cfg.color}`}>
                        <Icon className="w-3 h-3" /> {cfg.label}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-0.5">
                    Given: {r.dateGiven ? format(new Date(r.dateGiven), 'MMM d, yyyy') : '—'}
                    {r.nextDue ? ` · Next due: ${format(new Date(r.nextDue), 'MMM d, yyyy')}` : ''}
                    {r.vet ? ` · ${r.vet}` : ''}
                  </p>
                  {r.batchNumber && <p className="text-xs text-gray-400">Batch: {r.batchNumber}</p>}
                  {r.notes && <p className="text-sm text-gray-600 mt-1">{r.notes}</p>}
                </div>
              </div>
              <button onClick={() => handleDelete(r.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all ml-4">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
