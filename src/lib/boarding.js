// boarding.js — everything the Boarding tab knows how to *judge*, with no I/O.
//
// Boarders publish a list of things you must do before a stay: a kennel cough
// vaccine, tick cover, deworming, IDs at the gate. Nearly all the evidence is
// already in the app (vaccinations, medicines), so this module's job is to read
// those records back as an answer to "is this dog ready to board at X on date
// D, and what must I do this week?".
//
// Kept pure so it can be exercised from the console without a database, and so
// the matching heuristics can be judged before anything is persisted.

import { parseISO, isValid, addDays, differenceInCalendarDays, format } from 'date-fns'

// ── Dates ────────────────────────────────────────────────────────────────────

export function d(str) {
  if (!str) return null
  try { const x = parseISO(str); return isValid(x) ? x : null } catch { return null }
}
export function iso(date) { return date ? format(date, 'yyyy-MM-dd') : '' }
export function today()    { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()) }

// ── How long a tick/flea product actually covers ─────────────────────────────
// `medicines` has no duration concept and its `nextDue` field is optional, so
// without this table almost every record would read as "no active cover" and
// the whole feature would look broken. Names are matched as substrings against
// the record's name, longest first.

export const PRODUCT_DURATION_DAYS = {
  bravecto:    84,
  simparica:   35,
  nexgard:     30,
  credelio:    30,
  revolution:  30,
  frontline:   30,
  fiprofort:   30,
  fipronil:    30,
  'spot on':   30,
  'spot-on':   30,
  spoton:      30,
  advantix:    30,
  // A collar, and some boarders refuse collars — but that's their policy to
  // state, not ours to encode as a zero-length cover. Its actual label claim.
  seresto:     240,
}

const DEWORMER_DURATION_DAYS = 90

// ── Requirement catalogue ────────────────────────────────────────────────────
// `phase` matters: a declaration signed at the gate can never be ticked off in
// advance, so mixing it into the prep list would make the readiness figure lie.
// `scope` separates what the *human* must carry from what the dog needs.

// Dogs and cats are the only species this catalogue covers. The research
// behind it found detailed criteria published for dogs at roughly 10 of 25
// Indian boarders and for cats at 7; for birds and small mammals, 2. Rather
// than import UK/US rules for the rest — rabbit myxomatosis and RHD, avian
// disease panels — the app says it doesn't know. Copying those in would
// present foreign guidance as local practice, and the research is explicit
// that rabbit vaccination in particular needs Indian veterinary input first.
export const SUPPORTED_SPECIES = ['Dog', 'Cat']

// Shown wherever the generic list appears. The generic list is a summary of
// what Indian boarders commonly publish — not a standard, and not any
// particular boarder's rules.
export const GENERIC_PROVENANCE =
  'Compiled from boarding policies published by Indian boarders, September 2026. ' +
  'This is what boarders commonly ask for, not an official standard — and not this ' +
  "boarder's own published rules. Validity periods we estimate (a year for kennel " +
  'cough, for example) are clinical convention, not something a facility stated.'

// "fishs" and "others" both read as a bug to the person holding the animal.
const SPECIES_PLURAL = {
  Dog: 'dogs', Cat: 'cats', Bird: 'birds', Rabbit: 'rabbits',
  Hamster: 'hamsters', Fish: 'fish', Reptile: 'reptiles', Other: 'this kind of pet',
}

export function speciesSupport(species) {
  if (!species) {
    return { supported: false, reason: 'no_species',
             text: "This pet has no species set, so we can't tell which boarding requirements apply. Add one by editing the pet." }
  }
  if (!SUPPORTED_SPECIES.includes(species)) {
    const plural = SPECIES_PLURAL[species] || `${species.toLowerCase()}s`
    return { supported: false, reason: 'unsupported',
             text: `We don't have boarding criteria for ${plural}. Indian boarders very rarely publish them, and we'd rather say so than show you a dog's checklist.` }
  }
  return { supported: true, reason: null, text: '' }
}

