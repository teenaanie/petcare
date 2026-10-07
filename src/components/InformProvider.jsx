// Inform provider — the customer's side of the note.
//
// The contract this screen exists to keep: NOTHING leaves the app that the
// customer has not read. The facts block below is composed in code (see
// src/lib/providerBrief.js), the covering line is generated, and both sit in
// editable textareas before anything is sent. That is the depth control — not a
// field whitelist, which no schema change survives.
//
// It is also why there is no "send without reviewing" path, however much
// quicker that would be.

import { useState, useEffect, useMemo } from 'react'
import { X, Send, Loader2, AlertCircle, Sparkles, CheckCircle2, Building2 } from 'lucide-react'
import { reportHandled } from '../lib/errorReport.js'
import { trackEvent } from '../lib/analytics.js'
import { aiComplete } from '../lib/ai.js'
import { getMyProviders } from '../lib/myProviders.js'
import {
  getOnboardedProviderIds, sendProviderNote, getProviderNotes,
  getVaccinations, getAllergies, getMedicines, getMedicalHistory,
} from '../lib/storage.js'
import { composeFacts, factsToText, fallbackCoveringNote, formatDay } from '../lib/providerBrief.js'
import { todayIST } from '../lib/dates.js'

/** The category words the covering line is allowed to know about. No values. */
function topicsFrom(facts) {
  const t = []
  if (facts?.vaccinations?.length) t.push('vaccinations')
  if (facts?.allergies?.length)    t.push('allergies')
  if (facts?.medicines?.length)    t.push('current medication')
  if (facts?.boarding?.feedingSchedule || facts?.boarding?.dietNotes) t.push('feeding')
  if (facts?.boarding?.temperament || facts?.boarding?.anxietyNotes)  t.push('temperament')
  if (facts?.lastMedical)          t.push('a recent vet visit')
  if (facts?.vet?.phone)           t.push('vet contact')
  return t
}

