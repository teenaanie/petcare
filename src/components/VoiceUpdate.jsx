import { useState } from 'react'
import {
  Loader2, X, Check, AlertCircle, Sparkles, ChevronLeft,
  Stethoscope, Syringe, Pill, AlertTriangle, Weight, Receipt, Bell,
} from 'lucide-react'
import { aiComplete } from '../lib/ai.js'
import { useVoiceRecorder } from '../lib/useVoiceRecorder.js'
import VoicePanel from './VoicePanel.jsx'
import {
  saveMedicalRecord, saveVaccination, saveMedicine, saveAllergy,
  saveWeightLog, saveBill, saveReminder,
} from '../lib/storage.js'
import { groupParsed } from '../lib/voiceUpdateRecords.js'

// Which storage function each kind writes through, named in the pure module so
// that module can stay free of imports and be tested in plain node.
const SAVERS = {
  saveMedicalRecord, saveVaccination, saveMedicine, saveAllergy,
  saveWeightLog, saveBill, saveReminder,
}

const EXAMPLE = "We saw Dr Sharma at Happy Paws this morning. Bruno has a mild ear infection — she gave him Otibact drops twice a day for a week. He weighs 19.4 kilos now. It came to about 1,800 rupees, and she wants to see him again in ten days."

// The only part of a record kind that has to be JSX.
const LOOK = {
  medical:      { icon: Stethoscope,   color: '#2f7286' },
  vaccinations: { icon: Syringe,       color: '#2f7286' },
  medicines:    { icon: Pill,          color: '#7a5c9e' },
  allergies:    { icon: AlertTriangle, color: '#c0392b' },
  weights:      { icon: Weight,        color: '#44562a' },
  bills:        { icon: Receipt,       color: '#9a6b12' },
  reminders:    { icon: Bell,          color: '#c9891f' },
}

// Adding to a pet that already exists — the update between the big moments.
//
// The Add-a-pet screen (VoiceIntake) solved getting a history INTO the app.
// This solves keeping it true afterwards, which is the harder half: nobody
// opens seven tabs and fills seven forms on the way out of a clinic. They will
// say one sentence in the car.
//
// Deliberately NOT able to create a pet. It writes only to the record tables,
// under a pet id the caller already holds — so a mishearing can add a wrong
// vaccination, which the review screen catches, but can never conjure an animal.
//
// Same contract as the intake screen: speech lands in a textarea, the AI
// proposes, the human confirms, and nothing is written until the button is
// pressed.

function Row({ checked, onToggle, icon: Icon, label, title, detail, color }) {
  return (
    <label className="flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer"
      style={{ backgroundColor: checked ? '#fff9e0' : '#f4f1ea' }}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5" />
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: '#a08f7a' }}>{label}</p>
        <p className="text-sm font-bold" style={{ color: '#7a4900' }}>{title}</p>
        {detail && <p className="text-xs" style={{ color: '#73775b' }}>{detail}</p>}
      </div>
    </label>
  )
}

// ── Review: the AI proposes, the human confirms ──────────────────────────────

