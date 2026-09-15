import { useEffect, useState } from 'react'
import { Stethoscope, Syringe, AlertTriangle, Bell, Calendar, CheckCircle, Clock, AlertCircle, TriangleAlert } from 'lucide-react'
import { getMedicalHistory, getVaccinations, getAllergies, getReminders } from '../lib/storage.js'
import { format, parseISO, isValid, isBefore, addDays } from 'date-fns'

function parseDate(str) {
  if (!str) return null
  try {
    const d = parseISO(str)
    return isValid(d) ? d : null
  } catch {
    return null
  }
}

function VaxStatus({ nextDue }) {
  if (!nextDue) return null
  const today = new Date()
  const due = parseDate(nextDue)
  if (!due) return null
  if (isBefore(due, today)) return <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Overdue</span>
  if (isBefore(due, addDays(today, 30))) return <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full flex items-center gap-1"><Clock className="w-3 h-3" /> Due soon</span>
  return <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Up to date</span>
}

const TYPE_CFG = {
  medical:     { icon: Stethoscope, bg: '#dceff5', color: '#2f7286', dot: '#2f7286' },
  vaccination: { icon: Syringe,     bg: '#fdeef2', color: '#b2566f', dot: '#b2566f' },
  allergy:     { icon: AlertTriangle, bg: '#fdeaea', color: '#c0392b', dot: '#c0392b' },
  reminder:    { icon: Bell,         bg: '#fff3c0', color: '#c9891f', dot: '#c9891f' },
}

function buildEvents(medicalRecords, vaccinations, allergies, reminders) {
  const today = new Date()
  const events = []

  medicalRecords.forEach(r => {
    const date = parseDate(r.date)
    events.push({
      id: `med-${r.id}`, kind: 'medical',
      date, sortDate: date || new Date(r.createdAt),
      title: r.title,
      subtitle: `${r.type}${r.vet ? ` · ${r.vet}` : ''}${r.cost ? ` · $${r.cost}` : ''}`,
      body: r.description,
      isAbnormal: r.isAbnormal, abnormalities: r.abnormalities || [],
      isFuture: date ? date > today : false,
      raw: r,
    })
  })

  vaccinations.forEach(r => {
    const date = parseDate(r.dateGiven)
    events.push({
      id: `vax-${r.id}`, kind: 'vaccination',
      date, sortDate: date || new Date(r.createdAt),
      title: r.name,
      subtitle: `Given${r.vet ? ` by ${r.vet}` : ''}${r.batchNumber ? ` · Batch ${r.batchNumber}` : ''}`,
      body: r.notes,
      extra: r.nextDue ? `Next due: ${format(parseDate(r.nextDue) || new Date(r.nextDue), 'MMM d, yyyy')}` : null,
      nextDue: r.nextDue,
      isFuture: date ? date > today : false,
      raw: r,
    })
    // Add nextDue as a future reminder event
    if (r.nextDue) {
      const nd = parseDate(r.nextDue)
      if (nd) {
        events.push({
          id: `vax-due-${r.id}`, kind: 'reminder',
          date: nd, sortDate: nd,
          title: `${r.name} — Due`,
          subtitle: 'Upcoming vaccination',
          body: null,
          isFuture: nd > today,
          raw: r,
        })
      }
    }
  })

  allergies.forEach(r => {
    const date = parseDate(r.diagnosedDate)
    events.push({
      id: `alg-${r.id}`, kind: 'allergy',
      date, sortDate: date || new Date(r.createdAt),
      title: `Allergy: ${r.allergen}`,
      subtitle: `${r.type} · ${r.severity}${r.reactions?.length ? ` · ${r.reactions.join(', ')}` : ''}`,
      body: r.notes,
      isFuture: date ? date > today : false,
      raw: r,
    })
  })

  reminders.forEach(r => {
    const date = parseDate(r.dueDate)
    events.push({
      id: `rem-${r.id}`, kind: 'reminder',
      date, sortDate: date || new Date(r.createdAt),
      title: r.type,
      subtitle: `Reminder${r.notes ? ` · ${r.notes}` : ''}`,
      body: null,
      // ✅ Past-dated reminders go to History, not Upcoming
      isFuture: date ? date > today : false,
      raw: r,
    })
  })

  const toMs = d => (d instanceof Date && !isNaN(d) ? d.getTime() : 0)
  return events.sort((a, b) => toMs(b.sortDate) - toMs(a.sortDate))
}

// ── Event Card ────────────────────────────────────────────────────────────────

