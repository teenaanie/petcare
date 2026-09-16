// src/lib/ai.js
// The browser's only route to OpenAI. There is deliberately no API key in this
// file or anywhere else under src/: Vite inlines import.meta.env.VITE_* into the
// public bundle, so a key referenced here would be readable by every visitor and
// billable to us. The key lives in the serverless functions, which authenticate
// the caller and cap usage per month.
//
// Callers pass structured data; the server composes the prompt. See
// netlify/functions/ai-complete.js.

import { supabase } from './supabase.js'

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

async function post(path, body, session) {
  const headers = await authHeaders(session)
  let res
  try {
    res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (e) {
    // A network failure here reads to the user as the feature being broken, so
    // say which part failed rather than surfacing "Failed to fetch".
    throw new Error(`Could not reach the server. Check your connection and try again.`)
  }

  let data
  try { data = await res.json() } catch { data = {} }

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
 * Sent as base64 JSON rather than multipart — see netlify/functions/transcribe.js
 * for why that matters on Vercel.
 */
export async function transcribeAudio(blob, session) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  const { text } = await post('/api/transcribe', { audio: base64, mimeType: blob.type }, session)
  return text
}
