import { useState, useRef } from 'react'
import { Upload, Camera, FileText, Loader2, CheckCircle, AlertCircle, Wand2, Calendar } from 'lucide-react'
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

async function analyzeDocument(file) {
  if (!OPENAI_KEY) {
    throw new Error('OpenAI API key not configured. Add VITE_OPENAI_API_KEY to your .env file.')
  }

  const isPdf = file.type === 'application/pdf'
  const base64 = await fileToBase64(file)

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
  ]
}

Be thorough about extracting ALL dates and future appointments from the document — next due dates, follow-up visits, medication schedules, booster reminders, etc. List each as a separate timeline entry.

If this is a blood test / lab report, set type to "medical" and populate medicalRecord with:
- title: "Blood Test Results" or the specific test name
- description: list ALL key values found (e.g. "RBC: 6.5 (normal 5.5-8.5), WBC: 12.3 HIGH (normal 6-17), Platelets: 210 (normal 200-500)..."). Flag values as HIGH, LOW, or NORMAL based on reference ranges shown.
- Include the lab name and vet if visible.

Only populate the relevant record section based on document type. Return valid JSON only.`

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
          { type: 'image_url', image_url: { url: `data:${file.type};base64,${base64}` } }
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

  function handleFile(f) {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    setSaved(false)
    setSavedReminders([])
    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f))
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
      saveVaccination({ ...result.vaccination, petId: pet.id })
    } else if (result.type === 'allergy' && result.allergy?.allergen) {
      saveAllergy({ ...result.allergy, petId: pet.id })
    } else if (result.medicalRecord?.title) {
      saveMedicalRecord({ ...result.medicalRecord, petId: pet.id })
    }
    setSaved(true)
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

            {saved ? (
              <div className="flex items-center gap-2 text-green-600 font-medium text-sm">
                <CheckCircle className="w-4 h-4" /> Record saved to {pet.name}'s profile!
              </div>
            ) : (
              <button onClick={handleSave} className="btn-primary text-sm">
                Save to {pet.name}'s Records
              </button>
            )}
          </div>

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
