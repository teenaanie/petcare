// A business writing to the customers who wrote to it.
//
// The provider never sees an address, here or anywhere. This screen collects a
// subject and a message and nothing else; api/_lib/provider-broadcast.js
// resolves the audience with the service key and sends. There is no shape of
// this feature where the client holds the list, which is why there is no
// recipient picker and no "to" field to miss.
//
// The audience is also narrower than a business might expect, on purpose:
// people who have sent THIS business a note AND typed an address into it.
// auth.users has an address for everyone, and using it would mean mailing
// someone at an address they never offered to this business. The copy below
// says so, because a provider who does not know that will think it is broken.

import { useState, useEffect } from 'react'
import { Megaphone, Loader2, AlertCircle, CheckCircle2, Send } from 'lucide-react'
import { getSupabaseProvider } from '../../lib/supabase.js'
import { reportHandled } from '../../lib/errorReport.js'
import { formatDay } from '../../lib/providerBrief.js'

const MAX_SUBJECT = 120
const MAX_BODY    = 2000

export default function ProviderBroadcast({ providerId, providerName }) {
  const [open, setOpen]       = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState(null)
  const [result, setResult]   = useState(null)
  const [outbox, setOutbox]   = useState([])

  // The outbox doubles as the honest answer to "how many can I still send?" —
  // the ceiling is counted server-side from exactly these rows.
  useEffect(() => {
    if (!open || !providerId) return
    let cancelled = false
    ;(async () => {
      try {
        const supabase = await getSupabaseProvider()
        if (!supabase || cancelled) return
        const { data, error } = await supabase
          .from('provider_broadcasts')
          .select('id, subject, recipients, failures, sent_at')
          .eq('provider_id', providerId)
          .order('sent_at', { ascending: false }).limit(5)
        if (error) throw error
        if (!cancelled) setOutbox(data || [])
      } catch (e) {
        // A missing outbox must not stop somebody sending.
        if (!cancelled) reportHandled(e, { view: 'provider-broadcast' })
      }
    })()
    return () => { cancelled = true }
  }, [open, providerId, result])

  const canSend = subject.trim() && body.trim() && !sending

  async function handleSend() {
    if (!canSend) return
    setSending(true); setError(null); setResult(null)
    try {
      const supabase = await getSupabaseProvider()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Please sign in again.')

      const res = await fetch('/api/provider-broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ providerId, subject: subject.trim(), body: body.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send that.')
      setResult(data)
      setSubject(''); setBody('')
    } catch (e) {
      reportHandled(e, { view: 'provider-broadcast' })
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm font-bold mt-4"
        style={{ color: '#b08d57' }}>
        <Megaphone className="w-4 h-4" /> Message your customers
      </button>
    )
  }

  return (
    <div className="card mt-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-black text-sm flex items-center gap-2" style={{ color: '#7a4900' }}>
          <Megaphone className="w-4 h-4" /> Message your customers
        </h3>
        <button onClick={() => { setOpen(false); setResult(null); setError(null) }}
          className="text-xs font-bold" style={{ color: '#73775b' }}>Close</button>
      </div>

      {/* Said up front, because a provider who does not know this will read a
          small number as a bug rather than as the design. */}
      <p className="text-xs mb-3" style={{ color: '#73775b' }}>
        Goes to everyone who has sent you their pet&apos;s details and included an
        email address. You will not see their addresses — Pippy sends it for you.
        Four messages a month, so it stays out of their spam folder.
      </p>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm mb-3"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {result && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm mb-3"
          style={{ backgroundColor: '#eef3e2', color: '#44562a' }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {result.sent === 0
              ? 'Nobody to send to yet — this works once customers have informed you and left an email address.'
              : `Sent to ${result.sent} customer${result.sent === 1 ? '' : 's'}.`}
            {result.failures > 0 && ` ${result.failures} did not go through.`}
            {result.capped && ' Your list is larger than one send allows, so this went to the first 200.'}
          </span>
        </div>
      )}

      <label className="label text-xs">Subject</label>
      <input value={subject} onChange={e => setSubject(e.target.value)}
        maxLength={MAX_SUBJECT} className="input w-full mb-3"
        placeholder="Closed for Diwali" disabled={sending} />

      <label className="label text-xs">Message</label>
      <textarea value={body} onChange={e => setBody(e.target.value)}
        maxLength={MAX_BODY} rows={5} className="input w-full"
        placeholder={`We are shut from the 20th to the 23rd. Bookings either side are unaffected.`}
        disabled={sending} />
      <p className="text-xs mt-1 mb-3" style={{ color: '#73775b' }}>
        {body.length}/{MAX_BODY}
      </p>

      <button onClick={handleSend} disabled={!canSend}
        className="btn-primary w-full justify-center gap-2">
        {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                 : <><Send className="w-4 h-4" /> Send to your customers</>}
      </button>

      {outbox.length > 0 && (
        <div className="mt-4 pt-3" style={{ borderTop: '1px solid #f0e6c8' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#b08d57' }}>
            Recently sent
          </p>
          {outbox.map(b => (
            <p key={b.id} className="text-xs mb-1" style={{ color: '#5f624b' }}>
              <span className="font-bold" style={{ color: '#4A2C0A' }}>{b.subject}</span>
              {' · '}{formatDay(String(b.sent_at).slice(0, 10)) || ''}
              {' · '}{b.recipients} sent
              {b.failures > 0 && `, ${b.failures} failed`}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
