import { useState, useEffect } from 'react'
import { reportHandled } from '../lib/errorReport.js'
import { getSupabase, isConfigured } from '../lib/supabase.js'
import { PawPrint, Loader2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react'
import PippyLogo from './PippyLogo.jsx'

const PROVIDER_TYPES = ['Vet', 'Groomer', 'Store', 'Boarder', 'Special Services', 'Pet Loss & Memorial Services']

const EMPTY_FORM = {
  name: '', type: 'Vet', area: '', city: '', address: '', phone: '', whatsapp: '',
  email: '',
  hours: '', maps_url: '', photo_url: '', description: '',
  url: '', // honeypot — real users never fill this in
}

export default function ProviderRegistration() {
  const [form, setForm]     = useState(EMPTY_FORM)
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [error, setError]   = useState(null)

  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  const canSubmit = form.name.trim() && form.phone.trim() && status !== 'submitting'

  // What the name being typed already matches in the directory.
  //
  // 968 of the listings came from Google and have never been asked, so most
  // businesses reaching this form are already in Pippy and do not know it.
  // The link at the bottom of the page said so and was read by nobody; a
  // duplicate is cheap to avoid HERE and expensive afterwards — two rows for
  // one business, two claims, and an admin who cannot tell from the data
  // which one a customer will find.
  //
  // The same hint the signed-in claim flow has had. Two honest limits:
  // search_providers() forces approved_only for a signed-out caller, so this
  // sees the published directory and not another pending registration; and
  // only name, type and place are rendered — never the email a listing may
  // carry — because this page is public.
  const [maybe, setMaybe] = useState([])
  useEffect(() => {
    if (!isConfigured) return
    const q = form.name.trim()
    if (q.length < 4) { setMaybe([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const { data } = await (await getSupabase()).rpc('search_providers', {
          approved_only: true, filter_type: null, filter_area: null,
          search_term: q, page_limit: 4, page_offset: 0,
        })
        if (!cancelled) setMaybe((data || []).map(r => r.provider))
      } catch { /* a failed hint must never block the form */ }
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [form.name])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setStatus('submitting')
    setError(null)
    try {
      const res = await fetch('/api/register-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Something went wrong, please try again.')
      setStatus('success')
    } catch (err) {
      reportHandled(err, { view: 'provider-registration' })
      setError(err.message)
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10" style={{ backgroundColor: '#FFFEF8' }}>
      {/* Logo */}
      <div className="flex items-center gap-3 mb-8">
        <PippyLogo size="lg" className="shadow-sm" />
        <span className="text-4xl font-black tracking-tight" style={{ color: '#7a4900', fontFamily: 'Nunito, sans-serif' }}>
          pip<span style={{ color: '#f2b83d' }}>py</span>
        </span>
      </div>

      <div className="w-full max-w-lg">
        {status === 'success' ? (
          <div className="card text-center py-10">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: '#fff3c0' }}>
              <CheckCircle2 className="w-7 h-7" style={{ color: '#5f7a3a' }} />
            </div>
            <h1 className="text-xl font-black mb-2" style={{ color: '#7a4900' }}>Thanks for registering!</h1>
            <p className="text-sm" style={{ color: '#73775b' }}>
              Your listing has been submitted for review and will appear in the Pippy directory once approved.
            </p>
            {/* The one moment this person is certain to want the provider shell:
                they have just told us who they are and have nowhere to go. Until
                this link existed, /business was reachable only by being told the
                URL. */}
            <hr className="my-6" style={{ borderColor: '#f0e6c8' }} />
            <p className="text-sm" style={{ color: '#4A2C0A' }}>
              Once it is approved you can sign in to your business account to see
              what customers share with you.
            </p>
            <a href="/business" className="btn-secondary inline-flex mt-4">
              Go to business sign-in <ArrowRight className="w-4 h-4 ml-2" />
            </a>
          </div>
        ) : (
          <div className="card">
            <div className="text-center mb-6">
              <h1 className="text-xl font-black mb-1" style={{ color: '#7a4900' }}>Register as a Pippy Provider</h1>
              <p className="text-sm" style={{ color: '#73775b' }}>
                List your vet clinic, grooming service, store, boarding, or other pet care service.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl text-sm mb-4"
                style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="label">Business / Provider Name *</label>
                <input name="name" value={form.name} onChange={set} className="input w-full" required
                  placeholder="e.g. PawCare Clinic" disabled={status === 'submitting'} />

                {maybe.length > 0 && status !== 'success' && (
                  <div className="rounded-2xl p-3 mt-2"
                    style={{ backgroundColor: '#fff9e0', border: '1.5px solid #f2b83d' }}>
                    <p className="text-xs font-bold" style={{ color: '#7a4900' }}>
                      Already on Pippy? Claim it instead of adding a second listing.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {maybe.map(p => (
                        <li key={p.id} className="rounded-xl px-3 py-2"
                          style={{ backgroundColor: '#FFFEF8', border: '1px solid #ebe3d3' }}>
                          <span className="text-sm font-bold block" style={{ color: '#4A2C0A' }}>{p.name}</span>
                          <span className="text-xs" style={{ color: '#73775b' }}>
                            {[p.type, p.area, p.city].filter(Boolean).join(' · ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <a href="/business" className="text-xs font-bold underline inline-block mt-2"
                      style={{ color: '#b08d57' }}>
                      Claim your business instead
                    </a>
                  </div>
                )}
              </div>
              <div>
                <label className="label">Type *</label>
                <select name="type" value={form.type} onChange={set} className="input w-full" disabled={status === 'submitting'}>
                  {PROVIDER_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Area / Locality</label>
                <input name="area" value={form.area} onChange={set} className="input w-full" placeholder="Kothrud" disabled={status === 'submitting'} />
              </div>
              <div>
                <label className="label">City</label>
                <input name="city" value={form.city} onChange={set} className="input w-full" placeholder="Pune" disabled={status === 'submitting'} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Address</label>
                <input name="address" value={form.address} onChange={set} className="input w-full" placeholder="123 MG Road" disabled={status === 'submitting'} />
              </div>
              <div>
                <label className="label">Phone *</label>
                <input name="phone" value={form.phone} onChange={set} className="input w-full" required
                  placeholder="+91 98765 43210" disabled={status === 'submitting'} />
              </div>
              <div>
                <label className="label">WhatsApp number</label>
                <input name="whatsapp" value={form.whatsapp} onChange={set} className="input w-full" placeholder="+91 98765 43210" disabled={status === 'submitting'} />
              </div>

              {/* The form took a phone and nothing else, which left this page
                  unable to set up the thing it exists for: the address is how a
                  submission is matched back to the person who made it when they
                  later sign in at /business. It is NOT published with the
                  listing — it goes on the claim, which only an admin can read. */}
              <div className="sm:col-span-2">
                <label className="label" htmlFor="reg-email">Your email address</label>
                <input id="reg-email" name="email" type="email" value={form.email} onChange={set}
                  className="input w-full" placeholder="you@yourbusiness.com"
                  disabled={status === 'submitting'} />
                <p className="text-xs mt-1" style={{ color: '#73775b' }}>
                  So we can reach you about this listing, and so you can sign in to manage it
                  once it&apos;s approved. Not shown in the directory.
                </p>
              </div>
              <div>
                <label className="label">Hours</label>
                <input name="hours" value={form.hours} onChange={set} className="input w-full" placeholder="Mon–Sat 9am–7pm" disabled={status === 'submitting'} />
              </div>
              <div>
                <label className="label">Google Maps URL</label>
                <input name="maps_url" value={form.maps_url} onChange={set} className="input w-full" placeholder="https://maps.google.com/..." disabled={status === 'submitting'} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Photo URL</label>
                <input name="photo_url" value={form.photo_url} onChange={set} className="input w-full" placeholder="https://..." disabled={status === 'submitting'} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Description</label>
                <textarea name="description" value={form.description} onChange={set} className="input w-full" rows={3}
                  placeholder="Short description pet owners will see" disabled={status === 'submitting'} />
              </div>

              {/* Honeypot — hidden from real users, off-canvas rather than display:none */}
              <div style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }} aria-hidden="true">
                <label htmlFor="url">Company URL</label>
                <input id="url" name="url" type="text" tabIndex={-1} autoComplete="off"
                  value={form.url} onChange={set} />
              </div>

              <div className="sm:col-span-2">
                <button type="submit" disabled={!canSubmit} className="btn-primary w-full justify-center gap-2">
                  {status === 'submitting'
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                    : 'Submit for Review'}
                </button>
              </div>
            </form>
          </div>
        )}

        <p className="text-center text-xs mt-6" style={{ color: '#73775b' }}>
          Submissions are reviewed before appearing in the Pippy directory.
        </p>
        {/* A business already in the directory does not need this form at all —
            968 of them were imported from Google and have never been asked. They
            need to claim the listing that already exists. */}
        <p className="text-center text-xs mt-2" style={{ color: '#73775b' }}>
          Already listed on Pippy?{' '}
          <a href="/business" className="underline" style={{ color: '#b08d57' }}>
            Claim your business
          </a>.
        </p>
      </div>
    </div>
  )
}
