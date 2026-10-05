// Who has gone quiet, and a way to ask them whether everything is alright.
//
// Its own file rather than a seventh panel inside AdminDashboard.jsx, which is
// already past a thousand lines.
//
// ── What "inactive" means here, and why it is not "has not signed in" ───────
//
// Supabase refreshes a session's token without touching `last_sign_in_at`, so
// somebody who stays signed in on their phone looks dormant forever. One live
// account last signed in 58 days ago and was still creating records 13 days
// ago. The list therefore uses the most recent of: signing in, creating
// anything across sixteen tables, and joining. The SQL in
// supabase/inactive_users.sql is the single definition, and the send endpoint
// re-derives from the same function rather than trusting this screen.
//
// Two things this cannot see, both worth remembering when reading the list:
// no table has an `updated_at`, so editing an existing record leaves no trace,
// and reading is invisible. Somebody who only ever tidies old records, or who
// opens the app to look things up, reads as inactive. That is why the button
// sends a question rather than a conclusion.

import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, Mail, Phone, PawPrint, Send, Check, Moon, Clock } from 'lucide-react'
import { getSupabase } from '../lib/supabase.js'

/** Views, in days. Nothing below 30: the ask was "inactive for more than a
 *  month", and the endpoint refuses anything shorter anyway. */
const RANGES = [30, 60, 90]

