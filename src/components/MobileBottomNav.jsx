import { GitBranch, Stethoscope, Syringe, AlertTriangle, FileText, Bell, TrendingUp, Pill, Receipt } from 'lucide-react'

const tabs = [
  { id: 'scanner',      label: 'Scan',        icon: FileText },
  { id: 'timeline',     label: 'Timeline',    icon: GitBranch },
  { id: 'medical',      label: 'Medical',     icon: Stethoscope },
  { id: 'vaccinations', label: 'Vaccines',    icon: Syringe },
  { id: 'medicines',    label: 'Medicines',   icon: Pill },
  { id: 'weight',       label: 'Weight',      icon: TrendingUp },
  { id: 'bills',        label: 'Bills',       icon: Receipt },
  { id: 'allergies',    label: 'Allergies',   icon: AlertTriangle },
  { id: 'reminders',    label: 'Reminders',   icon: Bell },
]

export default function MobileBottomNav({ activeTab, onTabChange }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 scrollbar-hide"
      style={{ backgroundColor: '#FFFEF8', borderTop: '1px solid #F0E6C8' }}>
      <div className="flex overflow-x-auto scrollbar-hide">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className="flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2 min-w-[64px] transition-all"
            style={{ color: activeTab === id ? '#4A2C0A' : '#B8A080' }}
          >
            <div className="relative">
              {activeTab === id && (
                <div className="absolute inset-0 rounded-lg -m-1" style={{ backgroundColor: '#F9D548' }} />
              )}
              <Icon className="w-5 h-5 relative z-10" />
            </div>
            <span className="text-[10px] font-bold leading-none mt-0.5">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
