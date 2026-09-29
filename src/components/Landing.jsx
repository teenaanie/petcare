import { useState } from 'react'
import { Bell, Mic, FileText, ShieldCheck, Camera, Users, ChevronDown } from 'lucide-react'
import PippyLogo from './PippyLogo.jsx'

// The signed-out landing page. It wraps the sign-in form rather than owning it:
// PhoneAuth still holds every piece of auth logic and passes its entry form in
// as `children`, so nothing about signing in changed when this was added.
//
// ── It fits one screen, and never scrolls ────────────────────────────────────
//
// The root is a fixed-height flex column with `overflow: hidden`, so the PAGE
// cannot scroll no matter what. That makes every child's height a budget rather
// than a suggestion, and it is why:
//
//   * the feature list is a toggle on small screens, closed by default;
//   * when it is open it gets the leftover space and scrolls INSIDE itself
//     (`min-h-0` + `overflow-y-auto`), which is what stops it pushing the
//     sign-in box off the bottom;
//   * the photo-journal band and the big closing call to action are gone.
//     There is no room for them on one screen, and the sign-in box is already
//     on screen, so a "Get started" button pointing at it was only scenery.
//
// `100dvh` is set inline over an `h-screen` class on purpose: dvh tracks mobile
// browser chrome as it hides and shows, and a browser too old for it drops the
// inline value and falls back to the class's 100vh.

// ── Photo framing ────────────────────────────────────────────────────────────
//
// These are phone photos of whole animals, and a whole animal in a 56px circle
// is mush. Each one is blown up and offset so the face lands in the middle.
// The numbers were measured off a calibration sheet, not guessed.
//
// `top` is a percentage of the FRAME'S HEIGHT, so every frame using PetPhoto
// has to be square. Put a non-square frame here and the crop slides.
const PHOTOS = {
  pino: {
    src: '/landing/pino.jpg',
    alt: 'Pino, a beagle, lying calmly on a tiled floor',
    w: 150, l: -20.5, t: -4,
  },
  glasses: {
    src: '/landing/journal-glasses.jpg',
    alt: 'A beagle wearing a pair of purple glasses',
    w: 150, l: -28, t: -40,
  },
  cat: {
    src: '/landing/journal-cat.jpg',
    alt: 'A white cat stretched out on a bed',
    w: 280, l: -153.6, t: -57,
  },
  kitten: {
    src: '/landing/kitten.jpg',
    alt: 'A small white kitten with blue eyes',
    w: 190, l: -10.8, t: -47.5,
  },
}

function PetPhoto({ photo, className = '', style, decorative = false }) {
  return (
    <span className={`block relative overflow-hidden flex-shrink-0 ${className}`} style={style}>
      <img
        src={photo.src}
        alt={decorative ? '' : photo.alt}
        aria-hidden={decorative || undefined}
        decoding="async"
        className="absolute block"
        /* maxWidth: 'none' is load-bearing. Tailwind's preflight sets
           `img { max-width: 100% }`, which silently clamped every one of these
           blow-ups back to the frame width — so the photos rendered uncropped
           and the white cat came out as a blank circle. */
        style={{ width: `${photo.w}%`, maxWidth: 'none', height: 'auto',
                 left: `${photo.l}%`, top: `${photo.t}%` }}
      />
    </span>
  )
}

const FEATURES = [
  { icon: Bell,       tint: '#fff3c0', ink: '#7a4900', title: 'Reminders',        body: 'Emailed the morning something is due.' },
  { icon: Mic,        tint: '#ffe0e0', ink: '#9c3b3b', title: 'Voice updates',    body: 'Say what happened; Pippy writes it down.' },
  { icon: FileText,   tint: '#bfe5ef', ink: '#22424b', title: 'Scan documents',   body: 'Photograph a report; it is read and filed.' },
  { icon: ShieldCheck,tint: '#eef3e2', ink: '#4a5f2e', title: 'Vaccinations',     body: 'Every shot and booster in one list.' },
  { icon: Camera,     tint: '#fff3c0', ink: '#7a4900', title: 'Photo journal',    body: 'Watch a rash or a recovery, week by week.' },
  { icon: Users,      tint: '#ffe6e6', ink: '#99414d', title: 'Share with family',body: 'A partner or sitter gets their own view.' },
]

