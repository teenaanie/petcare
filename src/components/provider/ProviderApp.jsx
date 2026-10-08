import { useState, useEffect, useCallback } from 'react'
import { Ban, Clock, LogOut, RefreshCw } from 'lucide-react'
import { getSupabaseProvider, isConfigured } from '../../lib/supabase.js'
import { reportHandled } from '../../lib/errorReport.js'
import PippyLogo from '../PippyLogo.jsx'
import ProviderAuth from './ProviderAuth.jsx'
import ProviderOnboarding from './ProviderOnboarding.jsx'
import ProviderFeedback from './ProviderFeedback.jsx'
import ProviderInbox from './ProviderInbox.jsx'
import ProviderBook from './ProviderBook.jsx'
import ProviderDetails from './ProviderDetails.jsx'

// The provider shell. Mounted only at /business (see src/main.jsx), lazily, so
// a pet parent never downloads it.
//
// Its session comes from getSupabaseProvider(), which is the same project and the
// same anon key under a different storageKey. A boarder signed into the pet app
// still signs in here, and signing out here leaves the pet app alone. That
// separation is in the UI and the session only — both carry the same
// auth.uid(), and no RLS policy can tell them apart.
//
// Boot has five outcomes, which is why the role source matters: `profiles` has
// RLS enabled with zero policies and can never be read from the client, so it
// is no use for this. provider_accounts carries its own "my own row" SELECT
// policy and answers the question directly.

