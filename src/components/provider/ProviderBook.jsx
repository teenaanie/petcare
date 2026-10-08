// The provider's own book: a dashboard first, lists second.
//
// The first version of this opened straight onto a list of every booking, which
// is the wrong thing to lead with — a boarder arriving at the screen wants to
// know how many animals are in, how many are coming, and whether anything needs
// doing before they get here. Numbers answer that in one glance; a list makes
// you count.
//
// So the top of this screen is a KPI row of stat tiles and nothing else. Each
// tile is a way in: tap it and you get the list behind that number. A handful
// of headline figures is a stat tile's job — a chart of "5 pets here" would be
// a worse way to say five.
//
// Routing is one piece of state, `view`. Four shapes:
//   {kind:'dashboard'}            the tiles
//   {kind:'list',   bucket}       here | upcoming | past | customers
//   {kind:'customer', id}         one customer, their pets and stays
//   {kind:'booking',  id}         one stay: edit it, tick it off, log the days

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Loader2, AlertCircle, Plus, X, Users, CalendarDays, Phone, Mail, MessageCircle,
  Trash2, PawPrint, Link2, ChevronLeft, ChevronRight, Home, Check, Pencil,
  NotebookPen, AlertTriangle,
} from 'lucide-react'
import { getSupabaseProvider } from '../../lib/supabase.js'
import { reportHandled } from '../../lib/errorReport.js'
import { todayIST } from '../../lib/dates.js'
import { formatDay } from '../../lib/providerBrief.js'
import ProviderBroadcast from './ProviderBroadcast.jsx'
import {
  getBook, saveCustomer, savePet, saveAppointment,
  deleteCustomer, deleteAppointment, groupAppointments, bookSummary,
  getLogs, saveLog, deleteLog,
  APPOINTMENT_KINDS, APPOINTMENT_STATUS,
} from '../../lib/providerBook.js'

const STATUS_STYLE = {
  booked:    { label: 'Booked',    bg: '#fff3c0', fg: '#7a4900' },
  completed: { label: 'Completed', bg: '#eef3e2', fg: '#44562a' },
  cancelled: { label: 'Cancelled', bg: '#f5f0e0', fg: '#5f624b' },
  no_show:   { label: 'No show',   bg: '#fdeaea', fg: '#8a2b20' },
}

const field = 'input w-full'
const lbl   = 'label text-xs'

function Field({ label, ...rest }) {
  return <div><label className={lbl}>{label}</label><input className={field} {...rest} /></div>
}

/** A phone number as WhatsApp wants it. Ten digits are assumed Indian. */
function waLink(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  if (!d) return null
  return `https://wa.me/${d.length === 10 ? '91' + d : d}`
}

// ── Stat tiles ──────────────────────────────────────────────────────────────
//
// Label in sentence case, value in the same sans as everything else with the
// font's proportional figures — tabular-nums gives every digit the width of a
// zero, which makes a number like 121 look loose at this size. Exactly one hero
// figure on the view, and it is the number a kennel leads with: who is in.

function Tile({ label, value, hint, tone = 'plain', hero = false, onClick, children }) {
  const tones = {
    plain:  { bg: '#FFFEF8', border: '#ebe3d3', ink: '#7a4900' },
    here:   { bg: '#fff9e0', border: '#f2b83d', ink: '#7a4900' },
    warn:   { bg: '#fdeaea', border: '#e8b4ad', ink: '#8a2b20' },
  }
  const c = tones[tone] || tones.plain
  return (
    <button onClick={onClick} disabled={!onClick}
      /* h-full + centred content: the hero tile spans two rows on a wide
         screen, and top-aligned text left a pool of empty colour under it. */
      className={`rounded-2xl p-4 text-left transition-all w-full h-full flex flex-col ${hero ? 'justify-center' : ''}`}
      style={{ backgroundColor: c.bg, border: `1.5px solid ${c.border}`,
               cursor: onClick ? 'pointer' : 'default' }}>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#b08d57' }}>{label}</p>
      <p className={`font-black leading-none mt-1.5 ${hero ? 'text-[2.75rem] lg:text-[4rem]' : 'text-[1.75rem]'}`}
         style={{ color: c.ink }}>{value}</p>
      {hint && <p className="text-xs mt-1.5" style={{ color: '#73775b' }}>{hint}</p>}
      {children}
    </button>
  )
}

