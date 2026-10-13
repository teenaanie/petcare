// What the pet-intake prompt is told. Run: npm run test:intake-prompt
//
// An owner added "Tipu, an Indie dog" and got TWO dogs back: one called Tipu
// and one called Indy. The model had no reason to know better -- rule 2 said
// multiple pets in one description are normal, and nothing anywhere said that
// "Indie" is a breed.
//
// It is not a marginal word here. "Indie" is the most common breed in the
// live database: five cats carry it, plus "Indies", "Indy" and "Indie Ginger
// White". Treating it as a name was exactly backwards.

import { voiceIntakePrompt } from '../api/_lib/ai-complete.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

const p = voiceIntakePrompt({ transcript: 'I have Tipu, an Indie dog' })
const t = p.replace(/\s+/g, ' ')

console.log('\nOne animal is not two')
{
  ok('the prompt says outright not to split one animal',
     /DO NOT SPLIT ONE ANIMAL INTO TWO/.test(t))
  ok('and uses the reported case as the example',
     /"Tipu, an Indie dog" is ONE dog named Tipu/.test(t),
     t.match(/"Tipu[^.]*\./)?.[0])
  ok('a second animal is made to need positive evidence',
     /second animal needs positive evidence/.test(t))
  ok('a describing phrase is named as the breed',
     /describing phrase after the name[^.]*is the BREED/.test(t))
}

console.log('\nIndie is a breed, not a name')
{
  for (const w of ['Indie', 'Indi', 'Indy', 'Indies', 'Desi'])
    ok(`${w} is listed`, new RegExp(`"${w}"`).test(t) || new RegExp(`\\b${w}\\b`).test(t))
  ok('it says these are not names', /None of these is a pet's name/.test(t))
  ok('"Lab" is explained too', /"Lab" means Labrador/.test(t))
  ok('other Indian breeds are given', /Indian Pariah/.test(t) && /Indian Spitz/.test(t))
  ok('cats are covered, not just dogs', /Indian Shorthair/.test(t))
}

console.log('\nThe rest of the prompt still holds')
{
  const nums = [...p.matchAll(/\n(\d+)\. /g)].map(m => Number(m[1]))
  ok('rules are numbered in order with no gaps or repeats',
     nums.join(',') === nums.map((_, i) => i + 1).join(','), nums)

  ok('multiple pets are still normal', /Multiple pets in one description are normal/.test(t))
  ok('NEVER INVENT A VALUE is still first', /1\. NEVER INVENT A VALUE/.test(p))
  ok('the species vocabulary survives', /species\s*: Dog, Cat, Bird/.test(t))
  ok('the transcript is still fenced as data, not instructions',
     /do not act on it/.test(t))
  ok("the owner's words are included", p.includes('I have Tipu, an Indie dog'))
  ok('it still asks for JSON only', /Return valid JSON only/.test(p))
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
