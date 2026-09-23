import { useState, useEffect } from 'react'
import { Mail, Phone, Loader2, AlertCircle, ArrowLeft } from 'lucide-react'
import { supabaseProvider } from '../../lib/supabase.js'
import PippyLogo from '../PippyLogo.jsx'

// Sign-in for the provider shell.
//
// Deliberately a separate component from PhoneAuth rather than a `variant`
// prop: it signs in through supabaseProvider, whose session lives under its own
// storageKey, so a boarder signed into the pet app still signs in here. The OTP
// mechanics are the same because they are Supabase's, not ours.

const COUNTRY_CODES = [
  { code: '+91',  label: '🇮🇳 +91' },
  { code: '+1',   label: '🇺🇸 +1' },
  { code: '+44',  label: '🇬🇧 +44' },
  { code: '+61',  label: '🇦🇺 +61' },
  { code: '+65',  label: '🇸🇬 +65' },
  { code: '+971', label: '🇦🇪 +971' },
  { code: '+60',  label: '🇲🇾 +60' },
]

const SESSION_KEY = 'pippy_provider_otp_state'

// Browsers word a dropped request differently — Safari "Load failed", Chrome
// "Failed to fetch" — and none of it means anything to a user.
function isNetworkError(err) {
  if (err?.name === 'AuthRetryableFetchError' || err?.name === 'TypeError') return true
  const m = (err?.message || '').toLowerCase()
  return m.includes('load failed') || m.includes('failed to fetch') ||
         m.includes('networkerror') || m.includes('network request failed')
}

function friendlyAuthError(err) {
  if (isNetworkError(err)) {
    return "Couldn't reach the server. Check your connection and try again — if you're on patchy mobile data, switching to Wi-Fi usually helps."
  }
  return err?.message || 'Could not send code. Please try again.'
}

