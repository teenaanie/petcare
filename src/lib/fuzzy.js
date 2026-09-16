// fuzzy.js — "did you mean" matching for names people type from memory.
//
// Business names get misremembered and misspelled far more than they get typed
// exactly: someone who stayed at "Unleash – The Dog Town" types "unleesh", or
// "dog town", or "wagging tails" for "Waggin Tailz". A substring search finds
// none of those, so this ranks on how a name *sounds* as well as how it looks.
//
// Deliberately dependency-free and small: it runs over a few hundred rows held
// in memory on every keystroke.

// ── Normalisation ────────────────────────────────────────────────────────────

export function normalise(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Words that carry no identifying signal in this domain — matching on them
// would rank every pet business equally against every other.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'pet', 'pets', 'dog', 'dogs', 'cat', 'cats',
  'centre', 'center', 'services', 'service', 'pvt', 'ltd', 'llp', 'co',
])

function tokens(s) {
  return normalise(s).split(' ').filter(Boolean)
}

function contentTokens(s) {
  const t = tokens(s)
  const kept = t.filter(x => !STOPWORDS.has(x))
  return kept.length ? kept : t
}

// ── Phonetics ────────────────────────────────────────────────────────────────

// Classic Soundex. Catches vowel-swaps and the usual consonant confusions
// (unleash/unleesh, paws/pawz).
export function soundex(word) {
  const a = (word || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!a) return ''
  const code = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  }
  let out = a[0]
  let prev = code[a[0]] || ''
  for (let i = 1; i < a.length && out.length < 4; i++) {
    const ch = a[i]
    const c = code[ch] || ''
    if (c && c !== prev) out += c
    // H and W are transparent: they don't break a run of the same code.
    if (ch !== 'H' && ch !== 'W') prev = c
  }
  return (out + '000').slice(0, 4)
}

// Consonant skeleton — vowels dropped, runs collapsed. Soundex buckets very
// coarsely (it stops at four characters), so this catches longer names that
// differ only in their vowels: "waggin" vs "wagging".
export function skeleton(word) {
  const a = (word || '').toLowerCase().replace(/[^a-z]/g, '')
  if (!a) return ''
  let out = a[0]
  for (let i = 1; i < a.length; i++) {
    const ch = a[i]
    if ('aeiou'.includes(ch)) continue
    if (ch === out[out.length - 1]) continue
    out += ch
  }
  return out
}

// ── Edit distance ────────────────────────────────────────────────────────────

export function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const cur = new Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = cur.slice()
  }
  return prev[b.length]
}

function ratio(a, b) {
  const max = Math.max(a.length, b.length)
  return max ? 1 - levenshtein(a, b) / max : 0
}

// ── Scoring ──────────────────────────────────────────────────────────────────
//
// Tiered rather than a single blended number, so the ordering is explainable:
// an exact prefix always beats a phonetic hit, which always beats a fuzzy one.
// Each tier returns a fixed score; only the last is continuous.

export function fuzzyScore(query, text) {
  const q = normalise(query)
  const t = normalise(text)
  if (!q || !t) return 0

  if (q === t) return 1
  if (t.startsWith(q)) return 0.95
  if (t.includes(q)) return 0.86

  const qt = contentTokens(q)
  const tt = contentTokens(t)
  if (!qt.length || !tt.length) return 0

  // Every word typed matches the start of some word in the name — this is what
  // makes "dog town" find "Unleash – The Dog Town".
  if (qt.every(x => tt.some(y => y.startsWith(x)))) return 0.8

  const qJoined = q.replace(/ /g, '')
  const tJoined = t.replace(/ /g, '')
  if (soundex(qJoined) === soundex(tJoined))   return 0.74
  if (skeleton(qJoined) === skeleton(tJoined)) return 0.72

  // Every word typed sounds like some word in the name.
  const soundsLike = (x, y) => soundex(x) === soundex(y) || skeleton(x) === skeleton(y)
  if (qt.every(x => tt.some(y => soundsLike(x, y)))) return 0.68

  // A single strong word match carries a multi-word name: "unleesh" → "Unleash
  // – The Dog Town".
  let bestToken = 0
  for (const x of qt) {
    for (const y of tt) {
      let r = ratio(x, y)
      if (soundsLike(x, y)) r = Math.max(r, 0.8)
      if (y.startsWith(x) || x.startsWith(y)) r = Math.max(r, 0.75)
      bestToken = Math.max(bestToken, r)
    }
  }
  if (bestToken >= 0.7) return 0.5 + bestToken * 0.15

  // Nothing structural matched — fall back to raw similarity, capped well
  // below the tiers above so it never outranks a real hit.
  return Math.max(ratio(qJoined, tJoined), bestToken) * 0.55
}

// ── Ranking ──────────────────────────────────────────────────────────────────

const MIN_SCORE = 0.34

// An empty query returns the head of the list unranked, so a freshly focused
// search box can still show something to pick from.
export function rankMatches(query, items, getText, { limit = 8, minScore = MIN_SCORE } = {}) {
  if (!normalise(query)) return items.slice(0, limit).map(item => ({ item, score: 0 }))
  return items
    .map(item => ({ item, score: fuzzyScore(query, getText(item)) }))
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score || getText(a.item).length - getText(b.item).length)
    .slice(0, limit)
}
