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

const TYPE_ICONS = {
  medical:     { icon: Stethoscope, bg: 'bg-blue-100',   color: 'text-blue-600',   dot: 'bg-blue-500' },
  vaccination: { icon: Syringe,     bg: 'bg-purple-100', color: 'text-purple-600', dot: 'bg-purple-500' },
  allergy:     { icon: AlertTriangle, bg: 'bg-red-100',  color: 'text-red-600',    dot: 'bg-red-500' },
  reminder:    { icon: Bell,         bg: 'bg-amber-100', color: 'text-amber-600',  dot: 'bg-amber-500' },
}

function buildEvents(medicalRecords, vaccinations, allergies, reminders) {
  const events = []

  medicalRecords.forEach(r => {
    const date = parseDate(r.date)
    events.push({
      id: `med-${r.id}`,
      kind: 'medical',
      date,
      sortDate: date || new Date(r.createdAt),
      title: r.title,
      subtitle: `${r.type}${r.vet ? ` · ${r.vet}` : ''}${r.cost ? ` · $${r.cost}` : ''}`,
      body: r.description,
      isAbnormal: r.isAbnormal,
      abnormalities: r.abnormalities || [],
      raw: r,
    })
  })

  vaccinations.forEach(r => {
    const date = parseDate(r.dateGiven)
    events.push({
      id: `vax-${r.id}`,
      kind: 'vaccination',
      date,
      sortDate: date || new Date(r.createdAt),
      title: r.name,
      subtitle: `Given${r.vet ? ` by ${r.vet}` : ''}${r.batchNumber ? ` · Batch ${r.batchNumber}` : ''}`,
      body: r.notes,
      extra: r.nextDue ? `Next due: ${format(parseDate(r.nextDue) || new Date(r.nextDue), 'MMM d, yyyy')}` : null,
      nextDue: r.nextDue,
      raw: r,
    })
    // Also add nextDue as a future event
    if (r.nextDue) {
      const nd = parseDate(r.nextDue)
      if (nd) {
        events.push({
          id: `vax-due-${r.id}`,
          kind: 'reminder',
          date: nd,
          sortDate: nd,
          title: `${r.name} — Due`,
          subtitle: 'Upcoming vaccination',
          body: null,
          isFuture: true,
          raw: r,
        })
      }
    }
  })

  allergies.forEach(r => {
    const date = parseDate(r.diagnosedDate)
    events.push({
      id: `alg-${r.id}`,
      kind: 'allergy',
      date,
      sortDate: date || new Date(r.createdAt),
      title: `Allergy: ${r.allergen}`,
      subtitle: `${r.type} · ${r.severity}${r.reactions?.length ? ` · ${r.reactions.join(', ')}` : ''}`,
      body: r.notes,
      raw: r,
    })
  })

  reminders.forEach(r => {
    const date = parseDate(r.dueDate)
    events.push({
      id: `rem-${r.id}`,
      kind: 'reminder',
      date,
      sortDate: date || new Date(r.createdAt),
      title: r.type,
      subtitle: `Reminder${r.notes ? ` · ${r.notes}` : ''}`,
      body: null,
      isFuture: true,
      raw: r,
    })
  })

  return events.sort((a, b) => b.sortDate - a.sortDate)
}

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

  const today = new Date()
  const past   = events.filter(e => !e.isFuture && e.sortDate <= today)
  const future = events.filter(e => e.isFuture || e.sortDate > today)

  const filtered = (list) =>
    filter === 'all' ? list : list.filter(e => e.kind === filter)

  const FILTERS = [
    { id: 'all',         label: 'All' },
    { id: 'medical',     label: 'Medical' },
    { id: 'vaccination', label: 'Vaccinations' },
    { id: 'allergy',     label: 'Allergies' },
    { id: 'reminder',    label: 'Reminders' },
  ]

  function EventCard({ event }) {
    const cfg = TYPE_ICONS[event.kind]
    const Icon = cfg.icon
    const cardBorder = event.isAbnormal ? 'border-red-200 bg-red-50/30' : 'border-gray-100'
    return (
      <div className="flex gap-4">
        {/* Timeline dot + line — handled by parent */}
        <div className={`w-10 h-10 rounded-full ${event.isAbnormal ? 'bg-red-100' : cfg.bg} flex items-center justify-center flex-shrink-0`}>
          {event.isAbnormal
            ? <TriangleAlert className="w-5 h-5 text-red-500" />
            : <Icon className={`w-5 h-5 ${cfg.color}`} />}
        </div>
        <div className="flex-1 pb-6">
          <div className={`bg-white border rounded-xl p-4 shadow-sm ${cardBorder}`}>
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{event.title}</p>
                  {event.isAbnormal && (
                    <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                      <TriangleAlert className="w-3 h-3" /> {event.abnormalities.length} Abnormal
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-400 mt-0.5">{event.subtitle}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {event.nextDue && <VaxStatus nextDue={event.nextDue} />}
                {event.isFuture && !event.nextDue && (
                  <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Upcoming</span>
                )}
                {event.date && (
                  <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                    {format(event.sortDate, 'MMM d, yyyy')}
                  </span>
                )}
              </div>
            </div>
            {event.body && (
              <p className="text-sm text-gray-600 mt-2 whitespace-pre-line leading-relaxed">{event.body}</p>
            )}
            {event.extra && (
              <p className="text-xs text-purple-600 mt-2 font-medium">{event.extra}</p>
            )}
            {event.isAbnormal && event.abnormalities?.length > 0 && (
              <div className="mt-2 space-y-1">
                {event.abnormalities.map((a, i) => {
                  const color = { Severe: 'text-red-700 bg-red-50', Moderate: 'text-orange-700 bg-orange-50', Mild: 'text-yellow-700 bg-yellow-50' }[a.severity] || 'text-red-700 bg-red-50'
                  return (
                    <div key={i} className={`text-xs rounded px-2 py-1 ${color}`}>
                      <span className="font-bold">{a.parameter}</span> {a.value}{a.unit} — <span className="font-semibold">{a.status} ({a.severity})</span>
                      {a.clinicalNote && <span className="ml-1 opacity-75">· {a.clinicalNote}</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  function Section({ title, items, dotColor }) {
    if (items.length === 0) return null
    // Group by year-month
    const groups = {}
    items.forEach(e => {
      const key = format(e.sortDate, 'MMMM yyyy')
      if (!groups[key]) groups[key] = []
      groups[key].push(e)
    })

    return (
      <div className="mb-8">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">{title}</h3>
        {Object.entries(groups).map(([month, evts]) => (
          <div key={month} className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <Calendar className="w-4 h-4 text-gray-300" />
              <span className="text-sm font-semibold text-gray-500">{month}</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
            <div className="ml-2 border-l-2 border-gray-100 pl-4 space-y-2">
              {evts.map(e => <EventCard key={e.id} event={e} />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const filteredPast   = filtered(past)
  const filteredFuture = filtered(future)
  const totalEvents = filteredPast.length + filteredFuture.length

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-gray-900">Health Timeline</h2>
        <span className="text-sm text-gray-400">{totalEvents} event{totalEvents !== 1 ? 's' : ''}</span>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap mb-6">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.id
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {totalEvents === 0 && (
        <div className="card flex flex-col items-center py-16 text-center text-gray-400">
          <Calendar className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-medium text-gray-500">No records yet</p>
          <p className="text-sm mt-1">Add medical records, vaccinations, or scan documents to see the timeline.</p>
        </div>
      )}

      <Section title="Upcoming" items={filteredFuture.sort((a, b) => a.sortDate - b.sortDate)} />
      <Section title="History" items={filteredPast} />
    </div>
  )
}
