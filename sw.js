const VERSION = 'docsnap-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'vision.js', 'manifest.webmanifest',
  'vendor/jspdf.umd.min.js', 'tools.js', 'seg.html', 'vendor/pdf-lib.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/opencv.js', 'vendor/tesseract.min.js', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// App shell: network-first (fresh updates), fallback to cache.
// Heavy libs (OpenCV, Tesseract core/worker/language data from CDN): cache-first after first use.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const heavy = u.pathname.includes('/vendor/') || u.hostname.includes('jsdelivr') || u.hostname.includes('tessdata') || u.hostname.includes('unpkg');
  if (heavy) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res;
    }));
  } else if (u.origin === location.origin) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const cl = res.clone(); caches.open(VERSION).then((c) => c.put(req, cl)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
  }
});
