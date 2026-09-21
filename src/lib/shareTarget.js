// src/lib/shareTarget.js
// Reads the files the service worker stashed when something was shared into
// Pippy from another app.
//
// The handoff is IndexedDB because it is the only thing that works: at redirect
// time the page may not exist yet, so postMessage is lost, and localStorage
// cannot hold binary. See the matching half in public/sw.js.
//
// Android/Chrome only — iOS Safari has no Web Share Target. Everything here is
// additive, so on iOS it simply never fires.

const DB = 'pippy-share'
const STORE = 'incoming'

function open_() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

/**
 * Takes everything out of the store and empties it in the same transaction.
 *
 * Draining rather than reading matters: without it a refresh re-imports the
 * same documents, and each one is a paid AI call.
 */
export async function drainSharedFiles() {
  if (typeof indexedDB === 'undefined') return []
  let db
  try { db = await open_() } catch { return [] }
  try {
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const all = store.getAll()
      all.onsuccess = () => { store.clear(); resolve(all.result || []) }
      all.onerror   = () => reject(all.error)
    })
    return rows.map(r => r.file).filter(Boolean)
  } catch {
    return []
  } finally {
    db.close()
  }
}

/** Was this load the result of a share? */
export function wasShared() {
  try { return new URLSearchParams(window.location.search).get('shared') === '1' }
  catch { return false }
}

/**
 * Drop the marker so a reload does not look like a fresh share. replaceState
 * rather than a navigation, which would throw the files away.
 */
export function clearSharedFlag() {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('shared')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  } catch { /* nothing depends on this succeeding */ }
}

/**
 * Should we mention sharing into the app at all?
 *
 * Web Share Target is Android/Chromium only — iOS Safari has no implementation,
 * and telling an iPhone owner to share from WhatsApp would send them looking for
 * something that isn't there. Crude UA sniffing, but the capability genuinely
 * cannot be feature-detected from the page: the manifest entry is read by the
 * browser at install time, not exposed to script.
 */
export function shareTargetLikelySupported() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
  if (isIOS) return false
  return /Android/.test(ua) && /Chrome|Chromium|SamsungBrowser/.test(ua)
}