export const REQUIREMENT_CATALOG = [
  {
    id: 'vaccination_records', species: '*', phase: 'prepare_before', scope: 'pet', derive: 'vaccination_any',
    label: 'Vaccinations up to date',
    help: 'Core vaccines current, with the original record book ready to carry.',
  },
  {
    // The one vaccine nearly every Indian boarder names, and the one city dog
    // licences in Mumbai, Delhi, Chennai and Pune are tied to.
    id: 'rabies', species: ['Dog', 'Cat'], phase: 'prepare_before', scope: 'pet',
    derive: 'named_vaccine',
    match: /rabies|rabisin|raksharab|defensor|rabvac|nobivac\s*r\b/i,
    label: 'Rabies vaccination current', noun: 'rabies vaccination',
    help: 'Asked for by almost every boarder. For dogs it is also what a city licence is tied to.',
  },
  {
    id: 'core_vaccine_dog', species: ['Dog'], phase: 'prepare_before', scope: 'pet',
    derive: 'named_vaccine',
    match: /dhppi?l?|dhlpp|distemper|parvo|hepatitis|lepto|nobivac\s*dhp|megavac|vanguard|canigen/i,
    label: 'Core dog vaccine (DHPPi / DHPPiL)', noun: 'DHPPi / DHPPiL vaccination',
    help: 'Distemper, hepatitis, parvovirus and parainfluenza, usually with leptospirosis.',
  },
  {
    id: 'core_vaccine_cat', species: ['Cat'], phase: 'prepare_before', scope: 'pet',
    derive: 'named_vaccine',
    match: /fvrcp|tricat|panleu|feline\s*(herpes|calici|rhino)|calici|rhinotrach|felocell|nobivac\s*tricat|purevax/i,
    label: 'Core cat vaccine (Tricat / FVRCP)', noun: 'Tricat / FVRCP vaccination',
    help: 'Panleukopenia, feline herpesvirus and calicivirus.',
  },
  {
    // One boarder requires this, citing a Pune municipal mandate. Never in the
    // generic list — an admin ticks it for the boarders that ask.
    id: 'microchip', species: ['Cat'], phase: 'prepare_before', scope: 'pet',
    derive: 'microchip',
    label: 'Microchipped',
    help: 'Some boarders require it — Pune has mandated it for cats since June 2021.',
  },
  {
    id: 'collar_bell', species: ['Cat'], phase: 'at_drop_off', scope: 'owner', derive: 'manual',
    label: 'Collar with a bell',
    help: 'Some cat boarders ask for one so staff can hear where a cat is.',
  },
  {
    // Kennel cough is a dog disease — this must never be asked of a cat.
    id: 'kennel_cough', species: ['Dog'], phase: 'prepare_before', scope: 'pet', derive: 'kennel_cough',
    label: 'Kennel Cough (KC) nasal vaccine',
    help: 'Available at your vet. Needs a few days to take effect, so book it early.',
  },
  {
    // Dog-only by default: the product table below carries dog products, one of
    // which (Advantix, permethrin) is toxic to cats. An admin who ticks this
    // for a cat gets product-free wording.
    id: 'tick_protection', species: ['Dog'], phase: 'prepare_before', scope: 'pet', derive: 'tick',
    label: 'Tick protection active',
    help: 'An effective tick and flea preventive, active across the whole stay.',
  },
  {
    id: 'deworming', species: '*', phase: 'prepare_before', scope: 'pet', derive: 'deworming',
    label: 'Deworming done',
    help: 'Recent deworming, with written confirmation from your vet.',
  },
  {
    id: 'vet_confirmation', species: '*', phase: 'prepare_before', scope: 'owner', derive: 'manual',
    label: "Vet's written confirmation in hand",
    help: 'One note from your vet covering tick protection and deworming. Add the vet name and date below.',
  },
  {
    id: 'trial_visit', species: '*', phase: 'prepare_before', scope: 'pet', derive: 'manual',
    label: 'Trial / orientation visit booked',
    help: 'By appointment, a few days before the stay — it surfaces problems while there is still time to fix them.',
  },
  {
    id: 'diet_brief', species: '*', phase: 'prepare_before', scope: 'pet', derive: 'diet',
    label: 'Food preferences shared',
    help: 'Pick from the boarder’s menu so they can plan. Anything off-menu needs advance notice.',
  },
  {
    id: 'bedding', species: '*', phase: 'prepare_before', scope: 'owner', derive: 'manual',
    label: 'Bedding packed',
    help: 'Something familiar to sleep on. Check what this boarder wants you to bring, and what to leave at home.',
  },
  {
    id: 'original_records', species: '*', phase: 'at_drop_off', scope: 'owner', derive: 'manual',
    label: 'Original vaccination record book',
    help: 'The original, not a photo or a photocopy.',
  },
  {
    id: 'govt_id', species: '*', phase: 'at_drop_off', scope: 'owner', derive: 'manual',
    label: 'Photo ID and address proof',
    help: 'Many boarders ask the pet parent for this on a first stay. Check what this one needs.',
  },
  {
    id: 'declaration', species: '*', phase: 'at_drop_off', scope: 'owner', derive: 'manual',
    label: 'Declaration & T&C signed',
    help: 'Some boarders have a form to sign at drop-off — nothing to do in advance.',
  },
]

export function requirement(id) { return REQUIREMENT_CATALOG.find(r => r.id === id) }

// ── Policies ─────────────────────────────────────────────────────────────────
//
// Every boarder's rules are data, not code. Two constants, deliberately not one:
//
//   GENERIC_POLICY  the fallback for a boarder nobody has configured yet. It
//                   carries only what is true of boarders in general, and says
//                   nothing about menus, hours or rates — because inventing
//                   those on a facility's behalf is worse than staying quiet.
//   UNLEASH_POLICY  one real facility's published rules, and the seed for its
//                   provider row. Its shape is what an admin fills in.

const STRUCTURAL = {
  kc_lead_days: 7,
  kc_valid_days: 365,
  deworm_valid_days: DEWORMER_DURATION_DAYS,
  tick: {
    lead_days: 2,
    default_duration_days: 30,
    // `accepted` and `rejected` are deliberately EMPTY here. Only one boarder
    // in the research refuses collars and sprays, and only one names the
    // products it will take — so both lists belong to a facility, not to every
    // boarder in the directory. A boarder that published neither says neither.
    accepted: [],
    rejected: [],
  },
}

export const GENERIC_POLICY = {
  ...STRUCTURAL,
  isGeneric: true,
  name: '',
  // The requirements essentially every boarder asks for. Trial visits and a
  // vet's written confirmation are common but far from universal, so they are
  // left to the facility to declare rather than asserted here.
  // One flat list; each pet sees the subset for its species, so the dog and cat
  // core vaccines can both sit here. `vaccination_records` is deliberately out
  // — rabies and the species core say the same thing more precisely, and
  // `original_records` already covers carrying the book.
  required: [
    'rabies', 'core_vaccine_dog', 'core_vaccine_cat',
    'kennel_cough', 'tick_protection', 'deworming',
    'diet_brief', 'bedding', 'original_records', 'govt_id', 'declaration',
  ],
  trial_required: false,
  // No slot_windows, pricing, food_menu, bring, advisories or arrival notes:
  // those belong to a particular facility, and the UI shows "ask the boarder"
  // wherever they are missing.
}

