import { useState } from 'react'
import { Sparkles, X, CheckCircle, Circle, Bell, ChevronRight, Loader2 } from 'lucide-react'
import VoiceIntake from './VoiceIntake.jsx'
import { savePet, saveReminder } from '../lib/storage.js'
import PetAvatar from './PetAvatar.jsx'

const SPECIES = ['Dog', 'Cat', 'Bird', 'Rabbit', 'Hamster', 'Fish', 'Reptile', 'Other']
const GENDERS = ['Male', 'Female', 'Unknown']

// ── Reminder recommendations by species ──────────────────────────────────────

function addMonths(n) {
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  return d.toISOString().split('T')[0]
}
function addDays(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

const RECOMMENDATIONS = {
  Dog: [
    { type: 'Vaccination',   label: 'Annual vaccination booster',      dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Core vaccines: Distemper, Parvovirus, Hepatitis, Rabies' },
    { type: 'Deworming',     label: 'Deworming',                        dueDate: addMonths(3),  frequency: 'Every 3 months', notes: 'Regular deworming for intestinal parasites' },
    { type: 'Flea & Tick',   label: 'Flea & tick prevention',          dueDate: addMonths(1),  frequency: 'Monthly',  notes: 'Apply topical/oral flea & tick treatment' },
    { type: 'Dental',        label: 'Dental checkup & cleaning',       dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Professional dental scaling if needed' },
    { type: 'Health Check',  label: 'Annual wellness exam',            dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Full physical exam with blood work' },
    { type: 'Grooming',      label: 'Grooming session',                dueDate: addMonths(2),  frequency: 'Every 2 months', notes: 'Bath, trim nails, clean ears' },
  ],
  Cat: [
    { type: 'Vaccination',   label: 'Annual vaccination booster',      dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Core vaccines: Feline Herpesvirus, Calicivirus, Panleukopenia, Rabies' },
    { type: 'Deworming',     label: 'Deworming',                        dueDate: addMonths(3),  frequency: 'Every 3 months', notes: 'Regular deworming for intestinal parasites' },
    { type: 'Flea & Tick',   label: 'Flea prevention',                 dueDate: addMonths(1),  frequency: 'Monthly',  notes: 'Topical or oral flea treatment' },
    { type: 'Dental',        label: 'Dental checkup',                  dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Check for tartar buildup and gum disease' },
    { type: 'Health Check',  label: 'Annual wellness exam',            dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Full physical with blood panel' },
  ],
  Bird: [
    { type: 'Health Check',  label: 'Annual wellness exam',            dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Full avian check-up with vet' },
    { type: 'Grooming',      label: 'Nail & beak trim',                dueDate: addMonths(3),  frequency: 'Every 3 months', notes: 'Keep nails and beak at safe length' },
    { type: 'Vaccination',   label: 'PBFD / Polyomavirus test',        dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Screening for common avian viruses' },
  ],
  Rabbit: [
    { type: 'Vaccination',   label: 'Annual vaccination (RHDV & VHD)', dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Rabbit Haemorrhagic Disease & Myxomatosis vaccines' },
    { type: 'Health Check',  label: 'Bi-annual wellness exam',         dueDate: addMonths(6),  frequency: 'Every 6 months', notes: 'Dental and full physical check' },
    { type: 'Grooming',      label: 'Nail trim',                       dueDate: addMonths(2),  frequency: 'Every 2 months', notes: 'Trim nails to prevent overgrowth' },
    { type: 'Deworming',     label: 'E. cuniculi treatment',           dueDate: addMonths(6),  frequency: 'Every 6 months', notes: 'Fenbendazole course as preventative' },
  ],
  Hamster: [
    { type: 'Health Check',  label: 'Monthly health check',            dueDate: addMonths(1),  frequency: 'Monthly',  notes: 'Check weight, coat, teeth, and behaviour' },
    { type: 'Grooming',      label: 'Cage deep clean',                 dueDate: addDays(30),   frequency: 'Monthly',  notes: 'Full bedding change and cage sanitise' },
  ],
  Fish: [
    { type: 'Health Check',  label: 'Water quality test',              dueDate: addDays(14),   frequency: 'Every 2 weeks', notes: 'Check pH, ammonia, nitrite, nitrate levels' },
    { type: 'Grooming',      label: 'Tank deep clean',                 dueDate: addMonths(1),  frequency: 'Monthly',  notes: 'Gravel vacuum, filter clean, partial water change' },
  ],
  Reptile: [
    { type: 'Health Check',  label: 'Annual wellness exam',            dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Reptile-specialist vet check' },
    { type: 'Deworming',     label: 'Parasite screening',              dueDate: addMonths(6),  frequency: 'Every 6 months', notes: 'Fecal test for internal parasites' },
    { type: 'Grooming',      label: 'Shedding check',                  dueDate: addMonths(2),  frequency: 'Every 2 months', notes: 'Ensure full shed, check for retained skin' },
  ],
  Other: [
    { type: 'Health Check',  label: 'Annual wellness exam',            dueDate: addMonths(12), frequency: 'Yearly',   notes: 'Full health check with a vet' },
    { type: 'Deworming',     label: 'Deworming',                        dueDate: addMonths(3),  frequency: 'Every 3 months', notes: 'Check with vet for appropriate treatment' },
  ],
}

const TYPE_COLORS = {
  'Vaccination':  '#2f7286',
  'Deworming':    '#b2566f',
  'Flea & Tick':  '#c0392b',
  'Dental':       '#2f7286',
  'Health Check': '#5f7a3a',
  'Grooming':     '#c9891f',
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function AddPetModal({ onClose, onSaved, pet: existing }) {
  const [step, setStep]     = useState('form')   // 'form' | 'reminders'
  const [savedPet, setSavedPet] = useState(null)
  const [saving, setSaving] = useState(false)

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
    notes: existing?.notes || '',
    photo: existing?.photo || null,
    ...(existing?.id ? { id: existing.id, createdAt: existing.createdAt } : {}),
  })

  // Reminders step: which suggestions are selected
  const suggestions = RECOMMENDATIONS[form.species] || RECOMMENDATIONS.Other
  const [intake, setIntake] = useState(false)
  const [selected, setSelected] = useState(() => new Set(suggestions.map((_, i) => i)))

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    if (name === 'species') {
      const newSuggestions = RECOMMENDATIONS[value] || RECOMMENDATIONS.Other
      setSelected(new Set(newSuggestions.map((_, i) => i)))
    }
  }

  // Rendered inside the modal, above the form. Saving through intake returns
  // the pet the same way the form does, so the species-based reminder step
  // afterwards is unchanged either way.
  const intakeOffer = !existing && (
    <>
      <button type="button" onClick={() => setIntake(true)}
        className="w-full flex items-center justify-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl mb-4"
        style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
        <Sparkles className="w-4 h-4" /> Rather just tell us about them?
      </button>
      {intake && (
        <VoiceIntake onClose={() => setIntake(false)}
          onSaved={() => { setIntake(false); onSaved?.(null) }} />
      )}
    </>
  )

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const saved = await savePet(form)
      setSavedPet(saved)
      // Skip reminders step for edits
      if (existing) { onSaved(saved); return }
      setStep('reminders')
    } finally {
      setSaving(false)
    }
  }

  function toggleReminder(idx) {
    setSelected(s => {
      const next = new Set(s)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  async function handleAddReminders() {
    setSaving(true)
    try {
      const toSave = suggestions.filter((_, i) => selected.has(i))
      await Promise.all(toSave.map(r => saveReminder({
        petId:     savedPet.id,
        type:      r.label,
        dueDate:   r.dueDate,
        frequency: r.frequency,
        notes:     r.notes,
        isDone:    false,
        email:     '',
        whatsapp:  '',
      })))
    } finally {
      setSaving(false)
      onSaved(savedPet)
    }
  }

  function handleSkip() { onSaved(savedPet) }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: '#FFFEF8', border: '1px solid #ebe3d3' }}>

        {/* ── Step 1: Pet form ─────────────────────────────────────────── */}
        {step === 'form' && (
          <>
            <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid #ebe3d3' }}>
              <h2 className="text-lg font-black" style={{ color: '#7a4900' }}>
                {existing ? 'Edit Pet' : 'Add New Pet 🐾'}
              </h2>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-amber-50 transition-colors"
                style={{ color: '#73775b' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {intakeOffer}

              {/* Photo + name */}
              <div className="flex items-center gap-4">
                <PetAvatar pet={form} size="xl" editable onPhotoChange={photo => setForm(f => ({ ...f, photo }))} />
                <div className="flex-1">
                  <label className="label">Pet Name *</label>
                  <input name="name" value={form.name} onChange={handleChange} className="input" required placeholder="e.g. Buddy" />
                  <p className="text-xs mt-1" style={{ color: '#73775b' }}>Tap the photo to upload or take a picture</p>
                </div>
              </div>

              {/* Basic info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <div>
                  <label className="label">Insurance Policy #</label>
                  <input name="insurancePolicy" value={form.insurancePolicy} onChange={handleChange} className="input" placeholder="Optional" />
                </div>
              </div>

              {/* Vets live in My Providers now — a household list with as many as
                  you need, and a per-pet override. Keeping a second set of
                  fields here would mean two places to enter the same thing and
                  no way to tell which one the emergency card reads. */}

              <div>
                <label className="label">Notes</label>
                <textarea name="notes" value={form.notes} onChange={handleChange} className="input" rows={3} placeholder="Any other details..." />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                  {existing ? 'Save Changes' : 'Next: Set Reminders'}
                </button>
              </div>
            </form>
          </>
        )}

        {/* ── Step 2: Recommended reminders ───────────────────────────── */}
        {step === 'reminders' && (
          <>
            <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid #ebe3d3' }}>
              <div>
                <h2 className="text-lg font-black" style={{ color: '#7a4900' }}>
                  Recommended Reminders 🔔
                </h2>
                <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>
                  Suggested for {form.name} · {form.species}
                  {form.breed ? ` · ${form.breed}` : ''}
                </p>
              </div>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-amber-50" style={{ color: '#73775b' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-3">
              <p className="text-sm" style={{ color: '#7a4900' }}>
                We've pre-selected common care reminders for a {form.species.toLowerCase()}. Tap to toggle any you don't need.
              </p>

              <div className="space-y-2 mt-1">
                {suggestions.map((r, i) => {
                  const isOn = selected.has(i)
                  const color = TYPE_COLORS[r.type] || '#73775b'
                  return (
                    <button key={i} type="button" onClick={() => toggleReminder(i)}
                      className="w-full text-left flex items-start gap-3 p-4 rounded-2xl transition-all"
                      style={{
                        backgroundColor: isOn ? '#FFFEF8' : '#fffef8',
                        border: `1.5px solid ${isOn ? '#f2b83d' : '#ebe3d3'}`,
                        opacity: isOn ? 1 : 0.55,
                      }}>
                      <div className="flex-shrink-0 mt-0.5">
                        {isOn
                          ? <CheckCircle className="w-5 h-5" style={{ color: '#c99a2e' }} />
                          : <Circle className="w-5 h-5" style={{ color: '#e0d3b4' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-black" style={{ color: '#7a4900' }}>{r.label}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                            style={{ backgroundColor: color + '15', color }}>
                            {r.type}
                          </span>
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>
                          {r.frequency} · Due: {new Date(r.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                        {r.notes && (
                          <p className="text-xs mt-0.5 italic" style={{ color: '#73775b' }}>{r.notes}</p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="flex gap-3 pt-3">
                <button onClick={handleSkip} className="btn-secondary flex-1 justify-center text-sm">
                  Skip for now
                </button>
                <button onClick={handleAddReminders} disabled={saving || selected.size === 0}
                  className="btn-primary flex-1 justify-center gap-2 text-sm">
                  {saving
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Bell className="w-4 h-4" />}
                  Add {selected.size} Reminder{selected.size !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
