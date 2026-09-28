// src/lib/petMeds.js
//
// The vocabulary of vaccines and medicines, so transcription stops mangling it.
//
// WHERE THIS LIST COMES FROM, AND WHY THAT MATTERS
// Every entry below was read from names already recorded in this app's own
// database on 2026-09-28 — 37 distinct ones, most captured by the document
// scanner from printed vet paperwork, so the spelling came off a label rather
// than out of anyone's memory. Nothing here is recalled or guessed. A drug name
// invented from memory would end up in a record a vet reads, which is the one
// place a plausible-sounding mistake does real harm.
//
// To add to it: take the name from a scanned document, a product pack, or a
// manufacturer's own page — not from what a model thinks a product is called.
// The list also grows by itself: see learnedNames() below.
//
// WHAT IT IS USED FOR — two things, both safe:
//   1. Biasing Whisper. The transcription API takes a `prompt` of expected
//      terms, which makes it spell "Nobivac" instead of "no bee back". It
//      biases; it does not constrain, so a name outside the list still comes
//      through as whatever was heard.
//   2. A "did you mean" on the review screen, via src/lib/fuzzy.js.
//
// WHAT IT IS DELIBERATELY NOT USED FOR: silently rewriting what the owner said.
// A suggestion the human accepts is safe. An automatic correction from Felocell
// to some other vaccine is a wrong record with nobody in the loop.

import { fuzzyScore } from './fuzzy.js'

// ── Observed vaccine names ───────────────────────────────────────────────────
// Case variants of ONE product are folded together (Nobivac DHPPi / DHPPI are
// the same words typed differently). Products that differ in valency are NOT —
// `Felocell` and `Felocell 3` are listed separately on purpose, because they
// may be different products and merging them would silently change a record.
export const VACCINES = [
  'Nobivac', 'Nobivac DHPPi', 'Nobivac DHPPiL', 'Nobivac RL', 'Nobivac rabies vaccine',
  'Felocell', 'Felocell 3',
  'Rabisin', 'Antirab', 'Antirabies vaccine',
  'Canigen', 'Canigen DHPPI',
  'Tricat', 'Tricat Primary', 'Tricat Booster',
  'Vencomax', 'Vencomax BRONQ',
  'Canine DPPvL',
  'DHPPi', 'DHPPiL', 'DHPPL', 'CCV', 'Rabies',
]

// ── Observed medicine names ──────────────────────────────────────────────────
// Dosage-form prefixes ("Tab.", "Sup.") are dropped from the vocabulary: they
// are how a prescription is written, not part of the product name, and they
// only dilute the biasing budget.
export const MEDICINES = [
  'Bravecto', 'Zymopet', 'Laxitil', 'Moxybact', 'Romtic', 'Ripeen',
  'Vendice', 'Felin D', 'Genta', 'NMELO',
  'Azithromycin', 'Ceftriaxone', 'Atorvastatin',
]

// Names the owner has confirmed on a review screen since. Stored per browser,
// because it is their vocabulary and it does not belong to anyone else.
const LEARNED_KEY = 'pippy_known_med_names'
const MAX_LEARNED = 120

export function learnedNames() {
  try {
    const raw = JSON.parse(localStorage.getItem(LEARNED_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : []
  } catch { return [] }
}

/**
 * Remember a name the owner confirmed. Only called when a human has looked at
 * it and pressed save, which is what makes it trustworthy enough to reuse.
 */
export function rememberName(name) {
  const clean = String(name || '').trim()
  if (clean.length < 3 || clean.length > 60) return
  try {
    const all = learnedNames()
    if (all.some(n => n.toLowerCase() === clean.toLowerCase())) return
    all.unshift(clean)
    localStorage.setItem(LEARNED_KEY, JSON.stringify(all.slice(0, MAX_LEARNED)))
  } catch { /* private mode: the feature degrades, nothing breaks */ }
}

/** Everything we know, newest-learned first so recent names survive the cap. */
export function allKnownNames() {
  const seen = new Set()
  const out = []
  for (const n of [...learnedNames(), ...VACCINES, ...MEDICINES]) {
    const k = n.toLowerCase()
    if (!seen.has(k)) { seen.add(k); out.push(n) }
  }
  return out
}

// Whisper's prompt is capped at 224 TOKENS, and going over does not error — it
// silently drops the end, which would quietly stop biasing the names at the
// tail. Budgeting by characters is the conservative proxy: ~4 chars a token,
// and we stay well under.
export const PROMPT_CHAR_BUDGET = 600

/**
 * The `prompt` string sent with a transcription.
 *
 * It reads as a sentence rather than a bare list because Whisper's prompt is
 * meant to be a plausible preceding transcript — that is what the parameter is
 * for, and a naked comma list biases less well.
 */
export function transcriptionPrompt(extra = []) {
  const names = [...extra, ...allKnownNames()]
  const parts = []
  let used = 0
  for (const n of names) {
    if (used + n.length + 2 > PROMPT_CHAR_BUDGET) break
    parts.push(n)
    used += n.length + 2
  }
  if (!parts.length) return ''
  return `A pet owner describing a vet visit. Products mentioned may include: ${parts.join(', ')}.`
}

// ── "Did you mean" ───────────────────────────────────────────────────────────


// Deliberately high. This decides whether to OFFER a correction on a drug name,
// and the cost of the two mistakes is not symmetric: a missed suggestion means
// the owner types the name themselves, while a bad one invites them to accept a
// different product into a medical record with one tap. 0.68 is the tier in
// fuzzyScore where every spoken word at least SOUNDS like the target, which is
// the weakest evidence worth showing for a drug name.
const SUGGEST_MIN = 0.68

/**
 * The closest known product name to what was heard, or null.
 *
 * Returns null when the heard text already matches a known name exactly — there
 * is nothing to suggest — and null when nothing is close enough. The caller
 * offers it; it is never applied on the owner's behalf.
 */
export function suggestName(heard, names = allKnownNames()) {
  const q = String(heard || '').trim()
  if (q.length < 3) return null

  let best = null
  let bestScore = 0
  for (const n of names) {
    if (n.toLowerCase() === q.toLowerCase()) return null   // already right
    const s = fuzzyScore(q, n)
    if (s > bestScore) { bestScore = s; best = n }
  }
  return bestScore >= SUGGEST_MIN ? { name: best, score: bestScore } : null
}
