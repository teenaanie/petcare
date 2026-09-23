import { useState, useEffect } from 'react'
import { Search, Loader2, AlertCircle, Check, Building2 } from 'lucide-react'
import { supabaseProvider } from '../../lib/supabase.js'
import { PROVIDER_TYPES } from '../../lib/taxonomy.js'

// Claim your business, or add it if it is not listed.
//
// Two entry paths, one table. Either way the row lands status='pending' and an
// admin approves it — anyone could type "Unleash – The Dog Town" into a form,
// and a claim that approved itself would hand a stranger a real business's
// customer book. Same posture register-provider.js already takes.
//
// The declared type drives what the shell shows later: a groomer has no trial
// run, no formalities checklist and a single-session visit. Boarders and
// groomers are the focus; a vet is accepted so the demand is captured, but
// nothing vet-specific is built.
const OFFERED_TYPES = ['Boarder', 'Groomer', 'Vet', ...PROVIDER_TYPES.filter(
  t => !['Boarder', 'Groomer', 'Vet'].includes(t)
)]

export default function ProviderOnboarding({ email, onClaimed }) {
  const [term, setTerm]       = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [type, setType]       = useState('Boarder')
  const [note, setNote]       = useState('')
  const [picked, setPicked]   = useState(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  // Debounced, and paged by the server: the directory is ~968 rows and
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
        const { data, error } = await supabaseProvider.rpc('search_providers', {
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
      const { error } = await supabaseProvider.rpc('claim_provider', {
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

  return (
    <div className="min-h-screen px-4 py-10" style={{ backgroundColor: '#FFFEF8' }}>
      <div className="w-full max-w-lg mx-auto">
        <h1 className="text-2xl font-black mb-1" style={{ color: '#7a4900', fontFamily: 'Nunito, sans-serif' }}>
          Find your business
        </h1>
        <p className="text-sm mb-6" style={{ color: '#b08d57' }}>
          Signed in as {email}. Pick your listing and we&apos;ll review it — usually the same day.
        </p>

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

          {!searching && term.trim().length >= 2 && results.length === 0 && (
            <p className="text-sm mt-4" style={{ color: '#a08f7a' }}>
              Nothing matched. If you&apos;re not listed yet,{' '}
              <a href="/register-provider" className="underline" style={{ color: '#b08d57' }}>add your business</a>{' '}
              first, then come back here to claim it.
            </p>
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
      </div>
    </div>
  )
}
