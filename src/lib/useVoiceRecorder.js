// src/lib/useVoiceRecorder.js
//
// One microphone implementation, used by every voice feature in the app.
//
// It lived inside Reminders.jsx and was copied, by hand and incompletely, into
// VoiceIntake.jsx — where the copy called webSpeechNeedsSolo() and
// noteWebSpeechStarvedRecording() without importing them, so tapping the mic on
// the Add-a-pet screen threw a ReferenceError on every browser. That is the
// argument for this file: the WebKit handling below is subtle enough that a
// second copy of it will always drift, and the drift is invisible until someone
// taps a button nothing tests.
//
// Callers differ only in what they do with the words:
//   Reminders    — one utterance becomes one saved reminder
//   VoiceIntake  — appends into a textarea the user then edits
//   VoiceUpdate  — appends, for records added to a pet that already exists
//
import { useState, useRef, useEffect } from 'react'
import { transcribeAudio } from './ai.js'
import { reportHandled } from './errorReport.js'
import { startWebSpeech, webSpeechSupported, webSpeechEnabled, webSpeechLangFor,
         webSpeechNeedsSolo, noteWebSpeechStarvedRecording } from './speech.js'

// ── Voice recording hook (MediaRecorder → /api/transcribe) ───────────────────
//
// Opus in the browser produces roughly 15 KB per second of audio. Measured in
// Chrome: a 1.0s clip is ~15,600 bytes, a 2.5s clip ~38,000. That matters,
// because this hook used to reject anything under 1.5 SECONDS — throwing away
// a perfectly good 15 KB recording and telling the user "tap the mic, speak,
// then tap again to stop", which is exactly what they had just done.
//
// Duration is the wrong test. Whether a clip contains intelligible speech is
// Whisper's call, and the server already answers "Couldn't hear anything" when
// the transcript comes back empty. All this needs to catch is a capture that is
// genuinely empty — no chunks, or a bare container header with no audio in it.

// Measured in this browser, recording a synthetic stream: 2s of TONE is ~31,000
// bytes, but 2s of digital SILENCE is only ~705, and 5s of silence ~1,565.
// Opus compresses silence to almost nothing. The old floor of 1200 therefore
// did not mean "empty container" at all -- it meant "under about four seconds
// of quiet", and it rejected those recordings before Whisper ever saw them,
// while blaming the microphone permission. Only a genuinely empty capture
// should be stopped here; a 500ms silent clip already measures 275 bytes, so
// anything below 200 is a bare container header and nothing else.
const MIN_BYTES  = 200
const MIN_MS     = 400         // a tap, not an utterance
const MAX_MS     = 120_000     // stop before the upload hits the server's size cap

// ── Stopping by itself ───────────────────────────────────────────────────────
//
// Talking to this app used to take three taps: Speak, then the mic to start,
// then the mic again to stop. The middle one is the only one that is really
// about the user's intent; the other two were the app's bookkeeping.
//
// So it now listens for the end of the sentence instead of waiting to be told.
// Two different signals, because the two paths have different things to watch:
//
//   recording path  the microphone stream itself, through an AnalyserNode
//   solo path       there is no stream to analyse — running getUserMedia
//                   alongside recognition is what starved WebKit in the first
//                   place — so the signal is recognition reporting new words
//
// Tuning matters more than the mechanism. Stop too eagerly and you cut someone
// off mid-thought, which is far more annoying than an extra tap; 2.5s is longer
// than the pause in "he had his rabies shot ... last March".
const SILENCE_MS = 2500

// If nothing is ever heard, give up rather than listen forever. Long enough to
// find the words, short enough that a mic left open is not a surprise.
const NO_SPEECH_MS = 12_000

// Below this the frame is background noise rather than speech. Measured as RMS
// over a byte time-domain buffer, where 128 is silence. Measured in-browser
// against a synthetic stream: digital silence reads 0.000, a quiet voice-band
// tone 0.036, a normal one 0.214 — so this sits with room either side.
const VOICE_RMS = 0.015

