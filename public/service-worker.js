const CACHE_NAME = 'cornerstone-static-v1';
const PRECACHE_URLS = [
  '/',
  '/Index.html',
  '/BCC.html',
  '/map-theme.css',
  '/styles.css',
  '/images/Flavour icon.png',
  '/images/250916 Cornerstone Logo.png'
];

async function cachePut(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
  } catch (err) {
    console.warn('SW cache put failed:', err);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Keep HTML/network-first so updates are not blocked
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          cachePut(request, response.clone());
          return response;
        })
        .catch(() =>
          caches.match(request).then(match => match || caches.match('/Index.html'))
        )
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            cachePut(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'force-skip-waiting') {
    self.skipWaiting();
  }
});
