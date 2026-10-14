// Service worker for the installable app (PWA).
//   /api/*                       → never touched: straight to the network, nothing cached
//   page navigations (index.html) → network-first; offline.html when there is no network
//   hashed /assets/*, icons, fonts → cache-first
// __BUILD_ID__ is replaced on every `vite build` (see vite.config.ts), so each deploy ships a
// byte-different sw.js: the browser installs it, and `activate` deletes the previous caches.
const VERSION = '__BUILD_ID__'
const CACHE = `wortkontext-${VERSION}`
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/android-chrome-192x192.png', '/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const ICON = /^\/(favicon[^/]*|apple-touch-icon\.png|android-chrome-[^/]+\.png|maskable-[^/]+\.png)$/

function isStatic(url) {
  if (url.origin === self.location.origin) return url.pathname.startsWith('/assets/') || ICON.test(url.pathname)
  // Google Fonts: the stylesheet URL is fixed and the font files are versioned.
  return url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com'
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  // Opaque (no-cors) responses have status 0 — cache them too, that's how cross-origin fonts arrive.
  if (response.ok || response.type === 'opaque') {
    const copy = response.clone()
    caches.open(CACHE).then((cache) => cache.put(request, copy))
  }
  return response
}

async function networkFirstPage(request) {
  try {
    return await fetch(request)
  } catch {
    return (await caches.match(OFFLINE_URL)) ?? Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request))
  } else if (isStatic(url)) {
    event.respondWith(cacheFirst(request))
  }
  // Anything else (sw.js, manifest, …) goes to the network as usual.
})