function Shell({ children }) {
  return (
    <div className="min-h-screen px-4 py-10" style={{ backgroundColor: '#FFFEF8' }}>
      {/* A phone-width column on a laptop left two thirds of the screen empty
          — the dashboard read as a mobile screenshot with wallpaper around it.
          The column stays narrow where a narrow column is right (a phone, and
          the sign-in and claim screens, which are their own layouts) and opens
          up from `lg`, where the tiles lay out four across. */}
      <div className="w-full max-w-lg lg:max-w-4xl mx-auto">{children}</div>
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

// Every signed-in screen carries the wordmark, and every screen a provider can
// get STUCK on carries a way out. Sign-out is a prop rather than always-on
// because the claim screen deliberately has no header at all.
function Header({ onSignOut }) {
  return (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-3">
        <PippyLogo size="md" />
        <span className="text-2xl font-black" style={{ color: '#7a4900', fontFamily: 'Nunito, sans-serif' }}>
          pip<span style={{ color: '#f2b83d' }}>py</span>
        </span>
      </div>
      {onSignOut && (
        <button className="btn-secondary" onClick={onSignOut}>
          <LogOut size={14} className="mr-2" /> Sign out
        </button>
      )}
    </div>
  )
}

export default function ProviderApp() {
  const [session, setSession]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [accounts, setAccounts] = useState(null)
  const [half, setHalf] = useState('book')
  const [error, setError]       = useState(null)

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    // The client is built on first use now, so boot is async. `cancelled`
    // matters: the shell can unmount while the chunk is still downloading, and
    // a subscription created after that would never otherwise be torn down.
    let cancelled = false
    let subscription = null
    getSupabaseProvider().then(client => {
      if (cancelled || !client) return
      client.auth.getSession().then(({ data }) => {
        if (cancelled) return
        setSession(data.session)
        setLoading(false)
      })
      subscription = client.auth.onAuthStateChange((_e, s) => {
        setSession(s)
        if (!s) setAccounts(null)
      }).data.subscription
      if (cancelled) subscription.unsubscribe()
    }).catch(e => {
      if (cancelled) return
      setError(e.message || 'Could not load the sign-in.')
      setLoading(false)
    })
    return () => { cancelled = true; subscription?.unsubscribe() }
  }, [])

  const loadAccounts = useCallback(async () => {
    if (!session) return
    setError(null)
    try {
      const supabase = await getSupabaseProvider()

      // Bind any claim that was waiting on this address to the account that
      // actually signed in. A claim written by the registration form carries an
      // email and no user_id, and both my_provider_accounts() and
      // is_provider_member() fall back to matching on it — so the shell works
      // without this, right up until the day they change their sign-in address
      // and silently lose their own business.
      //
      // Runs before the read so the first sign-in already sees a bound row, and
      // is a no-op on every sign-in after. Deliberately not allowed to fail the
      // boot: the email fallback still works, so a provider whose adoption
      // errored can still get in, which is the better of the two failures.
      try { await supabase.rpc('adopt_my_provider_accounts') }
      catch (e) { reportHandled(e, { view: 'provider-sign-in' }) }

      const { data, error } = await supabase.rpc('my_provider_accounts')
      if (error) throw error
      setAccounts(data || [])
    } catch (e) {
      setError(e.message || 'Could not load your account.')
      setAccounts([])
    }
  }, [session])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  async function signOut() {
    await (await getSupabaseProvider()).auth.signOut()
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
  // Every business this person is active on. Computed once rather than inline,
  // because an inline .map() is a new array on every render and the children
  // key their loading effects on it.
  const activeIds = accounts.filter(a => a.status === 'active').map(a => a.provider_id)
  const active    = accounts.find(a => a.status === 'active')
  const pending   = accounts.find(a => a.status === 'pending')
  const suspended = accounts.find(a => a.status === 'suspended')

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

  // Suspended used to fall through to the claim screen: no explanation, no sign
  // out, and claiming again returns the same already-suspended row — so the only
  // way out was clearing site data. Order matters here. `active` is checked
  // first so somebody suspended at one business and active at another still
  // lands on their dashboard, and `suspended` is checked before the claim screen
  // so it can no longer be the fallthrough.
  if (!active && !pending && suspended) {
    return (
      <Shell>
        <Header onSignOut={signOut} />
        <div className="card">
          <div className="flex items-start gap-3">
            <Ban size={20} className="mt-0.5 shrink-0" style={{ color: '#b4453c' }} />
            <div>
              <h1 className="text-lg font-black mb-1" style={{ color: '#7a4900' }}>Access paused</h1>
              <p className="text-sm" style={{ color: '#4A2C0A' }}>
                Your account for <strong>{suspended.provider_name}</strong> has been paused, so you
                can&apos;t sign in to it at the moment. A person decides this, and a person can undo
                it — nothing about your business listing has changed.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button className="btn-secondary" onClick={loadAccounts}>
              <RefreshCw size={14} className="mr-2" /> Check again
            </button>
          </div>
        </div>
        <ProviderFeedback
          userId={session.user.id}
          providerId={suspended.provider_id}
          context="Access paused"
          open
          prompt="Think this is a mistake? Tell us what happened and we'll look again." />
      </Shell>
    )
  }

  if (!active && !pending) {
    return <ProviderOnboarding email={email} onClaimed={loadAccounts} />
  }

  if (!active && pending) {
    return (
      <Shell>
        <Header onSignOut={signOut} />
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
          </div>
        </div>
        <ProviderFeedback
          userId={session.user.id}
          providerId={pending.provider_id}
          context="Awaiting approval" />
      </Shell>
    )
  }

  // Approved. The dashboard, the customer book and everything else lands here
  // in the phases that follow; this proves the whole sign-in path end to end.
  return (
    <Shell>
      <Header onSignOut={signOut} />

      <div className="card">
        <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#b08d57' }}>Signed in as</p>
        <h1 className="text-xl font-black mb-1" style={{ color: '#7a4900' }}>{active.provider_name}</h1>
        <p className="text-sm" style={{ color: '#b08d57' }}>
          {[active.claimed_type || active.provider_type, active.provider_area, active.provider_city]
            .filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* Every business this person is active on, not just the one named above:
          someone running a kennel and a grooming salon has one sign-in and
          should see both books. RLS scopes it either way. */}
      {/* Two halves, and they are independent on purpose. `Shared with you` is
          what customers push; `My book` is the provider's own records and works
          with nobody using the app at all. The book comes first because most
          businesses will live there and only some of their customers will ever
          send a note. */}
      <div className="flex gap-1.5 mt-6">
        {[['book', 'My book'], ['shared', 'Shared with you']].map(([k, l]) => (
          <button key={k} onClick={() => setHalf(k)}
            className="px-3.5 py-2 rounded-xl text-sm font-bold transition-all"
            style={half === k ? { backgroundColor: '#f2b83d', color: '#7a4900' }
                              : { backgroundColor: '#f5f0e0', color: '#73775b' }}>
            {l}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {half === 'book' ? (
          <ProviderBook
            providerIds={activeIds}
            primaryProviderId={active.provider_id}
            providerName={active.provider_name}
            providerType={active.claimed_type || active.provider_type}
            postedBy={session.user.id} />
        ) : (
          <ProviderInbox providerIds={activeIds} postedBy={session.user.id} />
        )}
      </div>



      {/* What the business can change about itself, and — for a boarder — the
          criteria a pet parent reads before they travel. Collapsed by default:
          this is a thing you do once and then rarely, so it sits below the work
          rather than above it. */}
      <div className="mt-4">
        <ProviderDetails providerId={active.provider_id}
          providerType={active.claimed_type || active.provider_type} />
      </div>

      <ProviderFeedback
        userId={session.user.id}
        providerId={active.provider_id}
        context="Signed in" />
    </Shell>
  )
}
