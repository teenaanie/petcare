import { Bell, Mic, FileText, ShieldCheck, Camera, Users } from 'lucide-react'
import PippyLogo from './PippyLogo.jsx'

// The signed-out landing page. It wraps the sign-in form rather than owning it:
// PhoneAuth still holds every piece of auth logic and passes its entry form in
// as `children`, so nothing about signing in changed when this was added.

// ── Photo framing ────────────────────────────────────────────────────────────
//
// These are phone photos of whole animals, and a whole animal in a 72px circle
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
        loading="lazy"
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
  { icon: Bell, tint: '#fff3c0', ink: '#7a4900', title: 'Reminders',
    body: 'A nudge by email and on your phone, the morning a dose or a booster is due.' },
  { icon: Mic, tint: '#ffe0e0', ink: '#9c3b3b', title: 'Just say it',
    body: 'Talk on the way home from the vet. Pippy turns it into proper records you can check.' },
  { icon: FileText, tint: '#bfe5ef', ink: '#22424b', title: 'Scan the paperwork',
    body: 'Photograph a vet report or a bill. Pippy reads it and files it under the right pet.' },
  { icon: ShieldCheck, tint: '#eef3e2', ink: '#4a5f2e', title: 'Vaccinations',
    body: 'Every shot and booster with its date, in the one list a boarder asks for.' },
  { icon: Camera, tint: '#fff3c0', ink: '#7a4900', title: 'Photo journal',
    body: 'Follow a rash or a recovery week by week, with the photos beside the notes.' },
  { icon: Users, tint: '#ffe6e6', ink: '#99414d', title: 'Share with family',
    body: 'Give a partner or a sitter their own view. Look only, or help keep it up to date.' },
]

const HOUSEHOLD = [PHOTOS.pino, PHOTOS.kitten, PHOTOS.cat, PHOTOS.glasses]