const HOUSEHOLD = [PHOTOS.pino, PHOTOS.kitten, PHOTOS.cat, PHOTOS.glasses]

export default function Landing({ children, onShowPrivacy }) {
  const [showFeatures, setShowFeatures] = useState(false)

  return (
    <div className="h-screen overflow-hidden flex flex-col"
      style={{ height: '100dvh', backgroundColor: '#fffef8' }}>

      <header className="flex-shrink-0 flex items-center justify-between px-5 sm:px-8 h-14 sm:h-16">
        <div className="flex items-center gap-2.5">
          <PippyLogo size="md" />
          <span className="font-black text-lg sm:text-xl tracking-tight"
            style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
            Pippy
          </span>
        </div>
        <span className="text-[11px] sm:text-xs font-black uppercase tracking-[0.08em] px-3 py-1.5 rounded-full"
          style={{ backgroundColor: '#bfe5ef', color: '#22424b' }}>
          Dogs, cats, fish
        </span>
      </header>

      {/* min-h-0 lets this shrink inside the fixed-height column instead of
          overflowing it — without it the children win and the page grows. */}
      {/* Rows differ by breakpoint on purpose. Stacked, the third row is
          minmax(0,1fr) so the feature list can SHRINK and scroll inside itself;
          side by side, both rows are auto and the whole grid is centred, which
          is what stops the desktop layout hanging off the top of the screen. */}
      <main className="flex-1 min-h-0 px-5 sm:px-8 pb-4 w-full max-w-6xl mx-auto
                       grid grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)]
                       lg:grid-cols-[1.05fr_minmax(360px,0.95fr)]
                       lg:grid-rows-[auto_auto] lg:content-center
                       gap-x-10 gap-y-3 lg:gap-y-4">

        {/* ── Mascot, left ──────────────────────────────────────────────── */}
        <section className="order-1 lg:col-start-1 lg:row-start-1 min-h-0 flex flex-col
                            items-center lg:items-start justify-center gap-3 lg:pt-4">
          <HeroMascot />
          <h1 className="m-0 font-extrabold leading-[1.05] tracking-tight text-center lg:text-left
                         text-[26px] sm:text-4xl lg:text-[40px] xl:text-[46px]"
            style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
            Every vaccine, pill and vet visit — in one calm place.
          </h1>
          <p className="m-0 hidden sm:block text-center lg:text-left text-[15px] lg:text-base leading-snug max-w-[30rem]"
            style={{ color: '#73775b' }}>
            Pippy holds your pet&apos;s whole health story, and nudges you the morning
            something is due.
          </p>
        </section>

        {/* ── Sign in, right ────────────────────────────────────────────── */}
        <section id="signin"
          className="order-2 lg:col-start-2 lg:row-start-1 lg:row-span-2 min-h-0
                     flex flex-col justify-center gap-3">
          <div className="rounded-3xl p-4 sm:p-6 w-full"
            style={{ backgroundColor: '#ffffff', border: '1px solid #ebe3d3',
                     boxShadow: '0 14px 34px rgba(122, 73, 0, 0.09)' }}>
            {children}
          </div>

          {/* Every photo lives here now that the journal band is gone. */}
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
            style={{ backgroundColor: '#fff9e0', border: '1px solid #ebe3d3' }}>
            <span className="flex items-center flex-shrink-0">
              {HOUSEHOLD.map((photo, i) => (
                <PetPhoto key={photo.src} photo={photo} decorative
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full"
                  style={{ border: '3px solid #fffef8', marginLeft: i === 0 ? 0 : '-12px' }} />
              ))}
              <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center
                               text-[11px] font-black flex-shrink-0"
                style={{ backgroundColor: '#ffde59', color: '#7a4900',
                         border: '3px solid #fffef8', marginLeft: '-12px' }}>
                +4
              </span>
            </span>
            <span className="text-[12px] sm:text-[13px] font-bold leading-snug" style={{ color: '#73775b' }}>
              One app, every animal in the house.
            </span>
          </div>
        </section>

        {/* ── What it keeps, under the mascot ───────────────────────────── */}
        <section className="order-3 lg:col-start-1 lg:row-start-2 min-h-0 flex flex-col">
          {/* The toggle only exists on small screens; from lg the list is
              always open and this button is not rendered at all. */}
          <button type="button" onClick={() => setShowFeatures(v => !v)}
            aria-expanded={showFeatures}
            className="lg:hidden [@media(min-height:800px)]:hidden flex-shrink-0
                       flex items-center justify-between w-full
                       rounded-2xl px-4 py-2.5 text-sm font-black"
            style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
            What Pippy keeps for you
            <ChevronDown className="w-4 h-4 transition-transform"
              style={{ transform: showFeatures ? 'rotate(180deg)' : 'none' }} />
          </button>

          {/* min-h-0 + overflow-y-auto: if the list cannot fit the space left
              over, it scrolls inside itself rather than growing the page. */}
          <div className={`${showFeatures ? 'flex' : 'hidden'} [@media(min-height:800px)]:flex
                           lg:flex min-h-0 overflow-y-auto mt-2 [@media(min-height:800px)]:mt-0
                           lg:mt-0 flex-col`}>
            <ul className="m-0 p-0 list-none grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {FEATURES.map(({ icon: Icon, tint, ink, title, body }) => (
                <li key={title} className="flex items-start gap-2.5 py-1">
                  <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: tint, color: ink }}>
                    <Icon className="w-[17px] h-[17px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold text-[15px] leading-tight"
                      style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
                      {title}
                    </span>
                    <span className="block text-[12.5px] leading-snug" style={{ color: '#73775b' }}>
                      {body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="flex-shrink-0 text-center text-[11px] px-5 pb-2 sm:pb-3" style={{ color: '#73775b' }}>
        Your data is private. Only you can see your pets&apos; records.
        {onShowPrivacy && (
          <>
            {' · '}
            <button type="button" onClick={onShowPrivacy} className="underline">
              Privacy &amp; Terms
            </button>
          </>
        )}
      </footer>
    </div>
  )
}

