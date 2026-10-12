// What the breed panel tells an owner to DO. Run: npm run test:breed-guidance
//
// The panel listed a Labrador's risks as "Hip & elbow dysplasia, Obesity
// tendency, Exercise-induced collapse, Progressive retinal atrophy", each
// behind a warning triangle, and stopped there. An owner reported that as
// off-putting on the day they added their first dog — fairly, since it is four
// frightening nouns and no way to act on any of them.
//
// The guidance is grouped by theme rather than written per condition, because
// there are 98 distinct concerns across 73 breeds and writing a paragraph of
// veterinary content for each would mean inventing 98 pieces of medical advice
// from memory. Every line is either ordinary care or "ask your vet". These
// tests exist to keep it that way.

import { readFileSync } from 'node:fs'
import { guidanceFor, themeFor, hasUrgent, THEME_IDS } from '../src/lib/breedGuidance.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

/** Every concern the breed table actually contains. */
function allConcerns() {
  const src = readFileSync('src/components/BreedAlert.jsx', 'utf8')
  const start = src.indexOf('= {')
  const end = src.indexOf('\n}', start)
  return [...new Set(
    [...src.slice(start, end).matchAll(/'((?:[^'\\]|\\.)+)'/g)]
      .map(m => m[1].replace(/\\'/g, "'"))
      .filter(s => /[A-Z]/.test(s[0])))]
}

console.log('\nThe reported case: a Labrador')
{
  for (const [concern, expect] of [
    ['Hip & elbow dysplasia',            'joints'],
    ['Obesity tendency',                 'weight'],
    ['Exercise-induced collapse (EIC)',  'neuro'],
    ['Progressive retinal atrophy',      'eyes'],
  ]) ok(`${concern} → ${expect}`, guidanceFor(concern).id === expect, guidanceFor(concern).id)

  // The actual complaint: a risk with nothing to do about it.
  const lab = ['Hip & elbow dysplasia', 'Obesity tendency']
  ok('every one carries practical guidance',
     lab.every(c => guidanceFor(c).helps.length > 40), lab.map(c => guidanceFor(c).helps.length))
  ok('none of it reads as a diagnosis',
     lab.every(c => !/you should treat|your pet has|diagnos/i.test(guidanceFor(c).helps)))
}

console.log('\nNothing is left without an answer')
{
  const concerns = allConcerns()
  ok('the breed table still parses', concerns.length > 50, concerns.length)

  const silent = concerns.filter(c => !guidanceFor(c).helps)
  ok('every concern gets something', silent.length === 0, silent)

  // A fallback exists on purpose, but a breed added tomorrow landing there is
  // a signal, not a failure — so this reports rather than demands zero.
  const generic = concerns.filter(c => guidanceFor(c).id === 'general')
  ok(`all ${concerns.length} concerns match a specific theme`, generic.length === 0, generic)
}

console.log('\nEmergencies read as emergencies')
{
  // The difference that matters: "mention it at the next visit" versus
  // "today". Bloat kills in hours.
  for (const c of ['Bloat (GDV)', 'Bloat (GDV) — life-threatening',
                   'Bloat (GDV) — deep-chested breed', 'GI stasis (life-threatening)',
                   'Wet tail (proliferative ileitis)']) {
    ok(`${c} is marked urgent`, guidanceFor(c).urgent === true, guidanceFor(c))
  }
  ok('an ordinary concern is not urgent', guidanceFor('Dental disease').urgent === false)
  ok('the urgent wording says so', /emergency/i.test(guidanceFor('Bloat (GDV)').helps))

  ok('a breed with bloat is flagged',
     hasUrgent(['Hip dysplasia', 'Bloat (GDV)']) === true)
  ok('a breed without one is not',
     hasUrgent(['Hip dysplasia', 'Dental disease']) === false)
  ok('an empty list is not urgent', hasUrgent([]) === false)
}

console.log('\nGood news is not dressed as a warning')
{
  const g = guidanceFor('Generally hardy — minimal breed-specific issues')
  ok('a hardy breed is marked positive', g.positive === true, g)
  ok('and is not urgent', g.urgent === false)
  ok('a real concern is not marked positive',
     guidanceFor('Hip dysplasia').positive === false)
}

console.log('\nThe ones most easily mismatched')
{
  // Each of these was wrong on a first pass, or is one word away from being
  // caught by the wrong theme.
  for (const [concern, expect] of [
    ['Intervertebral disc disease',  'joints'],      // IVDD written out
    ['Cushing\'s disease',           'endocrine'],
    ['Addison\'s disease',           'endocrine'],
    ['Perianal fistulas',            'skin'],
    ['MDR1 drug sensitivity',        'medication'],
    ['Sensitive to anesthesia (sighthound)', 'medication'],
    ['Von Willebrand disease',       'medication'],  // matters before surgery
    ['Osteosarcoma (bone cancer)',   'cancer'],
    ['Polycystic kidney disease (PKD)', 'kidney'],
    ['Scurvy (Vitamin C deficiency)', 'diet'],
    ['Uterine cancer (unspayed females)', 'cancer'],
    ['Tick fever',                   'parasites'],
    ['Heat sensitivity',             'airway'],
    ['Dental disease (overgrown teeth)', 'dental'],
  ]) ok(`${concern} → ${expect}`, guidanceFor(concern).id === expect, guidanceFor(concern).id)

  // Order matters: "Bloat (GDV) — deep-chested breed" must be caught by the
  // emergency theme, not by something matching on "breed" or "chest".
  ok('the emergency theme wins over any later match',
     guidanceFor('Bloat (GDV) — deep-chested breed').id === 'bloat')
}

console.log('\nIt stays on the safe side of medical advice')
{
  // Every line is ordinary care or "ask a vet". If somebody later adds a dose,
  // a drug name or a treatment instruction, this should fail.
  const all = THEME_IDS.map(id => {
    const c = { joints: 'Hip dysplasia', weight: 'Obesity', bloat: 'Bloat (GDV)',
      airway: 'Heat sensitivity', heart: 'Heart disease', eyes: 'Eye problems',
      skin: 'Skin allergies', dental: 'Dental disease', cancer: 'Cancer (higher risk)',
      neuro: 'Epilepsy', endocrine: 'Hypothyroidism', kidney: 'Bladder stones',
      medication: 'MDR1 drug sensitivity', parasites: 'Tick fever',
      cold: 'Cold sensitivity — thin coat', diet: 'Scurvy (Vitamin C deficiency)',
      reproductive: 'Uterine cancer (unspayed females)',
      hardy: 'Generally hardy — minimal breed-specific issues' }[id]
    return guidanceFor(c).helps
  })

  ok('no dose or strength is ever stated',
     !all.some(h => /\b\d+\s?(mg|ml|mcg|g)\b/i.test(h)), all.filter(h => /\b\d+\s?(mg|ml)\b/i.test(h)))
  ok('no line tells the owner to give a medicine',
     !all.some(h => /\bgive (them )?(a |an )?(tablet|dose|injection)/i.test(h)))
  ok('no line claims to prevent or cure',
     !all.some(h => /\b(cures?|prevents? it|will stop (it|this))\b/i.test(h)), all.filter(h => /\bcure/i.test(h)))
  ok('every theme produces real guidance', all.every(h => h && h.length > 40))
  ok('themes are unique', new Set(THEME_IDS).size === THEME_IDS.length)
}

console.log('\nJunk in does not break it')
{
  ok('an empty concern has no theme', themeFor('') === null)
  ok('null has no theme', themeFor(null) === null)
  ok('but guidanceFor still answers', guidanceFor('').helps.length > 0)
  ok('an unknown concern falls back rather than throwing',
     guidanceFor('Spontaneous combustion').id === 'general')
  ok('and that fallback points at the vet',
     /check-up/i.test(guidanceFor('Spontaneous combustion').helps))
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
