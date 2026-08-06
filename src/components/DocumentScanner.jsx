import { useState, useRef } from 'react'
import { Upload, Camera, FileText, Loader2, CheckCircle, AlertCircle, Wand2, Calendar, TriangleAlert, MessageSquare, Copy, Check, Syringe, Pill, Receipt, Weight, X, Plus } from 'lucide-react'
import { saveMedicalRecord, saveVaccination, saveAllergy, saveReminder, saveMedicine, saveBill, saveWeightLog } from '../lib/storage.js'
import { format, isPast, parseISO } from 'date-fns'

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY
const MED_CATS = ['Deworming', 'Flea/Tick', 'Antibiotic', 'Anti-inflammatory', 'Supplement', 'Vaccination', 'Other']
const CURRENCIES = ['INR', 'USD', 'GBP', 'AUD', 'EUR', 'SGD']

// ── pdfjs singleton ───────────────────────────────────────────────────────────
let _pdfjsPromise = null
async function getPdfJs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import('pdfjs-dist').then(lib => {
      lib.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`
      return lib
    })
  }
  return _pdfjsPromise
}

// Compress any image to max 1280px / 80% JPEG — reduces 5MB phone photos to ~200-300KB
async function compressImage(base64, mimeHint = 'image/jpeg') {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const MAX = 1280
      const scale = Math.min(1, MAX / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1])
    }
    img.onerror = () => resolve(base64) // fallback: use original
    img.src = `data:${mimeHint};base64,${base64}`
  })
}

async function fileToBase64(file) {
  const raw = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  return compressImage(raw, file.type || 'image/jpeg')
}

async function pdfToImageBase64(file) {
  const pdfjsLib = await getPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(1)
  // Scale 1.5 is enough; we'll compress afterwards anyway
  const viewport = page.getViewport({ scale: 1.5 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  const raw = canvas.toDataURL('image/png').split(',')[1]
  return compressImage(raw, 'image/png')
}

// ── AI analysis ───────────────────────────────────────────────────────────────

async function analyzeDocument(file) {
  if (!OPENAI_KEY) throw new Error('OpenAI API key not configured. Add VITE_OPENAI_API_KEY to your .env file.')

  const isPdf = file.type === 'application/pdf'
  const base64 = isPdf ? await pdfToImageBase64(file) : await fileToBase64(file)

  const prompt = `You are a veterinary record parser. Analyze this pet medical document image.

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
    { "name": "vaccine name", "dateGiven": "YYYY-MM-DD", "nextDue": "YYYY-MM-DD or empty",
      "batchNumber": "lot number or empty", "vet": "vet name", "notes": "" }
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
    "date": "YYYY-MM-DD", "clinic": "clinic name", "invoiceNumber": "if visible",
    "lineItems": [{ "description": "item name", "amount": 0 }],
    "totalAmount": 0, "currency": "INR"
  },
  "weightReadings": [{ "date": "YYYY-MM-DD", "weight": 0 }],
  "timelines": [
    { "label": "e.g. Next vaccination due", "date": "YYYY-MM-DD", "type": "Vaccination|Vet Checkup|Medication|Other" }
  ],
  "abnormalities": [
    { "parameter": "name", "value": "value", "unit": "unit", "referenceRange": "range",
      "status": "HIGH|LOW", "severity": "Mild|Moderate|Severe", "clinicalNote": "plain english explanation" }
  ]
}

VACCINATION RULES: one entry per vaccine product per row; separate entries for same vaccine on different dates; always return an array.

MEDICINES: extract ALL drugs/medications regardless of document type. For deworming schedules, one entry per row. Category = Flea/Tick for tick prevention, Deworming for dewormers.

WEIGHT READINGS: extract any weight column in tables (e.g. deworming schedule weight column). One entry per row with a date and weight.

BILL: if this is a receipt or invoice, set type="bill". Extract every line item. Indian clinics use INR. Use the printed total if visible.

TIMELINES: extract ALL future dates — next due dates, follow-ups, medication end dates.

ABNORMALITIES: only values outside normal range from lab reports.