export const UNLEASH_POLICY = {
  ...STRUCTURAL,
  name: 'Unleash – The Dog Town',
  // This boarder's own list. Worded as what they will and won't take, rather
  // than why — "they do not work reliably" is a clinical claim, and it isn't
  // the app's to make on a facility's behalf.
  tick: {
    ...STRUCTURAL.tick,
    accepted: ['spot-on', 'bravecto', 'nexgard', 'simparica'],
    rejected: [
      { pattern: 'collar', reason: 'This boarder does not accept tick collars.' },
      { pattern: 'spray',  reason: 'This boarder does not accept tick sprays.' },
      { pattern: 'powder', reason: 'This boarder does not accept tick powders.' },
    ],
  },
  required: [
    'vaccination_records', 'kennel_cough', 'tick_protection', 'deworming',
    'vet_confirmation', 'trial_visit', 'diet_brief', 'bedding',
    'original_records', 'govt_id', 'declaration',
  ],
  trial_required: true,
  slot_windows: [
    { id: 'morning', label: 'Morning', from: '08:00', to: '11:00' },
    { id: 'evening', label: 'Evening', from: '17:00', to: '20:00' },
  ],
  pricing: {
    currency: 'INR',
    full_day: 1000,
    day: 600,
    night: 600,
    last_minute_days: 3,
    note: 'Rates change — always confirm current pricing before the stay.',
  },
  food_menu: [
    { id: 'chicken_rice',  label: 'Home-cooked chicken, rice & veg',  extra_charge: false },
    { id: 'egg_rice',      label: 'Home-cooked egg, rice & veg',      extra_charge: false },
    { id: 'fish_rice',     label: 'Home-cooked fish, rice & veg',     extra_charge: true  },
    { id: 'curd_rice',     label: 'Curd rice (with or without honey)', extra_charge: false },
    { id: 'potato',        label: 'Boiled potatoes',                  extra_charge: false },
    { id: 'kibble',        label: 'Kibble — Pedigree / Chappie / Smart Heart / Meat Up', extra_charge: false },
    { id: 'kibble_rc',     label: 'Kibble — Royal Canin',             extra_charge: true  },
    { id: 'boiled_chicken', label: 'Plain boiled chicken',            extra_charge: false },
    { id: 'boiled_chicken_boneless', label: 'Plain boiled chicken (boneless)', extra_charge: true },
    { id: 'boiled_eggs',   label: 'Boiled eggs',                      extra_charge: false },
    { id: 'bhakri',        label: 'Bhakri',                           extra_charge: true  },
    { id: 'curd',          label: 'Plain curd / buttermilk',          extra_charge: false },
    { id: 'icecream',      label: 'Vanilla ice cream',                extra_charge: false },
    { id: 'biscuits',      label: 'Dog / Marie biscuits',             extra_charge: false },
  ],
  food_note: 'Anything outside this menu can be arranged with advance notice, at extra cost.',
  bring: ['A small rug, bedsheet or dari', 'Original vaccination record book', 'Two govt photo IDs with address'],
  do_not_bring: ['Fancy leashes', 'Expensive beds', 'Favourite toys'],
  advisories: [
    { months: [3, 4, 5], text: 'No air-conditioning — coolers, fans and sprinklers are used. Conjunctivitis, kennel cough and wheezing occasionally occur in summer.' },
    { months: [6, 7, 8, 9], text: 'Monsoon: hotspots, skin issues and digestive trouble are more likely, and the tick-free campus is harder to maintain. Active tick protection matters most now.' },
  ],
  arrival_notes: 'Please do not honk on arrival — call or message from the gate.',
  extras_note: 'Pick-up and drop is available at extra cost, through a third-party vendor.',
  // A boarder's own wording for a criterion, shown under the general help. The
  // catalogue text stays deliberately non-committal so it is true everywhere;
  // this is where a facility gets to be specific.
  requirement_notes: {
    govt_id: 'Two original government photo IDs with address, carried by the pet parent. Required for first-time boarders.',
    bedding: 'A small rug, bedsheet or dari. Leave fancy leashes, expensive beds and favourite toys at home.',
    kennel_cough: 'Available at your vet. Mandatory here.',
    vet_confirmation: 'Written confirmation of tick protection and timely deworming.',
  },
}

// Everything the generic fallback deliberately omits. Kept as one list so the
// admin editor and resolvePolicy agree on what counts as facility-specific.
export const FACILITY_FIELDS = [
  'name', 'slot_windows', 'pricing', 'food_menu', 'food_note',
  'bring', 'do_not_bring', 'advisories', 'arrival_notes', 'extras_note',
]

// What an admin fills in. A field left out stays out — it is not backfilled
// from Unleash's.
export function resolvePolicy(provider) {
  const p = provider?.boarding_policy
  if (!p || typeof p !== 'object' || !Object.keys(p).length) return GENERIC_POLICY

  return {
    ...GENERIC_POLICY,
    ...p,
    isGeneric: false,
    tick:    { ...STRUCTURAL.tick, ...(p.tick || {}) },
    // Only merge the rate card's shape once the facility has declared one at
    // all; a boarder with no prices must show none, not Unleash's.
    pricing: p.pricing ? { currency: 'INR', ...p.pricing } : undefined,
  }
}

