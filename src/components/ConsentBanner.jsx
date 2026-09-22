import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { consentState, setConsent } from '../lib/analytics.js'
import PrivacyNotice from './PrivacyNotice.jsx'

// Asked once, defaults to no, and remembers either answer.
//
// Deliberately not a cookie wall: both buttons are the same size and the same
// weight, declining does not hide anything, and nothing is blocked while the
// choice is open. Analytics is genuinely optional here, so the banner should
// not pretend otherwise by making "no" the quiet grey one.
//
// It only appears once a decision has not been made. Anyone who has answered —
// either way — never sees it again.
export default function ConsentBanner() {
  const [decided, setDecided] = useState(() => consentState() !== null)
  const [showNotice, setShowNotice] = useState(false)

  if (decided) return null

  function answer(granted) {
    setConsent(granted)
    setDecided(true)
  }

  return (
    <>
      {showNotice && <PrivacyNotice onClose={() => setShowNotice(false)} />}

      <div className="fixed bottom-0 left-0 right-0 z-40 p-3 pb-20 md:pb-3"
        role="region" aria-label="Analytics choice">
        <div className="mx-auto max-w-lg rounded-2xl shadow-xl p-4 space-y-3"
          style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #f2b83d' }}>

          <div className="flex items-start gap-2.5">
            <BarChart3 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#c9891f' }} />
            <p className="text-sm" style={{ color: '#4a4a3d' }}>
              <span className="font-bold" style={{ color: '#7a4900' }}>Help improve Pippy?</span>{' '}
              Microsoft Clarity can record how the app is used, so rough edges show up.
              Your pets' records stay masked in any recording. It is off unless you
              say yes, and Pippy works exactly the same either way.
            </p>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => answer(false)}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm"
              style={{ backgroundColor: '#f5f0e0', color: '#7a4900' }}>
              No thanks
            </button>
            <button type="button" onClick={() => answer(true)}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm"
              style={{ backgroundColor: '#f2b83d', color: '#7a4900' }}>
              Yes, that's fine
            </button>
          </div>

          <button type="button" onClick={() => setShowNotice(true)}
            className="text-xs underline w-full text-center" style={{ color: '#73775b' }}>
            What Pippy stores, and who else sees it
          </button>
        </div>
      </div>
    </>
  )
}
