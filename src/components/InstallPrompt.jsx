import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'

export default function InstallPrompt() {
  const [prompt, setPrompt]   = useState(null)
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('pippy_install_dismissed') === '1'
  )

  useEffect(() => {
    if (dismissed) return
    const handler = e => {
      e.preventDefault()
      setPrompt(e)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [dismissed])

  async function install() {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setVisible(false)
  }

  function dismiss() {
    setVisible(false)
    setDismissed(true)
    localStorage.setItem('pippy_install_dismissed', '1')
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-24 md:bottom-6 left-4 right-4 md:left-auto md:right-24 md:w-80 z-50
      rounded-2xl shadow-xl p-4 flex items-center gap-3"
      style={{ backgroundColor: '#4A2C0A', color: '#FFFEF8' }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: '#F9D548' }}>
        🐾
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm">Add Pippy to Home Screen</p>
        <p className="text-xs opacity-70 mt-0.5">Works offline & loads instantly</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button onClick={install}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold"
          style={{ backgroundColor: '#F9D548', color: '#4A2C0A' }}>
          <Download className="w-3.5 h-3.5" /> Install
        </button>
        <button onClick={dismiss}
          className="p-1.5 rounded-xl opacity-60 hover:opacity-100 transition-opacity">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
