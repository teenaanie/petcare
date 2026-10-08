// A boarder's own criteria. Run: npm run test:own-criteria
//
// The catalogue in boarding.js is closed on purpose — every entry carries a
// `derive` that knows how to check itself against a pet's records. A boarder's
// own criterion cannot be checked by anything, so it is a different kind of
// thing and lives on their policy instead.
//
// What is pinned here is what goes wrong if the plumbing is half done:
//
//   · an unknown id in `required` is silently DROPPED by evaluateReadiness,
//     because requirement() returns undefined and appliesTo(undefined) is
//     false. A boarder would tick their own criterion and the owner would
//     never see it, with nothing on either screen saying why.
//   · a custom id that collided with a catalogue id would replace a CHECKED
//     requirement with an unchecked one. Hence the own_ prefix.
//   · a custom criterion must always evaluate 'manual'. Anything else is the
//     app ticking a box on the owner's behalf for something it cannot see.

import {
  customRequirements, requirementIn, allRequirements, newCustomId,
  evaluateReadiness, requirement, GENERIC_POLICY, REQUIREMENT_CATALOG,
} from '../src/lib/boarding.js'

let failed = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const POLICY = {
  required: ['rabies', 'own_blanket', 'own_lift_key'],
  trial_required: true,
  custom: [
    { id: 'own_blanket',  label: 'A blanket that smells of home', help: 'Unwashed, please.' },
    { id: 'own_lift_key', label: 'Lift key if you live in a tower' },
  ],
}

console.log('\nReading them back')
check('both are returned',       customRequirements(POLICY).map(c => c.id), ['own_blanket', 'own_lift_key'])
check('with their words',        customRequirements(POLICY)[0].label, 'A blanket that smells of home')
check('help is optional',        customRequirements(POLICY)[1].help, '')
check('they are always manual',  customRequirements(POLICY).every(c => c.derive === 'manual'), true)
check('and marked as the boarder’s own', customRequirements(POLICY)[0].custom, true)
check('species defaults to every supported one', customRequirements(POLICY)[0].species, '*')

// Junk on the policy must not reach a screen as a blank row.
check('a criterion with no label is dropped',
      customRequirements({ custom: [{ id: 'own_x' }, { id: 'own_y', label: '   ' }] }), [])
check('a criterion with no id is dropped',
      customRequirements({ custom: [{ label: 'No id' }] }), [])
check('a policy with none is empty, not undefined', customRequirements({}), [])
check('and so is no policy at all',                 customRequirements(null), [])

console.log('\nResolving by id')
check('a catalogue id still resolves',  requirementIn(POLICY, 'rabies')?.id, 'rabies')
check('and so does a custom one',       requirementIn(POLICY, 'own_blanket')?.label, 'A blanket that smells of home')
check('an unknown id resolves to null', requirementIn(POLICY, 'nonsense'), null)
check('everything asked for, in order', allRequirements(POLICY).map(r => r.id),
      ['rabies', 'own_blanket', 'own_lift_key'])

console.log('\nNew ids')
check('prefixed and slugged', newCustomId('Lift key if you live in a tower', {}), 'own_lift_key_if_you_live_in_a_tower')
check('a repeat does not collide',
      newCustomId('A blanket that smells of home', POLICY), 'own_a_blanket_that_smells_of_home')
// The prefix is the guard that matters: `required` holds catalogue ids and
// custom ones together.
check('never a bare catalogue id', REQUIREMENT_CATALOG.some(r => r.id === newCustomId('rabies', {})), false)
check('empty words still get an id', newCustomId('   ', {}), 'own_criterion')
check('and punctuation alone too',   newCustomId('!!!', {}), 'own_criterion')

console.log('\nOn a pet’s checklist')
{
  const dog = { species: 'Dog' }
  const ev = evaluateReadiness(dog, { vaccinations: [], medicines: [] }, POLICY, '2026-11-01')
  const ids = ev.map(e => e.id)
  check('the custom ones are NOT dropped', ids.includes('own_blanket') && ids.includes('own_lift_key'), true)
  check('they carry their label',  ev.find(e => e.id === 'own_blanket')?.label, 'A blanket that smells of home')
  check('and they are manual',     ev.find(e => e.id === 'own_lift_key')?.status, 'manual')
  // Ticking one by hand is the owner's to do, same as any manual requirement.
  const ticked = evaluateReadiness(dog, {}, POLICY, '2026-11-01', { own_blanket: { done: true } })
  // 'ready', not 'done' — the vocabulary the rest of the checklist uses for a
  // requirement the owner has satisfied.
  check('an owner can tick one off', ticked.find(e => e.id === 'own_blanket')?.status, 'ready')
  check('and it says who said so',   ticked.find(e => e.id === 'own_blanket')?.overridden, true)
}
{
  // Species still filters, and a custom criterion that names one is honoured.
  const catOnly = { required: ['own_carrier'], custom: [{ id: 'own_carrier', label: 'A hard carrier', species: ['Cat'] }] }
  check('a cat-only criterion skips a dog',
        evaluateReadiness({ species: 'Dog' }, {}, catOnly, '2026-11-01').length, 0)
  check('and shows for a cat',
        evaluateReadiness({ species: 'Cat' }, {}, catOnly, '2026-11-01').map(e => e.id), ['own_carrier'])
}

console.log('\nThe catalogue is untouched')
check('requirement() still only knows the catalogue', requirement('own_blanket'), undefined)
check('the generic policy has no custom list',        GENERIC_POLICY.custom, undefined)

console.log(failed ? `\n${failed} FAILED` : '\na boarder can ask for their own things')
process.exit(failed ? 1 : 0)
