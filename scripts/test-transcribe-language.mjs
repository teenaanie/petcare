// A forced Whisper language that Whisper refuses must not reach the user.
// Run: npm run test:transcribe-language
//
// Choosing Telugu gave "Language 'te' is not supported." on screen, because
// the server forced the code and passed OpenAI's refusal straight back.

import { whisperRequest, languageRefused } from '../api/_lib/transcribe.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok    ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}\n        got: ${JSON.stringify(got)}`) }
}

const base = () => { const f = new FormData(); f.append('model', 'whisper-1'); f.append('file', new Blob(['x']), 'a.webm'); return f }
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })
const refusal = reply(400, { error: { message: "Language 'te' is not supported." } })
const good = reply(200, { text: 'remind me to groom Bruno' })

// A fake fetch that records the language each call carried.
function fake(...replies) {
  const calls = []
  const fn = async (_url, init) => { calls.push(init.body.get('language')); return replies[calls.length - 1] }
  return { fn, calls }
}

console.log('\nRecognising a refusal')
ok('the Telugu message is a language refusal', languageRefused({ ok: false, out: { error: { message: "Language 'te' is not supported." } } }))
ok('a quota error is not',   !languageRefused({ ok: false, out: { error: { message: 'You exceeded your current quota.' } } }))
ok('a success is not',       !languageRefused({ ok: true,  out: { text: 'hi' } }))

console.log('\nA refused language falls back to auto-detect')
{
  const { fn, calls } = fake(refusal, good)
  const r = await whisperRequest(base(), 'te', 'k', fn)
  ok('it asked twice',                     calls.length === 2, calls)
  ok('first with the language forced',     calls[0] === 'te', calls)
  ok('then with none',                     calls[1] === null, calls)
  ok('and the user gets the transcript',   r.ok && r.out.text === 'remind me to groom Bruno', r)
}

console.log('\nNothing changes when it works, or when it is not a language problem')
{
  const { fn, calls } = fake(good)
  const r = await whisperRequest(base(), 'hi', 'k', fn)
  ok('an accepted language is one call, forced', calls.length === 1 && calls[0] === 'hi', calls)
  ok('and succeeds', r.ok, r)
}
{
  const { fn, calls } = fake(good)
  await whisperRequest(base(), 'auto', 'k', fn)
  ok('auto sends no language', calls.length === 1 && calls[0] === null, calls)
}
{
  const quota = reply(429, { error: { message: 'You exceeded your current quota.' } })
  const { fn, calls } = fake(quota)
  const r = await whisperRequest(base(), 'hi', 'k', fn)
  ok('an unrelated failure is not retried', calls.length === 1, calls)
  ok('and is reported as it was', !r.ok && r.status === 429, r)
}
{
  const { fn, calls } = fake(refusal, refusal)
  const r = await whisperRequest(base(), 'te', 'k', fn)
  ok('it retries once, never in a loop', calls.length === 2, calls)
  ok('a second failure is still reported', !r.ok, r)
}

console.log(`\ntranscribe language: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
