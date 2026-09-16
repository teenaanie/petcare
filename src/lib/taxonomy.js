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
  'Pet Sitting', 'Pet Taxi', 'Adoption & Rescue', 'Photography', 'Dog Park',
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
  // A dog park in Pune is an amenity of a boarding facility, not a business of
  // its own: of 75 results for "dog park" and "pet park", exactly one leads
  // with the category and six carry it alongside boarding or training. So it
  // is a service, not a type — no tab for a category of one.
  'dog park':              'Dog Park',
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
  'Pet Sitting', 'Special Services', 'Pet Loss & Memorial Services',
]

// What a single Google category means, on its own.
//
// The AUTHORITY is categories[0] — Google's primary category, the one the
// business itself chose. It equals Apify's `categoryName` field 100% of the
// time (checked on 146 multi-category records) and it already agrees with 846
// of 968 rows in the directory.
//
// It replaced an ordered list of regexes where the first match won. That list
// made `type` a function of rule ordering rather than of the business: Pune
// Pet Park — a day-care park with nine categories, one of which is a pet
// cemetery — came out as a memorial service, because memorial was tested
// first. A rare category must never outrank the primary one.
const CATEGORY_TYPE = [
  [/pet cemetery|pet funeral|cremat|memorial|funeral|burial|cemeter/, 'Pet Loss & Memorial Services'],
  [/veterinarian|animal hospital|animal clinic|pet clinic|veterinary care/,          'Vet'],
  [/pet boarding service|cat boarding service|cattery|pet hostel|dog day care|day care center|kennel/, 'Boarder'],
  [/pet sitter/,                                                                      'Pet Sitting'],
  [/pet groomer|pet spa|grooming/,                                                    'Groomer'],
  [/dog trainer|pet trainer|obedience school/,                                        'Training'],
  [/dog walker/,                                                                      'Dog Walking'],
  // A pharmacy is a shop. "Veterinary pharmacy" matching the vet rule put 49
  // medicine shops in front of people looking for a clinic.
  [/pet store|pet supply|pet shop|aquarium|fish store|bird shop|animal feed|pet food|veterinary pharmacy|pharmacy|pharmaceutical company|health and beauty shop/, 'Store'],
  [/pet moving service/,                                                              'Special Services'],
  [/photographer|pet adoption service|animal shelter|animal rescue/,                  'Special Services'],
]

function typeForCategory(c) {
  const lc = (c || '').toLowerCase()
  for (const [re, t] of CATEGORY_TYPE) if (re.test(lc)) return t
  return null
}

// A pharmacy is a shop, not a clinic. "Veterinary pharmacy" matched the vet
// rule and put 49 medicine shops in front of people looking for a vet, so a
// pharmacy only counts as a Vet when it ALSO carries a real clinical category.
function clinicalSignal(cats) {
  return cats.some(c => /veterinarian|animal hospital|animal clinic|pet clinic|veterinary care/.test(c))
}

// Businesses we don't list at all.
// A human funeral business that lists pet funerals as a side-line is still a
// human funeral business, and does not belong in a pet directory. Google's
// "Pet funeral service" category alone does not settle it — Anthyesti carries
// that label and its own site is entirely about human last rites.
//
// What does settle it: the trade categories only a human undertaker has.
// Nobody cremating a dog needs a mortuary, a coffin supplier or a funeral
// director. Checked against every memorial business found in Pune, this
// separates the four genuine pet crematoria from the three human funeral homes
// with no false calls either way.
const HUMAN_FUNERAL_TRADE = /funeral home|funeral director|funeral celebrant|mortuary|coffin supplier/

// The second half of the problem. "Cremation service" and "Cemetery" are the
// categories Google gives a municipal crematorium AND a pet one — Balewadi
// smashanbhumi and PMC Pet crematorium are both plain "Cremation service".
// Nothing in the categories separates them, so a business carrying only those
// has to say "pet" somewhere in its name to count as one. A pet-specific
// category ("Pet cemetery", "Pet funeral service") settles it on its own.
const GENERIC_DEATH_CARE = /^(cremation service|cemetery|funeral)/
const PET_DEATH_CARE     = /pet cemetery|pet funeral|pet cremation/
const PET_WORD           = /\bpets?\b|\banimal|\bdog|\bcat\b|\bpaw/i

function humanDeathCare(cats, name) {
  const joined = cats.join(' | ')
  if (PET_DEATH_CARE.test(joined)) return false              // explicitly a pet service
  if (!cats.some(c => GENERIC_DEATH_CARE.test(c))) return false
  return !PET_WORD.test(name || '')                          // generic, and the name never says pet
}

const EXCLUDE = [
  [/dog breeder|cat breeder/, 'breeder'],
  [/training center/,         'training institute'],   // veterinary colleges, not pet services
  [/seafood market|poultry store|agricultural service|pond fish supplier/, 'not a pet business'],
  [HUMAN_FUNERAL_TRADE,       'human funeral service'],
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

  if (humanDeathCare(cats, name)) return 'human funeral service'
  for (const [re, reason] of EXCLUDE) {
    if (!re.test(joined)) continue
    // No rescue for human undertakers. The others are rescued when the business
    // plainly does something else too — "Pets Hangover Pet Resort and Dog Park"
    // carries a Training center category and would otherwise be thrown out as a
    // veterinary college — but a funeral home that also stocks a shop, or runs
    // an ambulance, is still a funeral home.
    if (reason === 'human funeral service') return reason

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
  const cats = categories.filter(Boolean)

  // 1. Google's primary category. The business chose it; trust it.
  const primary = typeForCategory(cats[0])
  if (primary) {
    // One exception: a pharmacy that also carries a real clinical category is
    // a clinic with a dispensary, not a shop.
    if (primary === 'Store' && /pharmacy/i.test(cats[0]) && clinicalSignal(cats.map(c => c.toLowerCase()))) return 'Vet'
    return primary
  }

  // 2. Primary said nothing we understand — the most common answer among the
  //    remaining categories, first-listed breaking ties (Google orders them by
  //    relevance, so an earlier one is a stronger claim).
  const tally = new Map()
  for (const c of cats.slice(1)) {
    const t = typeForCategory(c)
    if (t) tally.set(t, (tally.get(t) || 0) + 1)
  }
  if (tally.size) {
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
    if (best !== 'Vet' || clinicalSignal(cats.map(c => c.toLowerCase()))) return best
  }

  // 3. Nothing in the categories. Fall back to the name.
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
