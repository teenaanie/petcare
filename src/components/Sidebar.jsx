import { useEffect, useState } from 'react'
import { PawPrint, Plus, Stethoscope, Syringe, AlertTriangle, FileText, Bell, ChevronLeft, GitBranch, Upload, TrendingUp, ChevronRight, Pill, Receipt, LogOut, ShieldCheck, Store, Home } from 'lucide-react'
import { getPets } from '../lib/storage.js'
import MigrateData from './MigrateData.jsx'
import PetAvatar from './PetAvatar.jsx'
import PippyLogo from './PippyLogo.jsx'
import DeleteAccount from './DeleteAccount.jsx'

const tabs = [
  { id: 'timeline',      label: 'Timeline',          icon: GitBranch },
  { id: 'reminders',     label: 'Reminders',         icon: Bell },
  { id: 'scanner',       label: 'Scan Documents',    icon: FileText },
  { id: 'medical',       label: 'Medical History',   icon: Stethoscope },
  { id: 'vaccinations',  label: 'Vaccinations',      icon: Syringe },
  { id: 'medicines',     label: 'Medicines',         icon: Pill },
  { id: 'weight',        label: 'Weight Trend',      icon: TrendingUp },
  { id: 'allergies',     label: 'Allergies',         icon: AlertTriangle },
  { id: 'bills',         label: 'Bills',             icon: Receipt },
  { id: 'boarding',      label: 'Boarding Prep',     icon: Home },
]

