// ═══════════════════════════════════════════
//  LumeLine Service Worker v0.1.0
//  Trust Layer Ecosystem
// ═══════════════════════════════════════════

const CACHE_NAME = 'lumeline-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/shared.js',
  '/manifest.json',
  '/assets/icons/icon-512.png',
];

// ─── Install: Pre-cache static shell ───
self.addEventListener('install', (event) => {
  console.log('🛡️ LumeLine SW: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: Clean old caches ───
self.addEventListener('activate', (event) => {
  console.log('🛡️ LumeLine SW: Activating...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch Strategy ───
// API calls: Network-first with cache fallback
// Static assets: Cache-first with network fallback
// Images: Cache-first, lazily cache on fetch
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // API calls — network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful API responses for offline use
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline — serve cached API data
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return new Response(JSON.stringify({ error: 'Offline', cached: false }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // Images — cache-first, lazy-cache
  if (url.pathname.startsWith('/assets/images/') || url.pathname.endsWith('.png') || url.pathname.endsWith('.jpg') || url.pathname.endsWith('.webp')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // Static assets — cache-first with network update
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => null);

      return cached || networkFetch || new Response('Offline', { status: 503 });
    })
  );
});

// ─── Background Sync (for future pick submissions) ───
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-picks') {
    console.log('🔄 LumeLine SW: Syncing picks...');
    // Future: retry failed pick submissions
  }
});

// ─── Push Notifications (future) ───
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'LumeLine Alert', {
      body: data.body || 'New consensus pick available',
      icon: '/assets/icons/icon-512.png',
      badge: '/assets/icons/icon-512.png',
      vibrate: [200, 100, 200],
      tag: data.tag || 'lumeline-alert',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
