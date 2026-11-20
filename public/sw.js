// Freigang service worker: offline shell + Web Push. Never touches /api.
const VERSION = '1.1.0'; // same as src/version.js; a new version means a fresh cache
const CACHE = 'freigang-' + VERSION;
const SHELL = ['/', '/app.js', '/style.css', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png', '/icons/icon.svg', '/icons/favicon-32.png',
  '/img/ilford-head.svg', '/img/bonnie-head.svg', '/img/ilford-curled.svg', '/img/bonnie-curled.svg', '/img/ilford-sitting.svg', '/img/bonnie-sitting.svg',
  '/fonts/dm-sans-latin-400-normal.woff2', '/fonts/dm-sans-latin-500-normal.woff2', '/fonts/dm-sans-latin-600-normal.woff2', '/fonts/dm-sans-latin-700-normal.woff2',
  '/fonts/fraunces-latin-500-normal.woff2', '/fonts/fraunces-latin-600-normal.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('/') : null);
    if (hit) return hit;
    throw err;
  }
}

// iOS revokes push permission for sites that receive a push without showing a notification: always show one.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Freigang';
  e.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: d.body || '',
        tag: d.tag || 'freigang',
        renotify: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/favicon-32.png',
        data: { url: d.url || '/' },
        timestamp: d.ts || Date.now(),
      });
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) c.postMessage({ type: 'refresh' });
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        if ('focus' in c) { c.postMessage({ type: 'refresh' }); return c.focus(); }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
