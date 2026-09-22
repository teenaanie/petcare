// scripts/check-exclusions.mjs
//
//   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/check-exclusions.mjs
//
// Runs exclusionReason() over every provider in the directory and prints what
// it would drop, grouped by reason.
//
// The point is the FALSE POSITIVES. Every exclusion rule here is a regex over
// third-party category labels, and the failure that matters is not "a preschool
// slipped through" — it is "a real boarder got silently hidden and a pet parent
// can no longer find it". That failure is invisible from the app: the row just
// stops existing.
//
// So read the output as a diff, not a list. Anything you do not recognise is
// the thing to look at, and any row marked STILL APPROVED is a disagreement
// between the taxonomy and the database that somebody has to settle.
//
// This uses the publishable key and the same RPC the app calls, so it needs no
// special access and cannot write anything.

import { exclusionReason } from '../src/lib/taxonomy.js'

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the publishable one).')
  process.exit(2)
}

const res = await fetch(`${URL}/rest/v1/rpc/search_providers`, {
  method: 'POST',
  headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    approved_only: false, filter_type: null, filter_area: null,
    search_term: null, page_limit: 100000, page_offset: 0,
  }),
})
if (!res.ok) {
  console.error(`Fetch failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}

const rows = (await res.json()).map(r => r.provider)
console.log(`Checked ${rows.length} providers.\n`)

const byReason = {}
for (const p of rows) {
  const reason = exclusionReason(p.categories || [], p.name || '')
  if (reason) (byReason[reason] ??= []).push(p)
}

let disagreements = 0
for (const [reason, list] of Object.entries(byReason).sort()) {
  console.log(`── ${reason} (${list.length}) ──`)
  for (const p of list) {
    if (p.is_approved) disagreements++
    console.log(`   ${p.is_approved ? 'STILL APPROVED ->' : 'hidden           '} ` +
                `${(p.name || '').slice(0, 62)}  [${p.type}]`)
  }
  console.log()
}

console.log(disagreements === 0
  ? 'Taxonomy and database agree: every excluded provider is already hidden.'
  : `${disagreements} provider(s) the taxonomy excludes are still approved — review them.`)
