// Telling a stale chunk apart from an ordinary bug.
//
// Its own module, and plain .js rather than .jsx, because this classification
// decides whether the app reloads itself and that deserves a test -- which it
// cannot have while it lives inside a component file node cannot parse.
//
// The bug it exists for is written up in src/components/ChunkErrorBoundary.jsx.

/**
 * Is this the stale-chunk fault, as opposed to an ordinary bug?
 *
 * Exported because this classification decides whether the app reloads itself,
 * and every browser words it differently. Both real messages Pippy has
 * actually collected are in the test.
 */
export function isChunkLoadError(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`
  return (
    // Chrome, Edge
    /failed to fetch dynamically imported module/i.test(text) ||
    /error loading dynamically imported module/i.test(text) ||
    // Safari, iOS
    /not a valid javascript mime type/i.test(text) ||
    /importing a module script failed/i.test(text) ||
    // Firefox
    /error loading a module script/i.test(text) ||
    /expected a javascript module script/i.test(text) ||
    // Webpack-era name that some tooling still throws
    /chunkloaderror/i.test(text) ||
    // Vite's own preload helper
    /failed to fetch dynamically imported/i.test(text)
  )
}

// One reload, shared by every caller.
//
// The boundary below catches chunk failures that happen during render. Not all
// of them do: the Supabase client is imported from an effect, and a rejection
// there never reaches a boundary at all -- it would just leave a signed-in
// user looking at the sign-in screen, which reads as "it logged me out"
// rather than "it needs a reload".
//
// Both paths have to share one flag, or each gets its own reload and the
// guarantee that matters -- at most one -- quietly becomes two.
const RELOAD_FLAG = 'pippy_chunk_reload'

/**
 * Reload once to pick up an index.html that names chunks which exist.
 * Returns true if a reload was started, false if one was already spent.
 */
export function reloadOnceForChunkError() {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false   // already tried
    sessionStorage.setItem(RELOAD_FLAG, '1')
    location.reload()
    return true
  } catch {
    // Private mode, blocked storage: reloading without the guard risks a loop,
    // so prefer leaving the caller to show its message.
    return false
  }
}

/** Let the next chunk failure reload again — for a user-initiated retry. */
export function clearChunkReloadGuard() {
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* nothing to clear */ }
}
