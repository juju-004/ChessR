// Deliberately minimal — this app is real-time/socket-driven (live games,
// clocks, chat), so aggressively caching API responses or game state would
// risk serving stale board positions. The only job here is to satisfy the
// "has a registered service worker" requirement most browsers impose before
// they'll consider the site installable, plus cache the small set of static
// shell assets so the app shell loads instantly (and works if briefly
// offline) — actual game data always goes over the network/sockets live.

const SHELL_CACHE = 'chess-app-shell-v1';
const SHELL_ASSETS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Never intercept API calls or the Socket.IO transport — those must always
  // hit the network live. Only serve cached shell assets for simple same-
  // origin navigations/static files, network-first so updates aren't stuck
  // behind a stale cache.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/'))),
  );
});
