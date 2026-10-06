import { useState } from 'react'
import {
  Loader2, X, Check, AlertCircle, Sparkles,
  ChevronLeft, PawPrint, Syringe, Pill, AlertTriangle, Camera,
} from 'lucide-react'
import { aiComplete } from '../lib/ai.js'
import { useVoiceRecorder } from '../lib/useVoiceRecorder.js'
import { voiceLikelyAvailable } from '../lib/speech.js'
import VoicePanel from './VoicePanel.jsx'
import { savePet, saveVaccination, saveMedicine, saveAllergy } from '../lib/storage.js'
import { announcePetAdded } from '../lib/notify.js'
import { saveCondition } from '../lib/conditions.js'
import { trackEvent } from '../lib/analytics.js'
import { reportHandled } from '../lib/errorReport.js'

// Onboarding someone who already has a pet and a folder of vet papers. They
// will not scan twenty documents to get started, but many of them know the
// history by heart — so let them say it or type it.
//
// SPEECH ALWAYS LANDS IN THE TEXTAREA. Stopping the recording never parses on
// its own. Indian names, breeds and drug names are exactly what transcription
// gets wrong, and exactly the fields we would otherwise save wrong: "Bruno"
// becomes "Bruna", "Nobivac" becomes "no bee back". A mishearing caught in the
// box costs one edit; caught on the review screen it costs a fiddlier
// correction; missed entirely it becomes bad data in a record shown to a vet.
//
// Both paths therefore converge on one textarea, one parse call, one review
// screen and one save path.

// See the note on the same constants in Reminders.jsx. 1200 bytes is roughly
// four seconds of Opus-compressed SILENCE, not an empty container, so it was
// rejecting short quiet recordings before Whisper could judge them.
const MIN_BYTES = 200
const MIN_MS    = 400

const SPECIES  = ['Dog', 'Cat', 'Bird', 'Rabbit', 'Hamster', 'Fish', 'Reptile', 'Other']
const GENDERS  = ['Male', 'Female', 'Unknown']

const EXAMPLE = "Bruno is a 6 year old beagle, brown and white, about 19 kilos. He had his rabies shot in March and is due again next March. He's on Simparica monthly for ticks. He's allergic to chicken — comes up in a rash."

// ── Review row ───────────────────────────────────────────────────────────────

function Row({ checked, onToggle, icon: Icon, title, detail, color }) {
  return (
    <label className="flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer"
      style={{ backgroundColor: checked ? '#fff9e0' : '#f4f1ea' }}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5" />
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: color || '#c9891f' }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold" style={{ color: '#7a4900' }}>{title}</p>
        {detail && <p className="text-xs" style={{ color: '#73775b' }}>{detail}</p>}
      </div>
    </label>
  )
}

// ── Review screen: the AI proposes, the human confirms ───────────────────────

