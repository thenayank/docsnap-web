'use strict';
/* DocSnap vision: document detection, perspective correction and scan filters (OpenCV.js). */
const Vision = (() => {
  const OUT_LONG = 2500;          // output long side (px)
  const SRC_MAX_LONG = 4096;      // iOS canvas limit ~16.7 MP; 4096×3072 = 12.6 MP
  const SRC_MAX_AREA = 16000000;

  /** Decode a File/Blob to a canvas, honoring EXIF orientation, capped for iOS canvas limits. */
  async function decode(blob, maxLong = SRC_MAX_LONG) {
    let src, w, h;
    if (window.createImageBitmap) {
      try { src = await createImageBitmap(blob, { imageOrientation: 'from-image' }); w = src.width; h = src.height; } catch { src = null; }
    }
    if (!src) {
      const img = new Image(); img.src = URL.createObjectURL(blob);
      try { await img.decode(); } finally { setTimeout(() => URL.revokeObjectURL(img.src), 0); }
      src = img; w = img.naturalWidth; h = img.naturalHeight;
    }
    let k = Math.min(1, maxLong / Math.max(w, h));
    if (w * h * k * k > SRC_MAX_AREA) k = Math.sqrt(SRC_MAX_AREA / (w * h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    if (src.close) src.close();
    return c;
  }
  function scaled(src, maxLong) {
    const k = Math.min(1, maxLong / Math.max(src.width, src.height));
    const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, c.width, c.height);
    return { c, k };
  }
  const free = (...cs) => cs.forEach((c) => { if (c && c.width) { c.width = 0; c.height = 0; } });

  function order(pts) {
    const cx = pts.reduce((a, p) => a + p.x, 0) / 4, cy = pts.reduce((a, p) => a + p.y, 0) / 4;
    const s = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); // clockwise from left
    // rotate so that the first is top-left (min x+y)
    let i0 = 0; s.forEach((p, i) => { if (p.x + p.y < s[i0].x + s[i0].y) i0 = i; });
    return [0, 1, 2, 3].map((i) => s[(i0 + i) % 4]); // TL, TR, BR, BL
  }
  const polyArea = (q) => Math.abs(q.reduce((a, p, i) => { const n = q[(i + 1) % q.length]; return a + p.x * n.y - n.x * p.y; }, 0)) / 2;
  function angleOk(q) {
    for (let i = 0; i < 4; i++) {
      const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
      const v1 = [a.x - b.x, a.y - b.y], v2 = [c.x - b.x, c.y - b.y];
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) + 1e-9);
      const deg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      if (deg < 50 || deg > 130) return false;
    }
    return true;
  }
  function median(cv, gray) {
    const hist = new Array(256).fill(0), d = gray.data;
    for (let i = 0; i < d.length; i += 7) hist[d[i]]++;
    const n = hist.reduce((a, b) => a + b, 0); let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) return v; }
    return 128;
  }

  /** Detect the document quad. Returns {q:[TL,TR,BR,BL] in src px, method} or null. */
  function detect(cv, src) {
    const { c: small, k } = scaled(src, 1000);
    const W = small.width, H = small.height, A = W * H;
    const mats = [];
    const M = (m) => (mats.push(m), m);
    const cands = [];
    try {
      const rgba = M(cv.imread(small));
      const gray = M(new cv.Mat()); cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      const blur = M(new cv.Mat()); cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      // "paperness": bright and unsaturated
      const rgb = M(new cv.Mat()); cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
      const hsv = M(new cv.Mat()); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      const ch = M(new cv.MatVector()); cv.split(hsv, ch);
      const S = ch.get(1), V = ch.get(2); mats.push(S, V);
      const white = M(new cv.Mat()); cv.subtract(V, S, white); cv.GaussianBlur(white, white, new cv.Size(7, 7), 0);

      const k5 = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
      const k9 = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));
      const collect = (bin, method, mode) => {
        const cs = new cv.MatVector(), hi = new cv.Mat();
        cv.findContours(bin, cs, hi, mode, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < cs.size(); i++) {
          const cnt = cs.get(i);
          const hull = new cv.Mat(); cv.convexHull(cnt, hull, false, true);
          const ha = cv.contourArea(hull);
          if (ha > 0.06 * A && ha < 0.985 * A) {
            const peri = cv.arcLength(hull, true);
            let quad = null;
            for (const e of [0.015, 0.02, 0.03, 0.045, 0.06, 0.08]) {
              const ap = new cv.Mat(); cv.approxPolyDP(hull, ap, e * peri, true);
              if (ap.rows === 4) { quad = []; for (let j = 0; j < 4; j++) quad.push({ x: ap.data32S[2 * j], y: ap.data32S[2 * j + 1] }); }
              ap.delete(); if (quad) break;
            }
            let kind = 'poly';
            if (!quad) {
              const r = cv.minAreaRect(hull); const pts = cv.RotatedRect.points(r);
              quad = pts.map((p) => ({ x: p.x, y: p.y })); kind = 'rect';
            }
            quad = order(quad);
            const qa = polyArea(quad);
            const fit = Math.min(qa, ha) / Math.max(qa, ha);
            // penalise quads glued to the frame border (usually background, not paper)
            const border = quad.filter((p) => p.x < 3 || p.y < 3 || p.x > W - 4 || p.y > H - 4).length;
            if (qa > 0.06 * A && qa < 0.97 * A && angleOk(quad) && fit > 0.85) {
              const score = (qa / A) * fit * fit * (kind === 'rect' ? 0.8 : 1) * (border >= 3 ? 0.3 : border === 2 ? 0.85 : 1);
              cands.push({ q: quad, score, method: method + ':' + kind });
            }
          }
          hull.delete(); cnt.delete();
        }
        cs.delete(); hi.delete();
      };
      // 1) Canny edges (auto + fixed thresholds) + morphological close
      const med = median(cv, blur);
      for (const [lo, hi] of [[0.66 * med, 1.33 * med], [20, 60], [50, 150]]) {
        const e = new cv.Mat(); cv.Canny(blur, e, Math.max(5, lo), Math.min(255, Math.max(lo + 10, hi)));
        cv.morphologyEx(e, e, cv.MORPH_CLOSE, k9); cv.dilate(e, e, k5);
        collect(e, 'canny', cv.RETR_LIST); e.delete();
      }
      // 2) Otsu on brightness and on "whiteness"
      for (const [m, name] of [[blur, 'otsu'], [white, 'white']]) {
        const t = new cv.Mat(); cv.threshold(m, t, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        cv.morphologyEx(t, t, cv.MORPH_OPEN, k9); cv.morphologyEx(t, t, cv.MORPH_CLOSE, k9);
        collect(t, name, cv.RETR_EXTERNAL); t.delete();
      }
      // 3) adaptive threshold fallback (regions brighter than their surroundings)
      const at = new cv.Mat(); cv.adaptiveThreshold(blur, at, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 151, -6);
      cv.morphologyEx(at, at, cv.MORPH_CLOSE, k9); cv.morphologyEx(at, at, cv.MORPH_OPEN, k9);
      collect(at, 'adaptive', cv.RETR_EXTERNAL); at.delete();
    } finally {
      mats.forEach((m) => { try { m.delete(); } catch {} });
      free(small);
    }
    if (!cands.length) return null;
    // consensus: prefer candidates that several methods agree on
    for (const c of cands) {
      c.votes = cands.filter((o) => Math.max(...o.q.map((p, i) => Math.hypot(p.x - c.q[i].x, p.y - c.q[i].y))) < 0.04 * Math.max(W, H)).length;
    }
    cands.sort((a, b) => b.score * (1 + 0.25 * Math.min(b.votes, 4)) - a.score * (1 + 0.25 * Math.min(a.votes, 4)));
    const best = cands[0];
    return { q: best.q.map((p) => ({ x: p.x / k, y: p.y / k })), method: best.method, votes: best.votes };
  }

  /** Perspective-correct at high resolution (≤ OUT_LONG on the long side). q in src px. */
  function warp(cv, src, q, outLong = OUT_LONG) {
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const w0 = Math.max(d(q[0], q[1]), d(q[3], q[2])), h0 = Math.max(d(q[0], q[3]), d(q[1], q[2]));
    const os = Math.min(1.25, outLong / Math.max(w0, h0)); // allow slight upscale for small docs
    const w = Math.round(w0 * os), h = Math.round(h0 * os);
    // work on a source scaled just enough for the output (saves memory on iPhone)
    const ss = Math.min(1, os * 1.1);
    const { c: s2, k } = ss < 1 ? scaled(src, Math.max(src.width, src.height) * ss) : { c: src, k: 1 };
    const m = cv.imread(s2), out = new cv.Mat();
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap((p) => [p.x * k, p.y * k]));
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    const T = cv.getPerspectiveTransform(from, to);
    cv.warpPerspective(m, out, T, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
    const c = document.createElement('canvas'); cv.imshow(c, out);
    [m, out, from, to, T].forEach((x) => x.delete()); if (s2 !== src) free(s2);
    return c;
  }

  /** Estimate the paper background per channel (large-kernel dilation + median on a ¼ image) and divide it out. */
  function flatten(cv, chan) {
    const sm = new cv.Mat(), bg = new cv.Mat(), out = new cv.Mat();
    const f = 0.25; cv.resize(chan, sm, new cv.Size(0, 0), f, f, cv.INTER_AREA);
    const kd = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
    cv.dilate(sm, sm, kd); cv.medianBlur(sm, sm, 21);
    cv.resize(sm, bg, new cv.Size(chan.cols, chan.rows), 0, 0, cv.INTER_LINEAR);
    cv.divide(chan, bg, out, 255, -1);
    [sm, bg, kd].forEach((x) => x.delete());
    return out;
  }
  function stretch(cv, m, loPct = 0.01, hiPct = 0.995) {
    const d = m.data, hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 5) hist[d[i]]++;
    const n = hist.reduce((a, b) => a + b, 0); let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc <= n * loPct) lo = v; if (acc <= n * hiPct) hi = v; }
    if (hi - lo < 40) return;
    const a = 255 / (hi - lo); cv.convertScaleAbs(m, m, a, -lo * a);
  }
  function lut(cv, m, fn) { const t = new cv.Mat(1, 256, cv.CV_8U); for (let i = 0; i < 256; i++) t.data[i] = Math.max(0, Math.min(255, Math.round(fn(i)))); cv.LUT(m, t, m); t.delete(); }
  function sharpen(cv, m, amount = 0.6, sigma = 1.2) {
    const b = new cv.Mat(); cv.GaussianBlur(m, b, new cv.Size(0, 0), sigma); cv.addWeighted(m, 1 + amount, b, -amount, 0, m); b.delete();
  }

  const FILTERS = ['original', 'magic', 'white', 'bw', 'gray'];
  /** Apply a scan filter + optional brightness/contrast (-100..100). Returns a new canvas. */
  function filter(cv, canvas, name = 'original', bc = null) {
    const src = cv.imread(canvas); let out = new cv.Mat();
    try {
      if (name === 'magic') {
        const rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
        const ch = new cv.MatVector(); cv.split(rgb, ch); const res = new cv.MatVector();
        for (let i = 0; i < 3; i++) { const c = ch.get(i), f = flatten(cv, c); res.push_back(f); c.delete(); f.delete(); }
        cv.merge(res, out); res.delete(); ch.delete(); rgb.delete();
        // contrast: paper → white, ink → dark; then punchier colours
        lut(cv, out, (v) => 255 * Math.pow(Math.min(1, Math.max(0, (v - 25) / 205)), 1.25));
        const hsv = new cv.Mat(); cv.cvtColor(out, hsv, cv.COLOR_RGB2HSV);
        const hc = new cv.MatVector(); cv.split(hsv, hc); const s = hc.get(1);
        lut(cv, s, (v) => v * 1.45); hc.set(1, s); cv.merge(hc, hsv); cv.cvtColor(hsv, out, cv.COLOR_HSV2RGB);
        [hsv, hc, s].forEach((x) => x.delete());
        sharpen(cv, out, 0.5);
      } else if (name === 'white' || name === 'bw' || name === 'gray') {
        const g = new cv.Mat(); cv.cvtColor(src, g, cv.COLOR_RGBA2GRAY);
        if (name === 'gray') { stretch(cv, g, 0.005, 0.998); out.delete(); out = g; sharpen(cv, out, 0.35); }
        else {
          const f = flatten(cv, g); g.delete();
          if (name === 'white') {
            lut(cv, f, (v) => 255 * Math.pow(Math.min(1, Math.max(0, (v - 40) / 175)), 1.5));
            sharpen(cv, f, 0.7); out.delete(); out = f;
          } else {
            const bs = (Math.round(Math.max(canvas.width, canvas.height) / 70) | 1);
            cv.adaptiveThreshold(f, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, Math.max(15, bs), 18);
            // anything clearly paper stays white (removes speckle)
            const w = new cv.Mat(); cv.threshold(f, w, 205, 255, cv.THRESH_BINARY); cv.bitwise_or(out, w, out); w.delete();
            f.delete();
          }
        }
      } else { cv.cvtColor(src, out, cv.COLOR_RGBA2RGB); }
      if (bc && (bc.b || bc.c)) {
        const a = 1 + bc.c / 100, b = bc.b * 1.28;
        cv.convertScaleAbs(out, out, a, 128 * (1 - a) + b);
      }
      const c = document.createElement('canvas'); cv.imshow(c, out); return c;
    } finally { src.delete(); out.delete(); }
  }
  return { decode, scaled, free, detect, warp, filter, order, FILTERS, OUT_LONG };
})();