function EventCard({ event }) {
  const cfg = TYPE_CFG[event.kind] || TYPE_CFG.medical
  const Icon = cfg.icon

  return (
    <div className="relative flex items-start gap-3 pb-4">
      {/* Dot — sits centred on the left line */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center z-10"
        style={{
          backgroundColor: event.isAbnormal ? '#fdeaea' : cfg.bg,
          border: `2px solid ${event.isAbnormal ? '#c0392b' : cfg.dot}`,
        }}>
        {event.isAbnormal
          ? <TriangleAlert className="w-4 h-4 text-red-500" />
          : <Icon className="w-4 h-4" style={{ color: cfg.color }} />}
      </div>

      {/* Card */}
      <div className="flex-1 min-w-0 rounded-xl p-3 border shadow-sm"
        style={{
          backgroundColor: event.isAbnormal ? '#fdeaea' : 'white',
          borderColor: event.isAbnormal ? '#e79a94' : '#ebe3d3',
        }}>
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-sm" style={{ color: '#7a4900' }}>{event.title}</p>
              {event.isAbnormal && (
                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <TriangleAlert className="w-3 h-3" /> {event.abnormalities?.length} Abnormal
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>{event.subtitle}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
            {event.nextDue && <VaxStatus nextDue={event.nextDue} />}
            {event.isFuture && !event.nextDue && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: '#dceff5', color: '#2f7286' }}>Upcoming</span>
            )}
            {event.date && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
                {format(event.sortDate, 'MMM d, yyyy')}
              </span>
            )}
          </div>
        </div>
        {event.body && (
          <p className="text-xs mt-2 whitespace-pre-line leading-relaxed" style={{ color: '#7a4900' }}>{event.body}</p>
        )}
        {event.extra && (
          <p className="text-xs mt-1.5 font-medium" style={{ color: '#b2566f' }}>{event.extra}</p>
        )}
        {event.isAbnormal && event.abnormalities?.length > 0 && (
          <div className="mt-2 space-y-1">
            {event.abnormalities.map((a, i) => {
              const clr = { Severe: ['#c0392b','#fdeaea'], Moderate: ['#c9891f','#fff3c0'], Mild: ['#c9891f','#fff3c0'] }[a.severity] || ['#c0392b','#fdeaea']
              return (
                <div key={i} className="text-xs rounded-lg px-2 py-1"
                  style={{ backgroundColor: clr[1], color: clr[0] }}>
                  <span className="font-bold">{a.parameter}</span> {a.value}{a.unit} —{' '}
                  <span className="font-semibold">{a.status} ({a.severity})</span>
                  {a.clinicalNote && <span className="ml-1 opacity-75">· {a.clinicalNote}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section (groups by month, draws timeline line) ────────────────────────────

function Section({ title, items }) {
  if (items.length === 0) return null

  // Group by year-month — preserve insertion order explicitly
  const groupOrder = []
  const groups = {}
  items.forEach(e => {
    const key = format(e.sortDate, 'MMMM yyyy')
    if (!groups[key]) { groups[key] = []; groupOrder.push(key) }
    groups[key].push(e)
  })

  return (
    <div className="mb-8">
      <h3 className="text-xs font-black uppercase tracking-widest mb-4"
        style={{ color: '#73775b' }}>{title}</h3>
      {groupOrder.map(month => { const evts = groups[month]; return (
        <div key={month} className="mb-5">
          {/* Month header */}
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-3.5 h-3.5" style={{ color: '#c99a2e' }} />
            <span className="text-sm font-bold" style={{ color: '#7a4900' }}>{month}</span>
            <div className="flex-1 h-px" style={{ backgroundColor: '#ebe3d3' }} />
          </div>

          {/* Timeline: line on the left, dots aligned to it */}
          <div className="relative pl-4">
            <div className="absolute top-4 bottom-0 w-0.5 rounded-full"
              style={{ left: '15px', backgroundColor: '#ebe3d3' }} />
            {evts.map(e => <EventCard key={e.id} event={e} />)}
          </div>
        </div>
      )})}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Timeline({ pet }) {
  const [events, setEvents] = useState([])
  const [filter, setFilter] = useState('all')

  function load() {
    Promise.all([
      getMedicalHistory(pet.id),
      getVaccinations(pet.id),
      getAllergies(pet.id),
      getReminders(pet.id),
    ]).then(([medical, vaccinations, allergies, reminders]) => {
      setEvents(buildEvents(medical, vaccinations, allergies, reminders))
    }).catch(console.error)
  }

  useEffect(load, [pet.id])

  const today   = new Date()
  const past    = events.filter(e => !e.isFuture)
  const future  = events.filter(e => e.isFuture)

  const filtered = list =>
    filter === 'all' ? list : list.filter(e => e.kind === filter)

  const FILTERS = [
    { id: 'all',         label: 'All' },
    { id: 'medical',     label: 'Medical' },
    { id: 'vaccination', label: 'Vaccinations' },
    { id: 'allergy',     label: 'Allergies' },
    { id: 'reminder',    label: 'Reminders' },
  ]

  const filteredPast   = filtered(past)
  const filteredFuture = filtered(future).sort((a, b) => a.sortDate - b.sortDate)
  const total = filteredPast.length + filteredFuture.length

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-black" style={{ color: '#7a4900' }}>Health Timeline</h2>
        <span className="text-sm" style={{ color: '#73775b' }}>{total} event{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap mb-6">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className="px-3 py-1.5 rounded-full text-sm font-semibold transition-all"
            style={filter === f.id
              ? { backgroundColor: '#f2b83d', color: '#7a4900' }
              : { backgroundColor: '#fff3c0', color: '#7a4900' }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {total === 0 && (
        <div className="card flex flex-col items-center py-16 text-center">
          <Calendar className="w-12 h-12 mb-3" style={{ color: '#ebe3d3' }} />
          <p className="font-bold" style={{ color: '#7a4900' }}>No records yet</p>
          <p className="text-sm mt-1" style={{ color: '#73775b' }}>
            Add medical records, vaccinations, or scan documents to see the timeline.
          </p>
        </div>
      )}

      <Section title="Upcoming" items={filteredFuture} />
      <Section title="History"  items={filteredPast} />
    </div>
  )
}
