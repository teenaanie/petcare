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
