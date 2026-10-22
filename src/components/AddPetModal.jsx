import { useState } from 'react'
import { Mic, X, ChevronRight, Loader2, Pencil } from 'lucide-react'
import VoiceIntake from './VoiceIntake.jsx'
import { savePet } from '../lib/storage.js'
import ReminderPicker from './ReminderPicker.jsx'
import { announcePetAdded } from '../lib/notify.js'
import PetAvatar from './PetAvatar.jsx'
import { trackEvent } from '../lib/analytics.js'

const SPECIES = ['Dog', 'Cat', 'Bird', 'Rabbit', 'Hamster', 'Fish', 'Reptile', 'Other']
const GENDERS = ['Male', 'Female', 'Unknown']

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

  const [intake, setIntake] = useState(false)

  // Closing once the pet exists is not a cancel.
  //
  // The reported bug: the form was filled in, Save pressed, the reminders step
  // appeared, and the owner closed it without picking one -- "the pet was not
  // saved". It had been saved; savePet ran before this step. But onClose only
  // shut the modal, while onSaved also refreshes the list, so the pet sat in
  // the database and never appeared on screen.
  function handleClose() {
    if (savedPet) onSaved(savedPet)
    else onClose()
  }

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    // This used to reach for a RECOMMENDATIONS constant to re-tick every
    // suggestion when the species changed. The constant moved to
    // src/lib/careSuggestions.js and the reference was left behind, which made
    // every species change throw a ReferenceError from this handler -- after
    // setForm had already applied the change, so nothing visibly broke and
    // nobody noticed. The picker derives its own suggestions from the species
    // now, and there is nothing left here to keep in step.
  }

  // Rendered inside the modal, above the form. Saving through intake returns
  // the pet the same way the form does, so the species-based reminder step
  // afterwards is unchanged either way.
  const intakeOffer = !existing && (
    <>
      {/* A sparkle said "something clever happens here" and nothing said
          "this listens". Shown a demo, the offer read as a note rather than a
          microphone, so nobody tried speaking. The icon is the affordance. */}
      <button type="button" onClick={() => setIntake(true)}
        className="w-full flex items-center justify-center gap-2.5 text-sm font-bold px-4 py-3 rounded-xl mb-4"
        style={{ backgroundColor: '#fff3c0', color: '#7a4900', border: '1px solid #f2b83d' }}>
        <span className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0"
          style={{ backgroundColor: '#7a4900' }}>
          <Mic className="w-4 h-4" style={{ color: '#fff9e0' }} />
        </span>
        Speak instead — tell us about them
      </button>
      {intake && (
        <VoiceIntake
          // Closing the voice screen after it has saved pets must refresh the
          // list, exactly as finishing does. Otherwise the pets are in the
          // database and nowhere on screen, which reads as "it did not save".
          onClose={saved => { setIntake(false); if (saved) onSaved?.(null) }}
          onSaved={() => { setIntake(false); onSaved?.(null) }} />
      )}
    </>
  )

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      // First time through this modal for a NEW pet. Pressing Save again after
      // going back to correct something is an update of the same pet, not a
      // second one, and must not be announced or counted twice.
      const firstSave = !existing && !savedPet
      const saved = await savePet(form)
      setSavedPet(saved)
      // Carrying the id into the form is what makes a second Save an UPDATE.
      // Without it, "Edit details" would quietly create a duplicate pet.
      setForm(f => ({ ...f, id: saved.id, createdAt: saved.createdAt ?? f.createdAt }))
      // Skip reminders step for edits
      if (existing) { onSaved(saved); return }
      if (firstSave) {
        // Not awaited: the alert is not the user's business and must not delay
        // or fail their save.
        announcePetAdded(saved?.id)
        // Species only — an enum from a fixed list. Never the pet's name.
        trackEvent('pet_added', { species: saved?.species || '', method: 'form' })
      }
      setStep('reminders')
    } finally {
      setSaving(false)
    }
  }

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
              <button onClick={handleClose} className="p-1 rounded-lg hover:bg-amber-50 transition-colors"
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
                  {/* "Next: Set Reminders" implied nothing had been saved
                      yet and that reminders were part of the deal. The pet is
                      saved the moment this is pressed; reminders are an offer
                      afterwards. */}
                  {existing || savedPet ? 'Save Changes' : 'Save Pet'}
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
              <button onClick={handleClose} className="p-1 rounded-lg hover:bg-amber-50" style={{ color: '#73775b' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Pressing Save used to be the end of editing: the details were
                  gone and the only way back was to save, reopen and edit. */}
              <button type="button" onClick={() => setStep('form')}
                className="flex items-center gap-2 text-sm font-bold px-3 py-2 rounded-xl"
                style={{ backgroundColor: '#f4f1ea', color: '#7a4900' }}>
                <Pencil className="w-3.5 h-3.5" /> Edit {form.name || 'details'}
              </button>
              <ReminderPicker
                pets={savedPet ? [savedPet] : []}
                onDone={() => onSaved(savedPet)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
