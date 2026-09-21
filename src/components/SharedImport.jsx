import { useState, useEffect } from 'react'
import { X, Loader2, PawPrint, Share2, AlertCircle } from 'lucide-react'
import { getPets } from '../lib/storage.js'
import DocumentScanner from './DocumentScanner.jsx'

// Somebody shared vet papers into Pippy from WhatsApp or their camera roll.
//
// A shared file carries no pet with it, and the scanner is per-pet — so the
// only thing between the share and the scanner is deciding whose records these
// are. One pet: decided already. Several: ask. None: say so plainly, because
// silently discarding files someone deliberately shared is the worst outcome
// available here.

export default function SharedImport({ files, session, onClose }) {
  const [pets, setPets]     = useState([])
  const [loading, setLoading] = useState(true)
  const [pet, setPet]       = useState(null)
  const [error, setError]   = useState(null)

  useEffect(() => {
    getPets()
      .then(p => {
        setPets(p)
        if (p.length === 1) setPet(p[0])   // no question worth asking
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (pet) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: '#FFFEF8' }}>
        <div className="max-w-2xl mx-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-black flex items-center gap-1.5" style={{ color: '#7a4900' }}>
              <Share2 className="w-4 h-4" />
              {files.length} shared {files.length === 1 ? 'document' : 'documents'} for {pet.name}
            </p>
            <button onClick={onClose}><X className="w-5 h-5" style={{ color: '#73775b' }} /></button>
          </div>
          <DocumentScanner pet={pet} session={session} initialFiles={files} />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: '#FFFEF8' }}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid #ebe3d3' }}>
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5" style={{ color: '#c9891f' }} />
            <span className="font-black" style={{ color: '#7a4900' }}>
              {files.length} shared {files.length === 1 ? 'document' : 'documents'}
            </span>
          </div>
          <button onClick={onClose}><X className="w-5 h-5" style={{ color: '#73775b' }} /></button>
        </div>

        <div className="p-5 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 py-4 justify-center" style={{ color: '#73775b' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <p className="text-sm p-3 rounded-xl flex items-start gap-2"
              style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </p>
          ) : pets.length === 0 ? (
            <>
              <p className="text-sm" style={{ color: '#7a4900' }}>
                There's no pet to file these against yet. Add one first, then share them again —
                they'll be waiting in WhatsApp.
              </p>
              <button onClick={onClose} className="btn-primary w-full text-sm">Add a pet</button>
            </>
          ) : (
            <>
              <p className="text-sm" style={{ color: '#73775b' }}>Whose records are these?</p>
              {pets.map(p => (
                <button key={p.id} onClick={() => setPet(p)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors hover:brightness-95"
                  style={{ backgroundColor: '#fff9e0' }}>
                  <PawPrint className="w-4 h-4 flex-shrink-0" style={{ color: '#c9891f' }} />
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: '#7a4900' }}>{p.name}</p>
                    <p className="text-xs truncate" style={{ color: '#73775b' }}>
                      {[p.species, p.breed].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
