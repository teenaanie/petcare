import { useState } from 'react'
import { PawPrint, Phone, MessageSquare, Loader2, AlertCircle, ArrowLeft, CheckCircle } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

const COUNTRY_CODES = [
  { code: '+91',  label: '🇮🇳 +91' },
  { code: '+1',   label: '🇺🇸 +1' },
  { code: '+44',  label: '🇬🇧 +44' },
  { code: '+61',  label: '🇦🇺 +61' },
  { code: '+65',  label: '🇸🇬 +65' },
  { code: '+971', label: '🇦🇪 +971' },
  { code: '+60',  label: '🇲🇾 +60' },
]

export default function PhoneAuth() {
  const [step, setStep]           = useState('phone')   // 'phone' | 'otp'
  const [countryCode, setCountryCode] = useState('+91')
  const [phone, setPhone]         = useState('')
  const [otp, setOtp]             = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [fullPhone, setFullPhone] = useState('')

  const formattedPhone = countryCode + phone.replace(/\D/g, '')

  async function handleSendOtp(e) {
    e.preventDefault()
    if (!phone.trim()) return
    setLoading(true); setError(null)
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: formattedPhone })
      if (error) throw error
      setFullPhone(formattedPhone)
      setStep('otp')
    } catch (err) {
      setError(err.message || 'Could not send OTP. Please check your number and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp(e) {
    e.preventDefault()
    if (otp.length < 4) return
    setLoading(true); setError(null)
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: fullPhone,
        token: otp,
        type: 'sms',
      })
      if (error) throw error
      // onAuthStateChange in App.jsx will pick up the new session automatically
    } catch (err) {
      setError(err.message || 'Invalid code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setLoading(true); setError(null); setOtp('')
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: fullPhone })
      if (error) throw error
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: '#FFFEF8' }}>

      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm"
          style={{ backgroundColor: '#F9D548' }}>
          <PawPrint className="w-7 h-7" style={{ color: '#4A2C0A' }} />
        </div>
        <span className="text-4xl font-black tracking-tight" style={{ color: '#4A2C0A', fontFamily: 'Nunito, sans-serif' }}>
          pip<span style={{ color: '#F9D548' }}>py</span>
        </span>
      </div>

      <div className="w-full max-w-sm">

        {/* ── Step 1: Phone entry ─────────────────────────────────────── */}
        {step === 'phone' && (
          <div className="card">
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: '#FFF5AA' }}>
                <Phone className="w-7 h-7" style={{ color: '#4A2C0A' }} />
              </div>
              <h1 className="text-xl font-black mb-1" style={{ color: '#4A2C0A' }}>Welcome to Pippy</h1>
              <p className="text-sm" style={{ color: '#B8A080' }}>Enter your phone number to get started</p>
            </div>

            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="label text-xs">Phone Number</label>
                <div className="flex gap-2">
                  <select
                    value={countryCode}
                    onChange={e => setCountryCode(e.target.value)}
                    className="input w-28 flex-shrink-0 text-sm">
                    {COUNTRY_CODES.map(c => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    className="input flex-1"
                    placeholder="98765 43210"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <p className="text-xs mt-1.5" style={{ color: '#B8A080' }}>
                  We'll send a one-time code to {formattedPhone || 'this number'}
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl text-sm"
                  style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" disabled={loading || !phone.trim()}
                className="btn-primary w-full justify-center gap-2">
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  : <><MessageSquare className="w-4 h-4" /> Send OTP</>}
              </button>
            </form>
          </div>
        )}

        {/* ── Step 2: OTP verification ────────────────────────────────── */}
        {step === 'otp' && (
          <div className="card">
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: '#FFF5AA' }}>
                <MessageSquare className="w-7 h-7" style={{ color: '#4A2C0A' }} />
              </div>
              <h1 className="text-xl font-black mb-1" style={{ color: '#4A2C0A' }}>Check your messages</h1>
              <p className="text-sm" style={{ color: '#B8A080' }}>
                We sent a code to <span className="font-bold">{fullPhone}</span>
              </p>
            </div>

            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label className="label text-xs">Enter the 6-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  className="input text-center text-2xl font-black tracking-[0.3em]"
                  placeholder="• • • • • •"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  required
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl text-sm"
                  style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" disabled={loading || otp.length < 4}
                className="btn-primary w-full justify-center gap-2">
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                  : <><CheckCircle className="w-4 h-4" /> Verify & Sign In</>}
              </button>

              <div className="flex items-center justify-between text-xs" style={{ color: '#B8A080' }}>
                <button type="button" onClick={() => { setStep('phone'); setError(null); setOtp('') }}
                  className="flex items-center gap-1 hover:underline">
                  <ArrowLeft className="w-3.5 h-3.5" /> Change number
                </button>
                <button type="button" onClick={handleResend} disabled={loading}
                  className="hover:underline">
                  Resend code
                </button>
              </div>
            </form>
          </div>
        )}

        <p className="text-center text-xs mt-6" style={{ color: '#B8A080' }}>
          Your data is private and secure. Only you can see your pets' records.
        </p>
      </div>
    </div>
  )
}
