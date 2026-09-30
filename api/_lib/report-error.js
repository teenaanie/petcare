// api/_lib/report-error.js
//
// Takes a scrubbed error report from a browser and stores it.
//
// Two things make this endpoint unusual, and both are deliberate.
//
// It accepts ANONYMOUS reports. A crash on the landing page, before anyone has
// signed in, is exactly the kind nobody would otherwise ever hear about;
// requiring a token would blind us to it. When a token is present the report is
// attributed, and when it is not the row simply has no user.
//
// It scrubs AGAIN, even though the browser already did. The client scrub is the
// one that matters, because it means the data never leaves the device. This one
// is here for the case where a report arrives from something that is not our
// current client: an old cached bundle, or anybody who found the URL.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY

// A crude ceiling on how much a single day can hold. The client caps itself at
// ten per session and de-duplicates, so reaching this means either something is
// very wrong or somebody is posting deliberately. Either way the table stops
// growing and the existing rows — the useful ones — are kept.
const MAX_PER_DAY = 500

const MAX = { name: 60, message: 300, stack: 1500, view: 40, path: 80, build: 20, browser: 40 }

/** The same redaction as the browser's, applied to whatever actually arrived. */
function scrub(text, limit) {
  if (!text) return null
  return String(text)
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/(?:\+?\d[\d\s-]{6,}\d)/g, '[number]')
    .replace(/([?#])[^\s"')]+/g, '$1[redacted]')
    .replace(/\b(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_[a-z]+_[\w-]+|sk-[\w-]+)/g, '[token]')
    .slice(0, limit)
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  if (!body?.name && !body?.message) return json({ error: 'Nothing to report' }, 400)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Attribute the report when we can, and carry on when we cannot. An invalid
  // or expired token is not a reason to reject a crash report.
  let userId = null
  const auth = req.headers.get('authorization') || ''
  if (auth.startsWith('Bearer ')) {
    try {
      const { data } = await supabase.auth.getUser(auth.slice(7))
      userId = data?.user?.id ?? null
    } catch { /* anonymous it is */ }
  }

  const { count, error: countErr } = await supabase
    .from('client_errors')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  if (!countErr && (count ?? 0) >= MAX_PER_DAY) {
    // Answer normally. Telling a caller they have hit a cap invites probing,
    // and the browser has nothing useful to do with the information anyway.
    return json({ ok: true }, 202)
  }

  const row = {
    user_id:     userId,
    fingerprint: scrub(body.fingerprint || `${body.name}|${body.message}`, 400),
    name:        scrub(body.name, MAX.name) || 'Error',
    message:     scrub(body.message, MAX.message),
    stack:       scrub(body.stack, MAX.stack),
    view:        scrub(body.view, MAX.view),
    path:        scrub(body.path, MAX.path),
    build:       scrub(body.build, MAX.build),
    browser:     scrub(body.browser, MAX.browser),
    online:      typeof body.online === 'boolean' ? body.online : null,
    occurred_at: Number.isNaN(Date.parse(body.at)) ? null : new Date(body.at).toISOString(),
  }

  const { error } = await supabase.from('client_errors').insert(row)
  if (error) {
    console.error('client error report failed to store:', error.message)
    return json({ error: 'Could not store report' }, 500)
  }
  return json({ ok: true }, 202)
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
