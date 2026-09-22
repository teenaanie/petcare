// scripts/import-providers.mjs
// Transforms an Apify Google Maps scrape into provider rows and upserts them.
//
//   node scripts/import-providers.mjs <path-to-json> [--dry-run] [--limit N]
//
// Idempotent: upserts on place_id, so re-running updates rows instead of
// duplicating them. Reads SUPABASE_URL / SUPABASE_SERVICE_KEY from .env.

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { classify } from '../src/lib/taxonomy.js'

// ── Load .env (no dotenv dependency) ─────────────────────────────────────────
// .env is optional — the variables may already be in the environment.
try {
  for (const line of fs.readFileSync(path.resolve('.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch { /* fall through to the check below */ }

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}

// ── Classification ───────────────────────────────────────────────────────────
// The rules live in src/lib/taxonomy.js, shared with
// scripts/reclassify-providers.mjs, so a row imported today is classified
// exactly like a row already in the table.
//
// This used to be a list of regexes tested in order, first match wins. That
// made `type` a function of rule ordering rather than of the business: a dog
// walker who also boarded became a Boarder because Boarder was tested first,
// and 40 walkers ended up spread across four different types. Now a business
// gets one type for the tabs plus a `services` array carrying everything it
// actually does.

// ── Neighborhood → area ──────────────────────────────────────────────────────
// Raw values look like "Kausar Baugh, Kondhwa" or "Paud Road, Right Bhusari
// Colony, Kothrud" — the last segment is the recognisable locality.
// A trailing fragment like "at" in "Autadwadi Handewadi, Laxmi Nagar, at" is
// noise, so walk backwards to the last segment that reads like a real locality.
const JUNK_SEGMENT = /^(at|no|near|opp|opposite|behind|next to|beside|above)$/i

function normalizeArea(record) {
  const raw = (record.neighborhood || '').trim()
  if (!raw) return null
  const segments = raw.split(',').map(s => s.trim()).filter(Boolean)

  for (let i = segments.length - 1; i >= 0; i--) {
    const cleaned = segments[i].replace(/\b(rd|road|gaon)$/i, '').trim()
    if (!cleaned || cleaned.length < 3 || JUNK_SEGMENT.test(cleaned)) continue
    return cleaned.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1))
  }
  return null
}

function formatHours(record) {
  if (!Array.isArray(record.openingHours) || !record.openingHours.length) return null
  const byHours = new Map()
  for (const { day, hours } of record.openingHours) {
    if (!day || !hours) continue
    if (!byHours.has(hours)) byHours.set(hours, [])
    byHours.get(hours).push(day.slice(0, 3))
  }
  return [...byHours.entries()].map(([hours, days]) => `${days.join(', ')}: ${hours}`).join(' · ').slice(0, 300) || null
}

const clean = (value, max) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function toProvider(record) {
  if (record.permanentlyClosed || record.temporarilyClosed) return null

  const name = clean(record.title, 120)
  if (!name) return null

  const { excluded, type, services, specializations } = classify(record.categories || [], name)
  // Breeders and veterinary colleges are not listed. A scrape for "pet cancer
  // treatment" also returns human oncologists and dental clinics — those come
  // back with no type at all and are dropped here.
  if (excluded || !type) return null

  const phone = clean(record.phone, 30) || clean(record.phoneUnformatted, 30)

  return {
    name,
    type,
    area:          normalizeArea(record),
    city:          clean(record.city, 200) || 'Pune',
    address:       clean(record.address, 400),
    postal_code:   clean(record.postalCode, 20),
    phone,
    whatsapp:      clean(record.phoneUnformatted, 30),
    website:       clean(record.website, 500),
    hours:         formatHours(record),
    // photo_url, rating and reviews_count are deliberately NOT taken from the
    // scrape. They are Google's content, collected without a licence to
    // republish, and the image URLs are hotlinks into Google's CDN that expire.
    // A provider photo now only comes from a business that supplied its own.
    photo_url:     null,
    maps_url:      clean(record.url, 800),
    description:   clean(record.description, 500),
    rating:        null,
    reviews_count: null,
    lat:           record.location?.lat ?? null,
    lng:           record.location?.lng ?? null,
    categories:    Array.isArray(record.categories) ? record.categories.slice(0, 12) : null,
    services,
    specializations,
    place_id:      clean(record.placeId, 200),
    source:        'google_maps',
    is_approved:   true,
    // When these categories were read from Google. Everything derived from
    // them -- type, services, specializations -- is only as current as this.
    categories_synced_at: new Date().toISOString(),
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2)
const file    = args.find(a => !a.startsWith('--'))
const dryRun  = args.includes('--dry-run')
const limitAt = args.indexOf('--limit')
const limit   = limitAt !== -1 ? parseInt(args[limitAt + 1], 10) : null

if (!file) {
  console.error('Usage: node scripts/import-providers.mjs <path-to-json> [--dry-run] [--limit N]')
  process.exit(1)
}

const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
console.log(`Read ${raw.length} scraped records from ${file}`)

const rows = []
const skipped = {}
for (const record of raw) {
  const provider = toProvider(record)
  if (provider) { rows.push(provider); continue }

  let reason
  if (record.permanentlyClosed || record.temporarilyClosed) reason = 'closed'
  else if (!clean(record.title, 120)) reason = 'no name'
  else {
    const c = classify(record.categories || [], record.title || '')
    reason = c.excluded ? `excluded: ${c.excluded}` : `not a pet business (${record.categoryName || 'uncategorised'})`
  }
  skipped[reason] = (skipped[reason] || 0) + 1
}

// Last one wins on duplicate place_id — Postgres rejects a batch that targets
// the same conflict key twice.
const deduped = [...new Map(rows.filter(r => r.place_id).map(r => [r.place_id, r])).values()]
const noPlaceId = rows.filter(r => !r.place_id)

const byType = {}
for (const r of deduped) byType[r.type] = (byType[r.type] || 0) + 1

console.log(`\nMapped ${rows.length} providers (${deduped.length} unique place_ids, ${noPlaceId.length} without)`)
console.log('By type:', byType)
console.log(`Skipped ${Object.values(skipped).reduce((a, b) => a + b, 0)} records`)
console.log('Top skip reasons:', Object.entries(skipped).sort((a, b) => b[1] - a[1]).slice(0, 8))

const toInsert = limit ? deduped.slice(0, limit) : deduped

if (dryRun) {
  console.log('\nSample row:')
  console.log(JSON.stringify(toInsert[0], null, 2))
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Matching incoming rows to existing ones ─────────────────────────────────
//
// place_id stays the primary key for this: Google's identifier is stable, and
// it is covered by a *partial* unique index (WHERE place_id IS NOT NULL) that
// ON CONFLICT can't target, so inserts and updates are split by hand.
//
// The gap it leaves: a provider added from a Maps lookup or by an admin has no
// place_id, and a later scrape of that same business DOES have one — so it
// would arrive looking brand new and the listing would appear twice. Four pet
// crematoria are in the directory in exactly that state.
//
// So when place_id doesn't match, fall back to the name. Carefully, because
// names are not identifiers:
//
//   · Only ever claim a row that has NO place_id of its own. A row already
//     carrying a different place_id is a different business that happens to
//     share a name.
//   · Require the same city, and where both have coordinates, require them to
//     be close. Pune has two businesses called "Dog Spot" — one in Baner, one
//     in Taljai — whose names match exactly.
//   · Require exactly one candidate. Two matches means we cannot tell which,
//     so insert and let a human see the duplicate rather than merge blind.
//
// Fuzzy matching is deliberately NOT used here. "Mahesh Pet Cremation Ground"
// against "Mahesh Pet Creamation Ground" — the same business with a typo —
// scores 0.74, and so does "Pets Spot - Baner" against "Pets Spot - Koregaon
// Park", which are two different shops. No threshold separates them, and a
// wrong merge silently overwrites one business's details with another's. A
// visible duplicate is the better failure.

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Rough metres between two lat/lng pairs — fine at city scale.
function metresApart(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null
  const dLat = (a.lat - b.lat) * 111_320
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos(a.lat * Math.PI / 180)
  return Math.hypot(dLat, dLng)
}
const SAME_PLACE_METRES = 400

let existingRows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('providers')
    .select('id, place_id, name, city, lat, lng, type, type_verified_at')
    .range(from, from + 999)
  if (error) { console.error('Failed to read existing providers:', error.message); process.exit(1) }
  existingRows = existingRows.concat(data)
  if (data.length < 1000) break
}

// Rows whose type somebody checked against the live listing. A scrape must not
// silently undo that: Google's stored primary category is exactly what was
// found to be wrong, so re-deriving from it would put the error straight back.
// Clear type_verified_at on a row to let the importer own its type again.
const verifiedTypeByPlaceId = new Map(
  existingRows.filter(r => r.type_verified_at && r.place_id).map(r => [r.place_id, r.type]))
const verifiedTypeById = new Map(
  existingRows.filter(r => r.type_verified_at).map(r => [r.id, r.type]))

const byPlaceId = new Set(existingRows.filter(r => r.place_id).map(r => r.place_id))
const unclaimed = new Map()   // normalised name → rows with no place_id
for (const r of existingRows.filter(r => !r.place_id)) {
  const k = norm(r.name)
  if (!unclaimed.has(k)) unclaimed.set(k, [])
  unclaimed.get(k).push(r)
}
console.log(`\n${byPlaceId.size} providers already imported, ${existingRows.length - byPlaceId.size} without a place_id`)

const fresh = [], updates = [], claims = [], ambiguous = []
const claimedIds = new Set()

for (const row of toInsert) {
  if (byPlaceId.has(row.place_id)) { updates.push(row); continue }

  const candidates = (unclaimed.get(norm(row.name)) || [])
    .filter(c => !claimedIds.has(c.id))
    .filter(c => norm(c.city) === norm(row.city))
    .filter(c => {
      const d = metresApart({ lat: c.lat, lng: c.lng }, { lat: row.lat, lng: row.lng })
      return d === null || d <= SAME_PLACE_METRES   // no coords to compare on = allow
    })

  if (candidates.length === 1) {
    claimedIds.add(candidates[0].id)
    claims.push({ row, target: candidates[0] })
  } else {
    if (candidates.length > 1) ambiguous.push({ row, count: candidates.length })
    fresh.push(row)
  }
}

if (claims.length) {
  console.log(`\n${claims.length} existing row(s) matched by name and will be updated rather than duplicated:`)
  for (const { row, target } of claims) console.log(`  · ${row.name.slice(0, 60)}`)
}
if (ambiguous.length) {
  console.log(`\n${ambiguous.length} incoming row(s) matched MORE THAN ONE existing row by name — inserting rather than guessing:`)
  for (const a of ambiguous) console.log(`  · ${a.row.name.slice(0, 60)} (${a.count} candidates)`)
}

if (dryRun) {
  console.log('\n--dry-run — nothing written.')
  console.log(`  would insert          : ${fresh.length}`)
  console.log(`  would update by place_id: ${updates.length}`)
  console.log(`  would claim by name   : ${claims.length}`)
  process.exit(0)
}

const BATCH = 100
let done = 0
for (let i = 0; i < fresh.length; i += BATCH) {
  const batch = fresh.slice(i, i + BATCH)
  const { error } = await supabase.from('providers').insert(batch)
  if (error) {
    console.error(`\nInsert batch ${i / BATCH + 1} failed:`, error.message)
    process.exit(1)
  }
  done += batch.length
  process.stdout.write(`\rInserted ${done}/${fresh.length}`)
}

let updated = 0, typePreserved = 0
for (const row of updates) {
  const { place_id, ...fields } = row
  if (verifiedTypeByPlaceId.has(place_id)) {
    fields.type = verifiedTypeByPlaceId.get(place_id)
    typePreserved++
  }
  const { error } = await supabase.from('providers').update(fields).eq('place_id', place_id)
  if (error) { console.error(`\nUpdate failed for ${place_id}:`, error.message); process.exit(1) }
  updated++
  process.stdout.write(`\rUpdated ${updated}/${updates.length}`)
}

// Claiming a row means writing the scraped data over it AND giving it the
// place_id, so every later import matches it the fast, certain way.
let claimed = 0
for (const { row, target } of claims) {
  const fields = verifiedTypeById.has(target.id)
    ? { ...row, type: verifiedTypeById.get(target.id) }
    : row
  if (fields !== row) typePreserved++
  const { error } = await supabase.from('providers').update(fields).eq('id', target.id)
  if (error) { console.error(`\nClaim failed for ${row.name}:`, error.message); process.exit(1) }
  claimed++
  process.stdout.write(`\rClaimed ${claimed}/${claims.length}`)
}

console.log(`\nDone — ${done} inserted, ${updated} updated, ${claimed} matched by name.`)
if (typePreserved) {
  console.log(`${typePreserved} row(s) kept a verified type instead of the scraped one. ` +
              `Their stored categories have just been refreshed, so run ` +
              `\`npm run check:drift\` — a verified type that now AGREES with the new ` +
              `categories no longer needs protecting, and one that still disagrees is ` +
              `either a listing Google has not fixed or a verification worth revisiting.`)
}
