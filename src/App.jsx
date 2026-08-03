import { useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import PetList from './components/PetList.jsx'
import PetDetail from './components/PetDetail.jsx'
import AddPetModal from './components/AddPetModal.jsx'

export default function App() {
  const [selectedPet, setSelectedPet] = useState(null)
  const [activeTab, setActiveTab] = useState('timeline')
  const [showAddPet, setShowAddPet] = useState(false)
  const [refresh, setRefresh] = useState(0)

  function onPetSaved() {
    setRefresh(r => r + 1)
    setShowAddPet(false)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar
        selectedPet={selectedPet}
        onSelectPet={(pet) => { setSelectedPet(pet); setActiveTab('timeline') }}
        onAddPet={() => setShowAddPet(true)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        refresh={refresh}
      />

      <main className="flex-1 overflow-y-auto">
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
            onSelectPet={(pet) => { setSelectedPet(pet); setActiveTab('timeline') }}
            onAddPet={() => setShowAddPet(true)}
          />
        )}
      </main>

      {showAddPet && (
        <AddPetModal
          onClose={() => setShowAddPet(false)}
          onSaved={onPetSaved}
        />
      )}
    </div>
  )
}
