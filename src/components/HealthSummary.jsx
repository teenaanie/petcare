import { useState } from 'react'
import { Sparkles, X, Loader2, AlertCircle, Copy, Check, ChevronDown, Heart, AlertTriangle, Calendar, Pill, TrendingUp, MessageSquare } from 'lucide-react'
import { getMedicalHistory, getVaccinations, getMedicines, getWeightLogs, getReminders, getAllergies } from '../lib/storage.js'
import { format, subDays, parseISO, isValid, isAfter } from 'date-fns'

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY

const PERIODS = [
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
]

function safeDate(str) {
  if (!str) return null
  try { const d = parseISO(str); return isValid(d) ? d : null } catch { return null }
}

// ── AI call ───────────────────────────────────────────────────────────────────

async function generateHealthSummary(pet, data, periodLabel) {
  const lines = []
  lines.push(`Pet name: ${pet.name}`)
  lines.push(`Species: ${pet.species || 'Unknown'}`)
  lines.push(`Breed: ${pet.breed || 'Unknown'}`)
  if (pet.dob) {
    const ageYears = Math.floor((Date.now() - new Date(pet.dob)) / (1000 * 60 * 60 * 24 * 365))
    lines.push(`Age: ${ageYears} years`)
  }
  if (pet.weight) lines.push(`Recorded weight: ${pet.weight} kg`)

  lines.push(`\n--- Data from the last ${periodLabel} ---`)

  if (data.records.length > 0) {
    lines.push('\nMEDICAL VISITS:')
    data.records.forEach(r => {
      lines.push(`  • [${r.date || '?'}] ${r.title || r.type} — ${r.description || ''}${r.vet ? ` (Vet: ${r.vet})` : ''}`)
    })
  }

  if (data.vaccinations.length > 0) {
    lines.push('\nVACCINATIONS GIVEN:')
    data.vaccinations.forEach(v => {
      lines.push(`  • ${v.name} on ${v.dateGiven || '?'}${v.nextDue ? ` — next due ${v.nextDue}` : ''}`)
    })
  }

  if (data.medicines.length > 0) {
    lines.push('\nMEDICINES (active/recent):')
    data.medicines.forEach(m => {
      lines.push(`  • ${m.name} ${m.dosage || ''} ${m.frequency || ''} [${m.category}]${m.isDone ? ' (completed)' : ''}${m.nextDue ? ` — next due ${m.nextDue}` : ''}`)
    })
  }

  if (data.weightLogs.length > 0) {
    lines.push('\nWEIGHT READINGS:')
    data.weightLogs.forEach(w => lines.push(`  • ${w.date}: ${w.weight} kg`))
  }

  if (data.allergies.length > 0) {
    lines.push('\nKNOWN ALLERGIES:')
    data.allergies.forEach(a => lines.push(`  • ${a.allergen} (${a.severity}) — ${a.type}`))
  }

  if (data.upcomingReminders.length > 0) {
    lines.push('\nUPCOMING REMINDERS:')
    data.upcomingReminders.forEach(r => lines.push(`  • ${r.type} on ${r.dueDate}`))
  }

  const prompt = `You are a veterinary health assistant. Based on the pet health data below, provide a concise health summary for the owner.

${lines.join('\n')}

Return a JSON object with this exact structure:
{
  "overallStatus": "Good" | "Monitor" | "Attention Needed",
  "statusReason": "one sentence explaining the status",
  "observations": [
    { "type": "positive" | "warning" | "info", "text": "observation about something specific in the data" }
  ],
  "weightTrend": "brief comment on weight trend or null if no data",
  "upcomingActions": [
    { "action": "what to do", "dueDate": "YYYY-MM-DD or timeframe like 'Next month'", "priority": "high" | "medium" | "low" }
  ],
  "vetVisitRecommended": true | false,
  "vetVisitReason": "reason if recommended, null if not",
  "vetQuestions": ["Question 1?", "Question 2?"]
}

Rules:
- observations: 3-6 bullet points mixing positive and warnings. Be specific — reference actual data.
- upcomingActions: only things due in the near future (overdue meds, upcoming vaccines, follow-ups)
- vetQuestions: 4-6 specific questions the owner should ask at their next appointment. Reference actual data.
- vetVisitRecommended: true if there are overdue items, concerning trends, or anything needing professional review
- Keep language plain, warm, and non-alarmist. This is for a pet owner, not a clinician.
- Return valid JSON only.`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error?.message || `API error ${res.status}`)
  }
  const out = await res.json()
  const raw = out.choices?.[0]?.message?.content
  if (!raw) throw new Error('Empty response — please try again.')
  return JSON.parse(raw)
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = {
    'Good':             { bg: '#D1FAE5', text: '#065F46', icon: '✅' },
    'Monitor':          { bg: '#FEF3C7', text: '#92400E', icon: '👀' },
    'Attention Needed': { bg: '#FEE2E2', text: '#991B1B', icon: '⚠️' },
  }[status] || { bg: '#F3F4F6', text: '#374151', icon: 'ℹ️' }

  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-black text-sm"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}>
      {cfg.icon} {status}
    </span>
  )
}

