// Keeps the app and the panels opened in field mode available without signal. Pages and built
// files come from the network when possible, else from the copy kept here; panel data the
// same. Nothing is kept for pages that are not signed-in reads, and signing out clears it.

const VERSION = 'cbt-1';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

// Reads field mode needs offline: who is signed in, the location tree, panel lists and panels.
const DATA_PATHS = [/^\/api\/auth\/(me|config)$/, /^\/api\/locations$/, /^\/api\/panels$/, /^\/api\/panels\/\d+$/];

/** The app page and the built files it loads first, so it opens with no connection. */
async function precache() {
  const cache = await caches.open(SHELL);
  const res = await fetch('/', { cache: 'no-cache' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put('/', res);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await cache.addAll([...new Set(assets)]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(`${VERSION}-`)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear-data') event.waitUntil(caches.delete(DATA));
});

/** Network first; keep a copy of good answers; fall back to the copy. */
async function networkFirst(request, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(key ?? request, res.clone());
    // Signed out: forget what was kept for the last person.
    if (res.status === 401 && cacheName === DATA) await caches.delete(DATA);
    return res;
  } catch (err) {
    const copy = await cache.match(key ?? request);
    if (copy) return copy;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const copy = await cache.match(request);
  if (copy) return copy;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Every page is the same app; keep one copy of it.
    event.respondWith(networkFirst(request, SHELL, '/'));
  } else if (url.pathname.startsWith('/assets/')) {
    // Built files have content hashes in their names, so a copy never goes stale.
    event.respondWith(cacheFirst(request));
  } else if (DATA_PATHS.some((re) => re.test(url.pathname)) && !url.search) {
    event.respondWith(networkFirst(request, DATA));
  }
});