const fmtDate = (t) => t ? new Date(t).toLocaleDateString(undefined,
  { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

async function sendCheckin(userId) {
  const supabase = await getSupabase()
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return { ok: false, reason: 'no_session' }
  const res = await fetch('/api/checkin-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId }),
  })
  try { return await res.json() } catch { return { ok: false, reason: `http_${res.status}` } }
}

/** Why a send was refused, in words an admin can act on. */
const REFUSALS = {
  not_inactive:         'They have used Pippy since this list loaded. Refresh.',
  no_email:             'No email address on this account.',
  too_recent:           'Not quiet for long enough yet.',
  already_contacted:    'Already asked recently.',
  daily_cap:            'Daily send limit reached. Something is looping.',
  email_not_configured: 'Email is not set up on this deployment.',
  no_session:           'Your session expired. Sign in again.',
}

function Row({ user, onSent }) {
  const [state, setState] = useState('idle')   // idle | confirm | sending | sent | error
  const [problem, setProblem] = useState(null)

  const contacted = !!user.last_checkin_at

  async function go() {
    setState('sending'); setProblem(null)
    const r = await sendCheckin(user.id)
    if (r?.ok && r?.sent) { setState('sent'); onSent?.(user.id); return }
    setProblem(REFUSALS[r?.reason] || r?.error || 'Could not send.')
    setState('error')
  }

  return (
    <div className="p-3 rounded-xl" style={{ backgroundColor: '#ffffff', border: '1px solid #ebe3d3' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-sm flex items-center gap-1.5 break-all" style={{ color: '#7a4900' }}>
            {user.email
              ? <><Mail className="w-3.5 h-3.5 flex-shrink-0" />{user.email}</>
              : <><Phone className="w-3.5 h-3.5 flex-shrink-0" />{user.phone || 'no contact details'}</>}
          </p>
          <p className="text-[11px] mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ color: '#73775b' }}>
            <span className="inline-flex items-center gap-1">
              <PawPrint className="w-3 h-3" />
              {user.pet_count} {user.pet_count === 1 ? 'pet' : 'pets'}
            </span>
            <span>joined {fmtDate(user.created_at)}</span>
            <span>last seen {fmtDate(user.last_seen_at)}</span>
          </p>
          {/* Both figures, because they disagree often enough to matter and the
              difference is the whole reason this list is trustworthy. */}
          <p className="text-[11px] mt-0.5" style={{ color: '#9a9a86' }}>
            signed in {fmtDate(user.last_sign_in_at)} · last created something {fmtDate(user.last_activity_at)}
          </p>
          {contacted && (
            <p className="text-[11px] mt-1 inline-flex items-center gap-1" style={{ color: '#73775b' }}>
              <Clock className="w-3 h-3" />
              asked {user.checkin_count === 1 ? 'once' : `${user.checkin_count} times`},
              last on {fmtDate(user.last_checkin_at)}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-xs font-black px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
            {user.idle_days}d quiet
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={user.kind === 'never_used'
              ? { backgroundColor: '#fdeaea', color: '#c0392b' }
              : { backgroundColor: '#ebe3d3', color: '#73775b' }}>
            {user.kind === 'never_used' ? 'never used it' : 'went quiet'}
          </span>
        </div>
      </div>

      <div className="mt-2.5">
        {!user.contactable ? (
          <p className="text-[11px] italic" style={{ color: '#9a9a86' }}>
            Phone-only account, so there is no address to write to. Listed so it is not invisible.
          </p>
        ) : state === 'sent' ? (
          <p className="text-xs font-bold inline-flex items-center gap-1" style={{ color: '#2e7d32' }}>
            <Check className="w-3.5 h-3.5" /> Asked. Replies come straight to you.
          </p>
        ) : state === 'confirm' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px]" style={{ color: '#7a4900' }}>
              Email {user.email}?
            </span>
            <button onClick={go} className="text-xs font-bold px-2.5 py-1 rounded-lg"
              style={{ backgroundColor: '#ffde59', color: '#7a4900' }}>
              Yes, send it
            </button>
            <button onClick={() => setState('idle')} className="text-xs font-bold px-2 py-1 rounded-lg"
              style={{ color: '#73775b' }}>
              Cancel
            </button>
          </div>
        ) : state === 'sending' ? (
          <p className="text-xs inline-flex items-center gap-1.5" style={{ color: '#73775b' }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…
          </p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setState('confirm')}
              className="text-xs font-bold px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5"
              style={{ backgroundColor: '#f5f0e0', color: '#7a4900' }}>
              <Send className="w-3 h-3" />
              {contacted ? 'Ask again' : 'Ask if all is well'}
            </button>
            {state === 'error' && (
              <span className="text-[11px]" style={{ color: '#c0392b' }}>{problem}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function InactiveUsersPanel() {
  const [rows, setRows]       = useState([])
  const [days, setDays]       = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getSupabase()
      .then(supabase => supabase.rpc('get_inactive_users_for_admin', { days }))
      .then(({ data, error: e }) => {
        if (!alive) return
        if (e) throw e
        setRows(data || [])
        setError(null)
      })
      .catch(e => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [days])

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16" style={{ color: '#73775b' }}>
      <Loader2 className="w-5 h-5 animate-spin" /> <span>Working out who has gone quiet…</span>
    </div>
  )

  if (error) return (
    <div className="flex items-start gap-2 p-4 rounded-xl text-sm"
      style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>{error}. Check that <code>supabase/inactive_users.sql</code> has been run.</span>
    </div>
  )

  const emailable = rows.filter(r => r.contactable).length

  return (
    <div>
      <div className="flex gap-1 rounded-xl p-1 mb-3 w-fit" style={{ backgroundColor: '#ebe3d3' }}>
        {RANGES.map(d => (
          <button key={d} onClick={() => setDays(d)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={days === d ? { backgroundColor: '#f2b83d', color: '#7a4900' } : { color: '#73775b' }}>
            {d}+ days
          </button>
        ))}
      </div>

      <p className="text-[11px] mb-4" style={{ color: '#73775b' }}>
        Quiet means no sign-in and nothing created, whichever is more recent.
        Editing an existing record leaves no trace in the database, so somebody
        who only tidies up old entries will show here too.
      </p>

      {rows.length === 0 ? (
        <div className="text-center py-16">
          <Moon className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#7a4900' }} />
          <p className="text-sm" style={{ color: '#73775b' }}>
            Nobody has been quiet for {days} days or more.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs font-bold mb-2" style={{ color: '#7a4900' }}>
            {rows.length} {rows.length === 1 ? 'person' : 'people'}
            {emailable < rows.length && `, ${emailable} with an email address`}
          </p>
          <div className="space-y-2">
            {rows.map(u => (
              <Row key={u.id} user={u}
                onSent={() => setRows(rs => rs.map(r => r.id === u.id
                  ? { ...r, last_checkin_at: new Date().toISOString(),
                      checkin_count: (r.checkin_count || 0) + 1 }
                  : r))} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
