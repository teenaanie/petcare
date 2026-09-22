import { useRef, useState } from 'react'
import { Camera, Image, X } from 'lucide-react'

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

// Resize image client-side before storing (keeps DB size small)
export async function resizeImage(file, maxPx = 300) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(maxPx / img.width, maxPx / img.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * ratio)
      canvas.height = Math.round(img.height * ratio)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.src = URL.createObjectURL(file)
  })
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
  const s = SIZES[size] || SIZES.md
  const emoji = SPECIES_EMOJI[pet?.species] || '🐾'

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file || !onPhotoChange) return
    const dataUrl = await resizeImage(file)
    onPhotoChange(dataUrl)
    e.target.value = ''
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
        onClick={() => setShowPhotoMenu(true)}
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
            <div className="p-3 space-y-2">
              <button
                type="button"
                onClick={() => { setShowPhotoMenu(false); cameraRef.current?.click() }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left font-bold transition-colors"
                style={{ backgroundColor: '#fff9e0', color: '#7a4900' }}
              >
                <Camera className="w-5 h-5" /> Take Photo
              </button>
              <button
                type="button"
                onClick={() => { setShowPhotoMenu(false); libraryRef.current?.click() }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left font-bold transition-colors"
                style={{ backgroundColor: '#fff9e0', color: '#7a4900' }}
              >
                <Image className="w-5 h-5" /> Choose from Library
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
