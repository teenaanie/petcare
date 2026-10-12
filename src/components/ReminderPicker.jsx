// Offering care reminders for one or more newly added pets.
//
// This lived inside AddPetModal, which meant it only existed on the form path.
// Adding a pet by voice never offered reminders at all -- an owner reported
// exactly that: they added a pet and were never asked. Lifting it out is what
// lets both paths ask the same question in the same words.
//
// The rules it carries over, which are the point of the screen:
//
//   * Nothing starts ticked. The previous version pre-selected everything
//     under the words "We've pre-selected common care reminders", which a
//     customer reasonably experienced as Pippy adding reminders by itself --
//     including a vaccination their dog had already had.
//   * A ticked row can have its first due date corrected, because "booster in
//     12 months" is only true if the jab was today.
//   * Declining is a first-class answer, not a "skip".

import { useState } from 'react'
import { Bell, Loader2, CheckCircle, Circle } from 'lucide-react'
import { suggestionsFor, remindersToSave } from '../lib/careSuggestions.js'
import { saveReminder } from '../lib/storage.js'

const TYPE_COLORS = {
  Vaccination: '#2f7286', Deworming: '#7a5c9e', 'Flea & Tick': '#c0392b',
  Dental: '#2e7d32', 'Health Check': '#c9891f', Grooming: '#b2566f',
}

/**
 * @param pets    [{ id, name, species, breed }] — one from the form path,
 *                possibly several from a spoken "I have two dogs and a cat".
 * @param onDone  Called with the number saved (0 when they decline).
 */
export default function ReminderPicker({ pets = [], onDone }) {
  const [selected, setSelected] = useState(() => new Set())
  const [dates, setDates]       = useState({})
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)

  // Suggestions per pet, worked out once per render from today's date.
  const groups = pets
    .filter(p => p && p.id)
    .map(p => ({ pet: p, suggestions: suggestionsFor(p.species) }))

  // Keys are scoped by pet, so the same suggestion for two animals is two
  // separate ticks.
  const rowKey = (petId, key) => `${petId}::${key}`

  function toggle(k) {
    setSelected(s => {
      const next = new Set(s)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      let count = 0
      for (const { pet, suggestions } of groups) {
        // Back to per-pet keys for remindersToSave, which knows nothing about
        // there being more than one animal.
        const mine = suggestions
          .filter(s => selected.has(rowKey(pet.id, s.key)))
          .map(s => s.key)
        if (!mine.length) continue
        const petDates = {}
        for (const s of suggestions) {
          const v = dates[rowKey(pet.id, s.key)]
          if (v) petDates[s.key] = v
        }
        const rows = remindersToSave(suggestions, mine, pet.id, petDates)
        for (const r of rows) { await saveReminder(r); count++ }
      }
      onDone?.(count)
    } catch (e) {
      // The pets are already saved by this point, so a failure here must not
      // look like the whole thing failed.
      setError(e.message || 'Could not save those reminders.')
      setSaving(false)
    }
  }

  if (!groups.length) return null
  const many = groups.length > 1

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: '#7a4900' }}>
        {many
          ? 'Would you like any reminders for them? Tap the ones you want. Nothing is added unless you pick it.'
          : `Would you like any reminders for your ${(groups[0].pet.species || 'pet').toLowerCase()}? Tap the ones you want. Nothing is added unless you pick it.`}
      </p>

      {groups.map(({ pet, suggestions }) => (
        <div key={pet.id} className="space-y-2">
          {many && (
            <p className="text-xs font-black pt-1" style={{ color: '#7a4900' }}>
              {pet.name}{pet.breed ? ` · ${pet.breed}` : pet.species ? ` · ${pet.species}` : ''}
            </p>
          )}
          {suggestions.map(r => {
            const k     = rowKey(pet.id, r.key)
            const isOn  = selected.has(k)
            const color = TYPE_COLORS[r.type] || '#73775b'
            const due   = dates[k] || r.dueDate
            return (
              <div key={k} className="rounded-2xl transition-all"
                style={{
                  backgroundColor: '#fffef8',
                  border: `1.5px solid ${isOn ? '#f2b83d' : '#ebe3d3'}`,
                  opacity: isOn ? 1 : 0.7,
                }}>
                <button type="button" onClick={() => toggle(k)} aria-pressed={isOn}
                  className="w-full text-left flex items-start gap-3 p-4">
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
                      {r.frequency} · First due {new Date(due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    {r.notes && (
                      <p className="text-xs mt-0.5 italic" style={{ color: '#73775b' }}>{r.notes}</p>
                    )}
                  </div>
                </button>

                {isOn && (
                  <div className="px-4 pb-4 -mt-1 pl-12">
                    {r.assumesToday && (
                      <p className="text-xs mb-1.5" style={{ color: '#9a7b2e' }}>
                        This assumes it was done today. If it was earlier, set the real next-due date.
                      </p>
                    )}
                    <label className="flex items-center gap-2 text-xs font-bold" style={{ color: '#73775b' }}>
                      First due
                      <input type="date" value={due}
                        onChange={e => setDates(d => ({ ...d, [k]: e.target.value }))}
                        className="input text-xs py-1 px-2 w-auto" />
                    </label>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {error && (
        <p className="text-xs" style={{ color: '#c0392b' }}>
          {error} Your {many ? 'pets are' : 'pet is'} saved either way — you can add reminders from their Reminders tab.
        </p>
      )}

      <div className="flex gap-3 pt-3">
        <button onClick={() => onDone?.(0)} disabled={saving}
          className="btn-secondary flex-1 justify-center text-sm">
          {selected.size === 0 ? 'No reminders, thanks' : 'Skip for now'}
        </button>
        <button onClick={save} disabled={saving || selected.size === 0}
          className="btn-primary flex-1 justify-center gap-2 text-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
          {selected.size === 0
            ? 'Pick some above'
            : `Add ${selected.size} reminder${selected.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}
