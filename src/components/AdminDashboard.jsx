import { useEffect, useState } from 'react'
import { ShieldCheck, Users, PawPrint, ChevronRight, ChevronLeft, Search, Phone, Mail, Loader2, AlertCircle, Stethoscope, Syringe, Pill, Receipt, Bell, ChevronDown, ChevronUp, Star, MessageSquarePlus, MapPin, Clock, Scissors, ShoppingBag, Home, Camera, Flower2, Plus, Check, X, Trash2, ToggleLeft, ToggleRight, Gauge, HardDrive, Sparkles, Bug } from 'lucide-react'
import { getAdminUsers, getPets, getMedicalHistory, getVaccinations, getMedicines, getBills, getReminders, getFeedback, getProviders, saveProvider, deleteProvider } from '../lib/storage.js'
import PetAvatar from './PetAvatar.jsx'
import BoardingRulesPanel from './BoardingRulesPanel.jsx'
import { PROVIDER_TYPES, SERVICES, SPECIALIZATIONS } from '../lib/taxonomy.js'
import { getSupabase } from '../lib/supabase.js'
import { THRESHOLDS, breaches, pctOf, byWeek, MB } from '../lib/usageLimits.js'

// ── User Card ────────────────────────────────────────────────────────────────

function UserCard({ user, onSelect }) {
  return (
    <button
      onClick={() => onSelect(user)}
      className="w-full text-left p-4 rounded-2xl transition-all flex items-center gap-4 group"
      style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#f2b83d'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#ebe3d3'}
    >
      {/* Avatar */}
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: '#fff3c0' }}>
        {user.phone
          ? <Phone className="w-5 h-5" style={{ color: '#7a4900' }} />
          : <Mail className="w-5 h-5" style={{ color: '#7a4900' }} />}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm truncate" style={{ color: '#7a4900' }}>
          {user.phone || user.email || 'Unknown user'}
        </p>
        <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>
          {user.pet_count ?? 0} {user.pet_count === 1 ? 'pet' : 'pets'} ·{' '}
          Joined {new Date(user.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
        </p>
      </div>

      {/* Chevron */}
      <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-30 group-hover:opacity-80 transition-opacity"
        style={{ color: '#7a4900' }} />
    </button>
  )
}

// ── Pet Detail Row ───────────────────────────────────────────────────────────

function PetRow({ pet, onSelect }) {
  return (
    <button
      onClick={() => onSelect(pet)}
      className="w-full text-left p-4 rounded-2xl transition-all flex items-center gap-4 group"
      style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#f2b83d'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#ebe3d3'}
    >
      <PetAvatar pet={pet} size="md" />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm" style={{ color: '#7a4900' }}>{pet.name}</p>
        <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>
          {pet.species} · {pet.breed}
          {pet.age ? ` · ${pet.age} yrs` : ''}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 opacity-30 group-hover:opacity-80 transition-opacity"
        style={{ color: '#7a4900' }} />
    </button>
  )
}

// ── Pet Stats Panel ──────────────────────────────────────────────────────────

function StatChip({ icon: Icon, label, count, color = '#7a4900' }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{ backgroundColor: '#fff9e0', border: '1px solid #ebe3d3' }}>
      <Icon className="w-4 h-4 flex-shrink-0" style={{ color }} />
      <div>
        <p className="text-xs font-black leading-none" style={{ color: '#7a4900' }}>{count}</p>
        <p className="text-[10px] leading-none mt-0.5" style={{ color: '#73775b' }}>{label}</p>
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, count, color, children }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-4 rounded-2xl overflow-hidden border" style={{ borderColor: '#ebe3d3' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: '#fff9e0' }}>
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color }} />
          <span className="text-sm font-black" style={{ color: '#7a4900' }}>{title}</span>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: color + '22', color }}>{count}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4" style={{ color: '#73775b' }} />
               : <ChevronDown className="w-4 h-4" style={{ color: '#73775b' }} />}
      </button>
      {open && <div className="divide-y" style={{ divideColor: '#ebe3d3' }}>{children}</div>}
    </div>
  )
}