// Which species a boarder takes. Deliberately TRI-STATE and never defaulted:
// only 7 of 25 Indian boarders in the research published cat criteria at all,
// so defaulting to ['Dog','Cat'] would assert cat acceptance right across the
// directory. Unset means "they haven't said", which is the truth.
export function speciesStance(policy, species) {
  const accepted = policy?.species_accepted
  if (!Array.isArray(accepted) || !accepted.length) return 'unknown'
  return accepted.includes(species) ? 'accepted' : 'not_accepted'
}

// Which species a policy's criteria actually speak to. A list of dog-only
// criteria viewed by a cat owner filters down to almost nothing, and an empty
// checklist reads as "nothing required" — a false all-clear, and worse than
// the kennel-cough-on-a-cat bug it replaced. This is how we tell the
// difference between "not required for cats" and "nobody thought about cats".
export function speciesCovered(policy) {
  // Only criteria exclusive to ONE species discriminate. Rabies applies to dogs
  // and cats alike, so its presence says nothing about whether this boarder
  // ever considered cats; kennel cough or a feline core vaccine does.
  const out = new Set()
  for (const id of policy?.required || []) {
    const r = requirement(id)
    if (!r || r.species === '*' || r.species.length !== 1) continue
    out.add(r.species[0])
  }
  return [...out]
}

export function hasCustomPolicy(provider) {
  const p = provider?.boarding_policy
  return !!(p && typeof p === 'object' && Object.keys(p).length)
}

// ── Matching helpers ─────────────────────────────────────────────────────────

const TICK_RE    = /bravecto|nexgard|nex gard|simparica|credelio|revolution|advantix|frontline|fiprofort|fipronil|spot.?on|tick|flea/i
const DEWORM_RE  = /deworm|de-worm|albendazole|praziquantel|drontal|milbemycin|pyrantel|fenbendazole|panacur|worm/i
const KC_RE      = /kennel.?cough|bordetella|\bkc\b|intrac|nobivac.?kc|nasal/i

function latestBy(list, key) {
  return list
    .filter(x => d(x[key]))
    .sort((a, b) => d(b[key]) - d(a[key]))[0] || null
}

function durationFor(name) {
  const n = (name || '').toLowerCase()
  const hit = Object.keys(PRODUCT_DURATION_DAYS)
    .sort((a, b) => b.length - a.length)
    .find(k => n.includes(k))
  return hit ? { days: PRODUCT_DURATION_DAYS[hit], product: hit } : null
}

function rejectedBy(policy, name) {
  const n = (name || '').toLowerCase()
  return (policy.tick?.rejected || []).find(r => n.includes(r.pattern.toLowerCase())) || null
}

// Only name products when the boarder named them. Otherwise the app would be
// recommending one facility's brand list to everyone else's customers.
function tickProducts(policy) {
  const list = policy.tick?.accepted || []
  if (!list.length) return ''
  const pretty = list.map(x => x.replace(/(^|[\s-])\w/g, c => c.toUpperCase()))
  return ` This boarder accepts ${pretty.join(', ')}.`
}

// Given a record's start and an inferred duration, how long is cover good for?
// An explicit `nextDue` from the vet always wins over anything we infer.
function coverUntil(record, startKey, fallbackDays) {
  const explicit = d(record.nextDue)
  if (explicit) return { until: explicit, inferred: false }
  const from = d(record[startKey])
  if (!from) return { until: null, inferred: true }
  const guess = durationFor(record.name)
  const days = guess && guess.days > 0 ? guess.days : fallbackDays
  // No fallback means we have no defensible validity period for this thing —
  // say so rather than computing addDays(from, null), which yields an Invalid
  // Date that slips past every comparison below and reads as `ready`.
  if (!days) return { until: null, inferred: true }
  return { until: addDays(from, days), inferred: true }
}

// ── Readiness ────────────────────────────────────────────────────────────────
//
// Status meanings:
//   ready            — we can see it, and it covers the stay
//   found_unverified — we found a matching record but had to infer the expiry;
//                      the parent should confirm rather than trust us
//   expiring         — valid at drop-off but runs out during or just after
//   action_needed    — missing, expired, or explicitly not accepted
//   manual           — nothing to derive from; the parent ticks it themselves
//
// A manual `done` override always wins: a vet's written confirmation is a fact
// the app has no way to see.

export function appliesTo(req, species) {
  if (!req) return false
  if (req.species === '*') return SUPPORTED_SPECIES.includes(species)
  return (req.species || []).includes(species)
}

