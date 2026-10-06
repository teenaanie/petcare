import { useState, useEffect } from 'react'
import { Search, Loader2, AlertCircle, Check, Building2, ArrowLeft, Plus } from 'lucide-react'
import { getSupabaseProvider } from '../../lib/supabase.js'
import { PROVIDER_TYPES } from '../../lib/taxonomy.js'

// Claim your business, or add it if it is not listed.
//
// Two paths, one outcome: either way a provider_accounts row lands
// status='pending' and an admin approves it. Anyone could type "Unleash – The
// Dog Town" into a form, and a claim that approved itself would hand a stranger
// a real business's customer book.
//
// The second path is new and exists because the first one used to dead-end.
// 976 of the listings came from Google, so most businesses find themselves in
// the search. The ones Google missed used to get "Nothing matched" and a link
// to /register-provider — an anonymous form, on another page, that created a
// listing with no owner attached and no email, after which they had to come
// back here and claim it. Two forms, two waits, two approvals, and a bounce in
// the middle where nothing recorded that they had been here at all. Drop off
// there and all that remained was an orphan auth.users row.
//
// So the dead end became the capture point. register_and_claim_provider()
// writes the listing and the claim together for a caller who is already signed
// in, which means their address is on the claim from the first second and they
// appear in the review queue whether or not they ever come back.
//
// /register-provider is still there, unchanged, for anyone handed that link
// directly without signing in.

// The declared type drives what the shell shows later: a groomer has no trial
// run, no formalities checklist and a single-session visit. Boarders and
// groomers are the focus; a vet is accepted so the demand is captured, but
// nothing vet-specific is built.
const OFFERED_TYPES = ['Boarder', 'Groomer', 'Vet', ...PROVIDER_TYPES.filter(
  t => !['Boarder', 'Groomer', 'Vet'].includes(t)
)]

function Field({ name, label, placeholder, required, value, onChange }) {
  return (
    <div>
      <label className="label" style={{ color: '#7a4900' }} htmlFor={`biz-${name}`}>
        {label}{required ? '' : <span style={{ color: '#b08d57' }}> (optional)</span>}
      </label>
      <input id={`biz-${name}`} name={name} className="input" value={value}
        onChange={onChange} placeholder={placeholder} required={required} />
    </div>
  )
}

const EMPTY_BIZ = {
  name: '', phone: '', area: '', city: '', address: '',
  whatsapp: '', hours: '', description: '', maps_url: '',
}

