import { useEffect, useState } from 'react'
import { PawPrint, Plus, Stethoscope, Syringe, AlertTriangle, FileText, Bell, ChevronRight, GitBranch, Upload } from 'lucide-react'
import { getPets } from '../lib/storage.js'
import MigrateData from './MigrateData.jsx'

const tabs = [
  { id: 'timeline',      label: 'Timeline',          icon: GitBranch },
  { id: 'medical',       label: 'Medical History',   icon: Stethoscope },
  { id: 'vaccinations',  label: 'Vaccinations',      icon: Syringe },
  { id: 'allergies',     label: 'Allergies',         icon: AlertTriangle },
  { id: 'scanner',       label: 'Scan Documents',    icon: FileText },
  { id: 'reminders',     label: 'Reminders',         icon: Bell },
]

export default function Sidebar({ selectedPet, onSelectPet, onAddPet, activeTab, onTabChange, refresh, onRefresh, isOpen, onClose }) {
  const [pets, setPets]           = useState([])
  const [showMigrate, setShowMigrate] = useState(false)

  // Show migrate banner if there's local data that hasn't been moved yet
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
    `} style={{ backgroundColor: '#FFFEF8', borderRight: '1px solid #F0E6C8' }}>
      {/* Logo */}
      <div className="px-5 py-4" style={{ borderBottom: '1px solid #F0E6C8' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#F9D548' }}>
            <PawPrint className="w-5 h-5" style={{ color: '#4A2C0A' }} />
          </div>
          <span className="text-2xl font-black tracking-tight" style={{ color: '#4A2C0A', fontFamily: 'Nunito, sans-serif' }}>
            pip<span style={{ color: '#F9D548' }}>py</span>
          </span>
        </div>
      </div>

      {/* Pets list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pt-4 pb-1">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-black uppercase tracking-wider" style={{ color: '#B8A080' }}>My Pets</span>
            <button
              onClick={onAddPet}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ backgroundColor: '#FFF5AA' }}
              title="Add pet"
            >
              <Plus className="w-4 h-4" style={{ color: '#4A2C0A' }} />
            </button>
          </div>

          {pets.length === 0 && (
            <p className="text-xs px-2 py-2" style={{ color: '#B8A080' }}>No pets yet — add one! 🐾</p>
          )}

          {pets.map(pet => (
            <button
              key={pet.id}
              onClick={() => onSelectPet(pet)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all text-left"
              style={selectedPet?.id === pet.id
                ? { backgroundColor: '#F9D548', color: '#4A2C0A' }
                : { color: '#6B4C1E' }
              }
              onMouseEnter={e => { if (selectedPet?.id !== pet.id) e.currentTarget.style.backgroundColor = '#FFF9D6' }}
              onMouseLeave={e => { if (selectedPet?.id !== pet.id) e.currentTarget.style.backgroundColor = '' }}
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-black flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #F9D548, #8B9636)' }}>
                {pet.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{pet.name}</div>
                <div className="text-xs truncate" style={{ color: '#B8A080' }}>{pet.species} · {pet.breed}</div>
              </div>
              {selectedPet?.id === pet.id && <ChevronRight className="w-4 h-4 flex-shrink-0" />}
            </button>
          ))}
        </div>

        {/* Tabs for selected pet */}
        {selectedPet && (
          <div className="px-3 pt-3 pb-1 mt-2" style={{ borderTop: '1px solid #F0E6C8' }}>
            <span className="text-xs font-black uppercase tracking-wider px-2 block mb-2" style={{ color: '#B8A080' }}>
              {selectedPet.name}
            </span>
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl mb-0.5 transition-all text-left text-sm font-semibold"
                style={activeTab === id
                  ? { backgroundColor: '#F9D548', color: '#4A2C0A' }
                  : { color: '#6B4C1E' }
                }
                onMouseEnter={e => { if (activeTab !== id) e.currentTarget.style.backgroundColor = '#FFF9D6' }}
                onMouseLeave={e => { if (activeTab !== id) e.currentTarget.style.backgroundColor = '' }}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>{/* end flex-1 scroll area */}

      {/* Migrate local data banner */}
      {hasLocalData && (
        <div className="px-3 py-3" style={{ borderTop: '1px solid #F0E6C8' }}>
          <button
            onClick={() => setShowMigrate(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-colors"
            style={{ backgroundColor: '#C2DFF0', color: '#4A2C0A' }}
          >
            <Upload className="w-3.5 h-3.5 flex-shrink-0" />
            Move local data to cloud
          </button>
        </div>
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
