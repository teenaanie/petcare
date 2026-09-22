// scripts/check-drift.mjs
//
//   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/check-drift.mjs
//
// Reports where the directory's types have drifted out of step with the data
// they were derived from.
//
// THE PROBLEM. `categories` is a snapshot of what Google said on the day the
// business was scraped, and `type` is derived from `categories[0]`. Businesses
// edit their listings. When one does, the row goes stale and nothing notices —
// a pet parent looking for a vet simply does not find a clinic that is filed as
// a shop. Seven rows were found in exactly that state on 2026-09-22.
//
// WHAT THIS CAN AND CANNOT DO. Live drift is only detectable by re-reading
// Google, which costs money and is not this script's job. What IS detectable
// for free is every row where the stored type and the stored categories
// disagree — and, crucially, WHICH WAY that disagreement points:
//
//   · verified more recently than synced  ->  the TYPE is right and the
//                                             CATEGORIES are stale. Re-scrape.
//   · never verified, and they disagree   ->  the TYPE is suspect. Review.
//
// Before `type_verified_at` existed those two were indistinguishable, which is
// why re-running the reclassifier would have reverted eight verified clinics.
//
// Age is reported separately, because an old row is not a wrong row — it is
// only an unchecked one, and saying otherwise would be inventing a problem.

import { classify } from '../src/lib/taxonomy.js'

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the publishable one).')
  process.exit(2)
}

const STALE_DAYS = Number(process.env.STALE_DAYS || 180)

const res = await fetch(`${URL}/rest/v1/rpc/search_providers`, {
  method: 'POST',
  headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    approved_only: true, filter_type: null, filter_area: null,
    search_term: null, page_limit: 100000, page_offset: 0,
  }),
})
if (!res.ok) { console.error(`Fetch failed: ${res.status} ${await res.text()}`); process.exit(1) }

const rows = (await res.json()).map(r => r.provider)
const days = d => d ? Math.floor((Date.now() - new Date(d)) / 86_400_000) : null

const categoriesStale = []   // type verified, categories now disagree
const typeSuspect = []       // never verified, and they disagree
const noCategories = []      // nothing to derive from at all
const stale = []             // simply old
let agree = 0

for (const p of rows) {
  const cats = p.categories || []
  const syncAge = days(p.categories_synced_at)
  if (syncAge === null || syncAge > STALE_DAYS) stale.push({ ...p, syncAge })

  if (!cats.length) { noCategories.push(p); continue }

  const c = classify(cats, p.name || '')
  if (c.excluded || !c.type) continue
  if (c.type === p.type) { agree++; continue }

  const verifiedAfterSync = p.type_verified_at &&
    (!p.categories_synced_at || new Date(p.type_verified_at) > new Date(p.categories_synced_at))

  ;(verifiedAfterSync ? categoriesStale : typeSuspect)
    .push({ ...p, derived: c.type, primary: cats[0] })
}

const line = p => `  ${String(p.type).padEnd(8)} vs ${String(p.derived).padEnd(8)} ` +
                  `primary "${p.primary}"`.padEnd(38) + ` ${(p.name || '').slice(0, 44)}`

console.log(`Checked ${rows.length} approved providers. Stale threshold: ${STALE_DAYS} days.\n`)
console.log(`  type agrees with categories   ${agree}`)
console.log(`  categories stale (re-scrape)  ${categoriesStale.length}`)
console.log(`  type suspect (review)         ${typeSuspect.length}`)
console.log(`  no categories at all          ${noCategories.length}`)
console.log(`  not synced in ${STALE_DAYS}+ days      ${stale.length}\n`)

if (categoriesStale.length) {
  console.log('── Categories are stale: the type was verified against the live listing ──')
  console.log('   These are NOT errors. Google was re-read and disagreed with what we stored.')
  for (const p of categoriesStale) console.log(line(p))
  console.log()
}

if (typeSuspect.length) {
  console.log('── Type is suspect: never verified, and it disagrees with its categories ──')
  console.log('   Each needs evidence before anything is changed. Do not bulk-apply.')
  for (const p of typeSuspect) console.log(line(p))
  console.log()
}

if (noCategories.length) {
  console.log('── No categories: type cannot be derived or checked ──')
  for (const p of noCategories) console.log(`  ${String(p.type).padEnd(8)} ${(p.name || '').slice(0, 56)}`)
  console.log()
}

if (stale.length) {
  const oldest = stale.filter(p => p.syncAge !== null).sort((a, b) => b.syncAge - a.syncAge)[0]
  console.log(`── Age ──`)
  console.log(`   ${stale.length} row(s) have not been re-read from the source in ${STALE_DAYS}+ days` +
              (oldest ? ` (oldest: ${oldest.syncAge} days)` : ''))
  console.log('   Old is not wrong — only unchecked. Nothing here needs action on its own.\n')
}

// Only a suspect type is a finding. Stale categories are already explained, and
// age is information. Exiting non-zero on either would make this cry wolf every
// run and get ignored, which is how a check stops working.
if (typeSuspect.length) {
  console.log(`${typeSuspect.length} type(s) need review.`)
  process.exit(1)
}
console.log('No unexplained disagreements.')
