// scripts/test-speech.mjs
//
//   npm run test:speech
//
// Guards the two failures that made voice input hang on a phone.
//
// The important one is the silent hang. The caller does `await handle.result`
// inside MediaRecorder's onstop, so if that promise never settles the whole
// transcription path stops dead: no text, no error, no spinner — the panel
// just stops responding. Safari on iOS reaches that state routinely by firing
// neither `onend` nor `onerror` after stop(). A unit test is the only cheap
// way to prove the bound holds, because reproducing it needs an iPhone.

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// ── Minimal DOM stubs ────────────────────────────────────────────────────────
// A recognition object that accepts start() and stop() and then does nothing
// at all, which is precisely the iOS behaviour being defended against.
class DeadRecognition {
  start() {}
  stop() {}          // fires no onend, no onerror — ever
  abort() {}
}

function install({ userAgent, maxTouchPoints = 0, Recognition = DeadRecognition }) {
  globalThis.window = { SpeechRecognition: Recognition }
  // Node 24 defines its own `navigator` as a getter-only global, so plain
  // assignment throws — it has to be redefined.
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent, maxTouchPoints, language: 'en-IN' },
    configurable: true, writable: true,
  })
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
}

const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131 Safari/537.36'
const IPHONE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1'
const IPADOS  = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.5 Safari/605.1.15'

install({ userAgent: DESKTOP })
const { webSpeechSupported, startWebSpeech, webSpeechLangFor } =
  await import('../src/lib/speech.js')

// ── Platform gating ──────────────────────────────────────────────────────────
check('desktop with a constructor: Web Speech is used', webSpeechSupported() === true)

install({ userAgent: IPHONE })
check('iPhone: Web Speech is skipped, Whisper handles it', webSpeechSupported() === false)

install({ userAgent: IPADOS, maxTouchPoints: 5 })
check('iPadOS (reports as Macintosh): skipped via touch points', webSpeechSupported() === false)

install({ userAgent: DESKTOP, maxTouchPoints: 0 })
check('desktop Mac is not mistaken for an iPad', webSpeechSupported() === true)

globalThis.window = {}
check('no constructor at all: not supported', webSpeechSupported() === false)

// ── The hang ─────────────────────────────────────────────────────────────────
install({ userAgent: DESKTOP })
{
  const handle = startWebSpeech({ lang: 'en-IN' })
  const started = Date.now()
  handle.stop()

  const outcome = await Promise.race([
    handle.result.then(r => ({ settled: true, r })),
    new Promise(res => setTimeout(() => res({ settled: false }), 5000)),
  ])
  const ms = Date.now() - started

  check('stop() settles even when recognition never fires onend',
        outcome.settled === true,
        outcome.settled ? `after ${ms}ms` : 'STILL PENDING after 5s — this is the hang')
  check('it settles promptly, not after a long stall',
        outcome.settled && ms < 3000, `${ms}ms`)
  check('an unheard recording resolves empty, so the caller falls back to Whisper',
        outcome.settled && outcome.r?.text === '', JSON.stringify(outcome.r))
}

// abort() must settle too — it is what cleanup runs on unmount.
{
  const handle = startWebSpeech({ lang: 'en-IN' })
  handle.abort()
  const settled = await Promise.race([
    handle.result.then(() => true),
    new Promise(res => setTimeout(() => res(false), 2000)),
  ])
  check('abort() settles immediately', settled === true)
}

// A recognition that DOES answer must not be delayed by the bound.
{
  class LiveRecognition {
    start() {}
    stop() { setTimeout(() => this.onend?.(), 10) }
    abort() {}
  }
  install({ userAgent: DESKTOP, Recognition: LiveRecognition })
  const handle = startWebSpeech({ lang: 'en-IN' })
  const t = Date.now()
  handle.stop()
  await handle.result
  const ms = Date.now() - t
  check('a working browser is not slowed down by the timeout', ms < 500, `${ms}ms`)
}

// ── Language mapping ─────────────────────────────────────────────────────────
install({ userAgent: DESKTOP })
check("explicit 'hi' maps to hi-IN", webSpeechLangFor('hi') === 'hi-IN')
check("unknown code returns null so Whisper takes it", webSpeechLangFor('zz') === null)

const failed = results.filter(r => !r).length
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
