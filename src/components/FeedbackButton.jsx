import { useState } from 'react'
import { MessageSquarePlus, X, Star, Loader2, CheckCircle } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

const CATEGORIES = ['Document Scanning', 'Reminders', 'Health Timeline', 'Pet Records', 'General']

export default function FeedbackButton({ user }) {
  const [open, setOpen]       = useState(false)
  const [rating, setRating]   = useState(0)
  const [hovered, setHovered] = useState(0)
  const [category, setCategory] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)

  function reset() {
    setRating(0); setHovered(0); setCategory(''); setMessage(''); setDone(false)
  }

  function close() { setOpen(false); setTimeout(reset, 300) }

  async function submit(e) {
    e.preventDefault()
    if (!message.trim()) return
    setLoading(true)
    try {
      await supabase.from('feedback').insert({
        user_id:  user?.id || null,
        rating:   rating || null,
        category: category || null,
        message:  message.trim(),
      })
      setDone(true)
      setTimeout(close, 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-20 md:bottom-6 md:right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-lg font-bold text-sm transition-all hover:scale-105 active:scale-95"
        style={{ backgroundColor: '#F9D548', color: '#4A2C0A' }}
        title="Share feedback"
      >
        <MessageSquarePlus className="w-4 h-4" />
        Feedback
      </button>

      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(74,44,10,0.3)' }}
          onClick={e => { if (e.target === e.currentTarget) close() }}>

          <div className="w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            style={{ backgroundColor: '#FFFEF8' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4"
              style={{ backgroundColor: '#F9D548' }}>
              <div className="flex items-center gap-2">
                <MessageSquarePlus className="w-5 h-5" style={{ color: '#4A2C0A' }} />
                <span className="font-black text-base" style={{ color: '#4A2C0A' }}>Share your feedback</span>
              </div>
              <button onClick={close} className="p-1 rounded-full hover:bg-black/10 transition-colors">
                <X className="w-4 h-4" style={{ color: '#4A2C0A' }} />
              </button>
            </div>

            <div className="px-6 py-5">
              {done ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <CheckCircle className="w-12 h-12" style={{ color: '#16A34A' }} />
                  <p className="font-black text-lg" style={{ color: '#4A2C0A' }}>Thank you! 🐾</p>
                  <p className="text-sm text-center" style={{ color: '#B8A080' }}>
                    Your feedback helps make Pippy better for every pet parent.
                  </p>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">

                  {/* Star rating */}
                  <div>
                    <p className="text-xs font-bold mb-2" style={{ color: '#6B4C1E' }}>
                      How would you rate your experience?
                    </p>
                    <div className="flex gap-1">
                      {[1,2,3,4,5].map(n => (
                        <button key={n} type="button"
                          onMouseEnter={() => setHovered(n)}
                          onMouseLeave={() => setHovered(0)}
                          onClick={() => setRating(n)}
                          className="p-1 transition-transform hover:scale-110">
                          <Star className="w-7 h-7 transition-colors"
                            fill={(hovered || rating) >= n ? '#F9D548' : 'none'}
                            style={{ color: (hovered || rating) >= n ? '#D4A800' : '#D1C4A8' }} />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Category */}
                  <div>
                    <label className="text-xs font-bold block mb-1.5" style={{ color: '#6B4C1E' }}>
                      What feature is this about?
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {CATEGORIES.map(c => (
                        <button key={c} type="button"
                          onClick={() => setCategory(cat => cat === c ? '' : c)}
                          className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
                          style={category === c
                            ? { backgroundColor: '#F9D548', color: '#4A2C0A' }
                            : { backgroundColor: '#F0E6C8', color: '#6B4C1E' }}>
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Message */}
                  <div>
                    <label className="text-xs font-bold block mb-1.5" style={{ color: '#6B4C1E' }}>
                      Your feedback <span style={{ color: '#DC2626' }}>*</span>
                    </label>
                    <textarea
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      placeholder="Tell us what you loved, what confused you, or what you'd like to see next…"
                      rows={4}
                      required
                      className="input w-full resize-none text-sm"
                      style={{ fontFamily: 'Nunito, sans-serif' }}
                    />
                  </div>

                  <button type="submit"
                    disabled={loading || !message.trim()}
                    className="btn-primary w-full justify-center gap-2">
                    {loading
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                      : 'Send Feedback'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
