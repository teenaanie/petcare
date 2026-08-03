import { useEffect, useState } from 'react'
import { Plus, Trash2, Bell, Mail, MessageCircle, Send, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { getReminders, saveReminder, deleteReminder } from '../lib/storage.js'
import { format } from 'date-fns'

const TYPES = ['Vaccination', 'Grooming', 'Vet Checkup', 'Medication', 'Other']
const FREQ = ['Once', 'Weekly', 'Monthly', 'Yearly']

// EmailJS integration (free tier: 200 emails/month)
async function sendEmail({ toEmail, toName, petName, reminderType, dueDate, notes }) {
  const serviceId  = import.meta.env.VITE_EMAILJS_SERVICE_ID
  const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
  const publicKey  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY

  if (!serviceId || !templateId || !publicKey) {
    throw new Error('EmailJS not configured. Add VITE_EMAILJS_SERVICE_ID, VITE_EMAILJS_TEMPLATE_ID, and VITE_EMAILJS_PUBLIC_KEY to your .env file.')
  }

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      template_params: {
        to_name: toName,
        to_email: toEmail,
        pet_name: petName,
        reminder_type: reminderType,
        due_date: dueDate,
        notes: notes || '',
      }
    })
  })

  if (!response.ok) throw new Error('Failed to send email. Check your EmailJS configuration.')
}

export default function Reminders({ pet }) {
  const [reminders, setReminders] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ type: 'Vaccination', dueDate: '', frequency: 'Once', email: '', whatsapp: '', notes: '' })
  const [sending, setSending] = useState({})
  const [sentStatus, setSentStatus] = useState({})

  function load() { setReminders(getReminders(pet.id)) }
  useEffect(load, [pet.id])

  function handleSubmit(e) {
    e.preventDefault()
    saveReminder({ ...form, petId: pet.id })
    setForm({ type: 'Vaccination', dueDate: '', frequency: 'Once', email: '', whatsapp: '', notes: '' })
    setShowForm(false)
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
        toEmail: reminder.email,
        toName: 'Pet Owner',
        petName: pet.name,
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
      `🐾 *${pet.name}'s Reminder*\n\n` +
      `*Type:* ${reminder.type}\n` +
      `*Due:* ${reminder.dueDate ? format(new Date(reminder.dueDate), 'MMMM d, yyyy') : 'soon'}\n` +
      (reminder.notes ? `*Notes:* ${reminder.notes}` : '')
    )
    const phone = reminder.whatsapp.replace(/\D/g, '')
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank')
  }

  const emailConfigured = import.meta.env.VITE_EMAILJS_SERVICE_ID

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">Reminders</h2>
        <button onClick={() => setShowForm(s => !s)} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> Add Reminder
        </button>
      </div>

      {!emailConfigured && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
          <strong>Email reminders setup:</strong> Create a free account at{' '}
          <a href="https://www.emailjs.com" target="_blank" className="underline">emailjs.com</a>, add a service + template, then fill in the three <code>VITE_EMAILJS_*</code> variables in your <code>.env</code> file.
          WhatsApp reminders work without any setup.
        </div>
      )}

      {showForm && (
        <div className="card mb-4">
          <h3 className="font-semibold mb-4">New Reminder</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Reminder Type *</label>
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
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Save Reminder</button>
            </div>
          </form>
        </div>
      )}

      {reminders.length === 0 && !showForm && (
        <div className="card flex flex-col items-center py-12 text-center text-gray-400">
          <Bell className="w-10 h-10 mb-3 opacity-40" />
          <p className="font-medium">No reminders set</p>
          <p className="text-sm mt-1">Add reminders for vaccinations, grooming, and checkups.</p>
        </div>
      )}

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
                {r.dueDate && (
                  <p className="text-sm text-gray-400 mt-0.5">Due: {format(new Date(r.dueDate), 'MMMM d, yyyy')}</p>
                )}
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
                    {sending[r.id]
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Mail className="w-3.5 h-3.5" />}
                    Send Email
                  </button>
                  {sentStatus[r.id] === 'success' && (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle className="w-3.5 h-3.5" /> Sent!
                    </span>
                  )}
                  {sentStatus[r.id] && sentStatus[r.id] !== 'success' && (
                    <span className="flex items-center gap-1 text-xs text-red-600" title={sentStatus[r.id]}>
                      <AlertCircle className="w-3.5 h-3.5" /> Failed
                    </span>
                  )}
                </div>
              )}
              {r.whatsapp && (
                <button
                  onClick={() => handleWhatsApp(r)}
                  className="flex items-center gap-1.5 text-sm bg-green-50 hover:bg-green-100 text-green-700 px-3 py-1.5 rounded-lg transition-colors"
                >
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
