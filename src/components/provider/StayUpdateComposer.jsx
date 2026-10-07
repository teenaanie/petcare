// Posting a stay update, from the note card it belongs to.
//
// The note is the only handle this shell has on a pet, so the composer lives on
// the note rather than anywhere else — there is no pet picker because there is
// no pet list to pick from, and that is the access model working rather than a
// missing feature.
//
// Collapsed by default. A boarder with twelve dogs in should see twelve cards,
// not twelve open forms.

import { useState, useEffect } from 'react'
import { Camera, Send, Loader2, AlertCircle, Trash2, X } from 'lucide-react'
import { getSupabaseProvider } from '../../lib/supabase.js'
import { reportHandled } from '../../lib/errorReport.js'
import {
  postStayUpdate, getStayUpdatesForNote, deleteStayUpdate, signedPhotoUrl,
} from '../../lib/stayUpdates.js'

function Posted({ update, onRemoved }) {
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!update.photoPath) return
    let cancelled = false
    getSupabaseProvider()
      .then(s => signedPhotoUrl(s, update.photoPath))
      .then(u => { if (!cancelled) setUrl(u) })
      .catch(() => { /* a missing photo must not break the list */ })
    return () => { cancelled = true }
  }, [update.photoPath])

  async function remove() {
    if (!confirm('Take this update down? The owner will no longer see it.')) return
    setBusy(true)
    try {
      await deleteStayUpdate(await getSupabaseProvider(), update)
      onRemoved(update.id)
    } catch (e) {
      reportHandled(e, { view: 'stay-update-delete' })
      alert(e.message || 'Could not remove that.')
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl p-2.5 text-xs" style={{ backgroundColor: '#fffef8', border: '1px solid #f0e6c8' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {update.body && <p className="whitespace-pre-wrap" style={{ color: '#4A2C0A' }}>{update.body}</p>}
          {url && <img src={url} alt="" className="mt-2 rounded-lg max-h-40" />}
        </div>
        <button onClick={remove} disabled={busy} title="Take down"
          className="p-1 rounded-lg shrink-0" style={{ color: '#c0392b', opacity: busy ? 0.4 : 1 }}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export default function StayUpdateComposer({ note, postedBy }) {
  const [open, setOpen]       = useState(false)
  const [body, setBody]       = useState('')
  const [file, setFile]       = useState(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)
  const [posted, setPosted]   = useState([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const rows = await getStayUpdatesForNote(await getSupabaseProvider(), note.id)
        if (!cancelled) setPosted(rows)
      } catch (e) { if (!cancelled) reportHandled(e, { view: 'stay-updates' }) }
    })()
    return () => { cancelled = true }
  }, [open, note.id])

  async function send() {
    if (busy || (!body.trim() && !file)) return
    setBusy(true); setError(null)
    try {
      const supabase = await getSupabaseProvider()
      const row = await postStayUpdate(supabase, {
        noteId: note.id, providerId: note.providerId, petId: note.petId,
        postedBy, body, file,
      })
      setPosted(p => [row, ...p])
      setBody(''); setFile(null)
      // Telling the owner is the whole point, and it must not be able to fail
      // the post: the update is already saved and visible to them in the app.
      const { data: { session } } = await supabase.auth.getSession()
      fetch('/api/provider-mail?op=stay-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ updateId: row.id }),
      }).catch(() => { /* the owner still sees it in the app */ })
    } catch (e) {
      reportHandled(e, { view: 'stay-update-post' })
      setError(e.message || 'Could not post that.')
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="text-xs font-bold mt-3 flex items-center gap-1.5"
        style={{ color: '#b08d57' }}>
        <Camera className="w-3.5 h-3.5" /> Post an update
      </button>
    )
  }

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid #f5f0e0' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold" style={{ color: '#7a4900' }}>
          Update {note.petLabel?.split(',')[0] || 'this pet'}&apos;s owner
        </p>
        <button onClick={() => setOpen(false)} style={{ color: '#73775b' }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-xs mb-2" style={{ color: '#c0392b' }}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{error}
        </p>
      )}

      <textarea value={body} onChange={e => setBody(e.target.value)} rows={2}
        maxLength={600} className="input w-full text-sm"
        placeholder="She ate everything and slept on the sofa." disabled={busy} />

      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs font-bold px-2.5 py-1.5 rounded-lg cursor-pointer flex items-center gap-1.5"
          style={{ backgroundColor: '#f5f0e0', color: '#7a4900' }}>
          <Camera className="w-3.5 h-3.5" /> {file ? 'Photo added' : 'Add a photo'}
          <input type="file" accept="image/*" className="hidden" disabled={busy}
            onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>
        {file && (
          <button onClick={() => setFile(null)} className="text-xs" style={{ color: '#73775b' }}>
            remove
          </button>
        )}
        <button onClick={send} disabled={busy || (!body.trim() && !file)}
          className="ml-auto text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
          style={{ backgroundColor: '#ffde59', color: '#7a4900',
                   opacity: busy || (!body.trim() && !file) ? 0.5 : 1 }}>
          {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Posting…</>
                : <><Send className="w-3.5 h-3.5" /> Post</>}
        </button>
      </div>

      {posted.length > 0 && (
        <div className="mt-3 space-y-2">
          {posted.map(u => (
            <Posted key={u.id} update={u}
              onRemoved={id => setPosted(p => p.filter(x => x.id !== id))} />
          ))}
        </div>
      )}
    </div>
  )
}
