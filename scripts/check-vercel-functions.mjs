// Vercel turns every file under api/ into its own serverless function, and this
// project's plan allows 12 per deployment. Run: npm run check:functions
//
// This exists because going over costs a deploy and tells you nothing useful:
// `npm run build` passes, every GitHub check run reports success, and the only
// signal is a Vercel COMMIT STATUS of `failure` pointing at a log you need
// Vercel credentials to read. It took a failed PR to work that out.
//
// Files beginning with `_` are shared modules, not routes, and are not counted
// — which is also the way out when this fails: keep the handler in api/_lib/
// and give an existing entry point an `op`, as api/provider-mail.js does.

import { readdirSync } from 'node:fs'

const LIMIT = 12

const entries = readdirSync('api')
  .filter(f => f.endsWith('.js'))
  .filter(f => !f.startsWith('_'))
  .sort()

for (const f of entries) console.log(`      /api/${f.replace(/\.js$/, '')}`)

if (entries.length > LIMIT) {
  console.log(`\nFAIL  ${entries.length} serverless functions, and the plan allows ${LIMIT}.`)
  console.log('      Fold one into an existing entry point: keep the handler in')
  console.log('      api/_lib/ and dispatch on a query param, like api/provider-mail.js.')
  process.exit(1)
}

console.log(`\nok    ${entries.length}/${LIMIT} serverless functions`)
