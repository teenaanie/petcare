import { Menu, ChevronLeft, Plus, PawPrint } from 'lucide-react'
import PetAvatar from './PetAvatar.jsx'
import PippyLogo from './PippyLogo.jsx'
import NotificationBell from './NotificationBell.jsx'

export default function MobileHeader({ selectedPet, onBack, onMenuOpen, onAddPet, refresh, onOpenReminder, onRemindersChanged }) {
  return (
    <header className="md:hidden flex items-center justify-between px-4 py-3 flex-shrink-0"
      style={{ backgroundColor: '#FFFEF8', borderBottom: '1px solid #ebe3d3' }}>
      {selectedPet ? (
        <>
          <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold" style={{ color: '#7a4900' }}>
            <ChevronLeft className="w-5 h-5" /> Pets
          </button>
          <div className="flex items-center gap-2">
            <PetAvatar pet={selectedPet} size="xs" />
            <span className="font-bold text-sm" style={{ color: '#7a4900' }}>{selectedPet.name}</span>
          </div>
          {/* This was an empty spacer. The bell balances the header and, more
              to the point, stays reachable while you are inside a pet. */}
          <NotificationBell refresh={refresh} onOpenReminder={onOpenReminder} onChanged={onRemindersChanged} />
        </>
      ) : (
        <>
          <button onClick={onMenuOpen} className="p-1" style={{ color: '#7a4900' }}>
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <PippyLogo size="sm" />
            <span className="text-xl font-black" style={{ color: '#7a4900' }}>
              pip<span style={{ color: '#f2b83d', WebkitTextStroke: '1px #7a4900' }}>py</span>
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <NotificationBell refresh={refresh} onOpenReminder={onOpenReminder} onChanged={onRemindersChanged} />
            <button onClick={onAddPet} className="p-1" style={{ color: '#7a4900' }}>
              <Plus className="w-6 h-6" />
            </button>
          </div>
        </>
      )}
    </header>
  )
}
