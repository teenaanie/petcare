// Every use of `supabase` must have the client in scope.
// Run: npm run check:supabase-binding
//
// ── The bug this exists for ─────────────────────────────────────────────────
//
// The Supabase client used to be a module-level export:
//
//     import { supabase } from '../lib/supabase.js'
//
// It is now built on demand, to keep 211 kB off the first-load path:
//
//     const supabase = await getSupabase()
//
// That conversion touched nineteen files and missed one function. PetSharing's
// getMembers still said `await supabase` with nothing binding it, so opening
// the share panel threw "Can't find variable: supabase" and the panel never
// loaded. A customer found it.
//
// Nothing could have caught it here. There is no ESLint in this project, so no
// `no-undef`. The file still imports `getSupabase`, so the import is real and
// Rollup is satisfied. `supabase` is simply an undefined global, which is a
// ReferenceError at the moment that line runs and invisible until then.
//
// So it is checked. The rule: inside any function that uses `supabase` as a
// value, that same function must bind it -- `const supabase = await
// getSupabase()`, or receiving it as a parameter such as
// `getSupabase().then(supabase => ...)`.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(p)) out.push(p)
  }
  return out
}

/**
 * Strip comments and string/template literals.
 *
 * Without this, prose mentioning `supabase.from(...)` in a comment, or the path
 * 'supabase/pet_members.sql' in a user-facing message, both read as uses. The
 * second one is in PetSharing already.
 *
 * Replaced with spaces of equal length so every byte offset still lines up and
 * reported line numbers stay true.
 */
function blank(src) {
  const keep = (n) => ' '.repeat(n)
  let out = '', i = 0
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      const end = src.indexOf('\n', i); const to = end === -1 ? src.length : end
      out += keep(to - i); i = to
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2); const to = end === -1 ? src.length : end + 2
      out += src.slice(i, to).replace(/[^\n]/g, ' '); i = to
    } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const q = src[i]; let j = i + 1
      while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++ }
      out += src.slice(i, j + 1).replace(/[^\n]/g, ' '); i = j + 1
    } else { out += src[i]; i++ }
  }
  return out
}

/**
 * The body of the innermost function containing `index`.
 *
 * Walks back to the nearest enclosing `{` chain and takes the matching block.
 * Not a parser, but the question asked of it is narrow: "is there a binding
 * between here and the top of the function I am in". Climbing one block at a
 * time and stopping at the first that binds gives the right answer for a
 * nested arrow inside a method just as well as for a plain function.
 */
function enclosingBlocks(src, index) {
  const blocks = []
  const stack = []
  for (let i = 0; i < index; i++) {
    if (src[i] === '{') stack.push(i)
    else if (src[i] === '}') stack.pop()
  }
  // Innermost first.
  for (let k = stack.length - 1; k >= 0; k--) {
    const open = stack[k]
    // Include the few characters before the brace, so an arrow's parameter
    // list -- `.then(supabase => {` -- counts as part of that block.
    blocks.push(src.slice(Math.max(0, open - 120), index))
  }
  return blocks
}

// `supabase` used as a value: a property access or awaited directly.
const USE = /\bsupabase\s*(?:\.|\)|,|;|$)|\bawait\s+supabase\b/g
// A PARAMETER declaration, not a use. `async function clearPrimary(supabase,
// userId, ...)` receives the client -- the very thing being looked for -- and
// reading it as an unbound use reported a correct file as broken.
//
// The keyword exclusion is load-bearing. A first attempt at this matched any
// `word(` and so read `if (ids.length && supabase)` as a parameter list,
// silently dropping a real unbound use in DeleteAccount.jsx. A check that
// hides the bug it was written for is worse than no check.
const CONTROL = /\b(if|while|for|switch|catch|return|typeof|await|do|with)$/
function isParamDecl(line, src, idx) {
  // Arrow parameters: `(supabase) =>` or `supabase =>`.
  if (/\([^)]*\bsupabase\b[^)]*\)\s*=>/.test(line)) return true
  if (/\bsupabase\s*=>/.test(line)) return true
  // A function signature: find the `(` opening the group this sits in, and
  // look at the word before it.
  const open = line.lastIndexOf('(', line.indexOf('supabase'))
  if (open === -1) return false
  const before = line.slice(0, open).trimEnd()
  if (CONTROL.test(before)) return false            // if (...), while (...)
  return /\bfunction\s*\*?\s*\w*$/.test(before) // function f(
      || /^\s*(?:async\s+)?\w+$/.test(before)      // method shorthand, name(
}
// Anything that puts it in scope.
//
// The parameter cases need care in both directions. An earlier version matched
// only a FIRST parameter -- `(supabase` or `(supabase,` -- and so reported
// `withLatestWeights(pets, supabase)` as broken. Widening it to any paren
// group containing the word would instead treat `if (x && supabase)` as a
// binding and hide a real bug, which it did once already. So a parameter list
// counts only when it is attached to a function: a `function` keyword, or a
// `)` followed by `=>`.
const BINDS = new RegExp([
  '(?:const|let|var)\\s+supabase\\s*=',             // const supabase = ...
  '\\bsupabase\\s*=>',                              // supabase => ...
  '\\([^)]*\\bsupabase\\b[^)]*\\)\\s*=>',           // (a, supabase) => ...
  'function\\s*\\*?\\s*\\w*\\s*\\([^)]*\\bsupabase\\b', // function f(a, supabase)
].join('|'))

let problems = 0, filesChecked = 0, usesChecked = 0

for (const file of walk('src')) {
  const raw = readFileSync(file, 'utf8')
  const src = blank(raw)

  // A module-level `import { supabase }` would put it in scope for the whole
  // file -- but that export no longer exists, so it is itself the bug.
  const staleImport = /^import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*['"][^'"]*supabase\.js/m.exec(src)
  if (staleImport) {
    problems++
    const line = raw.slice(0, staleImport.index).split('\n').length
    console.log(`  ✗  ${file}:${line}  imports { supabase }, which supabase.js no longer exports`)
    continue
  }

  if (!/\bsupabase\b/.test(src)) continue
  filesChecked++

  USE.lastIndex = 0
  let m
  const reported = new Set()
  while ((m = USE.exec(src))) {
    const line = raw.slice(0, m.index).split('\n').length
    // Skip a parameter list: that line is a binding, not a use.
    if (isParamDecl(src.split('\n')[line - 1] || '', src, m.index)) continue
    usesChecked++
    const bound = enclosingBlocks(src, m.index).some(b => BINDS.test(b))
    if (bound) continue
    if (reported.has(line)) continue
    reported.add(line)
    problems++
    console.log(`  ✗  ${file}:${line}  uses \`supabase\` with nothing binding it in scope`)
    console.log(`         ${raw.split('\n')[line - 1].trim().slice(0, 90)}`)
  }
}

if (problems === 0) {
  console.log(`\nok    ${usesChecked} uses of \`supabase\` across ${filesChecked} file(s) all have it in scope\n`)
  process.exit(0)
}
console.log(`\n${problems} unbound use(s) of \`supabase\`. Each one is a ReferenceError the build cannot see.\n`)
process.exit(1)