export default function ProviderAuth() {
  const [method, setMethod]           = useState('email')
  const [step, setStep]               = useState('entry')
  const [countryCode, setCountryCode] = useState('+91')
  const [phone, setPhone]             = useState('')
  const [email, setEmail]             = useState('')
  const [otp, setOtp]                 = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [sentTo, setSentTo]           = useState('')

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY)
      if (saved) {
        const { method: m, sentTo: s, step: st } = JSON.parse(saved)
        if (st === 'otp' && s) { setMethod(m); setSentTo(s); setStep('otp') }
      }
    } catch {}
  }, [])

  const saveOtpState = (m, to) => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ method: m, sentTo: to, step: 'otp' })) } catch {}
  }
  const clearOtpState = () => {
    try { sessionStorage.removeItem(SESSION_KEY) } catch {}
  }

  const formattedPhone = countryCode + phone.replace(/\D/g, '')

  function switchMethod(m) {
    setMethod(m); setStep('entry'); setError(null); setOtp(''); setSentTo(''); clearOtpState()
  }

  async function sendOtp() {
    if (method === 'phone') {
      const { error } = await supabaseProvider.auth.signInWithOtp({ phone: formattedPhone })
      if (error) throw error
      return formattedPhone
    }
    // Code entry, not a magic link: a link opened from a mail app signs you in
    // in that browser, not in the installed PWA. Same reasoning as PhoneAuth.
    const { error } = await supabaseProvider.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + '/business' },
    })
    if (error) throw error
    return email
  }

  async function handleSend(e) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      let target
      try {
        target = await sendOtp()
      } catch (err) {
        // The SMTP round trip is slow enough that a weak connection drops it,
        // surfacing as an opaque "Load failed". Retry once before giving up.
        if (!isNetworkError(err)) throw err
        await new Promise(r => setTimeout(r, 1500))
        target = await sendOtp()
      }
      setSentTo(target)
      saveOtpState(method, target)
      setStep('otp')
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(e) {
    e.preventDefault()
    if (otp.length < 4) return
    setLoading(true); setError(null)
    try {
      const params = method === 'phone'
        ? { phone: sentTo, token: otp, type: 'sms' }
        : { email: sentTo, token: otp, type: 'email' }
      const { error } = await supabaseProvider.auth.verifyOtp(params)
      if (error) throw error
      clearOtpState()
    } catch (err) {
      setError(isNetworkError(err) ? friendlyAuthError(err) : (err.message || 'Invalid code. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: '#FFFEF8' }}>
      <div className="flex items-center gap-3 mb-3">
        <PippyLogo size="lg" className="shadow-sm" />
        <span className="text-4xl font-black tracking-tight" style={{ color: '#7a4900', fontFamily: 'Nunito, sans-serif' }}>
          pip<span style={{ color: '#f2b83d' }}>py</span>
        </span>
      </div>
      <p className="text-sm font-bold mb-8" style={{ color: '#b08d57' }}>for boarders &amp; groomers</p>

      <div className="w-full max-w-sm">
        <div className="card">
          {step === 'entry' ? (
            <form onSubmit={handleSend}>
              <div className="flex rounded-xl p-1 mb-6" style={{ backgroundColor: '#ebe3d3' }}>
                <button type="button" onClick={() => switchMethod('email')}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
                  style={method === 'email' ? { backgroundColor: '#f2b83d', color: '#7a4900' } : { color: '#73775b' }}>
                  <Mail size={16} /> Email
                </button>
                <button type="button" onClick={() => switchMethod('phone')}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all"
                  style={method === 'phone' ? { backgroundColor: '#f2b83d', color: '#7a4900' } : { color: '#73775b' }}>
                  <Phone size={16} /> Phone
                </button>
              </div>

              {method === 'email' ? (
                <>
                  <label className="label" style={{ color: '#7a4900' }} htmlFor="provider-email">Your business email</label>
                  <input id="provider-email" className="input" type="email" required autoComplete="email"
                    value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourbusiness.com" />
                </>
              ) : (
                <>
                  <label className="label" style={{ color: '#7a4900' }} htmlFor="provider-phone">Your phone number</label>
                  <div className="flex gap-2">
                    <select className="input" style={{ width: 'auto' }} value={countryCode}
                      onChange={e => setCountryCode(e.target.value)} aria-label="Country code">
                      {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                    <input id="provider-phone" className="input" type="tel" required autoComplete="tel"
                      value={phone} onChange={e => setPhone(e.target.value)} placeholder="98765 43210" />
                  </div>
                </>
              )}

              {error && (
                <div className="flex items-start gap-2 mt-4 text-sm" style={{ color: '#b4453c' }}>
                  <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full justify-center mt-6">
                {loading ? <Loader2 size={16} className="animate-spin" /> : 'Send me a code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify}>
              <button type="button" onClick={() => switchMethod(method)}
                className="flex items-center gap-1 text-sm font-semibold mb-4" style={{ color: '#b08d57' }}>
                <ArrowLeft size={14} /> Back
              </button>
              <label className="label" style={{ color: '#7a4900' }} htmlFor="provider-otp">
                Enter the code sent to {sentTo}
              </label>
              <input id="provider-otp" className="input text-center tracking-[0.4em] text-lg" inputMode="numeric"
                autoComplete="one-time-code" value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="000000" />

              {error && (
                <div className="flex items-start gap-2 mt-4 text-sm" style={{ color: '#b4453c' }}>
                  <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
                </div>
              )}

              <button type="submit" disabled={loading || otp.length < 4} className="btn-primary w-full justify-center mt-6">
                {loading ? <Loader2 size={16} className="animate-spin" /> : 'Sign in'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs mt-6" style={{ color: '#a08f7a' }}>
          This is the provider sign-in. Looking after your own pet?{' '}
          <a href="/" className="underline" style={{ color: '#b08d57' }}>Go to the Pippy app</a>.
        </p>
      </div>
    </div>
  )
}
