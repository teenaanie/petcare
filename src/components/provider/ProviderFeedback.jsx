import { useState } from 'react'
import { MessageSquarePlus, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { getSupabaseProvider } from '../../lib/supabase.js'

// A way for a business to say something back.
//
// Deliberately NOT a reuse of FeedbackButton. That one writes through
// `supabase` — the pet-parent client — and in the provider shell that session is
// usually signed out, so the insert would arrive with a null user_id and be
// refused by the feedback policy, silently, in a catch. Worse, on a kennel's
// shared computer where somebody happens to be signed into the pet app too, a
// provider's message would be filed under that person. This writes through
// supabaseProvider, so the row carries the session that is actually on screen.
//
// provider_id is what makes it worth having at all: without it an admin reading
// the queue cannot tell which business is asking. The feedback INSERT policy
// checks it with is_provider_claimant(), which — unlike is_provider_member() —
// does NOT require status='active'. That difference is the feature: the first
// person who needs this is somebody whose account has just been suspended.
//
// Collapsed by default, because on the dashboard it is a footnote; on the
// suspended screen it is the only thing on the page worth tapping, so that
// screen opens it.

export default function ProviderFeedback({ userId, providerId, context, open: initiallyOpen = false, prompt }) {
  const [open, setOpen]       = useState(initiallyOpen)
  const [message, setMessage] = useState('')
  const [saving, setSaving]   = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState(null)

  // Tell the admins a message arrived. Deliberately after the insert and
  // deliberately unable to fail the send: the row is already saved, and a
  // provider appealing a suspension should not be told their appeal failed
  // because an email did. Worst case the message waits to be seen, which is
  // exactly where it was before this existed.
  async function alertAdmins(feedbackId) {
    try {
      const { data: { session } } = await (await getSupabaseProvider()).auth.getSession()
      if (!session) return
      await fetch('/api/notify-provider-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ feedbackId }),
      })
    } catch (err) {
      console.error('Could not alert the admins about this message:', err.message)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!message.trim() || saving) return
    setSaving(true); setError(null)
    try {
      // The id is generated here rather than read back, because `feedback` has
      // no SELECT policy for the person writing the row — it is admin-only — so
      // .insert().select() would come back empty. The notifier needs an id to
      // look up, and this is the only way to know it.
      const id = crypto.randomUUID()
      const { error } = await (await getSupabaseProvider()).from('feedback').insert({
        id,
        user_id:     userId,
        provider_id: providerId ?? null,
        category:    `Provider · ${context}`,
        message:     message.trim(),
      })
      if (error) throw error
      setDone(true)
      setMessage('')
      alertAdmins(id)
    } catch (err) {
      // Surfaced, not swallowed. A provider appealing a suspension needs to know
      // whether their message actually went anywhere.
      setError(err.message || 'Could not send that. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="card mt-4">
        <p className="flex items-center gap-2 text-sm font-bold" style={{ color: '#44562a' }}>
          <CheckCircle size={16} /> Sent — thank you.
        </p>
        <p className="text-sm mt-1" style={{ color: '#4A2C0A' }}>
          We read every one of these by hand. We&apos;ll get back to you on the email or
          number you signed in with.
        </p>
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm font-bold mt-4" style={{ color: '#b08d57' }}>
        <MessageSquarePlus size={15} /> Send us a message
      </button>
    )
  }

  return (
    <form className="card mt-4" onSubmit={submit}>
      <label className="label" style={{ color: '#7a4900' }} htmlFor="provider-feedback">
        {prompt || 'Anything you want to tell us?'}
      </label>
      <textarea id="provider-feedback" className="input" rows={4} autoFocus
        value={message} onChange={e => setMessage(e.target.value)}
        placeholder="Type your message…" />

      {error && (
        <div className="flex items-start gap-2 mt-3 text-sm" style={{ color: '#b4453c' }}>
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <button type="submit" disabled={!message.trim() || saving}
          className="btn-primary" style={!message.trim() || saving ? { opacity: 0.5 } : undefined}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : 'Send'}
        </button>
        <button type="button" className="btn-secondary" onClick={() => { setOpen(false); setError(null) }}>
          Cancel
        </button>
      </div>
    </form>
  )
}