// A FIXED floor is wrong in a noisy room, and a vet's waiting room is a noisy
// room. If the background alone reads above the threshold, nothing ever counts
// as silence and the recording runs until the two-minute cap.
//
// So the first moment is spent listening to the room, and the bar is set above
// whatever is already there. NOISE_FACTOR is what speech has to clear relative
// to the background — high enough not to trip on a fan, low enough that a
// normal voice at 6x the floor still registers.
const CALIBRATE_MS  = 500
const NOISE_FACTOR  = 2.5

/**
 * @param {Function} onTranscript called with the finished text
 * @param {string}   language      BCP-47 tag, or 'auto'
 * @param {string}   [view]        which screen is recording, for error reports.
 *   One of VIEWS in errorReport.js. The hook is used from three screens, and
 *   without this a transcription fault reports as 'unknown' from all of them.
 */
export function useVoiceRecorder(onTranscript, language, view) {
  const [listening, setListening]       = useState(false)
  const [transcript, setTranscript]     = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError]               = useState(null)
  const [elapsedMs, setElapsedMs]       = useState(0)
  const mediaRecorderRef                = useRef(null)
  const streamRef                       = useRef(null)
  const chunksRef                       = useRef([])
  const startTimeRef                    = useRef(null)
  const readyRef                        = useRef(false)   // true once recorder is recording
  const tickRef                         = useRef(null)
  const autoStopRef                     = useRef(null)
  const languageRef                     = useRef(language)
  languageRef.current                   = language
  const speechRef                       = useRef(null)   // live Web Speech handle
  const usedRecognitionRef              = useRef(false)  // was it running this time?
  const soloRef                         = useRef(false)  // recognition-only attempt
  const fallbackRef                     = useRef(false)  // solo heard nothing; record next time
  const [partial, setPartial]           = useState('')   // words as they are heard
  const heardAtRef                      = useRef(0)      // last moment speech was detected
  const heardAnythingRef                = useRef(false)
  const silenceRef                      = useRef(null)   // the "has it gone quiet" watcher
  const analyserRef                     = useRef(null)   // the "is anyone talking" meter
  const audioCtxRef                     = useRef(null)
  const [engine, setEngine]             = useState(null) // 'browser' | 'whisper'

  function clearTimers() {
    clearInterval(tickRef.current);   tickRef.current = null
    clearTimeout(autoStopRef.current); autoStopRef.current = null
    clearInterval(silenceRef.current);  silenceRef.current = null
    clearInterval(analyserRef.current); analyserRef.current = null
    // An AudioContext left open holds the microphone indicator on in some
    // browsers even after the track has stopped.
    try { audioCtxRef.current?.close() } catch { /* already closed */ }
    audioCtxRef.current = null
  }

  /** Note that speech was just heard, wherever the signal came from. */
  function noteVoice() {
    heardAtRef.current = Date.now()
    heardAnythingRef.current = true
  }

  /**
   * Watch for the end of the sentence and stop on its own.
   * `stopFn` is passed in because `stop` is defined below this point.
   */
  function watchForSilence(stopFn) {
    heardAtRef.current = Date.now()
    heardAnythingRef.current = false
    const startedAt = Date.now()

    silenceRef.current = setInterval(() => {
      const now = Date.now()
      if (heardAnythingRef.current) {
        if (now - heardAtRef.current >= SILENCE_MS) stopFn()
      } else if (now - startedAt >= NO_SPEECH_MS) {
        stopFn()
      }
    }, 250)
  }

  /**
   * Listen to the live microphone stream and call noteVoice() while anyone is
   * speaking. Analysing the stream is read-only and does not compete for the
   * microphone the way a second recorder would.
   */
  function listenForVoice(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)

      const rms = () => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        return Math.sqrt(sum / buf.length)
      }

      const startedAt = Date.now()
      let floor = 0            // the room, learned over the first CALIBRATE_MS
      let threshold = VOICE_RMS
      let calibrated = false

      analyserRef.current = setInterval(() => {
        const level = rms()

        if (Date.now() - startedAt < CALIBRATE_MS) {
          // Still listening to the room. Anything genuinely loud in this
          // window is almost certainly the user starting to talk straight
          // away, so it counts as speech rather than as background.
          floor = Math.max(floor, level)
          if (level > Math.max(VOICE_RMS, floor * NOISE_FACTOR)) noteVoice()
          return
        }

        // Set once, on the first tick after calibration. A flag rather than
        // comparing against VOICE_RMS, which stays equal to it in a quiet room.
        if (!calibrated) {
          threshold = Math.max(VOICE_RMS, floor * NOISE_FACTOR)
          calibrated = true
        }
        if (level > threshold) noteVoice()
      }, 100)
    } catch {
      // No analyser: the recording still works, it just waits to be stopped.
    }
  }

  // Recognition holds the microphone too; abandoning it without this leaves the
  // browser listening.
  function abortSpeech() {
    speechRef.current?.abort()
    speechRef.current = null
  }

  // Releasing the microphone is not optional. Without this, closing the voice
  // panel mid-recording leaves the mic live and the browser's recording
  // indicator on, with nothing in the UI to explain why.
  function releaseMic() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  useEffect(() => () => { clearTimers(); abortSpeech(); releaseMic() }, [])

  async function start() {
    if (listening) { stop(); return }   // tap-to-toggle: second tap = stop
    setError(null)
    setTranscript('')
    setElapsedMs(0)
    setPartial('')
    setEngine(null)
    chunksRef.current = []
    readyRef.current  = false

    // ── Free path: recognition on its own ────────────────────────────────
    // WebKit has one microphone consumer, so running the recorder alongside
    // starved both. Running recognition alone removes the contention instead
    // of avoiding it, and keeps these users off the paid Whisper path — which
    // is roughly three quarters of what the AI costs.
    const soloLang = webSpeechLangFor(languageRef.current)
    if (!fallbackRef.current && webSpeechSupported() && webSpeechEnabled()
        && soloLang && webSpeechNeedsSolo()) {
      // Every partial is a sign somebody is still talking — the only such
      // signal available here, since this path deliberately opens no stream.
      const handle = startWebSpeech({
        lang: soloLang,
        onPartial: t => { setPartial(t); if (t) noteVoice() },
      })
      if (handle) {
        speechRef.current = handle
        soloRef.current   = true
        startTimeRef.current = Date.now()
        setListening(true)
        setEngine('browser')
        watchForSilence(() => stop())
        tickRef.current = setInterval(() => {
          setElapsedMs(Date.now() - (startTimeRef.current || 0))
        }, 200)
        autoStopRef.current = setTimeout(() => {
          setError('Stopped after 2 minutes — that is the longest note we can send.')
          stop()
        }, MAX_MS)
        return
      }
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access requires HTTPS. Open the app via https:// or use localhost.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      if (!stream.getAudioTracks().length) {
        releaseMic()
        throw new Error('No microphone was found. Check that one is connected and selected.')
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        clearTimers()
        releaseMic()
        const elapsed = Date.now() - (startTimeRef.current || 0)
        const blob    = new Blob(chunksRef.current, { type: mimeType })

        // ── 1. What did the browser hear? ───────────────────────────────────
        // Recognition ran alongside the recording rather than instead of it, so
        // if the browser comes back empty we already hold the audio and can
        // fall back without making the user say it a second time.
        let web = { text: '' }
        if (speechRef.current) {
          speechRef.current.stop()
          web = await speechRef.current.result
          speechRef.current = null
        }

        // Deliberately not acting on web.denied here. Recognition can report
        // 'not-allowed' when the browser's SPEECH SERVICE is unavailable or
        // blocked by policy, which has nothing to do with the microphone --
        // and getUserMedia succeeded a moment ago, so the mic plainly is
        // allowed. Treating that as a denial threw away a perfectly good
        // recording and showed a permission error for a permission the user
        // had already granted. Real denial is caught in start()'s catch,
        // where getUserMedia itself throws NotAllowedError.
        if (web.denied) {
          console.warn('Speech recognition reported not-allowed; using Whisper for this recording.')
        }
        if (web.text) {
          setPartial('')
          setEngine('browser')
          setTranscript(web.text)
          onTranscript(web.text)
          return
        }

        // ── 2. Fall back to Whisper with the audio we kept ──────────────────
        setPartial('')
        // Only a genuinely empty capture is rejected here. Everything that has
        // audio in it goes to Whisper, which is better at judging it than a
        // byte count is.
        if (!chunksRef.current.length || blob.size < MIN_BYTES) {
          // getUserMedia already succeeded, so permission is not the problem
          // and telling the user to check it sends them somewhere useless.
          //
          // Empty WHILE recognition was running means the two were competing
          // for the microphone. This attempt's audio is gone, but the next one
          // need not be: remember it, so the retry skips recognition entirely
          // and goes straight to Whisper.
          if (usedRecognitionRef.current) {
            noteWebSpeechStarvedRecording()
            setError('That did not record — your browser was using the microphone for its own speech recognition. Turned that off; tap the mic and try once more.')
          } else {
            setError('That recording came through empty — check which microphone is selected, or that it is not muted, then try again.')
          }
          return
        }
        if (elapsed < MIN_MS) {
          setError('That was a tap rather than a recording — hold on while you speak, then tap again.')
          return
        }

        setTranscribing(true)
        try {
          const text = (await transcribeAudio(blob, undefined, languageRef.current))?.trim()
          setEngine('whisper')
          setTranscript(text)
          if (text) onTranscript(text)
          else setError('No speech detected — please try again.')
        } catch (e) {
          // Whisper itself failed. A quota message, a stopped request and a
          // dropped connection are all dropped inside reportHandled, so what
          // reaches the Errors tab is transcription genuinely breaking.
          reportHandled(e, { view })
          setError(e.message)
        } finally {
          setTranscribing(false)
        }
      }

      // Free recognition in parallel, when the browser has it, the user has not
      // opted out, and we have a language to give it (the Web Speech API cannot
      // auto-detect). Whisper covers every case this does not.
      const bcp47 = webSpeechLangFor(languageRef.current)
      speechRef.current = (webSpeechSupported() && webSpeechEnabled() && bcp47)
        ? startWebSpeech({ lang: bcp47, onPartial: t => { setPartial(t); if (t) noteVoice() } })
        : null
      // Recorded now, because speechRef is cleared before onstop reads it.
      usedRecognitionRef.current = !!speechRef.current

      recorder.start(250)   // collect data every 250 ms
      startTimeRef.current = Date.now()
      readyRef.current     = true
      setListening(true)

      // Stop when the sentence ends, so the whole interaction is one tap.
      // Tapping the mic again still stops it early, for anyone who would
      // rather not wait.
      listenForVoice(stream)
      watchForSilence(() => stop())

      // Show the user that something is being captured. Without this the only
      // feedback is a pulsing button, which looks the same whether the
      // microphone is working or muted.
      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - (startTimeRef.current || 0))
      }, 200)

      // A forgotten recording would otherwise grow until the server rejects it.
      autoStopRef.current = setTimeout(() => {
        setError('Stopped after 2 minutes — that is the longest note we can send.')
        stop()
      }, MAX_MS)
    } catch (e) {
      clearTimers()
      abortSpeech()
      releaseMic()
      if (e.name === 'NotAllowedError') {
        setError('Microphone access denied. Allow it for this site in your browser settings, then try again.')
      } else if (e.name === 'NotFoundError') {
        setError('No microphone was found. Check that one is connected and selected.')
      } else {
        // Not a denied permission and not a missing microphone -- both are
        // handled above. Whatever is left is unexplained.
        reportHandled(e, { view })
        setError(`Could not start recording: ${e.message}`)
      }
    }
  }

  function stop() {
    clearTimers()

    // Solo: nothing was recorded, so there is only what was heard.
    if (soloRef.current) {
      soloRef.current = false
      setListening(false)
      const handle = speechRef.current
      speechRef.current = null
      if (!handle) return
      handle.stop()
      handle.result.then(web => {
        setPartial('')
        if (web.text) { setTranscript(web.text); onTranscript(web.text); return }
        // Nothing heard and nothing recorded — ask for one more go, and record
        // that one so Whisper can take it.
        fallbackRef.current = true
        setEngine(null)
        setError("Didn't catch that. Tap the mic and try again — Pippy will listen a different way this time.")
      })
      return
    }

    if (readyRef.current && mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()   // onstop releases the mic
    } else {
      abortSpeech()
      releaseMic()
    }
    readyRef.current = false
    setListening(false)
  }

  return { listening, transcribing, transcript, error, elapsedMs, partial, engine, start, stop }
}

