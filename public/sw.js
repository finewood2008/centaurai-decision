// CentaurAI WebUI Service Worker
// Caches static assets for fast repeat loads and limited offline support.
// API calls always go network-first — this is a live LAN app, not static content.
// Versioned caches ensure clean upgrades.

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `centaurai-static-${CACHE_VERSION}`;
const APP_SHELL = `centaurai-shell-${CACHE_VERSION}`;

// Static assets to precache on install — the app shell
const APP_SHELL_FILES = ['./', './index.html'];

// File extensions to cache when fetched from network
const STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|json|webmanifest)$/i;

// API paths — always network-first, never cached
const API_PATH = /\/api\//;

// ── Install: precache app shell ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL)
      .then((cache) => {
        return cache.addAll(APP_SHELL_FILES).catch((err) => {
          console.warn('[CentaurAI SW] App shell precache partial:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key.startsWith('centaurai-') && key !== STATIC_CACHE && key !== APP_SHELL)
            .map((key) => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache strategies ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API calls: network-first, no caching
  if (API_PATH.test(url.pathname)) {
    event.respondWith(fetch(request));
    return;
  }

  // Static assets: cache-first with network fallback
  if (STATIC_EXTENSIONS.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // Navigation / HTML: network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(APP_SHELL).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          return cached || caches.match('./');
        });
      })
  );
});
