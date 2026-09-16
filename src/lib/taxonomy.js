// taxonomy.js — what a provider IS, what it DOES, and what it specialises in.
//
// Three separate things that used to be one:
//
//   type            the primary tab in the directory. Single-valued.
//   services        everything the business actually does. Multi-valued.
//   specializations a vet's clinical specialisms. Multi-valued.
//
// They were one because the importer picked a type by first-match-wins over a
// list of regexes, so a business that walks dogs AND boards them became a
// Boarder purely because Boarder was tested first. 40 dog walkers ended up
// spread across Boarder, Groomer, Special Services and Vet. A single label
// cannot describe a business that genuinely does four things.
//
// Both vocabularies are curated here rather than free text. The providers table
// is world-readable through the anon-granted search_providers(), so nothing
// user-authored should end up in a column we pattern-match against.

// ── Services ─────────────────────────────────────────────────────────────────

export const SERVICES = [
  'Boarding', 'Day Care', 'Dog Walking', 'Training', 'Grooming',
  'Pet Sitting', 'Pet Taxi', 'Adoption & Rescue', 'Photography',
]

// Google's category → the service it implies. Matched case-insensitively
// against each entry of the scraped `categories` array.
const SERVICE_BY_CATEGORY = {
  'pet boarding service':  'Boarding',
  'cat boarding service':  'Boarding',
  'cattery':               'Boarding',
  'kennel':                'Boarding',
  'pet hostel':            'Boarding',
  'dog day care center':   'Day Care',
  'day care center':       'Day Care',
  'dog walker':            'Dog Walking',
  'dog trainer':           'Training',
  'pet trainer':           'Training',
  'obedience school':      'Training',
  'pet groomer':           'Grooming',
  'pet sitter':            'Pet Sitting',
  'pet moving service':    'Pet Taxi',
  'pet adoption service':  'Adoption & Rescue',
  'animal shelter':        'Adoption & Rescue',
  'animal rescue service': 'Adoption & Rescue',
  'animal protection organization': 'Adoption & Rescue',
  'photographer':          'Photography',
}

// ── Specialisations ──────────────────────────────────────────────────────────
//
// Derived ONLY from what a business labels itself as. The scrape also carries
// a `searchString` — the words typed into Maps — which would give near-total
// coverage, but appearing in a search for "veterinary surgeon" is not a claim
// to be one. Using it would have tagged 114 Pune clinics with specialisms they
// never advertised. Coverage lands around 29% of vets instead, and the rest is
// filled in by hand in Admin. A vet with no specialisation shown is honest.

export const SPECIALIZATIONS = [
  'Emergency & 24-hour', 'Surgery', 'Orthopaedics', 'Oncology', 'Ophthalmology',
  'Dentistry', 'Dermatology', 'Diagnostics & imaging', 'Physiotherapy & rehab',
  'Homeopathy & alternative', 'Birds & exotics', 'Cats', 'Farm & large animal',
]

const SPEC_BY_CATEGORY = {
  'emergency veterinarian service': 'Emergency & 24-hour',
  'ambulance service':             'Emergency & 24-hour',
  'veterinary surgeon':            'Surgery',
  'surgeon':                       'Surgery',
  'orthopedic surgeon':            'Orthopaedics',
  'oncologist':                    'Oncology',
  'surgical oncologist':           'Oncology',
  'cancer treatment center':       'Oncology',
  'ophthalmologist':               'Ophthalmology',
  'dental clinic':                 'Dentistry',
  'dentist':                       'Dentistry',
  'skin care clinic':              'Dermatology',
  'diagnostic center':             'Diagnostics & imaging',
  'medical diagnostic imaging center': 'Diagnostics & imaging',
  'radiologist':                   'Diagnostics & imaging',
  'laboratory':                    'Diagnostics & imaging',
  'physical therapy clinic':       'Physiotherapy & rehab',
  'physical therapist':            'Physiotherapy & rehab',
  'homeopath':                     'Homeopathy & alternative',
  'acupuncture clinic':            'Homeopathy & alternative',
  'bird shop':                     'Birds & exotics',
  'reptile store':                 'Birds & exotics',
  'cat cafe':                      'Cats',
}

// Some specialisms only ever show up in the business NAME — no Google category
// exists for "we treat exotics". Applied to the name only, never to the search
// term that found the business.
const SPEC_BY_NAME = [
  [/\b24\s*[x*]?\s*7\b|\b24[- ]?hour/i, 'Emergency & 24-hour'],
  [/\bemergency\b/i,                    'Emergency & 24-hour'],
  [/\bexotic/i,                         'Birds & exotics'],
  [/\bavian\b/i,                        'Birds & exotics'],
  [/\bfeline\b|\bcat\s+(clinic|hospital|speciali)/i, 'Cats'],
  [/\bortho/i,                          'Orthopaedics'],
  [/\boncolog|\bcancer\b/i,             'Oncology'],
  [/\bdiagnostic|\bpatholog|\bimaging\b/i, 'Diagnostics & imaging'],
  [/\bphysiotherap|\brehab/i,           'Physiotherapy & rehab'],
  [/\bhomeopath|\bhomoeopath/i,         'Homeopathy & alternative'],
]

// ── Type ─────────────────────────────────────────────────────────────────────

export const PROVIDER_TYPES = [
  'Vet', 'Groomer', 'Store', 'Boarder', 'Dog Walking', 'Training',
  'Special Services', 'Pet Loss & Memorial Services',
]

