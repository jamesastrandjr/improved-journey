/* App-shell cache so the app opens instantly / offline. Live data always goes to the network. */
const V = 'wsif-v5', SHELL = ['./', 'index.html', 'style.css', 'icon.svg', 'manifest.webmanifest', 'js/astro.js', 'js/model.js', 'js/reports.js', 'js/bathy.js', 'js/data.js', 'js/map.js', 'js/app.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // network-first (fresh code when online), fall back to cache offline
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
