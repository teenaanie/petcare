import { useState, useEffect, useRef } from 'react'
import {
  Camera, Upload, Plus, X, Loader2, Trash2, Pencil, ChevronLeft, AlertCircle,
  CircleDot, Eye, CheckCircle2, CalendarDays, ImageOff,
} from 'lucide-react'
import { format, parseISO, isValid, differenceInCalendarDays } from 'date-fns'
import {
  getConditions, saveCondition, deleteCondition,
  getNotes, saveNote, deleteNote,
  uploadPhoto, signedUrls, STATUSES,
} from '../lib/conditions.js'

const TODAY = () => new Date().toISOString().split('T')[0]

const STATUS_META = {
  active:     { label: 'Active',     icon: CircleDot,   bg: '#fdeaea', fg: '#c0392b' },
  monitoring: { label: 'Monitoring', icon: Eye,         bg: '#fff3c0', fg: '#9a6b12' },
  resolved:   { label: 'Resolved',   icon: CheckCircle2,bg: '#eef3e2', fg: '#44562a' },
}

const fmt = d => {
  if (!d) return ''
  try { const p = parseISO(d); return isValid(p) ? format(p, 'd MMM yyyy') : d } catch { return d }
}

function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.active
  const Icon = m.icon
  return (
    <span className="text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"
      style={{ backgroundColor: m.bg, color: m.fg }}>
      <Icon className="w-2.5 h-2.5" /> {m.label}
    </span>
  )
}

// ── One photo, fetched through a signed URL ──────────────────────────────────

function Photo({ url, onOpen }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    return (
      <div className="w-20 h-20 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: '#f2ece1' }} title="This photo could not be loaded">
        <ImageOff className="w-4 h-4" style={{ color: '#a08f7a' }} />
      </div>
    )
  }
  return (
    <button onClick={() => onOpen(url)} className="flex-shrink-0">
      <img src={url} alt="" loading="lazy" onError={() => setFailed(true)}
        className="w-20 h-20 rounded-xl object-cover"
        style={{ border: '1.5px solid #ebe3d3' }} />
    </button>
  )
}

// ── Add or edit a dated observation ──────────────────────────────────────────

