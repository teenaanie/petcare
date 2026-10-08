import { useState, useEffect, useCallback } from 'react'
import {
  Loader2, AlertCircle, Check, ChevronDown, ChevronRight, Store, ClipboardCheck,
  Plus, Trash2,
} from 'lucide-react'
import { getSupabaseProvider } from '../../lib/supabase.js'
import { reportHandled } from '../../lib/errorReport.js'
import {
  REQUIREMENT_CATALOG, GENERIC_POLICY, appliesTo, customRequirements, newCustomId,
} from '../../lib/boarding.js'
import { SERVICES } from '../../lib/taxonomy.js'

// What a business can change about itself, and what it cannot.
//
// Both panels write through SECURITY DEFINER functions rather than straight at
// the table, and the reason is in supabase/provider_self_service.sql: RLS can
// gate a ROW but not a COLUMN, and Supabase already grants UPDATE on every
// column to `authenticated`. A row-level policy here would hand a claimant
// `is_approved`, `type`, `place_id` and the scraped `categories` along with
// their phone number.
//
// So the editable list is written out by hand in one function, and this screen
// says plainly which fields are not on it. A business that wants its NAME or
// its TYPE changed is asking for something a person should read — the name is
// how a customer recognises who they were recommended, and the type decides
// which tab of the directory they appear under.

const lbl   = 'text-xs font-bold uppercase tracking-wide'
const field = 'input w-full'

function Row({ label, name, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className={lbl} style={{ color: '#b08d57' }} htmlFor={`biz-${name}`}>{label}</label>
      <input id={`biz-${name}`} name={name} type={type} className={field}
        value={value ?? ''} onChange={onChange} placeholder={placeholder} />
    </div>
  )
}

function Panel({ icon: Icon, title, subtitle, open, onToggle, children }) {
  return (
    <div className="card">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 shrink-0" style={{ color: '#b08d57' }} />
          <div className="min-w-0">
            <p className={lbl} style={{ color: '#b08d57' }}>{title}</p>
            {subtitle && <p className="text-sm mt-0.5" style={{ color: '#73775b' }}>{subtitle}</p>}
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: '#b08d57' }} />
              : <ChevronRight className="w-4 h-4 shrink-0" style={{ color: '#b08d57' }} />}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  )
}

