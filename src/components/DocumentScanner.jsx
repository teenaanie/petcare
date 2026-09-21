import { useState, useRef } from 'react'
import { ChevronRight, Upload, Camera, FileText, Loader2, CheckCircle, AlertCircle, Wand2, Calendar, TriangleAlert, MessageSquare, Copy, Check, Syringe, Pill, Receipt, Weight, X, Plus } from 'lucide-react'
import { saveMedicalRecord, saveVaccination, saveAllergy, saveReminder, saveMedicine, saveBill, saveWeightLog } from '../lib/storage.js'
import { format, isPast, parseISO } from 'date-fns'
import { aiComplete } from '../lib/ai.js'

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

async function analyzeDocument(file, session) {
  const isPdf = file.type === 'application/pdf'
  const base64 = isPdf ? await pdfToImageBase64(file) : await fileToBase64(file)
  const mimeType = isPdf ? 'image/png' : (file.type || 'image/jpeg')

  // The parsing prompt lives in netlify/functions/analyze-document.js along with
  // the API key. This used to have a second branch that called api.openai.com
  // directly whenever VITE_OPENAI_API_KEY was set — which, once that variable
  // was set in production, silently bypassed this authenticated, rate-limited
  // route for every user. There is now one door.
  if (!session?.access_token) throw new Error('Please sign in to use the scanner.')

  const res = await fetch('/api/analyze-document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ base64, mimeType }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (data.limitReached) throw new Error(data.error)
    throw new Error(data.error || `Server error ${res.status}`)
  }
  return data.result
}

// ── Vet questions ─────────────────────────────────────────────────────────────

