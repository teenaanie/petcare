import { useState, useEffect } from 'react'
import { Edit2, Trash2, Calendar, Weight, Phone, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import HealthSummary from './HealthSummary.jsx'

// ── Life stage data ───────────────────────────────────────────────────────────
const STAGES = {
  Dog:     [{ label: 'Puppy',    emoji: '🐶', max: 1  },
             { label: 'Junior',   emoji: '🐕', max: 3  },
             { label: 'Adult',    emoji: '🐕', max: 7  },
             { label: 'Senior',   emoji: '🐕', max: 11 },
             { label: 'Geriatric',emoji: '🐕', max: 16 }],
  Cat:     [{ label: 'Kitten',   emoji: '🐱', max: 1  },
             { label: 'Junior',   emoji: '🐈', max: 3  },
             { label: 'Prime',    emoji: '🐈', max: 6  },
             { label: 'Mature',   emoji: '🐈', max: 10 },
             { label: 'Senior',   emoji: '🐈', max: 15 },
             { label: 'Geriatric',emoji: '🐈', max: 20 }],
  default: [{ label: 'Young',    emoji: '🐾', max: 2  },
             { label: 'Adult',    emoji: '🐾', max: 7  },
             { label: 'Senior',   emoji: '🐾', max: 12 },
             { label: 'Geriatric',emoji: '🐾', max: 18 }],
}

const STAGE_COLORS = ['#FFD54F','#FFF176','#AED581','#81D4FA','#CE93D8','#F48FB1']

function LifeStageBar({ pet, ageYears }) {
  if (ageYears === null) return null
  const stages = STAGES[pet.species] || STAGES.default
  const maxLifespan = stages[stages.length - 1].max
  const clampedAge = Math.min(ageYears, maxLifespan)

  // Find current stage
  let accum = 0
  const currentStage = stages.find(s => { const inRange = ageYears <= accum + s.max; accum = 0; return inRange })
    || stages[stages.length - 1]

  // Build segments with widths proportional to stage span
  let from = 0
  const segments = stages.map((s, i) => {
    const seg = { ...s, from, width: (s.max - from) / maxLifespan * 100, color: STAGE_COLORS[i] }
    from = s.max
    return seg
  })

  const pctPos = (clampedAge / maxLifespan) * 100

  // Which stage are we in?
  let cursor = 0
  const activeIdx = stages.findIndex(s => { const yes = ageYears <= (cursor + s.max); cursor = 0; return yes })
  const activeStage = stages.find((s, i) => {
    let lo = i === 0 ? 0 : stages.slice(0, i).reduce((a, b) => a + b.max, 0) - stages.slice(0, i - 1).reduce((a, b) => a + b.max, 0)
    return true
  })

  // Simple approach: find stage by accumulating
  let lo = 0
  let activeStageLabel = stages[stages.length - 1].label
  let activeEmoji = stages[stages.length - 1].emoji
  for (let i = 0; i < stages.length; i++) {
    const stageMax = (i === 0 ? 0 : stages.slice(0, i).reduce((s, x) => s + x.max, 0))
    const hi = stageMax + stages[i].max
    if (ageYears <= hi || i === stages.length - 1) {
      activeStageLabel = stages[i].label
      activeEmoji = stages[i].emoji
      break
    }
  }

  // Actually, simplest:
  let cum = 0
  let stageName = stages[stages.length - 1].label
  let stageEmoji = stages[stages.length - 1].emoji
  let stageColorIdx = stages.length - 1
  for (let i = 0; i < stages.length; i++) {
    cum += stages[i].max
    if (ageYears <= cum) {
      stageName = stages[i].label
      stageEmoji = stages[i].emoji
      stageColorIdx = i
      break
    }
  }

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid #F0E6C8' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-black uppercase tracking-wider" style={{ color: '#B8A080' }}>Life Stage</span>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: STAGE_COLORS[stageColorIdx] + '55', color: '#4A2C0A' }}>
          {stageEmoji} {stageName}
        </span>
      </div>

      {/* Bar */}
      <div className="relative w-full h-4 rounded-full overflow-hidden flex" style={{ backgroundColor: '#F0E6C8' }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ width: `${seg.width}%`, backgroundColor: seg.color, opacity: 0.7 }} />
        ))}
        {/* Marker */}
        <div className="absolute top-0 bottom-0 flex items-center justify-center"
          style={{ left: `${Math.min(pctPos, 98)}%`, transform: 'translateX(-50%)' }}>
          <div className="w-3.5 h-3.5 rounded-full border-2 shadow-sm"
            style={{ backgroundColor: '#4A2C0A', borderColor: 'white' }} />
        </div>
      </div>

      {/* Stage labels */}
      <div className="flex mt-1" style={{ position: 'relative' }}>
        {segments.map((seg, i) => (
          <div key={i} className="text-center overflow-hidden"
            style={{ width: `${seg.width}%`, minWidth: 0 }}>
            <span className="text-[9px] font-semibold truncate block" style={{ color: '#B8A080' }}>
              {seg.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
import { deletePet, savePet } from '../lib/storage.js'
import { format } from 'date-fns'
import AddPetModal from './AddPetModal.jsx'
import PetAvatar from './PetAvatar.jsx'
import Timeline from './Timeline.jsx'
import MedicalHistory from './MedicalHistory.jsx'
import Vaccinations from './Vaccinations.jsx'
import Allergies from './Allergies.jsx'
import DocumentScanner from './DocumentScanner.jsx'
import Reminders from './Reminders.jsx'
import WeightLog from './WeightLog.jsx'
import Medicines from './Medicines.jsx'
import Bills from './Bills.jsx'

export default function PetDetail({ pet, activeTab, onTabChange, onPetUpdated, onPetDeleted }) {
  const [showEdit, setShowEdit]           = useState(false)
  const [showHealthSummary, setShowHealthSummary] = useState(false)
  const [session, setSession]             = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
  }, [])

  async function handleDelete() {
    if (confirm(`Delete ${pet.name}? This will remove all their records.`)) {
      await deletePet(pet.id)
      onPetDeleted()
    }
  }

  async function handlePhotoChange(photoDataUrl) {
    const updated = { ...pet, photo: photoDataUrl }
    await savePet(updated)
    onPetUpdated(updated)
  }

  const age = pet.dob
    ? Math.floor((Date.now() - new Date(pet.dob)) / (1000 * 60 * 60 * 24 * 365))
    : null

  return (
    <div className="p-4 md:p-8">
      {/* Pet header */}
      <div className="card mb-4 md:mb-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 md:gap-4">
            <PetAvatar pet={pet} size="lg" editable onPhotoChange={handlePhotoChange} />
            <div className="flex-1 min-w-0">
              <h1 className="text-lg md:text-2xl font-black" style={{ color: '#4A2C0A' }}>{pet.name}</h1>
              <p className="text-sm" style={{ color: '#B8A080' }}>{pet.species} · {pet.breed}</p>
              <div className="flex flex-wrap gap-2 md:gap-4 mt-1 text-xs md:text-sm" style={{ color: '#B8A080' }}>
                {age !== null && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {age} yr</span>}
                {pet.weight && <span className="flex items-center gap-1"><Weight className="w-3.5 h-3.5" /> {pet.weight}kg</span>}
                {pet.vetPhone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {pet.vetPhone}</span>}
              </div>
              <LifeStageBar pet={pet} ageYears={age} />
            </div>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={() => setShowHealthSummary(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={{ backgroundColor: '#F9D548', color: '#4A2C0A' }}
              title="AI Health Brief">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">AI Brief</span>
            </button>
            <button onClick={() => setShowEdit(true)}
              className="p-2 rounded-xl transition-colors"
              style={{ color: '#6B4C1E' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#FFF9D6'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
              <Edit2 className="w-4 h-4" />
            </button>
            <button onClick={handleDelete}
              className="p-2 rounded-xl transition-colors text-red-400 hover:text-red-600 hover:bg-red-50">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'timeline'     && <Timeline pet={pet} />}
      {activeTab === 'medical'      && <MedicalHistory pet={pet} />}
      {activeTab === 'vaccinations' && <Vaccinations pet={pet} />}
      {activeTab === 'medicines'    && <Medicines pet={pet} />}
      {activeTab === 'weight'       && <WeightLog pet={pet} />}
      {activeTab === 'bills'        && <Bills pet={pet} />}
      {activeTab === 'allergies'    && <Allergies pet={pet} />}
      {activeTab === 'scanner'      && <DocumentScanner pet={pet} session={session} />}
      {activeTab === 'reminders'    && <Reminders pet={pet} />}

      {showEdit && (
        <AddPetModal
          pet={pet}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => {
            setShowEdit(false)
            onPetUpdated(updated || pet)
          }}
        />
      )}

      {showHealthSummary && (
        <HealthSummary pet={pet} onClose={() => setShowHealthSummary(false)} />
      )}
    </div>
  )
}
