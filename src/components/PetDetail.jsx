import { useState, useEffect } from 'react'
import { Edit2, Trash2, Calendar, Weight, Phone, Sparkles, ShieldAlert, Users } from 'lucide-react'
import { supabase, isConfigured } from '../lib/supabase.js'
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

const STAGE_COLORS = ['#ffde59','#f2b83d','#beb950','#bfe5ef','#ff9999','#878c6b']

// Mirrors the sidebar's tab list — rendered as a chip row on mobile.
const PET_TABS = [
  { id: 'timeline',     label: 'Timeline' },
  { id: 'reminders',    label: 'Reminders' },
  { id: 'scanner',      label: 'Scan' },
  { id: 'medical',      label: 'Medical' },
  { id: 'vaccinations', label: 'Vaccines' },
  { id: 'medicines',    label: 'Medicines' },
  { id: 'weight',       label: 'Weight' },
  { id: 'allergies',    label: 'Allergies' },
  { id: 'journal',      label: 'Photo Journal' },
  { id: 'bills',        label: 'Bills' },
  { id: 'boarding',     label: 'Boarding' },
]

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
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid #ebe3d3' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>Life Stage</span>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: STAGE_COLORS[stageColorIdx] + '55', color: '#7a4900' }}>
          {stageEmoji} {stageName}
        </span>
      </div>

      {/* Bar */}
      <div className="relative w-full h-4 rounded-full overflow-hidden flex" style={{ backgroundColor: '#ebe3d3' }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ width: `${seg.width}%`, backgroundColor: seg.color, opacity: 0.7 }} />
        ))}
        {/* Marker */}
        <div className="absolute top-0 bottom-0 flex items-center justify-center"
          style={{ left: `${Math.min(pctPos, 98)}%`, transform: 'translateX(-50%)' }}>
          <div className="w-3.5 h-3.5 rounded-full border-2 shadow-sm"
            style={{ backgroundColor: '#7a4900', borderColor: 'white' }} />
        </div>
      </div>

      {/* Stage labels */}
      <div className="flex mt-1" style={{ position: 'relative' }}>
        {segments.map((seg, i) => (
          <div key={i} className="text-center overflow-hidden"
            style={{ width: `${seg.width}%`, minWidth: 0 }}>
            <span className="text-[9px] font-semibold truncate block" style={{ color: '#73775b' }}>
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
import EmergencyCard from './EmergencyCard.jsx'
import PetSharing from './PetSharing.jsx'
import BreedAlert from './BreedAlert.jsx'
import Boarding from './Boarding.jsx'
import ConditionJournal from './ConditionJournal.jsx'

export default function PetDetail({ pet, activeTab, onTabChange, onPetUpdated, onPetDeleted, prefillProviderId, onPrefillUsed }) {
  const [showEdit, setShowEdit]                   = useState(false)
  const [showHealthSummary, setShowHealthSummary] = useState(false)
  const [showEmergencyCard, setShowEmergencyCard] = useState(false)
  const [showSharing, setShowSharing]             = useState(false)
  const [session, setSession]             = useState(null)

  useEffect(() => {
    // `supabase` is null when the app is running on localStorage only, so this
    // has to be guarded — otherwise opening any pet throws before it renders.
    if (!isConfigured) return
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
              <h1 className="text-lg md:text-2xl font-black" style={{ color: '#7a4900' }}>{pet.name}</h1>
              <p className="text-sm" style={{ color: '#73775b' }}>{pet.species} · {pet.breed}</p>
              <div className="flex flex-wrap gap-2 md:gap-4 mt-1 text-xs md:text-sm" style={{ color: '#73775b' }}>
                {age !== null && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {age} yr</span>}
                {pet.weight && <span className="flex items-center gap-1"><Weight className="w-3.5 h-3.5" /> {pet.weight}kg</span>}
                {pet.vetPhone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {pet.vetPhone}</span>}
              </div>
              <LifeStageBar pet={pet} ageYears={age} />
            </div>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={() => setShowSharing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={{ backgroundColor: '#eef8fb', color: '#255d6e' }}
              title="Share with family">
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Share</span>
            </button>
            <button onClick={() => setShowEmergencyCard(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}
              title="Emergency Card">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">SOS</span>
            </button>
            <button onClick={() => setShowHealthSummary(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={{ backgroundColor: '#f2b83d', color: '#7a4900' }}
              title="AI Health Brief">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">AI Brief</span>
            </button>
            <button onClick={() => setShowEdit(true)}
              className="p-2 rounded-xl transition-colors"
              style={{ color: '#7a4900' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#fff9e0'}
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

      {/* Section tabs — on mobile these live here, next to the content they
          filter, so the bottom bar is free for app-level destinations. */}
      <div className="md:hidden -mx-4 px-4 mb-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 w-max">
          {PET_TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              aria-current={activeTab === id ? 'page' : undefined}
              className="px-3 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-all"
              style={activeTab === id
                ? { backgroundColor: '#ffde59', color: '#7a4900' }
                : { backgroundColor: '#f5f0e0', color: '#73775b' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Breed health alert */}
      {pet.breed && activeTab === 'timeline' && <BreedAlert pet={pet} />}

      {/* Tab content */}
      {activeTab === 'timeline'     && <Timeline pet={pet} />}
      {activeTab === 'medical'      && <MedicalHistory pet={pet} />}
      {activeTab === 'vaccinations' && <Vaccinations pet={pet} />}
      {activeTab === 'medicines'    && <Medicines pet={pet} />}
      {activeTab === 'weight'       && <WeightLog pet={pet} />}
      {activeTab === 'bills'        && <Bills pet={pet} />}
      {activeTab === 'allergies'    && <Allergies pet={pet} />}
      {activeTab === 'journal'      && <ConditionJournal pet={pet} />}
      {activeTab === 'scanner'      && <DocumentScanner pet={pet} session={session} />}
      {activeTab === 'reminders'    && <Reminders pet={pet} />}
      {activeTab === 'boarding'     && <Boarding pet={pet} onPetUpdated={onPetUpdated}
                                          prefillProviderId={prefillProviderId} onPrefillUsed={onPrefillUsed} />}

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

      {showEmergencyCard && (
        <EmergencyCard pet={pet} onClose={() => setShowEmergencyCard(false)} />
      )}

      {showSharing && (
        <PetSharing pet={pet} onClose={() => setShowSharing(false)} />
      )}
    </div>
  )
}
