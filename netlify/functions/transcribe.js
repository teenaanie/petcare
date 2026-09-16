// netlify/functions/transcribe.js
// Proxies OpenAI Whisper transcription server-side. Same auth and rate-limit
// shape as analyze-document.js and ai-complete.js.
//
// The audio arrives as base64 inside a JSON body rather than as multipart form
// data. That is deliberate: api/_adapt.js re-serialises the body as JSON when
// bridging Vercel's (req, res) to the Web-standard Request these functions
// expect, which would corrupt a multipart payload. Base64 in JSON survives that
// unchanged, so one implementation keeps working on both hosts. We rebuild the
// multipart form here, where OpenAI wants it.

import { createClient } from '@supabase/supabase-js'

const OPENAI_KEY   = process.env.OPENAI_API_KEY        // never VITE_ — server only
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY  // service role — server only
const AI_LIMIT     = parseInt(process.env.MONTHLY_AI_LIMIT || '100')

// Base64 inflates by about a third, so this is roughly 3 MB of audio — minutes
// of speech at the bitrates a browser recorder produces, and well inside the
// platform body limits.
const MAX_BASE64_CHARS = 4_000_000

// Whisper accepts these. Anything else is rejected rather than forwarded.
const AUDIO_TYPES = {
  'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3',
  'audio/mpga': 'mp3',  'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',   'audio/x-wav': 'wav', 'audio/ogg': 'ogg',
}

function cors(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}
const json = (obj, status = 200) => cors(JSON.stringify(obj), status)

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  if (!OPENAI_KEY)              return json({ error: 'Voice input is not configured on this deployment.' }, 503)

  // 1. Authenticate
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing auth token' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // 2. Parse and validate the audio
  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }

  const { audio, mimeType } = body || {}
  if (!audio || typeof audio !== 'string') return json({ error: 'No audio supplied' }, 400)
  if (audio.length > MAX_BASE64_CHARS)     return json({ error: 'Recording is too long. Please keep it under a few minutes.' }, 413)

  // Browsers append codec parameters, e.g. "audio/webm;codecs=opus".
  const baseType = String(mimeType || '').split(';')[0].trim().toLowerCase()
  const ext = AUDIO_TYPES[baseType]
  if (!ext) return json({ error: 'Unsupported audio format' }, 415)

  let bytes
  try {
    bytes = Buffer.from(audio, 'base64')
  } catch {
    return json({ error: 'Audio could not be decoded' }, 400)
  }
  if (!bytes.length) return json({ error: 'Audio could not be decoded' }, 400)

  // 3. Rate limit
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const { count, error: countErr } = await supabase
    .from('api_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('type', 'transcribe')
    .gte('created_at', startOfMonth)
  if (countErr) console.error('Rate limit check failed:', countErr)

  if ((count || 0) >= AI_LIMIT) {
    return json({
      error: `Monthly limit reached (${AI_LIMIT} voice notes per month).`,
      limitReached: true, used: count, limit: AI_LIMIT,
    }, 429)
  }

  // 4. Call Whisper
  let out
  try {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: baseType }), `recording.${ext}`)
    form.append('model', 'whisper-1')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },  // no Content-Type — FormData sets the boundary
      body: form,
    })
    out = await res.json()
    if (!res.ok) return json({ error: out?.error?.message || `Transcription failed (${res.status})` }, 502)
  } catch (e) {
    return json({ error: `Could not reach OpenAI: ${e.message}` }, 502)
  }

  const text = (out.text || '').trim()
  if (!text) return json({ error: "Couldn't hear anything. Please try again." }, 422)

  // 5. Record usage. A failure here must not fail the call the user already got.
  const { error: logErr } = await supabase.from('api_usage').insert({ user_id: user.id, type: 'transcribe' })
  if (logErr) console.error('Usage logging failed:', logErr)

  return json({ text })
}
