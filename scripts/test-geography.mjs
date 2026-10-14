// Tests for src/lib/geography.js
//
// The address strings here are address SHAPES, not real businesses -- they
// exist to pin the parsing, and the Pune ones are copied from the scrapes on
// disk. Nothing here is a claim that a particular provider exists.

import {
  canonicalState, canonicalCity, canonicalDistrict, districtForCity,
  stateFromRecord, districtFromRecord, INDIAN_STATES, DISTRICTS_BY_STATE,
} from '../src/lib/geography.js'

let pass = 0, fail = 0
const eq = (label, got, want) => {
  if (got === want) { pass++; return }
  fail++
  console.log(`  FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

// ── canonicalState ──────────────────────────────────────────────────────────
eq('state exact', canonicalState('Keralam'), 'Keralam')
eq('state lowercase', canonicalState('keralam'), 'Keralam')
eq('state spaced', canonicalState('  Tamil   Nadu '), 'Tamil Nadu')
// Google Maps returns the Malayalam endonym for Kerala, in both the `state`
// field and the address. The first Ernakulam scrape came back "Keralam" on
// 309 of 314 records; without this alias every row's state was NULL, and the
// district went with it because it is only trusted beside a parsed state.
eq('Keralam is canonical', canonicalState('Keralam'), 'Keralam')
eq('Keralam lowercase', canonicalState('keralam'), 'Keralam')
eq('legacy Kerala maps forward', canonicalState('Kerala'), 'Keralam')
eq('misspelling kerela', canonicalState('Kerela'), 'Keralam')
eq('state tamilnadu no space', canonicalState('Tamilnadu'), 'Tamil Nadu')
eq('real Keralam address',
  stateFromRecord({ address: 'Sahodaran Ayyappan Rd, Kadavanthra, Ernakulam, Keralam 682020, India' }),
  'Keralam')
eq('real Keralam district',
  districtFromRecord({ address: 'NNRA-104, Perandoor Rd, Kaloor, Kochi, Ernakulam, Keralam 682017, India' }),
  'Ernakulam')
eq('Kochi in the district slot maps',
  districtFromRecord({ address: 'Seaport - Airport Rd, Kakkanad, Kochi, Keralam 682030, India' }),
  'Ernakulam')
// A panchayat where the district should be is still refused, not guessed.
eq('Ernakulam village is not a district',
  districtFromRecord({ address: 'Main Rd, Mulanthuruthy, Keralam 682314, India' }), null)
eq('state alias orissa', canonicalState('Orissa'), 'Odisha')
eq('state alias pondicherry', canonicalState('Pondicherry'), 'Puducherry')
eq('state alias delhi', canonicalState('NCT of Delhi'), 'Delhi')
eq('state junk', canonicalState('Road No. E'), null)
eq('state empty', canonicalState(''), null)
eq('state null', canonicalState(null), null)
eq('state is a district', canonicalState('Pune'), null)
eq('all 36 states round-trip',
  INDIAN_STATES.every(s => canonicalState(s) === s), true)

// ── canonicalCity ───────────────────────────────────────────────────────────
eq('city plain', canonicalCity('Pune'), 'Pune')
eq('city mangled prefix', canonicalCity('SchoolPune, Pune'), 'Pune')
eq('city mangled two', canonicalCity('Pune, Pimpri-Chinchwad'), 'Pimpri-Chinchwad')
eq('city cross-city', canonicalCity('Bengaluru, Pune'), 'Pune')
eq('city casing', canonicalCity('KOCHI'), 'Kochi')
eq('city null', canonicalCity(null), null)
eq('city empty', canonicalCity('  '), null)
eq('city single char', canonicalCity('A'), null)

// ── canonicalDistrict ───────────────────────────────────────────────────────
eq('district exact', canonicalDistrict('Ernakulam'), 'Ernakulam')
eq('district lowercase', canonicalDistrict('wayanad'), 'Wayanad')
eq('district renamed aurangabad',
  canonicalDistrict('Aurangabad'), 'Chhatrapati Sambhajinagar')
eq('district renamed osmanabad', canonicalDistrict('Osmanabad'), 'Dharashiv')
eq('district mumbai merged', canonicalDistrict('Mumbai Suburban'), 'Mumbai')
eq('district locality rejected', canonicalDistrict('Baner'), null)
eq('district street rejected', canonicalDistrict('City Pride Road'), null)
eq('district other state rejected', canonicalDistrict('Bengaluru'), null)
eq('all districts round-trip',
  Object.values(DISTRICTS_BY_STATE).flat().every(d => canonicalDistrict(d) === d), true)

// ── districtForCity ─────────────────────────────────────────────────────────
eq('city is its own district', districtForCity('Pune'), 'Pune')
eq('pimpri-chinchwad to pune', districtForCity('Pimpri-Chinchwad'), 'Pune')
eq('navi mumbai to thane', districtForCity('Navi Mumbai'), 'Thane')
eq('kochi to ernakulam', districtForCity('Kochi'), 'Ernakulam')
eq('cochin to ernakulam', districtForCity('Cochin'), 'Ernakulam')
eq('trivandrum canonicalised',
  districtForCity('Trivandrum'), 'Thiruvananthapuram')
eq('calicut to kozhikode', districtForCity('Calicut'), 'Kozhikode')
eq('alleppey to alappuzha', districtForCity('Alleppey'), 'Alappuzha')
eq('kalpetta to wayanad', districtForCity('Kalpetta'), 'Wayanad')
eq('thodupuzha to idukki', districtForCity('Thodupuzha'), 'Idukki')
eq('locality is not a district', districtForCity('Khadki'), null)
eq('locality wagholi', districtForCity('Wagholi'), null)
eq('locality baner', districtForCity('Baner'), null)

// ── stateFromRecord ─────────────────────────────────────────────────────────
const addrPune = 'Narayan Annaji Shinde Rd, Kondhwa, Pune, Maharashtra 411048, India'
eq('state from explicit field',
  stateFromRecord({ state: 'Maharashtra', address: addrPune }), 'Maharashtra')
eq('state from address', stateFromRecord({ address: addrPune }), 'Maharashtra')
eq('state from keralam address',
  stateFromRecord({ address: 'MG Rd, Ravipuram, Kochi, Keralam 682016, India' }),
  'Keralam')
eq('state no pin',
  stateFromRecord({ address: 'Some Rd, Kozhikode, Keralam, India' }), 'Keralam')
eq('state no india suffix',
  stateFromRecord({ address: 'Some Rd, Thrissur, Keralam 680001' }), 'Keralam')
eq('state explicit beats junk address',
  stateFromRecord({ state: 'Keralam', address: 'nonsense' }), 'Keralam')
eq('state junk address', stateFromRecord({ address: 'Road No. E' }), null)
eq('state no address', stateFromRecord({ city: 'Pune' }), null)
eq('state empty record', stateFromRecord({}), null)
eq('state undefined record', stateFromRecord(undefined), null)

// ── districtFromRecord ──────────────────────────────────────────────────────
eq('district from well-formed address',
  districtFromRecord({ address: addrPune }), 'Pune')
eq('district from keralam address',
  districtFromRecord({ address: 'MG Rd, Ravipuram, Ernakulam, Keralam 682016, India' }),
  'Ernakulam')
eq('district kochi in address maps',
  districtFromRecord({ address: 'MG Rd, Ravipuram, Kochi, Keralam 682016, India' }),
  'Ernakulam')
eq('district falls back to city',
  districtFromRecord({ city: 'Kochi', address: 'nonsense' }), 'Ernakulam')
// The regression this ordering exists for: Google omits the district and a
// locality sits where it should be. Neither source may invent a district.
eq('district locality in address, none in city',
  districtFromRecord({ city: 'Khadki', address: 'Old Rd, Khadki, Maharashtra 411003, India' }),
  null)
eq('district locality city, good address',
  districtFromRecord({ city: 'Wagholi', address: 'Nagar Rd, Wagholi, Pune, Maharashtra 412207, India' }),
  'Pune')
eq('district mangled city', districtFromRecord({ city: 'SchoolPune, Pune' }), 'Pune')
eq('district pcmc city', districtFromRecord({ city: 'Pune, Pimpri-Chinchwad' }), 'Pune')
eq('district unknown state null',
  districtFromRecord({ address: 'X Rd, Bengaluru, Karnataka 560001, India' }), null)
eq('district empty record', districtFromRecord({}), null)
eq('district undefined', districtFromRecord(undefined), null)

// A state must never be mistaken for a district, or vice versa.
eq('no name is both state and district',
  INDIAN_STATES.filter(s => canonicalDistrict(s)).length, 0)

console.log(`\ngeography: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
