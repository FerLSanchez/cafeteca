const CACHE = 'cafeteca-v2';
const SHELL = [
  '/',
  '/static/manifest.json',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/static/css/variables.css',
  '/static/css/reset.css',
  '/static/css/components.css',
  '/static/css/pages.css',
  '/static/js/main.js',
  '/static/js/api.js',
  '/static/js/state.js',
  '/static/js/auth/pin.js',
  '/static/js/components/modal.js',
  '/static/js/components/autocomplete.js',
  '/static/js/components/rating.js',
  '/static/js/components/calendar.js',
  '/static/js/pages/list.js',
  '/static/js/pages/stats.js',
  '/static/js/pages/catalog.js',
  '/static/js/pages/settings.js',
];

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

  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/static/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

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
