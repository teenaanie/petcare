// Catching a model that answers a multiple-choice question with the question.
//
// The case this exists for, from real data: a scanned document produced an
// allergy whose type was
//
//   "Environmental|Food|Medication|Other"
//
// which is not a value, it is the prompt's own list of options handed back.
// It sat in the database for two and a half months. The screen that should
// have shown it rendered a <select> that fell back to its first option, so it
// displayed "Food" while holding the list -- see CapturedFields.jsx.
//
// The prompts no longer write options as "A|B|C" for exactly this reason. This
// is the second line: an instruction a model can ignore, a parse it cannot.
//
// Plain .js in src/lib so node can test it without a build step, and so the
// server can import it the way usage-report.js already imports usageLimits.

// Fields whose value is chosen from a fixed list. NOT every string: a note, a
// description or a clinical comment may legitimately contain a pipe, and
// blanking those would lose what the owner actually came for.
const ENUM_FIELDS = new Set(['type', 'category', 'severity', 'status', 'frequency'])

/**
 * Is this an option list rather than an option?
 *
 * Deliberately narrow. A real answer to one of these fields is one word or a
 * short phrase; it never contains a pipe. Requiring two non-empty parts stops
 * a stray trailing pipe from blanking an otherwise usable value.
 */
export function looksLikeOptionList(value) {
  if (typeof value !== 'string') return false
  // No explicit `includes('|')` fast path: splitting a pipe-free string gives
  // one part, which the length check below already rejects. The extra line
  // could be deleted without a single test noticing, which is what a mutation
  // run showed -- so it is gone rather than kept as dead weight.
  const parts = value.split('|').map(p => p.trim())
  return parts.length >= 2 && parts.every(p => p.length > 0)
}

/**
 * Walk a parsed AI response and blank any enum field that came back as the
 * list of options.
 *
 * Blanked, not guessed. "" means "not captured", which the screens already
 * render as an empty box for the owner to fill in -- and an empty box is an
 * honest answer where picking the first option would be a fabricated one.
 *
 * Returns a new value; the input is not modified.
 */
export function dropEchoedEnums(input) {
  if (Array.isArray(input)) return input.map(dropEchoedEnums)
  if (!input || typeof input !== 'object') return input

  const out = {}
  for (const [key, value] of Object.entries(input)) {
    if (ENUM_FIELDS.has(key) && looksLikeOptionList(value)) {
      out[key] = ''
      continue
    }
    out[key] = (value && typeof value === 'object') ? dropEchoedEnums(value) : value
  }
  return out
}
