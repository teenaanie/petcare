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

// Where the user was when the chunk failed.
//
// The reload below fixes the stale chunk and then drops the user on the pet
// list, because the open pet and the open tab are React state and nothing
// survives a reload. That is what made a transient fetch failure read as "it
// threw me out of the record I was editing".
//
// Kept in sessionStorage, not localStorage: it is about this tab, right now,
// and must not resurrect a pet in some other window next week.
const RESUME_KEY = 'pippy_chunk_resume'

// The current place, kept up to date by the app as the user moves. A module
// variable rather than an argument because the two reload sites are in
// different files -- one a render boundary, one an effect -- and neither has
// the pet or the tab to hand.
let place = null

/** Tell the module where the user is, so a forced reload can come back to it. */
export function rememberPlace(next) { place = next || null }

/**
 * Take back the place a chunk reload interrupted, if this load is that reload.
 *
 * Storage is cleared on the first call, so the resume point cannot survive
 * into the NEXT load and yank the user into a pet they did not ask for. But
 * the answer is then held and returned to every later caller in THIS load.
 *
 * That second half is not a nicety. Read-once-and-forget looks equivalent and
 * is not: React may render a component many times and, under StrictMode,
 * mount it twice. A caller that reads this while initialising state gets the
 * place on the first mount and null on the second, so the restore silently
 * stops happening -- which is exactly what it did, and only a trace of
 * sessionStorage showed the value being read and then thrown away.
 */
let taken = false
let takenPlace = null
export function takeRememberedPlace() {
  if (taken) return takenPlace
  taken = true
  try {
    const raw = sessionStorage.getItem(RESUME_KEY)
    if (!raw) return null
    sessionStorage.removeItem(RESUME_KEY)
    const parsed = JSON.parse(raw)
    // Anything unrecognised is dropped rather than trusted. This is the one
    // input that steers navigation on boot.
    takenPlace = parsed && typeof parsed.petId === 'string' ? parsed : null
    return takenPlace
  } catch { return null }
}

/** Test seam: forget that this load already read its resume point. */
export function resetRememberedPlaceForTests() { taken = false; takenPlace = null; place = null }

/**
 * Reload once to pick up an index.html that names chunks which exist.
 * Returns true if a reload was started, false if one was already spent.
 */
export function reloadOnceForChunkError() {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false   // already tried
    sessionStorage.setItem(RELOAD_FLAG, '1')
    // Stashed before the reload, so the user comes back to the record they
    // were in rather than to the pet list.
    if (place && typeof place.petId === 'string') {
      try { sessionStorage.setItem(RESUME_KEY, JSON.stringify(place)) } catch { /* not worth failing the reload over */ }
    }
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
