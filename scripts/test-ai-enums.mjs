// A model answering a multiple-choice question with the question.
// Run: npm run test:ai-enums
//
// The real row, found by sweeping every enum-backed column in the database:
//
//   allergies.type = "Environmental|Food|Medication|Other"
//
// Not a value — the prompt's own option list handed back. It sat on a pet's
// record for two and a half months, and the screen that should have shown it
// rendered a <select> that fell back to its first option, so it displayed
// "Food" while holding the list.
//
// The prompts no longer write options as "A|B|C". This is the second line:
// an instruction a model can ignore, a parse it cannot.

import fs from 'node:fs'
import { looksLikeOptionList, dropEchoedEnums } from '../src/lib/aiEnums.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

const REAL = 'Environmental|Food|Medication|Other'

console.log('\nTelling an option list from an option')
{
  ok('the value that actually happened is caught', looksLikeOptionList(REAL) === true)
  ok('so is the spec exactly as the prompt used to write it',
     looksLikeOptionList('Food|Environmental|Medication|Contact|Other') === true)
  ok('and a two-way one', looksLikeOptionList('HIGH|LOW') === true)

  // A real answer never contains a pipe.
  ok('an ordinary value is left alone', looksLikeOptionList('Food') === false)
  ok('one with a slash in it is still a value', looksLikeOptionList('Flea/Tick') === false)
  ok('one with spaces is still a value', looksLikeOptionList('Lab Result') === false)
  ok('empty is not a list', looksLikeOptionList('') === false)
  // try/catch so losing the non-string guard reports a failed assertion
  // rather than crashing the run — a crash is detection, but it says nothing
  // about which guarantee broke.
  const safely = v => { try { return looksLikeOptionList(v) } catch (e) { return `threw: ${e.message}` } }
  ok('null is not a list', safely(null) === false, safely(null))
  ok('a number is not a list', safely(3) === false, safely(3))
  ok('undefined is not a list', safely(undefined) === false, safely(undefined))
  ok('an object is not a list', safely({}) === false, safely({}))

  // A trailing or stray pipe should not cost an otherwise usable value.
  ok('a trailing pipe does not make it a list', looksLikeOptionList('Food|') === false)
  ok('a leading pipe does not either', looksLikeOptionList('|Food') === false)
}

console.log('\nBlanking it, and only it')
{
  const parsed = {
    allergy: { allergen: 'unknown', type: REAL, severity: 'Moderate',
               reactions: ['suspected allergic reaction'] },
  }
  const out = dropEchoedEnums(parsed)
  ok('the echoed list is blanked', out.allergy.type === '', out.allergy.type)
  // Blanked, not guessed. "Food" would be a fabricated clinical claim about a
  // real animal, and the screens already render "" as an empty box.
  ok('it is not replaced with the first option', out.allergy.type !== 'Environmental', out.allergy.type)
  ok('a good value in the same object survives', out.allergy.severity === 'Moderate')
  ok('non-enum fields are untouched', out.allergy.allergen === 'unknown')
  ok('arrays survive', JSON.stringify(out.allergy.reactions) === '["suspected allergic reaction"]')
  ok('the input is not modified', parsed.allergy.type === REAL, parsed.allergy.type)
}

console.log('\nEvery place the scanner can produce one')
{
  const out = dropEchoedEnums({
    type: 'medical|vaccination|allergy',
    medicalRecord: { type: 'Checkup|Illness|Surgery', title: 'Fine' },
    medicines: [
      { name: 'Bravecto', category: 'Deworming|Flea/Tick|Other', frequency: 'Monthly' },
      { name: 'Amoxicillin', category: 'Antibiotic', frequency: 'Once daily' },
    ],
    allergy: { type: REAL, severity: 'Mild|Moderate|Severe' },
    timelines: [{ label: 'Next due', date: '2026-12-01', type: 'Vaccination|Other' }],
    abnormalities: [{ parameter: 'ALT', status: 'HIGH|LOW', severity: 'Mild' }],
  })
  ok('document type', out.type === '')
  ok('record type', out.medicalRecord.type === '')
  ok('medicine category, in an array', out.medicines[0].category === '')
  ok('a good category next to it is kept', out.medicines[1].category === 'Antibiotic')
  ok('a free-text frequency is kept', out.medicines[1].frequency === 'Once daily')
  ok('allergy type and severity', out.allergy.type === '' && out.allergy.severity === '')
  ok('timeline type, nested in an array', out.timelines[0].type === '')
  ok('abnormality status', out.abnormalities[0].status === '')
  ok('a real record title is never touched', out.medicalRecord.title === 'Fine')
}

