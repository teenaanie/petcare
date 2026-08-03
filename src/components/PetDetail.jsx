import { useState } from 'react'
import { Edit2, Trash2, Calendar, Weight, Shield, Phone, Mail } from 'lucide-react'
import { deletePet } from '../lib/storage.js'
import { format } from 'date-fns'
import AddPetModal from './AddPetModal.jsx'
import Timeline from './Timeline.jsx'
import MedicalHistory from './MedicalHistory.jsx'
import Vaccinations from './Vaccinations.jsx'
import Allergies from './Allergies.jsx'
import DocumentScanner from './DocumentScanner.jsx'
import Reminders from './Reminders.jsx'

export default function PetDetail({ pet, activeTab, onTabChange, onPetUpdated, onPetDeleted }) {
  const [showEdit, setShowEdit] = useState(false)

  async function handleDelete() {
    if (confirm(`Delete ${pet.name}? This will remove all their records.`)) {
      await deletePet(pet.id)
      onPetDeleted()
    }
  }

  const age = pet.dob
    ? Math.floor((Date.now() - new Date(pet.dob)) / (1000 * 60 * 60 * 24 * 365))
    : null

  return (
    <div className="p-4 md:p-8">
      {/* Pet header */}
      <div className="card mb-4 md:mb-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-2xl md:text-3xl font-bold flex-shrink-0">
              {pet.name[0]?.toUpperCase()}
            </div>
            <div>
              <h1 className="text-lg md:text-2xl font-bold text-gray-900">{pet.name}</h1>
              <p className="text-sm text-gray-500">{pet.species} · {pet.breed}</p>
              <div className="flex flex-wrap gap-2 md:gap-4 mt-1 text-xs md:text-sm text-gray-500">
                {age !== null && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {age} yr</span>}
                {pet.weight && <span className="flex items-center gap-1"><Weight className="w-3.5 h-3.5" /> {pet.weight}kg</span>}
                {pet.vetPhone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {pet.vetPhone}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={() => setShowEdit(true)} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              <Edit2 className="w-4 h-4" />
            </button>
            <button onClick={handleDelete} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'timeline'     && <Timeline pet={pet} />}
      {activeTab === 'medical'      && <MedicalHistory pet={pet} />}
      {activeTab === 'vaccinations' && <Vaccinations pet={pet} />}
      {activeTab === 'allergies'    && <Allergies pet={pet} />}
      {activeTab === 'scanner'      && <DocumentScanner pet={pet} />}
      {activeTab === 'reminders'    && <Reminders pet={pet} />}

      {showEdit && (
        <AddPetModal
          pet={pet}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false)
            // reload pet from storage
            const updated = JSON.parse(localStorage.getItem('mypetcare_pets') || '[]').find(p => p.id === pet.id)
            if (updated) onPetUpdated(updated)
          }}
        />
      )}
    </div>
  )
}
