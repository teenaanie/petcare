import { Mic, MicOff, Loader2, AlertCircle } from 'lucide-react'
import { useVoiceRecorder } from '../../lib/useVoiceRecorder.js'
import { voiceLikelyAvailable } from '../../lib/speech.js'

// A mic beside a box, for a provider whose hands are full of dog.
//
// ── Why this is not VoicePanel ──────────────────────────────────────────────
//
// VoicePanel is a whole screen: a speak/type switcher, a 64px record button and
// three lines of explanation, because a pet parent meets it once and is about
// to have what they say PARSED into records. Neither is true here. A boarder
// writes a day's line twenty times a week, already knows what the button does,
// and the words go straight into the field they are standing in — so this is
// one small button on the box, and nothing else moves.
//
// ── What it deliberately does not do ────────────────────────────────────────
//
// It never fills a structured field. Names, phone numbers, dates and amounts
// are typed, because the app already learned this the expensive way on the pet
// side: transcription turns "Bruno" into "Bruna" and "Nobivac" into "no bee
// back", and those are exactly the fields that are wrong forever once saved. A
// mishearing inside a free-text note costs one edit and is visible while you
// read it back; a mishearing in a phone number is a customer you cannot reach.
//
// Speech lands in the box and stops. Nothing is saved by talking.
//
// ── Where the audio goes ────────────────────────────────────────────────────
//
// Through the same path as everywhere else in the app: the browser's own
// recogniser first when the user has not switched it off — which means Google
// or Apple, not us — and Whisper through /api/transcribe otherwise. The hook in
// src/lib/useVoiceRecorder.js is the single implementation of all of it; a
// second copy of that WebKit handling would drift, and did once before.

export default function Dictate({ onText, label = 'Dictate', compact = false }) {
  // Append rather than replace: a provider half way through typing a note and
  // reaching for the mic means "and also", not "start again".
  const voice = useVoiceRecorder(text => {
    const t = (text || '').trim()
    if (t) onText(t)
  }, 'auto', 'provider-voice')

  const { listening, transcribing, partial, error } = voice
  if (!voiceLikelyAvailable()) return null

  const micDenied = /denied|refused/i.test(error || '')
  if (micDenied) return null

  return (
    <div className={compact ? '' : 'mt-1.5'}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={listening ? voice.stop : voice.start} disabled={transcribing}
          aria-label={listening ? 'Stop dictating' : label}
          title={listening ? 'Stop dictating' : label}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold ${listening ? 'animate-pulse' : ''}`}
          style={listening ? { backgroundColor: '#c0392b', color: 'white' }
                           : { backgroundColor: '#f5f0e0', color: '#7a4900' }}>
          {transcribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : listening ? <MicOff className="w-3.5 h-3.5" />
            : <Mic className="w-3.5 h-3.5" />}
          {transcribing ? 'Writing it down…' : listening ? 'Stop' : label}
        </button>
        {listening && (
          <span className="text-[11px]" style={{ color: '#73775b' }}>
            Listening — it stops on its own after a pause.
          </span>
        )}
      </div>

      {partial && (
        <p className="text-[11px] italic mt-1" style={{ color: '#a08f7a' }}>“{partial}”</p>
      )}
      {error && !micDenied && (
        <p className="text-[11px] mt-1 flex items-start gap-1" style={{ color: '#c0392b' }}>
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" /> {error}
        </p>
      )}
    </div>
  )
}
