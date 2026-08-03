import { useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import PetList from './components/PetList.jsx'
import PetDetail from './components/PetDetail.jsx'
import AddPetModal from './components/AddPetModal.jsx'
import MobileHeader from './components/MobileHeader.jsx'
import MobileBottomNav from './components/MobileBottomNav.jsx'

export default function App() {
  const [selectedPet, setSelectedPet]   = useState(null)
  const [activeTab, setActiveTab]       = useState('timeline')
  const [showAddPet, setShowAddPet]     = useState(false)
  const [refresh, setRefresh]           = useState(0)
  const [sidebarOpen, setSidebarOpen]   = useState(false)

  function onPetSaved() {
    setRefresh(r => r + 1)
    setShowAddPet(false)
  }

  function selectPet(pet) {
    setSelectedPet(pet)
    setActiveTab('timeline')
    setSidebarOpen(false)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">

      {/* ── Sidebar (desktop always visible, mobile drawer) ──────────── */}
      <Sidebar
        selectedPet={selectedPet}
        onSelectPet={selectPet}
        onAddPet={() => { setShowAddPet(true); setSidebarOpen(false) }}
        activeTab={activeTab}
        onTabChange={(tab) => { setActiveTab(tab); setSidebarOpen(false) }}
        refresh={refresh}
        onRefresh={() => setRefresh(r => r + 1)}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* ── Mobile overlay backdrop ──────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top header */}
        <MobileHeader
          selectedPet={selectedPet}
          onBack={() => setSelectedPet(null)}
          onMenuOpen={() => setSidebarOpen(true)}
          onAddPet={() => setShowAddPet(true)}
        />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {selectedPet ? (
            <PetDetail
              pet={selectedPet}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onPetUpdated={(updated) => { setSelectedPet(updated); setRefresh(r => r + 1) }}
              onPetDeleted={() => { setSelectedPet(null); setRefresh(r => r + 1) }}
            />
          ) : (
            <PetList
              refresh={refresh}
              onSelectPet={selectPet}
              onAddPet={() => setShowAddPet(true)}
            />
          )}
        </main>

        {/* Mobile bottom nav tabs (only when pet selected) */}
        {selectedPet && (
          <MobileBottomNav activeTab={activeTab} onTabChange={setActiveTab} />
        )}
      </div>

      {showAddPet && (
        <AddPetModal
          onClose={() => setShowAddPet(false)}
          onSaved={onPetSaved}
        />
      )}
    </div>
  )
}