export default function ProviderDetails({ providerId, providerType }) {
  const [open, setOpen]       = useState(null)   // 'details' | 'criteria' | null
  const [ownLabel, setOwnLabel] = useState('')
  const [ownHelp, setOwnHelp]   = useState('')
  const [row, setRow]         = useState(null)
  const [form, setForm]       = useState({})
  const [policy, setPolicy]   = useState(null)
  const [services, setServices] = useState([])
  const [busy, setBusy]       = useState(false)
  const [saved, setSaved]     = useState(null)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    if (!providerId) return
    try {
      const supabase = await getSupabaseProvider()
      // Through the function, not the table: a listing that is not published
      // cannot be read by its own owner through the directory's policy, so the
      // form would open empty and then save over what it never saw.
      const { data, error } = await supabase.rpc('my_provider_details', { p_provider_id: providerId })
      if (error) throw error
      const r = (data || [])[0] || null
      setRow(r)
      setForm({
        phone: r?.phone || '', whatsapp: r?.whatsapp || '', email: r?.email || '',
        website: r?.website || '', hours: r?.hours || '', address: r?.address || '',
        area: r?.area || '', description: r?.description || '',
      })
      setPolicy(r?.boarding_policy && typeof r.boarding_policy === 'object' ? r.boarding_policy : null)
      setServices(Array.isArray(r?.services) ? r.services.filter(x => SERVICES.includes(x)) : [])
    } catch (e) {
      reportHandled(e, { view: 'provider-details' })
      setError(e.message || 'Could not load your details.')
    }
  }, [providerId])
  useEffect(() => { load() }, [load])

  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  async function saveDetails() {
    setBusy(true); setError(null); setSaved(null)
    try {
      const supabase = await getSupabaseProvider()
      const { error } = await supabase.rpc('update_my_provider', {
        p_provider_id: providerId,
        p_phone: form.phone, p_whatsapp: form.whatsapp, p_email: form.email,
        p_website: form.website, p_hours: form.hours, p_address: form.address,
        p_area: form.area, p_description: form.description,
        p_services: services,
      })
      if (error) throw error
      setSaved('Saved.')
      await load()
    } catch (e) {
      reportHandled(e, { view: 'provider-details' })
      setError(e.message || 'That did not save.')
    } finally { setBusy(false) }
  }

  async function savePolicy(next) {
    setBusy(true); setError(null); setSaved(null)
    try {
      const supabase = await getSupabaseProvider()
      const { error } = await supabase.rpc('update_my_boarding_policy', {
        p_provider_id: providerId, p_policy: next,
      })
      if (error) throw error
      setPolicy(next)
      setSaved('Saved. Your customers see this before they travel.')
    } catch (e) {
      reportHandled(e, { view: 'provider-details' })
      setError(e.message || 'That did not save.')
    } finally { setBusy(false) }
  }

  if (!providerId) return null

  // Only a boarder is asked about boarding criteria. A groomer has no overnight
  // stay to prepare for, and the pet-parent Boarding tab reads this column for
  // boarders alone.
  const isBoarder = providerType === 'Boarder'
  const required  = new Set(policy?.required || (policy ? [] : GENERIC_POLICY.required))
  const usingGeneric = !policy

  const own = customRequirements(policy)

  function basePolicy() {
    return { ...(policy || {}),
             required: policy?.required || [...GENERIC_POLICY.required],
             trial_required: policy?.trial_required ?? GENERIC_POLICY.trial_required }
  }

  function toggleRequirement(id) {
    const next = new Set(required)
    if (next.has(id)) next.delete(id); else next.add(id)
    savePolicy({ ...basePolicy(), required: [...next] })
  }

  function addOwn() {
    const label = ownLabel.trim()
    if (!label) return
    const base = basePolicy()
    const id = newCustomId(label, policy)
    savePolicy({
      ...base,
      custom: [...(policy?.custom || []), { id, label, help: ownHelp.trim() || undefined }],
      // Added AND ticked: nobody types a requirement they do not require.
      required: [...new Set([...(base.required || []), id])],
    })
    setOwnLabel(''); setOwnHelp('')
  }

  function removeOwn(id) {
    const base = basePolicy()
    savePolicy({
      ...base,
      custom: (policy?.custom || []).filter(c => c?.id !== id),
      // Out of `required` too, or the id stays in the list with nothing behind
      // it and the pet parent sees a requirement with no words.
      required: (base.required || []).filter(x => x !== id),
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm"
          style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}
      {saved && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm"
          style={{ backgroundColor: '#eef3e2', color: '#44562a' }}>
          <Check className="w-4 h-4 shrink-0 mt-0.5" /><span>{saved}</span>
        </div>
      )}

      <Panel icon={Store} title="Your details"
        subtitle={row ? [row.area, row.city].filter(Boolean).join(' · ') : 'Loading…'}
        open={open === 'details'} onToggle={() => setOpen(o => o === 'details' ? null : 'details')}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Row label="Phone"    name="phone"    value={form.phone}    onChange={set} placeholder="98765 43210" />
          <Row label="WhatsApp" name="whatsapp" value={form.whatsapp} onChange={set} placeholder="98765 43210" />
          <Row label="Email"    name="email"    value={form.email}    onChange={set} placeholder="you@yourbusiness.com" type="email" />
          <Row label="Website"  name="website"  value={form.website}  onChange={set} placeholder="https://" />
          <Row label="Hours"    name="hours"    value={form.hours}    onChange={set} placeholder="Mon-Sun 8am-7pm" />
          <Row label="Area"     name="area"     value={form.area}     onChange={set} placeholder="Baner" />
        </div>
        <div className="mt-3">
          <Row label="Address" name="address" value={form.address} onChange={set} placeholder="Lane 5, Baner Road" />
        </div>
        {/* One business, one TYPE for the tab they appear in, and a list of
            everything else they do. Most small operators are two or three of
            these at once — a boarder who grooms, a groomer with a counter of
            food — and until now they could only be one. */}
        <div className="mt-4">
          <label className={lbl} style={{ color: '#b08d57' }}>What else you do</label>
          <p className="text-xs mb-2" style={{ color: '#73775b' }}>
            You are listed as a <strong>{row?.type || providerType}</strong> — that is the part of the
            directory you appear in. Tick everything you actually offer; pet parents see these on
            your listing.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SERVICES.map(sv => {
              const on = services.includes(sv)
              return (
                <button key={sv} type="button"
                  onClick={() => setServices(v => on ? v.filter(x => x !== sv) : [...v, sv])}
                  className="px-3 py-1.5 rounded-full text-xs font-bold"
                  style={on ? { backgroundColor: '#eef3e2', color: '#44562a', border: '1.5px solid #cfe0b4' }
                            : { backgroundColor: '#FFFEF8', color: '#73775b', border: '1.5px solid #ebe3d3' }}>
                  {on && '✓ '}{sv}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-3">
          <label className={lbl} style={{ color: '#b08d57' }} htmlFor="biz-description">About your business</label>
          <textarea id="biz-description" name="description" rows={3} className={field}
            value={form.description ?? ''} onChange={set}
            placeholder="What you offer, in a line or two. Pet parents read this." />
        </div>

        <button onClick={saveDetails} disabled={busy} className="btn-primary mt-4">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save details'}
        </button>

        {/* Said plainly rather than left to be discovered. */}
        <p className="text-xs mt-3" style={{ color: '#73775b' }}>
          Your business <strong>name</strong> and <strong>type</strong> are not editable here. The name is
          how a customer recognises the business they were recommended, and the type decides which
          part of the directory you appear in — so a person reads those changes. Use
          &ldquo;Send us a message&rdquo; below and we will do it.
        </p>
      </Panel>

      {isBoarder && (
        <Panel icon={ClipboardCheck} title="Your boarding criteria"
          subtitle={usingGeneric
            ? 'Using the standard list — tap to make it yours'
            : `${required.size} requirement${required.size === 1 ? '' : 's'}, your own`}
          open={open === 'criteria'} onToggle={() => setOpen(o => o === 'criteria' ? null : 'criteria')}>

          <p className="text-sm mb-4" style={{ color: '#73775b' }}>
            This is what a pet parent sees on their Boarding screen before they travel, and what their
            checklist is built from. {usingGeneric && (
              <>Right now you are showing the standard list that every unconfigured boarder shows.
                 Tick what you actually ask for and it becomes yours.</>
            )}
          </p>

          <div className="space-y-2">
            {REQUIREMENT_CATALOG.filter(r => r.phase === 'prepare_before' || r.phase === 'at_drop_off')
              .map(r => {
                const on = required.has(r.id)
                const species = r.species === '*' ? null
                  : ['Dog', 'Cat'].filter(sp => appliesTo(r, sp)).join(' & ')
                return (
                  <button key={r.id} disabled={busy} onClick={() => toggleRequirement(r.id)}
                    className="w-full text-left flex items-start gap-3 p-3 rounded-xl"
                    style={{ backgroundColor: on ? '#eef3e2' : '#FFFEF8',
                             border: `1.5px solid ${on ? '#cfe0b4' : '#ebe3d3'}` }}>
                    <span className="w-5 h-5 rounded mt-0.5 flex items-center justify-center shrink-0"
                      style={{ backgroundColor: on ? '#5f7a3a' : '#e0d8c0' }}>
                      {on && <Check className="w-3.5 h-3.5" style={{ color: 'white' }} />}
                    </span>
                    <span className="min-w-0">
                      <span className="text-sm font-bold block" style={{ color: '#4A2C0A' }}>
                        {r.label}
                        {species && species !== 'Dog & Cat' && (
                          <span className="font-normal" style={{ color: '#b08d57' }}> · {species} only</span>
                        )}
                      </span>
                      {r.help && <span className="text-xs block mt-0.5" style={{ color: '#73775b' }}>{r.help}</span>}
                    </span>
                  </button>
                )
              })}
          </div>

          {/* A boarder's own criteria. The catalogue above is what the research
              found boarders asking for; this is for everything it could not
              have predicted — a blanket that smells of home, the lift key, the
              society's pet registration. They are always manual: nothing in a
              pet's records can confirm one, and ticking a box the owner never
              ticked would be worse than asking. */}
          {own.length > 0 && (
            <div className="space-y-2 mt-2">
              {own.map(c => (
                <div key={c.id} className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ backgroundColor: required.has(c.id) ? '#eef3e2' : '#FFFEF8',
                           border: `1.5px solid ${required.has(c.id) ? '#cfe0b4' : '#ebe3d3'}` }}>
                  <button disabled={busy} onClick={() => toggleRequirement(c.id)}
                    aria-label={required.has(c.id) ? `Stop asking for ${c.label}` : `Ask for ${c.label}`}
                    className="w-5 h-5 rounded mt-0.5 flex items-center justify-center shrink-0"
                    style={{ backgroundColor: required.has(c.id) ? '#5f7a3a' : '#e0d8c0' }}>
                    {required.has(c.id) && <Check className="w-3.5 h-3.5" style={{ color: 'white' }} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold" style={{ color: '#4A2C0A' }}>
                      {c.label}
                      <span className="font-normal" style={{ color: '#b08d57' }}> · yours</span>
                    </p>
                    {c.help && <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>{c.help}</p>}
                  </div>
                  <button disabled={busy} title="Remove this criterion"
                    aria-label={`Remove ${c.label}`}
                    onClick={() => { if (confirm(`Remove "${c.label}"?`)) removeOwn(c.id) }}
                    style={{ color: '#c0392b' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl p-3 mt-2" style={{ backgroundColor: '#fff9e0', border: '1.5px dashed #e0d8c0' }}>
            <label className={lbl} style={{ color: '#b08d57' }} htmlFor="own-label">
              Ask for something of your own
            </label>
            <input id="own-label" className={field} value={ownLabel}
              onChange={e => setOwnLabel(e.target.value)}
              placeholder="A blanket that smells of home" />
            <input className={`${field} mt-2`} value={ownHelp}
              onChange={e => setOwnHelp(e.target.value)}
              placeholder="One line of explanation (optional)" />
            <button disabled={busy || !ownLabel.trim()} onClick={addOwn}
              className="btn-primary mt-2 gap-1.5">
              <Plus className="w-4 h-4" /> Add this
            </button>
            <p className="text-xs mt-2" style={{ color: '#73775b' }}>
              Your customers see it on their checklist with everything else. Pippy cannot
              check this one against their records, so it is theirs to tick.
            </p>
          </div>

          <button disabled={busy} className="w-full text-left flex items-start gap-3 p-3 rounded-xl mt-2"
            style={{ backgroundColor: policy?.trial_required ? '#eef3e2' : '#FFFEF8',
                     border: `1.5px solid ${policy?.trial_required ? '#cfe0b4' : '#ebe3d3'}` }}
            onClick={() => savePolicy({ ...(policy || { required: [...required] }),
                                        trial_required: !policy?.trial_required })}>
            <span className="w-5 h-5 rounded mt-0.5 flex items-center justify-center shrink-0"
              style={{ backgroundColor: policy?.trial_required ? '#5f7a3a' : '#e0d8c0' }}>
              {policy?.trial_required && <Check className="w-3.5 h-3.5" style={{ color: 'white' }} />}
            </span>
            <span>
              <span className="text-sm font-bold block" style={{ color: '#4A2C0A' }}>A trial day before a first stay</span>
              <span className="text-xs block mt-0.5" style={{ color: '#73775b' }}>
                The same trial your bookings track. Ticking it here tells customers before they ask.
              </span>
            </span>
          </button>

          {busy && (
            <p className="text-xs mt-3 flex items-center gap-1.5" style={{ color: '#73775b' }}>
              <Loader2 className="w-3 h-3 animate-spin" /> Saving…
            </p>
          )}
        </Panel>
      )}
    </div>
  )
}