export function evaluateReadiness(pet, { vaccinations = [], medicines = [] } = {}, policy = GENERIC_POLICY, tripStartDate = null, overrides = {}) {
  const start = d(tripStartDate) || today()
  const ids = policy.required || GENERIC_POLICY.required

  return ids.map(id => {
    const req = requirement(id)
    // A boarder keeps one flat list of criteria; each pet sees the subset that
    // applies to its species. Kennel cough is the reason this exists — it is a
    // dog disease, and a cat's owner must never be told to go and get one.
    if (!appliesTo(req, pet?.species)) return null

    const base = { ...req, status: 'manual', reason: '', source: null, validUntil: null, actionDate: null }
    const ov = overrides[id]

    let result
    switch (req.derive) {
      case 'kennel_cough':   result = deriveKennelCough(vaccinations, policy, start); break
      case 'tick':           result = deriveTick(medicines, policy, start); break
      case 'deworming':      result = deriveDeworming(medicines, policy, start); break
      case 'vaccination_any': result = deriveVaccinationRecords(vaccinations, start); break
      case 'named_vaccine':  result = deriveNamedVaccine(vaccinations, req, start); break
      case 'microchip':      result = deriveMicrochip(pet); break
      case 'diet':           result = deriveDiet(pet); break
      default:               result = { status: 'manual', reason: '' }
    }

    const merged = { ...base, ...result }

    if (ov?.done) {
      return { ...merged, status: 'ready', overridden: true,
               reason: ov.note ? ov.note : 'Marked done by you', checkedOn: ov.date || null }
    }
    return merged
  }).filter(Boolean)
}

function windowStatus(until, start, inferred) {
  if (!until) return { status: 'found_unverified', reason: 'Found a record but no date to judge it by — please confirm with your vet.' }
  if (until < start) {
    return { status: 'action_needed', validUntil: until,
             reason: `Cover ran out on ${format(until, 'd MMM yyyy')}.` }
  }
  if (until < addDays(start, 14)) {
    return { status: 'expiring', validUntil: until,
             reason: `Valid at drop-off but runs out on ${format(until, 'd MMM yyyy')}.` }
  }
  return { status: inferred ? 'found_unverified' : 'ready', validUntil: until,
           reason: inferred
             ? `Estimated to cover until ${format(until, 'd MMM yyyy')} — no due date on the record, so please confirm.`
             : `Covered until ${format(until, 'd MMM yyyy')}.` }
}

function deriveKennelCough(vaccinations, policy, start) {
  const hits = vaccinations.filter(v => KC_RE.test(v.name || '') || KC_RE.test(v.notes || ''))
  const latest = latestBy(hits, 'dateGiven')
  if (!latest) {
    return { status: 'action_needed',
             reason: 'No kennel cough record found. Ask your vet for the nasal vaccine.',
             actionDate: iso(addDays(start, -(policy.kc_lead_days ?? 7))) }
  }
  const { until, inferred } = coverUntil({ ...latest, name: latest.name }, 'dateGiven', policy.kc_valid_days ?? 365)
  const s = windowStatus(until, start, inferred)
  return { ...s, source: `${latest.name} — given ${format(d(latest.dateGiven), 'd MMM yyyy')}`,
           actionDate: s.status === 'action_needed' || s.status === 'expiring'
             ? iso(addDays(start, -(policy.kc_lead_days ?? 7))) : null }
}

function deriveTick(medicines, policy, start) {
  const hits = medicines.filter(m =>
    m.category === 'Flea/Tick' || TICK_RE.test(m.name || '') || TICK_RE.test(m.reason || ''))
  const latest = latestBy(hits, 'startDate')
  const leadDate = iso(addDays(start, -(policy.tick?.lead_days ?? 2)))

  if (!latest) {
    return { status: 'action_needed',
             reason: `No tick protection on record.${tickProducts(policy) || ' An effective preventive your vet recommends is needed.'}`,
             actionDate: leadDate }
  }
  const reject = rejectedBy(policy, latest.name)
  if (reject) {
    return { status: 'action_needed', source: latest.name, reason: reject.reason, actionDate: leadDate }
  }
  const { until, inferred } = coverUntil(latest, 'startDate', policy.tick?.default_duration_days ?? 30)
  const s = windowStatus(until, start, inferred)
  return { ...s, source: `${latest.name} — from ${format(d(latest.startDate), 'd MMM yyyy')}`,
           actionDate: s.status === 'ready' ? null : leadDate }
}

function deriveDeworming(medicines, policy, start) {
  const hits = medicines.filter(m =>
    m.category === 'Deworming' || DEWORM_RE.test(m.name || '') || DEWORM_RE.test(m.reason || ''))
  const latest = latestBy(hits, 'startDate')
  if (!latest) {
    return { status: 'action_needed', reason: 'No deworming on record in the last few months.' }
  }
  const { until, inferred } = coverUntil(latest, 'startDate', policy.deworm_valid_days ?? DEWORMER_DURATION_DAYS)
  const s = windowStatus(until, start, inferred)
  return { ...s, source: `${latest.name} — ${format(d(latest.startDate), 'd MMM yyyy')}` }
}

// Named vaccines carry NO invented validity window. Indian boarders publish
// none, and product schedules differ (rabies is sold as both annual and
// triennial), so a renewal date from the vet is the only thing we will trust.
function deriveNamedVaccine(vaccinations, req, start) {
  const hits = vaccinations.filter(v => req.match.test(v.name || '') || req.match.test(v.notes || ''))
  const latest = latestBy(hits, 'dateGiven')
  if (!latest) {
    return { status: 'action_needed', reason: `No ${req.noun || req.label} on record.` }
  }
  const given = d(latest.dateGiven)
  const source = `${latest.name} — given ${format(given, 'd MMM yyyy')}`
  const due = d(latest.nextDue)

  if (!due) {
    return { status: 'found_unverified', source,
             reason: 'No renewal date on the record, so we can’t tell whether it is still valid — check with your vet.' }
  }
  if (due < start) {
    return { status: 'action_needed', source, validUntil: due,
             reason: `Expired on ${format(due, 'd MMM yyyy')}.` }
  }
  if (due < addDays(start, 14)) {
    return { status: 'expiring', source, validUntil: due,
             reason: `Valid at drop-off but due again on ${format(due, 'd MMM yyyy')}.` }
  }
  return { status: 'ready', source, validUntil: due, reason: `Valid until ${format(due, 'd MMM yyyy')}.` }
}

