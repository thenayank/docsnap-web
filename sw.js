const VERSION = 'docsnap-v16'; // 3.5.1 recovery lockout, strict backup header, Aadhaar QR both sides
const BUILD = '3.5.1'; // must match the ?v= on the <script>/<link> tags in index.html
const SHELL = ['./', 'index.html', 'tokens.css?v=' + BUILD, 'styles.css?v=' + BUILD, 'assets/paper-grain-128.png', 'app.js?v=' + BUILD, 'vision.js?v=' + BUILD, 'cvworker.js', 'detector-v2.js', 'detector-v3.js', 'manifest.webmanifest',
  'tools.js?v=' + BUILD, 'camera.js?v=' + BUILD, 'vault.js?v=' + BUILD, 'mydocs.js?v=' + BUILD, 'mydocs.css?v=' + BUILD, 'vendor/hash-wasm/argon2.umd.min.js', 'seg.html', 'seg.js', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'splash/splash-light-1179x2556.png', 'splash/splash-dark-1179x2556.png', 'splash/splash-light-1290x2796.png', 'splash/splash-dark-1290x2796.png', 'splash/splash-light-1170x2532.png', 'splash/splash-dark-1170x2532.png', 'splash/splash-light-1125x2436.png', 'splash/splash-dark-1125x2436.png', 'splash/splash-light-1284x2778.png', 'splash/splash-dark-1284x2778.png', 'splash/splash-light-828x1792.png', 'splash/splash-dark-828x1792.png', 'splash/splash-light-1242x2688.png', 'splash/splash-dark-1242x2688.png', 'splash/splash-light-750x1334.png', 'splash/splash-dark-750x1334.png'];
// Heavy engines are fetched in the background after install so they never slow the first visit.
const HEAVY = ['vendor/jspdf.umd.min.js', 'vendor/pdf-lib.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/opencv.js', 'vendor/tesseract.min.js',
  'vendor/tesseract/worker.min.js', 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/lang/eng.traineddata.gz'];
self.addEventListener('install', (e) => {
  // cache:'reload' → every shell file comes from the server, never from the browser's HTTP cache (Shuri 3.5.1: a stale
  // 3.5.0 vault.js was precached next to the 3.5.1 mydocs.js and the recovery screen went dead).
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
    // cache:'no-cache' → always revalidate with the server (ETag / 304), so a fresh-looking stale copy in the HTTP cache is never used.
    let fr; try { fr = new Request(req, { cache: 'no-cache' }); } catch (err) { fr = req; }
    e.respondWith(fetch(fr).then((res) => {
      if (res.ok) { const cl = res.clone(); caches.open(VERSION).then((c) => c.put(req, cl)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
  }
});
