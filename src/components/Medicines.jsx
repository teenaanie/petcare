import { useEffect, useState } from 'react'
import { Pill, Plus, Trash2, Check, Clock, AlertCircle, CheckCircle, X } from 'lucide-react'
import { getMedicines, saveMedicine, deleteMedicine, markMedicineDone } from '../lib/storage.js'
import { format, parseISO, isValid, isBefore, addDays } from 'date-fns'

const CATEGORIES = ['Deworming', 'Flea/Tick', 'Antibiotic', 'Anti-inflammatory', 'Supplement', 'Vaccination', 'Other']

const CAT_STYLE = {
  'Deworming':         { bg: '#D1FAE5', color: '#065F46' },
  'Flea/Tick':         { bg: '#EDE9FE', color: '#5B21B6' },
  'Antibiotic':        { bg: '#DBEAFE', color: '#1E40AF' },
  'Anti-inflammatory': { bg: '#FEF3C7', color: '#92400E' },
  'Supplement':        { bg: '#CFFAFE', color: '#164E63' },
  'Vaccination':       { bg: '#E0E7FF', color: '#3730A3' },
  'Other':             { bg: '#F3F4F6', color: '#374151' },
}

function parseDate(str) {
  if (!str) return null
  try { const d = parseISO(str); return isValid(d) ? d : null } catch { return null }
}

function DueStatus({ nextDue }) {
  if (!nextDue) return null
  const today = new Date()
  const due = parseDate(nextDue)
  if (!due) return null
  if (isBefore(due, today)) return (
    <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
      <AlertCircle className="w-3 h-3" /> Overdue — {format(due, 'MMM d')}
    </span>
  )
  if (isBefore(due, addDays(today, 30))) return (
    <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
      <Clock className="w-3 h-3" /> Due {format(due, 'MMM d')}
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
      <CheckCircle className="w-3 h-3" /> Next: {format(due, 'MMM d, yyyy')}
    </span>
  )
}

const EMPTY_FORM = {
  name: '', dosage: '', frequency: '', category: 'Other',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '', nextDue: '', prescribedBy: '', reason: '', notes: '',
}

function AddForm({ onSave, onCancel }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ backgroundColor: '#FFFEF0', borderColor: '#F9D548' }}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-black text-sm" style={{ color: '#4A2C0A' }}>Add Medicine</span>
          <button type="button" onClick={onCancel} className="p-1 rounded-lg hover:bg-yellow-100">
            <X className="w-4 h-4" style={{ color: '#B8A080' }} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label text-xs">Medicine Name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Bravecto, Amoxicillin" required />
          </div>
          <div>
            <label className="label text-xs">Dosage</label>
            <input className="input" value={form.dosage} onChange={e => set('dosage', e.target.value)} placeholder="e.g. 40mg, 5ml" />
          </div>
          <div>
            <label className="label text-xs">Frequency</label>
            <input className="input" value={form.frequency} onChange={e => set('frequency', e.target.value)} placeholder="e.g. Once daily, Monthly" />
          </div>
          <div>
            <label className="label text-xs">Category</label>
            <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Date Given / Start Date</label>
            <input type="date" className="input" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
          </div>
          <div>
            <label className="label text-xs">End Date</label>
            <input type="date" className="input" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
          </div>
          <div>
            <label className="label text-xs">Next Due</label>
            <input type="date" className="input" value={form.nextDue} onChange={e => set('nextDue', e.target.value)} />
          </div>
          <div>
            <label className="label text-xs">Prescribed By</label>
            <input className="input" value={form.prescribedBy} onChange={e => set('prescribedBy', e.target.value)} placeholder="Vet name" />
          </div>
          <div className="sm:col-span-2">
            <label className="label text-xs">Reason / Condition</label>
            <input className="input" value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="e.g. Deworming, UTI" />
          </div>
          <div className="sm:col-span-2">
            <label className="label text-xs">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any instructions..." />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add Medicine'}</button>
        </div>
      </form>
    </div>
  )
}

