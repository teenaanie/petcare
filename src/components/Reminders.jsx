import { useEffect, useState, useRef } from 'react'
import { Plus, Trash2, Bell, BellOff, BellRing, Mail, MessageCircle, CheckCircle, AlertCircle, Loader2, Mic, MicOff, Wand2, X, Check } from 'lucide-react'
import { getReminders, saveReminder, deleteReminder, markReminderDone } from '../lib/storage.js'
import { pushSupported, getPushSubscriptionStatus, subscribeToPush, unsubscribeFromPush } from '../lib/push.js'
import { format } from 'date-fns'
import { aiComplete, transcribeAudio } from '../lib/ai.js'

// Whisper decodes better when told the language than when left to guess, and it
// mis-detects Hinglish in particular. 'auto' stays the default because forcing
// the wrong language is worse than detecting — this is a decode instruction,
// not a hint.
const VOICE_LANGS = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'en',   label: 'English' },
  { code: 'hi',   label: 'हिन्दी / Hinglish' },
  { code: 'mr',   label: 'मराठी' },
  { code: 'ta',   label: 'தமிழ்' },
  { code: 'te',   label: 'తెలుగు' },
  { code: 'kn',   label: 'ಕನ್ನಡ' },
  { code: 'ml',   label: 'മലയാളം' },
  { code: 'bn',   label: 'বাংলা' },
  { code: 'gu',   label: 'ગુજરાતી' },
  { code: 'pa',   label: 'ਪੰਜਾਬੀ' },
]
const LANG_KEY = 'pippy_voice_lang'

const TYPES = ['Vaccination', 'Grooming', 'Vet Checkup', 'Medication', 'Boarding', 'Other']
const FREQ  = ['Once', 'Weekly', 'Monthly', 'Yearly']

// ── EmailJS ───────────────────────────────────────────────────────────────────
async function sendEmail({ toEmail, toName, petName, reminderType, dueDate, notes }) {
  const serviceId  = import.meta.env.VITE_EMAILJS_SERVICE_ID
  const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
  const publicKey  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY
  if (!serviceId || !templateId || !publicKey) throw new Error('EmailJS not configured.')
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId, template_id: templateId, user_id: publicKey,
      template_params: { to_name: toName, to_email: toEmail, pet_name: petName, reminder_type: reminderType, due_date: dueDate, notes: notes || '' }
    })
  })
  if (!res.ok) throw new Error('Failed to send email.')
}

// ── Parse voice transcript ───────────────────────────────────────────────────
// The extraction prompt is composed server-side, in
// netlify/functions/ai-complete.js, next to the API key.
async function parseVoiceReminder(transcript) {
  return aiComplete('voice_reminder', { transcript })
}

// ── Voice recording hook (MediaRecorder → /api/transcribe) ───────────────────
//
// Opus in the browser produces roughly 15 KB per second of audio. Measured in
// Chrome: a 1.0s clip is ~15,600 bytes, a 2.5s clip ~38,000. That matters,
// because this hook used to reject anything under 1.5 SECONDS — throwing away
// a perfectly good 15 KB recording and telling the user "tap the mic, speak,
// then tap again to stop", which is exactly what they had just done.
//
// Duration is the wrong test. Whether a clip contains intelligible speech is
// Whisper's call, and the server already answers "Couldn't hear anything" when
// the transcript comes back empty. All this needs to catch is a capture that is
// genuinely empty — no chunks, or a bare container header with no audio in it.

const MIN_BYTES  = 1200        // a webm/mp4 header with no audio is smaller than this
const MIN_MS     = 400         // a tap, not an utterance
const MAX_MS     = 120_000     // stop before the upload hits the server's size cap

