import { PawPrint, Store, ShieldCheck, Heart } from 'lucide-react'

// App-level destinations. This bar is always present on mobile, so the
// directory and admin panel are one tap from anywhere rather than buried in
// the drawer. Section navigation within a pet lives in PetDetail's chip row.
export default function MobileAppNav({ view, onNavigate, isAdmin }) {
  const items = [
    { id: 'pets',      label: 'Pets',      icon: PawPrint },
    { id: 'providers', label: 'Providers', icon: Heart },
    { id: 'services',  label: 'Services',  icon: Store },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: ShieldCheck }] : []),
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20"
      style={{ backgroundColor: '#FFFEF8', borderTop: '1px solid #ebe3d3' }}>
      <div className="flex">
        {items.map(({ id, label, icon: Icon }) => {
          const active = view === id
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              aria-current={active ? 'page' : undefined}
              className="flex-1 flex flex-col items-center gap-1 py-2.5 transition-all"
              style={{ color: active ? '#7a4900' : '#73775b' }}
            >
              <span className="rounded-lg px-3 py-1 transition-colors"
                style={{ backgroundColor: active ? '#ffde59' : 'transparent' }}>
                <Icon className="w-5 h-5" />
              </span>
              <span className="text-[11px] font-black leading-none whitespace-nowrap">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
