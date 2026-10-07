// What the boarder sent back, on the customer's pet screen.
//
// This is the only place in the app where someone else's words appear under a
// pet, so it says who wrote them and when, every time. Rendered above the tabs
// rather than inside one: a photo of your dog from the kennel is the thing you
// opened the app for, and burying it under "Timeline" would be a strange
// reading of why this feature exists.
//
// Read-only by construction. stay_updates grants the pet's household SELECT and
// nothing else — a customer cannot edit or delete the provider's account of the
// stay, which is what makes it an account rather than a shared document.

import { useState, useEffect } from 'react'
import { Camera } from 'lucide-react'
import { getSupabase } from '../lib/supabase.js'
import { reportHandled } from '../lib/errorReport.js'
import { getStayUpdatesForPet, signedPhotoUrl } from '../lib/stayUpdates.js'

function Photo({ path }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    getSupabase().then(s => signedPhotoUrl(s, path))
      .then(u => { if (!cancelled) setUrl(u) })
      .catch(() => { /* a missing photo must not break the list */ })
    return () => { cancelled = true }
  }, [path])
  if (!url) {
    return (
      <div className="mt-2 rounded-xl flex items-center justify-center h-32"
        style={{ backgroundColor: '#f5f0e0', color: '#b08d57' }}>
        <Camera className="w-5 h-5" />
      </div>
    )
  }
  return <img src={url} alt="" className="mt-2 rounded-xl max-h-72 w-full object-cover" />
}

function when(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function StayUpdates({ petId, petName }) {
  const [updates, setUpdates] = useState([])

  useEffect(() => {
    if (!petId) return
    let cancelled = false
    ;(async () => {
      try {
        const rows = await getStayUpdatesForPet(await getSupabase(), petId)
        if (!cancelled) setUpdates(rows)
      } catch (e) {
        // Nothing here is load-bearing for the rest of the pet screen.
        if (!cancelled) reportHandled(e, { view: 'stay-updates' })
      }
    })()
    return () => { cancelled = true }
  }, [petId])

  if (updates.length === 0) return null

  return (
    <div className="card mb-4">
      <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#b08d57' }}>
        Updates on {petName || 'your pet'}
      </p>
      <div className="space-y-4">
        {updates.map(u => (
          <div key={u.id}>
            <p className="text-xs mb-1" style={{ color: '#73775b' }}>{when(u.createdAt)}</p>
            {u.body && <p className="text-sm whitespace-pre-wrap" style={{ color: '#4A2C0A' }}>{u.body}</p>}
            {u.photoPath && <Photo path={u.photoPath} />}
          </div>
        ))}
      </div>
    </div>
  )
}
