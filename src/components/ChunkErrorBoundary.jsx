// What catches a lazy chunk that will not load.
//
// ── The bug this exists for ─────────────────────────────────────────────────
//
// A customer reported that clicking a pet showed a blank screen. The error
// reports said why, in two dialects of the same fault:
//
//   Chrome:  Failed to fetch dynamically imported module:
//            .../assets/Timeline-B1_kSx6E.js
//   Safari:  'text/html' is not a valid JavaScript MIME type.
//
// The sequence:
//
//   1. A tab is left open. A deploy replaces every content-hashed chunk.
//   2. That tab is still running the OLD index.html, so it asks for the old
//      chunk names.
//   3. vercel.json rewrites anything that is not /api/ to /index.html, so the
//      missing chunk came back as HTTP 200 with `text/html` -- the app shell --
//      rather than a 404. The browser refuses it as a module. (Fixed in
//      vercel.json too, so it is now an honest 404.)
//   4. Timeline is the DEFAULT pet tab, so the very first thing clicking a pet
//      does is load that chunk.
//   5. The import rejects. A <Suspense> boundary does not catch a rejection --
//      it only covers the pending state -- so React tears the subtree down and
//      the screen goes blank.
//
// Step 5 is the part that turned a recoverable stale-deploy into "the app is
// broken". Suspense was added for the loading state and the failure state was
// never considered. That is what this fixes.
//
// ── Why reloading is the right recovery, rather than retrying ───────────────
//
// React.lazy caches the result of its import, including a rejection, on the
// lazy object itself. Once an import has failed, re-rendering that component
// replays the same rejection forever, however available the chunk becomes. So
// there is nothing to retry in place.
//
// Reloading fetches the new index.html, which names chunks that do exist. One
// reload, guarded by a sessionStorage flag so a genuinely broken deploy cannot
// put the app in a reload loop -- an infinite refresh is a worse failure than
// an honest error, because the user cannot even read it.

import { Component } from 'react'
import { reportError } from '../lib/errorReport.js'
import { isChunkLoadError, reloadOnceForChunkError, clearChunkReloadGuard } from '../lib/chunkErrors.js'

export default class ChunkErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false, chunk: false }
  }

  static getDerivedStateFromError(error) {
    return { failed: true, chunk: isChunkLoadError(error) }
  }

  componentDidCatch(error) {
    // Report it either way. A chunk failure that keeps happening is a deploy
    // problem worth seeing, not just noise.
    try { reportError(error, { view: this.props.view }) } catch { /* never rethrow */ }

    if (!isChunkLoadError(error)) return
    reloadOnceForChunkError()
  }

  render() {
    if (!this.state.failed) return this.props.children

    // Reached when the reload already happened and it failed again, or when
    // this was not a chunk fault at all.
    return (
      <div className="flex flex-col items-center justify-center text-center gap-3 py-16 px-6">
        <p className="text-sm font-black" style={{ color: '#7a4900' }}>
          {this.state.chunk ? 'This part did not finish loading.' : 'Something went wrong here.'}
        </p>
        <p className="text-xs max-w-xs" style={{ color: '#73775b' }}>
          {this.state.chunk
            ? 'Usually this means Pippy updated while you had it open. Reloading picks up the new version.'
            : 'Your pet records are safe. Reloading usually clears it.'}
        </p>
        <button
          onClick={() => {
            // Clear the guard so the reload is actually attempted this time.
            clearChunkReloadGuard()
            location.reload()
          }}
          className="px-4 py-2 rounded-xl text-sm font-bold"
          style={{ backgroundColor: '#ffde59', color: '#7a4900' }}>
          Reload Pippy
        </button>
      </div>
    )
  }
}
