import { useState, useEffect } from 'react'
import { Download, X, Share, Plus } from 'lucide-react'

const DISMISS_KEY = 'pippy_install_dismissed'

// iOS Safari never fires beforeinstallprompt — installing there is a manual
// Share > Add to Home Screen, so it needs instructions rather than a button.
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac, so check for touch as well
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isInStandaloneMode() {
  return window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
}

export default function InstallPrompt() {
  const [prompt, setPrompt]   = useState(null)   // Android/Chrome deferred event
  const [visible, setVisible] = useState(false)
  const [mode, setMode]       = useState(null)   // 'prompt' | 'ios'

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === '1') return
    if (isInStandaloneMode()) return   // already installed

    const handler = e => {
      e.preventDefault()
      setPrompt(e)
      setMode('prompt')
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // Nothing will fire on iOS, so offer the manual route instead — after a
    // short delay so it doesn't greet a first-time visitor immediately.
    let timer
    if (isIos()) {
      timer = setTimeout(() => { setMode('ios'); setVisible(true) }, 4000)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      clearTimeout(timer)
    }
  }, [])

  async function install() {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setVisible(false)
  }

  function dismiss() {
    setVisible(false)
    localStorage.setItem(DISMISS_KEY, '1')
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-24 md:bottom-6 left-4 right-4 md:left-auto md:right-24 md:w-80 z-50
      rounded-2xl shadow-xl p-4"
      style={{ backgroundColor: '#4A2C0A', color: '#FFFEF8' }}>

      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
          style={{ backgroundColor: '#F9D548' }}>
          🐾
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-black text-sm">Add Pippy to your Home Screen</p>

          {mode === 'ios' ? (
            <p className="text-xs opacity-80 mt-1 leading-relaxed">
              Tap <Share className="w-3.5 h-3.5 inline -mt-0.5" /> in Safari&apos;s toolbar,
              then choose <strong>Add to Home Screen</strong>
              <Plus className="w-3.5 h-3.5 inline -mt-0.5 ml-0.5" />
            </p>
          ) : (
            <p className="text-xs opacity-70 mt-0.5">Works offline &amp; loads instantly</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {mode === 'prompt' && (
            <button onClick={install}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold"
              style={{ backgroundColor: '#F9D548', color: '#4A2C0A' }}>
              <Download className="w-3.5 h-3.5" /> Install
            </button>
          )}
          <button onClick={dismiss} aria-label="Dismiss"
            className="p-1.5 rounded-xl opacity-60 hover:opacity-100 transition-opacity">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
