/* UniGate Driver service worker: an offline-capable app shell, registered with a scope limited to the
   driver pages. Everything is network-first with the cached copy as the offline fallback (so a
   rebuilt chunk is never served stale); API calls are never cached — tracking samples are queued by
   the page itself (lib/driver/tracker.ts) and flushed in order. */
const VERSION = 'ug-driver-v2';
const OFFLINE_URL = '/ar/driver/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll([OFFLINE_URL, '/driver.webmanifest', '/icons/driver-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/rt/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE_URL))));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
  }
});
