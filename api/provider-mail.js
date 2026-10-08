// Both outbound-mail endpoints the provider platform needs, in ONE serverless
// function.
//
// Not a style choice. This project is on a Vercel plan that allows 12
// serverless functions per deployment, and it was already at exactly 12 — so
// adding a thirteenth file under api/ fails the build with nothing wrong in the
// code. Local `npm run build` cannot see it, because it is a platform limit and
// not a bundling one. The symptom is a Vercel commit status of `failure` while
// every check run reports success.
//
// So new api/ entry points are expensive now. Prefer adding an `op` to an
// existing one, as here, and keep the handlers themselves in api/_lib/ where
// they stay separately testable — test:provider-alert and test:broadcast both
// import the _lib module directly and never go through this file.
//
//   /api/provider-mail?op=broadcast     a business mailing its customers
//   /api/provider-mail?op=stay-update   an owner hearing their pet's boarder posted
//   /api/provider-mail?op=inform        a business hearing a customer sent a note
//   /api/provider-mail                  an admin hearing about provider feedback
//
// The default is feedback rather than an error so that a mis-typed op cannot
// silently become a broadcast, which is the one of the two that mails people
// who did not ask for it.

import feedbackHandler   from './_lib/notify-provider-feedback.js'
import broadcastHandler  from './_lib/provider-broadcast.js'
import stayUpdateHandler from './_lib/stay-update-email.js'
import informHandler     from './_lib/inform-provider-email.js'
import { toVercel } from './_adapt.js'

async function handler(req) {
  let op = ''
  try { op = new URL(req.url).searchParams.get('op') || '' } catch { /* keep the default */ }
  if (op === 'broadcast')   return broadcastHandler(req)
  if (op === 'stay-update') return stayUpdateHandler(req)
  if (op === 'inform')      return informHandler(req)
  return feedbackHandler(req)
}

export default toVercel(handler)
