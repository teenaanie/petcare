// Working out which state and district a scraped business sits in.
//
// The directory held one city for its whole life, so the importer hard-coded
// `city: record.city || 'Pune'` and stored no state at all. Both become wrong
// the moment a second state arrives: a Kerala row with a missing city would
// import as Pune, and a row with no state is shown under *every* state,
// because the search deliberately does not hide NULL-state rows.
//
// So geography has to be derived properly, and where it cannot be derived it
// has to come back null and be reported -- never defaulted to somewhere
// plausible.
//
// What the four Pune scrapes on disk actually contain, measured rather than
// assumed (1,719 records):
//
//   * `state` is present in ONE of the four files and absent from the other
//     three. It cannot be relied on. Where present it is correct on all 1,108.
//   * `address` is present on 1,680 of 1,719 and always ends
//     "..., <District>, <State> <PIN>, India". Parsing the state out of it
//     agrees with the explicit `state` field on 1,108 of 1,108, with zero
//     disagreements, and yields "Maharashtra" on 1,718 of 1,719. The one
//     miss is an address that simply has no state in it.
//   * `city` is mangled on a handful: "SchoolPune, Pune", "Khadewadi, Pune",
//     "Bengaluru, Pune", "Pune, Pimpri-Chinchwad". The last comma segment is
//     the real city in every one of those cases.

// ── States and union territories ────────────────────────────────────────────
//
// Parsing the second-to-last address segment is a heuristic, and on one Pune
// record it returns "Road No. E". Validating against this list is what stops
// junk like that becoming a state. Anything not here comes back null.

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
]

// Spellings Google returns that are not the canonical name above.
//
// `keralam` is not a typo and not optional. Google Maps returns the Malayalam
// endonym for Kerala in both the `state` field and the address: 309 of the
// first 314 Ernakulam records came back "Keralam", and the other 5 had no
// address at all. Validating against the English name alone put the state at
// NULL on every single row, which in turn took the district down with it,
// because the district segment is only trusted when the state beside it
// parses. One missing alias cost 100% of a district's geography.
//
// Assume the same holds elsewhere and has simply not been measured: Tamil
// Nadu, Odisha and Puducherry all have spellings Google varies on.
const STATE_ALIASES = {
  'keralam': 'Kerala',
  'kerela': 'Kerala',
  'tamilnadu': 'Tamil Nadu',
  'orissa': 'Odisha',
  'pondicherry': 'Puducherry',
  'uttaranchal': 'Uttarakhand',
  'nct of delhi': 'Delhi',
  'national capital territory of delhi': 'Delhi',
  'new delhi': 'Delhi',
  'jammu & kashmir': 'Jammu and Kashmir',
  'andaman & nicobar islands': 'Andaman and Nicobar Islands',
}

const key = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const STATE_BY_KEY = new Map(INDIAN_STATES.map(s => [key(s), s]))

/** Canonical state name, or null if the value is not a state. */
export function canonicalState(value) {
  const k = key(value)
  if (!k) return null
  return STATE_BY_KEY.get(k) || STATE_ALIASES[k] || null
}

// ── City → district ─────────────────────────────────────────────────────────
//
// For most of India the city and the district share a name, so the default is
// to use the city. This table is only the cases where they differ, and it is
// deliberately short: a city that is NOT listed keeps its own name and gets
// reported for review rather than being quietly filed under a guess.
//
// District rather than city throughout, because Pimpri-Chinchwad is its own
// municipal corporation inside Pune district and somebody searching Pune
// expects to find it.
//
// Mumbai is a judgement call: it is officially two districts (Mumbai City and
// Mumbai Suburban), but nobody searches for either, so it stays "Mumbai".

