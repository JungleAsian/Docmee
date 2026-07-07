// Docmee InboxOS service worker (Req 23 — PWA foundation).
//   - App shell + offline fallback + icons are precached on install (cache-first).
//   - API calls (`/clinics`, `/conversations`, …, or anything cross-origin to the
//     API) are network-first so the panel always shows fresh data, falling back to
//     cache only when offline.
//   - Page navigations are network-first, falling back to the cached page and
//     finally to /offline.html so a cold offline launch never shows the browser
//     error page.
//   - Everything else (static assets) is cache-first.

const CACHE = 'docmee-inbox-v6'
const OFFLINE_URL = '/offline.html'
const APP_SHELL = [
  '/',
  '/inbox',
  '/manifest.json',
  OFFLINE_URL,
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Best-effort per asset: one missing/uncacheable entry must not abort the
      // whole install (which would leave the SW permanently uninstalled).
      .then((cache) => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function isApiRequest(request) {
  const url = new URL(request.url)
  // Cross-origin requests are the API; same-origin /auth|/clinics|/conversations too.
  if (url.origin !== self.location.origin) return true
  return /^\/(api|auth|clinics|conversations|patients|user|notifications|usage)\b/.test(url.pathname)
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (request.method === 'GET' && response.ok) {
      const cache = await caches.open(CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch (err) {
    const cached = await caches.match(request)
    if (cached) return cached
    throw err
  }
}

// Navigations: try the network, fall back to a cached page, then the offline page.
async function navigationHandler(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch (err) {
    const cached = (await caches.match(request)) || (await caches.match('/'))
    if (cached) return cached
    const offline = await caches.match(OFFLINE_URL)
    if (offline) return offline
    throw err
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (request.method === 'GET' && response.ok) {
    const cache = await caches.open(CACHE)
    cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request))
    return
  }
  event.respondWith(isApiRequest(request) ? networkFirst(request) : cacheFirst(request))
})

// ── Web Push (Req 39 — mobile alerts for the installed PWA) ──────────────────
// A pushed secretary alert carries a small JSON payload (title/body/tag/url, see
// buildPushPayload in @docmee/notifications). Render it as a system notification
// even when the panel is closed.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Docmee'
  const options = {
    body: data.body || '',
    tag: data.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/inbox' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// Focus an existing panel window (navigating it to the deep link) or open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/inbox'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => {})
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
