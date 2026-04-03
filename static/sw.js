const CACHE = 'cafeteca-v3';
const SHELL = [
  '/',
  '/static/manifest.json',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/static/css/style.css',
  '/static/js/state.js',
  '/static/js/api.js',
  '/static/js/utils.js',
  '/static/js/chips.js',
  '/static/js/autocomplete.js',
  '/static/js/options.js',
  '/static/js/list.js',
  '/static/js/filters.js',
  '/static/js/detail.js',
  '/static/js/form.js',
  '/static/js/stats.js',
  '/static/js/catalog.js',
  '/static/js/pin.js',
  '/static/js/init.js',
];

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

  // Skip cross-origin requests (Google Fonts, etc.) — let the browser handle them natively
  if (url.origin !== location.origin) return;

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
