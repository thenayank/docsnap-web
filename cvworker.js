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
  async detect({ src }) { const c = await toCanvas(src); const d = Vision.detect(cv, c); return d; },
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
  async detectLive({ src }) {
    let c = self._liveC; if (!c || c.width !== src.width || c.height !== src.height) c = self._liveC = new OffscreenCanvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0); src.close && src.close();
    const t = performance.now(), d = Vision.detect(cv, c);
    return d ? { q: d.q, votes: d.votes, ms: performance.now() - t } : { q: null, ms: performance.now() - t };
  },
  // detector-v2 corner refinement on a v1 result (after capture / import)
  async refine({ src, q, votes }) {
    const c = await toCanvas(src); const r = DetectorV2.refineFrom(c, { q, votes });
    return r && r.corners && r.corners.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) ? { q: r.corners.map((p) => ({ x: p[0], y: p[1] })), conf: r.confidence } : null;
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
