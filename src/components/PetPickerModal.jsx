import { useEffect, useState } from 'react'
import { X, Loader2, ClipboardCheck } from 'lucide-react'
import { getPets } from '../lib/storage.js'
import PetAvatar from './PetAvatar.jsx'

// Asks which pet a provider action is for. With a single pet there is nothing
// to ask, so it picks for you and never appears.
export default function PetPickerModal({ provider, onClose, onPick }) {
  const [pets, setPets]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getPets()
      .then(rows => {
        if (cancelled) return
        setPets(rows)
        if (rows.length === 1) onPick(rows[0])
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading || pets.length === 1) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-sm rounded-3xl overflow-hidden flex flex-col"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #ebe3d3' }}>
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardCheck className="w-5 h-5 flex-shrink-0" style={{ color: '#c9891f' }} />
            <span className="font-black truncate" style={{ color: '#7a4900' }}>Who's staying?</span>
          </div>
          <button onClick={onClose} style={{ color: '#73775b' }}><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          <p className="text-sm mb-2" style={{ color: '#73775b' }}>
            Boarding prep for {provider.name}.
          </p>
          {pets.length === 0 && (
            <p className="text-sm" style={{ color: '#73775b' }}>Add a pet first, then come back here.</p>
          )}
          {pets.map(pet => (
            <button key={pet.id} onClick={() => onPick(pet)}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all"
              style={{ backgroundColor: '#fffef8', border: '1.5px solid #ebe3d3' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#fff9e0'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = '#fffef8'}>
              <PetAvatar pet={pet} size="md" />
              <div className="min-w-0">
                <div className="font-black text-sm truncate" style={{ color: '#7a4900' }}>{pet.name}</div>
                <div className="text-xs truncate" style={{ color: '#73775b' }}>{pet.species}{pet.breed ? ` · ${pet.breed}` : ''}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