function Review({ parsed, onBack, onSaved }) {
  // Everything starts ticked; dropping a wrong row is one tap, and nothing is
  // saved until the button is pressed.
  const [picked, setPicked] = useState(() => {
    const m = {}
    parsed.pets?.forEach((p, i) => {
      m[`pet-${i}`] = true
      p.vaccinations?.forEach((_, j) => { m[`vac-${i}-${j}`] = true })
      p.medicines?.forEach((_, j)    => { m[`med-${i}-${j}`] = true })
      p.allergies?.forEach((_, j)    => { m[`alg-${i}-${j}`] = true })
      p.conditions?.forEach((_, j)   => { m[`con-${i}-${j}`] = true })
    })
    return m
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const [done, setDone]     = useState(null)

  const toggle = k => setPicked(p => ({ ...p, [k]: !p[k] }))

  async function save() {
    setSaving(true); setError(null)
    const summary = { pets: 0, vaccinations: 0, medicines: 0, allergies: 0, conditions: 0 }
    try {
      for (let i = 0; i < (parsed.pets || []).length; i++) {
        if (!picked[`pet-${i}`]) continue
        const p = parsed.pets[i]

        // The pet must exist before anything can point at it — same id-mapping
        // shape MigrateData uses.
        const saved = await savePet({
          name: p.name, species: p.species || 'Dog', breed: p.breed || '',
          gender: p.gender || '', dob: p.dob || '', weight: p.weight ?? '',
          color: p.color || '', notes: p.notes || '',
        })
        summary.pets++
        // This screen creates pets too, so it announces them as well —
        // otherwise a pet added by voice would never be reported.
        announcePetAdded(saved?.id)
        trackEvent('pet_added', { species: saved?.species || '', method: 'voice' })

        for (let j = 0; j < (p.vaccinations || []).length; j++) {
          if (!picked[`vac-${i}-${j}`]) continue
          const v = p.vaccinations[j]
          await saveVaccination({ petId: saved.id, name: v.name, dateGiven: v.dateGiven || '', nextDue: v.nextDue || '' })
          summary.vaccinations++
        }
        for (let j = 0; j < (p.medicines || []).length; j++) {
          if (!picked[`med-${i}-${j}`]) continue
          const m = p.medicines[j]
          await saveMedicine({ petId: saved.id, name: m.name, dosage: m.dosage || '', frequency: m.frequency || '', category: m.category || 'Other' })
          summary.medicines++
        }
        for (let j = 0; j < (p.allergies || []).length; j++) {
          if (!picked[`alg-${i}-${j}`]) continue
          const a = p.allergies[j]
          // reactions is an array column — a single reaction is still an array.
          await saveAllergy({
            petId: saved.id, allergen: a.allergen, type: a.type || 'Other',
            severity: a.severity || 'Mild',
            reactions: Array.isArray(a.reactions) ? a.reactions : (a.reactions ? [a.reactions] : []),
          })
          summary.allergies++
        }
        for (let j = 0; j < (p.conditions || []).length; j++) {
          if (!picked[`con-${i}-${j}`]) continue
          const c = p.conditions[j]
          try {
            await saveCondition({ petId: saved.id, title: c.title, startedOn: c.date || undefined, notes: c.notes || '', status: 'active' })
            summary.conditions++
          } catch { /* the journal needs the cloud; a local-only user still gets the pet */ }
        }
      }
      setDone(summary)
      onSaved?.(summary)
    } catch (e) {
      // The raw text is still held by the parent, so nothing is lost.
      reportHandled(e, { view: 'voice-intake' })
      setError(`${e.message} — nothing above was lost, you can try saving again.`)
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="text-center py-8 px-4 rounded-2xl" style={{ backgroundColor: '#eef3e2' }}>
        <Check className="w-8 h-8 mx-auto mb-2" style={{ color: '#44562a' }} />
        <p className="font-black" style={{ color: '#44562a' }}>
          Saved {done.pets} {done.pets === 1 ? 'pet' : 'pets'}
        </p>
        <p className="text-sm mt-1" style={{ color: '#44562a' }}>
          {[
            done.vaccinations && `${done.vaccinations} vaccination${done.vaccinations === 1 ? '' : 's'}`,
            done.medicines && `${done.medicines} medicine${done.medicines === 1 ? '' : 's'}`,
            done.allergies && `${done.allergies} allerg${done.allergies === 1 ? 'y' : 'ies'}`,
            done.conditions && `${done.conditions} condition${done.conditions === 1 ? '' : 's'}`,
          ].filter(Boolean).join(' · ') || 'Profile only — add records whenever you like.'}
        </p>
      </div>
    )
  }

  const pets = parsed.pets || []

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} disabled={saving}
        className="flex items-center gap-1 text-sm font-bold" style={{ color: '#7a4900' }}>
        <ChevronLeft className="w-4 h-4" /> Back to the text
      </button>

      <div className="p-3 rounded-xl text-sm" style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
        <strong>Check this before saving.</strong> Untick anything that isn't right —
        nothing is saved until you press the button.
      </div>

      {pets.length === 0 && (
        <p className="text-sm p-3 rounded-xl" style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          No pets could be picked out of that. Go back and try adding a name and species.
        </p>
      )}

      {pets.map((p, i) => (
        <div key={i} className="rounded-2xl p-3 space-y-2"
          style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>
          <Row checked={!!picked[`pet-${i}`]} onToggle={() => toggle(`pet-${i}`)}
            icon={PawPrint} title={p.name || '(no name given)'}
            detail={[p.species, p.breed, p.gender, p.dob && `born ${p.dob}`,
                     p.weight && `${p.weight} kg`, p.color].filter(Boolean).join(' · ') || 'No details'} />

          {p.notes && (
            <p className="text-xs italic px-2" style={{ color: '#73775b' }}>“{p.notes}”</p>
          )}

          {(p.vaccinations || []).map((v, j) => (
            <Row key={`v${j}`} checked={!!picked[`vac-${i}-${j}`]} onToggle={() => toggle(`vac-${i}-${j}`)}
              icon={Syringe} color="#2f7286" title={v.name}
              detail={[v.dateGiven && `given ${v.dateGiven}`, v.nextDue && `next ${v.nextDue}`].filter(Boolean).join(' · ') || 'No dates given'} />
          ))}
          {(p.medicines || []).map((m, j) => (
            <Row key={`m${j}`} checked={!!picked[`med-${i}-${j}`]} onToggle={() => toggle(`med-${i}-${j}`)}
              icon={Pill} color="#7a5c9e" title={m.name}
              detail={[m.dosage, m.frequency, m.category].filter(Boolean).join(' · ')} />
          ))}
          {(p.allergies || []).map((a, j) => (
            <Row key={`a${j}`} checked={!!picked[`alg-${i}-${j}`]} onToggle={() => toggle(`alg-${i}-${j}`)}
              icon={AlertTriangle} color="#c0392b" title={a.allergen}
              detail={[a.type, a.severity, (a.reactions || []).join(', ')].filter(Boolean).join(' · ')} />
          ))}
          {(p.conditions || []).map((c, j) => (
            <Row key={`c${j}`} checked={!!picked[`con-${i}-${j}`]} onToggle={() => toggle(`con-${i}-${j}`)}
              icon={Camera} color="#b2566f" title={c.title}
              detail={[c.date, c.notes].filter(Boolean).join(' · ')} />
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

      <button type="button" onClick={save} disabled={saving || pets.length === 0}
        className="btn-primary w-full gap-2 text-sm">
        {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Check className="w-4 h-4" /> Save these</>}
      </button>
    </div>
  )
}

// ── The screen ───────────────────────────────────────────────────────────────

export default function VoiceIntake({ onClose, onSaved }) {
  // Opens on Speak. This screen exists because talking is faster than typing,
  // so making the user pick "Speak" first was a tap spent asking whether they
  // meant what they had just opened. Typing is one tap away and still a
  // first-class mode; a device that cannot record opens on it instead.
  const [mode, setMode] = useState(() => (voiceLikelyAvailable() ? 'speak' : 'type'))
  const [text, setText]     = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState(null)
  const [error, setError]   = useState(null)

  // Appending, not replacing: recording again should add a second pet to what
  // is already in the box, not wipe it.
  const append = chunk => {
    const t = (chunk || '').trim()
    if (!t) return
    setText(prev => (prev.trim() ? `${prev.trim()} ${t}` : t))
  }

  // The microphone lives in one place for the whole app — see
  // src/lib/useVoiceRecorder.js. This screen used to hold its own copy, which
  // had drifted far enough to call two helpers it never imported.
  const voice = useVoiceRecorder(append, 'auto', 'voice-intake')

  async function parse() {
    if (!text.trim()) return
    setParsing(true); setError(null)
    try {
      setParsed(await aiComplete('voice_intake', { transcript: text.trim() }))
      // That the screen was used, and by which route. Never the transcript.
      trackEvent('voice_intake_used', { mode })
    } catch (e) { reportHandled(e, { view: 'voice-intake' }); setError(e.message) }
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
            <span className="font-black" style={{ color: '#7a4900' }}>Tell us about your pets</span>
          </div>
          <button type="button" onClick={onClose} disabled={busy}><X className="w-5 h-5" style={{ color: '#73775b' }} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {parsed ? (
            <Review parsed={parsed} onBack={() => setParsed(null)} onSaved={onSaved} />
          ) : (
            <>
              <p className="text-sm" style={{ color: '#73775b' }}>
                Names, ages, breeds, and any vaccinations, medicines or allergies you remember.
                It's fine to be vague, and fine to leave things out — you can add the rest later.
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

              <button type="button" onClick={parse} disabled={!text.trim() || busy} className="btn-primary w-full gap-2 text-sm">
                {parsing ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading it…</> : <><Sparkles className="w-4 h-4" /> Continue</>}
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