Return valid JSON only. Only populate relevant sections.`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
      ]}]
    })
  })

  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error?.message || `API error ${res.status}`)
  }
  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content
  if (!raw) throw new Error('Empty response from AI — please try again.')
  try {
    return JSON.parse(raw)
  } catch {
    // Shouldn't happen with json_object mode, but handle gracefully
    const extracted = raw.match(/\{[\s\S]*\}/)
    if (extracted) return JSON.parse(extracted[0])
    throw new Error('Could not parse AI response. Please try again.')
  }
}

// ── Vet questions ─────────────────────────────────────────────────────────────

async function generateVetQuestions(parsed, petName) {
  if (!OPENAI_KEY) return []
  const parts = [`Pet: ${petName}`, `Report type: ${parsed.type}`, `Summary: ${parsed.summary}`]
  if (parsed.abnormalities?.length > 0)
    parts.push('Abnormal: ' + parsed.abnormalities.map(a => `${a.parameter} ${a.value}${a.unit} (${a.status}, ${a.severity})`).join('; '))
  if (parsed.medicalRecord?.title) parts.push(`Diagnosis: ${parsed.medicalRecord.title}`)
  if (parsed.medicines?.length) parts.push('Medicines: ' + parsed.medicines.map(m => `${m.name} ${m.dosage || ''}`).join(', '))
  if (parsed.vaccinations?.length) parts.push('Vaccines: ' + parsed.vaccinations.map(v => v.name).join(', '))
  if (parsed.allergy) parts.push(`Allergy: ${parsed.allergy.allergen} (${parsed.allergy.severity})`)

  const prompt = `Based on this vet report for ${petName}:\n${parts.join('\n')}\n\nGenerate 5-7 specific questions the owner should ask their vet. Each must reference something in this report. Write in plain language. Return ONLY a valid JSON array of strings: ["Question 1?", ...]`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
  })
  if (!res.ok) return []
  const data = await res.json()
  const text = data.choices[0].message.content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
  try { return JSON.parse(text) } catch { return [] }
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function isFutureDate(dateStr) {
  if (!dateStr) return false
  try { return !isPast(parseISO(dateStr)) } catch { return false }
}

function SavedBadge() {
  return (
    <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
      style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
      <CheckCircle className="w-3.5 h-3.5" /> Saved
    </span>
  )
}

function SaveBtn({ onClick, label = 'Save', saving }) {
  return (
    <button onClick={onClick} disabled={saving}
      className="btn-primary text-xs py-1 px-3">
      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : label}
    </button>
  )
}

function Field({ label, value, onChange, type = 'text', options, rows }) {
  const cls = "input text-sm py-1.5"
  if (options) return (
    <div>
      <label className="label text-xs">{label}</label>
      <select className={cls} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  )
  if (rows) return (
    <div>
      <label className="label text-xs">{label}</label>
      <textarea className={cls} rows={rows} value={value || ''} onChange={e => onChange(e.target.value)} />
    </div>
  )
  return (
    <div>
      <label className="label text-xs">{label}</label>
      <input className={cls} type={type} value={value || ''} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DocumentScanner({ pet }) {
  const [file, setFile]           = useState(null)
  const [preview, setPreview]     = useState(null)
  const [loading, setLoading]     = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [error, setError]         = useState(null)
  const [parsed, setParsed]       = useState(null)

  // Editable extracted items
  const [vaxItems, setVaxItems]         = useState([])
  const [savedVax, setSavedVax]         = useState(new Set())
  const [medItems, setMedItems]         = useState([])
  const [savedMeds, setSavedMeds]       = useState(new Set())
  const [billItem, setBillItem]         = useState(null)
  const [billSaved, setBillSaved]       = useState(false)
  const [recordItem, setRecordItem]     = useState(null)
  const [recordSaved, setRecordSaved]   = useState(false)
  const [allergyItem, setAllergyItem]   = useState(null)
  const [allergySaved, setAllergySaved] = useState(false)
  const [weightItems, setWeightItems]   = useState([])
  const [savedWeights, setSavedWeights] = useState(new Set())
  const [timelineItems, setTimelineItems]     = useState([])
  const [savedTimelines, setSavedTimelines]   = useState(new Set())
  const [abnormalities, setAbnormalities]     = useState([])

  // Save state
  const [savingSet, setSavingSet]   = useState(new Set())   // keys currently saving
  const [saveErrors, setSaveErrors] = useState({})          // key → error message

  // Vet questions
  const [vetQuestions, setVetQuestions]         = useState([])
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [copied, setCopied]                     = useState(false)

  const uploadRef = useRef()
  const cameraRef = useRef()

  // ── File handling ──────────────────────────────────────────────────────────

  async function handleFile(f) {
    if (!f) return
    setFile(f); setParsed(null); setError(null)
    setVaxItems([]); setSavedVax(new Set())
    setMedItems([]); setSavedMeds(new Set())
    setBillItem(null); setBillSaved(false)
    setRecordItem(null); setRecordSaved(false)
    setAllergyItem(null); setAllergySaved(false)
    setWeightItems([]); setSavedWeights(new Set())
    setTimelineItems([]); setSavedTimelines(new Set())
    setAbnormalities([]); setVetQuestions([])
    setSavingSet(new Set()); setSaveErrors({})
    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f))
    } else if (f.type === 'application/pdf') {
      try { const b = await pdfToImageBase64(f); setPreview(`data:image/png;base64,${b}`) } catch { setPreview(null) }
    } else { setPreview(null) }
  }

  // ── Analysis ──────────────────────────────────────────────────────────────

  async function handleAnalyze() {
    if (!file) return
    setLoading(true); setError(null); setLoadingStep('Compressing image…')
    try {
      setLoadingStep('Reading document…')
      const result = await analyzeDocument(file)
      setLoadingStep('')

      // Normalize old singular vaccination format
      if (result.vaccination && !result.vaccinations) {
        result.vaccinations = [result.vaccination]; delete result.vaccination
      }
      result.vaccinations = result.vaccinations || []

      setParsed(result)
      setVaxItems(result.vaccinations.map(v => ({ ...v })))
      setMedItems((result.medicines || []).map(m => ({ ...m })))
      setBillItem(result.bill?.clinic || result.bill?.totalAmount ? { ...result.bill } : null)
      setRecordItem(result.medicalRecord?.title ? { ...result.medicalRecord } : null)
      setAllergyItem(result.allergy?.allergen ? { ...result.allergy } : null)
      setWeightItems((result.weightReadings || []).map(w => ({ ...w })))
      setTimelineItems((result.timelines || []).filter(t => isFutureDate(t.date)))
      setAbnormalities(result.abnormalities || [])
      setSavedVax(new Set()); setSavedMeds(new Set())
      setBillSaved(false); setRecordSaved(false); setAllergySaved(false)
      setSavedWeights(new Set()); setSavedTimelines(new Set())

      // Non-blocking vet questions
      setLoadingQuestions(true)
      generateVetQuestions(result, pet.name)
        .then(qs => setVetQuestions(qs || []))
        .catch(() => {})
        .finally(() => setLoadingQuestions(false))

    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Save helpers ──────────────────────────────────────────────────────────

  async function trySave(key, fn) {
    setSavingSet(s => new Set([...s, key]))
    setSaveErrors(e => { const n = { ...e }; delete n[key]; return n })
    try {
      await fn()
    } catch (err) {
      const msg = err?.message || 'Save failed — check if the Supabase table exists.'
      setSaveErrors(e => ({ ...e, [key]: msg }))
    } finally {
      setSavingSet(s => { const n = new Set(s); n.delete(key); return n })
    }
  }

  // ── Save handlers ─────────────────────────────────────────────────────────

  const handleSaveVax = (idx) => trySave(`vax_${idx}`, async () => {
    await saveVaccination({ ...vaxItems[idx], petId: pet.id })
    setSavedVax(s => new Set([...s, idx]))
  })

  const handleSaveMed = (idx) => trySave(`med_${idx}`, async () => {
    await saveMedicine({ ...medItems[idx], petId: pet.id })
    setSavedMeds(s => new Set([...s, idx]))
  })

  const handleSaveBill = () => trySave('bill', async () => {
    await saveBill({ ...billItem, petId: pet.id })
    setBillSaved(true)
  })

  const handleSaveRecord = () => trySave('record', async () => {
    await saveMedicalRecord({
      ...recordItem, petId: pet.id,
      isAbnormal: abnormalities.length > 0,
      abnormalities,
    })
    setRecordSaved(true)
  })

  const handleSaveAllergy = () => trySave('allergy', async () => {
    await saveAllergy({ ...allergyItem, petId: pet.id })
    setAllergySaved(true)
  })

  const handleSaveWeight = (idx) => trySave(`wt_${idx}`, async () => {
    const w = weightItems[idx]
    await saveWeightLog({ petId: pet.id, date: w.date, weight: parseFloat(w.weight), notes: 'From scanned document' })
    setSavedWeights(s => new Set([...s, idx]))
  })

  const handleSaveTimeline = (idx) => trySave(`tl_${idx}`, async () => {
    const t = timelineItems[idx]
    await saveReminder({ petId: pet.id, type: t.type || 'Other', dueDate: t.date, frequency: 'Once', notes: t.label, email: '', whatsapp: '' })
    setSavedTimelines(s => new Set([...s, idx]))
  })

  function handleCopyQuestions() {
    const text = vetQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) })
  }

  // ── Update helpers ────────────────────────────────────────────────────────

  const updateVax = (idx, key, val) => setVaxItems(prev => prev.map((v, i) => i === idx ? { ...v, [key]: val } : v))
  const updateMed = (idx, key, val) => setMedItems(prev => prev.map((m, i) => i === idx ? { ...m, [key]: val } : m))
  const updateWeight = (idx, key, val) => setWeightItems(prev => prev.map((w, i) => i === idx ? { ...w, [key]: val } : w))
  const updateBillLine = (idx, key, val) => setBillItem(b => ({ ...b, lineItems: b.lineItems.map((r, i) => i === idx ? { ...r, [key]: val } : r) }))

  // ── Render ────────────────────────────────────────────────────────────────

  const hasResults = parsed && (vaxItems.length > 0 || medItems.length > 0 || billItem || recordItem || allergyItem || weightItems.length > 0)

  return (
    <div>
      <h2 className="text-lg font-black mb-1" style={{ color: '#4A2C0A' }}>Scan Medical Documents</h2>
      <p className="text-sm mb-1" style={{ color: '#4A2C0A', fontWeight: 700 }}>
        Just snap or upload — we'll handle the rest. ✨
      </p>
      <p className="text-sm mb-5" style={{ color: '#B8A080' }}>
        Vet bills, prescriptions, vaccination cards, deworming schedules — our AI reads them and fills in every detail for you.
      </p>

      {!OPENAI_KEY && (
        <div className="mb-4 p-3 rounded-xl text-sm" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
          <strong>Setup required:</strong> Add your OpenAI API key to <code>.env</code> as <code>VITE_OPENAI_API_KEY</code>.
        </div>
      )}

      {/* Upload area */}
      <div className="flex gap-3 mb-4">
        <button onClick={() => cameraRef.current?.click()}
          className="flex-1 flex flex-col items-center gap-2 py-5 rounded-xl border-2 border-dashed transition-all"
          style={{ borderColor: '#F9D548', backgroundColor: '#FFFEF0' }}>
          <Camera className="w-7 h-7" style={{ color: '#D4A800' }} />
          <span className="text-sm font-bold" style={{ color: '#4A2C0A' }}>Scan with Camera</span>
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleFile(e.target.files[0])} />

        <button onClick={() => uploadRef.current?.click()}
          className="flex-1 flex flex-col items-center gap-2 py-5 rounded-xl border-2 border-dashed transition-all"
          style={{ borderColor: '#E8D9B0', backgroundColor: 'white' }}>
          <Upload className="w-7 h-7" style={{ color: '#B8A080' }} />
          <span className="text-sm font-bold" style={{ color: '#6B4C1E' }}>Upload File</span>
          <span className="text-xs" style={{ color: '#B8A080' }}>JPG, PNG or PDF</span>
        </button>
        <input ref={uploadRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => handleFile(e.target.files[0])} />
      </div>

      {/* Preview */}
      {file && (
        <div className="card border-dashed flex flex-col items-center py-4 mb-4 cursor-pointer"
          style={{ borderStyle: 'dashed', borderColor: '#E8D9B0' }}
          onClick={() => uploadRef.current?.click()}>
          {preview
            ? <img src={preview} alt="Preview" className="max-h-48 rounded-lg mb-2 object-contain" />
            : <FileText className="w-10 h-10 mb-2" style={{ color: '#B8A080' }} />}
          <p className="text-sm" style={{ color: '#6B4C1E' }}>{file.name}</p>
          <p className="text-xs mt-0.5" style={{ color: '#B8A080' }}>Click to change</p>
        </div>
      )}

      {file && !loading && !parsed && (
        <button onClick={handleAnalyze} className="btn-primary flex items-center gap-2 mb-4">
          <Wand2 className="w-4 h-4" /> Analyze with AI
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-3 mb-4 py-3 px-4 rounded-xl" style={{ backgroundColor: '#FFF5AA', color: '#4A2C0A' }}>
          <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">Analysing with AI…</p>
            {loadingStep && <p className="text-xs mt-0.5" style={{ color: '#B8A080' }}>{loadingStep}</p>}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 mb-4 p-3 rounded-xl text-sm"
          style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Analysis failed</p>
            <p className="mt-0.5">{error}</p>
            <button onClick={handleAnalyze} className="mt-2 font-bold underline">Try again</button>
          </div>
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────────────── */}

      {parsed && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: '#FFF5AA', color: '#4A2C0A' }}>
            <span className="font-bold">Summary: </span>{parsed.summary}
          </div>

          {/* ── Vaccinations ────────────────────────────────────────────────── */}
          {vaxItems.map((vax, i) => (
            <div key={i} className="card" style={{ borderColor: savedVax.has(i) ? '#A7F3D0' : '#DDD6FE', backgroundColor: savedVax.has(i) ? '#F0FDF4' : 'white' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Syringe className="w-4 h-4" style={{ color: '#7C3AED' }} />
                  <span className="font-black text-sm" style={{ color: '#4A2C0A' }}>Vaccination {vaxItems.length > 1 ? i + 1 : ''}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {savedVax.has(i) ? <SavedBadge /> : <SaveBtn onClick={() => handleSaveVax(i)} label="Save Vaccination" saving={savingSet.has(`vax_${i}`)} />}
                  {saveErrors[`vax_${i}`] && <p className="text-xs text-red-500">{saveErrors[`vax_${i}`]}</p>}
                </div>
              </div>
              {!savedVax.has(i) ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2"><Field label="Vaccine Name" value={vax.name} onChange={v => updateVax(i, 'name', v)} /></div>
                  <Field label="Date Given" value={vax.dateGiven} onChange={v => updateVax(i, 'dateGiven', v)} type="date" />
                  <Field label="Next Due" value={vax.nextDue} onChange={v => updateVax(i, 'nextDue', v)} type="date" />
                  <Field label="Batch Number" value={vax.batchNumber} onChange={v => updateVax(i, 'batchNumber', v)} />
                  <Field label="Vet / Clinic" value={vax.vet} onChange={v => updateVax(i, 'vet', v)} />
                  <div className="col-span-2"><Field label="Notes" value={vax.notes} onChange={v => updateVax(i, 'notes', v)} rows={2} /></div>
                </div>
              ) : (
                <div className="text-sm space-y-0.5" style={{ color: '#4A2C0A' }}>
                  <p className="font-bold">{vax.name}</p>
                  {vax.dateGiven && <p style={{ color: '#B8A080' }}>Given: {vax.dateGiven}{vax.nextDue ? ` · Next: ${vax.nextDue}` : ''}</p>}
                  {vax.vet && <p style={{ color: '#B8A080' }}>{vax.vet}</p>}
                </div>
              )}
            </div>
          ))}

          {/* ── Medicines ────────────────────────────────────────────────────── */}
          {medItems.map((med, i) => (
            <div key={i} className="card" style={{ borderColor: savedMeds.has(i) ? '#A7F3D0' : '#BBF7D0', backgroundColor: savedMeds.has(i) ? '#F0FDF4' : 'white' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Pill className="w-4 h-4" style={{ color: '#059669' }} />
                  <span className="font-black text-sm" style={{ color: '#4A2C0A' }}>Medicine {medItems.length > 1 ? i + 1 : ''}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {savedMeds.has(i) ? <SavedBadge /> : <SaveBtn onClick={() => handleSaveMed(i)} label="Save Medicine" saving={savingSet.has(`med_${i}`)} />}
                  {saveErrors[`med_${i}`] && <p className="text-xs text-red-500">{saveErrors[`med_${i}`]}</p>}
                </div>
              </div>
              {!savedMeds.has(i) ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2"><Field label="Medicine Name" value={med.name} onChange={v => updateMed(i, 'name', v)} /></div>
                  <Field label="Dosage" value={med.dosage} onChange={v => updateMed(i, 'dosage', v)} placeholder="e.g. 40mg" />
                  <Field label="Frequency" value={med.frequency} onChange={v => updateMed(i, 'frequency', v)} placeholder="e.g. Monthly" />
                  <Field label="Category" value={med.category || 'Other'} onChange={v => updateMed(i, 'category', v)} options={MED_CATS} />
                  <Field label="Date Given" value={med.startDate} onChange={v => updateMed(i, 'startDate', v)} type="date" />
                  <Field label="End Date" value={med.endDate} onChange={v => updateMed(i, 'endDate', v)} type="date" />
                  <Field label="Next Due" value={med.nextDue} onChange={v => updateMed(i, 'nextDue', v)} type="date" />
                  <Field label="Prescribed By" value={med.prescribedBy} onChange={v => updateMed(i, 'prescribedBy', v)} />
                  <Field label="Reason / Condition" value={med.reason} onChange={v => updateMed(i, 'reason', v)} />
                  <div className="col-span-2"><Field label="Notes" value={med.notes} onChange={v => updateMed(i, 'notes', v)} rows={2} /></div>
                </div>
              ) : (
                <div className="text-sm space-y-0.5" style={{ color: '#4A2C0A' }}>
                  <p className="font-bold">{med.name} {med.dosage}</p>
                  {med.frequency && <p style={{ color: '#B8A080' }}>{med.frequency}</p>}
                  {med.nextDue && <p style={{ color: '#B8A080' }}>Next due: {med.nextDue}</p>}
                </div>
              )}
            </div>
          ))}

          {/* ── Weight readings ──────────────────────────────────────────────── */}
          {weightItems.length > 0 && (
            <div className="card" style={{ borderColor: '#FDE68A' }}>
              <div className="flex items-center gap-2 mb-3">
                <Weight className="w-4 h-4" style={{ color: '#D97706' }} />
                <span className="font-black text-sm" style={{ color: '#4A2C0A' }}>Weight Readings Detected</span>
              </div>
              <div className="space-y-2">
                {weightItems.map((w, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <input type="date" className="input text-sm py-1 w-36" value={w.date || ''}
                      onChange={e => updateWeight(i, 'date', e.target.value)} />
                    <div className="flex items-center gap-1">
                      <input type="number" step="0.1" min="0" className="input text-sm py-1 w-24" value={w.weight || ''}
                        onChange={e => updateWeight(i, 'weight', e.target.value)} />
                      <span className="text-sm" style={{ color: '#B8A080' }}>kg</span>
                    </div>
                    {savedWeights.has(i)
                      ? <SavedBadge />
                      : <SaveBtn onClick={() => handleSaveWeight(i)} label="→ Weight Tracker" saving={savingSet.has(`wt_${i}`)} />}
                    {saveErrors[`wt_${i}`] && <p className="text-xs text-red-500 w-full">{saveErrors[`wt_${i}`]}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Bill ─────────────────────────────────────────────────────────── */}
          {billItem && (
            <div className="card" style={{ borderColor: billSaved ? '#A7F3D0' : '#FCD34D', backgroundColor: billSaved ? '#F0FDF4' : 'white' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4" style={{ color: '#D97706' }} />
                  <span className="font-black text-sm" style={{ color: '#4A2C0A' }}>Bill / Invoice</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {billSaved ? <SavedBadge /> : <SaveBtn onClick={handleSaveBill} label="Save Bill" saving={savingSet.has('bill')} />}
                  {saveErrors['bill'] && <p className="text-xs text-red-500">{saveErrors['bill']}</p>}
                </div>
              </div>
              {!billSaved ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <Field label="Clinic / Hospital" value={billItem.clinic} onChange={v => setBillItem(b => ({ ...b, clinic: v }))} />
                    </div>
                    <Field label="Date" value={billItem.date} onChange={v => setBillItem(b => ({ ...b, date: v }))} type="date" />
                    <Field label="Invoice #" value={billItem.invoiceNumber} onChange={v => setBillItem(b => ({ ...b, invoiceNumber: v }))} />
                    <Field label="Currency" value={billItem.currency || 'INR'} onChange={v => setBillItem(b => ({ ...b, currency: v }))} options={CURRENCIES} />
                  </div>

                  {/* Line items */}
                  {billItem.lineItems?.length > 0 && (
                    <div>
                      <label className="label text-xs">Line Items</label>
                      <div className="space-y-1.5">
                        {billItem.lineItems.map((row, ri) => (
                          <div key={ri} className="flex gap-2 items-center">
                            <input className="input text-sm py-1 flex-1" value={row.description || ''}
                              onChange={e => updateBillLine(ri, 'description', e.target.value)} placeholder="Description" />
                            <input className="input text-sm py-1 w-24" type="number" value={row.amount || ''}
                              onChange={e => updateBillLine(ri, 'amount', e.target.value)} placeholder="Amount" />
                            <button onClick={() => setBillItem(b => ({ ...b, lineItems: b.lineItems.filter((_, k) => k !== ri) }))}
                              className="text-red-400 hover:text-red-600 flex-shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button onClick={() => setBillItem(b => ({ ...b, lineItems: [...(b.lineItems || []), { description: '', amount: '' }] }))}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg"
                    style={{ backgroundColor: '#FFF5AA', color: '#4A2C0A' }}>
                    + Add line
                  </button>

                  <div className="flex justify-between items-center pt-1">
                    <span className="text-sm" style={{ color: '#B8A080' }}>Total</span>
                    <div className="flex items-center gap-2">
                      <input type="number" className="input text-sm py-1 w-28 font-black"
                        value={billItem.totalAmount || ''}
                        onChange={e => setBillItem(b => ({ ...b, totalAmount: e.target.value }))} />
                      <span className="text-sm" style={{ color: '#B8A080' }}>{billItem.currency || 'INR'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm space-y-1" style={{ color: '#4A2C0A' }}>
                  <p className="font-bold">{billItem.clinic}</p>
                  {billItem.date && <p style={{ color: '#B8A080' }}>{billItem.date}</p>}
                  {billItem.totalAmount && (
                    <p className="font-black text-base">
                      {billItem.currency || 'INR'} {parseFloat(billItem.totalAmount).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Medical record ───────────────────────────────────────────────── */}
          {recordItem && (
            <div className="card" style={{ borderColor: recordSaved ? '#A7F3D0' : '#BFDBFE', backgroundColor: recordSaved ? '#F0FDF4' : 'white' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-black text-sm" style={{ color: '#4A2C0A' }}>🏥 Medical Record</span>
                <div className="flex flex-col items-end gap-1">
                  {recordSaved ? <SavedBadge /> : <SaveBtn onClick={handleSaveRecord} label="Save Record" saving={savingSet.has('record')} />}
                  {saveErrors['record'] && <p className="text-xs text-red-500">{saveErrors['record']}</p>}
                </div>
              </div>
              {!recordSaved ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2"><Field label="Title / Diagnosis" value={recordItem.title} onChange={v => setRecordItem(r => ({ ...r, title: v }))} /></div>
                  <Field label="Date" value={recordItem.date} onChange={v => setRecordItem(r => ({ ...r, date: v }))} type="date" />
                  <Field label="Type" value={recordItem.type || 'Other'} onChange={v => setRecordItem(r => ({ ...r, type: v }))}
                    options={['Checkup', 'Illness', 'Surgery', 'Lab Result', 'Prescription', 'Other']} />
                  <Field label="Vet / Clinic" value={recordItem.vet} onChange={v => setRecordItem(r => ({ ...r, vet: v }))} />
                  <Field label="Cost" value={recordItem.cost} onChange={v => setRecordItem(r => ({ ...r, cost: v }))} type="number" />
                  <div className="col-span-2"><Field label="Description" value={recordItem.description} onChange={v => setRecordItem(r => ({ ...r, description: v }))} rows={3} /></div>
                </div>
              ) : (
                <div className="text-sm" style={{ color: '#4A2C0A' }}>
                  <p className="font-bold">{recordItem.title}</p>
                  {recordItem.date && <p style={{ color: '#B8A080' }}>{recordItem.date}</p>}
                </div>
              )}
            </div>
          )}

          {/* ── Allergy ──────────────────────────────────────────────────────── */}
          {allergyItem && (
            <div className="card" style={{ borderColor: allergySaved ? '#A7F3D0' : '#FCA5A5', backgroundColor: allergySaved ? '#F0FDF4' : 'white' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-black text-sm" style={{ color: '#4A2C0A' }}>⚠️ Allergy</span>
                <div className="flex flex-col items-end gap-1">
                  {allergySaved ? <SavedBadge /> : <SaveBtn onClick={handleSaveAllergy} label="Save Allergy" saving={savingSet.has('allergy')} />}
                  {saveErrors['allergy'] && <p className="text-xs text-red-500">{saveErrors['allergy']}</p>}
                </div>
              </div>
              {!allergySaved ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2"><Field label="Allergen" value={allergyItem.allergen} onChange={v => setAllergyItem(a => ({ ...a, allergen: v }))} /></div>
                  <Field label="Type" value={allergyItem.type || 'Other'} onChange={v => setAllergyItem(a => ({ ...a, type: v }))}
                    options={['Food', 'Environmental', 'Medication', 'Contact', 'Other']} />
                  <Field label="Severity" value={allergyItem.severity || 'Mild'} onChange={v => setAllergyItem(a => ({ ...a, severity: v }))}
                    options={['Mild', 'Moderate', 'Severe']} />
                </div>
              ) : (
                <p className="text-sm font-bold" style={{ color: '#4A2C0A' }}>{allergyItem.allergen} — {allergyItem.severity}</p>
              )}
            </div>
          )}

          {/* ── Abnormalities (read-only) ─────────────────────────────────────── */}
          {abnormalities.length > 0 && (
            <div className="card" style={{ borderColor: '#FCA5A5', backgroundColor: '#FFF5F5' }}>
              <p className="font-black text-sm mb-2" style={{ color: '#DC2626' }}>⚠️ {abnormalities.length} Abnormal Lab Value{abnormalities.length > 1 ? 's' : ''}</p>
              <div className="space-y-1.5">
                {abnormalities.map((a, i) => {
                  const clr = { Severe: ['#DC2626', '#FEE2E2'], Moderate: ['#D97706', '#FEF3C7'], Mild: ['#CA8A04', '#FEF9C3'] }[a.severity] || ['#DC2626', '#FEE2E2']
                  return (
                    <div key={i} className="text-xs rounded-lg px-2 py-1.5" style={{ backgroundColor: clr[1], color: clr[0] }}>
                      <span className="font-bold">{a.parameter}</span> {a.value}{a.unit} —{' '}
                      <span className="font-semibold">{a.status} ({a.severity})</span>
                      {a.clinicalNote && <span className="ml-1 opacity-75">· {a.clinicalNote}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Future timelines → reminders ─────────────────────────────────── */}
          {timelineItems.length > 0 && (
            <div className="card" style={{ borderColor: '#E8D9B0' }}>
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4" style={{ color: '#D4A800' }} />
                <span className="font-black text-sm" style={{ color: '#4A2C0A' }}>Upcoming Dates</span>
              </div>
              <div className="space-y-2">
                {timelineItems.map((t, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: '#4A2C0A' }}>{t.label}</p>
                      <p className="text-xs" style={{ color: '#B8A080' }}>
                        {format(parseISO(t.date), 'MMM d, yyyy')} · {t.type}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {savedTimelines.has(i)
                        ? <SavedBadge />
                        : <SaveBtn onClick={() => handleSaveTimeline(i)} label="+ Reminder" saving={savingSet.has(`tl_${i}`)} />}
                      {saveErrors[`tl_${i}`] && <p className="text-xs text-red-500">{saveErrors[`tl_${i}`]}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Vet questions ─────────────────────────────────────────────────── */}
          {(loadingQuestions || vetQuestions.length > 0) && (
            <div className="card" style={{ borderColor: '#C2DFF0', backgroundColor: '#F0F8FF' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" style={{ color: '#2563EB' }} />
                  <span className="font-bold" style={{ color: '#1E3A5F' }}>Questions to ask your Vet</span>
                </div>
                {vetQuestions.length > 0 && (
                  <button onClick={handleCopyQuestions}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold"
                    style={{ backgroundColor: copied ? '#D1FAE5' : '#DBEAFE', color: copied ? '#065F46' : '#1D4ED8' }}>
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied!' : 'Copy all'}
                  </button>
                )}
              </div>

              {loadingQuestions && (
                <div className="flex items-center gap-2 text-sm py-1" style={{ color: '#2563EB' }}>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating questions based on this report…
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
                💡 These questions are tailored to this specific report. Tap "Copy all" to share with your vet.
              </p>
            </div>
          )}

          {/* Scan another */}
          <button
            onClick={() => { setFile(null); setPreview(null); setParsed(null) }}
            className="btn-secondary w-full">
            Scan Another Document
          </button>
        </div>
      )}
    </div>
  )
}
