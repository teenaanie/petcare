import { useState, useEffect, useRef } from 'react'
import {
  Plus, Search, Star, Phone, MessageCircle, Globe, MapPin, Pencil, Trash2,
  X, Loader2, Check, Stethoscope, Scissors, ShoppingBag, Home, Camera,
  Flower2, Dog, GraduationCap, Heart, AlertCircle,
} from 'lucide-react'
import { PROVIDER_TYPES } from '../lib/taxonomy.js'
import { getProviders, getPets } from '../lib/storage.js'
import {
  getMyProviders, saveMyProvider, deleteMyProvider, setPrimary,
  fromDirectory, whatsappLink, telLink,
} from '../lib/myProviders.js'

const ICONS = {
  'Vet': Stethoscope, 'Groomer': Scissors, 'Store': ShoppingBag, 'Boarder': Home,
  'Dog Walking': Dog, 'Training': GraduationCap, 'Pet Sitting': Heart,
  'Special Services': Camera, 'Pet Loss & Memorial Services': Flower2,
}
const COLORS = {
  'Vet': '#2f7286', 'Groomer': '#b2566f', 'Store': '#5f7a3a', 'Boarder': '#c9891f',
  'Dog Walking': '#7a5c9e', 'Training': '#3f7a5f', 'Pet Sitting': '#c0563d',
  'Special Services': '#c0563d', 'Pet Loss & Memorial Services': '#5f624b',
}

const BLANK = {
  category: 'Vet', name: '', phone: '', whatsapp: '', email: '',
  address: '', website: '', nickname: '', notes: '', isPrimary: false,
  providerId: null, petId: null,
}

// ── Add: search the directory, or type it in ─────────────────────────────────

