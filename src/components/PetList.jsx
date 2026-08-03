import { useEffect, useState } from 'react'
import { PawPrint, Plus, Calendar, Weight } from 'lucide-react'
import { getPets } from '../lib/storage.js'
import { format } from 'date-fns'
import PetAvatar from './PetAvatar.jsx'

export default function PetList({ refresh, onSelectPet, onAddPet }) {
  const [pets, setPets] = useState([])

  useEffect(() => {
    getPets().then(setPets).catch(console.error)
  }, [refresh])

  if (pets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 text-center p-8">
        <div className="w-24 h-24 rounded-3xl flex items-center justify-center"
          style={{ backgroundColor: '#FFF5AA' }}>
          <PawPrint className="w-12 h-12" style={{ color: '#4A2C0A' }} />
        </div>
        <div>
          <h2 className="text-2xl font-black mb-1" style={{ color: '#4A2C0A' }}>No pets yet 🐾</h2>
          <p className="text-sm" style={{ color: '#B8A080' }}>Add your first pet to start tracking their health.</p>
        </div>
        <button onClick={onAddPet} className="btn-primary gap-2">
          <Plus className="w-4 h-4" /> Add my first pet
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black" style={{ color: '#4A2C0A' }}>My Pets 🐾</h1>
        <button onClick={onAddPet} className="btn-primary gap-2">
          <Plus className="w-4 h-4" /> Add Pet
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pets.map(pet => (
          <button
            key={pet.id}
            onClick={() => onSelectPet(pet)}
            className="card text-left transition-all group"
            style={{ cursor: 'pointer' }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(249, 213, 72, 0.3)'
              e.currentTarget.style.borderColor = '#F9D548'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = ''
              e.currentTarget.style.boxShadow = ''
              e.currentTarget.style.borderColor = '#F0E6C8'
            }}
          >
            <div className="flex items-center gap-4 mb-4">
              <PetAvatar pet={pet} size="lg" />
              <div>
                <h3 className="font-black text-base" style={{ color: '#4A2C0A' }}>{pet.name}</h3>
                <p className="text-sm" style={{ color: '#B8A080' }}>{pet.species} · {pet.breed}</p>
              </div>
            </div>
            <div className="flex gap-4 text-sm" style={{ color: '#B8A080' }}>
              {pet.dob && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {format(new Date(pet.dob), 'MMM d, yyyy')}
                </span>
              )}
              {pet.weight && (
                <span className="flex items-center gap-1">
                  <Weight className="w-3.5 h-3.5" />
                  {pet.weight} kg
                </span>
              )}
            </div>
            {pet.color && (
              <p className="text-xs mt-2" style={{ color: '#B8A080' }}>Color: {pet.color}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
