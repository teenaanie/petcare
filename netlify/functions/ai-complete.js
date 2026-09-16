// netlify/functions/ai-complete.js
// Proxies OpenAI chat completions server-side so the API key is never exposed
// to the browser. Authenticates the caller and rate-limits per user per month,
// exactly as analyze-document.js does.
//
// Three components used to call api.openai.com directly with a VITE_-prefixed
// key. Vite compiles those into the bundle, so the key was readable by anyone
// who opened the site — and billable to us per call.
//
// The PROMPT IS BUILT HERE, never accepted from the client. A handler that
// forwards a caller-supplied prompt is an open relay to our OpenAI account:
// anyone with a free account on the app could use it to run whatever they
// liked at our expense. The client sends structured data; we compose the words.

import { createClient } from '@supabase/supabase-js'

const OPENAI_KEY   = process.env.OPENAI_API_KEY        // never VITE_ — server only
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY  // service role — server only
const AI_LIMIT     = parseInt(process.env.MONTHLY_AI_LIMIT || '100')  // calls per user per month

// ── Prompt builders ──────────────────────────────────────────────────────────
// Moved verbatim from the components so behaviour is unchanged.

function healthSummaryPrompt({ pet = {}, data = {}, periodLabel = 'period' }) {
  const lines = []
  lines.push(`Pet name: ${pet.name}`)
  lines.push(`Species: ${pet.species || 'Unknown'}`)
  lines.push(`Breed: ${pet.breed || 'Unknown'}`)
  if (pet.dob) {
    const ageYears = Math.floor((Date.now() - new Date(pet.dob)) / (1000 * 60 * 60 * 24 * 365))
    lines.push(`Age: ${ageYears} years`)
  }
  if (pet.weight) lines.push(`Recorded weight: ${pet.weight} kg`)

  lines.push(`\n--- Data from the last ${periodLabel} ---`)

  const arr = k => Array.isArray(data[k]) ? data[k] : []

  if (arr('records').length) {
    lines.push('\nMEDICAL VISITS:')
    arr('records').forEach(r => lines.push(`  • [${r.date || '?'}] ${r.title || r.type} — ${r.description || ''}${r.vet ? ` (Vet: ${r.vet})` : ''}`))
  }
  if (arr('vaccinations').length) {
    lines.push('\nVACCINATIONS GIVEN:')
    arr('vaccinations').forEach(v => lines.push(`  • ${v.name} on ${v.dateGiven || '?'}${v.nextDue ? ` — next due ${v.nextDue}` : ''}`))
  }
  if (arr('medicines').length) {
    lines.push('\nMEDICINES (active/recent):')
    arr('medicines').forEach(m => lines.push(`  • ${m.name} ${m.dosage || ''} ${m.frequency || ''} [${m.category}]${m.isDone ? ' (completed)' : ''}${m.nextDue ? ` — next due ${m.nextDue}` : ''}`))
  }
  if (arr('weightLogs').length) {
    lines.push('\nWEIGHT READINGS:')
    arr('weightLogs').forEach(w => lines.push(`  • ${w.date}: ${w.weight} kg`))
  }
  if (arr('allergies').length) {
    lines.push('\nKNOWN ALLERGIES:')
    arr('allergies').forEach(a => lines.push(`  • ${a.allergen} (${a.severity}) — ${a.type}`))
  }
  if (arr('upcomingReminders').length) {
    lines.push('\nUPCOMING REMINDERS:')
    arr('upcomingReminders').forEach(r => lines.push(`  • ${r.type} on ${r.dueDate}`))
  }

  return `You are a veterinary health assistant. Based on the pet health data below, provide a concise health summary for the owner.

${lines.join('\n')}

Return a JSON object with this exact structure:
{
  "overallStatus": "Good" | "Monitor" | "Attention Needed",
  "statusReason": "one sentence explaining the status",
  "observations": [
    { "type": "positive" | "warning" | "info", "text": "observation about something specific in the data" }
  ],
  "findings": {
    "good": ["thing that is healthy or on track", "another positive finding"],
    "concerns": ["something that needs attention or monitoring", "another concern if any"]
  },
  "weightTrend": "brief comment on weight trend or null if no data",
  "upcomingActions": [
    { "action": "what to do", "dueDate": "YYYY-MM-DD or timeframe like 'Next month'", "priority": "high" | "medium" | "low" }
  ],
  "vetVisitRecommended": true | false,
  "vetVisitReason": "reason if recommended, null if not",
  "vetQuestions": ["Question 1?", "Question 2?"]
}

Rules:
- findings.good: 2-4 specific positive things from the data (vaccinations up to date, weight stable, no allergies, regular vet visits etc.)
- findings.concerns: 1-4 specific concerns or gaps (overdue vaccines, weight change, missing records, no recent vet visit etc.). Empty array [] if everything looks fine.
- observations: 3-6 bullet points mixing positive and warnings. Be specific — reference actual data.
- upcomingActions: only things due in the near future (overdue meds, upcoming vaccines, follow-ups)
- vetQuestions: 4-6 specific questions the owner should ask at their next appointment. Reference actual data.
- vetVisitRecommended: true if there are overdue items, concerning trends, or anything needing professional review
- Keep language plain, warm, and non-alarmist. This is for a pet owner, not a clinician.
- Return valid JSON only.`
}

