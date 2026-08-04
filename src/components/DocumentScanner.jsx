import { useState, useRef } from 'react'
import { Upload, Camera, FileText, Loader2, CheckCircle, AlertCircle, Wand2, Calendar, TriangleAlert, MessageSquare, Copy, Check } from 'lucide-react'
import { saveMedicalRecord, saveVaccination, saveAllergy, saveReminder } from '../lib/storage.js'
import { format, isPast, parseISO } from 'date-fns'

function isFutureDate(dateStr) {
  if (!dateStr) return false
  try { return !isPast(parseISO(dateStr)) } catch { return false }
}

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Singleton: import pdfjs once and reuse — avoids worker race condition on first scan
let _pdfjsPromise = null
async function getPdfJs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import('pdfjs-dist').then(lib => {
      // Use unpkg CDN for the worker to avoid Vite bundling issues
      lib.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`
      return lib
    })
  }
  return _pdfjsPromise
}

async function pdfToImageBase64(file) {
  const pdfjsLib = await getPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(1) // render first page

  const scale = 2.0 // higher = better quality for OCR
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height

  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise

  // Convert canvas to base64 PNG
  const dataUrl = canvas.toDataURL('image/png')
  return dataUrl.split(',')[1]
}

async function analyzeDocument(file) {
  if (!OPENAI_KEY) {
    throw new Error('OpenAI API key not configured. Add VITE_OPENAI_API_KEY to your .env file.')
  }

  const isPdf = file.type === 'application/pdf'
  // Convert PDF to image first — OpenAI vision only accepts image types
  const base64 = isPdf ? await pdfToImageBase64(file) : await fileToBase64(file)
  const mimeType = 'image/png' // always PNG after conversion

  const prompt = `You are a veterinary record parser. Analyze this ${isPdf ? 'PDF' : 'image'} of a pet medical document.

Extract and return a JSON object with this structure:
{
  "type": "medical" | "vaccination" | "allergy",
  "summary": "brief one-sentence summary of the document",
  "medicalRecord": {
    "date": "YYYY-MM-DD or empty",
    "type": "Checkup|Illness|Surgery|Lab Result|Prescription|Other",
    "title": "diagnosis or procedure name",
    "description": "details, symptoms, treatment, medications",
    "vet": "vet name or clinic",
    "cost": "number or empty"
  },
  "vaccinations": [
    {
      "name": "vaccine name (e.g. Canigen DHPPL, Rabisin, Nobivac KC)",
      "dateGiven": "YYYY-MM-DD",
      "nextDue": "YYYY-MM-DD or empty",
      "batchNumber": "lot/batch number from the sticker or label, or empty",
      "vet": "vet name or clinic",
      "notes": "any additional notes"
    }
  ],
  "allergy": {
    "allergen": "substance name",
    "type": "Food|Environmental|Medication|Contact|Insect|Other",
    "severity": "Mild|Moderate|Severe",
    "reactions": ["list", "of", "reactions"],
    "notes": "additional details",
    "diagnosedDate": "YYYY-MM-DD or empty"
  },
  "timelines": [
    {
      "label": "e.g. Next vaccination due / Follow-up visit / Medication end date",
      "date": "YYYY-MM-DD",
      "type": "Vaccination|Vet Checkup|Medication|Grooming|Other"
    }
  ],
  "abnormalities": [
    {
      "parameter": "parameter name",
      "value": "measured value",
      "unit": "unit of measure",
      "referenceRange": "normal range",
      "status": "HIGH|LOW",
      "severity": "Mild|Moderate|Severe",
      "clinicalNote": "plain english explanation"
    }
  ]
}

VACCINATION RULES — VERY IMPORTANT:
- If the document is a vaccination certificate or card with a table of multiple rows, create ONE entry in the "vaccinations" array per row/per vaccine product.
- Each vaccine sticker/label on the same row counts as a separate vaccine — e.g. Canigen DHPPL and Rabisin given on the same date should be TWO separate entries.
- Extract the batch/lot number from the sticker label if visible.
- If the same vaccine appears on multiple rows (different dates), create a separate entry for each date.
- Always set type to "vaccination" if any vaccines are found, even if other info is present.
- "vaccinations" must always be an array, even if there is only one vaccine.

Be thorough about extracting ALL dates and future appointments — next due dates, follow-up visits, medication schedules, booster reminders. List each as a separate timeline entry.

If this is a blood test / lab report, set type to "medical" and populate medicalRecord with:
- title: the specific test name (e.g. "Complete Blood Count", "Biochemistry Panel")
- description: list ALL values found, one per line, format: "Parameter: Value (Reference: range) — STATUS" where STATUS is NORMAL, HIGH, or LOW
- Include the lab name and vet if visible.

IMPORTANT — also populate the "abnormalities" array with ONLY the values that are outside normal range:
{
  "parameter": "WBC",
  "value": "18.5",
  "unit": "x10³/µL",
  "referenceRange": "6.0–17.0",
  "status": "HIGH",
  "severity": "Mild|Moderate|Severe",
  "clinicalNote": "brief plain-english note on what this could mean for the pet"
}

Severity rules: >20% outside range = Mild, >50% = Moderate, >100% = Severe.
If no abnormalities exist, return an empty array.
Only populate the relevant record section. Return valid JSON only.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
        ]
      }]
    })
  })

  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error?.message || 'OpenAI API error')
  }

  const data = await response.json()
  const text = data.choices[0].message.content.trim()
  // Strip markdown code fences if present
  const json = text.replace(/^```json\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(json)
}

async function generateVetQuestions(parsed, petName) {
  if (!OPENAI_KEY) return []

  // Build a concise summary of the findings to feed into the prompt
  const parts = [`Pet name: ${petName}`, `Report type: ${parsed.type}`, `Summary: ${parsed.summary}`]

  if (parsed.abnormalities?.length > 0) {
    parts.push('Abnormal findings: ' + parsed.abnormalities.map(a =>
      `${a.parameter} ${a.value}${a.unit ? ' ' + a.unit : ''} (${a.status}, ${a.severity}) — ${a.clinicalNote || ''}`
    ).join('; '))
  }
  if (parsed.medicalRecord) {
    const r = parsed.medicalRecord
    parts.push(`Diagnosis/procedure: ${r.title}`)
    if (r.description) parts.push(`Details: ${r.description.slice(0, 400)}`)
  }
  if (parsed.vaccinations?.length) {
    parts.push('Vaccines: ' + parsed.vaccinations.map(v => v.name).join(', '))
  }
  if (parsed.allergy) {
    parts.push(`Allergy: ${parsed.allergy.allergen} (${parsed.allergy.severity})`)
  }

  const prompt = `You are a veterinary advisor helping a pet owner prepare for their vet visit.

Based on this report for ${petName}:
${parts.join('\n')}

Generate 5–7 specific, practical questions the owner should ask their vet.
- Make each question directly relevant to what's in this specific report.
- If there are abnormal values, ask about their significance and what to do.
- If there are medications or treatments, ask about side effects, duration, follow-up.
- If it's a vaccination, ask about next steps and what to watch for.
- Write in plain language a non-medical person would use.
- Do NOT include generic questions — every question must reference something in this report.

Return ONLY a valid JSON array of strings, no markdown:
["Question 1?", "Question 2?", ...]`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  if (!res.ok) return []
  const data = await res.json()
  const text = data.choices[0].message.content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
  try { return JSON.parse(text) } catch { return [] }
}

export default function DocumentScanner({ pet }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [savedReminders, setSavedReminders] = useState([])
  const [vetQuestions, setVetQuestions] = useState([])
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [copied, setCopied] = useState(false)
  const uploadRef = useRef()
  const cameraRef = useRef()

  async function handleFile(f) {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    setSaved(false)
    setSavedReminders([])
    setVetQuestions([])
    setCopied(false)
    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f))
    } else if (f.type === 'application/pdf') {
      // Render first page of PDF as preview
      try {
        const base64 = await pdfToImageBase64(f)
        setPreview(`data:image/png;base64,${base64}`)
      } catch {
        setPreview(null)
      }
    } else {
      setPreview(null)
    }
  }

  async function handleAnalyze() {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    setSaved(false)
    setSavedReminders([])
    setVetQuestions([])
    setCopied(false)
    try {
      const parsed = await analyzeDocument(file)
      // Normalize: support both old singular `vaccination` and new `vaccinations` array
      if (parsed.vaccination && !parsed.vaccinations) {
        parsed.vaccinations = [parsed.vaccination]
        delete parsed.vaccination
      }
      parsed.vaccinations = parsed.vaccinations || []
      // Auto-save all vaccination records immediately
      if (parsed.type === 'vaccination' && parsed.vaccinations.length > 0) {
        await Promise.all(parsed.vaccinations.map(v => saveVaccination({ ...v, petId: pet.id })))
        setSaved(true)
      }
      setResult(parsed)
      // Generate vet questions in parallel (non-blocking)
      setLoadingQuestions(true)
      generateVetQuestions(parsed, pet.name)
        .then(qs => setVetQuestions(qs || []))
        .catch(() => {})
        .finally(() => setLoadingQuestions(false))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleSave() {
    if (!result) return
    if (result.type === 'vaccination') {
      // Already auto-saved in handleAnalyze
    } else if (result.type === 'allergy' && result.allergy?.allergen) {
      saveAllergy({ ...result.allergy, petId: pet.id })
    } else if (result.medicalRecord?.title) {
      const hasAbnormalities = result.abnormalities?.length > 0
      saveMedicalRecord({
        ...result.medicalRecord,
        petId: pet.id,
        isAbnormal: hasAbnormalities,
        abnormalities: result.abnormalities || [],
      })
    }
    setSaved(true)
  }

  function handleSaveVaccinationReminder(vax) {
    if (!vax?.nextDue) return
    const key = `vax-${vax.name}-${vax.nextDue}`
    saveReminder({
      petId: pet.id,
      type: 'Vaccination',
      dueDate: vax.nextDue,
      frequency: 'Once',
      notes: `${vax.name} booster due`,
      email: '',
      whatsapp: '',
    })
    setSavedReminders(prev => [...prev, key])
  }

  function handleSaveReminder(timeline) {
    saveReminder({
      petId: pet.id,
      type: timeline.type || 'Other',
      dueDate: timeline.date,
      frequency: 'Once',
      notes: timeline.label,
      email: '',
      whatsapp: '',
    })
    setSavedReminders(prev => [...prev, timeline.date + timeline.label])
  }

  function handleCopyQuestions() {
    const text = vetQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-2">Scan Medical Documents</h2>
      <p className="text-sm text-gray-500 mb-5">
        Scan or upload a vet report, vaccination card, blood test, or any medical document.
        AI extracts all details, lab values, and upcoming dates automatically.
      </p>

      {!OPENAI_KEY && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
          <strong>Setup required:</strong> Add your OpenAI API key to <code>.env</code> as <code>VITE_OPENAI_API_KEY</code>.
          Get one free at <a href="https://platform.openai.com" target="_blank" className="underline">platform.openai.com</a>.
        </div>
      )}

      {/* Camera + Upload buttons */}
      <div className="flex gap-3 mb-4">
        {/* Camera scan — on mobile this opens the camera directly */}
        <button
          onClick={() => cameraRef.current?.click()}
          className="flex-1 flex flex-col items-center gap-2 py-6 rounded-xl border-2 border-dashed border-primary-300 bg-primary-50 hover:bg-primary-100 transition-colors cursor-pointer"
        >
          <Camera className="w-8 h-8 text-primary-500" />
          <span className="text-sm font-medium text-primary-700">Scan with Camera</span>
          <span className="text-xs text-primary-400">Opens camera on mobile</span>
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={e => handleFile(e.target.files[0])}
        />

        {/* File upload */}
        <button
          onClick={() => uploadRef.current?.click()}
          className="flex-1 flex flex-col items-center gap-2 py-6 rounded-xl border-2 border-dashed border-gray-200 bg-white hover:border-gray-400 transition-colors cursor-pointer"
        >
          <Upload className="w-8 h-8 text-gray-400" />
          <span className="text-sm font-medium text-gray-600">Upload File</span>
          <span className="text-xs text-gray-400">JPG, PNG or PDF</span>
        </button>
        <input
          ref={uploadRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={e => handleFile(e.target.files[0])}
        />
      </div>

      {/* Preview */}
      {file && (
        <div
          className="card border-2 border-dashed border-gray-200 flex flex-col items-center py-6 mb-4 cursor-pointer"
          onClick={() => uploadRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
        >
          {preview
            ? <img src={preview} alt="Preview" className="max-h-52 rounded-lg mb-2 object-contain" />
            : <FileText className="w-10 h-10 text-gray-300 mb-2" />
          }
          <p className="text-sm text-gray-500">{file.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">Click to change</p>
        </div>
      )}

      {file && !loading && !result && (
        <button onClick={handleAnalyze} className="btn-primary flex items-center gap-2 mb-4">
          <Wand2 className="w-4 h-4" /> Analyze with AI
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-primary-600 mb-4">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Reading document and extracting details...</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3 text-red-700 mb-4">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Analysis failed</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Main record */}
          <div className="card border-green-200 border">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="font-semibold text-gray-900">Document analyzed</span>
              <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full capitalize">{result.type}</span>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2 mb-4">
              <p className="font-medium text-gray-700">{result.summary}</p>

              {result.type === 'vaccination' && result.vaccinations?.length > 0 && (
                <div className="space-y-3">
                  {result.vaccinations.map((vax, i) => (
                    <div key={i} className="bg-white border border-gray-200 rounded-lg p-3 text-gray-600 space-y-0.5">
                      <p className="font-semibold text-gray-800">{vax.name}</p>
                      {vax.dateGiven && <p className="text-sm"><strong>Given:</strong> {vax.dateGiven}</p>}
                      {vax.nextDue && <p className="text-sm"><strong>Next due:</strong> {vax.nextDue}</p>}
                      {vax.batchNumber && <p className="text-sm"><strong>Batch:</strong> {vax.batchNumber}</p>}
                      {vax.vet && <p className="text-sm"><strong>Vet:</strong> {vax.vet}</p>}
                      {vax.notes && <p className="text-sm"><strong>Notes:</strong> {vax.notes}</p>}
                    </div>
                  ))}
                  {saved && (
                    <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                      <CheckCircle className="w-4 h-4" /> {result.vaccinations.length} vaccination record{result.vaccinations.length > 1 ? 's' : ''} saved automatically!
                    </div>
                  )}
                </div>
              )}

              {result.type === 'allergy' && result.allergy && (
                <div className="space-y-1 text-gray-600">
                  <p><strong>Allergen:</strong> {result.allergy.allergen}</p>
                  <p><strong>Severity:</strong> {result.allergy.severity}</p>
                  {result.allergy.reactions?.length > 0 && <p><strong>Reactions:</strong> {result.allergy.reactions.join(', ')}</p>}
                  {result.allergy.notes && <p><strong>Notes:</strong> {result.allergy.notes}</p>}
                </div>
              )}

              {result.medicalRecord && (
                <div className="space-y-1 text-gray-600">
                  <p><strong>Title:</strong> {result.medicalRecord.title}</p>
                  {result.medicalRecord.date && <p><strong>Date:</strong> {result.medicalRecord.date}</p>}
                  {result.medicalRecord.vet && <p><strong>Vet / Lab:</strong> {result.medicalRecord.vet}</p>}
                  {result.medicalRecord.description && (
                    <div>
                      <p className="font-medium mt-2 mb-1">Details / Lab Values:</p>
                      <p className="whitespace-pre-line leading-relaxed">{result.medicalRecord.description}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {result.type !== 'vaccination' && (
              saved ? (
                <div className="flex items-center gap-2 text-green-600 font-medium text-sm">
                  <CheckCircle className="w-4 h-4" /> Record saved to {pet.name}'s profile!
                </div>
              ) : (
                <button onClick={handleSave} className="btn-primary text-sm">
                  Save to {pet.name}'s Records
                </button>
              )
            )}

            {/* Vaccination reminder suggestions — one per vaccine with a future nextDue */}
            {result.type === 'vaccination' && result.vaccinations?.some(v => isFutureDate(v.nextDue)) && (
              <div className="mt-3 space-y-2">
                {result.vaccinations.filter(v => isFutureDate(v.nextDue)).map((vax, i) => {
                  const key = `vax-${vax.name}-${vax.nextDue}`
                  return (
                    <div key={i} className="p-3 bg-purple-50 border border-purple-200 rounded-lg flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-purple-800">Set reminder — {vax.name}</p>
                        <p className="text-xs text-purple-500 mt-0.5">
                          Due on {format(new Date(vax.nextDue), 'MMMM d, yyyy')}
                        </p>
                      </div>
                      {savedReminders.includes(key) ? (
                        <span className="text-xs text-green-600 flex items-center gap-1 whitespace-nowrap">
                          <CheckCircle className="w-4 h-4" /> Set!
                        </span>
                      ) : (
                        <button
                          onClick={() => handleSaveVaccinationReminder(vax)}
                          className="text-sm bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors"
                        >
                          + Reminder
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Abnormalities */}
          {result.abnormalities?.length > 0 && (
            <div className="card border-red-200 border bg-red-50">
              <div className="flex items-center gap-2 mb-3">
                <TriangleAlert className="w-5 h-5 text-red-500" />
                <span className="font-semibold text-red-800">
                  {result.abnormalities.length} Abnormal Value{result.abnormalities.length > 1 ? 's' : ''} Found
                </span>
                <span className="text-xs text-red-400">· Consult your vet</span>
              </div>
              <div className="space-y-2">
                {result.abnormalities.map((a, i) => {
                  const severityColor = {
                    Severe:   'bg-red-100 border-red-300 text-red-900',
                    Moderate: 'bg-orange-50 border-orange-300 text-orange-900',
                    Mild:     'bg-yellow-50 border-yellow-300 text-yellow-900',
                  }[a.severity] || 'bg-red-50 border-red-200 text-red-800'

                  const badgeColor = {
                    Severe:   'bg-red-500 text-white',
                    Moderate: 'bg-orange-500 text-white',
                    Mild:     'bg-yellow-500 text-white',
                  }[a.severity] || 'bg-red-500 text-white'

                  return (
                    <div key={i} className={`rounded-lg border p-3 ${severityColor}`}>
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{a.parameter}</span>
                          <span className="text-sm">{a.value} {a.unit}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${badgeColor}`}>
                            {a.status}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor} opacity-80`}>
                            {a.severity}
                          </span>
                        </div>
                        <span className="text-xs opacity-70">Normal: {a.referenceRange}</span>
                      </div>
                      {a.clinicalNote && (
                        <p className="text-xs opacity-80 mt-1">{a.clinicalNote}</p>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-red-400 mt-3">
                ⚠ This is an AI interpretation of the report. Always follow your vet's advice.
              </p>
            </div>
          )}

          {/* Timelines — only show future dates */}
          {result.timelines?.some(t => isFutureDate(t.date)) && (
            <div className="card border-blue-100 border">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-5 h-5 text-blue-500" />
                <span className="font-semibold text-gray-900">Upcoming Dates Found</span>
                <span className="text-xs text-gray-400">· Save as reminders</span>
              </div>
              <div className="space-y-2">
                {result.timelines.filter(t => isFutureDate(t.date)).map((t, i) => {
                  const key = t.date + t.label
                  const alreadySaved = savedReminders.includes(key)
                  return (
                    <div key={i} className="flex items-center justify-between bg-blue-50 rounded-lg px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{t.label}</p>
                        <p className="text-xs text-gray-500">
                          {t.type} · {t.date ? format(new Date(t.date), 'MMM d, yyyy') : t.date}
                        </p>
                      </div>
                      {alreadySaved ? (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" /> Saved
                        </span>
                      ) : (
                        <button
                          onClick={() => handleSaveReminder(t)}
                          className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg transition-colors"
                        >
                          + Reminder
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Questions to ask your Vet ───────────────────────────────── */}
          {(loadingQuestions || vetQuestions.length > 0) && (
            <div className="card" style={{ borderColor: '#C2DFF0', backgroundColor: '#F0F8FF' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" style={{ color: '#2563EB' }} />
                  <span className="font-bold" style={{ color: '#1E3A5F' }}>Questions to ask your Vet</span>
                </div>
                {vetQuestions.length > 0 && (
                  <button
                    onClick={handleCopyQuestions}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
                    style={{ backgroundColor: copied ? '#D1FAE5' : '#DBEAFE', color: copied ? '#065F46' : '#1D4ED8' }}
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied!' : 'Copy all'}
                  </button>
                )}
              </div>

              {loadingQuestions && (
                <div className="flex items-center gap-2 text-sm py-2" style={{ color: '#2563EB' }}>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating questions based on this report...
                </div>
              )}

              {vetQuestions.length > 0 && (
                <ol className="space-y-2">
                  {vetQuestions.map((q, i) => (
                    <li key={i} className="flex gap-3 text-sm rounded-xl p-3"
                      style={{ backgroundColor: 'white', border: '1px solid #BFDBFE' }}>
                      <span className="font-black flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                        style={{ backgroundColor: '#F9D548', color: '#4A2C0A' }}>
                        {i + 1}
                      </span>
                      <span style={{ color: '#1E3A5F' }}>{q}</span>
                    </li>
                  ))}
                </ol>
              )}

              <p className="text-xs mt-3" style={{ color: '#6B9FBF' }}>
                💡 These questions are tailored to this specific report. Tap "Copy all" to paste into a message for your vet.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
