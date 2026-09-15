import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, Check, Plus, Trash2, RotateCcw, AlertCircle, ClipboardCheck,
  Clock, IndianRupee, Utensils, Package, CloudRain, Info,
} from 'lucide-react'
import { getBoarders, saveProvider } from '../lib/storage.js'
import {
  REQUIREMENT_CATALOG, GENERIC_POLICY, UNLEASH_POLICY, hasCustomPolicy,
} from '../lib/boarding.js'
import BoarderSearch from './BoarderSearch.jsx'

// Maps boarding criteria onto a specific boarder. Whatever is saved here lands
// in providers.boarding_policy, which is what every pet parent's Boarding tab
// reads. A boarder left alone keeps showing the generic list.

const SEASONS = [
  { id: 'summer',  label: 'Summer (Mar–May)',  months: [3, 4, 5] },
  { id: 'monsoon', label: 'Monsoon (Jun–Sep)', months: [6, 7, 8, 9] },
  { id: 'winter',  label: 'Winter (Dec–Feb)',  months: [12, 1, 2] },
  { id: 'all',     label: 'All year',          months: [1,2,3,4,5,6,7,8,9,10,11,12] },
]

function seasonOf(months = []) {
  const key = [...months].sort((a, b) => a - b).join(',')
  return SEASONS.find(s => [...s.months].sort((a, b) => a - b).join(',') === key)?.id || 'all'
}

// Food preferences are stored on the pet by id, so an id must survive its
// label being reworded. Only genuinely new rows get a fresh one.
function slugify(label, taken) {
  const base = (label || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'item'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="label text-xs">{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: '#878c6b' }}>{hint}</p>}
    </div>
  )
}

