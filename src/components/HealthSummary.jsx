import { useState } from 'react'
import { Sparkles, X, Loader2, AlertCircle, Copy, Check, ChevronDown, Heart, AlertTriangle, Calendar, Pill, TrendingUp, MessageSquare } from 'lucide-react'
import { getMedicalHistory, getVaccinations, getMedicines, getWeightLogs, getReminders, getAllergies } from '../lib/storage.js'
import { format, subDays, parseISO, isValid, isAfter } from 'date-fns'
import { aiComplete } from '../lib/ai.js'

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

// The prompt that turns this into a health brief is composed server-side, in
// netlify/functions/ai-complete.js, next to the API key. We send the records.
async function generateHealthSummary(pet, data, periodLabel) {
  // Only the fields the brief actually uses. Sending the whole pet would upload
  // pet.photo — a base64 data URL, often megabytes — on every generation.
  const { name, species, breed, dob, weight } = pet
  return aiComplete('health_summary', {
    pet: { name, species, breed, dob, weight },
    data,
    periodLabel,
  })
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = {
    'Good':             { bg: '#eef3e2', text: '#44562a', icon: '✅' },
    'Monitor':          { bg: '#fff3c0', text: '#7a4900', icon: '👀' },
    'Attention Needed': { bg: '#fdeaea', text: '#8a2b20', icon: '⚠️' },
  }[status] || { bg: '#f5f0e0', text: '#5f624b', icon: 'ℹ️' }

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
    positive: { icon: '✓', color: '#5f7a3a', bg: '#f4f8ea' },
    warning:  { icon: '!', color: '#c9891f', bg: '#fff9e0' },
    info:     { icon: '·', color: '#2f7286', bg: '#eef8fb' },
  }[obs.type] || { icon: '·', color: '#73775b', bg: '#fffef8' }

  return (
    <div className="flex gap-2.5 items-start rounded-xl px-3 py-2" style={{ backgroundColor: cfg.bg }}>
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5"
        style={{ backgroundColor: cfg.color, color: 'white' }}>
        {cfg.icon}
      </span>
      <span className="text-sm" style={{ color: '#5f624b' }}>{obs.text}</span>
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
      style={{ backgroundColor: 'rgba(122,73,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      <div className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #ebe3d3' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: '#f2b83d' }}>
              <Sparkles className="w-5 h-5" style={{ color: '#7a4900' }} />
            </div>
            <div>
              <h2 className="font-black" style={{ color: '#7a4900' }}>AI Health Brief</h2>
              <p className="text-xs" style={{ color: '#73775b' }}>{pet.name} · Temporary summary</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-amber-50">
            <X className="w-5 h-5" style={{ color: '#73775b' }} />
          </button>
        </div>

        {/* Period selector + generate */}
        {!summary && !loading && (
          <div className="px-5 py-6 flex flex-col items-center gap-5">
            <p className="text-sm text-center" style={{ color: '#7a4900' }}>
              Choose a time window and Claude will analyse {pet.name}'s recent records — medical visits, medicines, weight, vaccinations — and give you a plain-English health summary.
            </p>

            <div className="flex gap-2">
              {PERIODS.map((p, i) => (
                <button key={i} onClick={() => setPeriodIdx(i)}
                  className="px-4 py-2 rounded-xl text-sm font-bold transition-all"
                  style={i === periodIdx
                    ? { backgroundColor: '#f2b83d', color: '#7a4900' }
                    : { backgroundColor: '#ebe3d3', color: '#7a4900' }}>
                  Last {p.label}
                </button>
              ))}
            </div>

            <button onClick={handleGenerate}
              className="btn-primary flex items-center gap-2 w-full justify-center">
              <Sparkles className="w-4 h-4" />
              Generate Health Brief
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 px-5 py-12">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#f2b83d' }} />
            <p className="font-bold" style={{ color: '#7a4900' }}>Analysing {pet.name}'s health data…</p>
            <p className="text-sm text-center" style={{ color: '#73775b' }}>
              Reviewing records, medicines, weight trends, and upcoming dates
            </p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="px-5 py-6 space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-xl text-sm"
              style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
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
              <span className="text-xs" style={{ color: '#73775b' }}>Last {PERIODS[periodIdx].label}</span>
            </div>
            {summary.statusReason && (
              <p className="text-sm" style={{ color: '#7a4900' }}>{summary.statusReason}</p>
            )}

            {/* Vet visit alert */}
            {summary.vetVisitRecommended && (
              <div className="flex items-start gap-2.5 rounded-xl p-3"
                style={{ backgroundColor: '#fff3c0', border: '1px solid #ffde59' }}>
                <Calendar className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#c9891f' }} />
                <div>
                  <p className="font-bold text-sm" style={{ color: '#7a4900' }}>Vet visit recommended</p>
                  {summary.vetVisitReason && (
                    <p className="text-xs mt-0.5" style={{ color: '#9a6a12' }}>{summary.vetVisitReason}</p>
                  )}
                </div>
              </div>
            )}

            {/* Observations */}
            {summary.observations?.length > 0 && (
              <div>
                <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#73775b' }}>Observations</p>
                <div className="space-y-1.5">
                  {summary.observations.map((obs, i) => <ObsRow key={i} obs={obs} />)}
                </div>
              </div>
            )}

            {/* Weight trend */}
            {summary.weightTrend && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-2.5"
                style={{ backgroundColor: '#eef8fb', border: '1px solid #bfe5ef' }}>
                <TrendingUp className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#2f7286' }} />
                <p className="text-sm" style={{ color: '#1f4b57' }}>{summary.weightTrend}</p>
              </div>
            )}

            {/* Upcoming actions */}
            {summary.upcomingActions?.length > 0 && (
              <div>
                <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#73775b' }}>Coming Up</p>
                <div className="space-y-1.5">
                  {summary.upcomingActions.map((a, i) => {
                    const priorityColor = { high: '#c0392b', medium: '#c9891f', low: '#5f7a3a' }[a.priority] || '#73775b'
                    return (
                      <div key={i} className="flex items-center gap-2.5 rounded-xl px-3 py-2"
                        style={{ backgroundColor: '#fff9e0', border: '1px solid #ebe3d3' }}>
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: priorityColor }} />
                        <span className="text-sm flex-1" style={{ color: '#7a4900' }}>{a.action}</span>
                        {a.dueDate && (
                          <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#73775b' }}>{a.dueDate}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* AI Findings — what's good vs what needs attention */}
            {summary.findings && (summary.findings.good?.length > 0 || summary.findings.concerns?.length > 0) && (
              <div className="rounded-2xl overflow-hidden" style={{ border: '1.5px solid #ebe3d3' }}>
                <div className="px-4 py-3 flex items-center gap-2"
                  style={{ backgroundColor: '#fff9e0' }}>
                  <Sparkles className="w-4 h-4" style={{ color: '#7a4900' }} />
                  <span className="font-black text-sm" style={{ color: '#7a4900' }}>AI Findings</span>
                </div>

                <div className="divide-y" style={{ divideColor: '#ebe3d3' }}>
                  {/* What's good */}
                  {summary.findings.good?.length > 0 && (
                    <div className="px-4 py-3" style={{ backgroundColor: '#f4f8ea' }}>
                      <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#5f7a3a' }}>
                        ✅ Looking Good
                      </p>
                      <ul className="space-y-1.5">
                        {summary.findings.good.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm" style={{ color: '#44562a' }}>
                            <span className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#5f7a3a' }} />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* What needs attention */}
                  {summary.findings.concerns?.length > 0 && (
                    <div className="px-4 py-3" style={{ backgroundColor: '#fff9e0' }}>
                      <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#c9891f' }}>
                        ⚠️ Needs Attention
                      </p>
                      <ul className="space-y-1.5">
                        {summary.findings.concerns.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm" style={{ color: '#7a4900' }}>
                            <span className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#c9891f' }} />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* All clear */}
                  {summary.findings.concerns?.length === 0 && (
                    <div className="px-4 py-2.5 text-sm" style={{ backgroundColor: '#f4f8ea', color: '#5f7a3a' }}>
                      🎉 No concerns found — keep up the great care!
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Vet questions */}
            {summary.vetQuestions?.length > 0 && (
              <div>
                <button
                  onClick={() => setShowQuestions(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl mb-1"
                  style={{ backgroundColor: '#eef8fb', border: '1px solid #bfe5ef' }}>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" style={{ color: '#2f7286' }} />
                    <span className="font-bold text-sm" style={{ color: '#1f4b57' }}>
                      {summary.vetQuestions.length} questions to ask your vet
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showQuestions ? 'rotate-180' : ''}`}
                    style={{ color: '#2f7286' }} />
                </button>

                {showQuestions && (
                  <div className="space-y-2">
                    <ol className="space-y-1.5">
                      {summary.vetQuestions.map((q, i) => (
                        <li key={i} className="flex gap-2.5 text-sm rounded-xl px-3 py-2"
                          style={{ backgroundColor: 'white', border: '1px solid #bfe5ef' }}>
                          <span className="font-black flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                            style={{ backgroundColor: '#f2b83d', color: '#7a4900' }}>
                            {i + 1}
                          </span>
                          <span style={{ color: '#1f4b57' }}>{q}</span>
                        </li>
                      ))}
                    </ol>
                    <button onClick={handleCopyQuestions}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold w-full justify-center"
                      style={{ backgroundColor: copied ? '#eef3e2' : '#dceff5', color: copied ? '#44562a' : '#255d6e' }}>
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
