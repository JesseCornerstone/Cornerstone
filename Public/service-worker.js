const CACHE_NAME = 'lot-wise-static-v16';
const PRECACHE_URLS = [
  '/',
  '/Index.html',
  '/BCC.html',
  '/map-theme.css',
  '/theme.css',
  '/theme.js',
  '/styles.css',
  '/fonts/hanken-grotesk-latin.woff2',
  '/fonts/hanken-grotesk-latin-ext.woff2',
  '/fonts/hanken-grotesk-italic-latin.woff2',
  '/fonts/hanken-grotesk-italic-latin-ext.woff2',
  '/images/lot-wise-icon.png',
  '/images/lot-wise-logo-white.png',
  '/images/lot-wise-logo-black.png'
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

  // Scripts must be network-first so shared module updates are not held by an old cache.
  if (url.pathname.endsWith('.js') || url.pathname.includes('/Js/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            cachePut(request, response.clone());
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for non-script static assets
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
