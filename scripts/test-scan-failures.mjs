// What a pet parent sees, and what the owner gets told, when a document scan
// fails for a reason that is ours. Run: npm run test:scan-failures
//
// Why this exists: scanning broke for a real customer with
// "the API key for AI analysis is invalidated" -- OpenAI's own words, relayed
// straight through to someone who cannot act on them, while the owner got no
// signal at all and found out only because the customer said so. Three things
// were wrong and all three are checked here: no guard on a missing key, the
// upstream message passed through verbatim, and nothing recorded anywhere.

process.env.SUPABASE_URL         = 'https://stub.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'service-stub'
process.env.MONTHLY_SCAN_LIMIT   = '30'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

const USER_ID = '11111111-2222-3333-4444-555555555555'

// Everything the handler touches goes out over fetch -- Supabase auth,
// PostgREST, and OpenAI alike -- so one stub covers all of it, and the rows
// the handler tries to write are observable rather than inferred.
function harness({ openai, existingFaultRows = 0 }) {
  const inserted = []
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url)
    const res = (body, status = 200, headers = {}) =>
      new Response(JSON.stringify(body), {
        status, headers: { 'content-type': 'application/json', ...headers },
      })

    if (u.includes('/auth/v1/user')) return res({ id: USER_ID, aud: 'authenticated' })

    if (u.includes('/rest/v1/api_usage'))
      return res([], 200, { 'content-range': '0-0/0' })

    if (u.includes('/rest/v1/client_errors')) {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        inserted.push(JSON.parse(opts.body))
        return res([], 201)
      }
      // the dedupe count
      return res([], 200, { 'content-range': `0-0/${existingFaultRows}` })
    }

    if (u.includes('api.openai.com')) return openai()

    throw new Error('unexpected fetch: ' + u)
  }
  return { inserted }
}

const call = async (handler, { token = 'jwt-stub' } = {}) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  const res = await handler(new Request('https://pippypets.com/api/analyze-document', {
    method: 'POST', headers, body: JSON.stringify({ base64: 'AAAA' }),
  }))
  return { status: res.status, body: await res.json() }
}

// The key is read at module load, so each scenario needs its own import.
let n = 0
const load = async key => {
  if (key === null) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = key
  return (await import(`../api/_lib/analyze-document.js?case=${n++}`)).default
}

const REAL_OPENAI_401 = {
  error: {
    message: 'Incorrect API key provided: sk-proj-************************AbCd. '
           + 'You can find your API key at https://platform.openai.com/account/api-keys.',
    type: 'invalid_request_error', code: 'invalid_api_key',
  },
}

console.log('\nNo key set at all')
{
  const { inserted } = harness({ openai: () => { throw new Error('must not be called') } })
  const handler = await load(null)
  const { status, body } = await call(handler)

  // Before the guard this sent `Bearer undefined` to OpenAI and relayed the
  // refusal back. 503 also distinguishes absent from refused from outside,
  // which is the only way to tell the two apart without the dashboard.
  ok('answers 503, not a relayed upstream error', status === 503, { status, body })
  ok('the pet parent is told what to do instead',
     /add the details by hand/i.test(body.error), body.error)
  ok('the variable name is not leaked to the customer',
     !/OPENAI_API_KEY/.test(body.error), body.error)
  ok('the owner gets a row naming the variable',
     inserted.length === 1 && /OPENAI_API_KEY/.test(inserted[0].message), inserted)
  ok('it is filed against this endpoint, not a browser view',
     inserted[0]?.view === 'server:analyze-document', inserted[0])
  ok('kind is one the check constraint allows',
     ['handled', 'uncaught'].includes(inserted[0]?.kind), inserted[0]?.kind)
}

console.log('\nKey set but refused by OpenAI')
{
  const { inserted } = harness({
    openai: () => new Response(JSON.stringify(REAL_OPENAI_401), {
      status: 401, headers: { 'content-type': 'application/json' },
    }),
  })
  const handler = await load('sk-proj-dead')
  const { status, body } = await call(handler)

  ok('answers 502', status === 502, { status, body })
  ok("OpenAI's wording never reaches the customer",
     !/Incorrect API key/i.test(body.error) && !/sk-proj/.test(body.error), body.error)
  ok('the customer gets the same plain sentence',
     /add the details by hand/i.test(body.error), body.error)
  ok('the real reason is kept for the owner',
     /Incorrect API key/i.test(inserted[0]?.message || ''), inserted[0])
  ok('the owner is told to regenerate and redeploy',
     /redeploy/i.test(inserted[0]?.message || ''), inserted[0])
  ok('a refused key is its own fingerprint, not lumped in with transient faults',
     inserted[0]?.fingerprint === 'server:analyze-document|openai-key-refused',
     inserted[0]?.fingerprint)
  ok('the affected user is recorded', inserted[0]?.user_id === USER_ID, inserted[0]?.user_id)
}

console.log('\nOpenAI unreachable')
{
  const { inserted } = harness({ openai: () => { throw new TypeError('fetch failed') } })
  const handler = await load('sk-proj-live')
  const { status, body } = await call(handler)

  ok('answers 502', status === 502, { status, body })
  ok('the customer is not shown the network error',
     !/fetch failed/.test(body.error), body.error)
  ok('the network error is recorded',
     /fetch failed/.test(inserted[0]?.message || ''), inserted[0])
  ok('it is a different fingerprint from a refused key',
     inserted[0]?.fingerprint === 'server:analyze-document|openai-unreachable',
     inserted[0]?.fingerprint)
}

console.log('\nThe same fault, already reported in the last hour')
{
  // A dead key fails for every customer, every time. One row an hour is a
  // signal; one row per scan is a flood, and the endpoint can be reached
  // without a token at all.
  const { inserted } = harness({
    openai: () => { throw new Error('must not be called') },
    existingFaultRows: 1,
  })
  const handler = await load(null)
  const { status } = await call(handler)
  ok('the customer still gets an answer', status === 503)
  ok('no second row is written', inserted.length === 0, inserted)
}

console.log('\nA working scan is untouched')
{
  const { inserted } = harness({
    openai: () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ type: 'vaccination', summary: 'ok' }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  const handler = await load('sk-proj-live')
  const { status, body } = await call(handler)
  ok('answers 200', status === 200, { status, body })
  ok('the parsed result comes back', body.result?.type === 'vaccination', body.result)
  ok('nothing is filed as a fault', inserted.length === 0, inserted)
}

console.log('\nNo token still answers 401, so a probe can tell key-absent from key-present')
{
  harness({ openai: () => { throw new Error('must not be called') } })
  const handler = await load('sk-proj-live')
  const { status } = await call(handler, { token: null })
  ok('401 when the key is present', status === 401, status)

  harness({ openai: () => { throw new Error('must not be called') } })
  const noKey = await load(null)
  const { status: s2 } = await call(noKey, { token: null })
  ok('503 when the key is absent', s2 === 503, s2)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
