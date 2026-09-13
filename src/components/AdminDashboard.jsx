import { useEffect, useState } from 'react'
import { ShieldCheck, Users, PawPrint, ChevronRight, ChevronLeft, Search, Phone, Mail, Loader2, AlertCircle, Stethoscope, Syringe, Pill, Receipt, Bell, ChevronDown, ChevronUp, Star, MessageSquarePlus, MapPin, Clock, Scissors, ShoppingBag, Home, Camera, Flower2, Plus, Check, X, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'
import { getAdminUsers, getPets, getMedicalHistory, getVaccinations, getMedicines, getBills, getReminders, getFeedback, getProviders, saveProvider, deleteProvider } from '../lib/storage.js'
import PetAvatar from './PetAvatar.jsx'

// ── User Card ────────────────────────────────────────────────────────────────

function UserCard({ user, onSelect }) {
  return (
    <button
      onClick={() => onSelect(user)}
      className="w-full text-left p-4 rounded-2xl transition-all flex items-center gap-4 group"
      style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #F0E6C8' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#F9D548'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#F0E6C8'}
    >
      {/* Avatar */}
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: '#FFF5AA' }}>
        {user.phone
          ? <Phone className="w-5 h-5" style={{ color: '#4A2C0A' }} />
          : <Mail className="w-5 h-5" style={{ color: '#4A2C0A' }} />}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm truncate" style={{ color: '#4A2C0A' }}>
          {user.phone || user.email || 'Unknown user'}
        </p>
        <p className="text-xs mt-0.5" style={{ color: '#B8A080' }}>
          {user.pet_count ?? 0} {user.pet_count === 1 ? 'pet' : 'pets'} ·{' '}
          Joined {new Date(user.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
        </p>
      </div>

      {/* Chevron */}
      <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-30 group-hover:opacity-80 transition-opacity"
        style={{ color: '#4A2C0A' }} />
    </button>
  )
}

// ── Pet Detail Row ───────────────────────────────────────────────────────────

function PetRow({ pet, onSelect }) {
  return (
    <button
      onClick={() => onSelect(pet)}
      className="w-full text-left p-4 rounded-2xl transition-all flex items-center gap-4 group"
      style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #F0E6C8' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#F9D548'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#F0E6C8'}
    >
      <PetAvatar pet={pet} size="md" />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm" style={{ color: '#4A2C0A' }}>{pet.name}</p>
        <p className="text-xs mt-0.5" style={{ color: '#B8A080' }}>
          {pet.species} · {pet.breed}
          {pet.age ? ` · ${pet.age} yrs` : ''}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 opacity-30 group-hover:opacity-80 transition-opacity"
        style={{ color: '#4A2C0A' }} />
    </button>
  )
}

// ── Pet Stats Panel ──────────────────────────────────────────────────────────

function StatChip({ icon: Icon, label, count, color = '#4A2C0A' }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{ backgroundColor: '#FFF9D6', border: '1px solid #F0E6C8' }}>
      <Icon className="w-4 h-4 flex-shrink-0" style={{ color }} />
      <div>
        <p className="text-xs font-black leading-none" style={{ color: '#4A2C0A' }}>{count}</p>
        <p className="text-[10px] leading-none mt-0.5" style={{ color: '#B8A080' }}>{label}</p>
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, count, color, children }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-4 rounded-2xl overflow-hidden border" style={{ borderColor: '#F0E6C8' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: '#FFF9D6' }}>
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color }} />
          <span className="text-sm font-black" style={{ color: '#4A2C0A' }}>{title}</span>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: color + '22', color }}>{count}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4" style={{ color: '#B8A080' }} />
               : <ChevronDown className="w-4 h-4" style={{ color: '#B8A080' }} />}
      </button>
      {open && <div className="divide-y" style={{ divideColor: '#F0E6C8' }}>{children}</div>}
    </div>
  )
}

function Row({ primary, secondary, tertiary }) {
  return (
    <div className="px-4 py-3" style={{ backgroundColor: '#FFFEF8' }}>
      <p className="text-sm font-bold" style={{ color: '#4A2C0A' }}>{primary}</p>
      {secondary && <p className="text-xs mt-0.5" style={{ color: '#B8A080' }}>{secondary}</p>}
      {tertiary  && <p className="text-xs mt-0.5" style={{ color: '#6B4C1E' }}>{tertiary}</p>}
    </div>
  )
}