console.log('\nWhat it must NOT blank')
{
  // Prose can legitimately contain a pipe. Blanking a description would lose
  // what the owner actually came for, which is worse than the bug.
  const out = dropEchoedEnums({
    summary: 'Bloods normal | follow up in 3 months',
    medicalRecord: { description: 'Lethargy | reduced appetite | seen 3 Oct', notes: 'a|b' },
    bill: { lineItems: [{ description: 'Consult | after hours', amount: 900 }] },
  })
  ok('a summary with a pipe is kept', out.summary.includes('|'))
  ok('a description with pipes is kept', out.medicalRecord.description.includes('|'))
  ok('notes are kept', out.medicalRecord.notes === 'a|b')
  ok('a bill line is kept', out.bill.lineItems[0].description.includes('|'))
  ok('and its amount is untouched', out.bill.lineItems[0].amount === 900)
}

console.log('\nIt cannot break a response')
{
  ok('null', dropEchoedEnums(null) === null)
  ok('a bare string', dropEchoedEnums('hello') === 'hello')
  ok('a number', dropEchoedEnums(7) === 7)
  ok('an empty object', JSON.stringify(dropEchoedEnums({})) === '{}')
  ok('an empty array', JSON.stringify(dropEchoedEnums([])) === '[]')
  ok('a null inside an object', dropEchoedEnums({ type: null }).type === null)
  ok('a deeply nested good value',
     dropEchoedEnums({ a: { b: { c: [{ type: 'Food' }] } } }).a.b.c[0].type === 'Food')
}

console.log('\nThe prompts themselves')
{
  // The prompts are the first line of this defence, and they are plain text
  // in a template literal -- nothing else would notice if an edit put the
  // ambiguous form back, or broke the schema the model is shown.
  const doc = fs.readFileSync(new URL('../api/_lib/analyze-document.js', import.meta.url), 'utf8')
  const cmp = fs.readFileSync(new URL('../api/_lib/ai-complete.js', import.meta.url), 'utf8')

  // "A|B|C" inside a JSON string value reads as a valid literal, which is
  // exactly how "Environmental|Food|Medication|Other" ended up on a pet.
  const ambiguous = /"\s*:\s*"[A-Za-z][A-Za-z /-]*\|[A-Za-z |/-]+"/g
  ok('the scanner prompt has no pipe-style enums', (doc.match(ambiguous) || []).length === 0,
     doc.match(ambiguous))
  ok('nor does ai-complete', (cmp.match(ambiguous) || []).length === 0, cmp.match(ambiguous))

  ok('the scanner says how to choose', /one of: /.test(doc) && /return exactly ONE/i.test(doc))
  ok('so does ai-complete', /one of: /.test(cmp) && /exactly ONE/i.test(cmp))

  // The schema block is what tells the model the SHAPE of the answer. Editing
  // the enum notation is an easy way to break it without noticing, so it is
  // parsed rather than eyeballed.
  const blockAfter = (src, marker) => {
    const from = src.indexOf(marker) + marker.length
    const open = src.indexOf('{', from)
    let depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
    }
    return null
  }

  const docSchema = blockAfter(doc, 'Return a JSON object:')
  let docParsed = null
  try { docParsed = JSON.parse(docSchema) } catch (e) { docParsed = `threw: ${e.message}` }
  ok('the scanner schema is still valid JSON', typeof docParsed === 'object' && docParsed !== null, docParsed)
  const hasKeys = (obj, keys) =>
    !!obj && typeof obj === 'object' && keys.every(k => k in obj)
  ok('and still has the sections the app reads',
     hasKeys(docParsed, ['type', 'medicalRecord', 'vaccinations', 'medicines', 'allergy',
                         'bill', 'weightReadings', 'timelines', 'abnormalities']),
     docParsed)

  const cmpSchema = blockAfter(cmp, 'Extract reminder details and return ONLY valid JSON:')
  let cmpParsed = null
  try { cmpParsed = JSON.parse(cmpSchema) } catch (e) { cmpParsed = `threw: ${e.message}` }
  ok('the reminder schema is still valid JSON', typeof cmpParsed === 'object' && cmpParsed !== null, cmpParsed)
  ok('with the fields the reminder save needs',
     hasKeys(cmpParsed, ['type', 'dueDate', 'frequency', 'notes']), cmpParsed)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
