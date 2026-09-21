import { useState, useEffect } from 'react'
import { AlertTriangle, X, Loader2, Download, Trash2, Check } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import {
  getPets, getMedicalHistory, getVaccinations, getAllergies, getReminders,
  getWeightLogs, getMedicines, getBills, getBoardingTrips,
} from '../lib/storage.js'
import { getConditions, getNotes, signedUrls } from '../lib/conditions.js'

// Deleting an account is the one action in this app that cannot be undone and
// that destroys data the user may have spent years collecting — a pet's whole
// medical history. So the flow is deliberately slow: show exactly what will go,
// offer to export it first, and require the word DELETE to be typed. The server
// checks for that word too, so a client bug cannot skip the step.

const PER_PET = [
  ['medical',    'Medical records',  getMedicalHistory],
  ['vaccines',   'Vaccinations',     getVaccinations],
  ['medicines',  'Medicines',        getMedicines],
  ['bills',      'Bills',            getBills],
  ['weights',    'Weight readings',  getWeightLogs],
  ['allergies',  'Allergies',        getAllergies],
  ['reminders',  'Reminders',        getReminders],
  ['boarding',   'Boarding trips',   getBoardingTrips],
]

// Not fetched through PER_PET because a condition has notes underneath it.
const EXTRA_ROWS = [
  ['conditions', 'Condition threads'],
  ['photos',     'Condition photos'],
]

// Gathers everything through the normal per-pet getters, which read only what
// row-level security already allows this user to see.
async function gatherEverything() {
  const pets = await getPets()
  const out = { exportedAt: new Date().toISOString(), pets: [] }
  const totals = { pets: pets.length }

  for (const pet of pets) {
    const entry = { pet }
    for (const [key, , fn] of PER_PET) {
      let rows = []
      try { rows = (await fn(pet.id)) || [] } catch { rows = [] }
      entry[key] = rows
      totals[key] = (totals[key] || 0) + rows.length
    }

    // Condition threads, with each observation's photos as signed links.
    // The images themselves are files in storage, not JSON — embedding them
    // would produce an export too large to open. The links work for an hour,
    // which is stated in the UI so nobody discovers it a week later.
    try {
      const conditions = await getConditions(pet.id)
      entry.conditions = []
      for (const c of conditions) {
        const notes = await getNotes(c.id)
        const urls  = await signedUrls(notes.flatMap(n => n.photoPaths)).catch(() => ({}))
        entry.conditions.push({
          ...c,
          notes: notes.map(n => ({ ...n, photoLinks: n.photoPaths.map(p => urls[p]).filter(Boolean) })),
        })
        totals.photos = (totals.photos || 0) + notes.reduce((a, n) => a + n.photoPaths.length, 0)
      }
      totals.conditions = (totals.conditions || 0) + conditions.length
    } catch {
      entry.conditions = []
    }

    out.pets.push(entry)
  }
  return { data: out, totals }
}