export default function Landing({ children, onShowPrivacy }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#fffef8' }}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between h-16 sm:h-20">
          <div className="flex items-center gap-2.5">
            <PippyLogo size="md" />
            <span className="font-black text-xl sm:text-2xl tracking-tight"
              style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
              Pippy
            </span>
          </div>
          <a href="#signin" className="text-sm font-black rounded-full px-5 py-2.5"
            style={{ color: '#7a4900', border: '2px solid #e0d3b4' }}>
            Sign in
          </a>
        </header>

        {/* ── Hero ─────────────────────────────────────────────────────────
            The mascot is first in the DOM, which puts it on the LEFT side by
            side and keeps it on top when the columns stack on a phone — the
            first thing you see should be the dog, not a wall of type. That is
            also why this is a plain flex-col rather than flex-col-reverse. */}
        <section className="flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-12 pt-4 pb-10 sm:pb-14">

          <div className="lg:flex-1 flex justify-center">
            <HeroMascot />
          </div>

          <div className="lg:w-[54%] flex flex-col gap-5">
            <span className="self-start text-[11px] sm:text-xs font-black uppercase tracking-[0.09em] px-3.5 py-2 rounded-full"
              style={{ backgroundColor: '#bfe5ef', color: '#22424b' }}>
              For every pet you look after
            </span>

            <h1 className="m-0 font-extrabold leading-[1.05] tracking-tight text-[38px] sm:text-5xl lg:text-[58px]"
              style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
              Every vaccine, pill and vet visit, in one calm place.
            </h1>

            <p className="m-0 text-base sm:text-lg leading-relaxed max-w-[34rem]" style={{ color: '#73775b' }}>
              Pippy holds your pet&apos;s whole health record, and tells you the morning
              something is due, so you don&apos;t have to remember.
            </p>

            {/* The sign-in form itself. PhoneAuth owns it; this is only the box
                it sits in. */}
            <div id="signin" className="mt-1 rounded-3xl p-5 sm:p-6 w-full max-w-[29rem]"
              style={{ backgroundColor: '#ffffff', border: '1px solid #ebe3d3',
                       boxShadow: '0 14px 34px rgba(122, 73, 0, 0.09)' }}>
              {children}
            </div>
          </div>

        </section>

        {/* ── Household strip ──────────────────────────────────────────── */}
        <section className="rounded-3xl px-5 py-5 sm:px-8 sm:py-6 flex flex-col sm:flex-row sm:items-center gap-5"
          style={{ backgroundColor: '#fff9e0', border: '1px solid #ebe3d3' }}>
          <div className="flex-grow">
            <h2 className="m-0 mb-1 font-extrabold text-xl sm:text-2xl tracking-tight"
              style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
              One app, every animal in the house
            </h2>
            <p className="m-0 text-sm sm:text-[15px]" style={{ color: '#73775b' }}>
              Every pet gets their own records and history.
            </p>
          </div>
          <div className="flex items-center flex-shrink-0">
            {HOUSEHOLD.map((photo, i) => (
              <PetPhoto
                key={photo.src}
                photo={photo}
                decorative
                className="w-[62px] h-[62px] sm:w-[72px] sm:h-[72px] rounded-full"
                style={{ border: '4px solid #fffef8', marginLeft: i === 0 ? 0 : '-16px',
                         boxShadow: '0 5px 14px rgba(122,73,0,0.14)' }}
              />
            ))}
            <span className="w-[62px] h-[62px] sm:w-[72px] sm:h-[72px] rounded-full flex items-center justify-center font-black text-base flex-shrink-0"
              style={{ backgroundColor: '#ffde59', color: '#7a4900', border: '4px solid #fffef8',
                       marginLeft: '-16px', boxShadow: '0 5px 14px rgba(122,73,0,0.14)' }}>
              +4
            </span>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────── */}
        <section className="pt-12 sm:pt-16 pb-10">
          <h2 className="m-0 mb-2 font-extrabold text-[28px] sm:text-4xl tracking-tight"
            style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
            What Pippy keeps
          </h2>
          <p className="m-0 mb-7 text-base sm:text-[17px]" style={{ color: '#73775b' }}>
            The things that otherwise live in a folder somewhere.
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

        {/* ── Journal band ─────────────────────────────────────────────── */}
        <section className="rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center gap-7"
          style={{ backgroundColor: '#bfe5ef' }}>
          <div className="flex-grow">
            <h2 className="m-0 mb-2.5 font-extrabold text-2xl sm:text-3xl tracking-tight"
              style={{ color: '#22424b', fontFamily: 'var(--font-display)' }}>
              Show a vet what changed
            </h2>
            <p className="m-0 mb-4 text-[15px] sm:text-base leading-relaxed max-w-[27rem]" style={{ color: '#22424b' }}>
              A limp, or the week something finally cleared up. The journal keeps the
              photos in order, with the date each one was taken.
            </p>
            <div className="flex flex-wrap gap-2">
              {['Emergency card', 'Boarding prep', 'Weight trend', 'Timeline'].map(tag => (
                <span key={tag} className="text-xs font-extrabold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: '#fffef8', color: '#22424b' }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-3.5 flex-shrink-0">
            <JournalEntry photo={PHOTOS.glasses} caption="12 September" />
            <JournalEntry photo={PHOTOS.cat} caption="28 September" />
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <footer className="py-10 sm:py-12 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="flex items-center gap-4">
            <PippyLogo size="hero" className="w-[60px] h-[60px] sm:w-[72px] sm:h-[72px]" />
            <div>
              <h2 className="m-0 mb-1 font-extrabold text-xl sm:text-2xl tracking-tight"
                style={{ color: '#7a4900', fontFamily: 'var(--font-display)' }}>
                Start with one pet. It takes a minute.
              </h2>
              <p className="m-0 text-sm sm:text-[15px]" style={{ color: '#73775b' }}>
                Add the rest whenever you like. Pippy handles a household.
              </p>
            </div>
          </div>
          <a href="#signin"
            className="flex-shrink-0 text-center font-black rounded-2xl px-8 py-4 text-base"
            style={{ backgroundColor: '#ffde59', color: '#7a4900' }}>
            Get started
          </a>
        </footer>

        {/* This used to be a `fixed` link in App.jsx. That was fine when the
            signed-out screen was one non-scrolling card; now the page scrolls,
            and a fixed link sat on top of whatever you were reading. */}
        <p className="text-center text-xs pb-8" style={{ color: '#73775b' }}>
          Only you can see your pets&apos; records.
          {onShowPrivacy && (
            <>
              {' '}
              <button type="button" onClick={onShowPrivacy} className="underline">
                Privacy &amp; Terms
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function JournalEntry({ photo, caption }) {
  return (
    <div className="w-[130px] sm:w-[148px]">
      {/* aspect-square, not a fixed height: PetPhoto's offsets are a percentage
          of the frame's height, so a non-square frame slides the crop. */}
      <PetPhoto photo={photo} className="w-full aspect-square rounded-2xl" />
      <span className="block mt-2 text-[11px] sm:text-xs font-extrabold" style={{ color: '#22424b' }}>
        {caption}
      </span>
    </div>
  )
}

function HeroMascot() {
  return (
    /* Deliberately smaller on a phone. At full width the mascot filled the
       whole first screen and pushed the headline and the sign-in box below the
       fold — the dog should greet you, not be the entire first impression. */
    <div className="relative w-full max-w-[210px] sm:max-w-[320px] lg:max-w-[400px] aspect-square">
      {/* The backdrop. */}
      <span className="absolute rounded-full" style={{ inset: '7%', backgroundColor: '#ffde59' }} />

      {/* The mascot's own artwork carries a yellow tile, so on a yellow circle
          its right ear and its edge vanished. The cream ring gives it back. */}
      <span className="absolute overflow-hidden"
        style={{ left: '15%', top: '15%', width: '70%', height: '70%',
                 borderRadius: '24%', border: '6px solid #fffef8',
                 boxShadow: '0 20px 44px rgba(122, 73, 0, 0.2)' }}>
        <img src="/pippy-mascot.png" width="356" height="356"
          alt="Pippy, a cream puppy with one sage-green ear and one yellow ear"
          className="w-full h-full object-cover block" />
      </span>

      <Chip className="left-0 top-[2%] flex" photo={PHOTOS.pino} text="Pino, due 4 Oct" />
      {/* Only one chip on a phone. At that size the mascot is small enough that
          a second chip lands across its face. */}
      <Chip className="right-0 top-[55%] hidden sm:flex" photo={PHOTOS.kitten} text="New journal photo" />
    </div>
  )
}

function Chip({ className, photo, text }) {
  return (
    /* `flex` is not in the base on purpose: each caller sets its own display so
       one chip can be hidden on small screens without two display utilities
       fighting over which wins. */
    <span className={`absolute items-center gap-2 rounded-2xl py-2 pl-2 pr-3 ${className}`}
      style={{ backgroundColor: '#ffffff', border: '1px solid #ebe3d3',
               boxShadow: '0 10px 24px rgba(122, 73, 0, 0.13)' }}>
      <PetPhoto photo={photo} decorative className="w-8 h-8 rounded-full" />
      <span className="text-[11px] sm:text-[13px] font-extrabold whitespace-nowrap" style={{ color: '#7a4900' }}>
        {text}
      </span>
    </span>
  )
}
