// Globals that must not be shadowed. Run: npm run check:shadowing
//
// PetAvatar imported lucide-react's `Image` icon, which shadowed the GLOBAL
// Image constructor in that module. `new Image()` then built a React component
// instead of an HTMLImageElement: setting .src did nothing, onload never
// fired, and the resize promise NEVER SETTLED. Picking a pet photo did
// nothing at all — no photo, no error, nothing in the console.
//
// It is the same family as `Camera` and `Heart` once being imported from
// 'react' instead of lucide-react, which blanked the pet screen. A named
// import quietly taking over a global is invisible in review, survives a clean
// build, and only shows up when somebody taps the button.
//
// Cheap to check, so it is checked.

import fs from 'node:fs'
import path from 'node:path'

// global constructor -> the call that proves the module wanted the REAL one
const GLOBALS = [
  { name: 'Image',       used: /\bnew\s+Image\s*\(/ },
  { name: 'FileReader',  used: /\bnew\s+FileReader\s*\(/ },
  { name: 'Audio',       used: /\bnew\s+Audio\s*\(/ },
  { name: 'Notification',used: /\bnew\s+Notification\s*\(/ },
]

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const f = path.join(d, e.name)
  return e.isDirectory() ? walk(f) : [f]
})

/** Does this file import the bare name `name` from anywhere? */
function importsBareName(src, name) {
  const lines = src.match(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/g) || []
  return lines.some(line => {
    const inner = line.slice(line.indexOf('{') + 1, line.indexOf('}'))
    return inner.split(',').some(part => {
      const spec = part.trim()
      // `Image as ImageIcon` rebinds the local name and is FINE — that is the fix.
      if (/\bas\b/.test(spec)) return false
      return spec === name
    })
  })
}

let failed = 0
const files = walk('src').filter(f => /\.jsx?$/.test(f))

for (const { name, used } of GLOBALS) {
  const offenders = files.filter(f => {
    const src = fs.readFileSync(f, 'utf8')
    return used.test(src) && importsBareName(src, name)
  })
  if (offenders.length) {
    failed++
    console.log(`FAIL  \`${name}\` is imported AND used as a global constructor in:`)
    offenders.forEach(f => console.log(`        ${f}  — import it as e.g. \`${name} as ${name}Icon\``))
  } else {
    console.log(`ok    nothing shadows \`${name}\` while calling new ${name}()`)
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
