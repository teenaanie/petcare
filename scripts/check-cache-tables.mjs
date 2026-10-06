// Every cached read and every busting write must name the table it really
// touches. Run: npm run check:cache-tables
//
// The pet tabs read through a cache in src/lib/storage.js: getters call
// `cached('<table>', ...)` and writers call `bust('<table>', ...)`. The table
// name is written by hand in both places, and nothing about a wrong one is
// visible at build time or in a quick click-through.
//
// Get it wrong and the failure is the worst kind this app has: a pet parent
// corrects a vaccination date, the save succeeds, the refetch is served from
// a cache that nobody cleared, and they are shown the old date. They conclude
// Pippy lost their record. Mislabel a getter and that happens on a timer.
//
// So the name is checked against the `.from('...')` the function underneath it
// actually queries.

import { readFileSync } from 'node:fs'

const src = readFileSync('src/lib/storage.js', 'utf8')
const lines = src.split('\n')

// Each wrapper is `export const name = (...) => cached('table', ...)` or
// `... => bust('table', ...)` / `bust(['a', 'b'], ...)`, immediately followed
// by `async function _name`.
//
// The array form must be understood explicitly. When it was introduced this
// regex stopped matching those two writers, and the check went on reporting
// "ok" while silently no longer looking at them -- the busting-writes count
// dropped from 23 to 21 and nothing said so. A check that quietly narrows is
// worse than one that fails.
const WRAPPER = /^export const (\w+) = .*?\b(cached|bust)\(\s*(\[[^\]]*\]|'[^']+')/

/**
 * Cached reads that are built from ANOTHER table's rows.
 *
 * `pets` is keyed on the pets table, but getPets() attaches each pet's latest
 * weight from weight_logs (see withLatestWeights in storage.js). So anything
 * clearing weight_logs must clear pets as well. Add a line here whenever a
 * getter starts reading a second table.
 */
const DERIVED_FROM = {
  weight_logs: 'pets',
}

// Writes whose effects legitimately cross tables, with the reason. '*' clears
// everything; a name here means "this write is allowed to bust a table it does
// not itself query".
const CROSS_TABLE = {
  deletePet:      '*',             // cascades to every child table in Postgres
  saveProvider:   'boarders',      // the boarder list is built from providers
  deleteProvider: 'boarders',
  getBoarders:    'boarders',      // delegates to getProviders
}

/**
 * The tables a function queries, read from its body.
 *
 * Both spellings have to be understood. A wrapped function's body lives under
 * `async function _name(`, but an UNWRAPPED writer -- the case this file most
 * needs to catch -- is still `export async function name(`. Looking only for
 * the underscored form made every missing bust() look like a function that
 * queried nothing, which is exactly the thing being checked for.
 */
function tablesIn(name) {
  let start = lines.findIndex(l => l.startsWith(`async function _${name}(`))
  if (start < 0) start = lines.findIndex(l => l.startsWith(`export async function ${name}(`))
  if (start < 0) return null
  // The body ends at the next top-level `}`.
  let end = start + 1
  while (end < lines.length && lines[end] !== '}') end++
  const body = lines.slice(start, end).join('\n')
  return [...new Set([...body.matchAll(/\.from\('([^']+)'\)/g)].map(m => m[1]))]
}

let problems = 0
let checkedReads = 0
let checkedWrites = 0

for (const line of lines) {
  const m = line.match(WRAPPER)
  if (!m) continue
  const [, name, kind, declaredRaw] = m
  // Either "'pets'" or "['weight_logs', 'pets']".
  const declaredList = [...declaredRaw.matchAll(/'([^']+)'/g)].map(x => x[1])
  const declared = declaredList[0]
  kind === 'cached' ? checkedReads++ : checkedWrites++

  if (CROSS_TABLE[name]) {
    if (!declaredList.includes(CROSS_TABLE[name])) {
      problems++
      console.log(`  ✗  ${name} declares ${declaredRaw} but is listed as crossing to '${CROSS_TABLE[name]}'`)
    }
    continue
  }

  // ── Derived data ────────────────────────────────────────────────────────
  // A cached read can be built from a table it is not named after. getPets()
  // carries each pet's latest weight, read from weight_logs -- so a write to
  // weight_logs must clear `pets` too, or the pet card and the emergency card
  // keep showing the previous figure until the TTL lapses. That is the exact
  // bug the derived weight was added to fix, reappearing in a 30-second
  // window, and nothing else would have caught it.
  if (kind === 'bust') {
    for (const [source, alsoClear] of Object.entries(DERIVED_FROM)) {
      if (declaredList.includes(source) && !declaredList.includes(alsoClear)) {
        problems++
        console.log(`  ✗  ${name} clears '${source}' but not '${alsoClear}', whose cached reads are built from it`)
      }
    }
  }

  const actual = tablesIn(name)
  if (actual === null) {
    problems++
    console.log(`  ✗  ${name} wraps _${name}, which does not exist`)
    continue
  }
  if (actual.length === 0) {
    problems++
    console.log(`  ✗  ${name} declares '${declared}' but _${name} queries no table at all`)
    continue
  }
  if (!actual.includes(declared)) {
    problems++
    console.log(`  ✗  ${name} declares '${declared}' but _${name} queries ${actual.map(t => `'${t}'`).join(', ')}`)
  }
}

// A getter that is not cached is a missed optimisation, not a bug. A WRITER
// that is not busting is a bug: it changes rows that a cached getter is still
// serving. So every save/delete/mark on a cached table must go through bust.
const cachedTables = new Set(
  [...src.matchAll(/^export const \w+ = .*?\bcached\('([^']+)'/gm)].map(m => m[1]))

for (const m of src.matchAll(/^export async function ((?:save|delete|mark)\w+)\(/gm)) {
  const name = m[1]
  const touches = tablesIn(name) || []
  const stale = touches.filter(t => cachedTables.has(t))
  if (stale.length) {
    problems++
    console.log(`  ✗  ${name} writes to cached ${stale.map(t => `'${t}'`).join(', ')} without bust() — reads of it will go stale`)
  }
}

if (problems === 0) {
  console.log(`\nok    ${checkedReads} cached reads and ${checkedWrites} busting writes all name the table they touch\n`)
  process.exit(0)
}
console.log(`\n${problems} cache/table mismatch(es). A save could be followed by a stale read.\n`)
process.exit(1)
