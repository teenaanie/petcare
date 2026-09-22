import { useState, useEffect, useRef } from 'react'
import {
  Mic, MicOff, Keyboard, Loader2, X, Check, AlertCircle, Sparkles,
  ChevronLeft, PawPrint, Syringe, Pill, AlertTriangle, Camera,
} from 'lucide-react'
import { aiComplete, transcribeAudio } from '../lib/ai.js'
import {
  startWebSpeech, webSpeechSupported, webSpeechEnabled, webSpeechLangFor,
} from '../lib/speech.js'
import { savePet, saveVaccination, saveMedicine, saveAllergy } from '../lib/storage.js'
import { saveCondition } from '../lib/conditions.js'

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
  const [mode, setMode]       = useState('type')   // 'speak' | 'type'
  const [text, setText]       = useState('')
  const [partial, setPartial] = useState('')
  const [listening, setListening]   = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed]   = useState(null)
  const [error, setError]     = useState(null)
  const [micDenied, setMicDenied] = useState(false)

  const recRef    = useRef(null)
  const speechRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const startRef  = useRef(0)

  function release() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }
  useEffect(() => () => { speechRef.current?.abort(); release() }, [])

  // Appending, not replacing: recording again should add a second pet to what
  // is already in the box, not wipe it.
  const append = chunk => {
    const t = (chunk || '').trim()
    if (!t) return
    setText(prev => (prev.trim() ? `${prev.trim()} ${t}` : t))
  }

  async function startRecording() {
    setError(null); setPartial('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType })
      recRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      rec.onstop = async () => {
        release()
        const elapsed = Date.now() - startRef.current
        const blob = new Blob(chunksRef.current, { type: mimeType })

        // Whatever the browser heard, first — free and already finished.
        let web = { text: '' }
        if (speechRef.current) {
          speechRef.current.stop()
          web = await speechRef.current.result
          speechRef.current = null
        }
        setPartial('')

        // Not treated as a denial: getUserMedia had already succeeded, so the
        // microphone is allowed. Recognition says 'not-allowed' when the
        // browser's speech service is blocked, which is Whisper's cue, not a
        // reason to switch the user to typing and bin their recording.
        if (web.denied) {
          console.warn('Speech recognition reported not-allowed; using Whisper for this recording.')
        }
        if (web.text) { append(web.text); return }

        if (!chunksRef.current.length || blob.size < MIN_BYTES || elapsed < MIN_MS) {
          setError('That recording came through empty — check which microphone is selected, or type it instead.')
          return
        }

        // Whisper fills the same box, so the user cannot tell which ran.
        setTranscribing(true)
        try { append(await transcribeAudio(blob)) }
        catch (e) { setError(`${e.message} You can type it instead.`) }
        finally { setTranscribing(false) }
      }

      // Partials are shown separately and never written into the box — a
      // mid-sentence pause would otherwise scramble what the user is editing.
      const bcp47 = webSpeechLangFor('auto')
      speechRef.current = (webSpeechSupported() && webSpeechEnabled() && bcp47)
        ? startWebSpeech({ lang: bcp47, onPartial: setPartial })
        : null

      rec.start(250)
      startRef.current = Date.now()
      setListening(true)
    } catch (e) {
      release()
      setMicDenied(true); setMode('type')
      setError(e.name === 'NotAllowedError'
        ? 'Microphone access was refused, so I switched to typing. Everything works the same from here.'
        : `Could not start the microphone (${e.message}). Type it instead.`)
    }
  }

  function stopRecording() {
    if (recRef.current?.state === 'recording') recRef.current.stop()
    else { speechRef.current?.abort(); speechRef.current = null; release() }
    setListening(false)
  }

  async function parse() {
    if (!text.trim()) return
    setParsing(true); setError(null)
    try {
      setParsed(await aiComplete('voice_intake', { transcript: text.trim() }))
    } catch (e) { setError(e.message) }
    finally { setParsing(false) }
  }

  const busy = listening || transcribing || parsing

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

              {/* Both modes are first-class. Typing is not a fallback: it is
                  better in a quiet office, on a poor mic, or when the details
                  are already in a WhatsApp message to paste. */}
              <div className="flex gap-2">
                {[['speak', 'Speak', Mic], ['type', 'Type or paste', Keyboard]].map(([id, label, Icon]) => (
                  <button type="button" key={id} onClick={() => setMode(id)} disabled={busy || (id === 'speak' && micDenied)}
                    className="flex-1 text-sm font-bold px-3 py-2 rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-50"
                    style={mode === id
                      ? { backgroundColor: '#f2b83d', color: '#7a4900' }
                      : { backgroundColor: '#ebe3d3', color: '#7a4900' }}>
                    <Icon className="w-4 h-4" /> {label}
                  </button>
                ))}
              </div>

              {mode === 'speak' && !micDenied && (
                <div className="flex flex-col items-center gap-2 py-2">
                  <button type="button" onClick={listening ? stopRecording : startRecording} disabled={transcribing}
                    className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg ${listening ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: listening ? '#c0392b' : '#c9891f' }}>
                    {transcribing ? <Loader2 className="w-7 h-7 text-white animate-spin" />
                      : listening ? <MicOff className="w-7 h-7 text-white" />
                      : <Mic className="w-7 h-7 text-white" />}
                  </button>
                  <p className="text-xs font-bold" style={{ color: '#7a4900' }}>
                    {transcribing ? 'Writing it down…' : listening ? 'Listening — tap to stop' : 'Tap and start talking'}
                  </p>
                  {partial && (
                    <p className="text-xs italic text-center px-3" style={{ color: '#a08f7a' }}>“{partial}”</p>
                  )}
                  <p className="text-[11px] text-center" style={{ color: '#a08f7a' }}>
                    What you say lands in the box below — read it over and fix anything misheard before continuing.
                  </p>
                </div>
              )}

              <textarea
                className="input w-full text-sm" rows={mode === 'speak' ? 6 : 9}
                placeholder={EXAMPLE}
                value={text} onChange={e => setText(e.target.value)} disabled={listening} />

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
