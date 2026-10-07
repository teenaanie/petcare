// The provider's book: every note customers have sent this business.
//
// This is the dashboard, and it needs no booking system to be one. A note
// carries an optional stay window, so the same rows that are a message list
// are also a diary: a future start is upcoming, a window spanning today is
// current, a finished one is past.
//
// Everything rendered here comes from provider_notes and nothing else. There is
// no join into pets or auth.users, and there cannot be — this shell has no read
// access to either. That is why the note carries pet_label and the contact
// fields as its own columns.

import { useState, useEffect, useMemo } from 'react'
import { Loader2, AlertCircle, Inbox, Phone, Mail, Clock, CalendarDays } from 'lucide-react'
import { getSupabaseProvider } from '../../lib/supabase.js'
import { reportHandled } from '../../lib/errorReport.js'
import { todayIST } from '../../lib/dates.js'
import { formatDay } from '../../lib/providerBrief.js'
import { ageInDays, groupNotes, INBOX_SECTIONS } from '../../lib/providerInbox.js'

function stayLabel(n) {
  const from = n.startsOn ? formatDay(n.startsOn) : null
  const to   = n.endsOn   ? formatDay(n.endsOn)   : null
  if (from && to) return `${from} → ${to}`
  if (from) return `from ${from}`
  if (to)   return `until ${to}`
  return null
}

function NoteCard({ note }) {
  const [open, setOpen] = useState(false)
  const age  = ageInDays(note.sentAt)
  const stay = stayLabel(note)
  // Details drift. A month-old note about a dog's medication is not wrong, but
  // it is old enough that a boarder should ask rather than assume, and nothing
  // else on this card says how old it is at a glance.
  const stale = age !== null && age > 30

  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: 'white', border: '1px solid #f0e6c8' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-sm" style={{ color: '#4A2C0A' }}>{note.petLabel}</p>
          {stay && (
            <p className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: '#b08d57' }}>
              <CalendarDays className="w-3 h-3 shrink-0" /> {stay}
            </p>
          )}
        </div>
        {age !== null && (
          <span className="text-xs px-2 py-0.5 rounded-full font-bold shrink-0 flex items-center gap-1"
            style={stale
              ? { backgroundColor: '#fff3c0', color: '#7a4900' }
              : { backgroundColor: '#f5f0e0', color: '#5f624b' }}>
            <Clock className="w-3 h-3" />
            {age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`}
          </span>
        )}
      </div>

      {stale && (
        <p className="text-xs mt-2" style={{ color: '#c9891f' }}>
          Sent over a month ago — worth checking with them that it is still right.
        </p>
      )}

      <p className="text-sm mt-3 whitespace-pre-wrap"
        style={{ color: '#4A2C0A', ...(open ? {} : { display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>
        {note.body}
      </p>
      {(note.body || '').split('\n').length > 6 && (
        <button onClick={() => setOpen(v => !v)} className="text-xs font-bold mt-1"
          style={{ color: '#b08d57' }}>
          {open ? 'Show less' : 'Show all'}
        </button>
      )}

      {(note.contactName || note.contactPhone || note.contactEmail) && (
        <div className="mt-3 pt-3 flex flex-wrap gap-3 text-xs" style={{ borderTop: '1px solid #f5f0e0', color: '#5f624b' }}>
          {note.contactName && <span className="font-bold">{note.contactName}</span>}
          {note.contactPhone && (
            <a href={`tel:${note.contactPhone}`} className="flex items-center gap-1.5" style={{ color: '#2f7286' }}>
              <Phone className="w-3 h-3" /> {note.contactPhone}
            </a>
          )}
          {note.contactEmail && (
            <a href={`mailto:${note.contactEmail}`} className="flex items-center gap-1.5" style={{ color: '#2f7286' }}>
              <Mail className="w-3 h-3" /> {note.contactEmail}
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export default function ProviderInbox({ providerIds = [] }) {
  const [notes, setNotes]     = useState(null)
  const [error, setError]     = useState(null)

  const ids = useMemo(() => [...new Set(providerIds.filter(Boolean))], [providerIds])

  useEffect(() => {
    if (!ids.length) { setNotes([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const supabase = await getSupabaseProvider()
        if (!supabase || cancelled) return
        // RLS is what scopes this to businesses the caller is active on; the
        // `in` is a narrowing for the query planner, not the security boundary.
        const { data, error } = await supabase
          .from('provider_notes').select('*')
          .in('provider_id', ids)
          .order('sent_at', { ascending: false })
        if (error) throw error
        if (cancelled) return
        setNotes((data || []).map(r => ({
          id: r.id, providerId: r.provider_id, body: r.body, petLabel: r.pet_label,
          contactName: r.contact_name, contactPhone: r.contact_phone,
          contactEmail: r.contact_email, startsOn: r.starts_on, endsOn: r.ends_on,
          sentAt: r.sent_at, supersedes: r.supersedes,
        })))
      } catch (e) {
        if (cancelled) return
        reportHandled(e, { view: 'provider-inbox' })
        setError(e.message || 'Could not load your notes.')
        setNotes([])
      }
    })()
    return () => { cancelled = true }
  }, [ids])

  const grouped = useMemo(() => (notes ? groupNotes(notes, todayIST()) : null), [notes])

  if (notes === null) {
    return (
      <div className="card flex items-center gap-2" style={{ color: '#73775b' }}>
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your notes…
      </div>
    )
  }

  if (error) {
    return (
      <div className="card flex items-start gap-2 text-sm" style={{ color: '#c0392b' }}>
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
      </div>
    )
  }

  const total = Object.values(grouped).reduce((n, g) => n + g.length, 0)

  if (total === 0) {
    return (
      <div className="card text-center py-10">
        <Inbox className="w-9 h-9 mx-auto mb-3" style={{ color: '#b08d57' }} />
        <p className="font-bold mb-1" style={{ color: '#4A2C0A' }}>Nothing yet</p>
        <p className="text-sm" style={{ color: '#73775b' }}>
          When a customer sends you their pet&apos;s details from the Pippy app,
          it appears here — what they are fed, what they react to, what they are
          on, and how to reach their owner.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {INBOX_SECTIONS.map(s => grouped[s.key].length > 0 && (
        <div key={s.key}>
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#b08d57' }}>
            {s.title} ({grouped[s.key].length})
          </p>
          <div className="space-y-3">
            {grouped[s.key].map(n => <NoteCard key={n.id} note={n} />)}
          </div>
        </div>
      ))}
    </div>
  )
}
