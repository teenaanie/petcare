import { useState, useEffect } from 'react'
import { drainSharedFiles, wasShared, clearSharedFlag } from './lib/shareTarget.js'
import { PawPrint } from 'lucide-react'
import { supabase, isConfigured } from './lib/supabase.js'
import PhoneAuth from './components/PhoneAuth.jsx'
import Sidebar from './components/Sidebar.jsx'
import PetList from './components/PetList.jsx'
import PetDetail from './components/PetDetail.jsx'
import AddPetModal from './components/AddPetModal.jsx'
import MobileHeader from './components/MobileHeader.jsx'
import MobileAppNav from './components/MobileAppNav.jsx'
import AdminDashboard from './components/AdminDashboard.jsx'
import FeedbackButton from './components/FeedbackButton.jsx'
import ProviderDirectory from './components/ProviderDirectory.jsx'
import MyProviders from './components/MyProviders.jsx'
import InstallPrompt from './components/InstallPrompt.jsx'
import PippyLogo from './components/PippyLogo.jsx'
import PetPickerModal from './components/PetPickerModal.jsx'
import SharedImport from './components/SharedImport.jsx'

const ADMIN_EMAIL = 'teena.anie9@gmail.com'

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FFFEF8' }}>
      <div className="flex flex-col items-center gap-4">
        <PippyLogo size="xl" className="animate-pulse" />
        <span className="text-2xl font-black" style={{ color: '#7a4900', fontFamily: 'Nunito, sans-serif' }}>
          pip<span style={{ color: '#f2b83d' }}>py</span>
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
  const [activeTab, setActiveTab]       = useState('timeline')
  const [showAddPet, setShowAddPet]     = useState(false)
  const [refresh, setRefresh]           = useState(0)
  const [sidebarOpen, setSidebarOpen]   = useState(false)
  const [adminView, setAdminView]       = useState(false)
  const [servicesView, setServicesView] = useState(false)
  const [myProvidersView, setMyProvidersView] = useState(false)
  // Files shared in from another app. Drained on boot regardless of auth state:
  // the login screen renders instead of the main UI but App stays mounted, so
  // holding them here carries them across the sign-in round trip. Losing files
  // somebody deliberately shared is the worst outcome available.
  const [sharedFiles, setSharedFiles] = useState(null)
  useEffect(() => {
    if (!wasShared()) return
    clearSharedFlag()          // so a reload is not mistaken for a new share
    drainSharedFiles().then(fs => { if (fs.length) setSharedFiles(fs) })
  }, [])
  // "Prep for a stay here" in the directory: which boarder to preselect, and
  // which pet it's for. The directory clears the selected pet on entry, so the
  // pet has to be chosen again on the way back out.
  const [boardingPrefill, setBoardingPrefill] = useState(null)
  const [prepProvider, setPrepProvider]       = useState(null)

  function onPetSaved() {
    setRefresh(r => r + 1)
    setShowAddPet(false)
  }

  function startBoardingPrep(provider) {
    setPrepProvider(provider)
  }

  function openBoardingFor(pet, providerId) {
    setPrepProvider(null)
    setBoardingPrefill(providerId)
    setSelectedPet(pet)
    setServicesView(false)
    setAdminView(false)
    setActiveTab('boarding')
  }

  function selectPet(pet) {
    setSelectedPet(pet)
    if (pet) {
      setActiveTab('timeline')
      setAdminView(false)
      setServicesView(false)
    }
    setSidebarOpen(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Still loading auth state
  if (authLoading) return <LoadingScreen />

  // Not logged in (and Supabase is configured) — show login
  if (isConfigured && !session) return <PhoneAuth />

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">

      {/* Files shared in from another app, waiting to be filed against a pet.
          Rendered above everything: the user came here from a share sheet and
          this is the only thing they are trying to do. */}
      {sharedFiles && (
        <SharedImport files={sharedFiles} session={session}
          onClose={() => setSharedFiles(null)} />
      )}

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
        adminView={adminView}
        onToggleAdmin={() => { setAdminView(v => !v); setServicesView(false); setSelectedPet(null); setSidebarOpen(false) }}
        servicesView={servicesView}
        myProvidersView={myProvidersView}
        onToggleMyProviders={() => { setMyProvidersView(v => !v); setServicesView(false); setAdminView(false) }}
        onToggleServices={() => { setMyProvidersView(false); setServicesView(v => !v); setAdminView(false); setSelectedPet(null); setSidebarOpen(false) }}
      />

      {prepProvider && (
        <PetPickerModal
          provider={prepProvider}
          onClose={() => setPrepProvider(null)}
          onPick={pet => openBoardingFor(pet, prepProvider.id)} />
      )}

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
          {adminView ? (
            <AdminDashboard />
          ) : myProvidersView ? (
            <MyProviders />
          ) : servicesView ? (
            <ProviderDirectory onPrepForStay={startBoardingPrep} />
          ) : selectedPet ? (
            <PetDetail
              pet={selectedPet}
              activeTab={activeTab}
              prefillProviderId={boardingPrefill}
              onPrefillUsed={() => setBoardingPrefill(null)}
              onTabChange={setActiveTab}
              onPetUpdated={(updated) => { setSelectedPet(updated); setRefresh(r => r + 1) }}
              onPetDeleted={() => { setSelectedPet(null); setRefresh(r => r + 1) }}
            />
          ) : (
            <PetList
              refresh={refresh}
              onSelectPet={selectPet}
              onAddPet={() => setShowAddPet(true)}
              onFindServices={() => { setAdminView(false); setServicesView(true); setSelectedPet(null) }}
            />
          )}
        </main>

        <MobileAppNav
          view={adminView ? 'admin' : servicesView ? 'services' : 'pets'}
          isAdmin={isAdmin}
          onNavigate={(id) => {
            setSidebarOpen(false)
            if (id === 'pets')     { setAdminView(false); setServicesView(false); setMyProvidersView(false); setSelectedPet(null) }
            if (id === 'services') { setAdminView(false); setServicesView(true);  setSelectedPet(null) }
            if (id === 'admin')    { setServicesView(false); setAdminView(true);  setSelectedPet(null) }
          }}
        />
      </div>

      {showAddPet && (
        <AddPetModal
          onClose={() => setShowAddPet(false)}
          onSaved={onPetSaved}
        />
      )}

      <FeedbackButton user={session?.user} />
      <InstallPrompt />
    </div>
  )
}
