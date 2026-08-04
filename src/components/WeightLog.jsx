import { useEffect, useState } from 'react'
import { Plus, Trash2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { getWeightLogs, saveWeightLog, deleteWeightLog } from '../lib/storage.js'
import { format, parseISO } from 'date-fns'

// ── SVG Line Chart ────────────────────────────────────────────────────────────

function WeightChart({ logs }) {
  if (logs.length < 2) return null

  const W = 480, H = 160
  const PAD = { top: 16, right: 16, bottom: 32, left: 44 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom

  const weights  = logs.map(l => parseFloat(l.weight))
  const rawMin   = Math.min(...weights)
  const rawMax   = Math.max(...weights)
  const spread   = rawMax - rawMin || 1
  const minW     = rawMin - spread * 0.2
  const maxW     = rawMax + spread * 0.2

  const dates    = logs.map(l => new Date(l.date).getTime())
  const minD     = Math.min(...dates)
  const maxD     = Math.max(...dates)
  const dateSpan = maxD - minD || 1

  const toX = d  => PAD.left + ((new Date(d).getTime() - minD) / dateSpan) * cW
  const toY = w  => PAD.top  + cH - ((parseFloat(w) - minW) / (maxW - minW)) * cH

  const pts   = logs.map(l => ({ x: toX(l.date), y: toY(l.weight), ...l }))
  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaD = `${lineD} L${pts[pts.length - 1].x.toFixed(1)},${(PAD.top + cH).toFixed(1)} L${pts[0].x.toFixed(1)},${(PAD.top + cH).toFixed(1)}Z`

  // Y-axis tick values
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: PAD.top + t * cH,
    val: (maxW - t * (maxW - minW)).toFixed(1),
  }))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: '160px' }}>
      <defs>
        <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F9D548" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#F9D548" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid + Y labels */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y}
            stroke="#F0E6C8" strokeWidth="1" strokeDasharray="3 3" />
          <text x={PAD.left - 6} y={t.y + 4} textAnchor="end"
            fontSize="10" fill="#B8A080" fontFamily="Nunito, sans-serif">
            {t.val}
          </text>
        </g>
      ))}

      {/* Area fill */}
      <path d={areaD} fill="url(#wGrad)" />

      {/* Line */}
      <path d={lineD} fill="none" stroke="#F9D548" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" />

      {/* Data points + X labels */}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4.5" fill="#F9D548"
            stroke="#4A2C0A" strokeWidth="1.5" />
          {/* weight label above dot */}
          <text x={p.x} y={p.y - 9} textAnchor="middle"
            fontSize="9.5" fontWeight="bold" fill="#4A2C0A" fontFamily="Nunito, sans-serif">
            {parseFloat(p.weight)}
          </text>
          {/* date below axis */}
          <text x={p.x} y={H - 6} textAnchor="middle"
            fontSize="9" fill="#B8A080" fontFamily="Nunito, sans-serif">
            {format(parseISO(p.date), 'MMM d')}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WeightLog({ pet }) {
  const [logs, setLogs]         = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ date: new Date().toISOString().slice(0, 10), weight: '', notes: '' })
  const [saving, setSaving]     = useState(false)

  function load() {
    getWeightLogs(pet.id).then(setLogs).catch(console.error)
  }

  useEffect(load, [pet.id])

  const sorted = [...logs].sort((a, b) => new Date(a.date) - new Date(b.date))

  // Trend badge
  function Trend() {
    if (sorted.length < 2) return null
    const delta = parseFloat(sorted[sorted.length - 1].weight) - parseFloat(sorted[sorted.length - 2].weight)
    if (Math.abs(delta) < 0.05) return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-bold"
        style={{ backgroundColor: '#FFF5AA', color: '#6B4C1E' }}>
        <Minus className="w-3 h-3" /> Stable
      </span>
    )
    return delta > 0 ? (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-bold"
        style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>
        <TrendingUp className="w-3 h-3" /> +{delta.toFixed(2)} kg
      </span>
    ) : (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-bold"
        style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
        <TrendingDown className="w-3 h-3" /> {delta.toFixed(2)} kg
      </span>
    )
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.weight || isNaN(parseFloat(form.weight))) return
    setSaving(true)
    try {
      await saveWeightLog({ petId: pet.id, date: form.date, weight: parseFloat(form.weight), notes: form.notes })
      setForm({ date: new Date().toISOString().slice(0, 10), weight: '', notes: '' })
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await deleteWeightLog(id)
    load()
  }

  const latest = sorted[sorted.length - 1]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black" style={{ color: '#4A2C0A' }}>Weight Trend</h2>
          {latest && (
            <p className="text-sm mt-0.5" style={{ color: '#B8A080' }}>
              Latest: <span className="font-bold" style={{ color: '#4A2C0A' }}>{parseFloat(latest.weight)} kg</span>
              {' '}· {format(parseISO(latest.date), 'MMM d, yyyy')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Trend />
          <button onClick={() => setShowForm(v => !v)} className="btn-primary gap-1.5 text-sm">
            <Plus className="w-4 h-4" /> Log Weight
          </button>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="card" style={{ backgroundColor: '#FFFEF0' }}>
          <form onSubmit={handleSave} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="label text-xs">Date</label>
              <input type="date" className="input" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
            </div>
            <div className="w-28">
              <label className="label text-xs">Weight (kg)</label>
              <input type="number" step="0.1" min="0" className="input" placeholder="e.g. 5.2"
                value={form.weight}
                onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} required />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="label text-xs">Notes (optional)</label>
              <input className="input" placeholder="e.g. After grooming"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Chart */}
      {sorted.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
            style={{ backgroundColor: '#FFF5AA' }}>
            <TrendingUp className="w-8 h-8" style={{ color: '#4A2C0A' }} />
          </div>
          <p className="font-bold" style={{ color: '#4A2C0A' }}>No weight logs yet</p>
          <p className="text-sm mt-1" style={{ color: '#B8A080' }}>
            Tap "Log Weight" to start tracking {pet.name}'s weight over time.
          </p>
        </div>
      ) : (
        <>
          {/* Chart card */}
          <div className="card">
            <p className="text-xs font-bold mb-3" style={{ color: '#B8A080' }}>WEIGHT OVER TIME (kg)</p>
            {sorted.length === 1 ? (
              <p className="text-sm text-center py-4" style={{ color: '#B8A080' }}>
                Add at least 2 entries to see the trend chart.
              </p>
            ) : (
              <WeightChart logs={sorted} />
            )}
          </div>

          {/* Stats row */}
          {sorted.length >= 2 && (() => {
            const weights = sorted.map(l => parseFloat(l.weight))
            const min = Math.min(...weights)
            const max = Math.max(...weights)
            const avg = (weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(2)
            return (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Lightest', val: `${min} kg` },
                  { label: 'Average', val: `${avg} kg` },
                  { label: 'Heaviest', val: `${max} kg` },
                ].map(s => (
                  <div key={s.label} className="card text-center py-3">
                    <p className="text-xs font-bold mb-1" style={{ color: '#B8A080' }}>{s.label}</p>
                    <p className="text-lg font-black" style={{ color: '#4A2C0A' }}>{s.val}</p>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Log list */}
          <div className="card">
            <p className="text-xs font-bold mb-3" style={{ color: '#B8A080' }}>ALL ENTRIES</p>
            <div className="space-y-2">
              {[...sorted].reverse().map(l => (
                <div key={l.id} className="flex items-center justify-between py-2 px-3 rounded-xl group"
                  style={{ backgroundColor: '#FFFEF0' }}>
                  <div>
                    <span className="font-black" style={{ color: '#4A2C0A' }}>{parseFloat(l.weight)} kg</span>
                    <span className="text-sm ml-2" style={{ color: '#B8A080' }}>
                      {format(parseISO(l.date), 'MMM d, yyyy')}
                    </span>
                    {l.notes && (
                      <span className="text-xs ml-2" style={{ color: '#B8A080' }}>· {l.notes}</span>
                    )}
                  </div>
                  <button onClick={() => handleDelete(l.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all text-red-400 hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
