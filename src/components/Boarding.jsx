import { useEffect, useMemo, useState } from 'react'
import {
  Home, Plus, Trash2, Share2, Bell, Check, AlertTriangle, HelpCircle, Circle,
  CalendarClock, Loader2, ChevronDown, ChevronRight, IndianRupee, Info, X,
} from 'lucide-react'
import { format } from 'date-fns'
import {
  getVaccinations, getMedicines, getAllergies, savePet, saveReminder, deleteReminder,
  getBoardingTrips, saveBoardingTrip, deleteBoardingTrip, getBoarders,
} from '../lib/storage.js'
import {
  GENERIC_POLICY, resolvePolicy, evaluateReadiness, readinessScore, prepTasks,
  estimateCost, validateSlot, slotOptions, hasSlotWindows, coerceSlot, activeAdvisories,
  buildBoardingPack, speciesSupport, speciesStance, speciesCovered,
  GENERIC_PROVENANCE, d, iso, today, OTHER_SLOT,
} from '../lib/boarding.js'
import BoarderSearch from './BoarderSearch.jsx'

const SETUP_SQL = 'Run supabase/boarding.sql in your Supabase SQL Editor to enable boarding prep.'

// A missing table or column means the migration hasn't been run yet. Say so
// plainly rather than throwing — the same courtesy Vaccinations.jsx extends.
function isMissingSchema(e) {
  return e?.code === '42P01' || e?.code === '42703' || /does not exist|schema cache/i.test(e?.message || '')
}

// ── Status presentation ──────────────────────────────────────────────────────

const STATUS = {
  ready:            { icon: Check,         label: 'Ready',        bg: '#eef3e2', color: '#44562a' },
  found_unverified: { icon: HelpCircle,    label: 'Confirm',      bg: '#dceff5', color: '#255d6e' },
  expiring:         { icon: CalendarClock, label: 'Runs out soon',bg: '#fff3c0', color: '#c9891f' },
  action_needed:    { icon: AlertTriangle, label: 'Action needed',bg: '#fdeaea', color: '#c0392b' },
  manual:           { icon: Circle,        label: 'To tick off',  bg: '#f5f0e0', color: '#5f624b' },
}

function StatusChip({ status }) {
  const s = STATUS[status] || STATUS.manual
  const Icon = s.icon
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.color }}>
      <Icon className="w-3 h-3" /> {s.label}
    </span>
  )
}

