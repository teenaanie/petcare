// The monthly voice ceiling, and who gets which one. Run: npm run test:ceiling
//
// 100 notes a month was sized for a pet parent adding the odd record about
// their own animal. A boarder writes one per animal per day — six in for a week
// is 42, in a quiet week — so they would hit it inside a fortnight, mid-shift,
// and the message would read as the app breaking rather than as a cap.
//
// What is pinned here is the DECISION, not the numbers: who counts as a
// provider, what happens when the lookup fails, and that a failure never hands
// the higher ceiling to somebody who has not earned it.

import { monthlyLimitFor, isActiveProvider } from '../api/_lib/transcribe.js'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok    ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}\n        got: ${JSON.stringify(got)}`) }
}

console.log('\nThe two ceilings')
ok('a pet parent keeps the old one', monthlyLimitFor(false) === 100, monthlyLimitFor(false))
ok('a provider gets the raised one', monthlyLimitFor(true) === 1000, monthlyLimitFor(true))
ok('and it really is higher',        monthlyLimitFor(true) > monthlyLimitFor(false))

// A tiny stand-in for the supabase client: enough of the builder to answer one
// query, and a record of what was asked.
function stub(rows, { error = null } = {}) {
  const seen = {}
  const q = {
    select() { return q },
    eq(col, val) { seen[col] = val; return q },
    or(expr)     { seen.or = expr; return q },
    limit()      { return Promise.resolve({ data: error ? null : rows, error }) },
  }
  return { from(table) { seen.table = table; return q }, seen }
}

console.log('\nWho counts as a provider')
{
  const sb = stub([{ id: 'acc1' }])
  const got = await isActiveProvider(sb, { id: 'u1', email: 'boarder@kennel.test' })
  ok('an active claim says yes', got === true, got)
  ok('it asks provider_accounts',  sb.seen.table === 'provider_accounts', sb.seen.table)
  ok('for ACTIVE claims only',     sb.seen.status === 'active', sb.seen.status)
  // Both, because a claim written by the registration form carries an address
  // and no user_id until its owner first signs in — and that provider should
  // not be metered as a pet parent for the week before adoption catches up.
  ok('matched on id OR address',
     sb.seen.or.includes('user_id.eq.u1') && sb.seen.or.includes('boarder@kennel.test'), sb.seen.or)
}
{
  const got = await isActiveProvider(stub([]), { id: 'u2', email: 'owner@example.com' })
  ok('no claim says no', got === false, got)
}
{
  // An account with no address must not produce `email.ilike.undefined`.
  const sb = stub([])
  await isActiveProvider(sb, { id: 'u3' })
  ok('an account with no address asks only by id', sb.seen.or === 'user_id.eq.u3', sb.seen.or)
}
{
  // The safe direction on failure is the LOW ceiling: a lookup that errors must
  // not hand everybody a provider's allowance.
  const got = await isActiveProvider(stub([], { error: new Error('down') }), { id: 'u4', email: 'a@b.c' })
  ok('a failed lookup falls back to the low ceiling', got === false, got)
}
{
  const got = await isActiveProvider(stub([{ id: 'x' }]), null)
  ok('no user at all is not a provider', got === false, got)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
