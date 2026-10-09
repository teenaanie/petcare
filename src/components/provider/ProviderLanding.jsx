import { useState, useEffect } from 'react'
import {
  NotebookPen, CalendarCheck, ClipboardList, Inbox, Camera, Megaphone,
  MapPin, ShieldCheck, Search, Loader2, Check,
} from 'lucide-react'
import PippyLogo from '../PippyLogo.jsx'
import { getSupabaseProvider } from '../../lib/supabase.js'
import { reportHandled } from '../../lib/errorReport.js'
import { rememberClaimPick } from '../../lib/claimPick.js'

// The signed-out page at /business.
//
// It wraps the sign-in form rather than owning it: ProviderAuth still holds
// every piece of auth logic and passes its entry form in as `children`, exactly
// as PhoneAuth does with Landing on the pet-parent side. Nothing about signing
// in changed when this was added.
//
// Why it exists: a boarder handed "pippypets.com/business" used to land on a
// bare email box. Nothing on screen said what they were signing in to, who it
// was for, or what they would get — only that someone wanted their address.
//
// EVERY CLAIM BELOW IS A FEATURE THAT EXISTS AND IS DEPLOYED. The temptation on
// a page like this is to describe the roadmap in the present tense. If a line
// here stops being true, it comes off the page rather than waiting for the
// feature to catch up.

const FEATURES = [
  { icon: NotebookPen, tint: '#fff3c0', ink: '#7a4900', title: 'Your own book',
    body: 'Customers, their animals and their stays, typed the way you would write them in a ledger. It works whether or not a single customer uses the app.' },
  { icon: CalendarCheck, tint: '#bfe5ef', ink: '#22424b', title: 'Who is in, who is coming',
    body: 'The first screen is the numbers — with you now, coming up, and what needs attention before an animal arrives. Tap one to see the list behind it.' },
  { icon: ClipboardList, tint: '#eef3e2', ink: '#4a5f2e', title: 'Trial, criteria, and the day log',
    body: 'Mark a trial day done and your boarding criteria met. Then write the stay up day by day — ate well, slept through — with the date on each line.' },
  { icon: Inbox, tint: '#ffe6e6', ink: '#99414d', title: 'What the owner already told you',
    body: 'A customer sends their pet’s details from the Pippy app: food, medication, what they react to, and how to reach them. It arrives before the pet does.' },
  { icon: Camera, tint: '#fff3c0', ink: '#7a4900', title: 'Send a line back',
    body: 'Post an update during a stay, with a photo if you have one. The owner is notified and sees it on their pet’s screen. It is the message they actually want.' },
  { icon: Megaphone, tint: '#ffe0e0', ink: '#9c3b3b', title: 'Message your customers',
    body: 'Shut for Diwali, or a change of hours — one message to everyone who has written to you. You never hold their addresses, and neither does your browser.' },
]

const STEPS = [
  { n: '1', title: 'Sign in with your business email',
    body: 'A code by email, no password to remember or lose.' },
  { n: '2', title: 'Find your business and claim it',
    body: 'Most are already listed. If yours is not, add it in the same step.' },
  { n: '3', title: 'We check it by hand',
    body: 'A person reads every claim, so nobody can take over a business that is not theirs. Usually the same day.' },
]

