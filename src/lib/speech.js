// src/lib/speech.js
// The browser's own speech recognition, used in front of the Whisper proxy.
//
// WHERE THE AUDIO GOES. This is not on-device recognition, whatever the API
// name suggests. Chrome streams the audio to Google's speech servers; Safari
// sends it to Apple's. It is free to us and costs the user nothing, but it is a
// third party receiving their voice, which is why it can be switched off and
// why the UI says so plainly rather than quietly saving us an API call.
//
// Whisper stays as the fallback, and remains the only path when the browser has
// no support, when the user opts out, or when recognition returns nothing.

// Whisper takes ISO-639-1 ('hi'); the Web Speech API wants BCP-47 ('hi-IN').
// Indian locales throughout — this app's users are in India, and en-IN handles
// Indian-accented English markedly better than en-US.
const BCP47 = {
  en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN',
  kn: 'kn-IN', ml: 'ml-IN', bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-Guru-IN',
}

// How long to wait for recognition to settle after stop() before giving up on
// it. Recognition has already been listening for the whole recording, so this
// is only the tail-end flush, not thinking time.
const SETTLE_MS = 1500

export const WEB_SPEECH_OPT_OUT_KEY = 'pippy_web_speech_off'

function ctor() {
  return typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
    : null
}

// WebKit can use recognition — but only on its own.
//
// The failure that started this was never "recognition is broken on WebKit".
// It was that recognition and a MediaRecorder were running AT THE SAME TIME,
// and on WebKit there is effectively one microphone consumer: the recording
// came back empty and recognition returned nothing, both at once.
//
// The first fix was to switch recognition off for all of WebKit and always use
// Whisper there. That worked, and it put every iPhone and every Safari user on
// the paid path — transcription is about three quarters of the AI bill, so
// that was the most expensive line in the app made more expensive.
//
// So WebKit runs recognition SOLO instead: no recorder alongside it, which
// removes the contention by construction rather than by avoidance. Nothing is
// competing, so nothing is starved. The cost is that there is no audio to fall
// back on — if WebKit hears nothing, the caller asks for one more go and uses
// the recorder that time.
//
// iPadOS 13+ reports itself as Macintosh, hence the touch-points check.
function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) ||
         (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
}

// Chrome, Edge, Opera and the iOS wrappers all carry "Safari" in their user
// agent, so Safari is what remains once they are ruled out.
function isSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|FxIOS|FxiOS|Android/.test(ua)
}

/**
 * True where recognition must not share the microphone with a recorder.
 *
 * Every browser on iOS is WebKit, Chrome and Firefox there included, so the
 * platform test and the browser test are both needed.
 */
export function webSpeechNeedsSolo() {
  return isIOS() || isSafari()
}

// Set when a recording came back empty while recognition was running: the
// signature of the two competing for the microphone. Remembered per device
// because it is a property of that browser, not of that recording. It is the
// net under everything above — for the combinations nobody has tested.
export const WEB_SPEECH_STARVED_KEY = 'pippy_web_speech_starved'

export function noteWebSpeechStarvedRecording() {
  try { localStorage.setItem(WEB_SPEECH_STARVED_KEY, '1') } catch { /* private mode */ }
}

export function webSpeechStarvedBefore() {
  try { return localStorage.getItem(WEB_SPEECH_STARVED_KEY) === '1' } catch { return false }
}

export function webSpeechSupported() {
  return !!ctor() && !webSpeechStarvedBefore()
}

export function webSpeechEnabled() {
  try { return localStorage.getItem(WEB_SPEECH_OPT_OUT_KEY) !== '1' } catch { return true }
}

/**
 * The BCP-47 tag to recognise with, or null if we should not use Web Speech.
 *
 * The Web Speech API cannot auto-detect — it needs a language up front. So when
 * the user has chosen "Detect automatically" we fall back to the browser's own
 * language, and only if we recognise it. Anything else goes to Whisper, which
 * genuinely does detect.
 */
export function webSpeechLangFor(code) {
  if (code && code !== 'auto') return BCP47[code] || null
  const base = (navigator.language || '').split('-')[0].toLowerCase()
  return BCP47[base] || null
}

/**
 * Start recognition. Returns a handle:
 *   .stop()   finish and resolve with whatever was heard
 *   .abort()  give up immediately, resolve with ''
 *   .result   Promise<string> — '' means "heard nothing", never an error
 *
 * It never rejects. A failure here is not a failure of the feature: it means
 * "use Whisper instead", and the caller has the recorded audio to do that with.
 */
export function startWebSpeech({ lang, onPartial } = {}) {
  const Ctor = ctor()
  if (!Ctor) return null

  const rec = new Ctor()
  rec.lang            = lang || 'en-IN'
  rec.continuous      = true    // do not cut off at the first pause mid-sentence
  rec.interimResults  = true    // so the user sees words appear as they speak
  rec.maxAlternatives = 1

  let finalText = ''
  let settled   = false
  let resolve
  const result = new Promise(r => { resolve = r })
  const done = (text) => { if (!settled) { settled = true; resolve(text) } }

  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else           interim   += r[0].transcript
    }
    onPartial?.((finalText + interim).trim())
  }

  // Every error path resolves empty rather than throwing, so the caller simply
  // moves on to Whisper. 'not-allowed' is the one exception worth distinguishing:
  // the microphone was refused, so Whisper would fail for the same reason.
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      done({ text: '', denied: true })
    } else {
      done({ text: '' })
    }
  }
  rec.onend = () => done({ text: finalText.trim() })

  try {
    rec.start()
  } catch {
    // Already started, or the browser refused. Whisper handles it.
    done({ text: '' })
    return { stop() {}, abort() {}, result }
  }

  return {
    stop() {
      // Safari does not reliably fire `onend` after `stop()`, and on iOS it
      // frequently fires neither `onend` nor `onerror` at all. Nothing else
      // resolves this promise, so the caller -- which does
      // `await handle.result` inside MediaRecorder's onstop -- waits forever:
      // the recording is never transcribed, no error is shown, and the panel
      // simply stops responding. That is the hang.
      //
      // So stop() is bounded. Whatever was heard by then is used, and an empty
      // result is not a failure -- it means "fall through to Whisper", which
      // the caller is already holding the audio for.
      const bail = setTimeout(() => done({ text: finalText.trim() }), SETTLE_MS)
      const clear = () => clearTimeout(bail)
      result.then(clear, clear)
      try { rec.stop() } catch { clear(); done({ text: finalText.trim() }) }
    },
    abort() { try { rec.abort() } catch { /* ignore */ } done({ text: '' }) },
    result,
  }
}
