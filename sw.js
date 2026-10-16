const VERSION = 'docsnap-v9';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'vision.js', 'cvworker.js', 'manifest.webmanifest',
  'tools.js', 'camera.js', 'seg.html', 'seg.js', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
// Heavy engines are fetched in the background after install so they never slow the first visit.
const HEAVY = ['vendor/jspdf.umd.min.js', 'vendor/pdf-lib.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/opencv.js', 'vendor/tesseract.min.js',
  'vendor/tesseract/worker.min.js', 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/lang/eng.traineddata.gz'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => { setTimeout(() => caches.open(VERSION).then(async (c) => { for (const u of HEAVY) { if (!(await c.match(u))) { try { await c.add(u); } catch {} } } }), 8000); }));
});
// App shell: network-first (fresh updates), fallback to cache.
// Heavy libs (OpenCV, Tesseract worker/core/language data, all self-hosted under vendor/): cache-first after first use.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return; // DocSnap never talks to other hosts (CSP enforces this too)
  const heavy = u.pathname.includes('/vendor/');
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
