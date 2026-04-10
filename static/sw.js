const CACHE = 'cafeteca-v10';
const SHELL = [
  '/',
  '/manifest.json',
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
  '/static/js/brews.js',
  '/static/js/pin.js',
  '/static/js/init.js',
];

// API GET endpoints whose responses can be cached for offline use
const CACHEABLE_API = ['/api/coffees', '/api/options', '/api/stats', '/api/settings'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(SHELL.map(url =>
        fetch(new Request(url, {cache: 'reload'})).then(r => c.put(url, r))
      ))
    ).then(() => self.skipWaiting())
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

  // Skip cross-origin requests — let the browser handle them natively
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Stale-while-revalidate for known read-only endpoints:
    // respond from cache immediately (fast + no radio wake), update cache in background.
    if (
      e.request.method === 'GET' &&
      CACHEABLE_API.some(p => url.pathname === p || url.pathname.startsWith(p + '?'))
    ) {
      e.respondWith(
        caches.open(CACHE).then(c =>
          c.match(e.request).then(cached => {
            const networkFetch = fetch(e.request).then(res => {
              if (res.ok) c.put(e.request, res.clone());
              return res;
            }).catch(() => cached);
            // Serve cached response immediately if available, otherwise wait for network
            return cached || networkFetch;
          })
        )
      );
    }
    // All other API calls (mutations, auth): always network, never cache
    return;
  }

  // Static assets: cache-first.
  // The shell is fully pre-cached on install and the cache name is versioned,
  // so there is no need to hit the network on every load — avoids unnecessary
  // radio activity that drains battery in the background.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      // Not in cache yet (asset added after install): fetch, cache, and return.
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