function useVoiceRecorder(onTranscript, language) {
  const [listening, setListening]       = useState(false)
  const [transcript, setTranscript]     = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError]               = useState(null)
  const [elapsedMs, setElapsedMs]       = useState(0)
  const mediaRecorderRef                = useRef(null)
  const streamRef                       = useRef(null)
  const chunksRef                       = useRef([])
  const startTimeRef                    = useRef(null)
  const readyRef                        = useRef(false)   // true once recorder is recording
  const tickRef                         = useRef(null)
  const autoStopRef                     = useRef(null)
  const languageRef                     = useRef(language)
  languageRef.current                   = language

  function clearTimers() {
    clearInterval(tickRef.current);   tickRef.current = null
    clearTimeout(autoStopRef.current); autoStopRef.current = null
  }

  // Releasing the microphone is not optional. Without this, closing the voice
  // panel mid-recording leaves the mic live and the browser's recording
  // indicator on, with nothing in the UI to explain why.
  function releaseMic() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  useEffect(() => () => { clearTimers(); releaseMic() }, [])

  async function start() {
    if (listening) { stop(); return }   // tap-to-toggle: second tap = stop
    setError(null)
    setTranscript('')
    setElapsedMs(0)
    chunksRef.current = []
    readyRef.current  = false

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access requires HTTPS. Open the app via https:// or use localhost.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      if (!stream.getAudioTracks().length) {
        releaseMic()
        throw new Error('No microphone was found. Check that one is connected and selected.')
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        clearTimers()
        releaseMic()
        const elapsed = Date.now() - (startTimeRef.current || 0)
        const blob    = new Blob(chunksRef.current, { type: mimeType })

        // Only a genuinely empty capture is rejected here. Everything that has
        // audio in it goes to Whisper, which is better at judging it than a
        // byte count is.
        if (!chunksRef.current.length || blob.size < MIN_BYTES) {
          setError("Didn't catch any audio — check the microphone permission in your browser's address bar, then try again.")
          return
        }
        if (elapsed < MIN_MS) {
          setError('That was a tap rather than a recording — hold on while you speak, then tap again.')
          return
        }

        setTranscribing(true)
        try {
          // Goes to our own endpoint, which holds the key and calls Whisper.
          // No language lock there — Whisper auto-detects, which handles Indian
          // English and mixed speech.
          const text = (await transcribeAudio(blob, undefined, languageRef.current))?.trim()
          setTranscript(text)
          if (text) onTranscript(text)
          else setError('No speech detected — please try again.')
        } catch (e) {
          setError(e.message)
        } finally {
          setTranscribing(false)
        }
      }

      recorder.start(250)   // collect data every 250 ms
      startTimeRef.current = Date.now()
      readyRef.current     = true
      setListening(true)

      // Show the user that something is being captured. Without this the only
      // feedback is a pulsing button, which looks the same whether the
      // microphone is working or muted.
      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - (startTimeRef.current || 0))
      }, 200)

      // A forgotten recording would otherwise grow until the server rejects it.
      autoStopRef.current = setTimeout(() => {
        setError('Stopped after 2 minutes — that is the longest note we can send.')
        stop()
      }, MAX_MS)
    } catch (e) {
      clearTimers()
      releaseMic()
      if (e.name === 'NotAllowedError') {
        setError('Microphone access denied. Allow it for this site in your browser settings, then try again.')
      } else if (e.name === 'NotFoundError') {
        setError('No microphone was found. Check that one is connected and selected.')
      } else {
        setError(`Could not start recording: ${e.message}`)
      }
    }
  }

  function stop() {
    clearTimers()
    if (readyRef.current && mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()   // onstop releases the mic
    } else {
      releaseMic()
    }
    readyRef.current = false
    setListening(false)
  }

  return { listening, transcribing, transcript, error, elapsedMs, start, stop }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Reminders({ pet }) {
  const [reminders, setReminders]   = useState([])
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState({ type: 'Vaccination', dueDate: '', frequency: 'Once', email: '', whatsapp: '', notes: '' })
  const [sending, setSending]       = useState({})
  const [sentStatus, setSentStatus] = useState({})
  const [togglingId, setTogglingId] = useState(null)

  // Voice AI state
  const [voiceMode, setVoiceMode]       = useState(false)  // is voice panel open
  const [voiceLang, setVoiceLang]       = useState(() => {
    try { return localStorage.getItem(LANG_KEY) || 'auto' } catch { return 'auto' }
  })
  const [aiParsing, setAiParsing]       = useState(false)
  const [voiceError, setVoiceError]     = useState(null)
  const [parsedPreview, setParsedPreview] = useState(null) // AI-parsed form values

  // Push notification opt-in
  const [pushStatus, setPushStatus]   = useState('checking') // checking | unsupported | denied | unsubscribed | subscribed
  const [pushBusy, setPushBusy]       = useState(false)
  const [pushError, setPushError]     = useState(null)

  function loadPushStatus() {
    if (!pushSupported) { setPushStatus('unsupported'); return }
    getPushSubscriptionStatus().then(setPushStatus).catch(() => setPushStatus('unsubscribed'))
  }
  useEffect(loadPushStatus, [])

  async function handleTogglePush() {
    setPushBusy(true)
    setPushError(null)
    try {
      if (pushStatus === 'subscribed') {
        await unsubscribeFromPush()
        setPushStatus('unsubscribed')
      } else {
        await subscribeToPush()
        setPushStatus('subscribed')
      }
    } catch (e) {
      setPushError(e.message)
    } finally {
      setPushBusy(false)
    }
  }

  function load() { getReminders(pet.id).then(setReminders).catch(console.error) }
  useEffect(load, [pet.id])

  async function handleSubmit(e) {
    e.preventDefault()
    await saveReminder({ ...form, petId: pet.id })
    setForm({ type: 'Vaccination', dueDate: '', frequency: 'Once', email: '', whatsapp: '', notes: '' })
    setShowForm(false)
    setParsedPreview(null)
    load()
  }

  async function handleDelete(id) {
    if (confirm('Delete this reminder?')) { await deleteReminder(id); load() }
  }

  async function handleToggleDone(r) {
    setTogglingId(r.id)
    try {
      await markReminderDone(r.id, !r.isDone)
      load()
    } catch (e) {
      if (e.message?.includes('column') || e.code === '42703') {
        alert('Please run this SQL in your Supabase SQL Editor first:\n\nALTER TABLE vaccinations ADD COLUMN IF NOT EXISTS is_done boolean DEFAULT false;\nALTER TABLE reminders ADD COLUMN IF NOT EXISTS is_done boolean DEFAULT false;')
      } else {
        alert('Failed to update: ' + e.message)
      }
    } finally {
      setTogglingId(null)
    }
  }

  async function handleSendEmail(reminder) {
    setSending(s => ({ ...s, [reminder.id]: true }))
    setSentStatus(s => ({ ...s, [reminder.id]: null }))
    try {
      await sendEmail({
        toEmail: reminder.email, toName: 'Pet Owner', petName: pet.name,
        reminderType: reminder.type,
        dueDate: reminder.dueDate ? format(new Date(reminder.dueDate), 'MMMM d, yyyy') : 'soon',
        notes: reminder.notes,
      })
      setSentStatus(s => ({ ...s, [reminder.id]: 'success' }))
    } catch (e) {
      setSentStatus(s => ({ ...s, [reminder.id]: e.message }))
    } finally {
      setSending(s => ({ ...s, [reminder.id]: false }))
    }
  }

  function handleWhatsApp(reminder) {
    const text = encodeURIComponent(
      `🐾 *${pet.name}'s Reminder*\n\n*Type:* ${reminder.type}\n*Due:* ${reminder.dueDate ? format(new Date(reminder.dueDate), 'MMMM d, yyyy') : 'soon'}\n${reminder.notes ? `*Notes:* ${reminder.notes}` : ''}`
    )
    window.open(`https://wa.me/${reminder.whatsapp.replace(/\D/g, '')}?text=${text}`, '_blank')
  }

  // Called when speech recognition finishes
  async function handleTranscript(text) {
    if (!text.trim()) return
    setAiParsing(true)
    setVoiceError(null)
    try {
      const parsed = await parseVoiceReminder(text)
      setParsedPreview(parsed)
      // Pre-fill the form
      setForm(f => ({
        ...f,
        type:      parsed.type      || f.type,
        dueDate:   parsed.dueDate   || f.dueDate,
        frequency: parsed.frequency || f.frequency,
        notes:     parsed.notes     || f.notes,
      }))
      setShowForm(true)
      setVoiceMode(false)
    } catch (e) {
      setVoiceError(e.message)
    } finally {
      setAiParsing(false)
    }
  }

  const voice = useVoiceRecorder(handleTranscript, voiceLang)
  const emailConfigured = import.meta.env.VITE_EMAILJS_SERVICE_ID

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">Reminders</h2>
        <div className="flex gap-2">
          {/* Push notification toggle */}
          {pushStatus !== 'unsupported' && (
            <button
              onClick={handleTogglePush}
              disabled={pushBusy || pushStatus === 'denied' || pushStatus === 'checking'}
              title={pushStatus === 'denied' ? 'Notifications blocked — enable them in your browser settings' : pushStatus === 'subscribed' ? 'Turn off push notifications' : 'Turn on push notifications'}
              className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 ${
                pushStatus === 'subscribed' ? 'bg-primary-600 text-white border-primary-600' : 'btn-secondary'
              }`}
            >
              {pushBusy
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : pushStatus === 'subscribed'
                ? <BellRing className="w-4 h-4" />
                : <BellOff className="w-4 h-4" />}
            </button>
          )}
          {/* Voice button */}
          <button
            onClick={() => { if (voice.listening) voice.stop(); setVoiceMode(v => !v); setShowForm(false) }}
            className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors ${
              voiceMode ? 'bg-primary-600 text-white border-primary-600' : 'btn-secondary'
            }`}
            title="Set reminder by voice"
          >
            <Mic className="w-4 h-4" /> Voice
          </button>
          <button
            onClick={() => { setShowForm(s => !s); setVoiceMode(false); setParsedPreview(null) }}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" /> Add Reminder
          </button>
        </div>
      </div>

      {/* ── Voice panel ─────────────────────────────────────────────────── */}
      {voiceMode && (
        <div className="card mb-4 border-primary-200 border bg-primary-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-primary-900">Set reminder by voice</h3>
            <button onClick={() => { if (voice.listening) voice.stop(); setVoiceMode(false) }} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-sm text-primary-700 mb-4">
            Say something like: <span className="italic">"Remind me to groom {pet.name} next Saturday"</span> or <span className="italic">"Set a vaccination reminder for March 15"</span>
          </p>

          <div className="flex items-center justify-center gap-2 mb-4">
            <label className="text-xs font-bold" style={{ color: '#73775b' }}>Language</label>
            <select
              className="input text-xs py-1 w-auto"
              value={voiceLang}
              onChange={e => {
                setVoiceLang(e.target.value)
                try { localStorage.setItem(LANG_KEY, e.target.value) } catch { /* private mode */ }
              }}
              disabled={voice.listening || voice.transcribing}
            >
              {VOICE_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>

          {/* Mic button */}
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={voice.start}
              disabled={voice.transcribing || aiParsing}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg select-none ${
                voice.listening
                  ? 'bg-red-500 scale-110 animate-pulse'
                  : voice.transcribing || aiParsing
                  ? 'bg-gray-400'
                  : 'bg-primary-600 hover:bg-primary-700 active:scale-95'
              }`}
            >
              {voice.transcribing || aiParsing
                ? <Loader2 className="w-8 h-8 text-white animate-spin" />
                : voice.listening
                ? <MicOff className="w-8 h-8 text-white" />
                : <Mic className="w-8 h-8 text-white" />}
            </button>

            <p className="text-sm font-medium text-primary-800 text-center">
              {voice.transcribing ? 'Transcribing...'
                : aiParsing ? 'AI is understanding your request...'
                : voice.listening ? `Listening… ${(voice.elapsedMs / 1000).toFixed(1)}s — tap again to stop`
                : 'Tap to start speaking'}
            </p>

            {voice.transcript && !aiParsing && (
              <div className="w-full bg-white rounded-lg px-4 py-3 text-sm text-gray-700 border border-primary-200">
                <p className="text-xs text-gray-400 mb-1">Heard:</p>
                <p className="italic">"{voice.transcript}"</p>
              </div>
            )}

            {(voice.error || voiceError) && (
              <div className="w-full p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {voice.error || voiceError}
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── AI-parsed preview banner ─────────────────────────────────────── */}
      {parsedPreview && showForm && (
        <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-sm text-green-800">
          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
          AI filled in the details from your voice — review and save below.
        </div>
      )}

      {pushError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {pushError}
        </div>
      )}
      {!emailConfigured && (
        <div className="mb-4 p-3 rounded-xl text-sm" style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
          <strong>Email reminders are off.</strong> WhatsApp reminders work now — use the
          WhatsApp button on any reminder. You'll also get a daily email each morning
          for anything due that day.
        </div>
      )}

      {/* ── Manual form ─────────────────────────────────────────────────── */}
      {showForm && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{parsedPreview ? 'Review & Save' : 'New Reminder'}</h3>
            <button onClick={() => { setShowForm(false); setParsedPreview(null) }} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Type *</label>
              <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))} className="input">
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Due Date *</label>
              <input type="date" value={form.dueDate} onChange={e => setForm(f => ({...f, dueDate: e.target.value}))} className="input" required />
            </div>
            <div>
              <label className="label">Frequency</label>
              <select value={form.frequency} onChange={e => setForm(f => ({...f, frequency: e.target.value}))} className="input">
                {FREQ.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Email Address</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} className="input" placeholder="you@example.com" />
            </div>
            <div>
              <label className="label">WhatsApp Number</label>
              <input value={form.whatsapp} onChange={e => setForm(f => ({...f, whatsapp: e.target.value}))} className="input" placeholder="+1 555 0000 (with country code)" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} className="input" rows={2} placeholder="Any additional details..." />
            </div>
            <div className="sm:col-span-2 flex justify-end gap-3">
              <button type="button" onClick={() => { setShowForm(false); setParsedPreview(null) }} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Save Reminder</button>
            </div>
          </form>
        </div>
      )}

      {reminders.length === 0 && !showForm && !voiceMode && (
        <div className="card flex flex-col items-center py-12 text-center text-gray-400">
          <Bell className="w-10 h-10 mb-3 opacity-40" />
          <p className="font-medium">No reminders set</p>
          <p className="text-sm mt-1">Add reminders manually or tap <strong>Voice</strong> to speak one.</p>
        </div>
      )}

      {/* ── Reminder cards ───────────────────────────────────────────────── */}
      <div className="space-y-3">
        {reminders.sort((a, b) => {
          // Pending first (sorted by due date asc), done at bottom
          if (a.isDone !== b.isDone) return a.isDone ? 1 : -1
          const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
          const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
          return da - db
        }).map(r => (
          <div key={r.id} className={`card group transition-opacity ${r.isDone ? 'opacity-60' : ''}`}>
            <div className="flex justify-between items-start mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {r.isDone
                    ? <CheckCircle className="w-4 h-4 text-green-500" />
                    : <Bell className="w-4 h-4 text-primary-500" />}
                  <span className={`font-semibold ${r.isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>{r.type}</span>
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{r.frequency}</span>
                  {r.isDone && (
                    <span className="text-xs px-2 py-0.5 rounded-full text-green-600 bg-green-50 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Done
                    </span>
                  )}
                </div>
                {r.dueDate && <p className="text-sm text-gray-400 mt-0.5">Due: {format(new Date(r.dueDate), 'MMMM d, yyyy')}</p>}
                {r.notes && <p className="text-sm text-gray-600 mt-1">{r.notes}</p>}
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all ml-3">
                <button
                  onClick={() => handleToggleDone(r)}
                  disabled={togglingId === r.id}
                  title={r.isDone ? 'Mark as pending' : 'Mark as done'}
                  className={`p-1.5 rounded-lg transition-colors ${r.isDone ? 'text-gray-400 hover:text-gray-600 bg-gray-100' : 'text-green-600 hover:bg-green-50'}`}
                >
                  {togglingId === r.id
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Check className="w-4 h-4" />}
                </button>
                <button onClick={() => handleDelete(r.id)} className="text-red-400 hover:text-red-600 p-1.5">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {!r.isDone && (
              <div className="flex gap-2 flex-wrap">
                {r.email && emailConfigured && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSendEmail(r)}
                      disabled={sending[r.id]}
                      className="flex items-center gap-1.5 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {sending[r.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                      Send Email
                    </button>
                    {sentStatus[r.id] === 'success' && <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle className="w-3.5 h-3.5" /> Sent!</span>}
                    {sentStatus[r.id] && sentStatus[r.id] !== 'success' && <span className="flex items-center gap-1 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5" /> Failed</span>}
                  </div>
                )}
                {r.whatsapp && (
                  <button onClick={() => handleWhatsApp(r)} className="flex items-center gap-1.5 text-sm bg-green-50 hover:bg-green-100 text-green-700 px-3 py-1.5 rounded-lg transition-colors">
                    <MessageCircle className="w-3.5 h-3.5" /> Send WhatsApp
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
