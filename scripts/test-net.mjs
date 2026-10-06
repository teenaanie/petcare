// Retrying only what is safe to retry. Run: npm run test:net
//
// The case this exists for, from Supabase's edge log on 2026-09-28: an iPhone
// saved three records, the first two returned 201, and the third never reached
// the server at all — `TypeError: Load failed`, no status, no row.

import { isNetworkError, withRetry } from '../src/lib/net.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

console.log('\nTelling "no reply" apart from "the server said no"')
{
  ok('Safari: Load failed',  isNetworkError(new TypeError('Load failed')), null)
  ok('Chrome: Failed to fetch', isNetworkError(new TypeError('Failed to fetch')), null)
  ok('Firefox: NetworkError', isNetworkError(new TypeError('NetworkError when attempting to fetch resource')), null)
  ok('a timeout counts', isNetworkError(new Error('The request timed out')), null)

  // These are ANSWERS. Retrying them just gets the same answer.
  ok('PGRST116 is not a network error',
     !isNetworkError({ code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' }), null)
  ok('a missing column is not a network error',
     !isNetworkError({ code: '42703', message: 'column "foo" does not exist' }), null)
  ok('a permission refusal is not a network error',
     !isNetworkError({ code: '42501', message: 'permission denied for table reminders' }), null)
  ok('a plain TypeError from our own code is not a network error',
     !isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')")), null)
  ok('nothing is not a network error', !isNetworkError(null) && !isNetworkError(undefined), null)
}

console.log('\nRetrying')
{
  let calls = 0
  const flaky = async () => { calls++; if (calls < 3) throw new TypeError('Load failed'); return 'saved' }
  const out = await withRetry(flaky, { attempts: 3, delayMs: 1 })
  ok('recovers from two dropped requests', out === 'saved' && calls === 3, { out, calls })
}
{
  let calls = 0
  const refused = async () => { calls++; throw { code: '42501', message: 'permission denied' } }
  let threw = null
  try { await withRetry(refused, { attempts: 3, delayMs: 1 }) } catch (e) { threw = e }
  ok('a refusal is tried ONCE and rethrown', calls === 1 && threw?.code === '42501', { calls, threw })
}
{
  let calls = 0
  const dead = async () => { calls++; throw new TypeError('Load failed') }
  let threw = null
  try { await withRetry(dead, { attempts: 2, delayMs: 1 }) } catch (e) { threw = e }
  ok('gives up after the limit and rethrows the real error',
     calls === 2 && /Load failed/.test(threw?.message), { calls, msg: threw?.message })
}
{
  let calls = 0
  const fine = async () => { calls++; return 42 }
  ok('a call that works is made exactly once',
     (await withRetry(fine, { attempts: 3, delayMs: 1 })) === 42 && calls === 1, calls)
}

console.log('\nThe observed batch: 2 written, 3rd dropped, then a retry')
{
  // Mirrors Review.save(): remember what landed, never send it twice.
  const writes = []
  let dropOnce = true
  const saveRow = async (label) => {
    if (label === 'Weight' && dropOnce) { dropOnce = false; throw new TypeError('Load failed') }
    writes.push(label)
  }
  const rows = ['Visit', 'Vaccination', 'Weight']
  const saved = new Set()

  async function runBatch({ attempts }) {
    for (const r of rows) {
      if (saved.has(r)) continue
      await withRetry(() => saveRow(r), { attempts, delayMs: 1 })
      saved.add(r)
    }
  }

  // attempts:1 = no retry, so the batch stops exactly where the phone did.
  let err = null
  try { await runBatch({ attempts: 1 }) } catch (e) { err = e }
  ok('the batch stops on the dropped write', /Load failed/.test(err?.message), err?.message)
  ok('the two that landed are remembered',
     [...saved].join() === 'Visit,Vaccination', [...saved])

  // Pressing Save again must send ONLY the third.
  await runBatch({ attempts: 2 })
  ok('the retry writes only the missing one', writes.join() === 'Visit,Vaccination,Weight', writes)
  ok('nothing was written twice', new Set(writes).size === writes.length, writes)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