function AddPanel({ pets, onSaved, onClose }) {
  const [tab, setTab]         = useState('search')   // search | manual
  const [q, setQ]             = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [form, setForm]       = useState(BLANK)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const seq = useRef(0)

  // Debounced, and guarded by a sequence number so a slow early response cannot
  // overwrite the results of a later, faster one.
  useEffect(() => {
    if (tab !== 'search' || q.trim().length < 2) { setResults([]); return }
    const mine = ++seq.current
    setSearching(true)
    const t = setTimeout(() => {
      getProviders({ search: q.trim(), limit: 8 })
        .then(({ rows }) => { if (mine === seq.current) setResults(rows) })
        .catch(() => { if (mine === seq.current) setResults([]) })
        .finally(() => { if (mine === seq.current) setSearching(false) })
    }, 300)
    return () => clearTimeout(t)
  }, [q, tab])

  async function add(entry) {
    setSaving(true); setError(null)
    try { await saveMyProvider(entry); onSaved() }
    catch (e) { setError(e.message); setSaving(false) }
  }

  const petOptions = (
    <select className="input text-sm" value={form.petId || ''}
      onChange={e => setForm(f => ({ ...f, petId: e.target.value || null }))}>
      <option value="">Everyone in the household</option>
      {pets.map(p => <option key={p.id} value={p.id}>Only {p.name}</option>)}
    </select>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>

        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #ebe3d3' }}>
          <span className="font-black" style={{ color: '#7a4900' }}>Add a provider</span>
          <button onClick={onClose}><X className="w-5 h-5" style={{ color: '#73775b' }} /></button>
        </div>

        <div className="flex gap-2 px-5 pt-4 flex-shrink-0">
          {[['search', 'Search the directory'], ['manual', 'Type it in']].map(([id, label]) => (
            <button key={id} onClick={() => { setTab(id); setError(null) }}
              className="text-xs font-bold px-3 py-1.5 rounded-full"
              style={tab === id
                ? { backgroundColor: '#f2b83d', color: '#7a4900' }
                : { backgroundColor: '#ebe3d3', color: '#7a4900' }}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {tab === 'search' ? (
            <>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#a08f7a' }} />
                <input autoFocus className="input w-full text-sm pl-9" placeholder="Clinic, groomer, shop…"
                  value={q} onChange={e => setQ(e.target.value)} />
              </div>

              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>Applies to</label>
                <div className="mt-1">{petOptions}</div>
              </div>

              {searching && (
                <div className="flex items-center gap-2 text-sm py-3" style={{ color: '#73775b' }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> Searching…
                </div>
              )}

              {!searching && q.trim().length >= 2 && results.length === 0 && (
                <div className="text-sm p-3 rounded-xl" style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
                  Nothing found for “{q.trim()}”. Use <strong>Type it in</strong> to add them yourself —
                  it stays private to you.
                </div>
              )}

              {results.map(r => {
                const Icon = ICONS[r.type] || ShoppingBag
                return (
                  <button key={r.id} disabled={saving}
                    onClick={() => add({ ...fromDirectory(r, { petId: form.petId }) })}
                    className="w-full text-left p-3 rounded-xl flex items-start gap-3 transition-colors hover:brightness-95"
                    style={{ backgroundColor: '#fff9e0' }}>
                    <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: COLORS[r.type] || '#7a4900' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate" style={{ color: '#7a4900' }}>{r.name}</p>
                      <p className="text-xs truncate" style={{ color: '#73775b' }}>
                        {[r.type, r.area].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Plus className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#c9891f' }} />
                  </button>
                )
              })}
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>Type</label>
                <select className="input w-full text-sm mt-1" value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {PROVIDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <input className="input w-full text-sm" placeholder="Name *" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <input className="input w-full text-sm" placeholder="Phone" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              <input className="input w-full text-sm" placeholder="WhatsApp (if different)" value={form.whatsapp}
                onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} />
              <input className="input w-full text-sm" placeholder="Address" value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              <textarea className="input w-full text-sm" rows={2} placeholder="Notes — parking, who to ask for…"
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>Applies to</label>
                <div className="mt-1">{petOptions}</div>
              </div>
              <p className="text-xs" style={{ color: '#73775b' }}>
                Saved to your list only. It is not added to the public directory.
              </p>
              <button className="btn-primary w-full text-sm gap-2" disabled={saving || !form.name.trim()}
                onClick={() => add(form)}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
              </button>
            </>
          )}

          {error && (
            <p className="text-sm p-3 rounded-xl flex items-start gap-2"
              style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Edit: your copy, never the shared directory row ──────────────────────────

function EditPanel({ entry, pets, onSaved, onClose }) {
  const [form, setForm]   = useState(entry)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const fromDir = !!entry.providerId

  async function save() {
    setSaving(true); setError(null)
    try { await saveMyProvider(form); onSaved() }
    catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: '#FFFEF8', maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #ebe3d3' }}>
          <span className="font-black truncate" style={{ color: '#7a4900' }}>{entry.name}</span>
          <button onClick={onClose}><X className="w-5 h-5" style={{ color: '#73775b' }} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {fromDir && (
            <p className="text-xs px-3 py-2 rounded-xl" style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
              From the directory. Changes here apply to <strong>your copy only</strong> — the
              public listing other people see is not affected.
            </p>
          )}

          <div>
            <label className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>Type</label>
            <select className="input w-full text-sm mt-1" value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {PROVIDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <input className="input w-full text-sm" placeholder="Name" value={form.name || ''}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className="input w-full text-sm" placeholder="Your name for them (optional)" value={form.nickname || ''}
            onChange={e => setForm(f => ({ ...f, nickname: e.target.value }))} />
          <input className="input w-full text-sm" placeholder="Phone" value={form.phone || ''}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          <input className="input w-full text-sm" placeholder="WhatsApp" value={form.whatsapp || ''}
            onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} />
          <input className="input w-full text-sm" placeholder="Address" value={form.address || ''}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          <textarea className="input w-full text-sm" rows={2} placeholder="Notes" value={form.notes || ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          <div>
            <label className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>Applies to</label>
            <select className="input w-full text-sm mt-1" value={form.petId || ''}
              onChange={e => setForm(f => ({ ...f, petId: e.target.value || null }))}>
              <option value="">Everyone in the household</option>
              {pets.map(p => <option key={p.id} value={p.id}>Only {p.name}</option>)}
            </select>
          </div>

          {error && (
            <p className="text-sm p-3 rounded-xl" style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
            <button onClick={save} disabled={saving || !(form.name || '').trim()} className="btn-primary flex-1 text-sm gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── One entry ────────────────────────────────────────────────────────────────

function Entry({ p, petName, onEdit, onDelete, onPrimary, busy }) {
  const wa  = whatsappLink(p)
  const tel = telLink(p)

  return (
    <div className="rounded-2xl p-3" style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-bold text-sm truncate" style={{ color: '#7a4900' }}>
              {p.nickname || p.name}
            </p>
            {p.isPrimary && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"
                style={{ backgroundColor: '#fff3c0', color: '#c9891f' }}>
                <Star className="w-2.5 h-2.5 fill-current" /> Primary
              </span>
            )}
            {petName && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#eef3e2', color: '#44562a' }}>
                {petName} only
              </span>
            )}
          </div>
          {p.nickname && <p className="text-xs truncate" style={{ color: '#73775b' }}>{p.name}</p>}
          {p.address && (
            <p className="text-xs mt-0.5 flex items-start gap-1" style={{ color: '#73775b' }}>
              <MapPin className="w-3 h-3 flex-shrink-0 mt-0.5" /> <span className="truncate">{p.address}</span>
            </p>
          )}
          {p.notes && <p className="text-xs mt-1 italic" style={{ color: '#73775b' }}>{p.notes}</p>}
        </div>

        <div className="flex gap-1 flex-shrink-0">
          {!p.isPrimary && (
            <button onClick={() => onPrimary(p)} disabled={busy} title="Make primary"
              className="p-1.5 rounded-lg hover:bg-amber-50">
              <Star className="w-3.5 h-3.5" style={{ color: '#a08f7a' }} />
            </button>
          )}
          <button onClick={() => onEdit(p)} title="Edit" className="p-1.5 rounded-lg hover:bg-amber-50">
            <Pencil className="w-3.5 h-3.5" style={{ color: '#73775b' }} />
          </button>
          <button onClick={() => onDelete(p)} title="Remove" className="p-1.5 rounded-lg hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5" style={{ color: '#c88' }} />
          </button>
        </div>
      </div>

      {(tel || wa || p.website) && (
        <div className="flex gap-2 mt-2.5 flex-wrap">
          {tel && (
            <a href={tel} className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: '#e8f0f3', color: '#255d6e' }}>
              <Phone className="w-3.5 h-3.5" /> Call
            </a>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: '#e7f5ec', color: '#276b45' }}>
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </a>
          )}
          {p.website && (
            <a href={p.website} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: '#f0ecf5', color: '#5c4a75' }}>
              <Globe className="w-3.5 h-3.5" /> Website
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ── The screen ───────────────────────────────────────────────────────────────

export default function MyProviders() {
  // Fetched here rather than passed down: App holds no pet list, and Sidebar
  // already loads its own the same way.
  const [pets, setPets]       = useState([])
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy]       = useState(false)

  function load() {
    setLoading(true)
    getMyProviders().then(setRows).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(load, [])
  useEffect(() => { getPets().then(setPets).catch(() => setPets([])) }, [])

  const petName = id => pets.find(p => p.id === id)?.name

  async function handleDelete(p) {
    if (!confirm(`Remove ${p.nickname || p.name} from your providers?`)) return
    setBusy(true)
    try { await deleteMyProvider(p.id); load() }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function handlePrimary(p) {
    setBusy(true)
    try { await setPrimary(p); load() }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  // Only render categories that have something in them — an empty column for
  // every one of the nine types is noise, not structure.
  const used = PROVIDER_TYPES.filter(t => rows.some(r => r.category === t))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black" style={{ color: '#7a4900' }}>My providers</h2>
          <p className="text-sm" style={{ color: '#73775b' }}>
            Your vets, boarders, groomers and shops — as many as you need.
          </p>
        </div>
        <button onClick={() => setAdding(true)} className="btn-primary text-sm gap-1.5 flex-shrink-0">
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {error && (
        <p className="text-sm p-3 rounded-xl flex items-start gap-2"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center" style={{ color: '#73775b' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 px-4 rounded-2xl" style={{ backgroundColor: '#fff9e0' }}>
          <Stethoscope className="w-8 h-8 mx-auto mb-2" style={{ color: '#c9891f' }} />
          <p className="font-bold text-sm" style={{ color: '#7a4900' }}>No providers yet</p>
          <p className="text-sm mt-1" style={{ color: '#73775b' }}>
            Search the directory for your vet or groomer, or type in one we don't have.
          </p>
          <button onClick={() => setAdding(true)} className="btn-primary text-sm gap-1.5 mt-4 mx-auto">
            <Plus className="w-4 h-4" /> Add your first
          </button>
        </div>
      ) : (
        used.map(cat => {
          const Icon = ICONS[cat] || ShoppingBag
          const inCat = rows.filter(r => r.category === cat)
          return (
            <div key={cat} className="space-y-2">
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" style={{ color: COLORS[cat] || '#7a4900' }} />
                <h3 className="font-black text-sm" style={{ color: '#7a4900' }}>{cat}</h3>
                <span className="text-xs" style={{ color: '#a08f7a' }}>{inCat.length}</span>
              </div>
              {inCat.map(p => (
                <Entry key={p.id} p={p} petName={petName(p.petId)} busy={busy}
                  onEdit={setEditing} onDelete={handleDelete} onPrimary={handlePrimary} />
              ))}
            </div>
          )
        })
      )}

      {adding && <AddPanel pets={pets} onClose={() => setAdding(false)}
        onSaved={() => { setAdding(false); load() }} />}
      {editing && <EditPanel entry={editing} pets={pets} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}
