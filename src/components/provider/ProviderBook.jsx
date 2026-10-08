// The provider's own book — customers, their animals, and the diary.
//
// This is the half that works with no customer ever using Pippy, which is most
// of them. A boarder types "Mrs Rao, 98765…, golden retriever called Simba, in
// the 14th to the 18th" because that is the job, and none of it requires the
// other side of the app to exist.
//
// Where the two halves meet: a card can be LINKED to an inform note, when that
// customer does use Pippy and has told this business about their pet. The link
// is a pointer, never a merge — the note still carries everything the provider
// may see, and the card still carries only what they typed themselves.

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Loader2, AlertCircle, Plus, X, Users, CalendarDays, Phone, Mail,
  Trash2, PawPrint, Link2, ChevronLeft,
} from 'lucide-react'
import { getSupabaseProvider } from '../../lib/supabase.js'
import { reportHandled } from '../../lib/errorReport.js'
import { todayIST } from '../../lib/dates.js'
import { formatDay } from '../../lib/providerBrief.js'
import {
  getBook, saveCustomer, savePet, saveAppointment,
  deleteCustomer, deleteAppointment, groupAppointments,
  APPOINTMENT_KINDS, APPOINTMENT_STATUS,
} from '../../lib/providerBook.js'

const STATUS_STYLE = {
  booked:    { label: 'Booked',    bg: '#fff3c0', fg: '#7a4900' },
  completed: { label: 'Completed', bg: '#eef3e2', fg: '#44562a' },
  cancelled: { label: 'Cancelled', bg: '#f5f0e0', fg: '#5f624b' },
  no_show:   { label: 'No show',   bg: '#fdeaea', fg: '#8a2b20' },
}

const field = 'input w-full'
const label = 'label text-xs'

function Field({ label: l, ...rest }) {
  return (
    <div>
      <label className={label}>{l}</label>
      <input className={field} {...rest} />
    </div>
  )
}

// ── Add or edit a customer ──────────────────────────────────────────────────

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
        <label className={label}>Notes</label>
        <textarea name="notes" value={f.notes || ''} onChange={set} rows={2} className={field}
          placeholder="Pays by UPI. Prefers evening pickup." />
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave(f)} disabled={busy || !f.name?.trim()}
          className="btn-primary flex-1 justify-center">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

// ── Book a stay ─────────────────────────────────────────────────────────────

