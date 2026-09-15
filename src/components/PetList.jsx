import { useEffect, useState } from 'react'
import { PawPrint, Plus, Calendar, Weight, Store, ChevronRight } from 'lucide-react'
import { getPets } from '../lib/storage.js'
import { format } from 'date-fns'
import PetAvatar from './PetAvatar.jsx'

export default function PetList({ refresh, onSelectPet, onAddPet, onFindServices }) {
  const [pets, setPets] = useState([])

  useEffect(() => {
    getPets().then(setPets).catch(console.error)
  }, [refresh])

  if (pets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 text-center p-8">
        <div className="w-24 h-24 rounded-3xl flex items-center justify-center"
          style={{ backgroundColor: '#fff3c0' }}>
          <PawPrint className="w-12 h-12" style={{ color: '#7a4900' }} />
        </div>
        <div>
          <h2 className="text-2xl font-black mb-1" style={{ color: '#7a4900' }}>No pets yet 🐾</h2>
          <p className="text-sm" style={{ color: '#73775b' }}>Add your first pet to start tracking their health.</p>
        </div>
        <button onClick={onAddPet} className="btn-primary gap-2">
          <Plus className="w-4 h-4" /> Add my first pet
        </button>

        {/* Someone with no pets yet can still browse the directory */}
        {onFindServices && (
          <button onClick={onFindServices}
            className="flex items-center gap-2 text-sm font-bold underline-offset-4 hover:underline"
            style={{ color: '#73775b' }}>
            <Store className="w-4 h-4" /> Or find vets and services near you
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black" style={{ color: '#7a4900' }}>My Pets 🐾</h1>
        <button onClick={onAddPet} className="btn-primary gap-2">
          <Plus className="w-4 h-4" /> Add Pet
        </button>
      </div>

      {onFindServices && (
        <button onClick={onFindServices}
          className="w-full flex items-center gap-3 mb-5 p-4 rounded-2xl text-left transition-all"
          style={{ backgroundColor: '#ffde59', border: '1.5px solid #f2b83d' }}>
          <span className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#7a4900' }}>
            <Store className="w-5 h-5" style={{ color: '#ffde59' }} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-black text-sm" style={{ color: '#7a4900' }}>Find Services near you</span>
            <span className="block text-xs" style={{ color: '#7a4900', opacity: .75 }}>
              Vets, groomers, boarding and stores
            </span>
          </span>
          <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: '#7a4900' }} />
        </button>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pets.map(pet => (
          <button
            key={pet.id}
            onClick={() => onSelectPet(pet)}
            className="card text-left transition-all group"
            style={{ cursor: 'pointer' }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(242, 184, 61, 0.3)'
              e.currentTarget.style.borderColor = '#f2b83d'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = ''
              e.currentTarget.style.boxShadow = ''
              e.currentTarget.style.borderColor = '#ebe3d3'
            }}
          >
            <div className="flex items-center gap-4 mb-4">
              <PetAvatar pet={pet} size="lg" />
              <div>
                <h3 className="font-black text-base" style={{ color: '#7a4900' }}>{pet.name}</h3>
                <p className="text-sm" style={{ color: '#73775b' }}>{pet.species} · {pet.breed}</p>
              </div>
            </div>
            <div className="flex gap-4 text-sm" style={{ color: '#73775b' }}>
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
              <p className="text-xs mt-2" style={{ color: '#73775b' }}>Color: {pet.color}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
