import { useState, useEffect } from 'react'
import { PawPrint } from 'lucide-react'
import { supabase, isConfigured } from './lib/supabase.js'
import PhoneAuth from './components/PhoneAuth.jsx'
import Sidebar from './components/Sidebar.jsx'
import PetList from './components/PetList.jsx'
import PetDetail from './components/PetDetail.jsx'
import AddPetModal from './components/AddPetModal.jsx'
import MobileHeader from './components/MobileHeader.jsx'
import MobileBottomNav from './components/MobileBottomNav.jsx'

const ADMIN_EMAIL = 'teena.anie9@gmail.com'

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FFFEF8' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse"
          style={{ backgroundColor: '#F9D548' }}>
          <PawPrint className="w-8 h-8" style={{ color: '#4A2C0A' }} />
        </div>
        <span className="text-2xl font-black" style={{ color: '#4A2C0A', fontFamily: 'Nunito, sans-serif' }}>
          pip<span style={{ color: '#F9D548' }}>py</span>
        </span>
      </div>
    </div>
  )
}

export default function App() {
  // ── Auth state ─────────────────────────────────────────────────────────────
  const [session, setSession]         = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [isAdmin, setIsAdmin]         = useState(false)

  useEffect(() => {
    if (!isConfigured) { setAuthLoading(false); return }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      checkAdmin(session)
      setAuthLoading(false)
    })

    // Listen for auth changes (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      checkAdmin(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function checkAdmin(session) {
    if (!session) { setIsAdmin(false); return }
    // Check by email (set email via Supabase dashboard after first login)
    if (session.user.email === ADMIN_EMAIL) { setIsAdmin(true); return }
    // Fallback: check profiles table is_admin flag
    try {
      const { data } = await supabase.from('profiles').select('is_admin').eq('id', session.user.id).single()
      setIsAdmin(data?.is_admin || false)
    } catch { setIsAdmin(false) }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    setSelectedPet(null)
  }

  // ── App state ──────────────────────────────────────────────────────────────
  const [selectedPet, setSelectedPet]   = useState(null)
  const [activeTab, setActiveTab]       = useState('scanner')
  const [showAddPet, setShowAddPet]     = useState(false)
  const [refresh, setRefresh]           = useState(0)
  const [sidebarOpen, setSidebarOpen]   = useState(false)

  function onPetSaved() {
    setRefresh(r => r + 1)
    setShowAddPet(false)
  }

  function selectPet(pet) {
    setSelectedPet(pet)
    if (pet) setActiveTab('scanner')
    setSidebarOpen(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Still loading auth state
  if (authLoading) return <LoadingScreen />

  // Not logged in (and Supabase is configured) — show login
  if (isConfigured && !session) return <PhoneAuth />

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
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
        user={session?.user}
        isAdmin={isAdmin}
        onSignOut={handleSignOut}
      />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <MobileHeader
          selectedPet={selectedPet}
          onBack={() => setSelectedPet(null)}
          onMenuOpen={() => setSidebarOpen(true)}
          onAddPet={() => setShowAddPet(true)}
        />

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