// A business gets ONE type for the directory tabs, chosen by what it most is
// rather than by which regex happened to be tested first. Earlier wins.
const TYPE_PRIORITY = [
  ['Pet Loss & Memorial Services', c => /cremat|memorial|funeral|burial|cemeter/.test(c)],
  ['Vet',      c => /veterinarian|animal hospital|animal clinic|pet clinic|veterinary care/.test(c)],
  ['Boarder',  c => /pet boarding service|cat boarding service|cattery|pet hostel|dog day care|kennel/.test(c)],
  ['Groomer',  c => /pet groomer|pet spa|grooming/.test(c)],
  ['Training', c => /dog trainer|pet trainer|obedience school/.test(c)],
  ['Dog Walking', c => /dog walker/.test(c)],
  ['Store',    c => /pet store|pet supply|pet shop|aquarium|fish store|bird shop|animal feed|pet food|veterinary pharmacy/.test(c)],
  ['Special Services', c => /photographer|pet moving service|pet adoption service|animal shelter/.test(c)],
]

// A pharmacy is a shop, not a clinic. "Veterinary pharmacy" matched the vet
// rule and put 49 medicine shops in front of people looking for a vet, so a
// pharmacy only counts as a Vet when it ALSO carries a real clinical category.
function clinicalSignal(cats) {
  return cats.some(c => /veterinarian|animal hospital|animal clinic|pet clinic|veterinary care/.test(c))
}

// Businesses we don't list at all.
const EXCLUDE = [
  [/dog breeder|cat breeder/, 'breeder'],
  [/training center/,         'training institute'],   // veterinary colleges, not pet services
]

// An excluded category only counts when it's ALL the business is. A shop that
// also breeds, or a resort that also runs training classes, is a real business
// that happens to do that thing — so any other business signal, in a category
// or in the name ("Wolf Shanze Dog Hostel"), keeps the row.
const OTHER_BUSINESS = /pet store|pet supply|pet groomer|pet boarding|cattery|veterinarian|animal hospital|dog walker|dog trainer|pet trainer|animal feed|aquarium|bird shop|pet sitter|day care/
const OTHER_BUSINESS_NAME = /hostel|boarding|shop|store|clinic|salon|spa|resort|hospital|day care|daycare/i

export function exclusionReason(categories = [], name = '') {
  const cats = categories.map(c => (c || '').toLowerCase())
  const joined = cats.join(' | ')
  for (const [re, reason] of EXCLUDE) {
    if (!re.test(joined)) continue
    // The rescue applies to EVERY exclusion, not just breeders. "Pets Hangover
    // Pet Resort and Dog Park" carries a Training center category and would
    // otherwise be thrown out as a veterinary college.
    if (OTHER_BUSINESS.test(joined) || OTHER_BUSINESS_NAME.test(name)) continue
    return reason
  }
  return null
}

// ── Derivation ───────────────────────────────────────────────────────────────

export function deriveServices(categories = []) {
  const out = new Set()
  for (const raw of categories) {
    const hit = SERVICE_BY_CATEGORY[(raw || '').toLowerCase().trim()]
    if (hit) out.add(hit)
  }
  return [...out].sort()
}

export function deriveSpecializations(categories = [], name = '') {
  const out = new Set()
  for (const raw of categories) {
    const hit = SPEC_BY_CATEGORY[(raw || '').toLowerCase().trim()]
    if (hit) out.add(hit)
  }
  for (const [re, spec] of SPEC_BY_NAME) if (re.test(name || '')) out.add(spec)
  return [...out].sort()
}

// Last resort when the categories say nothing usable. Needed because a row can
// be rescued from the breeder exclusion by its name ("Wolf Shanze Dog Hostel")
// and then have no category left to type it by — dropping it from the
// directory entirely would be a worse outcome than the exclusion it escaped.
const TYPE_BY_NAME = [
  [/hostel|boarding|resort|day\s*care|daycare|cattery/i, 'Boarder'],
  [/salon|\bspa\b|groom/i,                               'Groomer'],
  [/\bshop\b|\bstore\b|\bmart\b/i,                     'Store'],
  [/clinic|hospital/i,                                    'Vet'],
]

export function deriveType(categories = [], name = '') {
  const cats = categories.map(c => (c || '').toLowerCase())
  const joined = cats.join(' | ')
  for (const [type, test] of TYPE_PRIORITY) {
    if (!test(joined)) continue
    if (type === 'Vet' && !clinicalSignal(cats)) continue
    return type
  }
  for (const [re, type] of TYPE_BY_NAME) if (re.test(name || '')) return type
  return null   // not a pet business — a scrape false positive
}

// One call for the importer and the backfill, so they cannot disagree.
export function classify(categories = [], name = '') {
  const excluded = exclusionReason(categories, name)
  if (excluded) return { excluded, type: null, services: [], specializations: [] }

  const type = deriveType(categories, name)
  // A row we aren't listing gets no tags either. Otherwise a human oncology
  // centre caught by the "pet cancer treatment" search would carry a tidy
  // Oncology specialisation, ready for someone to wonder why it's not showing.
  if (!type) return { excluded: null, type: null, services: [], specializations: [] }

  return {
    excluded: null,
    type,
    services: deriveServices(categories),
    specializations: deriveSpecializations(categories, name),
  }
}
