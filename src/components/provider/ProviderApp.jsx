import { useState, useEffect, useCallback } from 'react'
import { Clock, LogOut, RefreshCw } from 'lucide-react'
import { supabaseProvider, isConfigured } from '../../lib/supabase.js'
import PippyLogo from '../PippyLogo.jsx'
import ProviderAuth from './ProviderAuth.jsx'
import ProviderOnboarding from './ProviderOnboarding.jsx'

// The provider shell. Mounted only at /business (see src/main.jsx), lazily, so
// a pet parent never downloads it.
//
// Its session comes from supabaseProvider, which is the same project and the
// same anon key under a different storageKey. A boarder signed into the pet app
// still signs in here, and signing out here leaves the pet app alone. That
// separation is in the UI and the session only — both carry the same
// auth.uid(), and no RLS policy can tell them apart.
//
// Boot has four outcomes, which is why the role source matters: `profiles` has
// RLS enabled with zero policies and can never be read from the client, so it
// is no use for this. provider_accounts carries its own "my own row" SELECT
// policy and answers the question directly.

function Shell({ children }) {
  return (
    <div className="min-h-screen px-4 py-10" style={{ backgroundColor: '#FFFEF8' }}>
      <div className="w-full max-w-lg mx-auto">{children}</div>
    </div>
  )
}

function Booting() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FFFEF8' }}>
      <PippyLogo size="xl" className="animate-pulse" />
    </div>
  )
}

export default function ProviderApp() {
  const [session, setSession]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [accounts, setAccounts] = useState(null)
  const [error, setError]       = useState(null)

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    supabaseProvider.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabaseProvider.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) setAccounts(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadAccounts = useCallback(async () => {
    if (!session) return
    setError(null)
    try {
      const { data, error } = await supabaseProvider.rpc('my_provider_accounts')
      if (error) throw error
      setAccounts(data || [])
    } catch (e) {
      setError(e.message || 'Could not load your account.')
      setAccounts([])
    }
  }, [session])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  async function signOut() {
    await supabaseProvider.auth.signOut()
  }

  if (!isConfigured) {
    return (
      <Shell>
        <div className="card">
          <p className="text-sm" style={{ color: '#4A2C0A' }}>
            Supabase is not configured, so the provider view has nothing to sign in to.
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
          </p>
        </div>
      </Shell>
    )
  }

  if (loading) return <Booting />
  if (!session) return <ProviderAuth />
  if (accounts === null) return <Booting />

  const email = session.user.email || session.user.phone || ''
  const active  = accounts.find(a => a.status === 'active')
  const pending = accounts.find(a => a.status === 'pending')

  if (error) {
    return (
      <Shell>
        <div className="card">
          <p className="text-sm mb-4" style={{ color: '#b4453c' }}>{error}</p>
          <button className="btn-secondary" onClick={loadAccounts}>
            <RefreshCw size={14} className="mr-2" /> Try again
          </button>
        </div>
      </Shell>
    )
  }

  if (!active && !pending) {
    return <ProviderOnboarding email={email} onClaimed={loadAccounts} />
  }

  if (!active && pending) {
    return (
      <Shell>
        <div className="flex items-center gap-3 mb-8">
          <PippyLogo size="md" />
          <span className="text-2xl font-black" style={{ color: '#7a4900', fontFamily: 'Nunito, sans-serif' }}>
            pip<span style={{ color: '#f2b83d' }}>py</span>
          </span>
        </div>
        <div className="card">
          <div className="flex items-start gap-3">
            <Clock size={20} className="mt-0.5 shrink-0" style={{ color: '#b08d57' }} />
            <div>
              <h1 className="text-lg font-black mb-1" style={{ color: '#7a4900' }}>Waiting on approval</h1>
              <p className="text-sm" style={{ color: '#4A2C0A' }}>
                You&apos;ve claimed <strong>{pending.provider_name}</strong>. We check each claim by
                hand so nobody can take over a business that isn&apos;t theirs — usually the same day.
                You&apos;ll be able to sign straight in once it&apos;s approved.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button className="btn-secondary" onClick={loadAccounts}>
              <RefreshCw size={14} className="mr-2" /> Check again
            </button>
            <button className="btn-secondary" onClick={signOut}>
              <LogOut size={14} className="mr-2" /> Sign out
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // Approved. The dashboard, the customer book and everything else lands here
  // in the phases that follow; this proves the whole sign-in path end to end.
  return (
    <Shell>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <PippyLogo size="md" />
          <span className="text-2xl font-black" style={{ color: '#7a4900', fontFamily: 'Nunito, sans-serif' }}>
            pip<span style={{ color: '#f2b83d' }}>py</span>
          </span>
        </div>
        <button className="btn-secondary" onClick={signOut}>
          <LogOut size={14} className="mr-2" /> Sign out
        </button>
      </div>

      <div className="card">
        <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#b08d57' }}>Signed in as</p>
        <h1 className="text-xl font-black mb-1" style={{ color: '#7a4900' }}>{active.provider_name}</h1>
        <p className="text-sm" style={{ color: '#b08d57' }}>
          {[active.claimed_type || active.provider_type, active.provider_area, active.provider_city]
            .filter(Boolean).join(' · ')}
        </p>
        <hr className="my-5" style={{ borderColor: '#f0e6c8' }} />
        <p className="text-sm" style={{ color: '#4A2C0A' }}>
          Your customers, their pets and your daily updates land here next.
        </p>
      </div>
    </Shell>
  )
}