function voiceReminderPrompt({ transcript = '' }) {
  const today = new Date().toISOString().split('T')[0]
  return `Today is ${today}. A pet owner said: "${transcript}"

Extract reminder details and return ONLY valid JSON:
{
  "type": "Vaccination|Grooming|Vet Checkup|Medication|Other",
  "dueDate": "YYYY-MM-DD",
  "frequency": "Once|Weekly|Monthly|Yearly",
  "notes": "any extra context from what they said"
}

Rules:
- Convert relative dates: "next week" = 7 days from today, "tomorrow" = 1 day, "in 3 months" = 90 days, etc.
- If no date mentioned, leave dueDate empty string.
- Pick the closest matching type from the list.
- Return valid JSON only.`
}

function vetQuestionsPrompt({ parsed = {}, petName = 'this pet' }) {
  const parts = [`Pet: ${petName}`, `Report type: ${parsed.type}`, `Summary: ${parsed.summary}`]
  if (parsed.abnormalities?.length)
    parts.push('Abnormal: ' + parsed.abnormalities.map(a => `${a.parameter} ${a.value}${a.unit} (${a.status}, ${a.severity})`).join('; '))
  if (parsed.medicalRecord?.title) parts.push(`Diagnosis: ${parsed.medicalRecord.title}`)
  if (parsed.medicines?.length)    parts.push('Medicines: ' + parsed.medicines.map(m => `${m.name} ${m.dosage || ''}`).join(', '))
  if (parsed.vaccinations?.length) parts.push('Vaccines: ' + parsed.vaccinations.map(v => v.name).join(', '))
  if (parsed.allergy)              parts.push(`Allergy: ${parsed.allergy.allergen} (${parsed.allergy.severity})`)

  return `Based on this vet report for ${petName}:\n${parts.join('\n')}\n\nGenerate 5-7 specific questions the owner should ask their vet. Each must reference something in this report. Write in plain language. Return ONLY a valid JSON array of strings: ["Question 1?", ...]`
}

// Only these tasks exist. An unknown task is rejected rather than passed on —
// the set of things this endpoint can be asked to do is closed by design.
const TASKS = {
  health_summary: { build: healthSummaryPrompt, maxTokens: 1500, json: true  },
  voice_reminder: { build: voiceReminderPrompt, maxTokens: 200,  json: false },
  vet_questions:  { build: vetQuestionsPrompt,  maxTokens: 500,  json: false },
}

// ── HTTP helpers (same shape as analyze-document.js) ─────────────────────────

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

// ── Handler ──────────────────────────────────────────────────────────────────

// createClient throws "supabaseUrl is required" when these are unset, which
// surfaced as an opaque 500 FUNCTION_INVOCATION_FAILED on every authenticated
// request — the deploy looked fine and every real user hit a server error.
// Check first so a missing variable says so.
function missingEnv() {
  const missing = []
  if (!SUPABASE_URL) missing.push('SUPABASE_URL')
  if (!SERVICE_KEY)  missing.push('SUPABASE_SERVICE_KEY')
  return missing
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  if (!OPENAI_KEY)              return json({ error: 'AI features are not configured on this deployment.' }, 503)

  // 1. Authenticate
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  const missing = missingEnv()
  if (missing.length) {
    console.error('Not configured — missing env: ' + missing.join(', '))
    return json({ error: `Server is misconfigured (missing ${missing.join(', ')}). Set it in the host's environment variables and redeploy.` }, 503)
  }

  if (!token) return json({ error: 'Missing auth token' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // 2. Parse and validate the task
  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }

  const task = TASKS[body?.task]
  if (!task) return json({ error: 'Unknown task' }, 400)

  // 3. Rate limit, counted per task so one feature cannot exhaust the others
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const { count, error: countErr } = await supabase
    .from('api_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('type', body.task)
    .gte('created_at', startOfMonth)
  if (countErr) console.error('Rate limit check failed:', countErr)

  if ((count || 0) >= AI_LIMIT) {
    return json({
      error: `Monthly limit reached (${AI_LIMIT} per month for this feature).`,
      limitReached: true, used: count, limit: AI_LIMIT,
    }, 429)
  }

  // 4. Call OpenAI with OUR prompt
  const prompt = task.build(body)
  let out
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: task.maxTokens,
        ...(task.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    out = await res.json()
    if (!res.ok) return json({ error: out?.error?.message || `OpenAI error ${res.status}` }, 502)
  } catch (e) {
    return json({ error: `Could not reach OpenAI: ${e.message}` }, 502)
  }

  const raw = out.choices?.[0]?.message?.content
  if (!raw) return json({ error: 'Empty response — please try again.' }, 502)

  let result
  try {
    result = JSON.parse(raw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, ''))
  } catch {
    return json({ error: 'Could not parse the AI response. Please try again.' }, 502)
  }

  // 5. Record usage. A failure here must not fail the call the user already got.
  const { error: logErr } = await supabase.from('api_usage').insert({ user_id: user.id, type: body.task })
  if (logErr) console.error('Usage logging failed:', logErr)

  return json({ result })
}
