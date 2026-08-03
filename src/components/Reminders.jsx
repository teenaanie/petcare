import { useEffect, useState, useRef } from 'react'
import { Plus, Trash2, Bell, Mail, MessageCircle, CheckCircle, AlertCircle, Loader2, Mic, MicOff, Wand2, X } from 'lucide-react'
import { getReminders, saveReminder, deleteReminder } from '../lib/storage.js'
import { format } from 'date-fns'

const TYPES = ['Vaccination', 'Grooming', 'Vet Checkup', 'Medication', 'Other']
const FREQ  = ['Once', 'Weekly', 'Monthly', 'Yearly']
const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY

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

// ── Parse voice transcript with OpenAI ───────────────────────────────────────
async function parseVoiceReminder(transcript) {
  if (!OPENAI_KEY) throw new Error('OpenAI API key not configured.')
  const today = new Date().toISOString().split('T')[0]
  const prompt = `Today is ${today}. A pet owner said: "${transcript}"

Extract reminder details and return ONLY valid JSON:
{
  "type": "Vaccination|Grooming|Vet Checkup|Medication|Other",
  "dueDate": "YYYY-MM-DD",
  "frequency": "Once|Weekly|Monthly|Yearly",
  "notes": "any extra context from what they said"
}

Rules:
- Convert relative dates: "next week" = 7 days from today, "tomorrow" = 1 day, "in 3 months" = 90 days, etc.
- If no date mentioned, leave dueDate empty string.
- Pick the closest matching type from the list.
- Return valid JSON only.`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  if (!res.ok) throw new Error('AI parsing failed.')
  const data = await res.json()
  const text = data.choices[0].message.content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(text)
}

// ── Voice recording hook ──────────────────────────────────────────────────────
function useVoiceRecorder(onTranscript) {
  const [listening, setListening]   = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError]           = useState(null)
  const recognitionRef              = useRef(null)

  function start() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser. Try Chrome or Safari.')
      return
    }
    setError(null)
    setTranscript('')
    const rec = new SpeechRecognition()
    rec.continuous      = false
    rec.interimResults  = true
    rec.lang            = 'en-US'
    rec.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('')
      setTranscript(t)
    }
    rec.onend = () => {
      setListening(false)
      const final = recognitionRef.current?._lastTranscript
      if (final) onTranscript(final)
    }
    rec.onerror = (e) => { setError(`Mic error: ${e.error}`); setListening(false) }
    // store transcript on each result for use in onend
    rec.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('')
      setTranscript(t)
      rec._lastTranscript = t
    }
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }

  function stop() {
    recognitionRef.current?.stop()
    setListening(false)
  }

  return { listening, transcript, error, start, stop }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Reminders({ pet }) {
  const [reminders, setReminders]   = useState([])
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState({ type: 'Vaccination', dueDate: '', frequency: 'Once', email: '', whatsapp: '', notes: '' })
  const [sending, setSending]       = useState({})
  const [sentStatus, setSentStatus] = useState({})

  // Voice AI state
  const [voiceMode, setVoiceMode]       = useState(false)  // is voice panel open
  const [aiParsing, setAiParsing]       = useState(false)
  const [voiceError, setVoiceError]     = useState(null)
  const [parsedPreview, setParsedPreview] = useState(null) // AI-parsed form values

  function load() { setReminders(getReminders(pet.id)) }
  useEffect(load, [pet.id])

  function handleSubmit(e) {
    e.preventDefault()
    saveReminder({ ...form, petId: pet.id })
    setForm({ type: 'Vaccination', dueDate: '', frequency: 'Once', email: '', whatsapp: '', notes: '' })
    setShowForm(false)
    setParsedPreview(null)
    load()
  }

  function handleDelete(id) {
    if (confirm('Delete this reminder?')) { deleteReminder(id); load() }
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

  const voice = useVoiceRecorder(handleTranscript)
  const emailConfigured = import.meta.env.VITE_EMAILJS_SERVICE_ID

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">Reminders</h2>
        <div className="flex gap-2">
          {/* Voice button */}
          <button
            onClick={() => { setVoiceMode(v => !v); setShowForm(false) }}
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
            <button onClick={() => setVoiceMode(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-sm text-primary-700 mb-4">
            Say something like: <span className="italic">"Remind me to groom {pet.name} next Saturday"</span> or <span className="italic">"Set a vaccination reminder for March 15"</span>
          </p>

          {/* Mic button */}
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={voice.listening ? voice.stop : voice.start}
              disabled={aiParsing}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg ${
                voice.listening
                  ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                  : 'bg-primary-600 hover:bg-primary-700'
              }`}
            >
              {voice.listening
                ? <MicOff className="w-7 h-7 text-white" />
                : <Mic className="w-7 h-7 text-white" />}
            </button>
            <p className="text-sm font-medium text-primary-800">
              {voice.listening ? 'Listening... tap to stop' : 'Tap to speak'}
            </p>

            {voice.transcript && (
              <div className="w-full bg-white rounded-lg px-4 py-3 text-sm text-gray-700 border border-primary-200">
                <p className="text-xs text-gray-400 mb-1">Heard:</p>
                "{voice.transcript}"
              </div>
            )}

            {aiParsing && (
              <div className="flex items-center gap-2 text-primary-600 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <Wand2 className="w-4 h-4" />
                AI is understanding your request...
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

      {!emailConfigured && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
          <strong>Email reminders:</strong> Create a free account at{' '}
          <a href="https://www.emailjs.com" target="_blank" className="underline">emailjs.com</a> and add <code>VITE_EMAILJS_*</code> keys to <code>.env</code>.
          WhatsApp works without any setup.
        </div>
      )}

      {/* ── Manual form ─────────────────────────────────────────────────── */}
      {showForm && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{parsedPreview ? 'Review & Save' : 'New Reminder'}</h3>
            <button onClick={() => { setShowForm(false); setParsedPreview(null) }} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
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
            <div className="col-span-2">
              <label className="label">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} className="input" rows={2} placeholder="Any additional details..." />
            </div>
            <div className="col-span-2 flex justify-end gap-3">
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
        {reminders.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).map(r => (
          <div key={r.id} className="card group">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary-500" />
                  <span className="font-semibold text-gray-900">{r.type}</span>
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{r.frequency}</span>
                </div>
                {r.dueDate && <p className="text-sm text-gray-400 mt-0.5">Due: {format(new Date(r.dueDate), 'MMMM d, yyyy')}</p>}
                {r.notes && <p className="text-sm text-gray-600 mt-1">{r.notes}</p>}
              </div>
              <button onClick={() => handleDelete(r.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-2 flex-wrap">
              {r.email && (
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
          </div>
        ))}
      </div>
    </div>
  )
}
