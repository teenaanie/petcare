import { useState, useRef } from 'react'
import { Upload, Camera, FileText, Loader2, CheckCircle, AlertCircle, Wand2, Calendar, TriangleAlert } from 'lucide-react'
import { saveMedicalRecord, saveVaccination, saveAllergy, saveReminder } from '../lib/storage.js'
import { format } from 'date-fns'

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function pdfToImageBase64(file) {
  // Dynamically import pdfjs-dist to avoid SSR issues
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString()

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
  "vaccination": {
    "name": "vaccine name",
    "dateGiven": "YYYY-MM-DD",
    "nextDue": "YYYY-MM-DD or empty",
    "batchNumber": "lot number or empty",
    "vet": "vet name or clinic",
    "notes": "any additional notes"
  },
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
      max_tokens: 1000,
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

export default function DocumentScanner({ pet }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [savedReminders, setSavedReminders] = useState([])
  const uploadRef = useRef()
  const cameraRef = useRef()

  async function handleFile(f) {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    setSaved(false)
    setSavedReminders([])
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
    try {
      const parsed = await analyzeDocument(file)
      // Auto-save vaccination records immediately
      if (parsed.type === 'vaccination' && parsed.vaccination?.name) {
        saveVaccination({ ...parsed.vaccination, petId: pet.id })
        setSaved(true) // mark as auto-saved
      }
      setResult(parsed)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleSave() {
    if (!result) return
    if (result.type === 'vaccination' && result.vaccination?.name) {
      // Auto-save vaccination record — already done in handleAnalyze
      // nothing extra needed here
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

  function handleSaveVaccinationReminder() {
    if (!result?.vaccination?.nextDue) return
    saveReminder({
      petId: pet.id,
      type: 'Vaccination',
      dueDate: result.vaccination.nextDue,
      frequency: 'Once',
      notes: `${result.vaccination.name} booster due`,
      email: '',
      whatsapp: '',
    })
    setSavedReminders(prev => [...prev, 'vax-reminder'])
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

              {result.type === 'vaccination' && result.vaccination && (
                <div className="space-y-1 text-gray-600">
                  <p><strong>Vaccine:</strong> {result.vaccination.name}</p>
                  {result.vaccination.dateGiven && <p><strong>Given:</strong> {result.vaccination.dateGiven}</p>}
                  {result.vaccination.nextDue && <p><strong>Next due:</strong> {result.vaccination.nextDue}</p>}
                  {result.vaccination.batchNumber && <p><strong>Batch:</strong> {result.vaccination.batchNumber}</p>}
                  {result.vaccination.vet && <p><strong>Vet:</strong> {result.vaccination.vet}</p>}
                  {result.vaccination.notes && <p><strong>Notes:</strong> {result.vaccination.notes}</p>}
                </div>
              )}
              {/* Auto-saved badge for vaccinations */}
              {result.type === 'vaccination' && saved && (
                <div className="flex items-center gap-2 text-green-600 text-sm font-medium mt-2">
                  <CheckCircle className="w-4 h-4" /> Vaccination record saved automatically!
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

            {/* Vaccination reminder suggestion */}
            {result.type === 'vaccination' && result.vaccination?.nextDue && (
              <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-purple-800">Set next vaccination reminder</p>
                  <p className="text-xs text-purple-500 mt-0.5">
                    {result.vaccination.name} due on {format(new Date(result.vaccination.nextDue), 'MMMM d, yyyy')}
                  </p>
                </div>
                {savedReminders.includes('vax-reminder') ? (
                  <span className="text-xs text-green-600 flex items-center gap-1 whitespace-nowrap">
                    <CheckCircle className="w-4 h-4" /> Reminder set!
                  </span>
                ) : (
                  <button
                    onClick={handleSaveVaccinationReminder}
                    className="text-sm bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors"
                  >
                    + Set Reminder
                  </button>
                )}
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

          {/* Timelines */}
          {result.timelines?.length > 0 && (
            <div className="card border-blue-100 border">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-5 h-5 text-blue-500" />
                <span className="font-semibold text-gray-900">Upcoming Dates Found</span>
                <span className="text-xs text-gray-400">· Save as reminders</span>
              </div>
              <div className="space-y-2">
                {result.timelines.map((t, i) => {
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
        </div>
      )}
    </div>
  )
}
