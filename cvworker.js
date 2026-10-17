'use strict';
/* DocSnap vision worker: OpenCV runs here so detection / warp / filters never freeze the UI. */
self.HTMLImageElement = self.HTMLImageElement || function () {};
self.HTMLCanvasElement = self.HTMLCanvasElement || OffscreenCanvas;
self.document = self.document || { createElement: () => new OffscreenCanvas(1, 1), getElementById: () => null };
importScripts('vendor/opencv.js', 'vision.js', 'detector-v2.js');
let ready = false; const queue = [];
(function wait() {
  try { if (self.cv && self.cv.Mat) { new cv.Mat().delete(); ready = true; queue.splice(0).forEach(handle); postMessage({ ready: true }); return; } } catch {}
  setTimeout(wait, 30);
})();
const toCanvas = async (src) => {
  const bmp = src instanceof Blob ? await createImageBitmap(src) : src; // cloned bitmap (not transferred) so jobs can be retried
  const c = new OffscreenCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close && bmp.close(); return c;
};
const fit = (c, maxLong) => {
  if (!maxLong || Math.max(c.width, c.height) <= maxLong) return c;
  const k = maxLong / Math.max(c.width, c.height), o = new OffscreenCanvas(Math.round(c.width * k), Math.round(c.height * k));
  const x = o.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, o.width, o.height); return o;
};
const jpeg = (c, q = 0.92) => c.convertToBlob({ type: 'image/jpeg', quality: q });
const OPS = {
  async detect({ src }) { const c = await toCanvas(src); const d = Vision.detect(cv, c); return d && Vision.fullFrame(d.q, c.width, c.height) ? null : d; },
  async warp({ src, q, outLong, rawQ }) {
    const c = await toCanvas(src); const w = Vision.warp(cv, c, q, outLong);
    const out = { orig: await jpeg(w, 0.92), w: w.width, h: w.height };
    if (rawQ) out.raw = await jpeg(c, rawQ);
    return out;
  },
  async filter({ src, name, bc, maxLong, quality }) {
    const c = fit(await toCanvas(src), maxLong);
    const o = Vision.filter(cv, c, name, bc);
    return { blob: await jpeg(o, quality || 0.92), w: o.width, h: o.height };
  },
  // live camera: small frame (~500px long side) → corners; the frame canvas is reused between calls
  async detectLive({ src, conf: CONF_FLAG = 0.4, book = false }) {
    // 3.3.2: frames arrive at ~960px. v1 runs on a 480px copy (speed); v2's confidence is taken on the 960px frame, because
    // at 480px it under-rates real pages (pure-v2 gate would hide 'Page found' on most real books and covers)
    let F = self._liveF; if (!F || F.width !== src.width || F.height !== src.height) F = self._liveF = new OffscreenCanvas(src.width, src.height);
    F.getContext('2d').drawImage(src, 0, 0); src.close && src.close();
    const f = Math.min(1, 480 / Math.max(F.width, F.height)), w4 = Math.round(F.width * f), h4 = Math.round(F.height * f);
    let c = self._liveC; if (!c || c.width !== w4 || c.height !== h4) c = self._liveC = new OffscreenCanvas(w4, h4);
    c.getContext('2d').drawImage(F, 0, 0, w4, h4);
    const t = performance.now(), d0 = Vision.detect(cv, c);
    const d = d0 && { ...d0, q: d0.q.map((p) => ({ x: p.x / f, y: p.y / f })) };
    // live gate (3.3.1): the outline only shows for a confident, edge-supported, not-frame-sized quad
    // + hard full-frame rule (never 'Page found' on a > FRAME_MAX quad, whatever the confidence) + v2 confidence ≥ CONF_FLAG
    let ok = d && d.score >= 0.2 && d.meta.support >= 0.5 && d.meta.qa <= 0.85 && !Vision.fullFrame(d.q, F.width, F.height), conf = null;
    if (ok) { try { const r = DetectorV2.refineFrom(F, { q: d.q, votes: d.votes }); conf = r ? r.confidence : 0; if (!r || r.noPage || !(conf >= CONF_FLAG)) ok = false; } catch (e) { conf = null; } }
    // Book mode (3.3.2 stop-gap until Shuri's spread detector): the outline must look like an open spread (wider than tall,
    // or found by the book merge) — otherwise no 'Page found' and no auto-capture on a bad outline
    if (ok && book) { const q = d.q, w = (Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)) / 2, h = (Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) / 2;
      if (!(/^book/.test(d.method || '') || (w / h > 1.15 && w / h < 2.6))) return { q: null, conf, notBook: true, ms: performance.now() - t }; }
    return ok ? { q: d.q, votes: d.votes, score: d.score, conf, ms: performance.now() - t } : { q: null, conf, ms: performance.now() - t };
  },
  // detector-v2 corner refinement on a v1 result (after capture / import)
  async refine({ src, q, votes }) {
    const c = await toCanvas(src); const r = DetectorV2.refineFrom(c, { q, votes });
    return r && r.corners && r.corners.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) ? { q: r.corners.map((p) => ({ x: p[0], y: p[1] })), conf: r.confidence, noPage: r.noPage } : null;
  },
  ping() { return true; }
};
async function handle(m) {
  try { const res = await OPS[m.op](m); postMessage({ id: m.id, ok: true, res, heap: cv.HEAP8.length >> 20 }); }
  catch (e) {
    let msg = (e && e.message) || String(e), fatal = false;
    if (typeof e === 'number') { fatal = true; try { msg = 'OpenCV: ' + cv.exceptionFromPtr(e).msg; } catch { msg = 'OpenCV exception ' + e; } }
    if (/memory|abort/i.test(msg)) fatal = true;
    postMessage({ id: m.id, ok: false, err: msg, fatal });
  }
}
let chain = Promise.resolve();
onmessage = (e) => { const m = e.data; if (!ready) return queue.push(m); chain = chain.then(() => handle(m)); };
