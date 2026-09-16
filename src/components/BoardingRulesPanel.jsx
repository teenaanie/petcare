import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, Check, Plus, Trash2, RotateCcw, AlertCircle, ClipboardCheck,
  Clock, IndianRupee, Utensils, Package, CloudRain, Info, PawPrint, AlertTriangle,
} from 'lucide-react'
import { getBoarders, saveProvider } from '../lib/storage.js'
import {
  REQUIREMENT_CATALOG, GENERIC_POLICY, UNLEASH_POLICY, hasCustomPolicy,
  SUPPORTED_SPECIES, appliesTo,
} from '../lib/boarding.js'
import BoarderSearch from './BoarderSearch.jsx'

// Maps boarding criteria onto a specific boarder. Whatever is saved here lands
// in providers.boarding_policy, which is what every pet parent's Boarding tab
// reads. A boarder left alone keeps showing the generic list.

// Criteria introduced after the first policies were saved. New ids are never
// retro-added to a boarder's list — that would assert a requirement the
// facility never stated — so the editor points them out instead.
const NEW_CRITERIA = ['rabies', 'core_vaccine_dog', 'core_vaccine_cat']

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
          <button
            onClick={() => set({
              // Structure only. Spreading UNLEASH_POLICY here would hand this
              // boarder another facility's menu, rate card and refused-product
              // list under its own name — the exact thing the generic fallback
              // was split apart to stop.
              name: provider.name,
              required: [...GENERIC_POLICY.required],
              trial_required: false,
              slot_windows: [{ id: 'morning', label: 'Morning', from: '', to: '' }],
              pricing: { currency: 'INR', full_day: 0, day: 0, night: 0, last_minute_days: 3 },
              food_menu: [],
            })}
            className="btn-secondary text-sm">
            Start with a blank rate card and hours
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

  // Once an admin says which animals a boarder takes, hide the criteria that
  // can't apply — otherwise every dog kennel in the directory grows a cat
  // vaccine row. While it's unstated, show everything.
  const taken = (policy.species_accepted || []).length ? policy.species_accepted : SUPPORTED_SPECIES
  const visible = REQUIREMENT_CATALOG.filter(r => taken.some(sp => appliesTo(r, sp)))
  const prepare = visible.filter(r => r.phase === 'prepare_before')
  const atGate  = visible.filter(r => r.phase === 'at_drop_off')

  const CheckRow = ({ r }) => {
    const on = required.includes(r.id)
    // A criterion that only applies to one species needs saying so, or an
    // admin configuring a dog kennel sees FVRCP with no explanation.
    const only = r.species !== '*' && r.species.length === 1 ? r.species[0] : null
    return (
      <button onClick={() => toggle(r.id)}
        className="w-full flex items-start gap-2 p-2 rounded-xl text-left transition-colors"
        style={{ backgroundColor: on ? '#fff9e0' : 'transparent' }}>
        <div className="mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
          style={on ? { backgroundColor: '#5f7a3a', color: 'white' } : { border: '1.5px solid #e0d3b4' }}>
          {on && <Check className="w-3 h-3" />}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold flex items-center gap-1.5 flex-wrap" style={{ color: '#7a4900' }}>
            {r.label}
            {only && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: '#dceff5', color: '#255d6e' }}>{only}s only</span>
            )}
          </div>
          <div className="text-xs" style={{ color: '#878c6b' }}>{r.help}</div>
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-3">

      {NEW_CRITERIA.some(id => !required.includes(id)) && (
        <div className="rounded-2xl p-3 flex items-start gap-2 text-xs"
          style={{ backgroundColor: '#dceff5', color: '#255d6e' }}>
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold">Some newer criteria aren’t ticked for this boarder.</p>
            <p className="mt-0.5">
              Rabies and the species core vaccines were added after this policy was saved. They aren’t
              added automatically — that would put words in {provider.name}’s mouth. Tick them if they apply.
            </p>
          </div>
        </div>
      )}

      <Group icon={PawPrint} title="Which animals they board"
        subtitle="Leave both off if you don't know — the app then tells cat owners that this boarder hasn't published anything about cats, rather than showing them a short list that looks like an all-clear.">
        <div className="flex gap-2">
          {SUPPORTED_SPECIES.map(sp => {
            const on = (policy.species_accepted || []).includes(sp)
            return (
              <button key={sp}
                onClick={() => {
                  const cur = policy.species_accepted || []
                  const next = on ? cur.filter(x => x !== sp) : [...cur, sp]
                  set({ species_accepted: next.length ? next : undefined })
                }}
                className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
                style={on ? { backgroundColor: '#ffde59', color: '#7a4900' }
                          : { backgroundColor: '#f5f0e0', color: '#73775b' }}>
                {sp}s
              </button>
            )
          })}
        </div>
        {!(policy.species_accepted || []).length && (
          <p className="text-xs mt-2" style={{ color: '#878c6b' }}>
            Not stated — which is the honest default. Only about a third of the boarders we researched
            published anything at all about cats.
          </p>
        )}
      </Group>

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

      <Group icon={AlertTriangle} title="Who they'll take"
        subtitle="Leave anything blank that this boarder hasn't actually stated. Blank means silent — the app will never tell a pet parent their pet might be refused on a rule the boarder never published.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum age (months)" hint="Blank if they don't say.">
            <input type="number" min="0" className="input w-full" value={policy.min_age_months ?? ''}
              onChange={e => set({ min_age_months: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </Field>
          <Field label="Case-by-case from age (years)" hint="e.g. 10 for senior pets.">
            <input type="number" min="0" className="input w-full" value={policy.senior_age_years ?? ''}
              onChange={e => set({ senior_age_years: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Field label="Females in season">
            <select className="input w-full" value={policy.heat_policy || ''}
              onChange={e => set({ heat_policy: e.target.value || undefined })}>
              <option value="">Not stated</option>
              <option value="separated">Taken, housed separately</option>
              <option value="refused">Not taken</option>
            </select>
          </Field>
          <Field label="Pets that can't be grouped">
            <select className="input w-full" value={policy.aggression_policy || ''}
              onChange={e => set({ aggression_policy: e.target.value || undefined })}>
              <option value="">Not stated</option>
              <option value="managed">Taken, handled separately</option>
              <option value="refused">Not taken</option>
            </select>
          </Field>
        </div>

        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input type="checkbox" checked={!!policy.health_check_on_arrival}
            onChange={e => set({ health_check_on_arrival: e.target.checked || undefined })} />
          <span className="text-xs font-bold" style={{ color: '#7a4900' }}>
            They check each pet over on arrival, and may turn away one that looks unwell
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

      <Group icon={ClipboardCheck} title="Tick and flea products"
        subtitle="Only fill these in if this boarder actually says so. Left empty, the app names no products at all.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Accepted" hint="One per line, e.g. Bravecto.">
            <textarea className="input w-full" rows={3} value={lines(policy.tick?.accepted)}
              onChange={e => set({ tick: { ...(policy.tick || {}), accepted: unlines(e.target.value) } })}
              placeholder={'bravecto\nnexgard\nsimparica'} />
          </Field>
          <Field label="Not accepted" hint="One per line, matched inside the product name.">
            <textarea className="input w-full" rows={3}
              value={lines((policy.tick?.rejected || []).map(r => r.pattern))}
              onChange={e => set({ tick: { ...(policy.tick || {}),
                rejected: unlines(e.target.value).map(pattern => ({
                  pattern,
                  reason: `This boarder does not accept tick ${pattern.replace(/s$/, '')}s.`,
                })) } })}
              placeholder={'collar\nspray'} />
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
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid #ebe3d3' }}>
              <p className="text-xs font-bold mb-1" style={{ color: '#7a4900' }}>Price by size</p>
              <p className="text-xs mb-2" style={{ color: '#878c6b' }}>
                Only if they charge by weight. Leave empty when size makes no difference — the full-day
                rate above is then used for every pet. The last band's weight can be left blank to mean
                "and above".
              </p>
              {(pricing.size_bands || []).map((b, i) => (
                <div key={i} className="flex gap-2 items-center mb-2">
                  <span className="text-xs whitespace-nowrap" style={{ color: '#73775b' }}>up to</span>
                  <input type="number" min="0" className="input w-24" placeholder="kg" value={b.max_kg ?? ''}
                    onChange={e => set({ pricing: { ...pricing, size_bands: pricing.size_bands.map((x, j) =>
                      j === i ? { ...x, max_kg: e.target.value === '' ? null : Number(e.target.value) } : x) } })} />
                  <span className="text-xs" style={{ color: '#73775b' }}>kg · ₹</span>
                  <input type="number" min="0" className="input flex-1" placeholder="per day" value={b.amount ?? ''}
                    onChange={e => set({ pricing: { ...pricing, size_bands: pricing.size_bands.map((x, j) =>
                      j === i ? { ...x, amount: Number(e.target.value) } : x) } })} />
                  <button onClick={() => set({ pricing: { ...pricing, size_bands: pricing.size_bands.filter((_, j) => j !== i) } })}
                    className="p-1.5 rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div>
              ))}
              <button onClick={() => set({ pricing: { ...pricing, size_bands: [...(pricing.size_bands || []), { max_kg: null, amount: 0 }] } })}
                className="btn-secondary text-xs gap-1.5"><Plus className="w-3.5 h-3.5" /> Add a weight band</button>
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