function HeroMascot() {
  return (
    <div className="relative flex-shrink-0 aspect-square
                    w-[112px] sm:w-[150px] lg:w-[190px] xl:w-[220px]">
      <span className="absolute rounded-full" style={{ inset: '7%', backgroundColor: '#ffde59' }} />

      {/* The mascot's own artwork carries a yellow tile, so on a yellow circle
          its right ear and its edge vanished. The cream ring gives it back. */}
      <span className="absolute overflow-hidden"
        style={{ left: '15%', top: '15%', width: '70%', height: '70%',
                 borderRadius: '24%', border: '5px solid #fffef8',
                 boxShadow: '0 14px 32px rgba(122, 73, 0, 0.2)' }}>
        <img src="/pippy-mascot.png" width="356" height="356"
          alt="Pippy, a cream puppy with one sage-green ear and one yellow ear"
          className="w-full h-full object-cover block" />
      </span>

      {/* One chip, and only where there is room for it. Below lg the mascot is
          small enough that a chip lands across its face. */}
      <span className="hidden lg:flex absolute -left-4 top-0 items-center gap-2 rounded-2xl py-1.5 pl-1.5 pr-3"
        style={{ backgroundColor: '#ffffff', border: '1px solid #ebe3d3',
                 boxShadow: '0 10px 24px rgba(122, 73, 0, 0.13)' }}>
        <PetPhoto photo={PHOTOS.pino} decorative className="w-7 h-7 rounded-full" />
        <span className="text-[12px] font-extrabold whitespace-nowrap" style={{ color: '#7a4900' }}>
          Pino · due 4 Oct
        </span>
      </span>
    </div>
  )
}
