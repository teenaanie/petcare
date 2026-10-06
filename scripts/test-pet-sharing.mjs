// Sharing a pet: the retry, and what the owner is told. Run: npm run test:pet-sharing
//
// The reported failure: sharing with an address showed "Load failed" on the
// first press and worked on the second. Two things were wrong -- the write had
// no retry, unlike every other write in the app, and the Share screen showed
// Safari's own wording, which reads as Pippy being broken when the request
// simply never left the phone.
//
// The retry has a case that is easy to get backwards and that you would not
// notice by using the screen once: a repeated INSERT can be refused by the
// unique constraint because the FIRST one actually landed. That is a success.

const { inviteMember, friendlyShareError, isDuplicate } =
  await import('../src/lib/petSharing.js')

let pass = 0, fail = 0
const ok = (n, c, got) => {
  if (c) { pass++; console.log(`  ✓ ${n}`) }
  else { fail++; console.log(`  ✗ ${n}\n      got: ${JSON.stringify(got)}`) }
}

// A Supabase stub thin enough to read. `inserts` is the script: one entry per
// attempt, each either a row or an error. `selects` answers the recovery read.
function client({ inserts, existing = null }) {
  const calls = { insert: 0, select: 0 }
  return {
    calls,
    from() {
      return {
        insert() {
          const step = inserts[calls.insert++] ?? { error: { message: 'ran out of script' } }
          return { select: () => ({ single: async () => step }) }
        },
        select() {
          calls.select++
          const eq = () => ({ eq, maybeSingle: async () => ({ data: existing }) })
          return { eq }
        },
      }
    },
  }
}

const LOAD_FAILED = { message: 'TypeError: Load failed' }
const DUPLICATE   = { message: 'duplicate key value violates unique constraint "pet_members_pet_email_unique"', code: '23505' }

console.log('\nThe happy path is untouched')
{
  const c = client({ inserts: [{ data: { id: 'row-1' }, error: null }] })
  const id = await inviteMember(c, 'pet-1', 'sister@example.com', 'viewer')
  ok('the new membership id comes back', id === 'row-1', id)
  ok('and it took one attempt', c.calls.insert === 1, c.calls.insert)
}

console.log('\nA dropped request is retried, which is the reported bug')
{
  // Press once, get "Load failed", and the second press worked. That second
  // press should not have been needed.
  const c = client({
    inserts: [{ data: null, error: LOAD_FAILED }, { data: { id: 'row-2' }, error: null }],
  })
  const id = await inviteMember(c, 'pet-1', 'sister@example.com')
  ok('the invite succeeds without the owner pressing again', id === 'row-2', id)
  ok('and it took exactly two attempts', c.calls.insert === 2, c.calls.insert)
}

console.log('\nA lost RESPONSE is not reported as a failure')
{
  // The dangerous case. The first write LANDED and its reply was lost, so the
  // retry hits the unique constraint. Getting this wrong tells the owner the
  // address already has access -- true, and entirely their own doing.
  const c = client({
    inserts: [{ data: null, error: LOAD_FAILED }, { data: null, error: DUPLICATE }],
    existing: { id: 'row-that-landed' },
  })
  const id = await inviteMember(c, 'pet-1', 'sister@example.com')
  ok('the row that landed is what comes back', id === 'row-that-landed', id)
  ok('and the existing row was actually looked up', c.calls.select === 1, c.calls.select)
}

console.log('\nBut inviting the same person twice still says so')
{
  // A duplicate on the FIRST attempt is the ordinary case, not a lost reply.
  const c = client({ inserts: [{ data: null, error: DUPLICATE }], existing: { id: 'nope' } })
  let thrown = null
  try { await inviteMember(c, 'pet-1', 'sister@example.com') } catch (e) { thrown = e }
  ok('it throws rather than pretending', !!thrown, thrown)
  ok('and never consults the existing row', c.calls.select === 0, c.calls.select)
  ok('and the owner is told plainly',
     friendlyShareError(thrown) === 'That email already has access to this pet.',
     friendlyShareError(thrown))
}

console.log('\nA refusal is never retried')
{
  // net.js is explicit: anything the server ANSWERED would only be refused
  // again, and repeating a write on the strength of an answer is how rows get
  // written twice.
  const rls = { message: 'new row violates row-level security policy', code: '42501' }
  const c = client({ inserts: [{ data: null, error: rls }, { data: { id: 'must-not-happen' }, error: null }] })
  let thrown = null
  try { await inviteMember(c, 'pet-1', 'sister@example.com') } catch (e) { thrown = e }
  ok('it gives up on the first answer', c.calls.insert === 1, c.calls.insert)
  ok('and says who is allowed to share',
     /only its owner can/.test(friendlyShareError(thrown)), friendlyShareError(thrown))
}

console.log('\nWhat the owner actually reads')
{
  // The whole second half of the bug: "Load failed" is Safari's wording for a
  // request that got no reply, and it reached the owner unchanged.
  ok('a dropped request no longer says "Load failed"',
     !/load failed/i.test(friendlyShareError({ message: 'TypeError: Load failed' })),
     friendlyShareError({ message: 'TypeError: Load failed' }))
  ok('it says to try once more',
     /try once more/.test(friendlyShareError({ message: 'Load failed' })),
     friendlyShareError({ message: 'Load failed' }))
  ok('Chrome\'s wording for the same thing is caught too',
     /try once more/.test(friendlyShareError({ message: 'Failed to fetch' })),
     friendlyShareError({ message: 'Failed to fetch' }))
  ok('a missing table still names the file to run',
     /pet_members\.sql/.test(friendlyShareError({ message: 'relation "pet_members" does not exist' })),
     friendlyShareError({ message: 'relation "pet_members" does not exist' }))
  ok('anything else is passed through unchanged',
     friendlyShareError({ message: 'something specific went wrong' }) === 'something specific went wrong')
  ok('a missing error does not throw', typeof friendlyShareError(null) === 'string')
}

console.log('\nRecognising the constraint')
{
  ok('by code', isDuplicate({ code: '23505' }))
  ok('by wording', isDuplicate({ message: 'duplicate key value' }))
  ok('an unrelated error is not one', !isDuplicate({ message: 'permission denied' }))
  ok('nothing is not one', !isDuplicate(null))
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
