const CACHE = 'cafeteca-v2';
const SHELL = ['/', '/static/manifest.json', '/static/icon-192.png', '/static/icon-512.png'];

// API GET endpoints whose responses can be cached for offline use
const CACHEABLE_API = ['/api/coffees', '/api/options', '/api/stats', '/api/settings'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/api/')) {
    // Only cache GET requests to known read-only endpoints
    if (
      e.request.method === 'GET' &&
      CACHEABLE_API.some(p => url.pathname === p || url.pathname.startsWith(p + '?'))
    ) {
      e.respondWith(
        fetch(e.request)
          .then(res => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE).then(c => c.put(e.request, clone));
            }
            return res;
          })
          .catch(() =>
            caches.match(e.request).then(cached =>
              cached ||
              new Response(
                JSON.stringify({ error: 'Sin conexión con el servidor' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              )
            )
          )
      );
    }
    // All other API calls (mutations, auth): always network, never cache
    return;
  }

  // Static assets: network first, fall back to cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