function NoteForm({ condition, petId, existing, onSaved, onCancel }) {
  const [observedOn, setObservedOn]   = useState(existing?.observedOn || TODAY())
  const [description, setDescription] = useState(existing?.description || '')
  const [paths, setPaths]             = useState(existing?.photoPaths || [])
  const [urls, setUrls]               = useState({})
  const [uploading, setUploading]     = useState(0)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState(null)
  const cameraRef = useRef(null)
  const fileRef   = useRef(null)

  useEffect(() => {
    if (!paths.length) { setUrls({}); return }
    let alive = true
    signedUrls(paths).then(u => alive && setUrls(u)).catch(() => {})
    return () => { alive = false }
  }, [paths])

  async function handleFiles(list) {
    const files = Array.from(list || []).filter(f => f.type.startsWith('image/'))
    if (!files.length) return
    setError(null)
    setUploading(u => u + files.length)
    for (const f of files) {
      try {
        const path = await uploadPhoto(petId, condition.id, f)
        setPaths(p => [...p, path])
      } catch (e) {
        setError(`Could not upload ${f.name}: ${e.message}`)
      } finally {
        setUploading(u => u - 1)
      }
    }
  }

  // Removing a just-added photo drops it from this note only. The file itself
  // is tidied when the note or thread is deleted — deleting it here would lose
  // it irrecoverably if the user then cancels.
  const dropPhoto = p => setPaths(ps => ps.filter(x => x !== p))

  async function save() {
    setSaving(true); setError(null)
    try {
      await saveNote({ id: existing?.id, conditionId: condition.id, observedOn, description, photoPaths: paths })
      onSaved()
    } catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: '#fff9e0', border: '1.5px solid #f2b83d' }}>
      <div className="flex items-center justify-between">
        <span className="font-black text-sm" style={{ color: '#7a4900' }}>
          {existing ? 'Edit this observation' : 'New observation'}
        </span>
        <button onClick={onCancel}><X className="w-4 h-4" style={{ color: '#73775b' }} /></button>
      </div>

      <div>
        <label className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>
          When did you see this?
        </label>
        <input type="date" className="input w-full text-sm mt-1" value={observedOn} max={TODAY()}
          onChange={e => setObservedOn(e.target.value)} />
      </div>

      <textarea className="input w-full text-sm" rows={3}
        placeholder="What does it look like? Bigger, smaller, colour, is she licking it…"
        value={description} onChange={e => setDescription(e.target.value)} />

      <div className="flex gap-2">
        <button onClick={() => cameraRef.current?.click()} className="btn-secondary flex-1 text-sm gap-1.5">
          <Camera className="w-4 h-4" /> Camera
        </button>
        <button onClick={() => fileRef.current?.click()} className="btn-secondary flex-1 text-sm gap-1.5">
          <Upload className="w-4 h-4" /> Upload
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
      </div>

      {(paths.length > 0 || uploading > 0) && (
        <div className="flex gap-2 flex-wrap">
          {paths.map(p => (
            <div key={p} className="relative">
              <Photo url={urls[p]} onOpen={u => window.open(u, '_blank')} />
              <button onClick={() => dropPhoto(p)}
                className="absolute -top-1.5 -right-1.5 rounded-full p-0.5 shadow"
                style={{ backgroundColor: '#c0392b' }} title="Remove from this note">
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
          {uploading > 0 && (
            <div className="w-20 h-20 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: '#f2ece1' }}>
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#c9891f' }} />
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs p-2 rounded-lg flex items-start gap-1.5"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {error}
        </p>
      )}

      <div className="flex gap-2">
        <button onClick={onCancel} className="btn-secondary flex-1 text-sm">Cancel</button>
        <button onClick={save} disabled={saving || uploading > 0} className="btn-primary flex-1 text-sm gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {uploading > 0 ? 'Uploading…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── One thread, opened ───────────────────────────────────────────────────────

function ConditionDetail({ condition, petId, onBack, onChanged }) {
  const [notes, setNotes]   = useState([])
  const [urls, setUrls]     = useState({})
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [error, setError]   = useState(null)

  function load() {
    setLoading(true)
    getNotes(condition.id)
      .then(async ns => {
        setNotes(ns)
        const all = ns.flatMap(n => n.photoPaths)
        if (all.length) setUrls(await signedUrls(all).catch(() => ({})))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [condition.id])

  async function removeNote(n) {
    if (!confirm('Delete this observation and its photos? This cannot be undone.')) return
    try { await deleteNote(n); load(); onChanged?.() }
    catch (e) { setError(e.message) }
  }

  async function setStatus(status) {
    try { await saveCondition({ ...condition, status }); onChanged?.(true) }
    catch (e) { setError(e.message) }
  }

  const span = notes.length > 1
    ? differenceInCalendarDays(parseISO(notes[0].observedOn), parseISO(notes[notes.length - 1].observedOn))
    : 0

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold" style={{ color: '#7a4900' }}>
        <ChevronLeft className="w-4 h-4" /> All conditions
      </button>

      <div className="rounded-2xl p-4" style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-black" style={{ color: '#7a4900' }}>{condition.title}</h2>
              <StatusPill status={condition.status} />
            </div>
            <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>
              {[condition.bodyPart, `started ${fmt(condition.startedOn)}`].filter(Boolean).join(' · ')}
              {condition.resolvedOn ? ` · resolved ${fmt(condition.resolvedOn)}` : ''}
            </p>
            {notes.length > 1 && (
              <p className="text-xs mt-1" style={{ color: '#44562a' }}>
                {notes.length} observations over {span} day{span === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-1.5 mt-3 flex-wrap">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(s)} disabled={s === condition.status}
              className="text-xs font-bold px-2.5 py-1 rounded-full"
              style={s === condition.status
                ? { backgroundColor: STATUS_META[s].bg, color: STATUS_META[s].fg, opacity: 1 }
                : { backgroundColor: '#f2ece1', color: '#73775b' }}>
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm p-3 rounded-xl flex items-start gap-2"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {adding ? (
        <NoteForm condition={condition} petId={petId}
          onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load(); onChanged?.() }} />
      ) : (
        <button onClick={() => setAdding(true)} className="btn-primary w-full text-sm gap-2">
          <Camera className="w-4 h-4" /> Add today's photo
        </button>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 justify-center" style={{ color: '#73775b' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : notes.length === 0 && !adding ? (
        <p className="text-sm text-center py-6" style={{ color: '#73775b' }}>
          Nothing recorded yet. Add a photo now so there's something to compare against later.
        </p>
      ) : (
        <div className="space-y-3">
          {notes.map(n => editing === n.id ? (
            <NoteForm key={n.id} condition={condition} petId={petId} existing={n}
              onCancel={() => setEditing(null)}
              onSaved={() => { setEditing(null); load(); onChanged?.() }} />
          ) : (
            <div key={n.id} className="rounded-2xl p-3"
              style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-black flex items-center gap-1.5" style={{ color: '#c9891f' }}>
                  <CalendarDays className="w-3.5 h-3.5" /> {fmt(n.observedOn)}
                </p>
                <div className="flex gap-1">
                  <button onClick={() => setEditing(n.id)} className="p-1 rounded hover:bg-amber-50">
                    <Pencil className="w-3.5 h-3.5" style={{ color: '#73775b' }} />
                  </button>
                  <button onClick={() => removeNote(n)} className="p-1 rounded hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" style={{ color: '#c88' }} />
                  </button>
                </div>
              </div>
              {n.description && (
                <p className="text-sm mt-1" style={{ color: '#7a4900' }}>{n.description}</p>
              )}
              {n.photoPaths.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {n.photoPaths.map(p => (
                    <Photo key={p} url={urls[p]} onOpen={u => window.open(u, '_blank')} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── New thread ───────────────────────────────────────────────────────────────

function NewCondition({ petId, onSaved, onCancel }) {
  const [title, setTitle]       = useState('')
  const [bodyPart, setBodyPart] = useState('')
  const [startedOn, setStarted] = useState(TODAY())
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)

  async function save() {
    setSaving(true); setError(null)
    try { onSaved(await saveCondition({ petId, title, bodyPart, startedOn, status: 'active' })) }
    catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: '#fff9e0', border: '1.5px solid #f2b83d' }}>
      <div className="flex items-center justify-between">
        <span className="font-black text-sm" style={{ color: '#7a4900' }}>What are you keeping an eye on?</span>
        <button onClick={onCancel}><X className="w-4 h-4" style={{ color: '#73775b' }} /></button>
      </div>
      <input autoFocus className="input w-full text-sm" placeholder="e.g. Left paw infection"
        value={title} onChange={e => setTitle(e.target.value)} />
      <input className="input w-full text-sm" placeholder="Where on the body? (optional)"
        value={bodyPart} onChange={e => setBodyPart(e.target.value)} />
      <div>
        <label className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>
          First noticed
        </label>
        <input type="date" className="input w-full text-sm mt-1" value={startedOn} max={TODAY()}
          onChange={e => setStarted(e.target.value)} />
      </div>
      {error && <p className="text-xs p-2 rounded-lg" style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>{error}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="btn-secondary flex-1 text-sm">Cancel</button>
        <button onClick={save} disabled={saving || !title.trim()} className="btn-primary flex-1 text-sm gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Start
        </button>
      </div>
    </div>
  )
}

// ── The screen ───────────────────────────────────────────────────────────────

export default function ConditionJournal({ pet }) {
  const [rows, setRows]       = useState([])
  const [covers, setCovers]   = useState({})   // conditionId -> signed url
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [creating, setCreating] = useState(false)
  const [open, setOpen]       = useState(null)

  async function load(keepOpen) {
    setLoading(true)
    try {
      const cs = await getConditions(pet.id)
      setRows(cs)
      if (keepOpen && open) setOpen(cs.find(c => c.id === open.id) || null)

      // One thumbnail per thread — the most recent photo, which is the one that
      // says what it looks like now.
      const latest = {}
      for (const c of cs) {
        const ns = await getNotes(c.id)
        const withPhoto = ns.find(n => n.photoPaths.length)
        if (withPhoto) latest[c.id] = withPhoto.photoPaths[0]
      }
      const urls = await signedUrls(Object.values(latest)).catch(() => ({}))
      setCovers(Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, urls[v]])))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [pet.id])

  async function remove(c) {
    if (!confirm(`Delete “${c.title}” and every photo in it? This cannot be undone.`)) return
    try { await deleteCondition(c); setOpen(null); load() }
    catch (e) { setError(e.message) }
  }

  if (open) {
    return (
      <ConditionDetail condition={open} petId={pet.id}
        onBack={() => { setOpen(null); load() }}
        onChanged={keep => load(keep)} />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black" style={{ color: '#7a4900' }}>Photo journal</h2>
          <p className="text-sm" style={{ color: '#73775b' }}>
            Track a lump, rash or limp over time — so you can show your vet how it looked three weeks ago.
          </p>
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} className="btn-primary text-sm gap-1.5 flex-shrink-0">
            <Plus className="w-4 h-4" /> New
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm p-3 rounded-xl flex items-start gap-2"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {creating && (
        <NewCondition petId={pet.id} onCancel={() => setCreating(false)}
          onSaved={c => { setCreating(false); setOpen(c); }} />
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center" style={{ color: '#73775b' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 && !creating ? (
        <div className="text-center py-10 px-4 rounded-2xl" style={{ backgroundColor: '#fff9e0' }}>
          <Camera className="w-8 h-8 mx-auto mb-2" style={{ color: '#c9891f' }} />
          <p className="font-bold text-sm" style={{ color: '#7a4900' }}>Nothing being tracked</p>
          <p className="text-sm mt-1" style={{ color: '#73775b' }}>
            Next time you notice something — a lump, a hot spot, a limp — photograph it here.
            A month of dated photos tells a vet far more than trying to remember.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(c => (
            <div key={c.id} className="rounded-2xl p-3 flex items-center gap-3"
              style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>
              <button onClick={() => setOpen(c)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                {covers[c.id]
                  ? <img src={covers[c.id]} alt="" loading="lazy" className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
                      style={{ border: '1.5px solid #ebe3d3' }} />
                  : <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: '#f2ece1' }}>
                      <Camera className="w-4 h-4" style={{ color: '#a08f7a' }} />
                    </div>}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-bold text-sm truncate" style={{ color: '#7a4900' }}>{c.title}</p>
                    <StatusPill status={c.status} />
                  </div>
                  <p className="text-xs truncate" style={{ color: '#73775b' }}>
                    {[c.bodyPart, `from ${fmt(c.startedOn)}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </button>
              <button onClick={() => remove(c)} className="p-1.5 rounded-lg hover:bg-red-50 flex-shrink-0">
                <Trash2 className="w-3.5 h-3.5" style={{ color: '#c88' }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
