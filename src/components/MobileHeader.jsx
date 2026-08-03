import { Menu, ChevronLeft, Plus, PawPrint } from 'lucide-react'
import PetAvatar from './PetAvatar.jsx'

export default function MobileHeader({ selectedPet, onBack, onMenuOpen, onAddPet }) {
  return (
    <header className="md:hidden flex items-center justify-between px-4 py-3 flex-shrink-0"
      style={{ backgroundColor: '#FFFEF8', borderBottom: '1px solid #F0E6C8' }}>
      {selectedPet ? (
        <>
          <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold" style={{ color: '#4A2C0A' }}>
            <ChevronLeft className="w-5 h-5" /> Pets
          </button>
          <div className="flex items-center gap-2">
            <PetAvatar pet={selectedPet} size="xs" />
            <span className="font-bold text-sm" style={{ color: '#4A2C0A' }}>{selectedPet.name}</span>
          </div>
          <div className="w-10" />
        </>
      ) : (
        <>
          <button onClick={onMenuOpen} className="p-1" style={{ color: '#6B4C1E' }}>
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#F9D548' }}>
              <PawPrint className="w-4 h-4" style={{ color: '#4A2C0A' }} />
            </div>
            <span className="text-xl font-black" style={{ color: '#4A2C0A' }}>
              pip<span style={{ color: '#F9D548', WebkitTextStroke: '1px #4A2C0A' }}>py</span>
            </span>
          </div>
          <button onClick={onAddPet} className="p-1" style={{ color: '#4A2C0A' }}>
            <Plus className="w-6 h-6" />
          </button>
        </>
      )}
    </header>
  )
}