function Review({ parsed, pet, onBack, onSaved }) {
  // Rows not worth offering are dropped by groupParsed, so the indexes
  // the tick-boxes use must come from the FILTERED list, not the raw one.
  const groups = groupParsed(parsed)

  const [picked, setPicked] = useState(() => {
    const m = {}
    groups.forEach(({ kind, rows }) => rows.forEach((_, i) => { m[`${kind.key}-${i}`] = true }))
    return m
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const [done, setDone]     = useState(null)

  const toggle = k => setPicked(p => ({ ...p, [k]: !p[k] }))
  const total  = groups.reduce((n, g) => n + g.rows.filter((_, i) => picked[`${g.kind.key}-${i}`]).length, 0)

  async function save() {
    setSaving(true); setError(null)
    const saved = []
    try {
      for (const { kind, rows } of groups) {
        for (let i = 0; i < rows.length; i++) {
          if (!picked[`${kind.key}-${i}`]) continue
          await SAVERS[kind.saver](kind.payload(rows[i], pet.id))
          saved.push(kind.label)
        }
      }
      const counts = saved.reduce((m, l) => ({ ...m, [l]: (m[l] || 0) + 1 }), {})
      setDone(counts)
      onSaved?.(counts)
    } catch (e) {
      // Partial saves are real: some rows may already be in. Say so rather than
      // implying nothing happened, so the user does not save the same visit twice.
      setError(saved.length
        ? `${e.message} — ${saved.length} record${saved.length === 1 ? '' : 's'} had already been saved before this failed, so check the tabs before trying again.`
        : `${e.message} — nothing was saved, you can try again.`)
      setSaving(false)
    }
  }

  if (done) {
    const parts = Object.entries(done).map(([l, n]) => `${n} ${l.toLowerCase()}${n === 1 ? '' : 's'}`)
    return (
      <div className="text-center py-8 px-4 rounded-2xl" style={{ backgroundColor: '#eef3e2' }}>
        <Check className="w-8 h-8 mx-auto mb-2" style={{ color: '#44562a' }} />
        <p className="font-black" style={{ color: '#44562a' }}>Added to {pet.name}</p>
        <p className="text-sm mt-1" style={{ color: '#44562a' }}>{parts.join(' · ')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} disabled={saving}
        className="flex items-center gap-1 text-sm font-bold" style={{ color: '#7a4900' }}>
        <ChevronLeft className="w-4 h-4" /> Back to the text
      </button>

      <div className="p-3 rounded-xl text-sm" style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
        <strong>Check this before saving.</strong> Untick anything that isn't right —
        nothing is added to {pet.name} until you press the button.
      </div>

      {groups.length === 0 && (
        <p className="text-sm p-3 rounded-xl" style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          Nothing could be picked out of that. Go back and try naming what happened —
          the vet, the medicine, the weight.
        </p>
      )}

      {groups.map(({ kind, rows }) => (
        <div key={kind.key} className="rounded-2xl p-3 space-y-2"
          style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>
          {rows.map((r, i) => (
            <Row key={i} checked={!!picked[`${kind.key}-${i}`]} onToggle={() => toggle(`${kind.key}-${i}`)}
              icon={LOOK[kind.key].icon} color={LOOK[kind.key].color} label={kind.label}
              title={kind.title(r)} detail={kind.detail(r)} />
          ))}
        </div>
      ))}

      {(parsed.unclear || []).length > 0 && (
        <div className="rounded-2xl p-3" style={{ backgroundColor: '#fff3c0' }}>
          <p className="text-xs font-black uppercase tracking-wider mb-1.5" style={{ color: '#9a6b12' }}>
            I didn't catch these — add them yourself?
          </p>
          {parsed.unclear.map((u, i) => (
            <p key={i} className="text-sm" style={{ color: '#7a4900' }}>• {u}</p>
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm p-3 rounded-xl flex items-start gap-2"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </p>
      )}

      <button type="button" onClick={save} disabled={saving || total === 0}
        className="btn-primary w-full gap-2 text-sm">
        {saving
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
          : <><Check className="w-4 h-4" /> Add {total} to {pet.name}</>}
      </button>
    </div>
  )
}

// ── The screen ───────────────────────────────────────────────────────────────

export default function VoiceUpdate({ pet, onClose, onSaved }) {
  const [mode, setMode]   = useState('type')   // 'speak' | 'type'
  const [text, setText]   = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed]   = useState(null)
  const [error, setError]     = useState(null)

  // Appending, not replacing: a second recording should add to what is already
  // in the box — people remember the follow-up date after they stop talking.
  const append = chunk => {
    const t = (chunk || '').trim()
    if (!t) return
    setText(prev => (prev.trim() ? `${prev.trim()} ${t}` : t))
  }

  const voice = useVoiceRecorder(append, 'auto')

  async function parse() {
    if (!text.trim()) return
    setParsing(true); setError(null)
    try {
      // Only the profile fields the prompt uses are sent — this is context for
      // resolving "he" and picking sensible categories, not the pet's records.
      setParsed(await aiComplete('voice_update', {
        transcript: text.trim(),
        pet: {
          name: pet.name, species: pet.species, breed: pet.breed,
          gender: pet.gender, dob: pet.dob, weight: pet.weight,
        },
      }))
    } catch (e) { setError(e.message) }
    finally { setParsing(false) }
  }

  const busy = voice.listening || voice.transcribing || parsing

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-lg rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '92vh' }}>

        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #ebe3d3' }}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" style={{ color: '#c9891f' }} />
            <span className="font-black" style={{ color: '#7a4900' }}>
              What's new with {pet.name}?
            </span>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>
            <X className="w-5 h-5" style={{ color: '#73775b' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {parsed ? (
            <Review parsed={parsed} pet={pet} onBack={() => setParsed(null)} onSaved={onSaved} />
          ) : (
            <>
              <p className="text-sm" style={{ color: '#73775b' }}>
                A vet visit, a new medicine, a weight, a bill, something you noticed.
                Say it however you'd say it to a friend — Pippy files it in the right places.
              </p>

              <VoicePanel
                voice={voice} mode={mode} onModeChange={setMode}
                text={text} onTextChange={setText}
                placeholder={EXAMPLE} parsing={parsing} />

              {error && (
                <p className="text-sm p-3 rounded-xl flex items-start gap-2"
                  style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
                </p>
              )}

              <button type="button" onClick={parse} disabled={!text.trim() || busy}
                className="btn-primary w-full gap-2 text-sm">
                {parsing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading it…</>
                  : <><Sparkles className="w-4 h-4" /> Continue</>}
              </button>
              <p className="text-[11px] text-center" style={{ color: '#a08f7a' }}>
                You'll see everything before anything is saved.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
