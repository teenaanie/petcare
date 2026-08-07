// netlify/functions/analyze-document.js
// Proxies OpenAI vision calls server-side so the API key is never exposed to the browser.
// Also enforces per-user rate limiting and logs usage for cost tracking.

const { createClient } = require('@supabase/supabase-js')

const OPENAI_KEY    = process.env.OPENAI_API_KEY          // never VITE_ — server only
const SUPABASE_URL  = process.env.SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY    // service role key — server only
const SCAN_LIMIT    = parseInt(process.env.MONTHLY_SCAN_LIMIT || '30')  // scans per user per month

function buildPrompt() {
  const today = new Date().toISOString().split('T')[0]
  return `You are a veterinary record parser. Analyze this pet medical document image carefully.

TODAY'S DATE IS ${today}. Use this as your reference for what is past vs future.

⚠️ CRITICAL DATE RULES — these override everything else:
1. ONLY extract a date if you can CLEARLY and LITERALLY read every digit in the document. If ANY digit is unclear, return "" (empty string). NEVER guess, estimate, or use a date from memory.
2. Indian documents use DD/MM/YYYY format — convert correctly to YYYY-MM-DD. E.g. "06/08/2025" → "2025-08-06". "27/08/2026" → "2026-08-27".
3. For vaccinations: "dateGiven" must be a past date (before ${today}) found in the DATE GIVEN column only. "nextDue" must be a future date found in the NEXT DUE column only.
4. NEVER use MFG (manufacture date) or EXP (expiry date) from vaccine stickers as dateGiven or nextDue. Those are product manufacturing/expiry dates, not visit dates.
5. The image may be rotated or photographed at an angle. Correct for orientation before reading.
6. If you cannot read the full year (all 4 digits) from the document, return "" — do NOT assume the year.
7. Extract the ACTUAL vaccine product name from the sticker or document (e.g. "Felocell 3", "Nobivac", "Rabivax") — not generic labels like "Vaccine 1".

Return a JSON object:
{
  "type": "medical" | "vaccination" | "allergy" | "prescription" | "bill",
  "summary": "one-sentence summary",
  "medicalRecord": {
    "date": "YYYY-MM-DD or empty", "type": "Checkup|Illness|Surgery|Lab Result|Prescription|Other",
    "title": "diagnosis or procedure", "description": "details/symptoms/treatment/medications",
    "vet": "vet name or clinic", "cost": "number or empty"
  },
  "vaccinations": [
    { "name": "actual vaccine product name from label/text", "dateGiven": "YYYY-MM-DD or empty if unclear",
      "nextDue": "YYYY-MM-DD or empty if unclear",
      "batchNumber": "SER/lot number from sticker or empty", "vet": "vet name or empty", "notes": "" }
  ],
  "medicines": [
    { "name": "drug name e.g. Simparica, Amoxicillin", "dosage": "e.g. 40mg, 5ml",
      "frequency": "e.g. Once daily, Monthly", "category": "Deworming|Flea/Tick|Antibiotic|Anti-inflammatory|Supplement|Other",
      "startDate": "YYYY-MM-DD or empty", "endDate": "YYYY-MM-DD or empty",
      "nextDue": "YYYY-MM-DD or empty", "prescribedBy": "vet name", "reason": "what it treats", "notes": "" }
  ],
  "allergy": {
    "allergen": "substance", "type": "Food|Environmental|Medication|Contact|Other",
    "severity": "Mild|Moderate|Severe", "reactions": ["list"], "notes": "", "diagnosedDate": "YYYY-MM-DD or empty"
  },
  "bill": {
    "date": "YYYY-MM-DD or empty", "clinic": "clinic name", "invoiceNumber": "if visible",
    "lineItems": [{ "description": "item name", "amount": 0 }],
    "totalAmount": 0, "currency": "INR"
  },
  "weightReadings": [{ "date": "YYYY-MM-DD or empty", "weight": 0 }],
  "timelines": [
    { "label": "e.g. Next vaccination due", "date": "YYYY-MM-DD", "type": "Vaccination|Vet Checkup|Medication|Other" }
  ],
  "abnormalities": [
    { "parameter": "name", "value": "value", "unit": "unit", "referenceRange": "range",
      "status": "HIGH|LOW", "severity": "Mild|Moderate|Severe", "clinicalNote": "plain english explanation" }
  ]
}

VACCINATION RULES: one entry per vaccine product per row; separate entries for same vaccine on different dates; always return an array. Use the actual product name, not "Vaccine N".
MEDICINES: extract ALL drugs/medications regardless of document type. Category = Flea/Tick for tick prevention, Deworming for dewormers.
WEIGHT READINGS: extract any weight column in tables. One entry per row with a date and weight.
BILL: if this is a receipt or invoice, set type="bill". Extract every line item. Indian clinics use INR.
TIMELINES: extract ALL clearly legible future dates — next due dates, follow-ups, medication end dates.
ABNORMALITIES: only values outside normal range from lab reports.
Return valid JSON only. Only populate relevant sections. Leave dates empty rather than guessing.`
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function json(obj, status = 200) {
  return cors(JSON.stringify(obj), status)
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return cors('', 204)
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // ── 1. Authenticate the caller ────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Missing auth token' }, 401)

  // Use service-role client to validate the JWT
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // ── 2. Rate limit: max SCAN_LIMIT scans per user per calendar month ───────
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { count, error: countErr } = await supabase
    .from('api_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('type', 'document_scan')
    .gte('created_at', startOfMonth)

  if (countErr) console.error('Rate limit check failed:', countErr)

  if ((count || 0) >= SCAN_LIMIT) {
    return json({
      error: `Monthly scan limit reached (${SCAN_LIMIT} scans/month). Please contact support to increase your limit.`,
      limitReached: true,
      used: count,
      limit: SCAN_LIMIT,
    }, 429)
  }

  // ── 3. Parse request body ─────────────────────────────────────────────────
  let body
  try { body = await req.json() } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const { base64, mimeType = 'image/jpeg' } = body
  if (!base64) return json({ error: 'Missing base64 image data' }, 400)

  // ── 4. Call OpenAI ────────────────────────────────────────────────────────
  let openaiData
  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt() },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        }],
      }),
    })

    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}))
      return json({ error: err.error?.message || `OpenAI error ${openaiRes.status}` }, 502)
    }

    openaiData = await openaiRes.json()
  } catch (e) {
    return json({ error: `OpenAI request failed: ${e.message}` }, 502)
  }

  // ── 5. Log usage + cost ───────────────────────────────────────────────────
  const usage = openaiData.usage || {}
  const promptTokens     = usage.prompt_tokens     || 0
  const completionTokens = usage.completion_tokens || 0
  // gpt-4o-mini pricing: $0.15/1M input, $0.60/1M output
  const estimatedCost = (promptTokens * 0.00000015) + (completionTokens * 0.0000006)

  // Fire-and-forget — don't block the response on this
  supabase.from('api_usage').insert({
    user_id:           user.id,
    type:              'document_scan',
    prompt_tokens:     promptTokens,
    completion_tokens: completionTokens,
    estimated_cost_usd: estimatedCost,
    scans_used_this_month: (count || 0) + 1,
  }).then(({ error }) => { if (error) console.error('Usage log failed:', error) })

  // ── 6. Return the parsed result ───────────────────────────────────────────
  const content = openaiData.choices?.[0]?.message?.content
  if (!content) return json({ error: 'Empty response from AI — please try again.' }, 502)

  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    return json({ error: 'Could not parse AI response. Please try again.' }, 502)
  }

  return json({
    result: parsed,
    usage: {
      promptTokens,
      completionTokens,
      estimatedCostUsd: estimatedCost,
      scansThisMonth: (count || 0) + 1,
      scanLimit: SCAN_LIMIT,
    },
  })
}