function RequirementRow({ item, override, onToggle, onNote, boarderNote }) {
  const [openNote, setOpenNote] = useState(false)
  const done = !!override?.done
  return (
    <div className="py-3" style={{ borderTop: '1px solid #ebe3d3' }}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => onToggle(item.id, !done)}
          aria-pressed={done}
          aria-label={done ? `Mark ${item.label} not done` : `Mark ${item.label} done`}
          className="mt-0.5 w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center transition-colors"
          style={done
            ? { backgroundColor: '#5f7a3a', color: 'white' }
            : { border: '1.5px solid #e0d3b4', backgroundColor: '#fffef8' }}>
          {done && <Check className="w-3.5 h-3.5" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-bold" style={{ color: '#7a4900' }}>{item.label}</span>
            <StatusChip status={item.status} />
          </div>
          {item.reason && (
            <p className="text-xs mt-0.5" style={{ color: item.status === 'action_needed' ? '#c0392b' : '#73775b' }}>
              {item.reason}
            </p>
          )}
          {item.source && item.status !== 'action_needed' && (
            <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>From your records: {item.source}</p>
          )}
          <p className="text-xs mt-1" style={{ color: '#878c6b' }}>{item.help}</p>
          {boarderNote && (
            <p className="text-xs mt-1 rounded-lg px-2 py-1" style={{ backgroundColor: '#fff9e0', color: '#7a4900' }}>
              {boarderNote}
            </p>
          )}

          {openNote || override?.note ? (
            <input
              className="input mt-2 text-xs"
              placeholder="Note — vet name, date, reference…"
              defaultValue={override?.note || ''}
              onBlur={e => onNote(item.id, e.target.value)} />
          ) : (
            <button onClick={() => setOpenNote(true)}
              className="text-xs font-bold mt-1 hover:underline" style={{ color: '#255d6e' }}>
              + Add a note
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Boarding profile ─────────────────────────────────────────────────────────

function ProfileEditor({ pet, policy, onSaved }) {
  const [form, setForm] = useState({
    foodPreferences:    pet.foodPreferences || [],
    feedingSchedule:    pet.feedingSchedule || '',
    dietNotes:          pet.dietNotes || '',
    temperament:        pet.temperament || '',
    anxietyNotes:       pet.anxietyNotes || '',
    triggers:           (pet.triggers || []).join(', '),
    socialisesWithDogs: pet.socialisesWithDogs ?? null,
    handlingNotes:      pet.handlingNotes || '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  function toggleFood(id) {
    setForm(f => ({
      ...f,
      foodPreferences: f.foodPreferences.includes(id)
        ? f.foodPreferences.filter(x => x !== id)
        : [...f.foodPreferences, id],
    }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await savePet({
        ...pet,
        ...form,
        triggers: form.triggers.split(',').map(s => s.trim()).filter(Boolean),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved(updated)
    } catch (e) {
      alert(isMissingSchema(e) ? SETUP_SQL : 'Could not save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const menu = policy.food_menu || []

  return (
    <div className="space-y-5">
      <div>
        <label className="label">
          {menu.length
            ? `Food — pick from ${policy.name || 'the boarder'}'s menu`
            : 'Food'}
        </label>
        {!menu.length && (
          <p className="text-xs mb-2" style={{ color: '#878c6b' }}>
            We don't have this boarder's menu on file. Describe what {pet.name} eats in the
            notes below, and check what they can actually provide.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {menu.map(m => {
            const on = form.foodPreferences.includes(m.id)
            return (
              <button key={m.id} onClick={() => toggleFood(m.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-left text-xs font-semibold transition-all"
                style={on
                  ? { backgroundColor: '#fff3c0', color: '#7a4900', border: '1.5px solid #f2b83d' }
                  : { backgroundColor: '#fffef8', color: '#73775b', border: '1.5px solid #ebe3d3' }}>
                {on ? <Check className="w-3.5 h-3.5 flex-shrink-0" /> : <Circle className="w-3.5 h-3.5 flex-shrink-0" />}
                <span className="flex-1">{m.label}</span>
                {m.extra_charge && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: '#fdefe9', color: '#c0563d' }}>extra</span>
                )}
              </button>
            )
          })}
        </div>
        {policy.food_note && <p className="text-xs mt-2" style={{ color: '#878c6b' }}>{policy.food_note}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Feeding schedule</label>
          <input className="input" value={form.feedingSchedule}
            onChange={e => setForm(f => ({ ...f, feedingSchedule: e.target.value }))}
            placeholder="e.g. Twice a day — 8am and 7pm, 1 cup" />
        </div>
        <div>
          <label className="label">Diet notes</label>
          <input className="input" value={form.dietNotes}
            onChange={e => setForm(f => ({ ...f, dietNotes: e.target.value }))}
            placeholder="e.g. No chicken — upsets his stomach" />
        </div>
        <div>
          <label className="label">Temperament</label>
          <input className="input" value={form.temperament}
            onChange={e => setForm(f => ({ ...f, temperament: e.target.value }))}
            placeholder="e.g. Friendly but shy with strangers at first" />
        </div>
        <div>
          <label className="label">Anxiety or barking</label>
          <input className="input" value={form.anxietyNotes}
            onChange={e => setForm(f => ({ ...f, anxietyNotes: e.target.value }))}
            placeholder="e.g. Whines the first night, settles after" />
        </div>
        <div>
          <label className="label">Triggers <span className="font-normal" style={{ color: '#878c6b' }}>(comma separated)</span></label>
          <input className="input" value={form.triggers}
            onChange={e => setForm(f => ({ ...f, triggers: e.target.value }))}
            placeholder="e.g. Fireworks, men in hats, brooms" />
        </div>
        <div>
          <label className="label">Handling notes</label>
          <input className="input" value={form.handlingNotes}
            onChange={e => setForm(f => ({ ...f, handlingNotes: e.target.value }))}
            placeholder="e.g. Take the collar off at night, hates nail trims" />
        </div>
      </div>

      <div>
        <label className="label">Gets on with other dogs</label>
        <div className="flex gap-2">
          {[['Yes', true], ['No', false], ['Not sure', null]].map(([label, val]) => (
            <button key={label} onClick={() => setForm(f => ({ ...f, socialisesWithDogs: val }))}
              className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
              style={form.socialisesWithDogs === val
                ? { backgroundColor: '#ffde59', color: '#7a4900' }
                : { backgroundColor: '#f5f0e0', color: '#73775b' }}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs mt-1.5" style={{ color: '#878c6b' }}>
          Boarders group dogs by temperament and energy, so this is worth getting right.
        </p>
      </div>

      <button onClick={handleSave} disabled={saving} className="btn-primary gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
        {saved ? 'Saved' : 'Save boarding profile'}
      </button>
    </div>
  )
}

// ── Prep reminders ───────────────────────────────────────────────────────────

function PrepReminderModal({ tasks, petName, existingCount, onClose, onConfirm }) {
  const [selected, setSelected] = useState(() => new Set(tasks.map((_, i) => i)))
  const [saving, setSaving]     = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-lg rounded-3xl overflow-hidden flex flex-col"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #ebe3d3' }}>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5" style={{ color: '#c9891f' }} />
            <span className="font-black" style={{ color: '#7a4900' }}>Prep reminders</span>
          </div>
          <button onClick={onClose} style={{ color: '#73775b' }}><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          <p className="text-sm mb-3" style={{ color: '#73775b' }}>
            These go into {petName}'s reminders and reach you by email, SMS and push on the morning they're due.
          </p>
          {existingCount > 0 && (
            <div className="rounded-xl p-3 mb-3 text-xs" style={{ backgroundColor: '#dceff5', color: '#255d6e' }}>
              {existingCount} reminder{existingCount > 1 ? 's' : ''} generated earlier for this stay will be replaced,
              so you won't get them twice.
            </div>
          )}
          {tasks.map((t, i) => {
            const on = selected.has(i)
            return (
              <button key={t.id + i} onClick={() => setSelected(s => {
                const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n
              })}
                className="w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all"
                style={{ backgroundColor: on ? '#fff9e0' : '#fffef8', border: `1.5px solid ${on ? '#f2b83d' : '#ebe3d3'}` }}>
                <div className="mt-0.5 w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center"
                  style={on ? { backgroundColor: '#5f7a3a', color: 'white' } : { border: '1.5px solid #e0d3b4' }}>
                  {on && <Check className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold" style={{ color: '#7a4900' }}>{t.label}</span>
                    {t.overdue && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>overdue — do now</span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>
                    {format(d(t.dueDate), 'EEE d MMM')} · {t.notes}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        <div className="flex gap-2 p-5 flex-shrink-0" style={{ borderTop: '1px solid #ebe3d3' }}>
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button
            disabled={saving || selected.size === 0}
            onClick={async () => {
              setSaving(true)
              try { await onConfirm(tasks.filter((_, i) => selected.has(i))) } finally { setSaving(false) }
            }}
            className="btn-primary flex-1 justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Add {selected.size} reminder{selected.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Handover sheet ───────────────────────────────────────────────────────────

function PackModal({ text, petName, onClose }) {
  const [copied, setCopied] = useState(false)
  async function share() {
    if (navigator.share) {
      try { await navigator.share({ title: `${petName} — boarding pack`, text }); return } catch {}
    }
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-3xl overflow-hidden flex flex-col"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ backgroundColor: '#7a4900' }}>
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5" style={{ color: '#f2b83d' }} />
            <span className="font-black text-white">Boarding pack</span>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <pre className="flex-1 overflow-auto p-5 text-xs whitespace-pre-wrap font-mono" style={{ color: '#7a4900' }}>{text}</pre>
        <div className="p-5 flex-shrink-0" style={{ borderTop: '1px solid #ebe3d3' }}>
          <button onClick={share} className="btn-primary w-full justify-center gap-2">
            <Share2 className="w-4 h-4" /> {copied ? 'Copied to clipboard' : 'Send to the boarder'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

const BLANK_TRIP = {
  providerId: '', providerName: '', startDate: '', startSlot: 'morning',
  endDate: '', endSlot: 'morning', trialDate: '', isFirstStay: true,
  checklist: {}, generatedReminderIds: [], notes: '',
}

export default function Boarding({ pet, onPetUpdated, prefillProviderId, onPrefillUsed }) {
  const [records, setRecords]   = useState({ vaccinations: [], medicines: [], allergies: [] })
  const [trips, setTrips]       = useState([])
  const [draft, setDraft]       = useState({ ...BLANK_TRIP, petId: pet.id })
  const [activeId, setActiveId] = useState(null)
  const [boarders, setBoarders] = useState([])
  const [loading, setLoading]   = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [showPrep, setShowPrep] = useState(false)
  const [showPack, setShowPack] = useState(false)
  const [openProfile, setOpenProfile] = useState(false)
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      getVaccinations(pet.id), getMedicines(pet.id), getAllergies(pet.id),
    ]).then(([vaccinations, medicines, allergies]) => {
      if (!cancelled) setRecords({ vaccinations, medicines, allergies })
    }).catch(console.error)

    getBoardingTrips(pet.id)
      .then(rows => {
        if (cancelled) return
        setTrips(rows)
        setActiveId(rows[0]?.id || null)
      })
      .catch(e => { if (!cancelled && isMissingSchema(e)) setTableMissing(true); else console.error(e) })
      .finally(() => { if (!cancelled) setLoading(false) })

    getBoarders()
      .then(rows => { if (!cancelled) setBoarders(rows) })
      .catch(() => {})

    return () => { cancelled = true }
  }, [pet.id])

  // Arriving from "Prep for a stay here" in the directory: start a fresh draft
  // against that boarder rather than whatever stay was last open.
  useEffect(() => {
    if (!prefillProviderId || !boarders.length) return
    const b = boarders.find(x => x.id === prefillProviderId)
    if (!b) return
    setActiveId(null)
    setDraft(t => ({ ...t, petId: pet.id, providerId: b.id, providerName: b.name }))
    onPrefillUsed?.()
  }, [prefillProviderId, boarders, pet.id])

  // The trip being planned: a saved one, or the unsaved draft.
  const trip = useMemo(
    () => trips.find(t => t.id === activeId) || draft,
    [trips, activeId, draft])

  const provider = useMemo(
    () => boarders.find(b => b.id === trip.providerId) || null,
    [boarders, trip.providerId])

  const policy = useMemo(() => resolvePolicy(provider), [provider])

  const evaluation = useMemo(
    () => evaluateReadiness(pet, records, policy, trip.startDate, trip.checklist || {}),
    [pet, records, policy, trip.startDate, trip.checklist])

  const score     = useMemo(() => readinessScore(evaluation), [evaluation])
  const tasks     = useMemo(() => prepTasks(policy, trip.startDate, evaluation), [policy, trip.startDate, evaluation])
  const cost      = useMemo(() => estimateCost(policy, trip, pet), [policy, trip, pet])
  const advisories = useMemo(() => activeAdvisories(policy, trip.startDate, trip.endDate), [policy, trip.startDate, trip.endDate])

  // Does this boarder's published list actually speak to this pet's species?
  // A dog kennel's criteria filtered down for a cat can leave a near-empty
  // checklist, which reads as "nothing required" — a false all-clear.
  const stance  = speciesStance(policy, pet.species)
  const covered = speciesCovered(policy)
  const speciesGap = !policy.isGeneric && stance === 'unknown' && covered.length && !covered.includes(pet.species)

  const prepare  = evaluation.filter(e => e.phase === 'prepare_before')
  const atGate   = evaluation.filter(e => e.phase === 'at_drop_off')
  const slots    = slotOptions(policy)

  function patchTrip(patch) {
    if (trip.id) setTrips(ts => ts.map(t => t.id === trip.id ? { ...t, ...patch } : t))
    else setDraft(t => ({ ...t, ...patch }))
  }

  async function persist(patch) {
    const next = { ...trip, ...patch, petId: pet.id }
    patchTrip(patch)
    if (tableMissing) return next          // draft-only mode; nothing to write to
    try {
      const saved = await saveBoardingTrip(next)
      setTrips(ts => {
        const without = ts.filter(t => t.id !== saved.id)
        return [saved, ...without].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
      })
      setActiveId(saved.id)
      return saved
    } catch (e) {
      if (isMissingSchema(e)) { setTableMissing(true); return next }
      alert('Could not save the stay: ' + e.message)
      return next
    }
  }

  function setChecklist(id, patch) {
    const checklist = { ...(trip.checklist || {}), [id]: { ...(trip.checklist?.[id] || {}), ...patch } }
    persist({ checklist })
  }

  async function handleGenerate(chosen) {
    setSaving(true)
    try {
      // Reminders have no natural key, so clear what we made last time rather
      // than stacking a second copy into the same 7am email.
      for (const id of trip.generatedReminderIds || []) {
        try { await deleteReminder(id) } catch {}
      }
      const created = []
      for (const t of chosen) {
        const r = await saveReminder({
          petId: pet.id, type: 'Boarding', dueDate: t.dueDate,
          frequency: 'Once', notes: `${t.label} — ${t.notes}`,
          isDone: false, email: '', whatsapp: '',
        })
        if (r?.id) created.push(r.id)
      }
      await persist({ generatedReminderIds: created })
      setShowPrep(false)
      alert(`Added ${created.length} reminder${created.length === 1 ? '' : 's'} to ${pet.name}'s list.`)
    } catch (e) {
      alert('Could not create reminders: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteTrip() {
    if (!trip.id) return
    if (!confirm('Delete this planned stay?')) return
    for (const id of trip.generatedReminderIds || []) { try { await deleteReminder(id) } catch {} }
    await deleteBoardingTrip(trip.id)
    const rest = trips.filter(t => t.id !== trip.id)
    setTrips(rest)
    setActiveId(rest[0]?.id || null)
  }

  const startWarn = trip.startSlot ? validateSlot(policy, trip.startSlot) : { ok: true }
  const endWarn   = trip.endSlot   ? validateSlot(policy, trip.endSlot)   : { ok: true }

  if (loading) {
    return <div className="card flex items-center gap-2" style={{ color: '#73775b' }}>
      <Loader2 className="w-4 h-4 animate-spin" /> Checking {pet.name}'s records…
    </div>
  }

  // Dogs and cats are the only species we have criteria for. Showing anyone
  // else a dog's checklist would be worse than admitting the gap.
  const support = speciesSupport(pet.species)
  if (!support.supported) {
    return (
      <div className="card">
        <h2 className="type-subhead mb-1 flex items-center gap-2" style={{ color: '#7a4900' }}>
          <Home className="w-4 h-4" /> Boarding {pet.name}
        </h2>
        <p className="text-sm" style={{ color: '#73775b' }}>{support.text}</p>

        <div className="rounded-xl p-3 mt-4" style={{ backgroundColor: '#dceff5' }}>
          <p className="text-xs font-bold mb-1" style={{ color: '#255d6e' }}>Worth asking any boarder</p>
          {[
            'Which vaccinations they need, and how long before the stay.',
            'Whether they have housed this kind of animal before.',
            `Whether you should bring ${pet.name}'s own enclosure, bedding and food.`,
            'What they do if your pet stops eating or looks unwell.',
          ].map((q, i) => (
            <p key={i} className="text-xs" style={{ color: '#255d6e' }}>· {q}</p>
          ))}
        </div>

        {support.reason === 'no_species' && (
          <p className="text-xs mt-3" style={{ color: '#878c6b' }}>
            Edit {pet.name} and set a species, and this page will fill in.
          </p>
        )}
        <p className="text-xs mt-3" style={{ color: '#878c6b' }}>
          {pet.name}'s records, reminders and health brief all still work as normal —
          this page is only about a boarder's admission requirements.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {tableMissing && (
        <div className="rounded-2xl p-4 flex items-start gap-2 text-sm"
          style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Planned stays aren't being saved yet.</p>
            <p className="text-xs mt-0.5">{SETUP_SQL} Until then you can still check readiness — nothing you enter here will persist.</p>
          </div>
        </div>
      )}

      {/* ── The stay ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 className="type-subhead flex items-center gap-2" style={{ color: '#7a4900' }}>
            <Home className="w-4 h-4" /> The stay
          </h2>
          <div className="flex items-center gap-2">
            {trips.length > 0 && (
              <select className="input py-1 text-xs w-auto" value={activeId || 'new'}
                onChange={e => setActiveId(e.target.value === 'new' ? null : e.target.value)}>
                {trips.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.startDate ? format(d(t.startDate), 'd MMM yyyy') : 'Undated'} · {t.providerName || 'Boarder TBC'}
                  </option>
                ))}
                <option value="new">+ New stay</option>
              </select>
            )}
            {trip.id && (
              <button onClick={handleDeleteTrip} className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label">Boarder</label>
            <BoarderSearch
              boarders={boarders}
              value={trip.providerId}
              valueName={trip.providerName}
              onSelect={b => {
                const next = resolvePolicy(b)
                persist({
                  providerId: b.id, providerName: b.name,
                  startSlot: coerceSlot(next, trip.startSlot),
                  endSlot:   coerceSlot(next, trip.endSlot),
                })
              }}
              onClear={() => persist({
                providerId: '', providerName: '',
                startSlot: coerceSlot(GENERIC_POLICY, trip.startSlot),
                endSlot:   coerceSlot(GENERIC_POLICY, trip.endSlot),
              })} />
            {policy.isGeneric && (
              <details className="mt-1.5">
                <summary className="text-xs cursor-pointer" style={{ color: '#878c6b' }}>
                  {trip.providerName
                    ? `We don't have ${trip.providerName}'s own requirements yet, so this is the general list — check it against what they ask for.`
                    : 'Showing the general list most boarders ask for. Pick a boarder above to see their own requirements.'}
                  {' '}<span className="font-bold" style={{ color: '#255d6e' }}>Where this list comes from</span>
                </summary>
                <p className="text-xs mt-1.5 rounded-xl p-2.5" style={{ backgroundColor: '#f5f0e0', color: '#5f624b' }}>
                  {GENERIC_PROVENANCE}
                </p>
              </details>
            )}
          </div>

          <div>
            <label className="label">Drop-off date</label>
            <input type="date" className="input" value={trip.startDate || ''}
              onChange={e => persist({ startDate: e.target.value })} />
          </div>
          <div>
            <label className="label">Drop-off time{hasSlotWindows(policy) ? '' : ' (roughly)'}</label>
            <select className="input" value={trip.startSlot || ''} onChange={e => persist({ startSlot: e.target.value })}>
              {slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Pick-up date</label>
            <input type="date" className="input" value={trip.endDate || ''}
              onChange={e => persist({ endDate: e.target.value })} />
          </div>
          <div>
            <label className="label">Pick-up time{hasSlotWindows(policy) ? '' : ' (roughly)'}</label>
            <select className="input" value={trip.endSlot || ''} onChange={e => persist({ endSlot: e.target.value })}>
              {slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          {policy.trial_required && (
            <div>
              <label className="label">Trial / orientation visit</label>
              <input type="date" className="input" value={trip.trialDate || ''}
                onChange={e => persist({ trialDate: e.target.value })} />
            </div>
          )}
          <div>
            <label className="label">Anything else for the boarder</label>
            <input className="input" value={trip.notes || ''}
              onChange={e => patchTrip({ notes: e.target.value })}
              onBlur={e => persist({ notes: e.target.value })}
              placeholder="e.g. Being picked up by my sister" />
          </div>
        </div>

        {(!startWarn.ok || !endWarn.ok) && (
          <div className="rounded-xl p-3 mt-4 flex items-start gap-2 text-xs"
            style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{(startWarn.ok ? endWarn : startWarn).message}</span>
          </div>
        )}
        {policy.arrival_notes && (
          <p className="text-xs mt-3 flex items-start gap-1.5" style={{ color: '#73775b' }}>
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {policy.arrival_notes}
          </p>
        )}
      </div>

      {stance === 'not_accepted' && (
        <div className="rounded-2xl p-4 flex items-start gap-2 text-sm"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">{trip.providerName} doesn’t take {pet.species.toLowerCase()}s.</p>
            <p className="text-xs mt-0.5">
              They’ve told us which animals they board, and {pet.species.toLowerCase()}s aren’t on it, so this
              stay may not be possible. Anything below is what they ask of the animals they do take —
              treat it as a rough guide, not their requirements for {pet.name}.
            </p>
          </div>
        </div>
      )}

      {speciesGap && (
        <div className="rounded-2xl p-4 flex items-start gap-2 text-sm"
          style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">
              These are {trip.providerName}’s requirements for {covered.map(c => c.toLowerCase() + 's').join(' and ')}.
            </p>
            <p className="text-xs mt-0.5">
              They haven’t published anything about {pet.species.toLowerCase()}s, so a short list here doesn’t mean
              there’s nothing to do — ask them what they need for {pet.name}.
            </p>
          </div>
        </div>
      )}

      {/* ── Readiness ────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="type-subhead" style={{ color: '#7a4900' }}>Before the stay</h2>
          <div className="text-right">
            <div className="text-lg font-black" style={{ color: score.needsAction ? '#c0392b' : '#5f7a3a' }}>
              {score.ready}/{score.total}
            </div>
            <div className="text-xs" style={{ color: '#73775b' }}>ready</div>
          </div>
        </div>
        <p className="text-xs mb-2" style={{ color: '#73775b' }}>
          {score.needsAction > 0
            ? `${score.needsAction} thing${score.needsAction > 1 ? 's' : ''} need${score.needsAction > 1 ? '' : 's'} attention`
            : score.toConfirm > 0
              ? `Nothing outstanding — ${score.toConfirm} to confirm with your vet`
              : 'Nothing outstanding'}
          {!trip.startDate && ' · pick a drop-off date to check against it'}
        </p>

        {prepare.map(item => (
          <RequirementRow key={item.id} item={item}
            boarderNote={policy.requirement_notes?.[item.id]}
            override={trip.checklist?.[item.id]}
            onToggle={(id, done) => setChecklist(id, { done, date: done ? iso(today()) : null })}
            onNote={(id, note) => setChecklist(id, { note })} />
        ))}

        <div className="flex flex-wrap gap-2 mt-5">
          <button onClick={() => setShowPrep(true)} disabled={!trip.startDate || tasks.length === 0}
            className="btn-primary gap-2 disabled:opacity-40">
            <Bell className="w-4 h-4" /> Generate prep reminders
          </button>
          <button onClick={() => setShowPack(true)} className="btn-secondary inline-flex items-center gap-2">
            <Share2 className="w-4 h-4" /> Boarding pack
          </button>
        </div>
        {!trip.startDate && (
          <p className="text-xs mt-2" style={{ color: '#878c6b' }}>Reminders need a drop-off date to count back from.</p>
        )}
      </div>

      {/* ── At drop-off ──────────────────────────────────────────────── */}
      <div className="card">
        <h2 className="type-subhead mb-1" style={{ color: '#7a4900' }}>At drop-off</h2>
        <p className="text-xs mb-2" style={{ color: '#73775b' }}>
          Carried by you on the day — nothing here can be done in advance.
        </p>
        {atGate.map(item => (
          <RequirementRow key={item.id} item={item}
            boarderNote={policy.requirement_notes?.[item.id]}
            override={trip.checklist?.[item.id]}
            onToggle={(id, done) => setChecklist(id, { done, date: done ? iso(today()) : null })}
            onNote={(id, note) => setChecklist(id, { note })} />
        ))}
        {(policy.bring || []).length > 0 && (
          <div className="mt-4 rounded-xl p-3 text-xs" style={{ backgroundColor: '#eef3e2', color: '#44562a' }}>
            <span className="font-bold">Bring:</span> {policy.bring.join(' · ')}
          </div>
        )}
        {(policy.do_not_bring || []).length > 0 && (
          <div className="mt-2 rounded-xl p-3 text-xs" style={{ backgroundColor: '#f5f0e0', color: '#5f624b' }}>
            <span className="font-bold">Leave at home:</span> {policy.do_not_bring.join(' · ')} — they can't be
            guaranteed to come back in their original condition.
          </div>
        )}
      </div>

      {/* ── Advisories ───────────────────────────────────────────────── */}
      {advisories.length > 0 && (
        <div className="card">
          <h2 className="type-subhead mb-2" style={{ color: '#7a4900' }}>Worth knowing for these dates</h2>
          {advisories.map((a, i) => (
            <p key={i} className="text-xs mb-2 last:mb-0" style={{ color: '#73775b' }}>{a.text}</p>
          ))}
        </div>
      )}

      {/* ── Cost ─────────────────────────────────────────────────────── */}
      {trip.startDate && (cost.lines.length > 0 || cost.discussionFlags.length > 0) && (
        <div className="card">
          <h2 className="type-subhead mb-3 flex items-center gap-2" style={{ color: '#7a4900' }}>
            <IndianRupee className="w-4 h-4" /> {cost.hasPricing ? 'Rough cost' : 'What it might cost'}
          </h2>
          {cost.lines.map((l, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
              style={{ borderTop: i ? '1px solid #ebe3d3' : 'none', color: '#7a4900' }}>
              <span>{l.label}</span>
              <span className="font-bold whitespace-nowrap">₹{l.amount.toLocaleString('en-IN')}</span>
            </div>
          ))}
          {cost.hasPricing && (
            <div className="flex items-baseline justify-between gap-3 pt-2 mt-1" style={{ borderTop: '1.5px solid #e0d3b4' }}>
              <span className="font-black" style={{ color: '#7a4900' }}>Estimate</span>
              <span className="font-black text-lg" style={{ color: '#7a4900' }}>₹{cost.total.toLocaleString('en-IN')}</span>
            </div>
          )}
          <p className="text-xs mt-2" style={{ color: '#c0563d' }}>{cost.note}</p>
          {cost.discussionFlags.length > 0 && (
            <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: '#dceff5' }}>
              <p className="text-xs font-bold mb-1" style={{ color: '#255d6e' }}>Worth raising with the boarder</p>
              {cost.discussionFlags.map((f, i) => (
                <p key={i} className="text-xs" style={{ color: '#255d6e' }}>· {f}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Boarding profile ─────────────────────────────────────────── */}
      <div className="card">
        <button onClick={() => setOpenProfile(o => !o)} className="w-full flex items-center justify-between gap-2">
          <div className="text-left">
            <h2 className="type-subhead" style={{ color: '#7a4900' }}>{pet.name}'s boarding profile</h2>
            <p className="text-xs" style={{ color: '#73775b' }}>
              Food, temperament and handling — what anyone looking after {pet.name} for a few days needs to know.
            </p>
          </div>
          {openProfile ? <ChevronDown className="w-5 h-5 flex-shrink-0" style={{ color: '#73775b' }} />
                       : <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: '#73775b' }} />}
        </button>
        {openProfile && (
          <div className="mt-5">
            <ProfileEditor pet={pet} policy={policy} onSaved={onPetUpdated} />
          </div>
        )}
      </div>

      {showPrep && (
        <PrepReminderModal
          tasks={tasks} petName={pet.name}
          existingCount={(trip.generatedReminderIds || []).length}
          onClose={() => setShowPrep(false)}
          onConfirm={handleGenerate} />
      )}

      {showPack && (
        <PackModal
          petName={pet.name}
          text={buildBoardingPack({
            pet, policy, trip, evaluation,
            allergies: records.allergies, medicines: records.medicines,
          })}
          onClose={() => setShowPack(false)} />
      )}
    </div>
  )
}
