import { Mic, MicOff, Keyboard, Loader2, AlertCircle } from 'lucide-react'

// The speak-or-type box, shared by the two screens that take a free-text
// description from the owner: VoiceIntake (a new pet) and VoiceUpdate (records
// for a pet that already exists).
//
// SPEECH ALWAYS LANDS IN THE TEXTAREA, and stopping the recording never parses
// on its own. Indian names, breeds and drug names are exactly what
// transcription gets wrong, and exactly the fields we would otherwise save
// wrong: "Bruno" becomes "Bruna", "Nobivac" becomes "no bee back". A mishearing
// caught in the box costs one edit; caught on the review screen it costs a
// fiddlier correction; missed entirely it becomes bad data in a record shown to
// a vet.
//
// Typing is not a fallback here, it is a first-class mode — better in a quiet
// waiting room, on a poor microphone, or when the details are already in a
// WhatsApp message from the clinic waiting to be pasted.

export default function VoicePanel({
  voice, mode, onModeChange, text, onTextChange, placeholder, hint, rows,
  parsing = false,
}) {
  const { listening, transcribing, partial, error } = voice
  const busy = listening || transcribing || parsing
  // A refused microphone is permanent for this page load: keep the tab
  // disabled rather than letting the user tap into a dead end repeatedly.
  const micDenied = /denied|refused/i.test(error || '')
  const speaking  = mode === 'speak' && !micDenied

  return (
    <>
      <div className="flex gap-2">
        {[['speak', 'Speak', Mic], ['type', 'Type or paste', Keyboard]].map(([id, label, Icon]) => (
          <button type="button" key={id} onClick={() => onModeChange(id)}
            disabled={busy || (id === 'speak' && micDenied)}
            className="flex-1 text-sm font-bold px-3 py-2 rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={mode === id
              ? { backgroundColor: '#f2b83d', color: '#7a4900' }
              : { backgroundColor: '#ebe3d3', color: '#7a4900' }}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {speaking && (
        <div className="flex flex-col items-center gap-2 py-2">
          <button type="button" onClick={listening ? voice.stop : voice.start} disabled={transcribing}
            className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg ${listening ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: listening ? '#c0392b' : '#c9891f' }}
            aria-label={listening ? 'Stop recording' : 'Start recording'}>
            {transcribing ? <Loader2 className="w-7 h-7 text-white animate-spin" />
              : listening ? <MicOff className="w-7 h-7 text-white" />
              : <Mic className="w-7 h-7 text-white" />}
          </button>
          <p className="text-xs font-bold" style={{ color: '#7a4900' }}>
            {transcribing ? 'Writing it down…'
              : listening ? 'Listening — stop talking when you’re done'
              : 'Tap once and start talking'}
          </p>
          {partial && (
            <p className="text-xs italic text-center px-3" style={{ color: '#a08f7a' }}>“{partial}”</p>
          )}
          <p className="text-[11px] text-center" style={{ color: '#a08f7a' }}>
            {listening
              ? 'Pippy stops on its own after a short pause — or tap the mic to stop now.'
              : 'What you say lands in the box below — read it over and fix anything misheard before continuing.'}
          </p>
        </div>
      )}

      <textarea
        className="input w-full text-sm" rows={rows ?? (speaking ? 6 : 9)}
        placeholder={placeholder}
        value={text} onChange={e => onTextChange(e.target.value)} disabled={listening} />

      {hint && <p className="text-[11px]" style={{ color: '#a08f7a' }}>{hint}</p>}

      {error && (
        <p className="text-sm p-3 rounded-xl flex items-start gap-2"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </p>
      )}
    </>
  )
}