export default function ProviderOnboarding({ email, onClaimed }) {
  const [mode, setMode]       = useState('search')   // search | add
  const [term, setTerm]       = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [type, setType]       = useState('Boarder')
  const [note, setNote]       = useState('')
  const [picked, setPicked]   = useState(null)
  const [biz, setBiz]         = useState(EMPTY_BIZ)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  // Debounced, and paged by the server: the directory is ~976 rows and
  // search_providers() already does the filtering, counting and paging in
  // Postgres. Fetching it all and filtering in the browser is what this RPC
  // exists to avoid.
  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const { data, error } = await (await getSupabaseProvider()).rpc('search_providers', {
          approved_only: false, filter_type: null, filter_area: null,
          search_term: q, page_limit: 12, page_offset: 0,
        })
        if (cancelled) return
        if (error) throw error
        setResults((data || []).map(r => r.provider))
      } catch (e) {
        if (!cancelled) setError(e.message || 'Search failed')
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [term])

  async function claim(providerId) {
    setSaving(true); setError(null)
    try {
      const { error } = await (await getSupabaseProvider()).rpc('claim_provider', {
        p_provider_id: providerId,
        p_claimed_type: type,
        p_note: note.trim() || null,
      })
      if (error) throw error
      onClaimed()
    } catch (e) {
      setError(e.message || 'Could not submit the claim. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // One call writes both rows. If it fails there is nothing half-created to
  // clean up — the function is a single transaction — so the only thing to do
  // here is show what it said. Its messages are written to be read by a
  // business owner, not decoded.
  async function addAndClaim(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError(null)
    try {
      const { error } = await (await getSupabaseProvider()).rpc('register_and_claim_provider', {
        p_name: biz.name, p_type: type, p_phone: biz.phone,
        p_area: biz.area || null, p_city: biz.city || null,
        p_address: biz.address || null, p_whatsapp: biz.whatsapp || null,
        p_hours: biz.hours || null, p_description: biz.description || null,
        p_maps_url: biz.maps_url || null,
      })
      if (error) throw error
      onClaimed()
    } catch (e) {
      setError(e.message || 'Could not add your business. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const set = e => setBiz(b => ({ ...b, [e.target.name]: e.target.value }))

  return (
    <div className="min-h-screen px-4 py-10" style={{ backgroundColor: '#FFFEF8' }}>
      <div className="w-full max-w-lg mx-auto">
        <h1 className="text-2xl font-black mb-1" style={{ color: '#7a4900', fontFamily: 'Nunito, sans-serif' }}>
          {mode === 'search' ? 'Find your business' : 'Add your business'}
        </h1>
        <p className="text-sm mb-6" style={{ color: '#b08d57' }}>
          Signed in as {email}. {mode === 'search'
            ? "Pick your listing and we'll review it — usually the same day."
            : "Tell us about it and we'll review it — usually the same day."}
        </p>

        {mode === 'search' ? (
          <div className="card">
            <label className="label" style={{ color: '#7a4900' }} htmlFor="claim-type">What do you do?</label>
            <select id="claim-type" className="input mb-5" value={type} onChange={e => setType(e.target.value)}>
              {OFFERED_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <label className="label" style={{ color: '#7a4900' }} htmlFor="claim-search">Your business name</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#b08d57' }} />
              <input id="claim-search" className="input pl-9" value={term} autoFocus
                onChange={e => setTerm(e.target.value)} placeholder="e.g. Unleash" />
            </div>

            {searching && (
              <p className="flex items-center gap-2 text-sm mt-4" style={{ color: '#b08d57' }}>
                <Loader2 size={14} className="animate-spin" /> Searching the directory…
              </p>
            )}

            {/* The old dead end. It now offers to take the details here rather
                than sending them to another page to start again. */}
            {!searching && term.trim().length >= 2 && results.length === 0 && (
              <div className="mt-4 rounded-xl p-3" style={{ backgroundColor: '#fffef8', border: '1px solid #f0e6c8' }}>
                <p className="text-sm mb-3" style={{ color: '#4A2C0A' }}>
                  Nothing matched <strong>{term.trim()}</strong>. If you&apos;re not listed yet,
                  add your business and we&apos;ll set it up with your account in one go.
                </p>
                <button type="button" className="btn-secondary"
                  onClick={() => { setBiz({ ...EMPTY_BIZ, name: term.trim() }); setError(null); setMode('add') }}>
                  <Plus size={14} className="mr-2" /> Add my business
                </button>
              </div>
            )}

            {results.length > 0 && (
              <ul className="mt-4 space-y-2">
                {results.map(p => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setPicked(p)}
                      className="w-full text-left rounded-xl px-3 py-2 border transition-all"
                      style={picked?.id === p.id
                        ? { borderColor: '#f2b83d', backgroundColor: '#fdf6e3' }
                        : { borderColor: '#f0e6c8', backgroundColor: 'white' }}>
                      <span className="flex items-start gap-2">
                        <Building2 size={15} className="mt-0.5 shrink-0" style={{ color: '#b08d57' }} />
                        <span className="min-w-0">
                          <span className="block text-sm font-bold truncate" style={{ color: '#4A2C0A' }}>{p.name}</span>
                          <span className="block text-xs truncate" style={{ color: '#b08d57' }}>
                            {[p.type, p.area, p.city].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        {picked?.id === p.id && <Check size={16} className="ml-auto shrink-0" style={{ color: '#7a4900' }} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {picked && (
              <div className="mt-5">
                <label className="label" style={{ color: '#7a4900' }} htmlFor="claim-note">
                  Anything that helps us confirm it&apos;s you? (optional)
                </label>
                <textarea id="claim-note" className="input" rows={2} value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="e.g. the landline on the listing is mine" />
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 mt-4 text-sm" style={{ color: '#b4453c' }}>
                <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
              </div>
            )}

            <button type="button" disabled={!picked || saving} onClick={() => claim(picked.id)}
              className="btn-primary w-full justify-center mt-6"
              style={!picked || saving ? { opacity: 0.5 } : undefined}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : 'Claim this business'}
            </button>
          </div>
        ) : (
          <form className="card" onSubmit={addAndClaim}>
            <button type="button" onClick={() => { setMode('search'); setError(null) }}
              className="flex items-center gap-1 text-sm font-semibold mb-4" style={{ color: '#b08d57' }}>
              <ArrowLeft size={14} /> Back to search
            </button>

            <label className="label" style={{ color: '#7a4900' }} htmlFor="add-type">What do you do?</label>
            <select id="add-type" className="input mb-4" value={type} onChange={e => setType(e.target.value)}>
              {OFFERED_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <div className="space-y-4">
              <Field name="name"     label="Business name"   placeholder="Unleash - The Dog Town" required value={biz.name} onChange={set} />
              <Field name="phone"    label="Phone"           placeholder="+91 98765 43210" required value={biz.phone} onChange={set} />
              <Field name="area"     label="Area"            placeholder="Baner" value={biz.area} onChange={set} />
              <Field name="city"     label="City"            placeholder="Pune" value={biz.city} onChange={set} />
              <Field name="address"  label="Address"         placeholder="123 MG Road" value={biz.address} onChange={set} />
              <Field name="whatsapp" label="WhatsApp"        placeholder="+91 98765 43210" value={biz.whatsapp} onChange={set} />
              <Field name="hours"    label="Hours"           placeholder="Mon–Sat 9am–7pm" value={biz.hours} onChange={set} />
              <Field name="maps_url" label="Google Maps link" placeholder="https://maps.google.com/..." value={biz.maps_url} onChange={set} />
              <div>
                <label className="label" style={{ color: '#7a4900' }} htmlFor="biz-description">
                  What you offer<span style={{ color: '#b08d57' }}> (optional)</span>
                </label>
                <textarea id="biz-description" name="description" className="input" rows={3}
                  value={biz.description} onChange={set}
                  placeholder="Boarding, day care and grooming for dogs and cats." />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 mt-4 text-sm" style={{ color: '#b4453c' }}>
                <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={saving || !biz.name.trim() || !biz.phone.trim()}
              className="btn-primary w-full justify-center mt-6"
              style={saving || !biz.name.trim() || !biz.phone.trim() ? { opacity: 0.5 } : undefined}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : 'Add and claim it'}
            </button>

            <p className="text-xs mt-4" style={{ color: '#a08f7a' }}>
              Your listing appears in the Pippy directory once we&apos;ve checked it, and your
              account is set up at the same time.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
