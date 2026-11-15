// Keeps the app itself available offline. NASA data is cached separately on the device.
const CACHE = 'terra-v14';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'js/engine.js', 'js/crops.js', 'js/nasa.js', 'js/charts.js', 'js/i18n.js', 'js/art.js', 'js/worker.js', 'js/et.js', 'js/economics.js', 'js/local.js', 'js/gibs.js', 'js/account.js', 'js/firebase-config.js', 'data/validation.json', 'data/ama.json', 'assets/icon.svg', 'manifest.webmanifest', 'data/demo.json', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))).then(() => self.skipWaiting()))));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
