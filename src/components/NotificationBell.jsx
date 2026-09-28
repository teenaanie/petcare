import { useEffect, useRef, useState } from 'react'
import { Bell, Check, Loader2, AlertCircle, CalendarClock, X } from 'lucide-react'
import { getReminders, getPets, markReminderDone } from '../lib/storage.js'
import { groupReminders, badgeCount, dueLabel, SOON_DAYS } from '../lib/reminderFeed.js'
import { todayIST } from '../lib/dates.js'
import { friendlyError } from '../lib/errors.js'
import { withRetry } from '../lib/net.js'
import { trackEvent } from '../lib/analytics.js'

// What is due, on the screen the app opens on.
//
// Reminders already existed, but only inside a pet, three taps down. Someone
// with two pets had to go looking for a thing whose whole job is to come and
// find them — so a reminder that fired while the app was closed was only ever
// seen if the email arrived.
//
// The badge counts overdue and due-today only; see the note on badgeCount().
// The panel shows the coming week as well, because "nothing needs doing today,
// and here is what is coming" is the answer most mornings.

const TONE = {
  overdue: { bg: '#fdeaea', fg: '#c0392b', label: 'Overdue' },
  today:   { bg: '#fff3c0', fg: '#9a6b12', label: 'Today' },
  soon:    { bg: '#eef8fb', fg: '#255d6e', label: 'This week' },
  later:   { bg: '#f4f1ea', fg: '#73775b', label: 'Later' },
}

function Group({ which, rows, today, onOpen, onDone, busyId }) {
  if (!rows.length) return null
  const tone = TONE[which]
  return (
    <div className="px-2 py-1.5">
      <p className="text-[10px] font-black uppercase tracking-wider px-2 pb-1" style={{ color: tone.fg }}>
        {tone.label} · {rows.length}
      </p>
      {rows.map(r => (
        <div key={r.id} className="flex items-start gap-2 p-2 rounded-xl"
          style={{ backgroundColor: tone.bg }}>
          <button type="button" onClick={() => onOpen(r)}
            className="min-w-0 flex-1 text-left">
            <p className="text-sm font-bold truncate" style={{ color: '#7a4900' }}>
              {r.pet?.name ? `${r.pet.name} · ` : ''}{r.type || 'Reminder'}
            </p>
            <p className="text-xs" style={{ color: tone.fg }}>
              {dueLabel(r.dueDate, today)}
              {r.frequency && r.frequency !== 'Once' ? ` · ${r.frequency}` : ''}
            </p>
            {r.notes && (
              <p className="text-xs truncate" style={{ color: '#73775b' }}>{r.notes}</p>
            )}
          </button>
          {/* Marking it done from here is the point: the whole interaction is
              "what needs doing" → "done", without opening the pet. */}
          <button type="button" onClick={() => onDone(r)} disabled={busyId === r.id}
            title="Mark as done"
            className="p-1.5 rounded-lg flex-shrink-0 disabled:opacity-50"
            style={{ backgroundColor: '#FFFEF8', color: '#44562a' }}>
            {busyId === r.id
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Check className="w-3.5 h-3.5" />}
          </button>
        </div>
      ))}
    </div>
  )
}

