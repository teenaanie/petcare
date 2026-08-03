import { Menu, ChevronLeft, Plus, PawPrint } from 'lucide-react'

export default function MobileHeader({ selectedPet, onBack, onMenuOpen, onAddPet }) {
  return (
    <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
      {selectedPet ? (
        <>
          <button onClick={onBack} className="flex items-center gap-1 text-primary-600 font-medium">
            <ChevronLeft className="w-5 h-5" /> Pets
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-bold">
              {selectedPet.name[0]?.toUpperCase()}
            </div>
            <span className="font-semibold text-gray-900 text-sm">{selectedPet.name}</span>
          </div>
          <div className="w-10" /> {/* spacer */}
        </>
      ) : (
        <>
          <button onClick={onMenuOpen} className="p-1 text-gray-600">
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary-600 rounded-lg flex items-center justify-center">
              <PawPrint className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gray-900">MyPetCare</span>
          </div>
          <button onClick={onAddPet} className="p-1 text-primary-600">
            <Plus className="w-6 h-6" />
          </button>
        </>
      )}
    </header>
  )
}
