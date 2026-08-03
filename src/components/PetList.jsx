import { useEffect, useState } from 'react'
import { PawPrint, Plus, Calendar, Weight } from 'lucide-react'
import { getPets } from '../lib/storage.js'
import { format } from 'date-fns'

export default function PetList({ refresh, onSelectPet, onAddPet }) {
  const [pets, setPets] = useState([])

  useEffect(() => {
    getPets().then(setPets).catch(console.error)
  }, [refresh])

  if (pets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <div className="w-20 h-20 bg-primary-50 rounded-full flex items-center justify-center">
          <PawPrint className="w-10 h-10 text-primary-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">No pets yet</h2>
          <p className="text-gray-500 text-sm">Add your first pet to get started tracking their health.</p>
        </div>
        <button onClick={onAddPet} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add my first pet
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Pets</h1>
        <button onClick={onAddPet} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Pet
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pets.map(pet => (
          <button
            key={pet.id}
            onClick={() => onSelectPet(pet)}
            className="card text-left hover:shadow-md transition-shadow group"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
                {pet.name[0]?.toUpperCase()}
              </div>
              <div>
                <h3 className="font-bold text-gray-900 group-hover:text-primary-600 transition-colors">{pet.name}</h3>
                <p className="text-sm text-gray-500">{pet.species} · {pet.breed}</p>
              </div>
            </div>
            <div className="flex gap-4 text-sm text-gray-500">
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
              <p className="text-xs text-gray-400 mt-2">Color: {pet.color}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