function deriveMicrochip(pet) {
  return pet?.microchipId
    ? { status: 'ready', source: `Chip ${pet.microchipId}`, reason: 'On file.' }
    : { status: 'action_needed', reason: 'No microchip number on file. Add it by editing the pet, or ask your vet.' }
}

function deriveVaccinationRecords(vaccinations, start) {
  if (!vaccinations.length) {
    return { status: 'action_needed', reason: 'No vaccination records in the app yet.' }
  }
  const overdue = vaccinations.filter(v => d(v.nextDue) && d(v.nextDue) < start)
  if (overdue.length) {
    return { status: 'action_needed',
             source: `${vaccinations.length} record${vaccinations.length > 1 ? 's' : ''} on file`,
             reason: `Overdue: ${overdue.map(v => v.name).join(', ')}.` }
  }
  return { status: 'found_unverified',
           source: `${vaccinations.length} record${vaccinations.length > 1 ? 's' : ''} on file`,
           reason: 'Looks current — carry the original record book, not a photo.' }
}

function deriveDiet(pet) {
  const prefs = pet?.foodPreferences || []
  if (!prefs.length && !pet?.dietNotes) {
    return { status: 'action_needed', reason: 'No food preferences set — add them in the boarding profile below.' }
  }
  return { status: 'ready', reason: prefs.length ? `${prefs.length} item${prefs.length > 1 ? 's' : ''} chosen from the menu.` : 'Diet notes recorded.' }
}

// "Needs action" is the number that matters — a percentage alone reads as alarm
// when most of what is outstanding is just a box the parent hasn't ticked yet.
export function readinessScore(evaluation) {
  const prep = evaluation.filter(e => e.phase === 'prepare_before')
  const count = (...s) => prep.filter(e => s.includes(e.status)).length
  const ready = count('ready')
  return {
    ready,
    needsAction: count('action_needed', 'expiring'),
    toConfirm:   count('found_unverified'),
    manual:      count('manual'),
    total:       prep.length,
    pct:         prep.length ? Math.round((ready / prep.length) * 100) : 100,
  }
}

// ── Prep tasks ───────────────────────────────────────────────────────────────
//
// The 7am reminder job matches `due_date` by exact equality, so a task dated in
// the past is never delivered at all. Anything already overdue is therefore
// pulled forward to today and labelled, rather than silently dropped.

function clamp(dateStr) {
  const t = today()
  const x = d(dateStr)
  if (!x || x < t) return { dueDate: iso(t), overdue: true }
  return { dueDate: iso(x), overdue: false }
}

export function prepTasks(policy = GENERIC_POLICY, tripStartDate = null, evaluation = []) {
  const start = d(tripStartDate)
  if (!start) return []
  // Nothing applied to this pet's species, so there is nothing to prepare.
  if (!evaluation.length) return []
  const by = (id) => evaluation.find(e => e.id === id)
  // Something we found but had to infer an expiry for doesn't need doing again
  // — it needs confirming. Telling a parent to re-vaccinate a dog that is
  // already covered is worse than saying nothing.
  // A requirement that isn't in `evaluation` doesn't apply to this pet — it was
  // filtered out by species. Without this guard an absent id reads as 'manual',
  // which counts as outstanding, and a cat's owner would get "Kennel Cough
  // vaccine at the vet" emailed to them even though the screen never showed it.
  const has     = (id) => evaluation.some(e => e.id === id)
  const status  = (id) => by(id)?.status || 'manual'
  const needs   = (id) => has(id) && ['action_needed', 'expiring', 'manual'].includes(status(id))
  const confirm = (id) => has(id) && status(id) === 'found_unverified'
  const tasks = []

  const push = (id, label, whenISO, notes) => {
    const { dueDate, overdue } = clamp(whenISO)
    tasks.push({ id, type: 'Boarding', label, dueDate, overdue, frequency: 'Once', notes })
  }

  if (policy.trial_required && needs('trial_visit')) {
    push('trial_visit', 'Book the trial / orientation visit',
      iso(addDays(start, -10)),
      'Trials are by appointment only, and need to happen a few days before the stay.')
  }
  if (needs('kennel_cough')) {
    push('kennel_cough', 'Kennel Cough (KC) nasal vaccine at the vet',
      iso(addDays(start, -(policy.kc_lead_days ?? 7))),
      'Needs a few days to take effect before drop-off.')
  } else if (confirm('kennel_cough')) {
    push('kennel_cough', 'Confirm the kennel cough vaccine is still in date',
      iso(addDays(start, -(policy.kc_lead_days ?? 7))),
      `We found ${by('kennel_cough').source || 'a record'} but had to estimate the expiry — check with your vet.`)
  }
  if (needs('tick_protection')) {
    push('tick_protection', 'Apply tick protection',
      iso(addDays(start, -(policy.tick?.lead_days ?? 2))),
      `Apply at night, ${policy.tick?.lead_days ?? 2} days before the stay, so it spreads properly.${tickProducts(policy)}`)
  } else if (confirm('tick_protection')) {
    push('tick_protection', 'Confirm tick protection still covers the stay',
      iso(addDays(start, -(policy.tick?.lead_days ?? 2))),
      `We found ${by('tick_protection').source || 'a record'} but had to estimate how long it lasts — check before you travel.`)
  }
  if (needs('deworming') || confirm('deworming')) {
    push('deworming', 'Deworming + written confirmation from the vet',
      iso(addDays(start, -7)),
      has('tick_protection')
        ? 'Ask the vet to put the deworming and tick protection in writing.'
        : 'Ask the vet to put the deworming in writing.')
  }
  if (needs('vet_confirmation')) {
    push('vet_confirmation', "Collect the vet's written confirmation",
      iso(addDays(start, -3)),
      has('tick_protection')
        ? 'One note covering tick protection and deworming, to hand over at drop-off.'
        : 'One note covering the deworming, to hand over at drop-off.')
  }
  const bring = (policy.bring || []).length
    ? `Bring: ${policy.bring.join(', ')}`
    : 'Bedding, any medication, and the original vaccination record book.'
  const leave = (policy.do_not_bring || []).length
    ? `Leave at home: ${policy.do_not_bring.join(', ')}`
    : ''
  push('pack', 'Pack for boarding', iso(addDays(start, -1)), [bring, leave].filter(Boolean).join('. '))

  return tasks
}

