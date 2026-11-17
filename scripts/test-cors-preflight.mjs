// Every endpoint must survive a CORS preflight. Run: npm run test:cors
//
// Found by making one real call from the Android app's WebView, which failed
// with "Failed to fetch". The POST itself was fine -- 401, as it should be --
// but the browser never sent it, because the OPTIONS that precedes it came
// back 500 FUNCTION_INVOCATION_FAILED.
//
// The cause, in fourteen files:
//
//   return cors('', 204)
//
// 204 means "no content" and the Response constructor enforces it: a 204 with
// a body, even an empty string, throws. Vercel turns that into a 500.
//
// It survived because the web app is same-origin and so never preflights.
// Nothing exercised this path until the app ran at https://localhost, where
// every single call starts with one. Every network feature would have failed.
//
// So this does not grep for the string. It CALLS each handler with OPTIONS and
// insists on a usable response -- the only check that would have caught it,
// since the code looked perfectly reasonable.

import fs from 'node:fs'
import path from 'node:path'

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

// Enough environment for module-level code that reads it. No secrets: these
// handlers must get as far as answering OPTIONS without any.
process.env.SUPABASE_URL         ||= 'https://stub.supabase.co'
process.env.SUPABASE_SERVICE_KEY ||= 'stub'
process.env.OPENAI_API_KEY       ||= 'stub'
process.env.RESEND_API_KEY       ||= 'stub'

const dir = new URL('../api/_lib/', import.meta.url)
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()

// Endpoints a browser calls cross-origin. The rest are cron or server-to-server
// and are checked only for not crashing if they do answer OPTIONS.
const BROWSER_FACING = new Set([
  'ai-complete.js', 'analyze-document.js', 'transcribe.js', 'share-invite.js',
  'delete-account.js', 'notify-owner.js', 'checkin-email.js',
  'register-provider.js', 'report-error.js',
])

console.log('\nEvery handler answers a preflight without throwing')
for (const f of files) {
  let handler
  try {
    handler = (await import(new URL(f, dir))).default
  } catch (e) {
    ok(`${f} imports`, false, e.message); continue
  }
  if (typeof handler !== 'function') continue

  const req = new Request('https://pippypets.com/api/x', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://localhost',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  })

  let res = null, threw = null
  try { res = await handler(req) } catch (e) { threw = e.message }

  // The failure mode exactly: constructing the response throws, and the
  // platform reports a 500 the browser reads as "no CORS".
  ok(`${f} does not throw on OPTIONS`, threw === null, threw)
  if (threw || !res) continue

  if (BROWSER_FACING.has(f)) {
    ok(`${f} answers 2xx`, res.status >= 200 && res.status < 300, res.status)
    ok(`${f} allows the origin`,
       !!res.headers.get('access-control-allow-origin'),
       res.headers.get('access-control-allow-origin'))
    ok(`${f} allows the content-type header`,
       /content-type/i.test(res.headers.get('access-control-allow-headers') || ''),
       res.headers.get('access-control-allow-headers'))
    // A browser will not send a POST the preflight did not permit.
    ok(`${f} allows POST`,
       /POST/i.test(res.headers.get('access-control-allow-methods') || ''),
       res.headers.get('access-control-allow-methods'))
    // And the body has to be readable, not just constructible.
    let body = null, readErr = null
    try { body = await res.text() } catch (e) { readErr = e.message }
    ok(`${f} body is readable`, readErr === null, readErr)
    if (res.status === 204) ok(`${f} 204 carries no body`, body === '', body)
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
