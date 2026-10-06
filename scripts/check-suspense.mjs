// Every lazily-loaded component must render inside a <Suspense> boundary.
// Run: npm run check:suspense
//
// Why this exists, twice over.
//
// Code splitting turned a dozen components into React.lazy. A lazy component
// that renders with no Suspense boundary above it does not show a spinner: it
// throws "A component suspended while responding to synchronous input", React
// tears the subtree down, and the user is dropped back where they came from
// with a blank flash in between.
//
// It happened first with the pet tabs, and was fixed. It then happened AGAIN
// with the four buttons in the pet header -- Update, Share, SOS, AI Brief --
// because those modals render outside the tab content's boundary and the fix
// had been verified by clicking tabs. A customer found it in production: "any
// one when clicked is hanging and then going back to first page of all cats".
//
// The build cannot catch this. It is valid JSX and valid React; it only fails
// at the moment of the click. So it is checked here instead.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.jsx$/.test(p)) out.push(p)
  }
  return out
}

/** Character ranges covered by a <Suspense> ... </Suspense> pair, nesting-aware. */
function suspenseRanges(src) {
  const ranges = []
  const open = /<Suspense[\s>]/g
  let m
  while ((m = open.exec(src))) {
    // Walk forward counting nested Suspense opens so the matching close is found.
    let depth = 1
    let i = m.index + m[0].length
    while (i < src.length && depth > 0) {
      const nextOpen  = src.indexOf('<Suspense', i)
      const nextClose = src.indexOf('</Suspense>', i)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) { depth++; i = nextOpen + 9 }
      else { depth--; i = nextClose + 11 }
    }
    ranges.push([m.index, i])
  }
  return ranges
}

let problems = 0
let checked = 0

for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8')

  // Components declared as lazy in this file.
  const lazyNames = [...src.matchAll(/(?:const|let)\s+([A-Z]\w*)\s*=\s*lazy\s*\(/g)].map(m => m[1])
  if (lazyNames.length === 0) continue

  const ranges = suspenseRanges(src)
  const inSuspense = (idx) => ranges.some(([a, b]) => idx > a && idx < b)

  for (const name of lazyNames) {
    checked++
    // Every JSX render site for that component.
    const uses = [...src.matchAll(new RegExp(`<${name}[\\s/>]`, 'g'))]
    if (uses.length === 0) {
      console.log(`  ?  ${file}: ${name} is lazy but never rendered here`)
      continue
    }
    const unguarded = uses.filter(u => !inSuspense(u.index))
    if (unguarded.length) {
      problems++
      const lines = unguarded.map(u => src.slice(0, u.index).split('\n').length)
      console.log(`  ✗  ${file}:${lines.join(',')}  <${name}> renders with no <Suspense> above it`)
    }
  }
}

if (problems === 0) {
  console.log(`\nok    all ${checked} lazy component(s) render inside a Suspense boundary\n`)
  process.exit(0)
}
console.log(`\n${problems} lazy component(s) render with no Suspense boundary.`)
console.log('Clicking through to one of these will blank the screen rather than show a loader.\n')
process.exit(1)