const CITY_TO_DISTRICT = {
  // Maharashtra
  'pimpri-chinchwad': 'Pune', 'pimpri chinchwad': 'Pune', 'pimpri': 'Pune',
  'chinchwad': 'Pune', 'pcmc': 'Pune',
  'navi mumbai': 'Thane', 'kalyan': 'Thane', 'dombivli': 'Thane',
  'kalyan-dombivli': 'Thane', 'ulhasnagar': 'Thane', 'bhiwandi': 'Thane',
  'mira-bhayandar': 'Thane', 'mira bhayandar': 'Thane',
  'vasai': 'Palghar', 'virar': 'Palghar', 'vasai-virar': 'Palghar',
  'mumbai suburban': 'Mumbai', 'mumbai city': 'Mumbai',
  'pune city': 'Pune',

  // Kerala — the ones where city and district genuinely differ, plus the
  // colonial-era names Google still returns.
  'kochi': 'Ernakulam', 'cochin': 'Ernakulam', 'aluva': 'Ernakulam',
  'kalamassery': 'Ernakulam', 'perumbavoor': 'Ernakulam',
  'angamaly': 'Ernakulam', 'muvattupuzha': 'Ernakulam',
  'tripunithura': 'Ernakulam', 'thripunithura': 'Ernakulam',
  'kakkanad': 'Ernakulam', 'nedumbassery': 'Ernakulam',
  'edappally': 'Ernakulam', 'fort kochi': 'Ernakulam',
  'trivandrum': 'Thiruvananthapuram',
  'calicut': 'Kozhikode',
  'alleppey': 'Alappuzha', 'cherthala': 'Alappuzha',
  'trichur': 'Thrissur', 'guruvayur': 'Thrissur', 'guruvayoor': 'Thrissur',
  'chalakudy': 'Thrissur', 'irinjalakuda': 'Thrissur',
  'quilon': 'Kollam',
  'cannanore': 'Kannur', 'thalassery': 'Kannur', 'tellicherry': 'Kannur',
  'payyanur': 'Kannur',
  'palghat': 'Palakkad', 'ottapalam': 'Palakkad', 'shoranur': 'Palakkad',
  'kalpetta': 'Wayanad', 'sultan bathery': 'Wayanad',
  'sulthan bathery': 'Wayanad', 'mananthavady': 'Wayanad',
  'thodupuzha': 'Idukki', 'munnar': 'Idukki', 'adimali': 'Idukki',
  'changanassery': 'Kottayam', 'changanacherry': 'Kottayam',
  'pala': 'Kottayam', 'vaikom': 'Kottayam', 'ettumanoor': 'Kottayam',
  'thiruvalla': 'Pathanamthitta', 'tiruvalla': 'Pathanamthitta',
  'adoor': 'Pathanamthitta', 'pandalam': 'Pathanamthitta',
  'manjeri': 'Malappuram',
  'tirur': 'Malappuram', 'perinthalmanna': 'Malappuram',
  'kottakkal': 'Malappuram', 'kottakal': 'Malappuram',
  'kanhangad': 'Kasaragod', 'kasargod': 'Kasaragod', 'kasaragode': 'Kasaragod',
  'nileshwar': 'Kasaragod',
}

// ── Known districts ─────────────────────────────────────────────────────────
//
// The last line of defence, and the reason this file does not simply trust
// whatever Google put in `city`.
//
// Neither `city` nor the address reliably holds a district. Google frequently
// gives a locality instead -- "Baner", "Wagholi", "Khadki" -- or omits the
// district segment so that a street slides into its place. Measured on the
// 1,758 records on disk, trusting either source produced districts called
// "Passport Office", "City Pride Road" and "India".
//
// There is no way to tell a district from a suburb by shape, so a name is
// only accepted if it IS one. These are the districts of the two states the
// directory covers. A business in a third state resolves to null until that
// state is added here, which is the intended behaviour: an unfiled provider
// is recoverable, a misfiled one is not.

export const DISTRICTS_BY_STATE = {
  Maharashtra: [
    'Ahmednagar', 'Akola', 'Amravati', 'Beed', 'Bhandara', 'Buldhana',
    'Chandrapur', 'Chhatrapati Sambhajinagar', 'Dharashiv', 'Dhule',
    'Gadchiroli', 'Gondia', 'Hingoli', 'Jalgaon', 'Jalna', 'Kolhapur',
    'Latur', 'Mumbai', 'Nagpur', 'Nanded', 'Nandurbar', 'Nashik', 'Palghar',
    'Parbhani', 'Pune', 'Raigad', 'Ratnagiri', 'Sangli', 'Satara',
    'Sindhudurg', 'Solapur', 'Thane', 'Wardha', 'Washim', 'Yavatmal',
  ],
  Kerala: [
    'Alappuzha', 'Ernakulam', 'Idukki', 'Kannur', 'Kasaragod', 'Kollam',
    'Kottayam', 'Kozhikode', 'Malappuram', 'Palakkad', 'Pathanamthitta',
    'Thiruvananthapuram', 'Thrissur', 'Wayanad',
  ],
}

