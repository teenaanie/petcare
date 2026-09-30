// src/lib/ai.js
// The browser's only route to OpenAI. There is deliberately no API key in this
// file or anywhere else under src/: Vite inlines import.meta.env.VITE_* into the
// public bundle, so a key referenced here would be readable by every visitor and
// billable to us. The key lives in the serverless functions, which authenticate
// the caller and cap usage per month.
//
// Callers pass structured data; the server composes the prompt. See
// api/_lib/ai-complete.js.

import { supabase } from './supabase.js'
import { transcriptionPrompt } from './petMeds.js'

// The proxies need to know who is asking, both to reject anonymous callers and
// to count usage against the right account. Callers that already hold a session
// pass it; the rest let us look it up, so this does not have to be threaded
// through every component that wants an AI feature.
async function authHeaders(session) {
  let token = session?.access_token
  if (!token && supabase) {
    const { data } = await supabase.auth.getSession()
    token = data?.session?.access_token
  }
  if (!token) throw new Error('Please sign in to use this feature.')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

// How long to wait before giving up on a request.
//
// fetch() has no timeout of its own. A connection that is refused or dropped
// rejects quickly, but one that STALLS -- a handover between wifi and mobile,
// a captive portal, a TCP connection that stays open and silent -- never
// settles at all. `await fetch(...)` then waits forever, the caller's spinner
// never stops, and no error is ever shown. That is what "the voice feature
// hung" looks like from the outside: the mic stops, nothing happens, and there
// is nothing to tap.
//
// Transcription gets longer than a chat call because it uploads up to two
// minutes of audio and then waits for Whisper; a chat parse is round-trip only.
const TIMEOUT_MS = { complete: 45_000, transcribe: 90_000 }

async function post(path, body, session, timeoutMs = TIMEOUT_MS.complete) {
  const headers = await authHeaders(session)

  // One controller for the whole exchange. Reading the body can stall just as
  // the connection can, so the timer is not cleared until the JSON is parsed.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res
  try {
    res = await fetch(path, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (e.name === 'AbortError') {
      throw new Error(
        `That took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped. ` +
        `Your connection may have dropped. Tap to try again.`)
    }
    // A network failure here reads to the user as the feature being broken, so
    // say which part failed rather than surfacing "Failed to fetch".
    throw new Error(`Could not reach the server. Check your connection and try again.`)
  }

  let data
  try { data = await res.json() } catch { data = {} }
  finally { clearTimeout(timer) }

  if (!res.ok) {
    const err = new Error(data.error || `Server error ${res.status}`)
    // The scanner already distinguishes a quota message from a real failure.
    if (data.limitReached) err.limitReached = true
    throw err
  }
  return data
}

/**
 * Run a server-defined AI task.
 * @param {'health_summary'|'voice_reminder'|'vet_questions'} task
 * @param {object} payload structured inputs for that task's prompt builder
 * @param {object} [session] Supabase session; looked up if omitted
 */
export async function aiComplete(task, payload, session) {
  const { result } = await post('/api/ai-complete', { task, ...payload }, session)
  return result
}

/**
 * Transcribe recorded audio.
 * Sent as base64 JSON rather than multipart — see api/_lib/transcribe.js
 * for why that matters on Vercel.
 */
export async function transcribeAudio(blob, session, language) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    // Bounded for the same reason as the request below: onerror covers a read
    // that FAILS, and nothing covers a read that simply never finishes.
    const bail = setTimeout(
      () => { try { reader.abort() } catch { /* already done */ }
              reject(new Error('That recording could not be read. Please try again.')) },
      20_000)
    const done = fn => (...a) => { clearTimeout(bail); fn(...a) }
    reader.onload  = done(() => resolve(String(reader.result).split(',')[1]))
    reader.onerror = done(reject)
    reader.onabort = done(() => reject(new Error('That recording could not be read. Please try again.')))
    reader.readAsDataURL(blob)
  })
  // `language` is the user's own choice. Omitted or 'auto' means Whisper
  // detects, which is what anyone who has not chosen should get.
  // The vocabulary of vaccine and medicine names, so Whisper spells them the
  // way the packet does. See src/lib/petMeds.js — it biases, never constrains.
  const vocabulary = transcriptionPrompt()

  const { text } = await post('/api/transcribe',
    { audio: base64, mimeType: blob.type,
      ...(vocabulary ? { vocabulary } : {}),
      ...(language && language !== 'auto' ? { language } : {}) },
    session, TIMEOUT_MS.transcribe)
  return text
}
