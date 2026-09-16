/* Speech Practice service worker.
   Bump VERSION whenever shell files (html/css/js/icons) change. */
const VERSION = 'v6';
const CACHE = `speech-practice-${VERSION}`;

/* Keep in sync with FIREBASE_SDK in js/firebase-config.js. */
const FIREBASE_SDK = '12.19.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK}`;

const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/recorder.js',
  './js/cloud.js',
  './js/cloud-client.js',
  './js/firebase-config.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];
const VENDOR = [`${CDN}/firebase-app.js`, `${CDN}/firebase-auth.js`, `${CDN}/firebase-firestore.js`];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'reload' bypasses the HTTP cache so a version bump never precaches stale files.
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    // Versioned, immutable vendor files; served with CORS so the cached copies are usable.
    await cache.addAll(VENDOR.map((u) => new Request(u, { mode: 'cors' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.href.startsWith(CDN + '/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return; // Firebase Auth / Firestore traffic
  if (url.pathname === '/data/exercises.json') {
    event.respondWith(new Response('Removed: exercise data requires sign-in.', { status: 410 }));
    return;
  }
  if (url.pathname.startsWith('/__/auth/')) return; // Firebase manages verification/reset pages.

  // Exercise data: always try the network so edits show up; fall back to cache offline.
  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(req));
    return;
  }
  // App shell: serve from cache immediately, refresh in the background.
  event.respondWith(staleWhileRevalidate(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req)
    .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  if (hit) return hit;
  const res = await refresh;
  if (res) return res;
  if (req.mode === 'navigate') {
    const index = await cache.match('./index.html');
    if (index) return index;
  }
  return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}
