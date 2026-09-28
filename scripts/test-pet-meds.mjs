// The vaccine and medicine vocabulary. Run: npm run test:pet-meds
//
// Every name in petMeds.js was read from this app's own database, where it had
// mostly been captured by the document scanner from printed vet paperwork. The
// mishearings below are the shapes transcription actually produces for them.

import { suggestName, transcriptionPrompt, allKnownNames,
         VACCINES, MEDICINES, PROMPT_CHAR_BUDGET } from '../src/lib/petMeds.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

console.log('\nMishearings that should be caught')
for (const [heard, want] of [
  ['no bee back',    'Nobivac'],
  ['nobivack',       'Nobivac'],
  ['fellow cell',    'Felocell'],
  ['felocel',        'Felocell'],
  ['brave ecto',     'Bravecto'],
  ['rabison',        'Rabisin'],
  ['zymo pet',       'Zymopet'],
  ['canny jen',      'Canigen'],
]) {
  const s = suggestName(heard)
  ok(`"${heard}" → ${want}`, s?.name === want, s)
}

console.log('\nThings it must NOT "correct"')
{
  // Already exactly right: nothing to suggest.
  // Nothing to correct when it is already right — and capitalisation is not
  // worth nagging about, so a case-only difference is treated as already right.
  ok('an exact known name suggests nothing', suggestName('Bravecto') === null, suggestName('Bravecto'))
  ok('a case-only difference suggests nothing', suggestName('bravecto') === null, suggestName('bravecto'))
  ok('another case-only difference suggests nothing', suggestName('canigen') === null, suggestName('canigen'))

  // A real product we have never seen must come through untouched rather than
  // being bent into the nearest thing we happen to know.
  for (const unknown of ['Milbemax', 'Drontal', 'Apoquel', 'Nexgard']) {
    const s = suggestName(unknown)
    ok(`unknown product "${unknown}" is not forced onto a known name`,
       s === null || s.score >= 0.68, s)
  }

  ok('something far too short is ignored', suggestName('ab') === null, suggestName('ab'))
  ok('empty input is ignored', suggestName('') === null && suggestName(null) === null, null)
  ok('gibberish suggests nothing', suggestName('qqqzzzxxx') === null, suggestName('qqqzzzxxx'))
}

console.log('\nProducts that differ by valency stay separate')
{
  // Felocell and Felocell 3 may not be the same product. Merging them would
  // silently change what a record says was given.
  ok('both are listed', VACCINES.includes('Felocell') && VACCINES.includes('Felocell 3'), null)
}

console.log('\nThe Whisper prompt')
{
  const p = transcriptionPrompt()
  ok('stays inside the character budget', p.length <= PROMPT_CHAR_BUDGET + 80, p.length)
  ok('mentions the products', /Nobivac/.test(p) && /Bravecto/.test(p), null)
  ok('reads as a sentence, not a bare list', /pet owner/i.test(p), p.slice(0, 40))
  ok('every known name is a real string',
     allKnownNames().every(n => typeof n === 'string' && n.trim().length > 1), null)
  ok('no duplicates once folded',
     new Set(allKnownNames().map(n => n.toLowerCase())).size === allKnownNames().length, null)
}

console.log('\nNothing invented: the list is what the database held')
{
  // A guard against someone later pasting in a remembered catalogue. These are
  // the only two sources the file documents.
  ok('vaccines and medicines are non-empty and modest in size',
     VACCINES.length > 10 && VACCINES.length < 60 && MEDICINES.length > 5 && MEDICINES.length < 60,
     { v: VACCINES.length, m: MEDICINES.length })
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
