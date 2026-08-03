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
    <div className="p-8">
      {/* Pet header */}
      <div className="card mb-6 flex items-start justify-between">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-3xl font-bold">
            {pet.name[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{pet.name}</h1>
            <p className="text-gray-500">{pet.species} · {pet.breed} · {pet.gender}</p>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
              {age !== null && (
                <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> {age} yr old</span>
              )}
              {pet.weight && (
                <span className="flex items-center gap-1"><Weight className="w-4 h-4" /> {pet.weight} kg</span>
              )}
              {pet.microchipId && (
                <span className="flex items-center gap-1"><Shield className="w-4 h-4" /> {pet.microchipId}</span>
              )}
              {pet.vetPhone && (
                <span className="flex items-center gap-1"><Phone className="w-4 h-4" /> {pet.vetPhone}</span>
              )}
              {pet.vetEmail && (
                <span className="flex items-center gap-1"><Mail className="w-4 h-4" /> {pet.vetEmail}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowEdit(true)} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Edit2 className="w-4 h-4" /> Edit
          </button>
          <button onClick={handleDelete} className="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
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