function Row({ primary, secondary, tertiary }) {
  return (
    <div className="px-4 py-3" style={{ backgroundColor: '#FFFEF8' }}>
      <p className="text-sm font-bold" style={{ color: '#7a4900' }}>{primary}</p>
      {secondary && <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>{secondary}</p>}
      {tertiary  && <p className="text-xs mt-0.5" style={{ color: '#7a4900' }}>{tertiary}</p>}
    </div>
  )
}

function EmptyRow({ label }) {
  return (
    <div className="px-4 py-3 text-xs italic" style={{ color: '#73775b', backgroundColor: '#FFFEF8' }}>
      No {label} recorded
    </div>
  )
}

function PetStatsPanel({ pet, onBack }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [medical, vaccinations, medicines, bills, reminders] = await Promise.all([
          getMedicalHistory(pet.id).catch(() => []),
          getVaccinations(pet.id).catch(() => []),
          getMedicines(pet.id).catch(() => []),
          getBills(pet.id).catch(() => []),
          getReminders(pet.id).catch(() => []),
        ])
        setData({ medical, vaccinations, medicines, bills, reminders })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [pet.id])

  const fmt = str => str ? new Date(str).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  return (
    <div>
      <button onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-bold mb-5 hover:underline"
        style={{ color: '#7a4900' }}>
        <ChevronLeft className="w-4 h-4" /> Back to pets
      </button>

      <div className="flex items-center gap-4 mb-6">
        <PetAvatar pet={pet} size="lg" />
        <div>
          <h3 className="text-xl font-black" style={{ color: '#7a4900' }}>{pet.name}</h3>
          <p className="text-sm" style={{ color: '#73775b' }}>
            {pet.species} · {pet.breed}{pet.age ? ` · ${pet.age} yrs` : ''}
            {pet.weight ? ` · ${pet.weight} kg` : ''}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6" style={{ color: '#73775b' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading records…</span>
        </div>
      ) : (
        <>
          {/* Medical */}
          <Section icon={Stethoscope} title="Medical Records" count={data.medical.length} color="#2f7286">
            {data.medical.length === 0 ? <EmptyRow label="medical records" /> :
              data.medical.map(r => (
                <Row key={r.id}
                  primary={r.title || r.type}
                  secondary={[r.type, r.vet, fmt(r.date)].filter(Boolean).join(' · ')}
                  tertiary={r.description} />
              ))}
          </Section>

          {/* Vaccinations */}
          <Section icon={Syringe} title="Vaccinations" count={data.vaccinations.length} color="#b2566f">
            {data.vaccinations.length === 0 ? <EmptyRow label="vaccinations" /> :
              data.vaccinations.map(r => (
                <Row key={r.id}
                  primary={r.name}
                  secondary={[r.vet ? `By ${r.vet}` : null, `Given: ${fmt(r.dateGiven)}`, r.nextDue ? `Next due: ${fmt(r.nextDue)}` : null].filter(Boolean).join(' · ')}
                  tertiary={r.notes} />
              ))}
          </Section>

          {/* Medicines */}
          <Section icon={Pill} title="Medicines" count={data.medicines.length} color="#5f7a3a">
            {data.medicines.length === 0 ? <EmptyRow label="medicines" /> :
              data.medicines.map(r => (
                <Row key={r.id}
                  primary={r.name}
                  secondary={[r.dosage, r.frequency, r.startDate ? `From ${fmt(r.startDate)}` : null].filter(Boolean).join(' · ')}
                  tertiary={r.notes} />
              ))}
          </Section>

          {/* Bills */}
          <Section icon={Receipt} title="Bills" count={data.bills.length} color="#c9891f">
            {data.bills.length === 0 ? <EmptyRow label="bills" /> :
              data.bills.map(r => (
                <Row key={r.id}
                  primary={r.description || r.category}
                  secondary={[r.category, fmt(r.date), r.total ? `₹${r.total}` : null].filter(Boolean).join(' · ')} />
              ))}
          </Section>

          {/* Reminders */}
          <Section icon={Bell} title="Reminders" count={data.reminders.length} color="#c0392b">
            {data.reminders.length === 0 ? <EmptyRow label="reminders" /> :
              data.reminders.map(r => (
                <Row key={r.id}
                  primary={r.type}
                  secondary={[`Due: ${fmt(r.dueDate)}`, r.frequency, r.isDone ? '✓ Done' : 'Pending'].filter(Boolean).join(' · ')}
                  tertiary={r.notes} />
              ))}
          </Section>
        </>
      )}
    </div>
  )
}

