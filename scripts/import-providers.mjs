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

// ── Load .env (no dotenv dependency) ─────────────────────────────────────────
for (const line of fs.readFileSync(path.resolve('.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}

// ── Category → provider type ─────────────────────────────────────────────────
// Order matters: first match wins, so the more specific services are tested
// before the catch-all "store" patterns.
const TYPE_RULES = [
  ['Pet Loss & Memorial Services', /cremat|memorial|funeral|burial/i],
  ['Vet',                          /veterinar|animal hospital|animal clinic|pet clinic/i],
  ['Groomer',                      /groom|pet spa/i],
  ['Boarder',                      /boarding|day care|daycare|cattery|pet sitter|kennel|pet hostel|pet resort/i],
  ['Special Services',             /trainer|training|walker|breeder|photograph|behaviou?r|adoption|shelter|rescue/i],
  ['Store',                        /pet store|pet supply|pet shop|aquarium|fish store|bird shop|animal feed|pet food/i],
]

function mapType(record) {
  const haystack = [record.categoryName, ...(record.categories || [])].filter(Boolean).join(' | ')
  for (const [type, re] of TYPE_RULES) if (re.test(haystack)) return type
  return null // not a pet provider — scrape false positive
}

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
  const type = mapType(record)
  if (!type) return null
  if (record.permanentlyClosed || record.temporarilyClosed) return null

  const name = clean(record.title, 120)
  if (!name) return null

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
    photo_url:     clean(record.imageUrl, 800),
    maps_url:      clean(record.url, 800),
    description:   clean(record.description, 500),
    rating:        typeof record.totalScore === 'number' ? record.totalScore : null,
    reviews_count: typeof record.reviewsCount === 'number' ? record.reviewsCount : null,
    lat:           record.location?.lat ?? null,
    lng:           record.location?.lng ?? null,
    categories:    Array.isArray(record.categories) ? record.categories.slice(0, 12) : null,
    place_id:      clean(record.placeId, 200),
    source:        'google_maps',
    is_approved:   true,
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
  if (provider) rows.push(provider)
  else {
    const reason = record.permanentlyClosed || record.temporarilyClosed ? 'closed' : (record.categoryName || 'uncategorised')
    skipped[reason] = (skipped[reason] || 0) + 1
  }
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
  console.log('\n--dry-run — nothing written. Sample row:')
  console.log(JSON.stringify(toInsert[0], null, 2))
  process.exit(0)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// place_id is covered by a *partial* unique index (WHERE place_id IS NOT NULL),
// which ON CONFLICT can't target — so split into inserts and updates by hand.
const existing = new Set()
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('providers').select('place_id').not('place_id', 'is', null).range(from, from + 999)
  if (error) { console.error('Failed to read existing providers:', error.message); process.exit(1) }
  data.forEach(r => existing.add(r.place_id))
  if (data.length < 1000) break
}
console.log(`\n${existing.size} providers already imported`)

const fresh   = toInsert.filter(r => !existing.has(r.place_id))
const updates = toInsert.filter(r => existing.has(r.place_id))

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

let updated = 0
for (const row of updates) {
  const { place_id, ...fields } = row
  const { error } = await supabase.from('providers').update(fields).eq('place_id', place_id)
  if (error) { console.error(`\nUpdate failed for ${place_id}:`, error.message); process.exit(1) }
  updated++
  process.stdout.write(`\rUpdated ${updated}/${updates.length}`)
}

console.log(`\nDone — ${done} inserted, ${updated} updated.`)
