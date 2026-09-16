// Pippy Service Worker — offline caching
//
// Bump CACHE on any change to this file. The activate handler deletes every
// cache whose name does not match, so a bump is what evicts stale entries.
// It sat on v3 across a dozen deploys, which is half of why clients went stale.
const CACHE = 'pippy-v4'

// Assets to pre-cache (shell only — API calls are network-first)
const SHELL = [
  '/',
  '/index.html',
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('push', e => {
  let data = { title: 'Pippy', body: 'You have a reminder due.' }
  try { if (e.data) data = { ...data, ...e.data.json() } } catch {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})

self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Skip non-GET, chrome-extension, and supabase API calls — always network
  if (request.method !== 'GET') return
  if (url.hostname.includes('supabase') || url.hostname.includes('googleapis')) return

  // Navigation requests: network first, fall back to cached index.html (SPA)
  if (request.mode === 'navigate') {
    e.respondWith(
      // 'no-store' bypasses the browser's HTTP cache as well as this one.
      // index.html is what points at /assets/index-<hash>.js, so serving a
      // stale copy pins the user to an old bundle no matter how many times
      // they reload — which is exactly what happened.
      fetch(request, { cache: 'no-store' })
        .catch(() => caches.match('/index.html'))
        // caches.match resolves undefined on a miss, and returning undefined
        // from respondWith fails the navigation outright.
        .then(res => res || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
    )
    return
  }

  // Cache-first is only safe for content-hashed files, whose names change when
  // their contents do. Everything else goes to the network.
  if (!url.pathname.startsWith('/assets/')) return

  // Static assets: cache first
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE).then(c => c.put(request, clone))
          }
          return response
        })
        // Without this, a rejected fetch rejects respondWith and the browser
        // reports an opaque "Load failed" instead of a real status.
        .catch(() => new Response('', { status: 504, statusText: 'Network error' }))
    })
  )
})