// ── User Pets View ───────────────────────────────────────────────────────────

function UserPetsView({ user, onBack }) {
  const [pets, setPets] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedPet, setSelectedPet] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    getPets(user.id)
      .then(setPets)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [user.id])

  return (
    <div>
      <button onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-bold mb-2 hover:underline"
        style={{ color: '#7a4900' }}>
        <ChevronLeft className="w-4 h-4" /> All users
      </button>

      <div className="flex items-center gap-3 mb-5 p-3 rounded-xl" style={{ backgroundColor: '#fff9e0' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: '#f2b83d' }}>
          {user.phone
            ? <Phone className="w-4 h-4" style={{ color: '#7a4900' }} />
            : <Mail className="w-4 h-4" style={{ color: '#7a4900' }} />}
        </div>
        <div>
          <p className="font-bold text-sm" style={{ color: '#7a4900' }}>
            {user.phone || user.email}
          </p>
          <p className="text-xs" style={{ color: '#73775b' }}>
            Joined {new Date(user.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      </div>

      {selectedPet ? (
        <PetStatsPanel pet={selectedPet} onBack={() => setSelectedPet(null)} />
      ) : (
        <>
          <p className="text-xs font-black uppercase tracking-wider mb-3" style={{ color: '#73775b' }}>
            Pets ({pets.length})
          </p>
          {loading && (
            <div className="flex items-center gap-2 py-4" style={{ color: '#73775b' }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-sm"
              style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
          {!loading && pets.length === 0 && (
            <div className="text-center py-10">
              <PawPrint className="w-10 h-10 mx-auto mb-2 opacity-20" style={{ color: '#7a4900' }} />
              <p className="text-sm" style={{ color: '#73775b' }}>This user has no pets yet.</p>
            </div>
          )}
          <div className="space-y-2">
            {pets.map(pet => (
              <PetRow key={pet.id} pet={pet} onSelect={setSelectedPet} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Feedback Panel ───────────────────────────────────────────────────────────

const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent']

function FeedbackPanel() {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    getFeedback()
      .then(setItems)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const avg = items.filter(i => i.rating).length
    ? (items.filter(i => i.rating).reduce((s, i) => s + i.rating, 0) / items.filter(i => i.rating).length).toFixed(1)
    : null

  return (
    <div>
      {/* Summary strip */}
      {!loading && !error && items.length > 0 && (
        <div className="flex items-center gap-6 mb-5 p-4 rounded-2xl"
          style={{ backgroundColor: '#fff3c0', border: '1.5px solid #f2b83d' }}>
          <div className="text-center">
            <p className="text-2xl font-black" style={{ color: '#7a4900' }}>{items.length}</p>
            <p className="text-xs" style={{ color: '#7a4900' }}>responses</p>
          </div>
          {avg && (
            <div className="flex items-center gap-1.5">
              <Star className="w-6 h-6" fill="#f2b83d" style={{ color: '#c99a2e' }} />
              <div>
                <p className="text-2xl font-black leading-none" style={{ color: '#7a4900' }}>{avg}</p>
                <p className="text-xs" style={{ color: '#7a4900' }}>avg rating</p>
              </div>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16" style={{ color: '#73775b' }}>
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading feedback…</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl text-sm"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="text-center py-16">
          <MessageSquarePlus className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#7a4900' }} />
          <p className="text-sm" style={{ color: '#73775b' }}>No feedback submitted yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className="p-4 rounded-2xl"
            style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map(n => (
                  <Star key={n} className="w-4 h-4"
                    fill={item.rating >= n ? '#f2b83d' : 'none'}
                    style={{ color: item.rating >= n ? '#c99a2e' : '#e0d3b4' }} />
                ))}
                {item.rating && (
                  <span className="text-xs ml-1 font-bold" style={{ color: '#7a4900' }}>
                    {STAR_LABELS[item.rating]}
                  </span>
                )}
              </div>
              <span className="text-xs flex-shrink-0" style={{ color: '#73775b' }}>
                {new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            {item.category && (
              <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full mb-2"
                style={{ backgroundColor: '#ebe3d3', color: '#7a4900' }}>
                {item.category}
              </span>
            )}
            <p className="text-sm leading-relaxed" style={{ color: '#7a4900' }}>{item.message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}


// ── Usage Panel ──────────────────────────────────────────────────────────────
//
// What Pippy costs and how much room is left. The live figures come from
// get_usage_metrics_for_admin(), which is SECURITY DEFINER because
// pg_database_size and storage.objects are not readable by an ordinary
// signed-in user. It returns TOTALS only -- no per-user figures and no
// addresses, so this screen cannot become a way to see who did what.

function Meter({ metricKey, value }) {
  const t = THRESHOLDS[metricKey]
  const pct = pctOf(metricKey, value)
  const over = Number(value || 0) > t.limit
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-bold" style={{ color: '#7a4900' }}>{t.label}</span>
        <span className="text-sm font-black" style={{ color: over ? '#c0392b' : '#7a4900' }}>
          {t.fmt(value)}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#ebe3d3' }}>
        {/* Minimum 2% so a real but tiny value is still visibly present rather
            than looking like zero. */}
        <div className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%`,
                   backgroundColor: over ? '#c0392b' : pct > 75 ? '#f2b83d' : '#8cb369' }} />
      </div>
      <p className="text-xs mt-1" style={{ color: '#73775b' }}>
        {pct}% of the {t.fmt(t.limit)} alert threshold{t.note ? ` \u00b7 ${t.note}` : ''}
      </p>
    </div>
  )
}

function UsagePanel() {
  const [metrics, setMetrics] = useState(null)
  const [weeks, setWeeks]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const supabase = await getSupabase()
        const { data, error: e } = await supabase.rpc('get_usage_metrics_for_admin')
        if (e) throw e
        const row = Array.isArray(data) ? data[0] : data
        // The function returns no rows rather than an error when the caller is
        // not an admin, so an empty result is a permission problem and not an
        // absence of usage.
        if (!row) throw new Error('No metrics returned. Check that usage_tracking.sql has been run and that your account is an admin.')
        const { data: snaps } = await supabase
          .from('usage_snapshots')
          .select('day, openai_cost_mtd_usd, openai_calls_mtd, db_bytes, storage_bytes, photo_bytes, pets_total')
          .order('day', { ascending: false })
          .limit(70)
        if (!alive) return
        setMetrics(row)
        setWeeks(byWeek(snaps || []).slice(0, 8))
      } catch (err) {
        if (alive) setError(err.message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16" style={{ color: '#73775b' }}>
      <Loader2 className="w-5 h-5 animate-spin" /> <span>Reading usage\u2026</span>
    </div>
  )

  if (error) return (
    <div className="flex items-start gap-2 p-4 rounded-xl text-sm"
      style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span>{error}</span>
    </div>
  )

  const over = breaches(metrics)

  return (
    <div>
      {over.length > 0 && (
        <div className="p-3 rounded-xl mb-4 text-sm font-bold"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          {over.map(b => <div key={b.key}>{b.text}</div>)}
        </div>
      )}

      <div className="card mb-4">
        <Meter metricKey="openai_cost_mtd_usd" value={metrics.openai_cost_mtd_usd} />
        <Meter metricKey="db_bytes"            value={metrics.db_bytes} />
        <Meter metricKey="storage_bytes"       value={metrics.storage_bytes} />
        <p className="text-xs pt-1" style={{ color: '#73775b' }}>
          Spend is Pippy&apos;s own estimate from logged token counts, not OpenAI&apos;s bill.
          The cap on the OpenAI account is the real backstop.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <StatChip icon={Sparkles}  label="AI calls this month" count={metrics.openai_calls_mtd} />
        <StatChip icon={Sparkles}  label="Spend all time"      count={`$${Number(metrics.openai_cost_all_usd || 0).toFixed(4)}`} />
        <StatChip icon={Users}     label="Users"               count={metrics.users_total} />
        <StatChip icon={PawPrint}  label="Pets"                count={metrics.pets_total} />
        <StatChip icon={HardDrive} label="Photos in database"  count={`${(Number(metrics.photo_bytes || 0) / 1024).toFixed(0)} kB`} />
      </div>

      <Section icon={Gauge} title="By week" count={weeks.length} color="#7a4900">
        {weeks.length === 0 ? (
          <EmptyRow label="No snapshots yet. The nightly job writes one a day; the first week appears after it has run." />
        ) : weeks.map(w => (
          <Row key={w.weekStart}
            primary={`Week of ${w.weekStart}`}
            secondary={`$${Number(w.openai_cost_mtd_usd).toFixed(4)} \u00b7 ${w.openai_calls_mtd} calls`}
            tertiary={`${(w.db_bytes / MB).toFixed(1)} MB db \u00b7 ${(w.storage_bytes / MB).toFixed(1)} MB files`} />
        ))}
      </Section>
    </div>
  )
}


// ── Errors Panel ─────────────────────────────────────────────────────────────
//
// What is breaking in people's browsers. Grouped by fingerprint, so one fault
// hitting fifty people is one row rather than fifty -- which is the difference
// between a list you read and a list you ignore.
//
// Nothing here identifies anyone: the browser scrubs every report before
// sending and the endpoint scrubs again. Addresses, ids, phone numbers, query
// strings and tokens are all replaced before storage.

function ErrorsPanel() {
  const [rows, setRows]       = useState([])
  const [days, setDays]       = useState(7)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getSupabase()
      .then(supabase => supabase.rpc('get_client_errors_for_admin', { days }))
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
      <Loader2 className="w-5 h-5 animate-spin" /> <span>Reading error reports\u2026</span>
    </div>
  )

  if (error) return (
    <div className="flex items-start gap-2 p-4 rounded-xl text-sm"
      style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>{error}. Check that supabase/client_errors.sql has been run.</span>
    </div>
  )

  return (
    <div>
      <div className="flex gap-1 rounded-xl p-1 mb-4 w-fit" style={{ backgroundColor: '#ebe3d3' }}>
        {[1, 7, 30].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={days === d ? { backgroundColor: '#f2b83d', color: '#7a4900' } : { color: '#73775b' }}>
            {d === 1 ? 'Today' : `${d} days`}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16">
          <Bug className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#7a4900' }} />
          <p className="text-sm" style={{ color: '#73775b' }}>
            No errors reported in this period. That is the good outcome.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.fingerprint} className="p-3 rounded-xl"
              style={{ backgroundColor: '#ffffff', border: '1px solid #ebe3d3' }}>
              <div className="flex items-start justify-between gap-3 mb-1">
                <span className="font-black text-sm break-words" style={{ color: '#c0392b' }}>
                  {r.name}
                </span>
                <span className="text-xs font-black px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
                  {r.occurrences}&times;
                </span>
              </div>
              <p className="text-xs mb-2 break-words" style={{ color: '#7a4900' }}>{r.message}</p>
              <p className="text-[11px]" style={{ color: '#73775b' }}>
                {r.view} &middot; {r.browser} &middot; build {r.build} &middot;{' '}
                {r.users_affected} {r.users_affected === 1 ? 'person' : 'people'} &middot;{' '}
                last {new Date(r.last_seen).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Providers Panel ──────────────────────────────────────────────────────────

const EMPTY_PROVIDER = { name: '', type: 'Vet', services: [], specializations: [], description: '', address: '', area: '', city: '', phone: '', whatsapp: '', email: '', website: '', hours: '', photo_url: '', maps_url: '', is_approved: false }

const TYPE_ICONS = { Vet: Stethoscope, Groomer: Scissors, Store: ShoppingBag, Boarder: Home, 'Special Services': Camera, 'Pet Loss & Memorial Services': Flower2 }
const TYPE_COLORS = { Vet: '#2f7286', Groomer: '#b2566f', Store: '#5f7a3a', Boarder: '#c9891f', 'Special Services': '#c0563d', 'Pet Loss & Memorial Services': '#5f624b' }

function TagPicker({ label, options, value, onChange }) {
  const toggle = t => onChange(value.includes(t) ? value.filter(x => x !== t) : [...value, t].sort())
  return (
    <div>
      <label className="label text-xs">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(t => {
          const on = value.includes(t)
          return (
            <button key={t} type="button" onClick={() => toggle(t)}
              className="px-2.5 py-1 rounded-full text-xs font-bold transition-all"
              style={on ? { backgroundColor: '#ffde59', color: '#7a4900' }
                        : { backgroundColor: '#f5f0e0', color: '#73775b' }}>
              {t}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ProviderForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial)
  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  return (
    <div className="p-4 rounded-2xl space-y-3" style={{ backgroundColor: '#fff9e0', border: '1.5px solid #f2b83d' }}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label text-xs">Name *</label>
          <input name="name" value={form.name} onChange={set} className="input w-full" required placeholder="e.g. PawCare Clinic" />
        </div>
        <div>
          <label className="label text-xs">Type</label>
          <select name="type" value={form.type} onChange={set} className="input w-full">
            {PROVIDER_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs">Area / Locality</label>
          <input name="area" value={form.area || ''} onChange={set} className="input w-full" placeholder="Kothrud" />
        </div>
        <div>
          <label className="label text-xs">City</label>
          <input name="city" value={form.city} onChange={set} className="input w-full" placeholder="Pune" />
        </div>
        <div className="col-span-2">
          <label className="label text-xs">Address</label>
          <input name="address" value={form.address} onChange={set} className="input w-full" placeholder="123 MG Road" />
        </div>
        <div>
          <label className="label text-xs">Phone</label>
          <input name="phone" value={form.phone} onChange={set} className="input w-full" placeholder="+91 98765 43210" />
        </div>
        <div>
          <label className="label text-xs">WhatsApp number</label>
          <input name="whatsapp" value={form.whatsapp} onChange={set} className="input w-full" placeholder="+91 98765 43210" />
        </div>
        <div>
          <label className="label text-xs">Hours</label>
          <input name="hours" value={form.hours} onChange={set} className="input w-full" placeholder="Mon–Sat 9am–7pm" />
        </div>
        <div>
          <label className="label text-xs">Google Maps URL</label>
          <input name="maps_url" value={form.maps_url} onChange={set} className="input w-full" placeholder="https://maps.google.com/..." />
        </div>
        <div className="col-span-2">
          <label className="label text-xs">Photo URL</label>
          <input name="photo_url" value={form.photo_url} onChange={set} className="input w-full" placeholder="https://..." />
        </div>
        <div className="col-span-2">
          <label className="label text-xs">Description</label>
          <textarea name="description" value={form.description} onChange={set} className="input w-full" rows={2} placeholder="Short description visible to users" />
        </div>
      </div>
      {/* Services and specialisations are picked from a fixed vocabulary, not
          typed. providers is world-readable through the anon-granted
          search_providers(), and these columns get pattern-matched, so nothing
          hand-authored belongs in them. This is also how the ~70% of vets the
          import couldn't evidence get a specialisation — by someone who knows. */}
      <TagPicker label="Services offered" options={SERVICES}
        value={form.services || []} onChange={v => setForm(f => ({ ...f, services: v }))} />
      <TagPicker label="Specialisations" options={SPECIALIZATIONS}
        value={form.specializations || []} onChange={v => setForm(f => ({ ...f, specializations: v }))} />

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center text-sm">Cancel</button>
        <button type="button" onClick={() => onSave(form)} disabled={saving || !form.name.trim()}
          className="btn-primary flex-1 justify-center gap-2 text-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save Provider
        </button>
      </div>
    </div>
  )
}

const ADMIN_PAGE_SIZE = 50

function ProvidersPanel() {
  const [providers, setProviders] = useState([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [adding, setAdding]       = useState(false)
  const [editing, setEditing]     = useState(null)  // provider id
  const [saving, setSaving]       = useState(false)
  const [search, setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  // is_approved=false means two different things in this table: "a business
  // registered and is waiting for you" and "a breeder or fish shop the
  // categorisation pass deliberately hid". Mixing them buries a real
  // registration among eleven rows that must never be approved, so the review
  // queue filters to self-registered only.
  const [pendingOnly, setPendingOnly] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const isAwaitingReview = p => !p.is_approved && p.source === 'self_registered'

  function load() {
    setLoading(true)
    getProviders({ approvedOnly: false, search: debouncedSearch, limit: ADMIN_PAGE_SIZE, offset: 0 })
      .then(({ rows, count }) => { setProviders(rows); setTotal(count) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [debouncedSearch])

  // Counted separately from the page above, which only holds 50 rows — a badge
  // that silently meant "on this page" would be worse than no badge.
  useEffect(() => {
    getProviders({ approvedOnly: false, search: '', limit: 200, offset: 0 })
      .then(({ rows }) => setPendingCount(rows.filter(isAwaitingReview).length))
      .catch(() => setPendingCount(0))
  }, [saving])

  async function loadMore() {
    const { rows } = await getProviders({
      approvedOnly: false, search: debouncedSearch,
      limit: ADMIN_PAGE_SIZE, offset: providers.length,
    })
    setProviders(prev => [...prev, ...rows])
  }

  async function handleSave(form) {
    setSaving(true)
    try { await saveProvider(form); load(); setAdding(false); setEditing(null) }
    catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  async function handleToggleApprove(p) {
    setSaving(true)
    try { await saveProvider({ ...p, is_approved: !p.is_approved }); load() }
    catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this provider?')) return
    await deleteProvider(id); load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>
          {total} providers
        </p>
        <button onClick={() => { setAdding(true); setEditing(null) }}
          className="btn-primary text-sm gap-1.5">
          <Plus className="w-4 h-4" /> Add Provider
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#73775b' }} />
        <input type="text" className="input w-full pl-9 text-sm"
          placeholder="Search providers by name, area or type…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {adding && (
        <div className="mb-4">
          <ProviderForm initial={EMPTY_PROVIDER} onSave={handleSave} onCancel={() => setAdding(false)} saving={saving} />
        </div>
      )}

      {loading && <div className="flex items-center gap-2 py-8" style={{ color: '#73775b' }}><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
      {error && <div className="flex gap-2 p-3 rounded-xl text-sm" style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}

      <div className="space-y-3">
        <button onClick={() => setPendingOnly(v => !v)}
          className="text-xs font-bold px-3 py-1.5 rounded-full mb-3 flex items-center gap-1.5"
          style={pendingOnly
            ? { backgroundColor: '#f2b83d', color: '#7a4900' }
            : { backgroundColor: '#ebe3d3', color: '#7a4900' }}>
          {pendingOnly ? 'Showing review queue' : 'Pending review'}
          {pendingCount > 0 && (
            <span className="px-1.5 rounded-full" style={{ backgroundColor: '#c0392b', color: '#fff' }}>
              {pendingCount}</span>
          )}
        </button>
        {(pendingOnly ? providers.filter(isAwaitingReview) : providers).map(p => {
          const Icon = TYPE_ICONS[p.type] || ShoppingBag
          const color = TYPE_COLORS[p.type] || '#73775b'
          return editing === p.id ? (
            <ProviderForm key={p.id} initial={p} onSave={handleSave} onCancel={() => setEditing(null)} saving={saving} />
          ) : (
            <div key={p.id} className="p-4 rounded-2xl" style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: color + '18' }}>
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-sm" style={{ color: '#7a4900' }}>{p.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                      style={{ backgroundColor: color + '18', color }}>{p.type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${p.is_approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {p.is_approved ? '✓ Approved' : '⏳ Pending'}
                    </span>
                  </div>
                  {(p.area || p.city) && <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>{[p.area, p.city].filter(Boolean).join(' · ')}{p.address ? ` · ${p.address}` : ''}</p>}
                  {p.phone && <p className="text-xs" style={{ color: '#73775b' }}>{p.phone}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleToggleApprove(p)} title={p.is_approved ? 'Unapprove' : 'Approve'}
                    className="p-1.5 rounded-lg hover:bg-amber-50 transition-colors">
                    {p.is_approved
                      ? <ToggleRight className="w-5 h-5" style={{ color: '#5f7a3a' }} />
                      : <ToggleLeft className="w-5 h-5" style={{ color: '#73775b' }} />}
                  </button>
                  <button onClick={() => setEditing(p.id)} title="Edit"
                    className="p-1.5 rounded-lg hover:bg-amber-50 transition-colors text-xs font-bold"
                    style={{ color: '#7a4900' }}>Edit</button>
                  <button onClick={() => handleDelete(p.id)} title="Delete"
                    className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {providers.length < total && (
        <button onClick={loadMore}
          className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold transition-all"
          style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
          Show more ({total - providers.length} left)
        </button>
      )}

      {!loading && providers.length === 0 && !adding && (
        <div className="text-center py-10">
          <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-20" style={{ color: '#7a4900' }} />
          <p className="text-sm" style={{ color: '#73775b' }}>No providers yet. Add one above.</p>
        </div>
      )}
    </div>
  )
}

// ── Main AdminDashboard ──────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [users, setUsers]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [search, setSearch]       = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [tab, setTab]             = useState('users')   // users | feedback | providers | boarding | usage | errors

  useEffect(() => {
    setLoading(true)
    getAdminUsers()
      .then(setUsers)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = users.filter(u => {
    const q = search.toLowerCase()
    return (u.phone || '').includes(q) || (u.email || '').toLowerCase().includes(q)
  })

  return (
    <div className="min-h-full" style={{ backgroundColor: '#FFFEF8' }}>
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: '#f2b83d' }}>
            <ShieldCheck className="w-5 h-5" style={{ color: '#7a4900' }} />
          </div>
          <div>
            <h1 className="text-xl font-black leading-tight" style={{ color: '#7a4900' }}>Admin Dashboard</h1>
            <p className="text-xs" style={{ color: '#73775b' }}>
              {users.length} registered {users.length === 1 ? 'user' : 'users'}
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        {!selectedUser && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 rounded-xl p-1 mb-5" style={{ backgroundColor: '#ebe3d3' }}>
            <button
              onClick={() => setTab('users')}
              className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
              style={tab === 'users' ? { backgroundColor: '#f2b83d', color: '#7a4900' } : { color: '#73775b' }}>
              <Users className="w-4 h-4" /> Users
            </button>
            <button
              onClick={() => setTab('feedback')}
              className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
              style={tab === 'feedback' ? { backgroundColor: '#f2b83d', color: '#7a4900' } : { color: '#73775b' }}>
              <MessageSquarePlus className="w-4 h-4" /> Feedback
            </button>
            <button
              onClick={() => setTab('providers')}
              className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
              style={tab === 'providers' ? { backgroundColor: '#f2b83d', color: '#7a4900' } : { color: '#73775b' }}>
              <MapPin className="w-4 h-4" /> Providers
            </button>
            <button
              onClick={() => setTab('boarding')}
              className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
              style={tab === 'boarding' ? { backgroundColor: '#f2b83d', color: '#7a4900' } : { color: '#73775b' }}>
              <Home className="w-4 h-4" /> Boarding
            </button>
            <button
              onClick={() => setTab('usage')}
              className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
              style={tab === 'usage' ? { backgroundColor: '#f2b83d', color: '#7a4900' } : { color: '#73775b' }}>
              <Gauge className="w-4 h-4" /> Usage
            </button>
            <button
              onClick={() => setTab('errors')}
              className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
              style={tab === 'errors' ? { backgroundColor: '#f2b83d', color: '#7a4900' } : { color: '#73775b' }}>
              <Bug className="w-4 h-4" /> Errors
            </button>
          </div>
        )}

        {tab === 'errors' && !selectedUser ? (
          <ErrorsPanel />
        ) : tab === 'usage' && !selectedUser ? (
          <UsagePanel />
        ) : tab === 'boarding' && !selectedUser ? (
          <BoardingRulesPanel />
        ) : tab === 'providers' && !selectedUser ? (
          <ProvidersPanel />
        ) : tab === 'feedback' && !selectedUser ? (
          <FeedbackPanel />
        ) : selectedUser ? (
          <UserPetsView user={selectedUser} onBack={() => setSelectedUser(null)} />
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#73775b' }} />
              <input
                type="text"
                className="input w-full pl-9"
                placeholder="Search by phone or email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* Content */}
            {loading && (
              <div className="flex items-center justify-center gap-2 py-16" style={{ color: '#73775b' }}>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Loading users…</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-4 rounded-xl text-sm"
                style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}. Make sure the <code>get_all_users_for_admin</code> SQL function is deployed.</span>
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="text-center py-16">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#7a4900' }} />
                <p className="text-sm" style={{ color: '#73775b' }}>
                  {search ? 'No users match your search.' : 'No users registered yet.'}
                </p>
              </div>
            )}

            <div className="space-y-2">
              {filtered.map(user => (
                <UserCard key={user.id} user={user} onSelect={setSelectedUser} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