// ── Observation row ───────────────────────────────────────────────────────────

function ObsRow({ obs }) {
  const cfg = {
    positive: { icon: '✓', color: '#059669', bg: '#F0FDF4' },
    warning:  { icon: '!', color: '#D97706', bg: '#FFFBEB' },
    info:     { icon: '·', color: '#2563EB', bg: '#EFF6FF' },
  }[obs.type] || { icon: '·', color: '#6B7280', bg: '#F9FAFB' }

  return (
    <div className="flex gap-2.5 items-start rounded-xl px-3 py-2" style={{ backgroundColor: cfg.bg }}>
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5"
        style={{ backgroundColor: cfg.color, color: 'white' }}>
        {cfg.icon}
      </span>
      <span className="text-sm" style={{ color: '#374151' }}>{obs.text}</span>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function HealthSummary({ pet, onClose }) {
  const [periodIdx, setPeriodIdx]   = useState(1) // default: 1 month
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [summary, setSummary]       = useState(null)
  const [showQuestions, setShowQuestions] = useState(false)
  const [copied, setCopied]         = useState(false)

  async function handleGenerate() {
    setLoading(true); setError(null); setSummary(null)
    try {
      const { days, label } = PERIODS[periodIdx]
      const cutoff = subDays(new Date(), days)

      // Fetch all data in parallel
      const [records, vaccinations, medicines, weightLogs, reminders, allergies] =
        await Promise.all([
          getMedicalHistory(pet.id).catch(() => []),
          getVaccinations(pet.id).catch(() => []),
          getMedicines(pet.id).catch(() => []),
          getWeightLogs(pet.id).catch(() => []),
          getReminders(pet.id).catch(() => []),
          getAllergies(pet.id).catch(() => []),
        ])

      // Filter to period
      const inPeriod = (dateStr) => {
        const d = safeDate(dateStr)
        return d ? isAfter(d, cutoff) : false
      }

      const data = {
        records: records.filter(r => inPeriod(r.date)),
        vaccinations: vaccinations.filter(v => inPeriod(v.dateGiven)),
        medicines: medicines.filter(m => !m.isDone || inPeriod(m.startDate) || inPeriod(m.endDate)),
        weightLogs: weightLogs.filter(w => inPeriod(w.date)),
        allergies, // always include allergies regardless of period
        upcomingReminders: reminders.filter(r => {
          const d = safeDate(r.dueDate)
          return d && isAfter(d, new Date())
        }).slice(0, 5),
      }

      const result = await generateHealthSummary(pet, data, label)
      setSummary(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleCopyQuestions() {
    if (!summary?.vetQuestions) return
    const text = summary.vetQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(74,44,10,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      <div className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #F0E6C8' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: '#F9D548' }}>
              <Sparkles className="w-5 h-5" style={{ color: '#4A2C0A' }} />
            </div>
            <div>
              <h2 className="font-black" style={{ color: '#4A2C0A' }}>AI Health Brief</h2>
              <p className="text-xs" style={{ color: '#B8A080' }}>{pet.name} · Temporary summary</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-amber-50">
            <X className="w-5 h-5" style={{ color: '#B8A080' }} />
          </button>
        </div>

        {/* Period selector + generate */}
        {!summary && !loading && (
          <div className="px-5 py-6 flex flex-col items-center gap-5">
            <p className="text-sm text-center" style={{ color: '#6B4C1E' }}>
              Choose a time window and Claude will analyse {pet.name}'s recent records — medical visits, medicines, weight, vaccinations — and give you a plain-English health summary.
            </p>

            <div className="flex gap-2">
              {PERIODS.map((p, i) => (
                <button key={i} onClick={() => setPeriodIdx(i)}
                  className="px-4 py-2 rounded-xl text-sm font-bold transition-all"
                  style={i === periodIdx
                    ? { backgroundColor: '#F9D548', color: '#4A2C0A' }
                    : { backgroundColor: '#F0E6C8', color: '#6B4C1E' }}>
                  Last {p.label}
                </button>
              ))}
            </div>

            {!OPENAI_KEY && (
              <div className="text-xs rounded-xl px-3 py-2 text-center"
                style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                Add <code>VITE_OPENAI_API_KEY</code> to your .env file to enable AI features.
              </div>
            )}

            <button onClick={handleGenerate} disabled={!OPENAI_KEY}
              className="btn-primary flex items-center gap-2 w-full justify-center">
              <Sparkles className="w-4 h-4" />
              Generate Health Brief
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 px-5 py-12">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#F9D548' }} />
            <p className="font-bold" style={{ color: '#4A2C0A' }}>Analysing {pet.name}'s health data…</p>
            <p className="text-sm text-center" style={{ color: '#B8A080' }}>
              Reviewing records, medicines, weight trends, and upcoming dates
            </p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="px-5 py-6 space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-xl text-sm"
              style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Something went wrong</p>
                <p>{error}</p>
              </div>
            </div>
            <button onClick={handleGenerate} className="btn-primary w-full justify-center">Try Again</button>
            <button onClick={() => { setSummary(null); setError(null) }} className="btn-secondary w-full justify-center">
              Change Period
            </button>
          </div>
        )}

        {/* Results */}
        {summary && !loading && (
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

            {/* Status */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <StatusBadge status={summary.overallStatus} />
              <span className="text-xs" style={{ color: '#B8A080' }}>Last {PERIODS[periodIdx].label}</span>
            </div>
            {summary.statusReason && (
              <p className="text-sm" style={{ color: '#4A2C0A' }}>{summary.statusReason}</p>
            )}

            {/* Vet visit alert */}
            {summary.vetVisitRecommended && (
              <div className="flex items-start gap-2.5 rounded-xl p-3"
                style={{ backgroundColor: '#FEF3C7', border: '1px solid #FDE68A' }}>
                <Calendar className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#D97706' }} />
                <div>
                  <p className="font-bold text-sm" style={{ color: '#92400E' }}>Vet visit recommended</p>
                  {summary.vetVisitReason && (
                    <p className="text-xs mt-0.5" style={{ color: '#B45309' }}>{summary.vetVisitReason}</p>
                  )}
                </div>
              </div>
            )}

            {/* Observations */}
            {summary.observations?.length > 0 && (
              <div>
                <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#B8A080' }}>Observations</p>
                <div className="space-y-1.5">
                  {summary.observations.map((obs, i) => <ObsRow key={i} obs={obs} />)}
                </div>
              </div>
            )}

            {/* Weight trend */}
            {summary.weightTrend && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-2.5"
                style={{ backgroundColor: '#F0F8FF', border: '1px solid #BFDBFE' }}>
                <TrendingUp className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#2563EB' }} />
                <p className="text-sm" style={{ color: '#1E3A5F' }}>{summary.weightTrend}</p>
              </div>
            )}

            {/* Upcoming actions */}
            {summary.upcomingActions?.length > 0 && (
              <div>
                <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#B8A080' }}>Coming Up</p>
                <div className="space-y-1.5">
                  {summary.upcomingActions.map((a, i) => {
                    const priorityColor = { high: '#DC2626', medium: '#D97706', low: '#059669' }[a.priority] || '#6B7280'
                    return (
                      <div key={i} className="flex items-center gap-2.5 rounded-xl px-3 py-2"
                        style={{ backgroundColor: '#FFFEF0', border: '1px solid #F0E6C8' }}>
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: priorityColor }} />
                        <span className="text-sm flex-1" style={{ color: '#4A2C0A' }}>{a.action}</span>
                        {a.dueDate && (
                          <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#B8A080' }}>{a.dueDate}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Vet questions */}
            {summary.vetQuestions?.length > 0 && (
              <div>
                <button
                  onClick={() => setShowQuestions(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl mb-1"
                  style={{ backgroundColor: '#F0F8FF', border: '1px solid #BFDBFE' }}>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" style={{ color: '#2563EB' }} />
                    <span className="font-bold text-sm" style={{ color: '#1E3A5F' }}>
                      {summary.vetQuestions.length} questions to ask your vet
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showQuestions ? 'rotate-180' : ''}`}
                    style={{ color: '#2563EB' }} />
                </button>

                {showQuestions && (
                  <div className="space-y-2">
                    <ol className="space-y-1.5">
                      {summary.vetQuestions.map((q, i) => (
                        <li key={i} className="flex gap-2.5 text-sm rounded-xl px-3 py-2"
                          style={{ backgroundColor: 'white', border: '1px solid #BFDBFE' }}>
                          <span className="font-black flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                            style={{ backgroundColor: '#F9D548', color: '#4A2C0A' }}>
                            {i + 1}
                          </span>
                          <span style={{ color: '#1E3A5F' }}>{q}</span>
                        </li>
                      ))}
                    </ol>
                    <button onClick={handleCopyQuestions}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold w-full justify-center"
                      style={{ backgroundColor: copied ? '#D1FAE5' : '#DBEAFE', color: copied ? '#065F46' : '#1D4ED8' }}>
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied!' : 'Copy all questions'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Footer actions */}
            <div className="flex gap-2 pt-1 pb-2">
              <button onClick={() => { setSummary(null); setError(null) }}
                className="btn-secondary flex-1 text-sm justify-center">
                ← Change Period
              </button>
              <button onClick={onClose} className="btn-primary flex-1 text-sm justify-center">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
