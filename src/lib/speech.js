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

// iOS is deliberately excluded even though Safari defines the constructor.
//
// On iOS there is effectively one microphone consumer at a time, and starting
// recognition takes it from the MediaRecorder that is running alongside. The
// recording comes back empty, recognition itself often returns nothing, and
// the two failures together look exactly like "it is not capturing my voice".
// Safari also does not support `continuous`, and frequently fires neither
// `onend` nor `onerror` after stop() -- the bounded stop() below covers the
// hang, but there is nothing to be gained by running recognition here at all.
//
// Whisper is the better path on iOS regardless: it gets the whole recording,
// it actually detects the language, and it is already the fallback everywhere
// else. So on iOS we simply always use it.
//
// iPadOS 13+ reports itself as Macintosh, so the touch check is needed too.
function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) ||
         (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
}

export function webSpeechSupported() {
  return !!ctor() && !isIOS()
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
