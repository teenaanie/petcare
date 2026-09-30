import { useRef, useState } from 'react'
// ImageIcon, NOT Image. Importing lucide's `Image` into this module shadowed
// the GLOBAL Image constructor, so `new Image()` below built a React component
// instead of an HTMLImageElement: setting .src did nothing, onload never
// fired, and resizing a photo hung for ever. Picking a photo simply did
// nothing, with no error anywhere — which is what was reported.
import { Camera, Image as ImageIcon, X, Loader2, AlertCircle } from 'lucide-react'
import { friendlyError } from '../lib/errors.js'

const SPECIES_EMOJI = {
  Dog:     '🐕',
  Cat:     '🐈',
  Bird:    '🐦',
  Rabbit:  '🐇',
  Hamster: '🐹',
  Fish:    '🐠',
  Reptile: '🦎',
  Other:   '🐾',
}

// How large a stored avatar may get, in characters of the base64 data URL.
// 60000 is roughly a 44 kB image; the largest photo in the table today is 34 kB,
// so ordinary uploads never reach this. The database enforces a harder 150000
// (see supabase/usage_tracking.sql) because this file runs in the browser and
// is therefore a courtesy, not a limit.
const PHOTO_BUDGET = 60_000
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.4]

// Resize image client-side before storing (keeps DB size small)
//
// This promise used to have only an `onload` path. If the browser could not
// decode the picture — a HEIC the engine does not handle, a file the picker
// mislabels, a corrupt capture — `onload` never fired, `onerror` was not
// listened for, and the promise NEVER SETTLED. The caller awaited it forever:
// no photo, no error, nothing on screen. That is exactly "I picked a photo and
// nothing happened".
//
// It now settles on every path, and says which one it took. The object URL is
// revoked too — it used to leak one blob URL per photo chosen.
export async function resizeImage(file, maxPx = 300) {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()

      // A last resort for the pathological case where a browser fires neither
      // event. Better a clear message than a screen that never changes.
      const timer = setTimeout(
        () => reject(new Error('That photo took too long to open. Try a different one.')),
        15_000)

      const done = fn => (...args) => { clearTimeout(timer); fn(...args) }

      img.onload = done(() => {
        // Shrinking to a fixed pixel size caps the DIMENSIONS but not the
        // bytes, and bytes are what actually cost anything: this string is
        // stored in pets.photo, so it counts against the database's 500 MB
        // rather than the 1 GB file storage, and every query that reads a pet
        // carries the whole image along with it. A noisy 300px photo can
        // encode several times larger than a smooth one at the same quality,
        // so quality steps down until the result fits the budget, and the
        // dimensions are halved once if even the lowest quality will not.
        const encode = (px, q) => {
          const ratio = Math.min(px / img.width, px / img.height, 1)
          const canvas = document.createElement('canvas')
          canvas.width  = Math.round(img.width  * ratio)
          canvas.height = Math.round(img.height * ratio)
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
          return canvas.toDataURL('image/jpeg', q)
        }

        let out = null
        for (const px of [maxPx, Math.round(maxPx / 2)]) {
          for (const q of QUALITY_STEPS) {
            out = encode(px, q)
            if (out.length <= PHOTO_BUDGET) return resolve(out)
          }
        }

        // Everything was tried and nothing fit. Returning the oversized string
        // anyway would hand the database a row it will refuse (there is a CHECK
        // constraint on pets.photo), and the user would see an opaque failure
        // on save instead of a clear one here.
        reject(new Error(
          'That photo could not be shrunk small enough to store. Try a simpler ' +
          'or less detailed picture.'))
      })

      img.onerror = done(() => reject(new Error(
        "This browser couldn't read that photo. If it came from an iPhone it may be HEIC — " +
        'reopen it from Photos and choose "Most Compatible", or pick a JPEG.')))

      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

const SIZES = {
  xs:  { wrap: 'w-7 h-7',   text: 'text-base',  radius: 'rounded-lg' },
  sm:  { wrap: 'w-8 h-8',   text: 'text-xl',    radius: 'rounded-xl' },
  md:  { wrap: 'w-12 h-12', text: 'text-2xl',   radius: 'rounded-2xl' },
  lg:  { wrap: 'w-14 h-14', text: 'text-3xl',   radius: 'rounded-2xl' },
  xl:  { wrap: 'w-20 h-20', text: 'text-4xl',   radius: 'rounded-3xl' },
}

/**
 * PetAvatar — shows pet photo, or species emoji, or first-letter fallback.
 * Pass `editable` + `onPhotoChange` to show a camera overlay on click.
 */
export default function PetAvatar({ pet, size = 'md', editable = false, onPhotoChange, className = '' }) {
  const cameraRef = useRef()
  const libraryRef = useRef()
  const [showPhotoMenu, setShowPhotoMenu] = useState(false)
  const [busy, setBusy]                   = useState(false)
  const [photoError, setPhotoError]       = useState(null)

  const openPhotoMenu = () => { setPhotoError(null); setShowPhotoMenu(true) }
  const s = SIZES[size] || SIZES.md
  const emoji = SPECIES_EMOJI[pet?.species] || '🐾'

  async function handleFile(e) {
    const file = e.target.files?.[0]
    // Reset the input FIRST. Left until the end, it was skipped whenever
    // anything below threw — and a file input still holding the same file
    // fires no change event when you pick that file again, so a failed
    // attempt made the photo unpickable until the page was reloaded.
    e.target.value = ''
    if (!file || !onPhotoChange) return

    setBusy(true)
    setPhotoError(null)
    try {
      const dataUrl = await resizeImage(file)
      await onPhotoChange(dataUrl)
      setShowPhotoMenu(false)
    } catch (err) {
      // This is where "TypeError: Load failed" was going: nowhere. The whole
      // handler was unguarded, so a failed save became an unhandled rejection
      // and the user saw the old photo with no explanation.
      setPhotoError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const inner = pet?.photo ? (
    <img src={pet.photo} alt={pet.name} className={`w-full h-full object-cover ${s.radius}`} />
  ) : (
    <div className={`${s.wrap} ${s.radius} flex items-center justify-center flex-shrink-0 select-none`}
      style={{ background: 'linear-gradient(135deg, #f2b83d, #878c6b)' }}>
      <span className={s.text}>{emoji}</span>
    </div>
  )

  if (!editable) {
    return (
      <div className={`${s.wrap} ${s.radius} overflow-hidden flex-shrink-0 ${className}`}
        style={pet?.photo ? {} : { background: 'linear-gradient(135deg, #f2b83d, #878c6b)' }}>
        {pet?.photo
          ? <img src={pet.photo} alt={pet.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center"><span className={s.text}>{emoji}</span></div>
        }
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={openPhotoMenu}
        className={`relative ${s.wrap} ${s.radius} overflow-hidden flex-shrink-0 group ${className}`}
        title="Change photo"
      >
        {pet?.photo
          ? <img src={pet.photo} alt={pet.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #f2b83d, #878c6b)' }}>
              <span className={s.text}>{emoji}</span>
            </div>
        }
        {/* Camera overlay on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl"
          style={{ backgroundColor: 'rgba(122,73,0,0.45)' }}>
          <Camera className="w-5 h-5 text-white" />
        </div>
      </button>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
      <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      {showPhotoMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setShowPhotoMenu(false)}>
          <div className="w-full max-w-xs rounded-3xl shadow-2xl overflow-hidden"
            style={{ backgroundColor: '#FFFEF8' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: '1px solid #ebe3d3' }}>
              <span className="font-black" style={{ color: '#7a4900' }}>Update Photo</span>
              <button type="button" onClick={() => setShowPhotoMenu(false)}>
                <X className="w-5 h-5" style={{ color: '#73775b' }} />
              </button>
            </div>
            {/* The menu stays open until the photo is actually saved. It used
                to close the moment you tapped, which left nowhere to show a
                spinner or an error — the reason a failure looked like nothing
                happening at all. handleFile closes it on success. */}
            <div className="p-3 space-y-2">
              <button
                type="button" disabled={busy}
                onClick={() => cameraRef.current?.click()}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left font-bold transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#fff9e0', color: '#7a4900' }}
              >
                <Camera className="w-5 h-5" /> Take Photo
              </button>
              <button
                type="button" disabled={busy}
                onClick={() => libraryRef.current?.click()}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left font-bold transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#fff9e0', color: '#7a4900' }}
              >
                <ImageIcon className="w-5 h-5" /> Choose from Library
              </button>

              {busy && (
                <p className="flex items-center gap-2 text-sm px-1" style={{ color: '#73775b' }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> Saving the photo…
                </p>
              )}

              {photoError && (
                <p className="flex items-start gap-2 text-sm p-3 rounded-xl"
                  style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {photoError}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
