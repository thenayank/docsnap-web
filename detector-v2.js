'use strict';
/* DocSnap detector-v2 (Shuri; copied from docsnap-audit/detector-v2, worker-safe). detect(imageData) -> {corners:[[x,y]x4 TL,TR,BR,BL], confidence 0..1} | null
 * Stage 1: current multi-pass candidate search (Vision.detect, unchanged).
 * Stage 2: sub-pixel edge refinement: per side, scan normal profiles at full-ish res,
 *          pick strongest bright->dark step, robust (trimmed) line fit, intersect sides.
 * Stage 3: confidence from edge support + contrast; low confidence -> null (no page). */
const DetectorV2 = (() => {
  const REF_LONG = 2000, MIN_CONF = 0.05; // below this: treat as no page
  function toCanvas(img) {
    if (img instanceof HTMLCanvasElement) return img;
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0); return c;
  }
  function grayOf(canvas, maxLong) {
    const k = Math.min(1, maxLong / Math.max(canvas.width, canvas.height));
    const w = Math.round(canvas.width * k), h = Math.round(canvas.height * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    // light 3x3 box blur
    const b = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * w + x + dx];
      b[y * w + x] = s / 9;
    }
    return { g: b, w, h, k };
  }
  const samp = (G, x, y) => {
    const { g, w, h } = G; if (x < 1 || y < 1 || x > w - 2 || y > h - 2) return NaN;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
  };
  function fitLine(pts) { // total least squares
    const n = pts.length; let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0; for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); return { mx, my, dx: Math.cos(th), dy: Math.sin(th) };
  }
  const dist = (L, p) => Math.abs((p[0] - L.mx) * L.dy - (p[1] - L.my) * L.dx);
  function robustFit(pts) {
    let cur = pts, L = fitLine(cur);
    for (let it = 0; it < 4 && cur.length > 6; it++) {
      const ds = cur.map((p) => dist(L, p)).sort((a, b) => a - b), thr = Math.max(1.0, 2.5 * ds[ds.length >> 1]);
      const nxt = cur.filter((p) => dist(L, p) <= thr); if (nxt.length < 6) break; cur = nxt; L = fitLine(cur);
    }
    const rms = Math.sqrt(cur.reduce((a, p) => a + dist(L, p) ** 2, 0) / cur.length);
    return { L, inl: cur.length / pts.length, rms };
  }
  const inter = (A, B) => {
    const d = A.dx * B.dy - A.dy * B.dx; if (Math.abs(d) < 1e-6) return null;
    const t = ((B.mx - A.mx) * B.dy - (B.my - A.my) * B.dx) / d; return [A.mx + A.dx * t, A.my + A.dy * t];
  };
  function refine(G, q) { // q in G px, TL TR BR BL
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
    const R = Math.max(6, Math.round(0.02 * Math.max(G.w, G.h))), lines = [], support = [], quality = [];
    for (let s = 0; s < 4; s++) {
      const a = q[s], b = q[(s + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey);
      let nx = -ey / len, ny = ex / len; // make normal point outward
      if (((a[0] + b[0]) / 2 - cx) * nx + ((a[1] + b[1]) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const pts = []; let strong = 0, tot = 0;
      for (let t = 0.08; t <= 0.921; t += 0.84 / 40) {
        const px = a[0] + ex * t, py = a[1] + ey * t; let best = 0, bo = 0;
        const prof = []; for (let o = -R; o <= R; o += 0.5) prof.push(samp(G, px + nx * o, py + ny * o));
        for (let i = 2; i < prof.length - 2; i++) {
          const gr = prof[i - 2] - prof[i + 2]; // inside (brighter) minus outside
          if (gr > best) { best = gr; bo = -R + i * 0.5; }
        }
        if (Number.isNaN(best)) continue; tot++;
        if (best > 12) { strong++; pts.push([px + nx * bo, py + ny * bo]); }
      }
      const sup = tot ? strong / tot : 0; support.push(sup);
      if (pts.length < 8) { lines.push(null); quality.push(0); continue; }
      const f = robustFit(pts);
      // side quality: share of profiles that agree on one straight edge, penalised by scatter
      const qy = sup * f.inl * Math.exp(-f.rms / 1.5); quality.push(qy);
      lines.push(f.inl >= 0.55 ? f.L : null); // texture-dominated side: keep stage-1 line
    }
    const out = [];
    for (let i = 0; i < 4; i++) {
      const A = lines[(i + 3) % 4], B = lines[i]; // corner i between side i-1 and side i
      const p = A && B ? inter(A, B) : null;
      out.push(p && Math.hypot(p[0] - q[i][0], p[1] - q[i][1]) < 1.6 * R ? p : q[i]);
    }
    return { q: out, support, quality };
  }
  function detect(imageData) {
    const cv = self.cv, canvas = toCanvas(imageData);
    const base = Vision.detect(cv, canvas); if (!base) return null;
    const G = grayOf(canvas, REF_LONG), k = G.k;
    let q = base.q.map((p) => [p.x * k, p.y * k]);
    let r = refine(G, q); r = refine(G, r.q); // two passes
    const Q = r.quality, mean = Q.reduce((a, b) => a + b, 0) / 4;
    const conf = Math.max(0, Math.min(1, 0.5 * mean + 0.5 * Math.min(...Q)));
    if (conf < MIN_CONF) return null;
    return { corners: r.q.map((p) => [p[0] / k, p[1] / k]), confidence: +conf.toFixed(3), method: base.method };
  }
  /** DocSnap: refine an existing v1 result (skips re-running Vision.detect). Returns conf even when low (caller decides). */
  function refineFrom(canvas, base) {
    const G = grayOf(canvas, REF_LONG), k = G.k;
    let r = refine(G, base.q.map((p) => [p.x * k, p.y * k])); r = refine(G, r.q);
    const Q = r.quality, mean = Q.reduce((a, b) => a + b, 0) / 4;
    const conf = Math.max(0, Math.min(1, 0.5 * mean + 0.5 * Math.min(...Q)));
    return { corners: r.q.map((p) => [p[0] / k, p[1] / k]), confidence: +conf.toFixed(3), noPage: conf < MIN_CONF };
  }
  return { detect, refineFrom };
})();
if (typeof self !== 'undefined') self.DetectorV2 = DetectorV2;