export default function DeleteAccount({ user, onClose, onDeleted }) {
  const [totals, setTotals]   = useState(null)
  const [shared, setShared]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [payload, setPayload] = useState(null)
  const [phrase, setPhrase]   = useState('')
  const [busy, setBusy]       = useState(false)
  const [exported, setExported] = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let alive = true
    gatherEverything()
      .then(async ({ data, totals }) => {
        if (!alive) return
        setPayload(data); setTotals(totals)
        // How many other people currently have access to these pets.
        try {
          const ids = data.pets.map(p => p.pet.id)
          if (ids.length && supabase) {
            const { count } = await supabase
              .from('pet_members').select('*', { count: 'exact', head: true }).in('pet_id', ids)
            if (alive) setShared(count || 0)
          }
        } catch { /* a count we cannot get is not worth blocking on */ }
      })
      .catch(e => alive && setError(`Could not read your data: ${e.message}`))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  function handleExport() {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `pippy-data-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setExported(true)
  }

  async function handleDelete() {
    setBusy(true); setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      if (!token) throw new Error('Your session has expired. Please sign in again.')

      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm: 'DELETE' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Server error ${res.status}`)

      // The account is gone; the local session is now meaningless.
      await supabase.auth.signOut().catch(() => {})
      onDeleted?.()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const rows  = totals ? [...PER_PET, ...EXTRA_ROWS].filter(([k]) => totals[k] > 0) : []
  const armed = phrase.trim().toUpperCase() === 'DELETE' && !busy && !loading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>

        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #ebe3d3' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" style={{ color: '#c0392b' }} />
            <span className="font-black" style={{ color: '#c0392b' }}>Delete your account</span>
          </div>
          <button onClick={onClose} disabled={busy}>
            <X className="w-5 h-5" style={{ color: '#73775b' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-sm" style={{ color: '#7a4900' }}>
            This permanently deletes <strong>{user?.email || user?.phone || 'your account'}</strong> and
            everything in it. It cannot be undone, and we cannot recover it for you afterwards.
          </p>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6" style={{ color: '#73775b' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Checking what you have…
            </div>
          ) : (
            <>
              <div className="rounded-xl p-3 space-y-1" style={{ backgroundColor: '#fdeaea' }}>
                <p className="text-xs font-black uppercase tracking-wider mb-1.5" style={{ color: '#c0392b' }}>
                  What will be deleted
                </p>
                {totals?.pets ? (
                  <>
                    <p className="text-sm" style={{ color: '#7a4900' }}>
                      • {totals.pets} {totals.pets === 1 ? 'pet' : 'pets'}
                      {payload?.pets?.length ? ` — ${payload.pets.map(p => p.pet.name).join(', ')}` : ''}
                    </p>
                    {rows.map(([key, label]) => (
                      <p key={key} className="text-sm" style={{ color: '#7a4900' }}>
                        • {totals[key]} {label.toLowerCase()}
                      </p>
                    ))}
                  </>
                ) : (
                  <p className="text-sm" style={{ color: '#7a4900' }}>• No pets — just the account itself.</p>
                )}
              </div>

              {shared > 0 && (
                <p className="text-xs px-3 py-2 rounded-xl" style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
                  ⚠️ {shared} {shared === 1 ? 'person' : 'people'} you shared with will lose access to
                  {totals?.pets === 1 ? ' this pet' : ' these pets'} as well.
                </p>
              )}

              <button onClick={handleExport} disabled={!payload}
                className="btn-secondary w-full gap-2 text-sm flex items-center justify-center">
                {exported ? <><Check className="w-4 h-4" /> Downloaded</> : <><Download className="w-4 h-4" /> Download my data first</>}
              </button>
              <p className="text-xs text-center" style={{ color: '#73775b' }}>
                Saves everything above as a JSON file. Worth doing — this is your only copy afterwards.
                {totals?.photos ? ' Condition photos are linked rather than embedded, and those links stop working after an hour, so save the images too.' : ''}
              </p>

              <div className="space-y-2 pt-1">
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>
                  Type DELETE to confirm
                </label>
                <input
                  className="input w-full text-sm"
                  placeholder="DELETE"
                  value={phrase}
                  onChange={e => setPhrase(e.target.value)}
                  autoComplete="off"
                  disabled={busy}
                />
              </div>

              {error && (
                <p className="text-sm p-3 rounded-xl" style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
                  {error}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={onClose} disabled={busy} className="btn-secondary flex-1 text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={!armed}
                  className="flex-1 text-sm font-bold rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 transition-colors"
                  style={{
                    backgroundColor: armed ? '#c0392b' : '#e4c9c5',
                    color: '#fff',
                    cursor: armed ? 'pointer' : 'not-allowed',
                  }}>
                  {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</>
                        : <><Trash2 className="w-4 h-4" /> Delete forever</>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