async function generateVetQuestions(parsed, petName, session) {
  // Best-effort: the questions are a bonus on top of a successful scan, so a
  // failure here returns an empty list rather than surfacing an error over the
  // parsed document the user actually came for.
  try {
    const qs = await aiComplete('vet_questions', { parsed, petName }, session)
    return Array.isArray(qs) ? qs : []
  } catch {
    return []
  }
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function isFutureDate(dateStr) {
  if (!dateStr) return false
  try { return !isPast(parseISO(dateStr)) } catch { return false }
}

function SavedBadge() {
  return (
    <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
      style={{ backgroundColor: '#eef3e2', color: '#44562a' }}>
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

export default function DocumentScanner({ pet, session }) {
  // A share sheet or a multi-select sends several documents at once. Rather
  // than rebuild the review UI — which is per-item, editable and already the
  // contract for "the AI proposes, the human confirms" — a queue feeds that
  // same flow one document at a time, with an explicit position so nobody
  // wonders which of six they are looking at.
  const [queue, setQueue]         = useState([])   // [{ id, file, done }]
  const [queueIndex, setQueueIndex] = useState(0)
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

  /**
   * Accepts one file or many. Each document is a separate AI call against the
   * monthly allowance, so the count is shown before anything is processed and
   * files can be dropped first — a thirty-image WhatsApp thread would otherwise
   * burn a third of the month in one gesture.
   */
  function handleFiles(list) {
    const files = Array.from(list || []).filter(Boolean)
    if (!files.length) return
    setQueue(files.map((f, i) => ({ id: `${Date.now()}-${i}`, file: f, done: false })))
    setQueueIndex(0)
    handleFile(files[0])
  }

  function dropFromQueue(id) {
    const i = queue.findIndex(x => x.id === id)
    if (i < 0 || i === queueIndex) return          // the open one is not removable
    const next = queue.filter(x => x.id !== id)
    setQueue(next)
    // Removing something ABOVE the open document shifts every later index down
    // by one, so the pointer has to follow or it silently lands on the wrong
    // file. Removing something below it changes nothing.
    if (i < queueIndex) setQueueIndex(n => n - 1)
    if (!next.length) { setFile(null); setPreview(null); setParsed(null) }
  }

  function advanceQueue() {
    const next = queueIndex + 1
    if (next >= queue.length) return
    setQueue(q => q.map((x, i) => i === queueIndex ? { ...x, done: true } : x))
    setQueueIndex(next)
    handleFile(queue[next].file)
  }

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
      const result = await analyzeDocument(file, session)
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
      generateVetQuestions(result, pet.name, session)
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
      <h2 className="text-lg font-black mb-1" style={{ color: '#7a4900' }}>Scan Medical Documents</h2>
      <p className="text-sm mb-1" style={{ color: '#7a4900', fontWeight: 700 }}>
        Just snap or upload — we'll handle the rest. ✨
      </p>
      <p className="text-sm mb-5" style={{ color: '#73775b' }}>
        Vet bills, prescriptions, vaccination cards, deworming schedules — our AI reads them and fills in every detail for you.
      </p>

      {/* Upload area */}
      <div className="flex gap-3 mb-4">
        <button onClick={() => cameraRef.current?.click()}
          className="flex-1 flex flex-col items-center gap-2 py-5 rounded-xl border-2 border-dashed transition-all"
          style={{ borderColor: '#f2b83d', backgroundColor: '#fff9e0' }}>
          <Camera className="w-7 h-7" style={{ color: '#c99a2e' }} />
          <span className="text-sm font-bold" style={{ color: '#7a4900' }}>Scan with Camera</span>
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />

        <button onClick={() => uploadRef.current?.click()}
          className="flex-1 flex flex-col items-center gap-2 py-5 rounded-xl border-2 border-dashed transition-all"
          style={{ borderColor: '#e0d3b4', backgroundColor: 'white' }}>
          <Upload className="w-7 h-7" style={{ color: '#73775b' }} />
          <span className="text-sm font-bold" style={{ color: '#7a4900' }}>Upload File</span>
          <span className="text-xs" style={{ color: '#73775b' }}>JPG, PNG or PDF</span>
        </button>
        <input ref={uploadRef} type="file" accept="image/*,.pdf" multiple className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
      </div>

      {/* Queue — only when there is actually more than one document */}
      {queue.length > 1 && (
        <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: '#fff3c0' }}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-sm font-black" style={{ color: '#7a4900' }}>
              Document {Math.min(queueIndex + 1, queue.length)} of {queue.length}
            </p>
            <p className="text-xs" style={{ color: '#7a4900' }}>
              {queue.length} scan{queue.length === 1 ? '' : 's'} from your monthly allowance
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {queue.map((q, i) => (
              <span key={q.id}
                className="text-[11px] font-bold px-2 py-1 rounded-lg flex items-center gap-1 max-w-[12rem]"
                style={i === queueIndex
                  ? { backgroundColor: '#f2b83d', color: '#7a4900' }
                  : q.done ? { backgroundColor: '#eef3e2', color: '#44562a' }
                  : { backgroundColor: '#fffdf2', color: '#a08f7a' }}>
                <span className="truncate">{q.done ? '✓ ' : ''}{q.file.name}</span>
                {i !== queueIndex && !q.done && (
                  <button onClick={() => dropFromQueue(q.id)} title="Remove — it won't be scanned">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
          <p className="text-[11px] mt-2" style={{ color: '#9a6b12' }}>
            Each one is read separately and reviewed by you before anything is saved.
            Remove any you don't need before starting.
          </p>
        </div>
      )}

      {/* Preview */}
      {file && (
        <div className="card border-dashed flex flex-col items-center py-4 mb-4 cursor-pointer"
          style={{ borderStyle: 'dashed', borderColor: '#e0d3b4' }}
          onClick={() => uploadRef.current?.click()}>
          {preview
            ? <img src={preview} alt="Preview" className="max-h-48 rounded-lg mb-2 object-contain" />
            : <FileText className="w-10 h-10 mb-2" style={{ color: '#73775b' }} />}
          <p className="text-sm" style={{ color: '#7a4900' }}>{file.name}</p>
          <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>Click to change</p>
        </div>
      )}

      {file && !loading && !parsed && (
        <div className="flex items-center gap-3 mb-4">
          <button onClick={handleAnalyze} className="btn-primary flex items-center gap-2">
            <Wand2 className="w-4 h-4" /> Analyze with AI
          </button>
          {queueIndex + 1 < queue.length && (
            <button onClick={advanceQueue}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-colors"
              style={{ backgroundColor: '#ebe3d3', color: '#7a4900' }}>
              <ChevronRight className="w-4 h-4" /> Skip this one
            </button>
          )}
          <button onClick={() => { setQueue([]); setQueueIndex(0); setFile(null); setPreview(null); setError(null) }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-colors"
            style={{ backgroundColor: '#ebe3d3', color: '#7a4900' }}>
            <X className="w-4 h-4" /> Cancel
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 mb-4 py-3 px-4 rounded-xl" style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
          <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">Analysing with AI…</p>
            {loadingStep && <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>{loadingStep}</p>}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 mb-4 p-3 rounded-xl text-sm"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
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
          {/* Summary + cancel */}
          <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
            <div className="flex items-start justify-between gap-2">
              <p><span className="font-bold">Summary: </span>{parsed.summary}</p>
              <button
                onClick={() => { setFile(null); setPreview(null); setParsed(null); setError(null) }}
                title="Cancel and start over"
                className="flex-shrink-0 p-1 rounded-lg hover:bg-amber-200 transition-colors"
                style={{ color: '#7a4900' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── Vaccinations ────────────────────────────────────────────────── */}
          {vaxItems.map((vax, i) => (
            <div key={i} className="card" style={{ borderColor: savedVax.has(i) ? '#d7e5bd' : '#f7dbe3', backgroundColor: savedVax.has(i) ? '#f4f8ea' : 'white' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Syringe className="w-4 h-4" style={{ color: '#b2566f' }} />
                  <span className="font-black text-sm" style={{ color: '#7a4900' }}>Vaccination {vaxItems.length > 1 ? i + 1 : ''}</span>
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
                <div className="text-sm space-y-0.5" style={{ color: '#7a4900' }}>
                  <p className="font-bold">{vax.name}</p>
                  {vax.dateGiven && <p style={{ color: '#73775b' }}>Given: {vax.dateGiven}{vax.nextDue ? ` · Next: ${vax.nextDue}` : ''}</p>}
                  {vax.vet && <p style={{ color: '#73775b' }}>{vax.vet}</p>}
                </div>
              )}
            </div>
          ))}

          {/* ── Medicines ────────────────────────────────────────────────────── */}
          {medItems.map((med, i) => (
            <div key={i} className="card" style={{ borderColor: savedMeds.has(i) ? '#d7e5bd' : '#d7e5bd', backgroundColor: savedMeds.has(i) ? '#f4f8ea' : 'white' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Pill className="w-4 h-4" style={{ color: '#5f7a3a' }} />
                  <span className="font-black text-sm" style={{ color: '#7a4900' }}>Medicine {medItems.length > 1 ? i + 1 : ''}</span>
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
                <div className="text-sm space-y-0.5" style={{ color: '#7a4900' }}>
                  <p className="font-bold">{med.name} {med.dosage}</p>
                  {med.frequency && <p style={{ color: '#73775b' }}>{med.frequency}</p>}
                  {med.nextDue && <p style={{ color: '#73775b' }}>Next due: {med.nextDue}</p>}
                </div>
              )}
            </div>
          ))}

          {/* ── Weight readings ──────────────────────────────────────────────── */}
          {weightItems.length > 0 && (
            <div className="card" style={{ borderColor: '#ffde59' }}>
              <div className="flex items-center gap-2 mb-3">
                <Weight className="w-4 h-4" style={{ color: '#c9891f' }} />
                <span className="font-black text-sm" style={{ color: '#7a4900' }}>Weight Readings Detected</span>
              </div>
              <div className="space-y-2">
                {weightItems.map((w, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <input type="date" className="input text-sm py-1 w-36" value={w.date || ''}
                      onChange={e => updateWeight(i, 'date', e.target.value)} />
                    <div className="flex items-center gap-1">
                      <input type="number" step="0.1" min="0" className="input text-sm py-1 w-24" value={w.weight || ''}
                        onChange={e => updateWeight(i, 'weight', e.target.value)} />
                      <span className="text-sm" style={{ color: '#73775b' }}>kg</span>
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
            <div className="card" style={{ borderColor: billSaved ? '#d7e5bd' : '#ffde59', backgroundColor: billSaved ? '#f4f8ea' : 'white' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4" style={{ color: '#c9891f' }} />
                  <span className="font-black text-sm" style={{ color: '#7a4900' }}>Bill / Invoice</span>
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
                    style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
                    + Add line
                  </button>

                  <div className="flex justify-between items-center pt-1">
                    <span className="text-sm" style={{ color: '#73775b' }}>Total</span>
                    <div className="flex items-center gap-2">
                      <input type="number" className="input text-sm py-1 w-28 font-black"
                        value={billItem.totalAmount || ''}
                        onChange={e => setBillItem(b => ({ ...b, totalAmount: e.target.value }))} />
                      <span className="text-sm" style={{ color: '#73775b' }}>{billItem.currency || 'INR'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm space-y-1" style={{ color: '#7a4900' }}>
                  <p className="font-bold">{billItem.clinic}</p>
                  {billItem.date && <p style={{ color: '#73775b' }}>{billItem.date}</p>}
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
            <div className="card" style={{ borderColor: recordSaved ? '#d7e5bd' : '#bfe5ef', backgroundColor: recordSaved ? '#f4f8ea' : 'white' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-black text-sm" style={{ color: '#7a4900' }}>🏥 Medical Record</span>
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
                <div className="text-sm" style={{ color: '#7a4900' }}>
                  <p className="font-bold">{recordItem.title}</p>
                  {recordItem.date && <p style={{ color: '#73775b' }}>{recordItem.date}</p>}
                </div>
              )}
            </div>
          )}

          {/* ── Allergy ──────────────────────────────────────────────────────── */}
          {allergyItem && (
            <div className="card" style={{ borderColor: allergySaved ? '#d7e5bd' : '#e79a94', backgroundColor: allergySaved ? '#f4f8ea' : 'white' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-black text-sm" style={{ color: '#7a4900' }}>⚠️ Allergy</span>
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
                <p className="text-sm font-bold" style={{ color: '#7a4900' }}>{allergyItem.allergen} — {allergyItem.severity}</p>
              )}
            </div>
          )}

          {/* ── Abnormalities (read-only) ─────────────────────────────────────── */}
          {abnormalities.length > 0 && (
            <div className="card" style={{ borderColor: '#e79a94', backgroundColor: '#fdeaea' }}>
              <p className="font-black text-sm mb-2" style={{ color: '#c0392b' }}>⚠️ {abnormalities.length} Abnormal Lab Value{abnormalities.length > 1 ? 's' : ''}</p>
              <div className="space-y-1.5">
                {abnormalities.map((a, i) => {
                  const clr = { Severe: ['#c0392b', '#fdeaea'], Moderate: ['#c9891f', '#fff3c0'], Mild: ['#c9891f', '#fff3c0'] }[a.severity] || ['#c0392b', '#fdeaea']
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
            <div className="card" style={{ borderColor: '#e0d3b4' }}>
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4" style={{ color: '#c99a2e' }} />
                <span className="font-black text-sm" style={{ color: '#7a4900' }}>Upcoming Dates</span>
              </div>
              <div className="space-y-2">
                {timelineItems.map((t, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: '#7a4900' }}>{t.label}</p>
                      <p className="text-xs" style={{ color: '#73775b' }}>
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
            <div className="card" style={{ borderColor: '#bfe5ef', backgroundColor: '#eef8fb' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" style={{ color: '#2f7286' }} />
                  <span className="font-bold" style={{ color: '#1f4b57' }}>Questions to ask your Vet</span>
                </div>
                {vetQuestions.length > 0 && (
                  <button onClick={handleCopyQuestions}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold"
                    style={{ backgroundColor: copied ? '#eef3e2' : '#dceff5', color: copied ? '#44562a' : '#255d6e' }}>
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied!' : 'Copy all'}
                  </button>
                )}
              </div>

              {loadingQuestions && (
                <div className="flex items-center gap-2 text-sm py-1" style={{ color: '#2f7286' }}>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating questions based on this report…
                </div>
              )}

              {vetQuestions.length > 0 && (
                <ol className="space-y-2">
                  {vetQuestions.map((q, i) => (
                    <li key={i} className="flex gap-3 text-sm rounded-xl p-3"
                      style={{ backgroundColor: 'white', border: '1px solid #bfe5ef' }}>
                      <span className="font-black flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                        style={{ backgroundColor: '#f2b83d', color: '#7a4900' }}>
                        {i + 1}
                      </span>
                      <span style={{ color: '#1f4b57' }}>{q}</span>
                    </li>
                  ))}
                </ol>
              )}

              <p className="text-xs mt-3" style={{ color: '#2f7286' }}>
                💡 These questions are tailored to this specific report. Tap "Copy all" to share with your vet.
              </p>
            </div>
          )}

          {/* Next in the queue, or start over */}
          {queueIndex + 1 < queue.length ? (
            <div className="space-y-2">
              <button onClick={advanceQueue} className="btn-primary w-full gap-2">
                <ChevronRight className="w-4 h-4" />
                Next document ({queueIndex + 2} of {queue.length})
              </button>
              <p className="text-[11px] text-center" style={{ color: '#a08f7a' }}>
                Anything you saved above is kept.
              </p>
            </div>
          ) : (
            <button
              onClick={() => { setQueue([]); setQueueIndex(0); setFile(null); setPreview(null); setParsed(null) }}
              className="btn-secondary w-full">
              Scan Another Document
            </button>
          )}
        </div>
      )}
    </div>
  )
}
