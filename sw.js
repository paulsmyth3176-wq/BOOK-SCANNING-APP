/* ShelfScan service worker: lets the app open with no signal (e.g. inside a bookstore). */
const SHELL = 'shelfscan-shell-v1';
const RUNTIME = 'shelfscan-runtime-v1';
const FILES = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => ![SHELL, RUNTIME].includes(k)).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Book lookups: always go to the network (nothing to show offline anyway).
  if (/openlibrary\.org$|googleapis\.com$/.test(url.hostname) && !url.hostname.startsWith('covers')) return;

  // App files: serve cached copy instantly, refresh it in the background.
  if (url.origin === location.origin){
    e.respondWith(caches.open(SHELL).then(async c => {
      const hit = await c.match(req, {ignoreSearch: true});
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // Covers and the barcode library: cache-first so they work offline.
  if (url.hostname.startsWith('covers.openlibrary') || url.hostname.includes('books.google') || url.hostname === 'cdn.jsdelivr.net'){
    e.respondWith(caches.open(RUNTIME).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }
      catch { return hit || Response.error(); }
    }));
  }
});