// ── Slots ────────────────────────────────────────────────────────────────────

export const OTHER_SLOT = 'other'

export function hasSlotWindows(policy = GENERIC_POLICY) {
  return !!(policy.slot_windows || []).length
}

// Without published hours there is nothing to pick from, so the caller falls
// back to a plain morning/evening choice that carries no claim about billing.
export function slotOptions(policy = GENERIC_POLICY) {
  const windows = policy.slot_windows || []
  if (!windows.length) {
    return [
      { id: 'morning', label: 'Morning' },
      { id: 'evening', label: 'Evening' },
    ]
  }
  return [
    ...windows.map(w => ({ ...w, label: `${w.label} (${w.from}–${w.to})` })),
    { id: OTHER_SLOT, label: 'Outside these hours' },
  ]
}

// Boarders don't share slot ids, so a slot chosen under one policy may not
// exist under the next. Left alone it would silently read as "outside hours"
// and add a phantom extra day to the estimate, so it is remapped instead.
export function coerceSlot(policy = GENERIC_POLICY, slotId) {
  const opts = slotOptions(policy)
  return opts.some(o => o.id === slotId) ? slotId : (opts[0]?.id || '')
}

export function validateSlot(policy = GENERIC_POLICY, slotId) {
  const windows = policy.slot_windows || []
  // Nothing published means nothing to warn about. Asserting an extra-day
  // charge on a facility that never said so would be inventing its terms.
  if (!windows.length) return { ok: true, window: null, message: '' }
  const win = windows.find(w => w.id === slotId)
  if (win) return { ok: true, window: win, message: '' }
  const list = windows.map(w => `${w.from}–${w.to}`).join(' or ')
  return { ok: false, window: null,
           message: `Arrivals and departures outside ${list} are billed as an extra day's stay.` }
}

// ── Advisories ───────────────────────────────────────────────────────────────
// Shown only when they overlap the stay; a year-round wall of warnings is a
// wall nobody reads.

export function activeAdvisories(policy = GENERIC_POLICY, startDate, endDate) {
  const s = d(startDate), e = d(endDate) || s
  if (!s) return []
  const months = new Set()
  for (let cur = new Date(s); cur <= e; cur.setMonth(cur.getMonth() + 1)) months.add(cur.getMonth() + 1)
  months.add(s.getMonth() + 1)
  if (e) months.add(e.getMonth() + 1)
  return (policy.advisories || []).filter(a => (a.months || []).some(m => months.has(m)))
}

// ── Cost estimate ────────────────────────────────────────────────────────────
// Always an estimate: the boarder's own terms say rates change. Situational
// charges are phrased as things the boarder *may ask about* — the app is in no
// position to assert that a particular dog attracts a surcharge.

