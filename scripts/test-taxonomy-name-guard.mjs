// The name fallback must not turn a human business into a pet provider.
//
// deriveType's last resort is the business name: a name containing "salon",
// "resort", "clinic" or "shop" picks a type when the categories said nothing
// we recognise. Every one of those is a word an ordinary human business uses
// about itself, so without a guard the fallback invents pet businesses.
//
// Found live: "Groom Salon & Spa" in Kochi -- categories Beauty salon and
// Make-up artist, 105 reviews about haircuts at Rs 1-200 -- classified as a
// Groomer and would have been published as one.

import { classify, deriveType } from '../src/lib/taxonomy.js'

let pass = 0, fail = 0
const eq = (label, got, want) => {
  if (got === want) { pass++; return }
  fail++
  console.log(`  FAIL ${label}\n       got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}
const type = (cats, name) => classify(cats, name).type

// ── Human businesses the fallback used to claim ─────────────────────────────
eq('the Kochi beauty parlour', type(['Beauty salon', 'Make-up artist'], 'Groom Salon & Spa'), null)
eq('a named salon chain',      type(['Beauty salon'], 'Lakme Salon'), null)
eq('a spa',                    type(['Spa'], 'Anura Wellness Spa & Salon'), null)
eq('a massage centre',         type(['Spa', 'Massage spa'], 'Sukun Spa Massage Centre'), null)
eq('a car wash called a spa',  type(['Car wash', 'Auto body shop'], 'Exoticar Spa'), null)
eq('a dental clinic',          type(['Dental clinic'], 'Ameya Dental Clinic'), null)
eq("a children's clinic",      type(['Pediatric clinic'], "Vatsalya Children's Clinic"), null)
eq('an eye hospital',          type(['Eye care center'], 'RCM Eye Hospital'), null)
eq('an oncologist',            type(['Oncologist', 'Cancer treatment center'], 'Dr. Reshma Puranik - Best Oncologist in Pune'), null)
eq('a maternity hospital',     type(['Hospital', 'Birth center'], 'Umarji Mother and Child Care Hospital'), null)
eq('a human GP',               type(['Medical clinic'], 'UR Family Clinic'), null)
eq('an ayurveda hospital',     type(['Hospital', 'Alternative medicine clinic'], 'Ayurveda Hospital in Ernakulam, Kochi | Apollo AyurVAID'), null)
eq('a hypermarket',            type(['Hypermarket'], "D'Mart"), null)
eq('a grocery',                type(['Grocery store'], 'Puneri Fresh Mart'), null)
eq('a hardware store',         type(['Hardware store'], 'Central Hardware Mart (Pune)'), null)
eq('a resort hotel',           type(['Resort hotel', 'Bar', 'Restaurant'], 'Ambrosia Resort and Spa'), null)
eq('a backpacker hostel',      type(['Hostel', 'Cafe', 'Coworking space'], 'The Voyage | Cafe | Hostel | Co-work'), null)
eq('a vegan restaurant',       type(['Health food restaurant', 'Vegan restaurant'], 'Sante Spa Cuisine'), null)

// ── Real pet businesses must still be caught ────────────────────────────────
eq('pet word + resort',   type(['Farm'], 'KAILASAM PET RESORT (NO ADOPTION OR RESCUE)'), 'Boarder')
eq('veterinary + hospital', type(['Hospital'], 'Pancode Government Veterinary Hospital'), 'Vet')
eq('paws + salon',        type(['Beauty salon'], 'Paws & Claws Grooming Salon'), 'Groomer')
eq('compound pet + spa',  type([], 'PETSHALA SPA STUDIO'), 'Groomer')
eq('dog + hostel',        type([], 'Shravan Dog & cat Hostel'), 'Boarder')
eq('aquarium + shop',     type([], 'Fins n Tails Aquarium Shop'), 'Store')
eq('k9 + boarding',       type([], 'K9 Boarding Kennels'), 'Boarder')
eq('furry + store',       type([], 'Furry Friends Pet Store'), 'Store')

// ── The guard must not fire on its own ──────────────────────────────────────
// A pet word with no trade word is still nothing: the fallback needs both.
eq('pet word, no trade word', type([], 'Doggieland'), null)
eq('neither',                 type([], 'Green Valley Farm'), null)

// ── Categories always win over the name ─────────────────────────────────────
// The guard sits in step 3 only; a real pet category must still decide first.
eq('category beats a missing pet word', type(['Pet groomer'], 'Anita Enterprises'), 'Groomer')
eq('category beats everything',         type(['Veterinarian'], 'XYZ'), 'Vet')
eq('deriveType agrees with classify',
  deriveType(['Beauty salon'], 'Lakme Salon'), null)

// ── False friends the stems must not match ──────────────────────────────────
eq('catering is not cat',   type(['Caterer'], 'Royal Catering Hall'), null)
eq('velvet is not vet',     type(['Clothing store'], 'Velvet Touch Clinic'), null)
eq('retail is not tail',    type(['Shopping mall'], 'Retail Mart'), null)
eq('furniture is not fur',  type(['Furniture store'], 'Furniture Mart'), null)
eq('Peter is not pet',      type(['Beauty salon'], "Peter's Salon"), null)

// ── A veterinary facility is a Vet, not a shop ──────────────────────────────
// Kerala's government veterinary network is filed by Google under
// "Veterinary pharmacy", which maps to Store. These treat animals.
eq('veterinary sub centre',   type(['Veterinary pharmacy'], 'Veterinary Sub Centre Uzhavoor East'), 'Vet')
eq('veterinary dispensary',   type(['Veterinary pharmacy'], 'Veterinary Dispensary'), 'Vet')
eq('dispensary, no home primary', type(['Hospital', 'Veterinary pharmacy'], 'VETERINARY DISPENSARY, MARAD'), 'Vet')
eq('govt veterinary hospital', type(['Veterinary pharmacy'], 'Government Veterinary hospital Thottappally'), 'Vet')
eq('govt veterinary clinic',   type(['Veterinary pharmacy'], 'Govt Veterinary Clinic Mukkoottuthara'), 'Vet')
eq('filed as a government office', type(['Government office'], 'Veterinary Dispensary Kallara'), 'Vet')

// ...but a shop that sells veterinary medicine is still a shop.
eq('veterinary medical store', type(['Veterinary pharmacy'], 'PAT 4 PETS VETERINARY MEDICAL STORE'), 'Store')
eq('veterinary medicals',      type(['Veterinary pharmacy'], 'Pet Land Veterinary Medicals'), 'Store')
eq('central veterinary store', type(['Government office'], 'Central Veterinary Store, Thiruvananthapuram'), 'Store')
eq('pet foods and products',   type(['Pet store'], 'Viswas Pet Foods & Veterinary Products'), 'Store')
eq('surgicals supplier',       type(['Veterinary pharmacy'], 'Janasevana surgicals & Veterinary'), 'Store')
eq('medicals and pet shop',    type(['Veterinary pharmacy'], 'Pet Me veterinary medicals & pet shop'), 'Store')

// A human hospital must not be swept up by the facility rule.
eq('human hospital, no animal word', type(['Hospital'], 'Yogesh Hospital'), null)
// A human dispensary still becomes a Store, via the settled "Pharmacy maps
// to Store" decision at authority 1 -- that predates this guard and is not
// its business. What matters here is that it must not become a Vet: the
// facility rule needs an animal word and this has none.
eq('human dispensary is not a Vet', type(['Pharmacy'], 'City Dispensary'), 'Store')
eq('human sub centre is not a Vet', type(['Hospital'], 'Primary Health Sub Centre'), null)

console.log(`\ntaxonomy name guard: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