// Aurangabad and Osmanabad were renamed in 2023; Google still returns both.
const DISTRICT_ALIASES = {
  'aurangabad': 'Chhatrapati Sambhajinagar',
  'osmanabad': 'Dharashiv',
  'ahmadnagar': 'Ahmednagar',
  'ahilyanagar': 'Ahmednagar',
  'mumbai city': 'Mumbai',
  'mumbai suburban': 'Mumbai',
  'raigarh': 'Raigad',
  'buldana': 'Buldhana',
  'gondiya': 'Gondia',
  'trichur': 'Thrissur',
}

const DISTRICT_BY_KEY = new Map()
for (const list of Object.values(DISTRICTS_BY_STATE)) {
  for (const d of list) DISTRICT_BY_KEY.set(key(d), d)
}

/** Canonical district name, or null when the value is not a known district. */
export function canonicalDistrict(value) {
  const k = key(value)
  if (!k) return null
  return DISTRICT_BY_KEY.get(k) || DISTRICT_BY_KEY.get(key(DISTRICT_ALIASES[k])) || null
}

// Hyphens count as word boundaries, or "Pimpri-Chinchwad" comes back as
// "Pimpri-chinchwad" and stops matching the city table.
const titleCase = s => s.toLowerCase().replace(/[^\s-]+/g, w =>
  w[0].toUpperCase() + w.slice(1))

/**
 * The real city from a possibly mangled `city` value.
 *
 * Google returns things like "SchoolPune, Pune" and "Pune, Pimpri-Chinchwad".
 * The last comma segment is the city in every mangled case on disk.
 */
export function canonicalCity(value) {
  if (typeof value !== 'string') return null
  const segments = value.split(',').map(s => s.trim()).filter(Boolean)
  if (!segments.length) return null
  const last = segments[segments.length - 1]
  if (last.length < 2) return null
  return titleCase(last)
}

/**
 * District for a city name, or null.
 *
 * Two ways to succeed: the city is listed in CITY_TO_DISTRICT, or the name is
 * itself a known district. Anything else is a locality we cannot place, and
 * it returns null rather than becoming a district of its own.
 */
export function districtForCity(value) {
  const city = canonicalCity(value)
  if (!city) return null
  const mapped = CITY_TO_DISTRICT[key(city)]
  if (mapped) return mapped
  return canonicalDistrict(city)
}

// ── Pulling geography off a scraped record ──────────────────────────────────

/**
 * State from the record's own `state` field, falling back to the address.
 *
 * Addresses end "..., <District>, <State> <PIN>, India", so the state is the
 * segment before "India" with any PIN stripped. Validated against
 * INDIAN_STATES, so a malformed address yields null rather than nonsense.
 */
export function stateFromRecord(record) {
  const explicit = canonicalState(record?.state)
  if (explicit) return explicit

  const addr = record?.address
  if (typeof addr !== 'string') return null
  const segments = addr.split(',').map(s => s.trim()).filter(Boolean)
  let i = segments.length - 1
  if (i >= 0 && /^india$/i.test(segments[i])) i--
  if (i < 0) return null
  return canonicalState(segments[i].replace(/\s*\d{6}$/, '').trim())
}

/**
 * District from the address, falling back to `city`.
 *
 * The address is tried FIRST, and the order matters. An address holds the
 * district in a fixed structural position -- "..., Kondhwa, Pune,
 * Maharashtra 411048, India" -- whereas `city` is whatever Google had, which
 * on the Pune scrapes includes the localities "Khadki", "Kesnand" and
 * "Khadewadi".
 *
 * But that position is only trustworthy when the address really does carry a
 * recognised state. Many do not, and then the index slides inward and picks
 * up a street: reading the address unconditionally turned 3 bad districts
 * into 17, among them "Passport Office", "Road No. E" and "City Pride Road".
 * So the address is used only when its state segment was found, which is what
 * proves the shape; otherwise `city` is the better guess.
 */
export function districtFromRecord(record) {
  const addr = record?.address
  if (typeof addr === 'string') {
    const segments = addr.split(',').map(s => s.trim()).filter(Boolean)
    let i = segments.length - 1
    if (i >= 0 && /^india$/i.test(segments[i])) i--
    const bare = i >= 0 ? segments[i].replace(/\s*\d{6}$/, '').trim() : ''
    if (canonicalState(bare) && i >= 1) {
      const candidate = segments[i - 1].replace(/\s*\d{6}$/, '').trim()
      if (candidate.length >= 3 && !/\d/.test(candidate)) {
        const d = districtForCity(candidate)
        if (d) return d
      }
    }
  }
  return districtForCity(record?.city)
}
