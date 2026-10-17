'use strict';
/* DocSnap vision worker: OpenCV runs here so detection / warp / filters never freeze the UI. */
self.HTMLImageElement = self.HTMLImageElement || function () {};
self.HTMLCanvasElement = self.HTMLCanvasElement || OffscreenCanvas;
self.document = self.document || { createElement: () => new OffscreenCanvas(1, 1), getElementById: () => null };
importScripts('vendor/opencv.js', 'vision.js', 'detector-v2.js');
self.window = self.window || self; // detector-v3 reads window.cv (set after OpenCV has loaded so Emscripten still sees a worker)
importScripts('detector-v3.js');
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
  // live camera (3.3.3): detector-v3 on a ≤720px frame; the outline shows only for a confident (≥ CONF_FLAG), not-frame-sized quad
  async detectLive({ src, conf: CONF_FLAG = 0.5, book = false, fast = false }) {
    let F = self._liveF; if (!F || F.width !== src.width || F.height !== src.height) F = self._liveF = new OffscreenCanvas(src.width, src.height);
    F.getContext('2d').drawImage(src, 0, 0); src.close && src.close();
    const t = performance.now(); let r = null;
    try { r = DetectorV3.detect(F, { fast }); } catch (e) { r = null; }
    let q = r && r.corners.map((p) => ({ x: p[0], y: p[1] })), conf = r ? r.confidence : null, kind = r && r.kind;
    let ok = !!q && conf >= CONF_FLAG && !Vision.fullFrame(q, F.width, F.height);
    if (!ok) { // regression guard: where v3 shows nothing, the 3.3.2 path (v1 on a 480px copy + v2 confidence) may still show a confident outline
      try {
        const f = Math.min(1, 480 / Math.max(F.width, F.height)), w4 = Math.round(F.width * f), h4 = Math.round(F.height * f);
        let c = self._liveC; if (!c || c.width !== w4 || c.height !== h4) c = self._liveC = new OffscreenCanvas(w4, h4);
        c.getContext('2d').drawImage(F, 0, 0, w4, h4);
        const d0 = Vision.detect(cv, c), d = d0 && { ...d0, q: d0.q.map((p) => ({ x: p.x / f, y: p.y / f })) };
        if (d && d.score >= 0.2 && d.meta.support >= 0.5 && d.meta.qa <= 0.85 && !Vision.fullFrame(d.q, F.width, F.height)) {
          const r2 = DetectorV2.refineFrom(F, { q: d.q, votes: d.votes });
          if (r2 && !r2.noPage && r2.confidence >= CONF_FLAG) { q = d.q; conf = r2.confidence; kind = /^book/.test(d.method || '') ? 'book' : 'page'; ok = true; }
        }
      } catch (e) {}
    }
    // Book mode: only a spread may light up 'Page found' (v3 says book, or the outline is spread-shaped)
    if (ok && book) { const w = (Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)) / 2, h = (Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) / 2;
      if (!(kind === 'book' || (w / h > 1.15 && w / h < 2.6))) return { q: null, conf, kind, notBook: true, ms: performance.now() - t }; }
    return ok ? { q, conf, kind, ms: performance.now() - t } : { q: null, conf, kind, ms: performance.now() - t };
  },
  // after capture / import (3.3.3): detector-v3 full detection replaces the v2 refine. Regression guard: if v3 is weak
  // (conf < V3_WEAK) or finds nothing, v2's refinement of the v1 quad is used when it is more confident than v3.
  async refine({ src, q, votes, conf: CONF_FLAG = 0.5 }) {
    const c = await toCanvas(src), V3_WEAK = 0.3; let out = null;
    try {
      const r = DetectorV3.detect(c);
      if (r && r.corners.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])))
        out = { q: r.corners.map((p) => ({ x: p[0], y: p[1] })), conf: r.confidence, kind: r.kind, spine: r.spine, gutterWidth: r.gutterWidth, quality: r.quality, method: r.method, v: 3 };
    } catch (e) { out = null; }
    if ((!out || out.conf < V3_WEAK) && q) {
      try {
        const r2 = DetectorV2.refineFrom(c, { q, votes });
        if (r2 && !r2.noPage && r2.confidence > (out ? out.conf : 0) && r2.corners.every((p) => Number.isFinite(p[0]))) { // the more confident crop wins; below CONF_FLAG it still gets the dot
          const q2 = r2.corners.map((p) => ({ x: p[0], y: p[1] }));
          if (!Vision.fullFrame(q2, c.width, c.height)) out = { q: q2, conf: r2.confidence, kind: 'page', spine: null, quality: r2.quality, method: 'v2-guard', v: 2, v3conf: out ? out.conf : null };
        }
      } catch (e) {}
    }
    return out; // null → caller keeps v1 (flagged)
  },
  // crop snap (3.3.3): detector-v3 refines the user's quad; per-side quality tells whether the corner sits on real paper edges
  async snap({ src, q }) {
    const c = await toCanvas(src); const r = DetectorV3.scoreQuad(c, q.map((p) => [p.x, p.y]));
    return r && r.corners ? { q: r.corners.map((p) => ({ x: p[0], y: p[1] })), conf: r.confidence, quality: r.quality } : null;
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