// A small, honest rendering of the real dashboard: the same six labels in the
// same order the signed-in screen uses. Markup rather than a screenshot, so it
// stays sharp, weighs nothing, and cannot go stale into a lie about a layout
// that has since changed — if the dashboard moves, this is one file away.
function DashboardPeek() {
  const Tile = ({ label, value, tint, ink, big }) => (
    <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: tint, border: '1px solid #ebe3d3' }}>
      <p className="m-0 text-[10px] font-black uppercase tracking-wide" style={{ color: '#b08d57' }}>{label}</p>
      <p className="m-0 font-black leading-none mt-1" style={{ color: ink, fontSize: big ? 38 : 24 }}>{value}</p>
    </div>
  )
  return (
    <div className="w-full max-w-[22rem] rounded-3xl p-4 sm:p-5"
      style={{ backgroundColor: '#fffef8', border: '1px solid #ebe3d3',
               boxShadow: '0 18px 40px rgba(122, 73, 0, 0.13)' }}>
      <div className="flex items-center gap-2 mb-3">
        <PippyLogo size="sm" />
        <span className="text-xs font-black" style={{ color: '#b08d57' }}>Banyan Tree Pet Boarding</span>
      </div>
      <div className="space-y-2">
        <Tile label="Needs attention" value="2" tint="#ffeaea" ink="#9c3b3b" />
        <div className="grid grid-cols-2 gap-2">
          <Tile label="With you now" value="5" tint="#fff9e0" ink="#7a4900" big />
          <div className="space-y-2">
            <Tile label="Coming up" value="8" tint="#ffffff" ink="#7a4900" />
            <Tile label="Customers" value="25" tint="#ffffff" ink="#7a4900" />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * "Is my business already listed?", answered without an account.
 *
 * Before this, the only way to find out was to sign in at /business and search
 * — so a business owner had to create an account to learn whether they already
 * had a listing, which is the wrong way round and is how the same kennel ends
 * up in the directory twice.
 *
 * Signed out on purpose, and it needs nothing: search_providers() is granted to
 * `anon` because it is how a pet parent browses the directory. It is called
 * here with approved_only — the published directory, which is what "are we
 * listed?" actually means.
 */
function FindYourListing() {
  const [term, setTerm]       = useState('')
  const [rows, setRows]       = useState(null)
  const [busy, setBusy]       = useState(false)
  const [picked, setPicked]   = useState(null)

  useEffect(() => {
    const q = term.trim()
    if (q.length < 3) { setRows(null); return }
    let cancelled = false
    setBusy(true)
    setPicked(null)
    const t = setTimeout(async () => {
      try {
        const supabase = await getSupabaseProvider()
        const { data, error } = await supabase.rpc('search_providers', {
          approved_only: true, filter_type: null, filter_area: null,
          search_term: q, page_limit: 6, page_offset: 0,
        })
        if (cancelled) return
        if (error) throw error
        setRows((data || []).map(r => r.provider))
      } catch (e) {
        if (cancelled) return
        reportHandled(e, { view: 'provider-landing' })
        setRows([])
      } finally {
        if (!cancelled) setBusy(false)
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [term])

  return (
    <div className="rounded-3xl p-5 sm:p-6" style={{ backgroundColor: '#fffef8', border: '1px solid #ebe3d3' }}>
      <label className="block text-sm font-extrabold mb-2" htmlFor="find-listing"
        style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
        Look yourself up
      </label>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#b08d57' }} />
        <input id="find-listing" value={term} onChange={e => setTerm(e.target.value)}
          className="w-full rounded-2xl pl-9 pr-3 py-3 text-sm"
          style={{ backgroundColor: '#ffffff', border: '1px solid #ebe3d3', color: '#4A2C0A' }}
          placeholder="Your business name" autoComplete="organization" />
      </div>

      {busy && (
        <p className="text-xs mt-3 flex items-center gap-1.5" style={{ color: '#73775b' }}>
          <Loader2 className="w-3 h-3 animate-spin" /> Looking…
        </p>
      )}

      {rows && rows.length > 0 && (
        <>
          {/* Tappable, because a row that looks like a result and does nothing
              when you press it reads as a broken page. Choosing one carries
              through the sign-in: the claim screen on the other side opens on
              this business instead of asking them to search for it again. */}
          <div className="mt-3 space-y-2">
            {rows.map(p => {
              const on = picked?.id === p.id
              return (
                <button key={p.id} type="button"
                  onClick={() => {
                    setPicked(p)
                    // Carried to the claim screen on the other side of the
                    // sign-in. It grants nothing — see src/lib/claimPick.js.
                    rememberClaimPick(p)
                  }}
                  className="w-full text-left rounded-2xl px-4 py-3 flex items-start gap-2"
                  style={on ? { backgroundColor: '#eef3e2', border: '1.5px solid #5f7a3a' }
                            : { backgroundColor: '#fff9e0', border: '1px solid #ebe3d3' }}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold" style={{ color: '#7a4900' }}>{p.name}</span>
                    <span className="block text-xs" style={{ color: '#73775b' }}>
                      {[p.type, p.area, p.city].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {on
                    ? <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#5f7a3a' }} />
                    : <span className="text-[11px] font-bold shrink-0 mt-0.5" style={{ color: '#b08d57' }}>
                        This is us
                      </span>}
                </button>
              )
            })}
          </div>

          {picked ? (
            <a href="#signin"
              className="mt-3 w-full text-center font-black rounded-2xl px-5 py-3 text-sm block"
              style={{ backgroundColor: '#ffde59', color: '#7a4900' }}>
              {/* A long name cut mid-word reads worse than not naming it. Most
                  are short; the ones that are not are "X - The Something,
                  Something & Something", where the tail adds nothing. */}
              {picked.name.length > 24 ? 'Sign in to claim it' : `Sign in to claim ${picked.name}`}
            </a>
          ) : (
            <p className="text-xs mt-3" style={{ color: '#73775b' }}>
              Tap the one that is yours.
            </p>
          )}
        </>
      )}

      {rows && rows.length === 0 && !busy && (
        <p className="text-sm mt-3" style={{ color: '#73775b' }}>
          Nothing by that name. You can add your business after you{' '}
          <a href="#signin" className="underline font-bold" style={{ color: '#7a4900' }}>sign in</a> —
          same form, one step.
        </p>
      )}
    </div>
  )
}

export default function ProviderLanding({ children }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#fffef8' }}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">

        <header className="flex items-center justify-between h-16 sm:h-20">
          <div className="flex items-center gap-2.5">
            <PippyLogo size="md" />
            <span className="font-black text-xl sm:text-2xl tracking-tight"
              style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
              Pippy
            </span>
            <span className="hidden sm:inline text-sm font-bold" style={{ color: '#b08d57' }}>
              for business
            </span>
          </div>
          <a href="#signin" className="text-sm font-black rounded-full px-5 py-2.5"
            style={{ color: '#7a4900', border: '2px solid #e0d3b4' }}>
            Sign in
          </a>
        </header>

        {/* ── Hero ─────────────────────────────────────────────────────────
            The sign-in box is in the FIRST column so it stays above the fold on
            a phone. A boarder arriving here has usually been sent the link by
            us and wants the way in, not the pitch; the pitch is for the one who
            scrolls. */}
        <section className="flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-12 pt-4 pb-10 sm:pb-14">
          <div className="lg:w-[54%] flex flex-col gap-5">
            <span className="self-start text-[11px] sm:text-xs font-black uppercase tracking-[0.09em] px-3.5 py-2 rounded-full"
              style={{ backgroundColor: '#bfe5ef', color: '#22424b' }}>
              For boarders &amp; groomers
            </span>

            <h1 className="m-0 font-extrabold leading-[1.05] tracking-tight text-[34px] sm:text-5xl lg:text-[54px]"
              style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
              The book by the phone, on your phone.
            </h1>

            <p className="m-0 text-base sm:text-lg leading-relaxed max-w-[34rem]" style={{ color: '#73775b' }}>
              Keep your customers, their animals and every stay in one place — and
              get what the owner already knows about their pet before it arrives.
            </p>

            <div id="signin" className="mt-1 rounded-3xl p-5 sm:p-6 w-full max-w-[29rem]"
              style={{ backgroundColor: '#ffffff', border: '1px solid #ebe3d3',
                       boxShadow: '0 14px 34px rgba(122, 73, 0, 0.09)' }}>
              {children}
            </div>
          </div>

          {/* The lookup sits HERE, in the first screen, because the question it
              answers — "am I already on this thing?" — is the one a business
              owner arrives with, and it was four sections down where nobody
              scrolled to it. The product shot moves below it: a picture can
              wait, an answer cannot. */}
          <div className="lg:flex-1 flex flex-col items-center gap-5 w-full">
            <div className="w-full max-w-[24rem]"><FindYourListing /></div>
            <div className="hidden lg:block"><DashboardPeek /></div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────── */}
        <section className="pt-6 sm:pt-10 pb-10">
          <h2 className="m-0 mb-2 font-extrabold text-[28px] sm:text-4xl tracking-tight"
            style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
            What you get
          </h2>
          <p className="m-0 mb-7 text-base sm:text-[17px]" style={{ color: '#73775b' }}>
            Two halves: the book you keep yourself, and what your customers send you.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {FEATURES.map(({ icon: Icon, tint, ink, title, body }) => (
              <div key={title} className="rounded-3xl p-5 sm:p-6"
                style={{ backgroundColor: '#ffffff', border: '1px solid #ebe3d3' }}>
                <span className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4"
                  style={{ backgroundColor: tint, color: ink }}>
                  <Icon className="w-[22px] h-[22px]" />
                </span>
                <h3 className="m-0 mb-1.5 font-bold text-lg sm:text-xl"
                  style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
                  {title}
                </h3>
                <p className="m-0 text-sm sm:text-[15px] leading-relaxed" style={{ color: '#73775b' }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── The listing ──────────────────────────────────────────────── */}
        <section className="rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center gap-7"
          style={{ backgroundColor: '#bfe5ef' }}>
          <div className="flex-grow">
            <h2 className="m-0 mb-2.5 font-extrabold text-2xl sm:text-3xl tracking-tight"
              style={{ color: '#22424b', fontFamily: 'var(--font-display)' }}>
              You are probably already listed
            </h2>
            <p className="m-0 mb-4 text-[15px] sm:text-base leading-relaxed max-w-[30rem]" style={{ color: '#22424b' }}>
              Pippy keeps a directory of boarders, groomers and vets that pet parents
              search when they need somebody. Claiming your listing is how you take
              charge of what it says — and how your customers find you to send their
              pet&apos;s details across.
            </p>
            <div className="flex flex-wrap gap-2">
              {['Boarders', 'Groomers', 'Vets', 'Trainers', 'Pet shops'].map(tag => (
                <span key={tag} className="text-xs font-extrabold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: '#fffef8', color: '#22424b' }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="flex-shrink-0 flex items-center gap-3 rounded-2xl px-5 py-4"
            style={{ backgroundColor: '#fffef8' }}>
            <MapPin className="w-5 h-5 shrink-0" style={{ color: '#22424b' }} />
            <span className="text-sm font-extrabold" style={{ color: '#22424b' }}>
              Listings in Pune
            </span>
          </div>
        </section>

        {/* ── How it starts ────────────────────────────────────────────── */}
        <section className="pt-12 sm:pt-16 pb-4">
          <h2 className="m-0 mb-7 font-extrabold text-[28px] sm:text-4xl tracking-tight"
            style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
            How it starts
          </h2>
          <div className="grid sm:grid-cols-3 gap-4 sm:gap-5">
            {STEPS.map(({ n, title, body }) => (
              <div key={n} className="rounded-3xl p-5 sm:p-6"
                style={{ backgroundColor: '#fff9e0', border: '1px solid #ebe3d3' }}>
                <span className="w-9 h-9 rounded-full flex items-center justify-center mb-4 font-black"
                  style={{ backgroundColor: '#ffde59', color: '#7a4900' }}>
                  {n}
                </span>
                <h3 className="m-0 mb-1.5 font-bold text-lg"
                  style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
                  {title}
                </h3>
                <p className="m-0 text-sm sm:text-[15px] leading-relaxed" style={{ color: '#73775b' }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── What you cannot see ──────────────────────────────────────────
            Said plainly because a boarder WILL ask why there is no pet list,
            and because it is the half of the deal that earns a pet parent's
            trust. Better they read it here than discover it and think it is
            broken. */}
        <section className="pt-10 pb-2 flex items-start gap-4">
          <span className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: '#eef3e2', color: '#4a5f2e' }}>
            <ShieldCheck className="w-[22px] h-[22px]" />
          </span>
          <div>
            <h2 className="m-0 mb-1.5 font-extrabold text-xl sm:text-2xl tracking-tight"
              style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
              You see what you are sent, and nothing else
            </h2>
            <p className="m-0 text-sm sm:text-[15px] leading-relaxed max-w-[42rem]" style={{ color: '#73775b' }}>
              There is no list of pets to browse and no customer directory to search.
              A pet parent chooses you, chooses the pet, and sends that note — that is
              the whole of what reaches you. Your own book is yours alone: no customer
              can read what you write in it.
            </p>
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <footer className="py-10 sm:py-12 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="flex items-center gap-4">
            <PippyLogo size="hero" className="w-[60px] h-[60px] sm:w-[72px] sm:h-[72px]" />
            <div>
              <h2 className="m-0 mb-1 font-extrabold text-xl sm:text-2xl tracking-tight"
                style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
                Claim your business. It takes a minute.
              </h2>
              <p className="m-0 text-sm sm:text-[15px]" style={{ color: '#73775b' }}>
                Your business email is all you need to start.
              </p>
            </div>
          </div>
          <a href="#signin"
            className="flex-shrink-0 text-center font-black rounded-2xl px-8 py-4 text-base"
            style={{ backgroundColor: '#ffde59', color: '#7a4900' }}>
            Get started
          </a>
        </footer>

        <p className="text-center text-xs pb-8" style={{ color: '#73775b' }}>
          This is the provider sign-in. Looking after your own pet?{' '}
          <a href="/" className="underline" style={{ color: '#b08d57' }}>Go to the Pippy app</a>.
        </p>
      </div>
    </div>
  )
}