function AppointmentForm({ initial, pets, onSave, onCancel, busy }) {
  const [f, setF] = useState(initial)
  const set = e => setF(p => ({ ...p, [e.target.name]: e.target.value }))
  const bad = f.endsOn && f.startsOn && f.endsOn < f.startsOn
  return (
    <div className="rounded-2xl p-4 space-y-3 mt-3" style={{ backgroundColor: '#fff9e0', border: '1.5px solid #f2b83d' }}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>What</label>
          <select name="kind" value={f.kind} onChange={set} className={field}>
            {APPOINTMENT_KINDS.map(k => <option key={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Which pet</label>
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
          <label className={label}>Status</label>
          <select name="status" value={f.status} onChange={set} className={field}>
            {APPOINTMENT_STATUS.map(s => <option key={s} value={s}>{STATUS_STYLE[s].label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={label}>Notes</label>
        <textarea name="notes" value={f.notes || ''} onChange={set} rows={2} className={field}
          placeholder="Bringing own food." />
      </div>
      {bad && <p className="text-xs" style={{ color: '#c0392b' }}>The end date is before the start date.</p>}
      <div className="flex gap-2">
        <button onClick={() => onSave(f)} disabled={busy || !f.startsOn || bad}
          className="btn-primary flex-1 justify-center">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save booking'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

// ── One customer, opened ────────────────────────────────────────────────────

function CustomerDetail({ customer, pets, appointments, notes, onBack, onChanged }) {
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)
  const [addingPet, setAddingPet] = useState(false)
  const [booking, setBooking] = useState(false)
  const [petForm, setPetForm] = useState({ name: '', species: '', breed: '', notes: '', noteId: '' })

  const run = useCallback(async (fn) => {
    setBusy(true); setError(null)
    try { await fn(await getSupabaseProvider()); await onChanged() }
    catch (e) { reportHandled(e, { view: 'provider-book' }); setError(e.message || 'That did not save.') }
    finally { setBusy(false) }
  }, [onChanged])

  const mine     = pets.filter(p => p.customerId === customer.id)
  const myVisits = groupAppointments(
    appointments.filter(a => a.customerId === customer.id), todayIST())

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs font-bold flex items-center gap-1" style={{ color: '#b08d57' }}>
        <ChevronLeft className="w-3.5 h-3.5" /> All customers
      </button>

      <div className="card">
        <h2 className="font-black" style={{ color: '#7a4900' }}>{customer.name}</h2>
        <div className="flex flex-wrap gap-3 text-xs mt-1" style={{ color: '#5f624b' }}>
          {customer.phone && <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5" style={{ color: '#2f7286' }}><Phone className="w-3 h-3" />{customer.phone}</a>}
          {customer.email && <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5" style={{ color: '#2f7286' }}><Mail className="w-3 h-3" />{customer.email}</a>}
        </div>
        {customer.notes && <p className="text-sm mt-2 whitespace-pre-wrap" style={{ color: '#4A2C0A' }}>{customer.notes}</p>}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm" style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {/* Their animals */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#b08d57' }}>Pets</p>
          <button onClick={() => setAddingPet(v => !v)} className="text-xs font-bold flex items-center gap-1" style={{ color: '#b08d57' }}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {mine.length === 0 && !addingPet && (
          <p className="text-sm" style={{ color: '#73775b' }}>None yet.</p>
        )}
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
          <div className="rounded-2xl p-4 space-y-3 mt-2" style={{ backgroundColor: '#fff9e0', border: '1.5px solid #f2b83d' }}>
            <Field label="Name *" value={petForm.name} onChange={e => setPetForm(f => ({ ...f, name: e.target.value }))} placeholder="Simba" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Species" value={petForm.species} onChange={e => setPetForm(f => ({ ...f, species: e.target.value }))} placeholder="Dog" />
              <Field label="Breed" value={petForm.breed} onChange={e => setPetForm(f => ({ ...f, breed: e.target.value }))} placeholder="Golden Retriever" />
            </div>
            {/* The bridge between the two halves. Only notes sent to THIS
                business are offered, and the database refuses anything else. */}
            {notes.length > 0 && (
              <div>
                <label className={label}>Link to a note they sent you</label>
                <select className={field} value={petForm.noteId}
                  onChange={e => setPetForm(f => ({ ...f, noteId: e.target.value }))}>
                  <option value="">— not linked —</option>
                  {notes.map(n => <option key={n.id} value={n.id}>{n.petLabel}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={label}>Notes</label>
              <textarea rows={2} className={field} value={petForm.notes}
                onChange={e => setPetForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Nervous with men in hats." />
            </div>
            <div className="flex gap-2">
              <button disabled={busy || !petForm.name.trim()} className="btn-primary flex-1 justify-center"
                onClick={() => run(async s => {
                  await savePet(s, { ...petForm, providerId: customer.providerId, customerId: customer.id })
                  setPetForm({ name: '', species: '', breed: '', notes: '', noteId: '' })
                  setAddingPet(false)
                })}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save pet'}
              </button>
              <button onClick={() => setAddingPet(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Their bookings */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#b08d57' }}>Bookings</p>
          <button onClick={() => setBooking(v => !v)} className="text-xs font-bold flex items-center gap-1" style={{ color: '#b08d57' }}>
            <Plus className="w-3.5 h-3.5" /> Book
          </button>
        </div>
        {[['current', 'With you now'], ['upcoming', 'Coming up'], ['past', 'Past']].map(([k, title]) =>
          myVisits[k].length > 0 && (
            <div key={k} className="mb-2">
              <p className="text-xs font-bold" style={{ color: '#b08d57' }}>{title}</p>
              {myVisits[k].map(a => (
                <AppointmentRow key={a.id} a={a} pets={mine} busy={busy}
                  onDelete={() => run(s => deleteAppointment(s, a.id))} />
              ))}
            </div>
          ))}
        {Object.values(myVisits).every(v => v.length === 0) && !booking && (
          <p className="text-sm" style={{ color: '#73775b' }}>None yet.</p>
        )}
        {booking && (
          <AppointmentForm busy={busy} pets={mine}
            initial={{ kind: 'Boarding', startsOn: todayIST(), endsOn: '', startsAt: '', status: 'booked', notes: '', providerPetId: '' }}
            onCancel={() => setBooking(false)}
            onSave={f => run(async s => {
              await saveAppointment(s, { ...f, providerId: customer.providerId, customerId: customer.id })
              setBooking(false)
            })} />
        )}
      </div>

      <button
        onClick={() => {
          if (!confirm(`Remove ${customer.name}? Their pets and bookings go too, and that cannot be undone.`)) return
          run(async s => { await deleteCustomer(s, customer.id); onBack() })
        }}
        className="text-xs font-bold flex items-center gap-1.5" style={{ color: '#c0392b' }}>
        <Trash2 className="w-3.5 h-3.5" /> Remove this customer
      </button>
    </div>
  )
}

function AppointmentRow({ a, pets, onDelete, busy }) {
  const s   = STATUS_STYLE[a.status] || STATUS_STYLE.booked
  const pet = pets.find(p => p.id === a.providerPetId)
  const when = [formatDay(a.startsOn), a.endsOn && a.endsOn !== a.startsOn ? `→ ${formatDay(a.endsOn)}` : null]
    .filter(Boolean).join(' ')
  return (
    <div className="flex items-start justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <p className="text-sm" style={{ color: '#4A2C0A' }}>
          <span className="font-bold">{a.kind}</span>
          {pet && <span style={{ color: '#b08d57' }}> · {pet.name}</span>}
        </p>
        <p className="text-xs" style={{ color: '#73775b' }}>
          {when}{a.startsAt ? ` · ${a.startsAt.slice(0, 5)}` : ''}
        </p>
        {a.notes && <p className="text-xs" style={{ color: '#73775b' }}>{a.notes}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs px-2 py-0.5 rounded-full font-bold"
          style={{ backgroundColor: s.bg, color: s.fg }}>{s.label}</span>
        <button onClick={onDelete} disabled={busy} style={{ color: '#c0392b', opacity: busy ? 0.4 : 1 }}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── The book ────────────────────────────────────────────────────────────────

export default function ProviderBook({ providerIds = [], primaryProviderId, postedBy }) {
  const [book, setBook]     = useState(null)
  // The notes a card can be LINKED to. Fetched here rather than handed down
  // from the inbox: the book is the default tab, so the inbox may never have
  // mounted, and a link dropdown that is empty until you visit another screen
  // is worse than one that costs a query.
  const [notes, setNotes]   = useState([])
  const [error, setError]   = useState(null)
  const [tab, setTab]       = useState('diary')   // diary | customers
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy]     = useState(false)
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

  if (book === null) {
    return <div className="card flex items-center gap-2" style={{ color: '#73775b' }}>
      <Loader2 className="w-4 h-4 animate-spin" /> Loading your book…
    </div>
  }

  const open = book.customers.find(c => c.id === openId)
  if (open) {
    return <CustomerDetail customer={open} pets={book.pets} appointments={book.appointments}
      notes={notes.filter(n => n.providerId === open.providerId)}
      onBack={() => setOpenId(null)} onChanged={load} />
  }

  const diary = groupAppointments(book.appointments, todayIST())
  const byId  = Object.fromEntries(book.customers.map(c => [c.id, c]))
  const petById = Object.fromEntries(book.pets.map(p => [p.id, p]))
  const q = search.trim().toLowerCase()
  const shown = q
    ? book.customers.filter(c =>
        c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
    : book.customers

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {[['diary', 'Diary', CalendarDays], ['customers', 'Customers', Users]].map(([k, l, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
            style={tab === k ? { backgroundColor: '#ffde59', color: '#7a4900' }
                             : { backgroundColor: '#f5f0e0', color: '#73775b' }}>
            <Icon className="w-3.5 h-3.5" /> {l}
            {k === 'customers' && book.customers.length > 0 && ` (${book.customers.length})`}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm" style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {tab === 'diary' && (
        <div className="space-y-5">
          {[['current', 'With you now'], ['upcoming', 'Coming up'], ['past', 'Past']].map(([k, title]) =>
            diary[k].length > 0 && (
              <div key={k}>
                <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#b08d57' }}>
                  {title} ({diary[k].length})
                </p>
                <div className="card space-y-1">
                  {diary[k].map(a => (
                    <button key={a.id} onClick={() => setOpenId(a.customerId)} className="w-full text-left">
                      <AppointmentRow a={a} pets={Object.values(petById)} busy onDelete={() => {}} />
                      <p className="text-xs -mt-1.5 mb-1" style={{ color: '#b08d57' }}>
                        {byId[a.customerId]?.name}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          {book.appointments.length === 0 && (
            <div className="card text-center py-8">
              <CalendarDays className="w-8 h-8 mx-auto mb-3" style={{ color: '#b08d57' }} />
              <p className="font-bold mb-1" style={{ color: '#4A2C0A' }}>Nothing booked</p>
              <p className="text-sm" style={{ color: '#73775b' }}>
                Add a customer, then book them in. None of this needs them to use
                the Pippy app.
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'customers' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="input flex-1" placeholder="Search by name or phone…" />
            <button onClick={() => setAdding(v => !v)} className="btn-primary gap-1.5">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>

          {adding && (
            <CustomerForm busy={busy} initial={{ name: '', phone: '', email: '', notes: '' }}
              onCancel={() => setAdding(false)}
              onSave={async f => {
                setBusy(true)
                try {
                  await saveCustomer(await getSupabaseProvider(), {
                    ...f, providerId: primaryProviderId, createdBy: postedBy,
                  })
                  setAdding(false); await load()
                } catch (e) {
                  reportHandled(e, { view: 'provider-book' })
                  setError(e.message || 'That did not save.')
                } finally { setBusy(false) }
              }} />
          )}

          {shown.map(c => {
            const n = book.pets.filter(p => p.customerId === c.id).length
            return (
              <button key={c.id} onClick={() => setOpenId(c.id)}
                className="card w-full text-left flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm" style={{ color: '#4A2C0A' }}>{c.name}</p>
                  <p className="text-xs" style={{ color: '#73775b' }}>
                    {[c.phone, n ? `${n} pet${n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'No details yet'}
                  </p>
                </div>
                <PawPrint className="w-4 h-4 shrink-0" style={{ color: '#b08d57' }} />
              </button>
            )
          })}

          {book.customers.length === 0 && !adding && (
            <div className="card text-center py-8">
              <Users className="w-8 h-8 mx-auto mb-3" style={{ color: '#b08d57' }} />
              <p className="font-bold mb-1" style={{ color: '#4A2C0A' }}>No customers yet</p>
              <p className="text-sm" style={{ color: '#73775b' }}>
                This is your own book — add anyone you look after, whether or not
                they use Pippy. Only you can see it.
              </p>
            </div>
          )}
          {book.customers.length > 0 && shown.length === 0 && (
            <p className="text-sm text-center py-4" style={{ color: '#73775b' }}>Nobody matches that.</p>
          )}
        </div>
      )}
    </div>
  )
}