export function estimateCost(policy = GENERIC_POLICY, trip = {}, pet = {}) {
  const pricing = policy.pricing
  const start = d(trip.startDate), end = d(trip.endDate)
  const lines = []
  let total = 0

  if (start && pricing) {
    const nights = end ? Math.max(0, differenceInCalendarDays(end, start)) : 0
    if (nights === 0) {
      const dayOnly = trip.startSlot === 'morning' && trip.endSlot === 'evening'
      const rate = dayOnly ? pricing.day : pricing.day
      lines.push({ label: dayOnly ? 'Day boarding (morning to evening)' : 'Single-day boarding', amount: rate })
      total += rate
    } else if (nights === 1 && trip.startSlot === 'evening' && trip.endSlot === 'morning') {
      lines.push({ label: 'Night stay (evening to next morning)', amount: pricing.night })
      total += pricing.night
    } else {
      const amount = nights * pricing.full_day
      lines.push({ label: `${nights} × full-day boarding (24 hrs, incl. overnight)`, amount })
      total += amount
    }
  }

  for (const [which, slot] of [['Drop-off', trip.startSlot], ['Pick-up', trip.endSlot]]) {
    if (pricing && slot && !validateSlot(policy, slot).ok) {
      lines.push({ label: `${which} outside visiting hours — billed as an extra day`, amount: pricing.full_day })
      total += pricing.full_day
    }
  }

  const flags = []
  const chargeable = (policy.food_menu || [])
    .filter(m => m.extra_charge && (pet.foodPreferences || []).includes(m.id))
  if (chargeable.length) {
    flags.push(`${chargeable.map(m => m.label).join(', ')} — charged extra.`)
  }

  if (start) {
    const daysOut = differenceInCalendarDays(start, today())
    if (daysOut >= 0 && daysOut < (pricing?.last_minute_days ?? 3)) {
      flags.push('Booked at short notice — last-minute bookings cost more.')
    }
  }

  const age = pet.dob ? differenceInCalendarDays(today(), d(pet.dob)) / 365.25 : null
  if (age !== null && age >= 10) flags.push('Senior dogs (10+) may need extra care hours — the boarder may ask about this.')
  if (pet.anxietyNotes)  flags.push('You have noted anxiety or barking — worth discussing with the boarder in advance.')
  if (pet.handlingNotes) flags.push('You have noted special handling needs — worth discussing in advance.')
  if ((pet.triggers || []).length) flags.push('You have noted triggers — share these at the trial visit.')

  return {
    currency: pricing?.currency || 'INR',
    lines, total,
    isEstimate: true,
    // No rate card on file — say so rather than quoting someone else's.
    hasPricing: !!pricing,
    note: pricing
      ? (pricing.note || 'Rates change — confirm current pricing before the stay.')
      : 'No rates on file for this boarder — ask them what a stay costs, and whether age, medical needs or a special diet change it.',
    discussionFlags: flags,
  }
}

// ── The handover sheet ───────────────────────────────────────────────────────
// The artefact that actually reaches the boarder, so it carries the things they
// will otherwise have to ask for at the gate.

export function buildBoardingPack({ pet, policy = GENERIC_POLICY, trip = {}, evaluation = [], allergies = [], medicines = [] }) {
  const menu = policy.food_menu || []
  const prefs = (pet.foodPreferences || [])
    .map(id => menu.find(m => m.id === id)?.label || id)
  const fmt = (s) => { const x = d(s); return x ? format(x, 'd MMM yyyy') : '' }
  const slotLabel = (id) => (policy.slot_windows || []).find(w => w.id === id)?.label || (id === OTHER_SLOT ? 'Outside visiting hours' : '')
  const ongoing = medicines.filter(m =>
    !m.isDone && !['Flea/Tick', 'Deworming', 'Vaccination'].includes(m.category))

  const L = [
    `🐾 BOARDING PACK — ${(pet.name || '').toUpperCase()}`,
    '─'.repeat(40),
    `${pet.species || ''}${pet.breed ? ` · ${pet.breed}` : ''}${pet.gender ? ` · ${pet.gender}` : ''}`,
    pet.dob ? `Age: ${Math.floor(differenceInCalendarDays(today(), d(pet.dob)) / 365.25)} years` : '',
    pet.weight ? `Weight: ${pet.weight} kg` : '',
    '',
    trip.startDate ? `STAY: ${fmt(trip.startDate)}${trip.startSlot ? ` (${slotLabel(trip.startSlot)})` : ''} → ${fmt(trip.endDate) || 'TBC'}${trip.endSlot ? ` (${slotLabel(trip.endSlot)})` : ''}` : '',
    trip.trialDate ? `Trial visit: ${fmt(trip.trialDate)}` : '',
    '',
    '✅ REQUIREMENTS',
    ...evaluation.map(e => {
      const mark = e.status === 'ready' ? '✔' : e.status === 'action_needed' ? '✖' : '•'
      // Don't cite the source on a failed item — naming the tick collar we
      // just rejected next to a ✖ reads as if it were the evidence.
      const detail = e.status === 'action_needed' ? '' : e.source ? ` — ${e.source}` : ''
      return `  ${mark} ${e.label}${detail}`
    }),
    '',
    prefs.length ? `🍲 FOOD: ${prefs.join(', ')}` : '',
    pet.feedingSchedule ? `Feeding: ${pet.feedingSchedule}` : '',
    pet.dietNotes ? `Diet notes: ${pet.dietNotes}` : '',
    '',
    allergies.length ? `⚠️ ALLERGIES: ${allergies.map(a => a.allergen).join(', ')}` : '✅ No known allergies',
    // Preventatives are already covered under requirements; this line is for
    // what the boarder actually has to administer during the stay.
    ongoing.length
      ? `💊 ON MEDICATION: ${ongoing.map(m => `${m.name}${m.dosage ? ` (${m.dosage})` : ''}${m.frequency ? ` — ${m.frequency}` : ''}`).join(', ')}`
      : '',
    '',
    pet.temperament ? `🐕 TEMPERAMENT: ${pet.temperament}` : '',
    pet.socialisesWithDogs === true ? 'Gets on with other dogs: yes' : pet.socialisesWithDogs === false ? 'Gets on with other dogs: no — please keep separate' : '',
    (pet.triggers || []).length ? `Triggers: ${pet.triggers.join(', ')}` : '',
    pet.anxietyNotes ? `Anxiety / barking: ${pet.anxietyNotes}` : '',
    pet.handlingNotes ? `Handling: ${pet.handlingNotes}` : '',
    '',
    pet.vetName || pet.vetPhone ? `🏥 VET: ${[pet.vetName, pet.vetPhone].filter(Boolean).join(' · ')}` : '',
    trip.notes ? `\n📝 ${trip.notes}` : '',
  ].filter(l => l !== '')

  return L.join('\n')
}