export default function InformProvider({ pet, onClose, onSent }) {
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [options, setOptions]   = useState([])      // informable providers
  const [picked, setPicked]     = useState(null)
  const [facts, setFacts]       = useState(null)

  const [note, setNote]         = useState('')
  const [factsText, setFactsText] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn]     = useState('')
  const [contactName, setContactName]   = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  const [history, setHistory]   = useState([])
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending]   = useState(false)
  const [sent, setSent]         = useState(false)

  // Which of this pet's providers can actually receive a note: a My Providers
  // row pointing at a directory listing, where that listing has an ACTIVE
  // claim. A hand-typed provider has no listing to inform.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [mine, vax, alg, meds, recs, past] = await Promise.all([
          getMyProviders(),
          getVaccinations(pet.id), getAllergies(pet.id),
          getMedicines(pet.id),   getMedicalHistory(pet.id),
          getProviderNotes(pet.id),
        ])
        if (cancelled) return
        setHistory(past || [])

        // Providers attached to this pet, plus the ones kept at account level.
        const relevant = (mine || []).filter(p => p.providerId && (!p.petId || p.petId === pet.id))
        const onboarded = await getOnboardedProviderIds(relevant.map(p => p.providerId))
        if (cancelled) return

        // One entry per business, even if it is saved under two categories.
        const seen = new Set()
        const informable = relevant.filter(p => {
          if (!onboarded.has(p.providerId) || seen.has(p.providerId)) return false
          seen.add(p.providerId); return true
        })

        setOptions(informable)
        setPicked(informable.length === 1 ? informable[0] : null)
        setFacts(composeFacts({
          pet, vaccinations: vax, allergies: alg, medicines: meds, medicalRecords: recs,
        }))
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        reportHandled(e, { view: 'inform-provider' })
        setError(e.message || 'Could not load this pet’s details.')
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [pet.id])

  // Fill the draft once a business is chosen. The facts are ready immediately;
  // the covering line is fetched and simply replaces the fallback if it arrives.
  // Generation is an improvement to one sentence, never a dependency of
  // sending — offline, over budget, or model down, this screen still works.
  useEffect(() => {
    if (!picked || !facts) return
    setFactsText(factsToText(facts))
    setNote(fallbackCoveringNote(pet.name, picked.name))
    let cancelled = false
    setDrafting(true)
    aiComplete('provider_brief', {
      petName: pet.name, providerName: picked.name, topics: topicsFrom(facts),
    })
      .then(text => {
        if (cancelled || typeof text !== 'string' || !text.trim()) return
        setNote(text.trim())
      })
      .catch(e => { if (!cancelled) reportHandled(e, { view: 'inform-provider-draft' }) })
      .finally(() => { if (!cancelled) setDrafting(false) })
    return () => { cancelled = true }
  }, [picked, facts, pet.name])

  const petLabel = useMemo(() => {
    if (!facts) return pet.name || ''
    return [facts.pet.name, facts.pet.breed, facts.pet.species].filter(Boolean).join(', ')
  }, [facts, pet.name])

  const windowBad = startsOn && endsOn && endsOn < startsOn
  const canSend = picked && note.trim() && !sending && !windowBad

  async function handleSend() {
    if (!canSend) return
    setSending(true); setError(null)
    try {
      // The body is what the provider reads: the covering line and the facts
      // the customer left in place, as one piece of text. `facts` goes along
      // as structured jsonb so a later screen can render it properly, but the
      // text is the record of what was actually sent.
      const body = [note.trim(), factsText.trim()].filter(Boolean).join('\n\n')
      await sendProviderNote({
        providerId: picked.providerId, petId: pet.id, body, facts,
        petLabel, contactName: contactName.trim() || null,
        contactPhone: contactPhone.trim() || null,
        contactEmail: contactEmail.trim() || null,
        startsOn: startsOn || null, endsOn: endsOn || null,
      })
      trackEvent('provider_note_sent', {
        species: pet.species || '', hasStay: !!startsOn,
      })
      setSent(true)
      try { setHistory(await getProviderNotes(pet.id)) } catch { /* the send stands regardless */ }
      onSent?.()
    } catch (e) {
      reportHandled(e, { view: 'inform-provider-send' })
      setError(e.message || 'Could not send that. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const field = 'input w-full'
  const label = 'label text-xs'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(74,44,10,0.35)' }} onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl"
        style={{ backgroundColor: '#FFFEF8' }} onClick={e => e.stopPropagation()}>

        <div className="sticky top-0 flex items-center justify-between px-5 py-4 z-10"
          style={{ backgroundColor: '#FFFEF8', borderBottom: '1px solid #f0e6c8' }}>
          <h2 className="font-black" style={{ color: '#7a4900' }}>
            {sent ? 'Sent' : `Inform a provider about ${pet.name}`}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: '#73775b' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 py-8" style={{ color: '#73775b' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl text-sm"
              style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}

          {sent && (
            <div className="text-center py-8">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3" style={{ color: '#5f7a3a' }} />
              <p className="font-bold" style={{ color: '#4A2C0A' }}>
                {picked?.name} has it.
              </p>
              <p className="text-sm mt-1" style={{ color: '#73775b' }}>
                It is under {pet.name}, and they can read it whenever they sign in.
                A note cannot be taken back — send a new one to correct it.
              </p>
              <button onClick={onClose} className="btn-primary mt-5">Done</button>
            </div>
          )}

          {/* Nobody to inform. Said plainly, because the reason is specific and
              the user can act on it. */}
          {!loading && !sent && options.length === 0 && (
            <div className="text-center py-8">
              <Building2 className="w-9 h-9 mx-auto mb-3" style={{ color: '#b08d57' }} />
              <p className="font-bold mb-1" style={{ color: '#4A2C0A' }}>
                None of your providers are on Pippy yet
              </p>
              <p className="text-sm" style={{ color: '#73775b' }}>
                This works once a business you have saved in My Providers has
                claimed their Pippy listing. Hand-typed providers cannot receive
                a note, because there is no account to send it to.
              </p>
            </div>
          )}

          {/* What has already gone out, and to whom. The whole chain, including
              notes a later one superseded — the provider's inbox is what hides
              the superseded ones; the person who sent them should still be able
              to see what they sent. */}
          {!loading && !sent && history.length > 0 && (
            <details className="rounded-xl" style={{ backgroundColor: '#fffef8', border: '1px solid #f0e6c8' }}>
              <summary className="px-3 py-2 text-xs font-bold cursor-pointer" style={{ color: '#7a4900' }}>
                Already sent ({history.length})
              </summary>
              <div className="px-3 pb-3 space-y-2">
                {history.map(h => {
                  const to = options.find(o => o.providerId === h.providerId)
                  const superseded = history.some(x => x.supersedes === h.id)
                  return (
                    <div key={h.id} className="text-xs" style={{ color: '#5f624b' }}>
                      <p className="font-bold" style={{ color: '#4A2C0A' }}>
                        {to?.nickname || to?.name || 'a provider'}
                        <span className="font-normal" style={{ color: '#b08d57' }}>
                          {' · '}{formatDay(String(h.sentAt).slice(0, 10)) || ''}
                          {superseded && ' · replaced by a later note'}
                        </span>
                      </p>
                      <p className="whitespace-pre-wrap line-clamp-3" style={{ color: '#73775b' }}>{h.body}</p>
                    </div>
                  )
                })}
              </div>
            </details>
          )}

          {!loading && !sent && options.length > 0 && (
            <>
              {options.length > 1 && (
                <div>
                  <label className={label}>Send to</label>
                  <div className="flex flex-wrap gap-1.5">
                    {options.map(o => (
                      <button key={o.providerId} type="button" onClick={() => setPicked(o)}
                        className="px-3 py-1.5 rounded-full text-xs font-bold"
                        style={picked?.providerId === o.providerId
                          ? { backgroundColor: '#ffde59', color: '#7a4900' }
                          : { backgroundColor: '#f5f0e0', color: '#73775b' }}>
                        {o.nickname || o.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {picked && (
                <>
                  <div>
                    <label className={label}>
                      Your note
                      {drafting && (
                        <span className="ml-2 inline-flex items-center gap-1 font-normal"
                          style={{ color: '#b08d57' }}>
                          <Sparkles className="w-3 h-3" /> drafting…
                        </span>
                      )}
                    </label>
                    <textarea value={note} onChange={e => setNote(e.target.value)}
                      rows={3} className={field} />
                  </div>

                  <div>
                    <label className={label}>What they will see</label>
                    <textarea value={factsText} onChange={e => setFactsText(e.target.value)}
                      rows={12} className={field} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }} />
                    {/* The one sentence that makes the whole model legible. */}
                    <p className="text-xs mt-1" style={{ color: '#73775b' }}>
                      Edit or delete anything here. {picked.nickname || picked.name} sees
                      exactly this and nothing else — no records, no documents, no bills.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={label}>Staying from</label>
                      <input type="date" value={startsOn} min={todayIST()}
                        onChange={e => setStartsOn(e.target.value)} className={field} />
                    </div>
                    <div>
                      <label className={label}>until</label>
                      <input type="date" value={endsOn} min={startsOn || todayIST()}
                        onChange={e => setEndsOn(e.target.value)} className={field} />
                    </div>
                  </div>
                  {windowBad && (
                    <p className="text-xs" style={{ color: '#c0392b' }}>
                      The end date is before the start date.
                    </p>
                  )}

                  {/* Even the customer's own contact details are opt-in, so
                      nothing at all is disclosed implicitly. */}
                  <div>
                    <label className={label}>How they can reach you (optional)</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input value={contactName} onChange={e => setContactName(e.target.value)}
                        className={field} placeholder="Your name" />
                      <input value={contactPhone} onChange={e => setContactPhone(e.target.value)}
                        className={field} placeholder="Phone" />
                      <input value={contactEmail} onChange={e => setContactEmail(e.target.value)}
                        className={field} placeholder="Email" />
                    </div>
                  </div>

                  <button onClick={handleSend} disabled={!canSend}
                    className="btn-primary w-full justify-center gap-2">
                    {sending
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                      : <><Send className="w-4 h-4" /> Send to {picked.nickname || picked.name}</>}
                  </button>
                  <p className="text-center text-xs" style={{ color: '#73775b' }}>
                    A note cannot be taken back once sent.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
