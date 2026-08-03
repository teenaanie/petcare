import { GitBranch, Stethoscope, Syringe, AlertTriangle, FileText, Bell } from 'lucide-react'

const tabs = [
  { id: 'timeline',     label: 'Timeline',    icon: GitBranch },
  { id: 'medical',      label: 'Medical',     icon: Stethoscope },
  { id: 'vaccinations', label: 'Vaccines',    icon: Syringe },
  { id: 'allergies',    label: 'Allergies',   icon: AlertTriangle },
  { id: 'scanner',      label: 'Scan',        icon: FileText },
  { id: 'reminders',    label: 'Reminders',   icon: Bell },
]

export default function MobileBottomNav({ activeTab, onTabChange }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-20">
      <div className="flex overflow-x-auto scrollbar-hide">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2 min-w-[64px] transition-colors ${
              activeTab === id
                ? 'text-primary-600'
                : 'text-gray-400'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-none">{label}</span>
            {activeTab === id && (
              <div className="w-1 h-1 rounded-full bg-primary-600 mt-0.5" />
            )}
          </button>
        ))}
      </div>
    </nav>
  )
}
