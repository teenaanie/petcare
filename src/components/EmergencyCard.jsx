import { useState, useEffect, useRef } from 'react'
import { X, Share2, Download, ShieldAlert } from 'lucide-react'
import { getMedicalHistory, getVaccinations, getAllergies } from '../lib/storage.js'
import { format, parseISO, isValid } from 'date-fns'

function fmt(str) {
  if (!str) return null
  try { const d = parseISO(str); return isValid(d) ? format(d, 'MMM d, yyyy') : null } catch { return null }
}

export default function EmergencyCard({ pet, onClose }) {
  const [medical, setMedical]   = useState([])
  const [vacc, setVacc]         = useState([])
  const [allergies, setAllergies] = useState([])
  const [loading, setLoading]   = useState(true)
  const cardRef = useRef(null)

  useEffect(() => {
    Promise.all([
      getMedicalHistory(pet.id),
      getVaccinations(pet.id),
      getAllergies(pet.id),
    ]).then(([m, v, a]) => {
      setMedical(m.slice(0, 5))
      setVacc(v.filter(x => x.nextDue && new Date(x.nextDue) > new Date()).slice(0, 5))
      setAllergies(a)
    }).finally(() => setLoading(false))
  }, [pet.id])

  const age = pet.dob
    ? Math.floor((Date.now() - new Date(pet.dob)) / (1000 * 60 * 60 * 24 * 365))
    : null

  async function handleShare() {
    const text = buildText()
    if (navigator.share) {
      try { await navigator.share({ title: `${pet.name}'s Emergency Card`, text }) } catch {}
    } else {
      await navigator.clipboard.writeText(text)
      alert('Emergency card copied to clipboard!')
    }
  }

  function buildText() {
    const lines = [
      `🐾 EMERGENCY PET CARD — ${pet.name.toUpperCase()}`,
      `${'─'.repeat(40)}`,
      `Species: ${pet.species}  Breed: ${pet.breed || '—'}`,
      age !== null ? `Age: ${age} years` : '',
      pet.weight ? `Weight: ${pet.weight} kg` : '',
      pet.vetPhone ? `Vet Phone: ${pet.vetPhone}` : '',
      '',
      allergies.length ? `⚠️ ALLERGIES: ${allergies.map(a => a.allergen).join(', ')}` : '✅ No known allergies',
      '',
      vacc.length ? `💉 UPCOMING VACCINATIONS:\n${vacc.map(v => `  • ${v.name} — due ${fmt(v.nextDue) || v.nextDue}`).join('\n')}` : '',
      medical.length ? `🏥 RECENT MEDICAL HISTORY:\n${medical.map(m => `  • ${fmt(m.date) || ''} ${m.diagnosis || m.description || ''}`).join('\n')}` : '',
    ].filter(Boolean)
    return lines.join('\n')
  }

  function handlePrint() { window.print() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl flex flex-col"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ backgroundColor: '#4A2C0A' }}>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" style={{ color: '#F9D548' }} />
            <span className="font-black text-white">Emergency Card</span>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Card content — scrollable */}
        <div ref={cardRef} className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Pet identity */}
          <div className="rounded-2xl p-4" style={{ backgroundColor: '#FFF5AA' }}>
            <div className="flex items-center gap-3">
              {pet.photo ? (
                <img src={pet.photo} alt={pet.name}
                  className="w-16 h-16 rounded-2xl object-cover flex-shrink-0" />
              ) : (
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 text-3xl"
                  style={{ backgroundColor: '#F9D548' }}>
                  {pet.species === 'Dog' ? '🐶' : pet.species === 'Cat' ? '🐱' : '🐾'}
                </div>
              )}
              <div>
                <h2 className="text-2xl font-black" style={{ color: '#4A2C0A' }}>{pet.name}</h2>
                <p className="text-sm" style={{ color: '#6B4C1E' }}>
                  {pet.species}{pet.breed ? ` · ${pet.breed}` : ''}
                </p>
                <div className="flex flex-wrap gap-3 mt-1 text-xs font-bold" style={{ color: '#B8A080' }}>
                  {age !== null && <span>Age: {age} yr</span>}
                  {pet.weight && <span>Weight: {pet.weight} kg</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Vet contact */}
          {pet.vetPhone && (
            <div className="rounded-2xl p-3 flex items-center gap-3"
              style={{ backgroundColor: '#EFF6FF', border: '1.5px solid #BFDBFE' }}>
              <span className="text-xl">🏥</span>
              <div>
                <p className="text-xs font-black uppercase tracking-wider" style={{ color: '#1E40AF' }}>Vet Contact</p>
                <a href={`tel:${pet.vetPhone}`} className="font-black text-base" style={{ color: '#1D4ED8' }}>
                  {pet.vetPhone}
                </a>
              </div>
            </div>
          )}

          {/* Allergies */}
          {!loading && (
            <div className="rounded-2xl p-3"
              style={allergies.length
                ? { backgroundColor: '#FEF2F2', border: '1.5px solid #FECACA' }
                : { backgroundColor: '#F0FDF4', border: '1.5px solid #BBF7D0' }}>
              <p className="text-xs font-black uppercase tracking-wider mb-2"
                style={{ color: allergies.length ? '#DC2626' : '#16A34A' }}>
                {allergies.length ? '⚠️ Allergies' : '✅ No known allergies'}
              </p>
              {allergies.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {allergies.map(a => (
                    <span key={a.id} className="px-2.5 py-1 rounded-full text-xs font-bold"
                      style={{ backgroundColor: '#DC2626', color: 'white' }}>
                      {a.allergen}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Upcoming vaccinations */}
          {!loading && vacc.length > 0 && (
            <div>
              <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#B8A080' }}>
                💉 Upcoming Vaccinations
              </p>
              <div className="space-y-1.5">
                {vacc.map(v => (
                  <div key={v.id} className="flex justify-between text-sm rounded-xl px-3 py-2"
                    style={{ backgroundColor: '#F5F3FF' }}>
                    <span className="font-semibold" style={{ color: '#4A2C0A' }}>{v.name}</span>
                    <span style={{ color: '#7C3AED' }}>{fmt(v.nextDue) || v.nextDue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent medical */}
          {!loading && medical.length > 0 && (
            <div>
              <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: '#B8A080' }}>
                🏥 Recent Medical History
              </p>
              <div className="space-y-1.5">
                {medical.map(m => (
                  <div key={m.id} className="rounded-xl px-3 py-2"
                    style={{ backgroundColor: '#FFFEF8', border: '1px solid #F0E6C8' }}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold" style={{ color: '#4A2C0A' }}>
                        {m.diagnosis || m.description || 'Visit'}
                      </span>
                      {m.date && (
                        <span className="text-xs flex-shrink-0" style={{ color: '#B8A080' }}>
                          {fmt(m.date)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <p className="text-center text-sm py-4" style={{ color: '#B8A080' }}>Loading records…</p>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-4 flex gap-2 flex-shrink-0"
          style={{ borderTop: '1px solid #F0E6C8' }}>
          <button onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-black text-sm transition-all"
            style={{ backgroundColor: '#F9D548', color: '#4A2C0A' }}>
            <Share2 className="w-4 h-4" />
            Share Card
          </button>
        </div>
      </div>
    </div>
  )
}
