import { useEffect, useState } from 'react'
import { PawPrint, Plus, Stethoscope, Syringe, AlertTriangle, FileText, Bell, ChevronRight, GitBranch } from 'lucide-react'
import { getPets } from '../lib/storage.js'

const tabs = [
  { id: 'timeline',      label: 'Timeline',          icon: GitBranch },
  { id: 'medical',       label: 'Medical History',   icon: Stethoscope },
  { id: 'vaccinations',  label: 'Vaccinations',      icon: Syringe },
  { id: 'allergies',     label: 'Allergies',         icon: AlertTriangle },
  { id: 'scanner',       label: 'Scan Documents',    icon: FileText },
  { id: 'reminders',     label: 'Reminders',         icon: Bell },
]

export default function Sidebar({ selectedPet, onSelectPet, onAddPet, activeTab, onTabChange, refresh }) {
  const [pets, setPets] = useState([])

  useEffect(() => {
    setPets(getPets())
  }, [refresh])

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <PawPrint className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-gray-900 text-lg">MyPetCare</span>
        </div>
      </div>

      {/* Pets list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pt-4 pb-1">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">My Pets</span>
            <button
              onClick={onAddPet}
              className="w-6 h-6 rounded-md bg-primary-50 hover:bg-primary-100 flex items-center justify-center transition-colors"
              title="Add pet"
            >
              <Plus className="w-4 h-4 text-primary-600" />
            </button>
          </div>

          {pets.length === 0 && (
            <p className="text-xs text-gray-400 px-2 py-2">No pets yet. Add one!</p>
          )}

          {pets.map(pet => (
            <button
              key={pet.id}
              onClick={() => onSelectPet(pet)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-colors text-left ${
                selectedPet?.id === pet.id
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {pet.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{pet.name}</div>
                <div className="text-xs text-gray-400 truncate">{pet.species} · {pet.breed}</div>
              </div>
              {selectedPet?.id === pet.id && <ChevronRight className="w-4 h-4 flex-shrink-0" />}
            </button>
          ))}
        </div>

        {/* Tabs for selected pet */}
        {selectedPet && (
          <div className="px-3 pt-3 pb-1 border-t border-gray-100 mt-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 block mb-2">
              {selectedPet.name}
            </span>
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg mb-0.5 transition-colors text-left text-sm ${
                  activeTab === id
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
