// scripts/reclassify-providers.mjs
// Re-types existing providers and backfills services / specializations from the
// Google categories already stored on each row.
//
//   node scripts/reclassify-providers.mjs           # dry run — changes nothing
//   node scripts/reclassify-providers.mjs --apply
//
// The rules come from src/lib/taxonomy.js, the same module the importer uses,
// so a row imported tomorrow is classified exactly like a row fixed today.
//
// Excluded businesses are HIDDEN (is_approved = false), not deleted. They drop
// out of the directory because getProviders() defaults to approvedOnly, they
// stay visible in Admin, and the decision is reversible — which matters for an
// irreversible operation on live rows.

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { classify } from '../src/lib/taxonomy.js'

// .env is optional — the variables may already be in the environment (CI, or
// running from a git worktree, where .env lives in the main checkout).
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

const APPLY = process.argv.includes('--apply')
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const same = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i])

async function main() {
  let rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('providers')
      .select('id, name, type, categories, services, specializations, is_approved, ' +
              'type_verified_at, categories_synced_at')
      .range(from, from + 999)
    if (error) throw error
    rows = rows.concat(data)
    if (data.length < 1000) break
  }
  console.log(`${rows.length} providers loaded\n`)

  const retype = [], tag = [], hide = [], keptAsIs = [], protectedRows = []

  for (const p of rows) {
    const c = classify(p.categories || [], p.name || '')

    // A type somebody verified against the live listing outranks anything
    // re-derived from the stored categories -- because the stored categories
    // are precisely what was found to be wrong. Without this, re-running the
    // reclassifier silently reverts every correction: on 2026-09-22 that would
    // have been eight clinics going straight back to Store and Groomer.
    //
    // The protection only holds while the verification is NEWER than the
    // categories. Once a fresh scrape lands, the categories are the newer
    // evidence and the row is re-derived normally.
    const verifiedAfterSync = p.type_verified_at &&
      (!p.categories_synced_at || new Date(p.type_verified_at) > new Date(p.categories_synced_at))
    if (verifiedAfterSync && c.type && c.type !== p.type) {
      protectedRows.push({ ...p, wouldBe: c.type })
      continue
    }

    if (c.excluded) {
      if (p.is_approved !== false) hide.push({ ...p, reason: c.excluded })
      continue
    }
    // No usable signal: leave the row's existing type alone rather than
    // guessing. Someone chose it; we have nothing better to offer.
    if (!c.type) { keptAsIs.push(p); continue }

    if (c.type !== p.type) retype.push({ ...p, to: c.type })
    if (!same(c.services, p.services || []) || !same(c.specializations, p.specializations || [])) {
      tag.push({ ...p, services: c.services, specializations: c.specializations })
    }
  }

  if (protectedRows.length) {
    console.log('── Protected: verified type kept over the re-derived one ──')
    for (const p of protectedRows) {
      console.log(`  · ${p.name.slice(0, 52).padEnd(54)} ${p.type} (would re-derive as ${p.wouldBe})`)
    }
    console.log('  Clear type_verified_at on a row to let the reclassifier own its type again.\n')
  }

  const byMove = {}
  for (const r of retype) { const k = `${r.type} → ${r.to}`; byMove[k] = (byMove[k] || 0) + 1 }
  console.log('── Re-typing ──')
  for (const [k, v] of Object.entries(byMove).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
  console.log(`  ${String(retype.length).padStart(4)}  total\n`)

  console.log('── Hiding (is_approved = false, reversible) ──')
  for (const h of hide) console.log(`  · ${h.name.slice(0, 62).padEnd(64)} ${h.reason}`)
  console.log(`  ${hide.length} row(s)\n`)

  console.log('── Tagging ──')
  console.log(`  ${tag.length} row(s) get services / specializations`)
  console.log(`  ${keptAsIs.length} row(s) had no usable category signal — type left untouched\n`)

  if (!APPLY) {
    console.log('Dry run. Nothing was written. Re-run with --apply to commit.')
    return
  }

  let n = 0
  for (const r of retype) {
    const { error } = await db.from('providers').update({ type: r.to }).eq('id', r.id)
    if (error) throw error
    n++
  }
  console.log(`re-typed ${n}`)

  n = 0
  for (const r of tag) {
    const { error } = await db.from('providers')
      .update({ services: r.services, specializations: r.specializations }).eq('id', r.id)
    if (error) throw error
    n++
  }
  console.log(`tagged ${n}`)

  n = 0
  for (const h of hide) {
    const { error } = await db.from('providers').update({ is_approved: false }).eq('id', h.id)
    if (error) throw error
    n++
  }
  console.log(`hidden ${n}`)
  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