// `align` is which edge of the bell the panel hangs from. In the sidebar it
// must hang RIGHT-wards ('left'): the panel is wider than the 256px sidebar, so
// anchoring it to the bell's right edge put most of it off the side of the
// screen. In a top bar there is room to the left, so it hangs the usual way.
export default function NotificationBell({ refresh, onOpenReminder, onChanged, className = '', align = 'right' }) {
  const [open, setOpen]         = useState(false)
  const [groups, setGroups]     = useState({ overdue: [], today: [], soon: [], later: [] })
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [busyId, setBusyId]     = useState(null)
  const today = todayIST()
  const wrapRef = useRef(null)

  async function load() {
    setError(null)
    try {
      const [reminders, pets] = await withRetry(
        () => Promise.all([getReminders(), getPets()]))
      setGroups(groupReminders(reminders, pets, todayIST()))
    } catch (e) {
      // A bell that cannot load is not worth an alarming message — it is not
      // the thing the user came here to do. Say it quietly, inside the panel.
      setError(friendlyError(e))
    } finally {
      setLoading(false)
    }
  }

  // On mount, whenever the app's data changes, and again each time the panel
  // is opened — reminders are edited inside a pet, which App does not hear
  // about, so opening the bell is the moment to be sure it is current.
  useEffect(() => { load() }, [refresh])
  useEffect(() => { if (open) load() }, [open])

  // Close on a click elsewhere or on Escape, the way a menu should.
  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey  = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const count = badgeCount(groups)
  const total = groups.overdue.length + groups.today.length + groups.soon.length

  async function handleDone(r) {
    setBusyId(r.id)
    try {
      // Safe to retry: setting is_done to true twice is the same as once, so
      // a request WebKit dropped costs a moment rather than the action.
      await withRetry(() => markReminderDone(r.id, true))
      trackEvent('reminder_done', { from: 'bell', type: (r.type || '').replace(/\s+/g, '_') })
      await load()
      // The pet's own Reminders tab may be open behind this panel, still
      // showing the row as pending. Tell the app so it reloads.
      onChanged?.()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusyId(null)
    }
  }

  function handleOpen(r) {
    setOpen(false)
    onOpenReminder?.(r)
  }

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl transition-colors"
        style={{ color: '#7a4900' }}
        aria-label={count
          ? `${count} reminder${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention`
          : 'Reminders'}
        aria-expanded={open}>
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full
                           flex items-center justify-center text-[10px] font-black"
            style={{ backgroundColor: '#c0392b', color: '#fff' }}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} mt-1
                         w-[min(20rem,calc(100vw-2rem))] rounded-2xl shadow-2xl z-50
                         max-h-[70vh] overflow-y-auto`}
          style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>

          <div className="flex items-center justify-between px-4 py-3 sticky top-0"
            style={{ backgroundColor: '#FFFEF8', borderBottom: '1px solid #ebe3d3' }}>
            <span className="font-black text-sm" style={{ color: '#7a4900' }}>
              What's due
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              <X className="w-4 h-4" style={{ color: '#73775b' }} />
            </button>
          </div>

          {loading ? (
            <p className="flex items-center gap-2 text-sm px-4 py-6" style={{ color: '#73775b' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Looking…
            </p>
          ) : error ? (
            <p className="flex items-start gap-2 text-sm px-4 py-5" style={{ color: '#c0392b' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </p>
          ) : total === 0 ? (
            <div className="px-4 py-7 text-center">
              <CalendarClock className="w-7 h-7 mx-auto mb-2" style={{ color: '#beb950' }} />
              <p className="text-sm font-bold" style={{ color: '#44562a' }}>Nothing due</p>
              <p className="text-xs mt-1" style={{ color: '#73775b' }}>
                {groups.later.length
                  ? `Nothing in the next ${SOON_DAYS} days. ${groups.later.length} further ahead.`
                  : 'Add a reminder from any pet and it will show up here.'}
              </p>
            </div>
          ) : (
            <div className="pb-2">
              <Group which="overdue" rows={groups.overdue} today={today}
                onOpen={handleOpen} onDone={handleDone} busyId={busyId} />
              <Group which="today"   rows={groups.today}   today={today}
                onOpen={handleOpen} onDone={handleDone} busyId={busyId} />
              <Group which="soon"    rows={groups.soon}    today={today}
                onOpen={handleOpen} onDone={handleDone} busyId={busyId} />
              {groups.later.length > 0 && (
                <p className="text-xs px-4 pt-2" style={{ color: '#a08f7a' }}>
                  {groups.later.length} more further ahead.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