function MedicineCard({ med, onDone, onDelete }) {
  const [toggling, setToggling] = useState(false)
  const cat = CAT_STYLE[med.category] || CAT_STYLE.Other

  async function handleDone() {
    setToggling(true)
    try { await onDone(med.id, !med.isDone) } finally { setToggling(false) }
  }

  return (
    <div className={`card group transition-all ${med.isDone ? 'opacity-60' : ''}`}
      style={{ borderColor: med.isDone ? '#E5E7EB' : '#F0E6C8' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Category colour dot */}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ backgroundColor: cat.bg }}>
            <Pill className="w-4 h-4" style={{ color: cat.color }} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-black text-sm ${med.isDone ? 'line-through' : ''}`}
                style={{ color: '#4A2C0A' }}>{med.name}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: cat.bg, color: cat.color }}>{med.category}</span>
              {med.isDone && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>✓ Done</span>
              )}
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {med.dosage && <span className="text-xs" style={{ color: '#6B4C1E' }}>{med.dosage}</span>}
              {med.frequency && <span className="text-xs" style={{ color: '#B8A080' }}>· {med.frequency}</span>}
            </div>

            {/* Dates */}
            <div className="flex flex-wrap gap-2 mt-1.5">
              {med.startDate && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FFF5AA', color: '#6B4C1E' }}>
                  From {format(parseISO(med.startDate), 'MMM d, yyyy')}
                </span>
              )}
              {med.endDate && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FFF5AA', color: '#6B4C1E' }}>
                  Until {format(parseISO(med.endDate), 'MMM d, yyyy')}
                </span>
              )}
              {!med.isDone && <DueStatus nextDue={med.nextDue} />}
            </div>

            {med.reason && (
              <p className="text-xs mt-1.5" style={{ color: '#6B4C1E' }}>
                For: <span className="font-semibold">{med.reason}</span>
              </p>
            )}
            {med.prescribedBy && (
              <p className="text-xs" style={{ color: '#B8A080' }}>By {med.prescribedBy}</p>
            )}
            {med.notes && (
              <p className="text-xs mt-1 italic" style={{ color: '#B8A080' }}>{med.notes}</p>
            )}
          </div>
        </div>

        {/* Action buttons — always visible on mobile, hover on desktop */}
        <div className="flex gap-1 flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <button onClick={handleDone} disabled={toggling}
            className="p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: med.isDone ? '#D1FAE5' : '#FFF5AA', color: med.isDone ? '#065F46' : '#4A2C0A' }}
            title={med.isDone ? 'Mark active' : 'Mark done'}>
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(med.id)}
            className="p-1.5 rounded-lg transition-colors text-red-400 hover:text-red-600 hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Medicines({ pet }) {
  const [meds, setMeds] = useState([])
  const [showForm, setShowForm] = useState(false)

  function load() { getMedicines(pet.id).then(setMeds).catch(console.error) }
  useEffect(load, [pet.id])

  async function handleSave(form) {
    await saveMedicine({ ...form, petId: pet.id })
    setShowForm(false)
    load()
  }

  async function handleDone(id, isDone) {
    await markMedicineDone(id, isDone)
    load()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this medicine record?')) return
    await deleteMedicine(id)
    load()
  }

  const active    = meds.filter(m => !m.isDone)
  const completed = meds.filter(m => m.isDone)

  // Alert for medicines due soon or overdue
  const alerts = active.filter(m => {
    if (!m.nextDue) return false
    const d = parseDate(m.nextDue)
    return d && isBefore(d, addDays(new Date(), 30))
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black" style={{ color: '#4A2C0A' }}>Medicines</h2>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary gap-1.5 text-sm">
          <Plus className="w-4 h-4" /> Add Medicine
        </button>
      </div>

      {/* Due soon alerts */}
      {alerts.length > 0 && (
        <div className="rounded-xl p-3 flex items-start gap-2"
          style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D' }}>
          <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#D97706' }} />
          <div className="text-sm" style={{ color: '#92400E' }}>
            <span className="font-bold">{alerts.length} medicine{alerts.length > 1 ? 's' : ''} due soon or overdue:</span>{' '}
            {alerts.map(m => m.name).join(', ')}
          </div>
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <AddForm onSave={handleSave} onCancel={() => setShowForm(false)} />
      )}

      {/* Empty state */}
      {meds.length === 0 && !showForm && (
        <div className="card flex flex-col items-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
            style={{ backgroundColor: '#FFF5AA' }}>
            <Pill className="w-8 h-8" style={{ color: '#4A2C0A' }} />
          </div>
          <p className="font-bold" style={{ color: '#4A2C0A' }}>No medicines recorded</p>
          <p className="text-sm mt-1" style={{ color: '#B8A080' }}>
            Add medicines manually or scan a prescription / deworming schedule.
          </p>
        </div>
      )}

      {/* Active */}
      {active.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-widest" style={{ color: '#B8A080' }}>
            Active ({active.length})
          </p>
          {active.map(m => (
            <MedicineCard key={m.id} med={m} onDone={handleDone} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-widest mt-2" style={{ color: '#B8A080' }}>
            Completed ({completed.length})
          </p>
          {completed.map(m => (
            <MedicineCard key={m.id} med={m} onDone={handleDone} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
