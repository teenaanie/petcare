// What analytics is allowed to send. Run: npm run test:analytics
//
// The risk in a health app is not the analytics tool, it is what gets handed to
// it by accident — a pet's name as a label, a medicine in a parameter, a
// condition in an event name. This is the guard on that, and it matters
// because the privacy notice makes a promise about it in so many words.

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

// A browser, stubbed by hand rather than with a DOM library — the module only
// needs localStorage and gtag, and a dependency for four globals is not a trade
// worth making.
const store = new Map()
const sent = []
globalThis.window = {
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
  gtag: (kind, name, params) => { if (kind === 'event') sent.push({ name, params }) },
}
globalThis.localStorage = window.localStorage
globalThis.document = { createElement: () => ({}), head: { appendChild() {} },
                        getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }] }

store.set('pippy_analytics_consent', 'granted')
const { trackEvent } = await import('../src/lib/analytics.js')

console.log('\nEvents outside the closed list are refused')
{
  sent.length = 0
  trackEvent('pet_name_is_bruno', {})
  trackEvent('arbitrary_thing', {})
  trackEvent('condition_ear_infection', {})
  ok('none of them are sent', sent.length === 0, sent)
}

console.log('\nFree text never reaches Google')
{
  sent.length = 0
  trackEvent('pet_added', {
    species: 'Dog',                   // safe enum   → allowed
    count: 3,                         // number      → allowed
    first: true,                      // boolean     → allowed
    pet_name: 'Bruno the Beagle',     // a NAME      → dropped
    note: 'has a skin infection',     // free text   → dropped
    medicine: 'Otibact 3 drops',      // a drug      → dropped
    email: 'someone@example.com',     // PII         → dropped
    condition: 'Ear infection, left', // health data → dropped
  })
  const p = sent[0]?.params || {}
  ok('the event itself went', sent.length === 1, sent)
  ok('safe enum kept', p.species === 'Dog', p)
  ok('number kept',    p.count === 3, p)
  ok('boolean kept',   p.first === true, p)
  ok('a pet name is dropped',       !('pet_name' in p), p)
  ok('a free-text note is dropped', !('note' in p), p)
  ok('a medicine is dropped',       !('medicine' in p), p)
  ok('an email address is dropped', !('email' in p), p)
  ok('a health condition is dropped', !('condition' in p), p)
  ok('ONLY the three safe keys survived',
     Object.keys(p).sort().join() === 'count,first,species', p)
}

console.log('\nVocabulary values with spaces')
{
  sent.length = 0
  // The reminder vocabulary contains "Vet Checkup". The filter rejects spaces
  // ON PURPOSE — a free-text note is letters and spaces too — so call sites
  // slugify known enums before sending. This proves both halves.
  trackEvent('reminder_created', { type: 'Vet Checkup' })
  ok('a raw value with a space is dropped', !('type' in (sent[0]?.params || {})), sent[0])

  sent.length = 0
  trackEvent('reminder_created', { type: 'Vet_Checkup' })
  ok('the slugified value goes through', sent[0]?.params?.type === 'Vet_Checkup', sent[0])

  sent.length = 0
  trackEvent('reminder_created', { note: 'has a skin infection' })
  ok('and free text is still dropped, spaces or not',
     !('note' in (sent[0]?.params || {})), sent[0])
}

console.log('\nThe filter is shape-based — which is a limit worth stating')
{
  sent.length = 0
  // "Bruno" is one word with no punctuation, so it is indistinguishable from a
  // safe enum BY SHAPE. The filter cannot catch this, which is exactly why the
  // rule for callers is "never pass a name", not "the filter will handle it".
  trackEvent('pet_added', { species: 'Bruno' })
  ok('a single bare word does pass — callers must not send names',
     sent[0]?.params?.species === 'Bruno', sent[0])
}

console.log('\nNothing is sent without consent')
{
  sent.length = 0
  store.set('pippy_analytics_consent', 'denied')
  trackEvent('pet_added', { species: 'Dog' })
  ok('a visitor who declined sends nothing', sent.length === 0, sent)

  store.delete('pippy_analytics_consent')
  trackEvent('pet_added', { species: 'Dog' })
  ok('a visitor who has not been asked sends nothing', sent.length === 0, sent)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