export default function Sidebar({ selectedPet, onSelectPet, onAddPet, activeTab, onTabChange, refresh, onRefresh, isOpen, onClose, user, isAdmin, onSignOut, adminView, onToggleAdmin, servicesView, onToggleServices }) {
  const [pets, setPets]               = useState([])
  const [showMigrate, setShowMigrate] = useState(false)
  const [showDelete, setShowDelete]   = useState(false)

  const hasLocalData = (() => {
    try { return ['mypetcare_pets','mypetcare_medical','mypetcare_vaccinations','mypetcare_allergies','mypetcare_reminders'].some(k => (JSON.parse(localStorage.getItem(k) || '[]')).length > 0) } catch { return false }
  })()

  useEffect(() => {
    getPets().then(setPets).catch(console.error)
  }, [refresh])

  return (
    <aside className={`
      w-64 flex flex-col h-full flex-shrink-0
      fixed md:relative z-40 inset-y-0 left-0
      transition-transform duration-300 ease-in-out
      ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
    `} style={{ backgroundColor: '#FFFEF8', borderRight: '1px solid #ebe3d3' }}>

      {/* ── Pet selected: focused view ──────────────────────────────────── */}
      {selectedPet ? (
        <>
          {/* Back to all pets */}
          <button
            onClick={() => { onSelectPet(null); onClose?.() }}
            className="flex items-center gap-1.5 px-4 py-3 text-sm font-bold transition-colors w-full text-left flex-shrink-0"
            style={{ color: '#7a4900', borderBottom: '1px solid #ebe3d3' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#fff9e0'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
          >
            <ChevronLeft className="w-4 h-4" />
            All Pets
          </button>

          {/* Selected pet header */}
          <div className="px-4 py-4 flex items-center gap-3 flex-shrink-0"
            style={{ borderBottom: '1px solid #ebe3d3' }}>
            <PetAvatar pet={selectedPet} size="md" />
            <div className="min-w-0">
              <div className="font-black text-base truncate" style={{ color: '#7a4900' }}>{selectedPet.name}</div>
              <div className="text-xs truncate" style={{ color: '#73775b' }}>{selectedPet.species} · {selectedPet.breed}</div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { onTabChange(id); onClose?.() }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl mb-0.5 transition-all text-left text-sm font-semibold"
                style={activeTab === id
                  ? { backgroundColor: '#f2b83d', color: '#7a4900' }
                  : { color: '#7a4900' }
                }
                onMouseEnter={e => { if (activeTab !== id) e.currentTarget.style.backgroundColor = '#fff9e0' }}
                onMouseLeave={e => { if (activeTab !== id) e.currentTarget.style.backgroundColor = '' }}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {/* Find Services stays reachable from inside a pet too. Pinned
              outside the scrolling tab list, so it can't sink out of view. */}
          <div className="px-3 pt-3 pb-1 flex-shrink-0" style={{ borderTop: '1px solid #ebe3d3' }}>
            <button
              onClick={onToggleServices}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-all"
              style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}
            >
              <Store className="w-4 h-4 flex-shrink-0" />
              Find Services
            </button>
          </div>

          {/* Migrate banner */}
          {hasLocalData && (
            <div className="px-3 py-3 flex-shrink-0">
              <button
                onClick={() => setShowMigrate(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold"
                style={{ backgroundColor: '#bfe5ef', color: '#7a4900' }}
              >
                <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                Move local data to cloud
              </button>
            </div>
          )}
          {!hasLocalData && <div className="pb-3 flex-shrink-0" />}
        </>
      ) : (
        /* ── No pet selected: full pets list ──────────────────────────── */
        <>
          {/* Logo */}
          <div className="px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #ebe3d3' }}>
            <div className="flex items-center gap-2.5">
              <PippyLogo size="md" />
              <span className="text-2xl font-black tracking-tight" style={{ color: '#7a4900', fontFamily: 'Nunito, sans-serif' }}>
                pip<span style={{ color: '#f2b83d' }}>py</span>
              </span>
            </div>
          </div>

          {/* Find Services — a primary destination, so it sits above the pet
              list instead of sinking below it as pets are added. */}
          <div className="px-3 pt-3 flex-shrink-0">
            <button
              onClick={onToggleServices}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-all"
              style={servicesView
                ? { backgroundColor: '#ffde59', color: '#7a4900' }
                : { backgroundColor: '#fff3c0', color: '#7a4900' }}
            >
              <Store className="w-4 h-4 flex-shrink-0" />
              Find Services
            </button>
          </div>

          {/* Pets list */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 pt-4 pb-1">
              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>My Pets</span>
                <button
                  onClick={onAddPet}
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                  style={{ backgroundColor: '#fff3c0' }}
                  title="Add pet"
                >
                  <Plus className="w-4 h-4" style={{ color: '#7a4900' }} />
                </button>
              </div>

              {pets.length === 0 && (
                <p className="text-xs px-2 py-2" style={{ color: '#73775b' }}>No pets yet — add one! 🐾</p>
              )}

              {pets.map(pet => (
                <button
                  key={pet.id}
                  onClick={() => onSelectPet(pet)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all text-left"
                  style={{ color: '#7a4900' }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#fff9e0' }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = '' }}
                >
                  <PetAvatar pet={pet} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{pet.name}</div>
                    <div className="text-xs truncate" style={{ color: '#73775b' }}>{pet.species} · {pet.breed}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-40" />
                </button>
              ))}
            </div>
          </div>

          {/* Admin Panel toggle */}
          {isAdmin && (
            <div className="px-3 pt-1.5 flex-shrink-0">
              <button
                onClick={onToggleAdmin}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all"
                style={adminView
                  ? { backgroundColor: '#f2b83d', color: '#7a4900' }
                  : { backgroundColor: '#fff3c0', color: '#7a4900' }}
              >
                <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#c9891f' }} />
                {adminView ? 'Exit Admin View' : 'Admin Panel'}
              </button>
            </div>
          )}

          {/* Migrate banner */}
          {hasLocalData && (
            <div className="px-3 pt-3 flex-shrink-0" style={{ borderTop: isAdmin ? 'none' : '1px solid #ebe3d3' }}>
              <button
                onClick={() => setShowMigrate(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold"
                style={{ backgroundColor: '#bfe5ef', color: '#7a4900' }}
              >
                <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                Move local data to cloud
              </button>
            </div>
          )}

          {/* User + sign out */}
          {user && onSignOut && (
            <div className="px-3 py-3 flex-shrink-0" style={{ borderTop: hasLocalData ? 'none' : '1px solid #ebe3d3' }}>
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl"
                style={{ backgroundColor: '#fff9e0' }}>
                <div className="min-w-0">
                  {isAdmin && (
                    <div className="flex items-center gap-1 mb-0.5">
                      <ShieldCheck className="w-3 h-3" style={{ color: '#c9891f' }} />
                      <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: '#c9891f' }}>Admin</span>
                    </div>
                  )}
                  <p className="text-xs font-bold truncate" style={{ color: '#7a4900' }}>
                    {user.phone || user.email || 'Logged in'}
                  </p>
                </div>
                <button onClick={onSignOut} title="Sign out"
                  className="p-1.5 rounded-lg flex-shrink-0 hover:bg-amber-100 transition-colors">
                  <LogOut className="w-3.5 h-3.5" style={{ color: '#73775b' }} />
                </button>
              </div>

              <button onClick={() => setShowDelete(true)}
                className="w-full text-left text-[11px] mt-2 px-2 py-1 rounded-lg transition-colors hover:bg-red-50"
                style={{ color: '#a08f7a' }}>
                Delete my account
              </button>
            </div>
          )}
        </>
      )}

      {showDelete && (
        <DeleteAccount
          user={user}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { setShowDelete(false); window.location.reload() }}
        />
      )}

      {showMigrate && (
        <MigrateData
          onClose={() => setShowMigrate(false)}
          onDone={() => { setShowMigrate(false); if (onRefresh) onRefresh() }}
        />
      )}
    </aside>
  )
}