function EmptyRow({ label }) {
  return (
    <div className="px-4 py-3 text-xs italic" style={{ color: '#B8A080', backgroundColor: '#FFFEF8' }}>
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
        style={{ color: '#6B4C1E' }}>
        <ChevronLeft className="w-4 h-4" /> Back to pets
      </button>

      <div className="flex items-center gap-4 mb-6">
        <PetAvatar pet={pet} size="lg" />
        <div>
          <h3 className="text-xl font-black" style={{ color: '#4A2C0A' }}>{pet.name}</h3>
          <p className="text-sm" style={{ color: '#B8A080' }}>
            {pet.species} · {pet.breed}{pet.age ? ` · ${pet.age} yrs` : ''}
            {pet.weight ? ` · ${pet.weight} kg` : ''}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6" style={{ color: '#B8A080' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading records…</span>
        </div>
      ) : (
        <>
          {/* Medical */}
          <Section icon={Stethoscope} title="Medical Records" count={data.medical.length} color="#2563EB">
            {data.medical.length === 0 ? <EmptyRow label="medical records" /> :
              data.medical.map(r => (
                <Row key={r.id}
                  primary={r.title || r.type}
                  secondary={[r.type, r.vet, fmt(r.date)].filter(Boolean).join(' · ')}
                  tertiary={r.description} />
              ))}
          </Section>

          {/* Vaccinations */}
          <Section icon={Syringe} title="Vaccinations" count={data.vaccinations.length} color="#7C3AED">
            {data.vaccinations.length === 0 ? <EmptyRow label="vaccinations" /> :
              data.vaccinations.map(r => (
                <Row key={r.id}
                  primary={r.name}
                  secondary={[r.vet ? `By ${r.vet}` : null, `Given: ${fmt(r.dateGiven)}`, r.nextDue ? `Next due: ${fmt(r.nextDue)}` : null].filter(Boolean).join(' · ')}
                  tertiary={r.notes} />
              ))}
          </Section>

          {/* Medicines */}
          <Section icon={Pill} title="Medicines" count={data.medicines.length} color="#059669">
            {data.medicines.length === 0 ? <EmptyRow label="medicines" /> :
              data.medicines.map(r => (
                <Row key={r.id}
                  primary={r.name}
                  secondary={[r.dosage, r.frequency, r.startDate ? `From ${fmt(r.startDate)}` : null].filter(Boolean).join(' · ')}
                  tertiary={r.notes} />
              ))}
          </Section>

          {/* Bills */}
          <Section icon={Receipt} title="Bills" count={data.bills.length} color="#D97706">
            {data.bills.length === 0 ? <EmptyRow label="bills" /> :
              data.bills.map(r => (
                <Row key={r.id}
                  primary={r.description || r.category}
                  secondary={[r.category, fmt(r.date), r.total ? `₹${r.total}` : null].filter(Boolean).join(' · ')} />
              ))}
          </Section>

          {/* Reminders */}
          <Section icon={Bell} title="Reminders" count={data.reminders.length} color="#DC2626">
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
        style={{ color: '#6B4C1E' }}>
        <ChevronLeft className="w-4 h-4" /> All users
      </button>

      <div className="flex items-center gap-3 mb-5 p-3 rounded-xl" style={{ backgroundColor: '#FFF9D6' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: '#F9D548' }}>
          {user.phone
            ? <Phone className="w-4 h-4" style={{ color: '#4A2C0A' }} />
            : <Mail className="w-4 h-4" style={{ color: '#4A2C0A' }} />}
        </div>
        <div>
          <p className="font-bold text-sm" style={{ color: '#4A2C0A' }}>
            {user.phone || user.email}
          </p>
          <p className="text-xs" style={{ color: '#B8A080' }}>
            Joined {new Date(user.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      </div>

      {selectedPet ? (
        <PetStatsPanel pet={selectedPet} onBack={() => setSelectedPet(null)} />
      ) : (
        <>
          <p className="text-xs font-black uppercase tracking-wider mb-3" style={{ color: '#B8A080' }}>
            Pets ({pets.length})
          </p>
          {loading && (
            <div className="flex items-center gap-2 py-4" style={{ color: '#B8A080' }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-sm"
              style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
          {!loading && pets.length === 0 && (
            <div className="text-center py-10">
              <PawPrint className="w-10 h-10 mx-auto mb-2 opacity-20" style={{ color: '#4A2C0A' }} />
              <p className="text-sm" style={{ color: '#B8A080' }}>This user has no pets yet.</p>
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
          style={{ backgroundColor: '#FFF5AA', border: '1.5px solid #F9D548' }}>
          <div className="text-center">
            <p className="text-2xl font-black" style={{ color: '#4A2C0A' }}>{items.length}</p>
            <p className="text-xs" style={{ color: '#6B4C1E' }}>responses</p>
          </div>
          {avg && (
            <div className="flex items-center gap-1.5">
              <Star className="w-6 h-6" fill="#F9D548" style={{ color: '#D4A800' }} />
              <div>
                <p className="text-2xl font-black leading-none" style={{ color: '#4A2C0A' }}>{avg}</p>
                <p className="text-xs" style={{ color: '#6B4C1E' }}>avg rating</p>
              </div>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16" style={{ color: '#B8A080' }}>
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading feedback…</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl text-sm"
          style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="text-center py-16">
          <MessageSquarePlus className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#4A2C0A' }} />
          <p className="text-sm" style={{ color: '#B8A080' }}>No feedback submitted yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className="p-4 rounded-2xl"
            style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #F0E6C8' }}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map(n => (
                  <Star key={n} className="w-4 h-4"
                    fill={item.rating >= n ? '#F9D548' : 'none'}
                    style={{ color: item.rating >= n ? '#D4A800' : '#D1C4A8' }} />
                ))}
                {item.rating && (
                  <span className="text-xs ml-1 font-bold" style={{ color: '#6B4C1E' }}>
                    {STAR_LABELS[item.rating]}
                  </span>
                )}
              </div>
              <span className="text-xs flex-shrink-0" style={{ color: '#B8A080' }}>
                {new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            {item.category && (
              <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full mb-2"
                style={{ backgroundColor: '#F0E6C8', color: '#6B4C1E' }}>
                {item.category}
              </span>
            )}
            <p className="text-sm leading-relaxed" style={{ color: '#4A2C0A' }}>{item.message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Providers Panel ──────────────────────────────────────────────────────────

const PROVIDER_TYPES = ['Vet', 'Groomer', 'Store', 'Boarder', 'Special Services', 'Pet Loss & Memorial Services']
const EMPTY_PROVIDER = { name: '', type: 'Vet', description: '', address: '', area: '', city: '', phone: '', whatsapp: '', email: '', website: '', hours: '', photo_url: '', maps_url: '', is_approved: false }

const TYPE_ICONS = { Vet: Stethoscope, Groomer: Scissors, Store: ShoppingBag, Boarder: Home, 'Special Services': Camera, 'Pet Loss & Memorial Services': Flower2 }
const TYPE_COLORS = { Vet: '#2563EB', Groomer: '#7C3AED', Store: '#059669', Boarder: '#D97706', 'Special Services': '#DB2777', 'Pet Loss & Memorial Services': '#475569' }

function ProviderForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial)
  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  return (
    <div className="p-4 rounded-2xl space-y-3" style={{ backgroundColor: '#FFF9D6', border: '1.5px solid #F9D548' }}>
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

function ProvidersPanel() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [adding, setAdding]       = useState(false)
  const [editing, setEditing]     = useState(null)  // provider id
  const [saving, setSaving]       = useState(false)

  function load() {
    getProviders(false)
      .then(setProviders)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

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
        <p className="text-xs font-black uppercase tracking-wider" style={{ color: '#B8A080' }}>
          {providers.length} providers
        </p>
        <button onClick={() => { setAdding(true); setEditing(null) }}
          className="btn-primary text-sm gap-1.5">
          <Plus className="w-4 h-4" /> Add Provider
        </button>
      </div>

      {adding && (
        <div className="mb-4">
          <ProviderForm initial={EMPTY_PROVIDER} onSave={handleSave} onCancel={() => setAdding(false)} saving={saving} />
        </div>
      )}

      {loading && <div className="flex items-center gap-2 py-8" style={{ color: '#B8A080' }}><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
      {error && <div className="flex gap-2 p-3 rounded-xl text-sm" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}

      <div className="space-y-3">
        {providers.map(p => {
          const Icon = TYPE_ICONS[p.type] || ShoppingBag
          const color = TYPE_COLORS[p.type] || '#6B7280'
          return editing === p.id ? (
            <ProviderForm key={p.id} initial={p} onSave={handleSave} onCancel={() => setEditing(null)} saving={saving} />
          ) : (
            <div key={p.id} className="p-4 rounded-2xl" style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #F0E6C8' }}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: color + '18' }}>
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-sm" style={{ color: '#4A2C0A' }}>{p.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                      style={{ backgroundColor: color + '18', color }}>{p.type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${p.is_approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {p.is_approved ? '✓ Approved' : '⏳ Pending'}
                    </span>
                  </div>
                  {(p.area || p.city) && <p className="text-xs mt-0.5" style={{ color: '#B8A080' }}>{[p.area, p.city].filter(Boolean).join(' · ')}{p.address ? ` · ${p.address}` : ''}</p>}
                  {p.phone && <p className="text-xs" style={{ color: '#B8A080' }}>{p.phone}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleToggleApprove(p)} title={p.is_approved ? 'Unapprove' : 'Approve'}
                    className="p-1.5 rounded-lg hover:bg-amber-50 transition-colors">
                    {p.is_approved
                      ? <ToggleRight className="w-5 h-5" style={{ color: '#059669' }} />
                      : <ToggleLeft className="w-5 h-5" style={{ color: '#B8A080' }} />}
                  </button>
                  <button onClick={() => setEditing(p.id)} title="Edit"
                    className="p-1.5 rounded-lg hover:bg-amber-50 transition-colors text-xs font-bold"
                    style={{ color: '#6B4C1E' }}>Edit</button>
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

      {!loading && providers.length === 0 && !adding && (
        <div className="text-center py-10">
          <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-20" style={{ color: '#4A2C0A' }} />
          <p className="text-sm" style={{ color: '#B8A080' }}>No providers yet. Add one above.</p>
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
  const [tab, setTab]             = useState('users')   // 'users' | 'feedback' | 'providers'

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
            style={{ backgroundColor: '#F9D548' }}>
            <ShieldCheck className="w-5 h-5" style={{ color: '#4A2C0A' }} />
          </div>
          <div>
            <h1 className="text-xl font-black leading-tight" style={{ color: '#4A2C0A' }}>Admin Dashboard</h1>
            <p className="text-xs" style={{ color: '#B8A080' }}>
              {users.length} registered {users.length === 1 ? 'user' : 'users'}
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        {!selectedUser && (
          <div className="flex rounded-xl p-1 mb-5" style={{ backgroundColor: '#F0E6C8' }}>
            <button
              onClick={() => setTab('users')}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
              style={tab === 'users' ? { backgroundColor: '#F9D548', color: '#4A2C0A' } : { color: '#B8A080' }}>
              <Users className="w-4 h-4" /> Users
            </button>
            <button
              onClick={() => setTab('feedback')}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
              style={tab === 'feedback' ? { backgroundColor: '#F9D548', color: '#4A2C0A' } : { color: '#B8A080' }}>
              <MessageSquarePlus className="w-4 h-4" /> Feedback
            </button>
            <button
              onClick={() => setTab('providers')}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
              style={tab === 'providers' ? { backgroundColor: '#F9D548', color: '#4A2C0A' } : { color: '#B8A080' }}>
              <MapPin className="w-4 h-4" /> Providers
            </button>
          </div>
        )}

        {tab === 'providers' && !selectedUser ? (
          <ProvidersPanel />
        ) : tab === 'feedback' && !selectedUser ? (
          <FeedbackPanel />
        ) : selectedUser ? (
          <UserPetsView user={selectedUser} onBack={() => setSelectedUser(null)} />
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#B8A080' }} />
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
              <div className="flex items-center justify-center gap-2 py-16" style={{ color: '#B8A080' }}>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Loading users…</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-4 rounded-xl text-sm"
                style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}. Make sure the <code>get_all_users_for_admin</code> SQL function is deployed.</span>
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="text-center py-16">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: '#4A2C0A' }} />
                <p className="text-sm" style={{ color: '#B8A080' }}>
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
