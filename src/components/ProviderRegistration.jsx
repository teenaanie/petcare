import { useState } from 'react'
import { PawPrint, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

const PROVIDER_TYPES = ['Vet', 'Groomer', 'Store', 'Boarder', 'Special Services', 'Pet Loss & Memorial Services']

const EMPTY_FORM = {
  name: '', type: 'Vet', area: '', city: '', address: '', phone: '', whatsapp: '',
  hours: '', maps_url: '', photo_url: '', description: '',
  url: '', // honeypot — real users never fill this in
}

export default function ProviderRegistration() {
  const [form, setForm]     = useState(EMPTY_FORM)
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [error, setError]   = useState(null)

  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  const canSubmit = form.name.trim() && form.phone.trim() && status !== 'submitting'

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setStatus('submitting')
    setError(null)
    try {
      const res = await fetch('/.netlify/functions/register-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Something went wrong, please try again.')
      setStatus('success')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10" style={{ backgroundColor: '#FFFEF8' }}>
      {/* Logo */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm"
          style={{ backgroundColor: '#F9D548' }}>
          <PawPrint className="w-7 h-7" style={{ color: '#4A2C0A' }} />
        </div>
        <span className="text-4xl font-black tracking-tight" style={{ color: '#4A2C0A', fontFamily: 'Nunito, sans-serif' }}>
          pip<span style={{ color: '#F9D548' }}>py</span>
        </span>
      </div>

      <div className="w-full max-w-lg">
        {status === 'success' ? (
          <div className="card text-center py-10">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: '#FFF5AA' }}>
              <CheckCircle2 className="w-7 h-7" style={{ color: '#059669' }} />
            </div>
            <h1 className="text-xl font-black mb-2" style={{ color: '#4A2C0A' }}>Thanks for registering!</h1>
            <p className="text-sm" style={{ color: '#B8A080' }}>
              Your listing has been submitted for review and will appear in the Pippy directory once approved.
            </p>
          </div>
        ) : (
          <div className="card">
            <div className="text-center mb-6">
              <h1 className="text-xl font-black mb-1" style={{ color: '#4A2C0A' }}>Register as a Pippy Provider</h1>
              <p className="text-sm" style={{ color: '#B8A080' }}>
                List your vet clinic, grooming service, store, boarding, or other pet care service.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl text-sm mb-4"
                style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="label">Business / Provider Name *</label>
                <input name="name" value={form.name} onChange={set} className="input w-full" required
                  placeholder="e.g. PawCare Clinic" disabled={status === 'submitting'} />
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

        <p className="text-center text-xs mt-6" style={{ color: '#B8A080' }}>
          Submissions are reviewed before appearing in the Pippy directory.
        </p>
      </div>
    </div>
  )
}