// ── Forms ───────────────────────────────────────────────────────────────────

function CustomerForm({ initial, onSave, onCancel, busy }) {
  const [f, setF] = useState(initial)
  const set = e => setF(p => ({ ...p, [e.target.name]: e.target.value }))
  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: '#fff9e0', border: '1.5px solid #f2b83d' }}>
      <Field label="Name *" name="name" value={f.name} onChange={set} placeholder="Mrs Rao" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone" name="phone" value={f.phone || ''} onChange={set} placeholder="98765 00000" />
        <Field label="Email" name="email" value={f.email || ''} onChange={set} placeholder="optional" />
      </div>
      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" value={f.notes || ''} onChange={set} rows={2} className={field}
          placeholder="Pays by UPI. Prefers evening pickup." />
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave(f)} disabled={busy || !f.name?.trim()} className="btn-primary flex-1 justify-center">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save customer'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

function PetForm({ initial, notes, onSave, onCancel, busy }) {
  const [f, setF] = useState(initial)
  const set = e => setF(p => ({ ...p, [e.target.name]: e.target.value }))
  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: '#fff9e0', border: '1.5px solid #f2b83d' }}>
      <Field label="Name *" name="name" value={f.name} onChange={set} placeholder="Simba" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Species" name="species" value={f.species || ''} onChange={set} placeholder="Dog" />
        <Field label="Breed" name="breed" value={f.breed || ''} onChange={set} placeholder="Golden Retriever" />
      </div>
      {notes.length > 0 && (
        <div>
          <label className={lbl}>Link to a note they sent you</label>
          <select name="noteId" value={f.noteId || ''} onChange={set} className={field}>
            <option value="">— not linked —</option>
            {notes.map(n => <option key={n.id} value={n.id}>{n.petLabel}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" value={f.notes || ''} onChange={set} rows={2} className={field}
          placeholder="Nervous with men in hats." />
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave(f)} disabled={busy || !f.name?.trim()} className="btn-primary flex-1 justify-center">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save pet'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

function AppointmentForm({ initial, pets, onSave, onCancel, busy }) {
  const [f, setF] = useState(initial)
  const set = e => setF(p => ({ ...p, [e.target.name]: e.target.value }))
  const toggle = k => setF(p => ({ ...p, [k]: !p[k] }))
  const bad = f.endsOn && f.startsOn && f.endsOn < f.startsOn
  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: '#fff9e0', border: '1.5px solid #f2b83d' }}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>What</label>
          <select name="kind" value={f.kind} onChange={set} className={field}>
            {APPOINTMENT_KINDS.map(k => <option key={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Which pet</label>
          <select name="providerPetId" value={f.providerPetId || ''} onChange={set} className={field}>
            <option value="">— not said —</option>
            {pets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From *" type="date" name="startsOn" value={f.startsOn || ''} onChange={set} />
        <Field label="Until" type="date" name="endsOn" value={f.endsOn || ''} onChange={set} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Time (if it matters)" type="time" name="startsAt" value={f.startsAt || ''} onChange={set} />
        <div>
          <label className={lbl}>Status</label>
          <select name="status" value={f.status} onChange={set} className={field}>
            {APPOINTMENT_STATUS.map(s => <option key={s} value={s}>{STATUS_STYLE[s].label}</option>)}
          </select>
        </div>
      </div>

      {/* The two things a front desk checks before the animal arrives. One flag
          each plus the free-text note below, rather than a checklist this app
          invents — what "criteria" means differs by business. */}
      <div className="grid grid-cols-2 gap-2">
        {[['trialDone', 'Trial done'], ['criteriaMet', 'Criteria met']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => toggle(k)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold"
            style={f[k] ? { backgroundColor: '#eef3e2', color: '#44562a' }
                        : { backgroundColor: '#f5f0e0', color: '#73775b' }}>
            <span className="w-4 h-4 rounded flex items-center justify-center shrink-0"
              style={{ backgroundColor: f[k] ? '#5f7a3a' : '#e0d8c0' }}>
              {f[k] && <Check className="w-3 h-3" style={{ color: 'white' }} />}
            </span>
            {l}
          </button>
        ))}
      </div>

      <div>
        <label className={lbl}>Notes for this stay</label>
        <textarea name="notes" value={f.notes || ''} onChange={set} rows={2} className={field}
          placeholder="Bringing own food. Pickup after 7." />
      </div>
      {bad && <p className="text-xs" style={{ color: '#c0392b' }}>The end date is before the start date.</p>}
      <div className="flex gap-2">
        <button onClick={() => onSave(f)} disabled={busy || !f.startsOn || bad} className="btn-primary flex-1 justify-center">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save booking'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

// ── Rows ────────────────────────────────────────────────────────────────────

function BookingRow({ a, pet, customer, onOpen }) {
  const s = STATUS_STYLE[a.status] || STATUS_STYLE.booked
  const when = [formatDay(a.startsOn), a.endsOn && a.endsOn !== a.startsOn ? `→ ${formatDay(a.endsOn)}` : null]
    .filter(Boolean).join(' ')
  const unready = a.status === 'booked' && (!a.trialDone || !a.criteriaMet)
  return (
    <button onClick={onOpen} className="w-full text-left flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm" style={{ color: '#4A2C0A' }}>
          <span className="font-bold">{a.kind}</span>
          {pet && <span style={{ color: '#b08d57' }}> · {pet.name}</span>}
        </p>
        <p className="text-xs" style={{ color: '#73775b' }}>
          {when}{a.startsAt ? ` · ${a.startsAt.slice(0, 5)}` : ''}
        </p>
        {customer && <p className="text-xs" style={{ color: '#b08d57' }}>{customer.name}</p>}
        {unready && (
          <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: '#c9891f' }}>
            <AlertTriangle className="w-3 h-3 shrink-0" />
            {!a.trialDone && !a.criteriaMet ? 'Trial and criteria outstanding'
              : !a.trialDone ? 'Trial not done' : 'Criteria not met'}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs px-2 py-0.5 rounded-full font-bold"
          style={{ backgroundColor: s.bg, color: s.fg }}>{s.label}</span>
        <ChevronRight className="w-4 h-4" style={{ color: '#b08d57' }} />
      </div>
    </button>
  )
}

// ── One booking ─────────────────────────────────────────────────────────────

function BookingDetail({ booking, customer, pets, onBack, onChanged, run, busy, postedBy }) {
  const [editing, setEditing] = useState(false)
  const [logs, setLogs] = useState([])
  const [entry, setEntry] = useState('')
  const [onDate, setOnDate] = useState(todayIST())

  const loadLogs = useCallback(async () => {
    try { setLogs(await getLogs(await getSupabaseProvider(), booking.id)) }
    catch (e) { reportHandled(e, { view: 'provider-book' }) }
  }, [booking.id])
  useEffect(() => { loadLogs() }, [loadLogs])

  const s = STATUS_STYLE[booking.status] || STATUS_STYLE.booked
  const pet = pets.find(p => p.id === booking.providerPetId)

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs font-bold flex items-center gap-1" style={{ color: '#b08d57' }}>
        <ChevronLeft className="w-3.5 h-3.5" /> Back
      </button>

      {editing ? (
        <AppointmentForm busy={busy} pets={pets} initial={booking}
          onCancel={() => setEditing(false)}
          onSave={f => run(async sb => {
            await saveAppointment(sb, { ...f, id: booking.id, providerId: booking.providerId,
                                        customerId: booking.customerId })
            setEditing(false)
          })} />
      ) : (
        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-black" style={{ color: '#7a4900' }}>
                {booking.kind}{pet ? ` · ${pet.name}` : ''}
              </h2>
              <p className="text-sm" style={{ color: '#b08d57' }}>
                {formatDay(booking.startsOn)}
                {booking.endsOn && booking.endsOn !== booking.startsOn && ` → ${formatDay(booking.endsOn)}`}
                {booking.startsAt && ` · ${booking.startsAt.slice(0, 5)}`}
              </p>
              <p className="text-sm mt-0.5" style={{ color: '#4A2C0A' }}>{customer?.name}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                style={{ backgroundColor: s.bg, color: s.fg }}>{s.label}</span>
              <button onClick={() => setEditing(true)} title="Edit this booking"
                className="p-1.5 rounded-lg" style={{ color: '#7a4900' }}>
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tickable in place, because these get confirmed on the phone and
              nobody wants to open an edit form to record a yes. */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {[['trialDone', 'Trial done'], ['criteriaMet', 'Criteria met']].map(([k, l]) => (
              <button key={k} disabled={busy}
                onClick={() => run(sb => saveAppointment(sb, {
                  ...booking, id: booking.id, [k]: !booking[k],
                }))}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold"
                style={booking[k] ? { backgroundColor: '#eef3e2', color: '#44562a' }
                                  : { backgroundColor: '#f5f0e0', color: '#73775b' }}>
                <span className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                  style={{ backgroundColor: booking[k] ? '#5f7a3a' : '#e0d8c0' }}>
                  {booking[k] && <Check className="w-3 h-3" style={{ color: 'white' }} />}
                </span>
                {l}
              </button>
            ))}
          </div>

          {booking.notes && (
            <p className="text-sm mt-3 whitespace-pre-wrap" style={{ color: '#4A2C0A' }}>{booking.notes}</p>
          )}

          <button
            onClick={() => {
              if (!confirm('Remove this booking? That cannot be undone.')) return
              run(async sb => { await deleteAppointment(sb, booking.id); onBack() })
            }}
            className="text-xs font-bold flex items-center gap-1.5 mt-4" style={{ color: '#c0392b' }}>
            <Trash2 className="w-3.5 h-3.5" /> Remove this booking
          </button>
        </div>
      )}

      {/* The day log. Separate from the booking's own note, which is about the
          stay as a whole — this is what happened on a given day. */}
      <div className="card">
        <p className="text-xs font-bold uppercase tracking-wide mb-3 flex items-center gap-1.5"
          style={{ color: '#b08d57' }}>
          <NotebookPen className="w-3.5 h-3.5" /> Day by day
        </p>

        <div className="flex gap-2 mb-3">
          <input type="date" value={onDate} onChange={e => setOnDate(e.target.value)}
            className="input" style={{ maxWidth: '10rem' }} />
          <input value={entry} onChange={e => setEntry(e.target.value)} className="input flex-1"
            placeholder="Ate everything, slept through." />
          <button disabled={busy || !entry.trim()} className="btn-primary px-3"
            onClick={() => run(async sb => {
              await saveLog(sb, { appointmentId: booking.id, providerId: booking.providerId,
                                  onDate, body: entry, createdBy: postedBy })
              setEntry(''); await loadLogs()
            })}>
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {logs.length === 0 && (
          <p className="text-sm" style={{ color: '#73775b' }}>Nothing logged yet.</p>
        )}
        {logs.map(l => (
          <div key={l.id} className="flex items-start justify-between gap-2 py-1.5"
            style={{ borderTop: '1px solid #f5f0e0' }}>
            <div className="min-w-0">
              <p className="text-xs font-bold" style={{ color: '#b08d57' }}>{formatDay(l.onDate)}</p>
              <p className="text-sm whitespace-pre-wrap" style={{ color: '#4A2C0A' }}>{l.body}</p>
            </div>
            <button disabled={busy} style={{ color: '#c0392b' }}
              onClick={() => run(async sb => { await deleteLog(sb, l.id); await loadLogs() })}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── One customer ────────────────────────────────────────────────────────────

function CustomerDetail({ customer, pets, appointments, notes, onBack, onOpenBooking, onChanged, run, busy, postedBy }) {
  const [addingPet, setAddingPet] = useState(false)
  const [booking, setBooking]     = useState(false)

  const mine   = pets.filter(p => p.customerId === customer.id)
  const visits = groupAppointments(appointments.filter(a => a.customerId === customer.id), todayIST())
  const wa     = waLink(customer.phone)

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs font-bold flex items-center gap-1" style={{ color: '#b08d57' }}>
        <ChevronLeft className="w-3.5 h-3.5" /> Back
      </button>

      <div className="card">
        <h2 className="font-black" style={{ color: '#7a4900' }}>{customer.name}</h2>
        {customer.notes && <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: '#4A2C0A' }}>{customer.notes}</p>}

        {/* Reaching one customer, as opposed to broadcasting to all of them.
            Plain links: the provider has these details because they typed them,
            so there is nothing to gate and nothing to send on their behalf. */}
        <div className="flex flex-wrap gap-2 mt-3">
          {customer.phone && (
            <a href={`tel:${customer.phone}`} className="btn-secondary inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
              <Phone className="w-3.5 h-3.5" /> Call
            </a>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </a>
          )}
          {customer.email && (
            <a href={`mailto:${customer.email}`} className="btn-secondary inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
              <Mail className="w-3.5 h-3.5" /> Email
            </a>
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#b08d57' }}>Pets</p>
          <button onClick={() => setAddingPet(v => !v)} className="text-xs font-bold flex items-center gap-1" style={{ color: '#b08d57' }}>
            <Plus className="w-3.5 h-3.5" /> Add a pet
          </button>
        </div>
        {mine.length === 0 && !addingPet && <p className="text-sm" style={{ color: '#73775b' }}>None yet.</p>}
        {mine.map(p => (
          <div key={p.id} className="text-sm py-1.5" style={{ color: '#4A2C0A' }}>
            <span className="font-bold">{p.name}</span>
            <span style={{ color: '#b08d57' }}>
              {[p.breed, p.species].filter(Boolean).length ? ` · ${[p.breed, p.species].filter(Boolean).join(' · ')}` : ''}
            </span>
            {p.noteId && (
              <span className="ml-2 text-xs inline-flex items-center gap-1" style={{ color: '#5f7a3a' }}>
                <Link2 className="w-3 h-3" /> linked to their Pippy note
              </span>
            )}
            {p.notes && <p className="text-xs" style={{ color: '#73775b' }}>{p.notes}</p>}
          </div>
        ))}
        {addingPet && (
          <div className="mt-2">
            <PetForm busy={busy} notes={notes}
              initial={{ name: '', species: '', breed: '', notes: '', noteId: '' }}
              onCancel={() => setAddingPet(false)}
              onSave={f => run(async sb => {
                await savePet(sb, { ...f, providerId: customer.providerId, customerId: customer.id })
                setAddingPet(false)
              })} />
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#b08d57' }}>Bookings</p>
          <button onClick={() => setBooking(v => !v)} className="text-xs font-bold flex items-center gap-1" style={{ color: '#b08d57' }}>
            <Plus className="w-3.5 h-3.5" /> Book a stay
          </button>
        </div>
        {[['current', 'With you now'], ['upcoming', 'Coming up'], ['past', 'Past']].map(([k, title]) =>
          visits[k].length > 0 && (
            <div key={k} className="mb-1">
              <p className="text-xs font-bold mt-2" style={{ color: '#b08d57' }}>{title}</p>
              {visits[k].map(a => (
                <BookingRow key={a.id} a={a} pet={mine.find(p => p.id === a.providerPetId)}
                  onOpen={() => onOpenBooking(a.id)} />
              ))}
            </div>
          ))}
        {Object.values(visits).every(v => v.length === 0) && !booking && (
          <p className="text-sm" style={{ color: '#73775b' }}>None yet.</p>
        )}
        {booking && (
          <div className="mt-3">
            <AppointmentForm busy={busy} pets={mine}
              initial={{ kind: 'Boarding', startsOn: todayIST(), endsOn: '', startsAt: '',
                         status: 'booked', notes: '', providerPetId: '',
                         trialDone: false, criteriaMet: false }}
              onCancel={() => setBooking(false)}
              onSave={f => run(async sb => {
                await saveAppointment(sb, { ...f, providerId: customer.providerId,
                                            customerId: customer.id, createdBy: postedBy })
                setBooking(false)
              })} />
          </div>
        )}
      </div>

      <button
        onClick={() => {
          if (!confirm(`Remove ${customer.name}? Their pets and bookings go too, and that cannot be undone.`)) return
          run(async sb => { await deleteCustomer(sb, customer.id); onBack() })
        }}
        className="text-xs font-bold flex items-center gap-1.5" style={{ color: '#c0392b' }}>
        <Trash2 className="w-3.5 h-3.5" /> Remove this customer
      </button>
    </div>
  )
}

// ── The book ────────────────────────────────────────────────────────────────

export default function ProviderBook({ providerIds = [], primaryProviderId, providerName, postedBy }) {
  const [book, setBook]   = useState(null)
  const [notes, setNotes] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy]   = useState(false)
  const [view, setView]   = useState({ kind: 'dashboard' })
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')

  const ids = useMemo(() => [...new Set(providerIds.filter(Boolean))], [providerIds])

  const load = useCallback(async () => {
    try {
      const supabase = await getSupabaseProvider()
      if (!supabase) return
      setBook(await getBook(supabase, ids))
      const { data } = await supabase
        .from('provider_notes').select('id, provider_id, pet_label')
        .in('provider_id', ids).order('sent_at', { ascending: false })
      setNotes((data || []).map(r => ({ id: r.id, providerId: r.provider_id, petLabel: r.pet_label })))
      setError(null)
    } catch (e) {
      reportHandled(e, { view: 'provider-book' })
      setError(e.message || 'Could not load your book.')
      setBook({ customers: [], pets: [], appointments: [] })
    }
  }, [ids])
  useEffect(() => { load() }, [load])

  // Every write goes through here, so a failure is reported the same way
  // wherever it happened and the book is always re-read afterwards.
  const run = useCallback(async (fn) => {
    setBusy(true); setError(null)
    try { await fn(await getSupabaseProvider()); await load() }
    catch (e) { reportHandled(e, { view: 'provider-book' }); setError(e.message || 'That did not save.') }
    finally { setBusy(false) }
  }, [load])

  if (book === null) {
    return <div className="card flex items-center gap-2" style={{ color: '#73775b' }}>
      <Loader2 className="w-4 h-4 animate-spin" /> Loading your book…
    </div>
  }

  const today   = todayIST()
  const diary   = groupAppointments(book.appointments, today)
  const summary = bookSummary(book, today)
  const custById = Object.fromEntries(book.customers.map(c => [c.id, c]))
  const petById  = Object.fromEntries(book.pets.map(p => [p.id, p]))

  const Err = error ? (
    <div className="flex items-start gap-2 p-3 rounded-xl text-sm mb-3"
      style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
    </div>
  ) : null

  // ── One booking ───────────────────────────────────────────────────────────
  if (view.kind === 'booking') {
    const b = book.appointments.find(a => a.id === view.id)
    if (!b) return <div>{Err}<button onClick={() => setView({ kind: 'dashboard' })} className="btn-secondary">Back</button></div>
    return <>{Err}<BookingDetail booking={b} customer={custById[b.customerId]} pets={book.pets}
      busy={busy} run={run} postedBy={postedBy}
      onBack={() => setView({ kind: 'customer', id: b.customerId })} onChanged={load} /></>
  }

  // ── One customer ──────────────────────────────────────────────────────────
  if (view.kind === 'customer') {
    const c = custById[view.id]
    if (!c) return <div>{Err}<button onClick={() => setView({ kind: 'dashboard' })} className="btn-secondary">Back</button></div>
    return <>{Err}<CustomerDetail customer={c} pets={book.pets} appointments={book.appointments}
      notes={notes.filter(n => n.providerId === c.providerId)}
      busy={busy} run={run} postedBy={postedBy}
      onOpenBooking={id => setView({ kind: 'booking', id })}
      onBack={() => setView({ kind: 'dashboard' })} onChanged={load} /></>
  }

  // ── A list behind a tile ──────────────────────────────────────────────────
  if (view.kind === 'list') {
    const TITLES = { here: 'With you now', upcoming: 'Coming up', past: 'Past',
                     customers: 'Customers', attention: 'Needs attention' }
    const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 7)
    const within7 = soon.toISOString().slice(0, 10)
    const rows = view.bucket === 'here'      ? diary.current
               : view.bucket === 'upcoming'  ? diary.upcoming
               : view.bucket === 'past'      ? diary.past
               : view.bucket === 'attention' ? diary.upcoming.filter(
                   a => a.startsOn <= within7 && (!a.trialDone || !a.criteriaMet))
               : []
    const q = search.trim().toLowerCase()
    const shown = view.bucket !== 'customers' ? [] : (q
      ? book.customers.filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
      : book.customers)

    return (
      <div className="space-y-3">
        <button onClick={() => setView({ kind: 'dashboard' })} className="text-xs font-bold flex items-center gap-1" style={{ color: '#b08d57' }}>
          <ChevronLeft className="w-3.5 h-3.5" /> Dashboard
        </button>
        <h2 className="font-black" style={{ color: '#7a4900' }}>
          {TITLES[view.bucket]} ({view.bucket === 'customers' ? book.customers.length : rows.length})
        </h2>
        {Err}

        {view.bucket === 'customers' ? (
          <>
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="input w-full" placeholder="Search by name or phone…" />
            <div className="grid lg:grid-cols-2 gap-3">
            {shown.map(c => {
              const n = book.pets.filter(p => p.customerId === c.id).length
              return (
                <button key={c.id} onClick={() => setView({ kind: 'customer', id: c.id })}
                  className="card w-full text-left flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-sm" style={{ color: '#4A2C0A' }}>{c.name}</p>
                    <p className="text-xs" style={{ color: '#73775b' }}>
                      {[c.phone, n ? `${n} pet${n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'No details yet'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: '#b08d57' }} />
                </button>
              )
            })}
            </div>
            {shown.length === 0 && <p className="text-sm text-center py-4" style={{ color: '#73775b' }}>Nobody matches that.</p>}
          </>
        ) : (
          <div className="card">
            {rows.map(a => (
              <BookingRow key={a.id} a={a} pet={petById[a.providerPetId]}
                customer={custById[a.customerId]} onOpen={() => setView({ kind: 'booking', id: a.id })} />
            ))}
            {rows.length === 0 && <p className="text-sm" style={{ color: '#73775b' }}>Nothing here.</p>}
          </div>
        )}
      </div>
    )
  }

  // ── The dashboard ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {Err}

      {/* One grid rather than three stacked ones, so the tiles can rearrange
          with the screen instead of staying in phone-shaped rows. Two columns
          on a phone, four from `lg` — where "with you now" keeps its weight by
          spanning two columns and two rows rather than by being the only thing
          on its line. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summary.needsAttention > 0 && (
          <div className="col-span-2 lg:col-span-4">
            <Tile tone="warn" label="Needs attention" value={summary.needsAttention}
              hint="Arriving within a week with a trial or criteria outstanding"
              onClick={() => setView({ kind: 'list', bucket: 'attention' })} />
          </div>
        )}

        <div className="row-span-2 lg:col-span-2 flex">
          <Tile tone="here" hero label="With you now" value={summary.here}
            hint="Pets in your care today"
            onClick={() => setView({ kind: 'list', bucket: 'here' })}>
            {/* The hero tile is two rows tall on a wide screen, and a single
                digit does not fill that. Who is actually in is the next thing
                asked after how many, so it goes here rather than one tap away. */}
            {diary.current.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {diary.current.slice(0, 8).map(a => (
                  <span key={a.id} className="text-xs font-bold px-2 py-1 rounded-full"
                    style={{ backgroundColor: '#ffffff', color: '#7a4900' }}>
                    {petById[a.providerPetId]?.name || custById[a.customerId]?.name || a.kind}
                  </span>
                ))}
                {diary.current.length > 8 && (
                  <span className="text-xs font-bold px-2 py-1" style={{ color: '#b08d57' }}>
                    +{diary.current.length - 8} more
                  </span>
                )}
              </div>
            )}
          </Tile>
        </div>
        <Tile label="Coming up" value={summary.upcoming} hint="Booked, not yet arrived"
          onClick={() => setView({ kind: 'list', bucket: 'upcoming' })} />
        <Tile label="Past stays" value={summary.past} hint="Everything behind you"
          onClick={() => setView({ kind: 'list', bucket: 'past' })} />
        <Tile label="Customers" value={summary.customers} hint="In your book"
          onClick={() => setView({ kind: 'list', bucket: 'customers' })} />
        <Tile label="Pets" value={summary.pets} hint="Across those customers"
          onClick={() => setView({ kind: 'list', bucket: 'customers' })} />
      </div>

      {adding ? (
        <CustomerForm busy={busy} initial={{ name: '', phone: '', email: '', notes: '' }}
          onCancel={() => setAdding(false)}
          onSave={f => run(async sb => {
            // Straight into the new customer, because the next thing anybody
            // does is add their pet and book them in.
            const c = await saveCustomer(sb, { ...f, providerId: primaryProviderId, createdBy: postedBy })
            setAdding(false); setView({ kind: 'customer', id: c.id })
          })} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {/* whitespace-nowrap on both: without it the narrower button wrapped
              its icon onto its own line and the two sat at different heights. */}
          <button onClick={() => setAdding(true)} className="btn-primary gap-1.5 whitespace-nowrap">
            <Plus className="w-4 h-4 shrink-0" /> Add a customer
          </button>
          <button onClick={() => setView({ kind: 'list', bucket: 'customers' })}
            className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap">
            <Users className="w-4 h-4 shrink-0" /> All customers
          </button>
        </div>
      )}

      {book.customers.length === 0 && !adding && (
        <div className="card text-center py-8">
          <Home className="w-8 h-8 mx-auto mb-3" style={{ color: '#b08d57' }} />
          <p className="font-bold mb-1" style={{ color: '#4A2C0A' }}>Your book is empty</p>
          <p className="text-sm" style={{ color: '#73775b' }}>
            Add anyone you look after, whether or not they use Pippy. Only you can
            see it.
          </p>
        </div>
      )}

      {/* Broadcasting belongs on the dashboard: it is a thing you do to the
          whole book, not to one customer. Messaging ONE customer lives on their
          own screen, where their number is. */}
      <ProviderBroadcast providerId={primaryProviderId} providerName={providerName} />
    </div>
  )
}