function Group({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>
      <div className="flex items-start gap-2 mb-3">
        <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#c9891f' }} />
        <div>
          <h4 className="text-sm font-black" style={{ color: '#7a4900' }}>{title}</h4>
          {subtitle && <p className="text-xs" style={{ color: '#73775b' }}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

function lines(arr) { return (arr || []).join('\n') }
function unlines(s) { return s.split('\n').map(x => x.trim()).filter(Boolean) }

// ── Editor ───────────────────────────────────────────────────────────────────

function PolicyEditor({ provider, onSaved }) {
  const existing = hasCustomPolicy(provider)
  const [policy, setPolicy] = useState(() => provider.boarding_policy || null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => { setPolicy(provider.boarding_policy || null); setError(null) }, [provider.id])

  const set = patch => setPolicy(p => ({ ...(p || {}), ...patch }))

  async function persist(next) {
    setSaving(true); setError(null)
    try {
      const updated = await saveProvider({ ...provider, boarding_policy: next })
      setPolicy(next)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      onSaved({ ...provider, ...updated, boarding_policy: next })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Not configured yet ────────────────────────────────────────────────────
  if (!policy) {
    return (
      <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: '#f5f0e0', border: '1.5px solid #ebe3d3' }}>
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#5f624b' }} />
          <div>
            <p className="text-sm font-bold" style={{ color: '#7a4900' }}>Using the general requirements</p>
            <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>
              Pet parents planning a stay at {provider.name} see the list most boarders ask for,
              with no hours, rates or menu. Give it its own rules to change that.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => set({ name: provider.name, required: [...GENERIC_POLICY.required] })}
            className="btn-primary text-sm gap-1.5">
            <Plus className="w-4 h-4" /> Set up its own rules
          </button>
          <button onClick={() => set({ ...UNLEASH_POLICY, name: provider.name })}
            className="btn-secondary text-sm">
            Start from a fully-filled example
          </button>
        </div>
      </div>
    )
  }

  const required = policy.required || []
  const toggle = id => set({
    required: required.includes(id) ? required.filter(x => x !== id) : [...required, id],
  })

  const windows  = policy.slot_windows || []
  const menu     = policy.food_menu || []
  const advisories = policy.advisories || []
  const pricing  = policy.pricing || null

  const prepare = REQUIREMENT_CATALOG.filter(r => r.phase === 'prepare_before')
  const atGate  = REQUIREMENT_CATALOG.filter(r => r.phase === 'at_drop_off')

  const CheckRow = ({ r }) => {
    const on = required.includes(r.id)
    return (
      <button onClick={() => toggle(r.id)}
        className="w-full flex items-start gap-2 p-2 rounded-xl text-left transition-colors"
        style={{ backgroundColor: on ? '#fff9e0' : 'transparent' }}>
        <div className="mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
          style={on ? { backgroundColor: '#5f7a3a', color: 'white' } : { border: '1.5px solid #e0d3b4' }}>
          {on && <Check className="w-3 h-3" />}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold" style={{ color: '#7a4900' }}>{r.label}</div>
          <div className="text-xs" style={{ color: '#878c6b' }}>{r.help}</div>
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-3">

      <Group icon={ClipboardCheck} title="What this boarder requires"
        subtitle="Ticked criteria appear on the pet parent's readiness checklist for this boarder.">
        <p className="text-xs font-black uppercase tracking-wider mb-1" style={{ color: '#73775b' }}>Before the stay</p>
        {prepare.map(r => <CheckRow key={r.id} r={r} />)}
        <p className="text-xs font-black uppercase tracking-wider mt-3 mb-1" style={{ color: '#73775b' }}>At drop-off</p>
        {atGate.map(r => <CheckRow key={r.id} r={r} />)}

        <label className="flex items-center gap-2 mt-3 pt-3 cursor-pointer" style={{ borderTop: '1px solid #ebe3d3' }}>
          <input type="checkbox" checked={!!policy.trial_required}
            onChange={e => set({ trial_required: e.target.checked })} />
          <span className="text-xs font-bold" style={{ color: '#7a4900' }}>
            A trial / orientation visit is required before a first stay
          </span>
        </label>
      </Group>

      <Group icon={Clock} title="Lead times"
        subtitle="How far ahead each thing has to happen — used to date the prep reminders.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kennel cough, days before">
            <input type="number" min="0" className="input w-full" value={policy.kc_lead_days ?? 7}
              onChange={e => set({ kc_lead_days: Number(e.target.value) })} />
          </Field>
          <Field label="Tick treatment, days before">
            <input type="number" min="0" className="input w-full" value={policy.tick?.lead_days ?? 2}
              onChange={e => set({ tick: { ...(policy.tick || {}), lead_days: Number(e.target.value) } })} />
          </Field>
        </div>
      </Group>

      <Group icon={Clock} title="Visiting hours"
        subtitle="Leave empty if they have no fixed windows — nothing is claimed about extra-day charges then.">
        <div className="space-y-2">
          {windows.map((w, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input className="input flex-1" placeholder="Morning" value={w.label || ''}
                onChange={e => set({ slot_windows: windows.map((x, j) => j === i ? { ...x, label: e.target.value, id: x.id || slugify(e.target.value, new Set(windows.map(y => y.id))) } : x) })} />
              <input type="time" className="input w-28" value={w.from || ''}
                onChange={e => set({ slot_windows: windows.map((x, j) => j === i ? { ...x, from: e.target.value } : x) })} />
              <input type="time" className="input w-28" value={w.to || ''}
                onChange={e => set({ slot_windows: windows.map((x, j) => j === i ? { ...x, to: e.target.value } : x) })} />
              <button onClick={() => set({ slot_windows: windows.filter((_, j) => j !== i) })}
                className="p-1.5 rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4 text-red-400" /></button>
            </div>
          ))}
          <button onClick={() => set({ slot_windows: [...windows, { id: slugify(`window_${windows.length + 1}`, new Set(windows.map(x => x.id))), label: '', from: '', to: '' }] })}
            className="btn-secondary text-xs gap-1.5"><Plus className="w-3.5 h-3.5" /> Add a window</button>
        </div>
      </Group>

      <Group icon={IndianRupee} title="Rates"
        subtitle="Leave off entirely and the app says “ask the boarder” instead of quoting a number.">
        {pricing ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full day (24 hrs)">
                <input type="number" min="0" className="input w-full" value={pricing.full_day ?? ''}
                  onChange={e => set({ pricing: { ...pricing, full_day: Number(e.target.value) } })} />
              </Field>
              <Field label="Day boarding only">
                <input type="number" min="0" className="input w-full" value={pricing.day ?? ''}
                  onChange={e => set({ pricing: { ...pricing, day: Number(e.target.value) } })} />
              </Field>
              <Field label="Night only">
                <input type="number" min="0" className="input w-full" value={pricing.night ?? ''}
                  onChange={e => set({ pricing: { ...pricing, night: Number(e.target.value) } })} />
              </Field>
              <Field label="“Last minute” is within N days">
                <input type="number" min="0" className="input w-full" value={pricing.last_minute_days ?? 3}
                  onChange={e => set({ pricing: { ...pricing, last_minute_days: Number(e.target.value) } })} />
              </Field>
            </div>
            <Field label="Note shown under the estimate">
              <input className="input w-full" value={pricing.note || ''}
                onChange={e => set({ pricing: { ...pricing, note: e.target.value } })}
                placeholder="Rates change — confirm before the stay." />
            </Field>
            <button onClick={() => set({ pricing: undefined })} className="btn-secondary text-xs mt-2">Remove rates</button>
          </>
        ) : (
          <button onClick={() => set({ pricing: { currency: 'INR', full_day: 0, day: 0, night: 0, last_minute_days: 3 } })}
            className="btn-secondary text-xs gap-1.5"><Plus className="w-3.5 h-3.5" /> Add a rate card</button>
        )}
      </Group>

      <Group icon={Utensils} title="Food menu"
        subtitle="What they can actually serve. Pet parents pick from this when writing the boarding profile.">
        <div className="space-y-2">
          {menu.map((m, i) => (
            <div key={m.id || i} className="flex gap-2 items-center">
              <input className="input flex-1" value={m.label || ''} placeholder="Home-cooked chicken & rice"
                onChange={e => set({ food_menu: menu.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
              <label className="flex items-center gap-1.5 text-xs font-bold whitespace-nowrap" style={{ color: '#7a4900' }}>
                <input type="checkbox" checked={!!m.extra_charge}
                  onChange={e => set({ food_menu: menu.map((x, j) => j === i ? { ...x, extra_charge: e.target.checked } : x) })} />
                Extra
              </label>
              <button onClick={() => set({ food_menu: menu.filter((_, j) => j !== i) })}
                className="p-1.5 rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4 text-red-400" /></button>
            </div>
          ))}
          <button onClick={() => set({ food_menu: [...menu, { id: slugify(`item_${menu.length + 1}`, new Set(menu.map(x => x.id))), label: '', extra_charge: false }] })}
            className="btn-secondary text-xs gap-1.5"><Plus className="w-3.5 h-3.5" /> Add a dish</button>
          <Field label="Note under the menu">
            <input className="input w-full" value={policy.food_note || ''}
              onChange={e => set({ food_note: e.target.value })}
              placeholder="Anything off-menu needs advance notice, at extra cost." />
          </Field>
        </div>
      </Group>

      <Group icon={Package} title="What to bring" subtitle="One per line.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Bring">
            <textarea className="input w-full" rows={3} value={lines(policy.bring)}
              onChange={e => set({ bring: unlines(e.target.value) })}
              placeholder={'A rug or bedsheet\nOriginal vaccination book'} />
          </Field>
          <Field label="Leave at home">
            <textarea className="input w-full" rows={3} value={lines(policy.do_not_bring)}
              onChange={e => set({ do_not_bring: unlines(e.target.value) })}
              placeholder={'Fancy leashes\nExpensive beds'} />
          </Field>
        </div>
      </Group>

      <Group icon={CloudRain} title="Seasonal advisories"
        subtitle="Shown only when the stay falls in that season, so they still get read.">
        <div className="space-y-2">
          {advisories.map((a, i) => (
            <div key={i} className="flex gap-2 items-start">
              <select className="input w-40 flex-shrink-0" value={seasonOf(a.months)}
                onChange={e => set({ advisories: advisories.map((x, j) => j === i ? { ...x, months: SEASONS.find(s => s.id === e.target.value).months } : x) })}>
                {SEASONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <textarea className="input flex-1" rows={2} value={a.text || ''}
                onChange={e => set({ advisories: advisories.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })}
                placeholder="No air-conditioning — coolers and fans are used." />
              <button onClick={() => set({ advisories: advisories.filter((_, j) => j !== i) })}
                className="p-1.5 rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4 text-red-400" /></button>
            </div>
          ))}
          <button onClick={() => set({ advisories: [...advisories, { months: SEASONS[1].months, text: '' }] })}
            className="btn-secondary text-xs gap-1.5"><Plus className="w-3.5 h-3.5" /> Add an advisory</button>
        </div>
      </Group>

      <Group icon={Info} title="On arrival">
        <Field label="Arrival note" hint="Shown next to the drop-off time, where it matters.">
          <input className="input w-full" value={policy.arrival_notes || ''}
            onChange={e => set({ arrival_notes: e.target.value })}
            placeholder="Please don't honk — call or message from the gate." />
        </Field>
        <div className="mt-3">
          <Field label="Extras">
            <input className="input w-full" value={policy.extras_note || ''}
              onChange={e => set({ extras_note: e.target.value })}
              placeholder="Pick-up and drop available at extra cost." />
          </Field>
        </div>
      </Group>

      {error && (
        <div className="flex gap-2 p-3 rounded-xl text-sm" style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {/boarding_policy|column/i.test(error)
            ? 'The boarding_policy column is missing — run supabase/boarding.sql first.'
            : error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 sticky bottom-0 py-3"
        style={{ backgroundColor: '#FFFEF8', borderTop: '1px solid #ebe3d3' }}>
        <button onClick={() => persist({ ...policy, name: policy.name || provider.name })}
          disabled={saving} className="btn-primary gap-2 text-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saved ? 'Saved' : `Save rules for ${provider.name}`}
        </button>
        {existing && (
          <button onClick={() => { if (confirm(`Reset ${provider.name} to the general requirements? Their own rules will be removed.`)) persist(null) }}
            disabled={saving} className="btn-secondary gap-1.5 text-sm">
            <RotateCcw className="w-3.5 h-3.5" /> Reset to general
          </button>
        )}
      </div>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function BoardingRulesPanel() {
  const [boarders, setBoarders] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    getBoarders()
      .then(setBoarders)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const selected  = useMemo(() => boarders.find(b => b.id === selectedId) || null, [boarders, selectedId])
  const configured = useMemo(() => boarders.filter(hasCustomPolicy), [boarders])

  function handleSaved(updated) {
    setBoarders(bs => bs.map(b => b.id === updated.id ? updated : b))
  }

  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wider mb-1" style={{ color: '#73775b' }}>
        {configured.length} of {boarders.length} boarders have their own rules
      </p>
      <p className="text-xs mb-4" style={{ color: '#878c6b' }}>
        Everyone else shows the general requirements until you set theirs.
      </p>

      {error && (
        <div className="flex gap-2 p-3 rounded-xl text-sm mb-4" style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      <div className="mb-4">
        <BoarderSearch
          boarders={boarders}
          loading={loading}
          value={selectedId}
          allowUnlisted={false}
          placeholder="Find a boarder to configure…"
          onSelect={b => setSelectedId(b.id)}
          onClear={() => setSelectedId(null)} />
      </div>

      {!selected && configured.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-wider" style={{ color: '#73775b' }}>Already configured</p>
          {configured.map(b => (
            <button key={b.id} onClick={() => setSelectedId(b.id)}
              className="w-full text-left p-3 rounded-2xl flex items-center gap-3"
              style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>
              <ClipboardCheck className="w-4 h-4 flex-shrink-0" style={{ color: '#c9891f' }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate" style={{ color: '#7a4900' }}>{b.name}</div>
                <div className="text-xs truncate" style={{ color: '#73775b' }}>
                  {(b.boarding_policy?.required || []).length} criteria
                  {b.boarding_policy?.pricing ? ' · rates set' : ''}
                  {(b.boarding_policy?.food_menu || []).length ? ` · ${b.boarding_policy.food_menu.length} menu items` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && <PolicyEditor provider={selected} onSaved={handleSaved} />}

      {loading && (
        <div className="flex items-center gap-2 py-8" style={{ color: '#73775b' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading boarders…
        </div>
      )}
    </div>
  )
}
