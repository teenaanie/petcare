import { useEffect, useState } from 'react'
import { ShieldCheck, Users, PawPrint, ChevronRight, ChevronLeft, Search, Phone, Mail, Loader2, AlertCircle, Stethoscope, Syringe, Pill, Receipt, TrendingUp, Bell } from 'lucide-react'
import { getAdminUsers, getPets, getMedicalHistory, getVaccinations, getMedicines, getBills } from '../lib/storage.js'
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

function PetStatsPanel({ pet, onBack }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [medical, vaccinations, medicines, bills] = await Promise.all([
          getMedicalHistory(pet.id).catch(() => []),
          getVaccinations(pet.id).catch(() => []),
          getMedicines(pet.id).catch(() => []),
          getBills(pet.id).catch(() => []),
        ])
        setStats({ medical, vaccinations, medicines, bills })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [pet.id])

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
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4" style={{ color: '#B8A080' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading records…</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <StatChip icon={Stethoscope} label="Medical visits" count={stats.medical.length} />
          <StatChip icon={Syringe} label="Vaccinations" count={stats.vaccinations.length} />
          <StatChip icon={Pill} label="Medicines" count={stats.medicines.length} />
          <StatChip icon={Receipt} label="Bills" count={stats.bills.length} />
        </div>
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

// ── Main AdminDashboard ──────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [users, setUsers]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [search, setSearch]       = useState('')
  const [selectedUser, setSelectedUser] = useState(null)

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

        {selectedUser ? (
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
