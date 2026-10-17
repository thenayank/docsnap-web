'use strict';
/* DocSnap vision: document detection, perspective correction and scan filters (OpenCV.js). */
const Vision = (() => {
  const FRAME_MAX = 0.90;         // 3.3.1 hard rule: a quad covering > 90% of the frame is the photo itself, never a page (independent of confidence)
  const OUT_LONG = 4096;          // 3.3.3: output keeps the page's native resolution (cap = source cap; was 2500)
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

  /** Mean luma inside a quad (samples a coarse grid). Higher = paper-like. */
  function quadLuma(gray, q, samples = 7) {
    const d = gray.data, W = gray.cols, H = gray.rows;
    let sum = 0, n = 0;
    for (let i = 1; i < samples; i++) for (let j = 1; j < samples; j++) {
      const u = i / samples, v = j / samples;
      // bilinear map unit square → quad (TL,TR,BR,BL)
      const x = (1 - v) * ((1 - u) * q[0].x + u * q[1].x) + v * ((1 - u) * q[3].x + u * q[2].x);
      const y = (1 - v) * ((1 - u) * q[0].y + u * q[1].y) + v * ((1 - u) * q[3].y + u * q[2].y);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) { sum += d[yi * W + xi]; n++; }
    }
    return n ? sum / n : 0;
  }
  /** Mean luma of a band just outside the quad (for contrast). */
  function outsideLuma(gray, q, pad = 18) {
    const d = gray.data, W = gray.cols, H = gray.rows;
    const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
    const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    let sum = 0, n = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      for (let t = 0.15; t <= 0.85; t += 0.14) {
        const mx = a.x + (b.x - a.x) * t, my = a.y + (b.y - a.y) * t;
        const dx = mx - cx, dy = my - cy, len = Math.hypot(dx, dy) || 1;
        const ox = Math.round(mx + dx / len * pad), oy = Math.round(my + dy / len * pad);
        if (ox >= 0 && oy >= 0 && ox < W && oy < H) { sum += d[oy * W + ox]; n++; }
      }
    }
    return n ? sum / n : 128;
  }
  function aspectScore(q) {
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const w = (d(q[0], q[1]) + d(q[3], q[2])) / 2;
    const h = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
    const r = Math.min(w, h) / Math.max(w, h);
    // pages are usually between ~0.55 (A4) and ~0.85; very square or very skinny is worse
    if (r < 0.35 || r > 0.98) return 0.35;
    if (r >= 0.55 && r <= 0.82) return 1.15;
    return 0.85;
  }
  function borderTouch(q, W, H, m = 4) {
    // how many corners sit on the frame, and how many sides are glued to an edge
    let corners = 0, sides = 0;
    for (const p of q) if (p.x < m || p.y < m || p.x > W - 1 - m || p.y > H - 1 - m) corners++;
    const near = (a, b, edge) => {
      if (edge === 'L') return a.x < m && b.x < m;
      if (edge === 'R') return a.x > W - 1 - m && b.x > W - 1 - m;
      if (edge === 'T') return a.y < m && b.y < m;
      return a.y > H - 1 - m && b.y > H - 1 - m;
    };
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      if (near(a, b, 'L') || near(a, b, 'R') || near(a, b, 'T') || near(a, b, 'B')) sides++;
    }
    return { corners, sides };
  }

  /** Detect the document quad. Returns {q:[TL,TR,BR,BL] in src px, method} or null. */
  function detect(cv, src, opts = {}) {
    const { c: small, k } = scaled(src, 1000);
    const W = small.width, H = small.height, A = W * H;
    const sc = Math.max(W, H) / 1000, ks = (n) => Math.max(3, Math.round(n * sc) | 1); // kernels scale with frame size (live frames are ~480px)
    const mats = [];
    const M = (m) => (mats.push(m), m);
    const cands = [];
    try {
      const rgba = M(cv.imread(small));
      const gray = M(new cv.Mat()); cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      const blur = M(new cv.Mat()); cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

      // --- Paper mask in LAB: high L, low chroma (handles pink cover / cloth) ---
      const rgb = M(new cv.Mat()); cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
      const lab = M(new cv.Mat()); cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
      const lc = M(new cv.MatVector()); cv.split(lab, lc);
      const L = lc.get(0), Aa = lc.get(1), Bb = lc.get(2); mats.push(L, Aa, Bb);
      const hsv = M(new cv.Mat()); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      const hc = M(new cv.MatVector()); cv.split(hsv, hc);
      const S = hc.get(1), V = hc.get(2); mats.push(S, V);
      // whiteness score image: L high, |a-128| and |b-128| and S low
      const paperScore = M(new cv.Mat(H, W, cv.CV_8UC1));
      {
        const pd = paperScore.data, Ld = L.data, ad = Aa.data, bd = Bb.data, sd = S.data;
        // L threshold relative to image: paper is in the upper part of the L histogram
        const [, Lhi] = (() => {
          const hist = new Array(256).fill(0);
          for (let i = 0; i < Ld.length; i += 5) hist[Ld[i]]++;
          const n = hist.reduce((a, b) => a + b, 0); let acc = 0, hi = 200;
          for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc <= n * 0.55) hi = v; }
          return [0, Math.max(140, hi)];
        })();
        for (let i = 0; i < pd.length; i++) {
          const chroma = Math.hypot(ad[i] - 128, bd[i] - 128);
          const bright = Ld[i] >= Lhi - 15 ? 1 : Ld[i] >= Lhi - 45 ? (Ld[i] - (Lhi - 45)) / 30 : 0;
          const neut = chroma < 12 ? 1 : chroma < 28 ? 1 - (chroma - 12) / 16 : 0;
          const sat = sd[i] < 40 ? 1 : sd[i] < 70 ? 1 - (sd[i] - 40) / 30 : 0;
          pd[i] = Math.round(255 * bright * Math.max(neut, sat * 0.85));
        }
      }
      cv.GaussianBlur(paperScore, paperScore, new cv.Size(ks(7), ks(7)), 0);
      const paperBin = M(new cv.Mat());
      cv.threshold(paperScore, paperBin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      // if Otsu picked a low bar (too much paper), raise it
      {
        const nz = cv.countNonZero(paperBin) / A;
        if (nz > 0.75) cv.threshold(paperScore, paperBin, 160, 255, cv.THRESH_BINARY);
        else if (nz < 0.05) cv.threshold(paperScore, paperBin, 90, 255, cv.THRESH_BINARY);
      }
      const k15 = M(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ks(15), ks(15))));
      const k9 = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(ks(9), ks(9))));
      const k5 = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(ks(5), ks(5))));
      // close gaps from text/spiral teeth, then open to drop thin clutter
      cv.morphologyEx(paperBin, paperBin, cv.MORPH_CLOSE, k15);
      cv.morphologyEx(paperBin, paperBin, cv.MORPH_OPEN, k9);
      // fill interior holes (dark headers / photos on the page) so one outer contour remains
      {
        const flood = new cv.Mat(); paperBin.copyTo(flood);
        const mask = new cv.Mat(H + 2, W + 2, cv.CV_8UC1, new cv.Scalar(0));
        // seed from every border pixel that's background
        const seeds = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [W >> 1, 0], [0, H >> 1]];
        for (const [sx, sy] of seeds) {
          if (flood.ucharAt(sy, sx) === 0) cv.floodFill(flood, mask, new cv.Point(sx, sy), new cv.Scalar(128));
        }
        // holes = still 0 after flooding background → paint white
        for (let i = 0; i < flood.data.length; i++) if (flood.data[i] === 0) paperBin.data[i] = 255;
        flood.delete(); mask.delete();
      }
      // one more close to seal spiral-tooth gaps on the left edge
      cv.morphologyEx(paperBin, paperBin, cv.MORPH_CLOSE, k15);

      // edge map for side-support scoring (rejects quads whose sides run through background)
      const edgeMap = M(new cv.Mat());
      {
        const md = median(cv, blur);
        cv.Canny(blur, edgeMap, Math.max(5, 0.66 * md), Math.min(255, Math.max(0.66 * md + 10, 1.33 * md)));
        cv.dilate(edgeMap, edgeMap, k5);
      }
      // side support (3.3.1): a real page edge is a brightness STEP across the side. Canny on bright, low-contrast
      // phone photos (paper on a light bedsheet) often finds nothing, so measure the step directly on the blurred image.
      const bd8 = blur.data;
      const lumAt = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= W || yi >= H ? -1 : bd8[yi * W + xi]; };
      const sideSupport = (quad) => {
        const ed = edgeMap.data, sup = [], cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4, cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
        const off = Math.max(3, Math.round(Math.min(W, H) * 0.006));
        for (let i = 0; i < 4; i++) {
          const a = quad[i], b = quad[(i + 1) % 4], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          let nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
          if (((a.x + b.x) / 2 - cx) * nx + ((a.y + b.y) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; } // outward
          let hit = 0, n = 0;
          for (let t = 0.06; t <= 0.94; t += 0.03) {
            const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
            if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) continue; // border sides: no evidence either way
            n++;
            const vin = lumAt(x - nx * off, y - ny * off), vout = lumAt(x + nx * off, y + ny * off);
            const step = vin >= 0 && vout >= 0 && Math.abs(vin - vout) >= 9;
            if (step || ed[Math.round(y) * W + Math.round(x)] && vin >= 0 && vout >= 0 && Math.abs(vin - vout) >= 5) hit++;
          }
          sup.push(n ? hit / n : 0.5);
        }
        const mean = sup.reduce((x, y) => x + y, 0) / 4;
        return 0.5 * Math.min(...sup) + 0.5 * mean;
      };
      var rejN = {}; var rej = (k) => { rejN[k] = (rejN[k] || 0) + 1; };
      const consider = (quad, method, kind) => {
        quad = order(quad);
        const qa = polyArea(quad);
        if (qa < 0.05 * A || qa > FRAME_MAX * A) { rej(1); return; }     // 3.3.1: never accept a quad covering > FRAME_MAX of the frame
        if (!angleOk(quad)) { rej(2); return; }
        const { corners, sides } = borderTouch(quad, W, H, 5);
        if (corners >= 4 || sides >= 3) { rej(3); return; }               // glued to the photo frame
        // large + multi-border is usually the whole photo, not the page (notebook fail case)
        if (qa > 0.82 * A && (corners >= 2 || sides >= 2)) { rej(4); return; }
        if (qa > 0.90 * A && corners >= 1) { rej(5); return; }
        // 3.3.1: quads hugging the frame (two corners on the border, or big + one corner / one glued side) are the photo, not a page
        if (corners >= 2) { rej(6); return; }
        if (corners === 1 && qa > 0.6 * A) { rej(7); return; }
        if (sides >= 1 && qa > 0.7 * A) { rej(8); return; }
        const ptsMat = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y]));
        const rRect = cv.minAreaRect(ptsMat); ptsMat.delete();
        const rArea = Math.abs(rRect.size.width * rRect.size.height) || 1;
        const rectFit = Math.min(qa, rArea) / Math.max(qa, rArea);
        if (rectFit < 0.78) { rej(9); return; }

        const inside = quadLuma(gray, quad);
        const outside = outsideLuma(gray, quad, Math.max(12, Math.round(Math.min(W, H) * 0.03)));
        const contrast = (inside - outside) / 255;           // paper should be brighter
        const insideSat = quadLuma(S, quad);
        if (inside < 110 && !(insideSat > 90 && inside > 60 && Math.abs(inside - outside) > 30 && qa > 0.15 * A)) { rej(10); return; } // too dark to be paper (but a saturated book cover is fine)
        if (contrast < 0.02 && qa > 0.55 * A) { rej(11); return; }        // big & no contrast = frame

        const paperBoost = inside > 185 ? 1.35 : inside > 160 ? 1.2 : inside > 130 ? 1.0 : 0.7;
        const contrastBoost = contrast > 0.12 ? 1.2 : contrast > 0.06 ? 1.05 : contrast > 0.02 ? 0.9 : 0.5;
        const borderPen = corners === 0 && sides === 0 ? 1.15 : corners === 1 ? 0.8 : 0.45;
        // Prefer the largest plausible page (~35–80%); penalise tiny high-contrast sub-rects (headers, cards)
        const frac = qa / A;
        let sizeScore;
        if (frac < 0.18) sizeScore = 0.25;           // too small (logo / feature box)
        else if (frac < 0.30) sizeScore = 0.55;
        else if (frac < 0.85) sizeScore = 0.9 + frac; // bigger is better in the page range
        else sizeScore = 1.6 - (frac - 0.85) * 3;     // gentle drop above 85%
        // Paper-mask helps on cluttered scenes; don't let loose minAreaRect beat a tight poly on clean scans.
        const methodBoost = method === 'book' ? 1.3 : method === 'hough' ? 0.8 : method.startsWith('paper') ? (kind === 'poly' ? 1.25 : 0.7) : method.startsWith('pscore') || method.startsWith('white') ? 1.05 : 1;
        const support = sideSupport(quad);
        if (support < 0.2 && qa > 0.35 * A) { rej(12); return; }            // 3.3.1: big quad whose sides cross no real edge = not a page
        const supportPen = 0.15 + 0.85 * support;
        const score = supportPen * sizeScore * rectFit * rectFit * aspectScore(quad) * paperBoost * contrastBoost * borderPen * methodBoost * (kind === 'rect' ? 0.75 : 1.1);
        cands.push({
          q: quad, score, method: method + ':' + kind,
          meta: { qa: qa / A, inside, outside, contrast, corners, sides, rectFit, support }
        });
      };

      const collect = (bin, method, mode) => {
        const cs = new cv.MatVector(), hi = new cv.Mat();
        cv.findContours(bin, cs, hi, mode, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < cs.size(); i++) {
          const cnt = cs.get(i);
          const hull = new cv.Mat(); cv.convexHull(cnt, hull, false, true);
          const ha = cv.contourArea(hull);
          if (ha > 0.05 * A && ha < FRAME_MAX * A) {
            const peri = cv.arcLength(hull, true);
            let quad = null;
            for (const e of [0.015, 0.02, 0.03, 0.045, 0.06, 0.08]) {
              const ap = new cv.Mat(); cv.approxPolyDP(hull, ap, e * peri, true);
              if (ap.rows === 4) {
                quad = []; for (let j = 0; j < 4; j++) quad.push({ x: ap.data32S[2 * j], y: ap.data32S[2 * j + 1] });
              }
              ap.delete(); if (quad) break;
            }
            if (quad) consider(quad, method, 'poly');
            else {
              // minAreaRect only when poly approx fails (spiral / wavy edges)
              const r = cv.minAreaRect(hull); const pts = cv.RotatedRect.points(r);
              consider(pts.map((p) => ({ x: p.x, y: p.y })), method, 'rect');
            }
          }
          hull.delete(); cnt.delete();
        }
        cs.delete(); hi.delete();
      };

      // 1) Paper-mask contours (primary for notebook / cluttered scenes)
      collect(paperBin, 'paper', cv.RETR_EXTERNAL);

      // 2) Canny edges
      const med = median(cv, blur);
      for (const [lo, hi] of [[0.66 * med, 1.33 * med], [20, 60], [50, 150]]) {
        const e = new cv.Mat(); cv.Canny(blur, e, Math.max(5, lo), Math.min(255, Math.max(lo + 10, hi)));
        cv.morphologyEx(e, e, cv.MORPH_CLOSE, k9); cv.dilate(e, e, k5);
        collect(e, 'canny', cv.RETR_LIST); e.delete();
      }
      for (const [m, lo, hi, name] of [[blur, 8, 24, 'canny'], [S, 20, 60, 'sat']]) {
        const e = new cv.Mat(); const sm = new cv.Mat(); cv.GaussianBlur(m, sm, new cv.Size(5, 5), 0);
        cv.Canny(sm, e, lo, hi); sm.delete();
        cv.morphologyEx(e, e, cv.MORPH_CLOSE, k9); cv.dilate(e, e, k5);
        collect(e, name, cv.RETR_EXTERNAL); e.delete();
      }
      // 2b) Hough lines → quads from the two dominant line families (handles occluded corners / merged clutter)
      try {
        const md = median(cv, blur);
        const e = new cv.Mat(); cv.Canny(blur, e, Math.max(5, 0.66 * md), Math.min(255, Math.max(0.66 * md + 10, 1.33 * md)));
        const lines = new cv.Mat();
        cv.HoughLinesP(e, lines, 1, Math.PI / 180, 60, Math.min(W, H) * 0.18, 12);
        const L = [];
        for (let i = 0; i < lines.rows; i++) {
          const [x1, y1, x2, y2] = lines.data32S.slice(i * 4, i * 4 + 4);
          const len = Math.hypot(x2 - x1, y2 - y1); let ang = Math.atan2(y2 - y1, x2 - x1); if (ang < 0) ang += Math.PI;
          L.push({ x1, y1, x2, y2, len, ang });
        }
        e.delete(); lines.delete();
        if (L.length >= 4) {
          // dominant orientation (mod 90°), length-weighted
          const bins = new Array(90).fill(0);
          for (const l of L) bins[Math.floor((l.ang * 180 / Math.PI) % 90)] += l.len;
          let bi = 0; for (let i = 0; i < 90; i++) { const v = bins[i] + bins[(i + 1) % 90] + bins[(i + 89) % 90]; if (v > bins[bi] + bins[(bi + 1) % 90] + bins[(bi + 89) % 90]) bi = i; }
          const th = (bi + 0.5) * Math.PI / 180;
          const dAng = (a, b) => { let d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };
          const famA = [], famB = [];
          for (const l of L) { if (dAng(l.ang, th) < 0.2) famA.push(l); else if (dAng(l.ang, th + Math.PI / 2) < 0.2) famB.push(l); }
          // merge collinear segments by offset along the family normal, keep strongest distinct lines
          const lineSet = (fam, ang) => {
            const nx = -Math.sin(ang), ny = Math.cos(ang); const g = [];
            for (const l of fam) {
              const off = ((l.x1 + l.x2) / 2) * nx + ((l.y1 + l.y2) / 2) * ny;
              const hit = g.find((q) => Math.abs(q.off - off) < Math.min(W, H) * 0.025);
              if (hit) { hit.len += l.len; if (l.len > hit.best.len) hit.best = l; } else g.push({ off, len: l.len, best: l });
            }
            return g.sort((a, b) => b.len - a.len).slice(0, 5);
          };
          const A2 = lineSet(famA, th), B2 = lineSet(famB, th + Math.PI / 2);
          const inter = (l1, l2) => {
            const { x1, y1, x2, y2 } = l1, { x1: x3, y1: y3, x2: x4, y2: y4 } = l2;
            const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (Math.abs(d) < 1e-6) return null;
            const a = x1 * y2 - y1 * x2, b = x3 * y4 - y3 * x4;
            return { x: (a * (x3 - x4) - (x1 - x2) * b) / d, y: (a * (y3 - y4) - (y1 - y2) * b) / d };
          };
          for (let i = 0; i < A2.length; i++) for (let j = i + 1; j < A2.length; j++) {
            if (Math.abs(A2[i].off - A2[j].off) < Math.min(W, H) * 0.2) continue;
            for (let m = 0; m < B2.length; m++) for (let n = m + 1; n < B2.length; n++) {
              if (Math.abs(B2[m].off - B2[n].off) < Math.min(W, H) * 0.2) continue;
              const q = [inter(A2[i].best, B2[m].best), inter(A2[i].best, B2[n].best), inter(A2[j].best, B2[n].best), inter(A2[j].best, B2[m].best)];
              if (q.some((p) => !p || p.x < -W * 0.02 || p.y < -H * 0.02 || p.x > W * 1.02 || p.y > H * 1.02)) continue;
              consider(q.map((p) => ({ x: Math.min(W - 1, Math.max(0, p.x)), y: Math.min(H - 1, Math.max(0, p.y)) })), 'hough', 'poly');
            }
          }
        }
      } catch (err) { /* Hough unavailable — classic candidates still apply */ }
      // 3) Otsu on V−S whiteness and on blur
      const white = M(new cv.Mat()); cv.subtract(V, S, white); cv.GaussianBlur(white, white, new cv.Size(ks(7), ks(7)), 0);
      for (const [m, name] of [[blur, 'otsu'], [white, 'white'], [paperScore, 'pscore']]) {
        const t = new cv.Mat(); cv.threshold(m, t, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        cv.morphologyEx(t, t, cv.MORPH_CLOSE, k15); cv.morphologyEx(t, t, cv.MORPH_OPEN, k9);
        collect(t, name, cv.RETR_EXTERNAL); t.delete();
      }
      // 4) adaptive
      const at = new cv.Mat(); cv.adaptiveThreshold(blur, at, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, ks(151), -6);
      cv.morphologyEx(at, at, cv.MORPH_CLOSE, k9); cv.morphologyEx(at, at, cv.MORPH_OPEN, k9);
      collect(at, 'adaptive', cv.RETR_EXTERNAL); at.delete();
      // 5) open book (3.3.1): two facing pages are found as two quads split by the gutter shadow → merge into ONE document
      if (!opts.noBook) {
        const D = 0.06 * Math.max(W, H), dd = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
        const pages = cands.filter((c) => c.meta.qa > 0.06 && c.meta.qa < 0.5).slice(0, 60);
        const seen = new Set();
        for (const a of pages) for (const b of pages) {
          if (a === b) continue;
          let m = null;
          if (dd(a.q[1], b.q[0]) < D && dd(a.q[2], b.q[3]) < D && b.q[1].x > a.q[1].x) m = [a.q[0], b.q[1], b.q[2], a.q[3]];      // side by side
          else if (dd(a.q[3], b.q[0]) < D && dd(a.q[2], b.q[1]) < D && b.q[3].y > a.q[3].y) m = [a.q[0], a.q[1], b.q[2], b.q[3]]; // stacked (book held sideways)
          if (!m) continue;
          const ra = a.meta.qa / b.meta.qa; if (ra < 0.6 || ra > 1.67) continue; // facing pages are about the same size
          const asp = (q, side) => { const w = (dd(q[0], q[1]) + dd(q[3], q[2])) / 2, h = (dd(q[0], q[3]) + dd(q[1], q[2])) / 2; return side ? h / w : w / h; };
          const sbs = m[1] === b.q[1]; // side-by-side: each page taller than wide; stacked: each page wider than tall
          if (![a.q, b.q].every((q) => { const r = asp(q, sbs); return r > 1.15 && r < 2.5; })) continue;
          const key = m.map((p) => `${Math.round(p.x / 8)},${Math.round(p.y / 8)}`).join('|'); if (seen.has(key)) continue; seen.add(key);
          consider(m.map((p) => ({ ...p })), 'book', 'poly');
        }
      }
    } finally {
      mats.forEach((m) => { try { m.delete(); } catch {} });
      free(small);
    }
    // 3.3.1: weak winners on textured scenes (cloth, tiles) are not pages
    for (let i = cands.length - 1; i >= 0; i--) if (cands[i].score < 0.08) cands.splice(i, 1);
    if (opts.debug && !cands.length) return { rej: rejN, q: null };
    if (!cands.length) return null;
    for (const c of cands) {
      // votes: agreeing candidates; the many near-identical Hough quads (text lines) count once
      const nb = cands.filter((o) => Math.max(...o.q.map((p, i) => Math.hypot(p.x - c.q[i].x, p.y - c.q[i].y))) < 0.045 * Math.max(W, H));
      const once = (o) => o.method.startsWith('hough') || o.method.startsWith('book');
      c.votes = nb.filter((o) => !once(o)).length + (nb.some((o) => o.method.startsWith('hough')) ? 1 : 0) + (nb.some((o) => o.method.startsWith('book')) ? 1 : 0);
    }
    cands.sort((a, b) => b.score * (1 + 0.3 * Math.min(b.votes, 5)) - a.score * (1 + 0.3 * Math.min(a.votes, 5)));
    const best = cands[0];
    const out = { q: best.q.map((p) => ({ x: p.x / k, y: p.y / k })), method: best.method, votes: best.votes, meta: best.meta, score: best.score };
    if (opts.debug) out.cands = cands.slice(0, 8).map((c) => ({ q: c.q.map((p) => ({ x: p.x / k, y: p.y / k })), score: c.score, votes: c.votes, method: c.method, meta: c.meta }));
    return out;
  }


  /** Rect excluding dark edge rows/cols that are much darker than the page just inside them. */
  function trimDark(cv, mat) {
    const g = new cv.Mat(); cv.cvtColor(mat, g, cv.COLOR_RGBA2GRAY);
    const W = g.cols, H = g.rows, d = g.data;
    // page brightness reference: median-ish of a band just inside the edges
    let ref = 0, n = 0; for (let y = Math.floor(H * 0.05); y < H * 0.12; y += 3) for (let x = Math.floor(W * 0.1); x < W * 0.9; x += 3) { ref += d[y * W + x]; n++; } ref /= n || 1;
    const thr = ref * 0.62;
    // share of clearly-dark pixels along a row/col (a sliver can cover only part of the width)
    const rowDark = (y) => { let k = 0, m = 0; for (let x = Math.floor(W * 0.04); x < W * 0.96; x += 2) { m++; if (d[y * W + x] < thr) k++; } return k / m; };
    const colDark = (x) => { let k = 0, m = 0; for (let y = Math.floor(H * 0.04); y < H * 0.96; y += 2) { m++; if (d[y * W + x] < thr) k++; } return k / m; };
    const scan = (len, dark, fwd) => {
      const max = Math.floor(len * 0.02), at = (i) => (fwd ? i : len - 1 - i);
      const base = dark(at(max + 6)); // ink/rules inside the page shouldn't count
      let t = 0; for (let i = 0; i < max; i++) if (dark(at(i)) > Math.max(0.05, base * 2 + 0.04)) t = i + 1;
      return t ? Math.min(max, t + 4) : 0;
    };
    const top = scan(H, rowDark, true), bot = scan(H, rowDark, false), lft = scan(W, colDark, true), rgt = scan(W, colDark, false);
    g.delete();
    if (!(top || bot || lft || rgt)) return null;
    return new cv.Rect(lft, top, W - lft - rgt, H - top - bot);
  }

  /** Perspective-correct at high resolution (≤ OUT_LONG on the long side). q in src px. */
  function warp(cv, src, q, outLong = OUT_LONG) {
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const w0 = Math.max(d(q[0], q[1]), d(q[3], q[2])), h0 = Math.max(d(q[0], q[3]), d(q[1], q[2]));
    const os = Math.min(1, outLong / Math.max(w0, h0)); // 3.3.3: native pixels — never downscale below the source, never invent pixels
    const w = Math.round(w0 * os), h = Math.round(h0 * os);
    // work on a source scaled just enough for the output (saves memory on iPhone)
    const ss = Math.min(1, os * 1.1);
    const { c: s2, k } = ss < 1 ? scaled(src, Math.max(src.width, src.height) * ss) : { c: src, k: 1 };
    const m = cv.imread(s2), out = new cv.Mat();
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap((p) => [p.x * k, p.y * k]));
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    const T = cv.getPerspectiveTransform(from, to);
    cv.warpPerspective(m, out, T, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
    // trim thin background slivers (quad edge a hair outside the paper) — at most 2.5% per side
    const r = trimDark(cv, out); let fin = out;
    if (r) fin = out.roi(r);
    const c = document.createElement('canvas'); cv.imshow(c, fin);
    if (fin !== out) fin.delete();
    [m, out, from, to, T].forEach((x) => x.delete()); if (s2 !== src) free(s2);
    return c;
  }

  /* ===== Production document-scan filters (Adobe / Apple Notes / CamScanner class) =====
   * Pipeline: white-balance → large-kernel illumination flatten → paper whitening curve
   * → CLAHE on L (LAB) → selective ink saturation → bilateral denoise → unsharp mask.
   * B&W: flatten → adaptive threshold → morphological open (speckle kill).
   */

  function histPct(m, loPct, hiPct, step = 4) {
    const d = m.data, hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += step) hist[d[i]]++;
    const n = hist.reduce((a, b) => a + b, 0) || 1;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc <= n * loPct) lo = v; if (acc <= n * hiPct) hi = v; }
    return [lo, hi];
  }
  function lut(cv, m, fn) {
    const t = new cv.Mat(1, 256, cv.CV_8U);
    for (let i = 0; i < 256; i++) t.data[i] = Math.max(0, Math.min(255, Math.round(fn(i))));
    cv.LUT(m, t, m); t.delete();
  }
  /**
   * Illumination flatten (document-scan classic):
   * estimate paper by DILATING (expand light into ink holes) + large median on a
   * downscaled copy, then divide. CLOSE would also work; OPEN is wrong here
   * because erode expands ink and cancels it in the division.
   */
  function flatten(cv, chan, strength = 1) {
    const long = Math.max(chan.cols, chan.rows);
    const f = long > 1800 ? 0.22 : long > 1000 ? 0.3 : 0.45;
    const sm = new cv.Mat(), bg = new cv.Mat(), out = new cv.Mat();
    cv.resize(chan, sm, new cv.Size(0, 0), f, f, cv.INTER_AREA);
    // kernel ≥ max stroke width after downscale so dilate fills every ink glyph
    const ksz = Math.max(11, Math.round(Math.max(sm.cols, sm.rows) / 22) | 1);
    const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ksz, ksz));
    cv.dilate(sm, sm, k);                                  // light expands → ink gone
    const mb = Math.min(51, Math.max(17, (Math.round(ksz * 1.4) | 1)));
    cv.medianBlur(sm, sm, mb);
    cv.GaussianBlur(sm, sm, new cv.Size(0, 0), Math.max(1.5, ksz / 5));
    cv.resize(sm, bg, new cv.Size(chan.cols, chan.rows), 0, 0, cv.INTER_LINEAR);
    { // floor relative to paper level: big dark regions (photos, black boxes, clutter) must not
      // become the "background" — that is what produced bright halos/washed-out blocks.
      const [, hiP] = histPct(bg, 0.5, 0.97, 7);
      const floor = Math.max(32, Math.round(hiP * 0.62));
      lut(cv, bg, (v) => Math.max(floor, v));
    }
    cv.divide(chan, bg, out, 255, -1);
    if (strength !== 1) {
      const mix = new cv.Mat();
      cv.addWeighted(chan, 1 - strength, out, strength, 0, mix);
      out.delete(); [sm, bg, k].forEach((x) => x.delete());
      return mix;
    }
    [sm, bg, k].forEach((x) => x.delete());
    return out;
  }
  /** Gray-world / paper-percentile white balance on RGB mat (in place). */
  function whiteBalance(cv, rgb) {
    const ch = new cv.MatVector(); cv.split(rgb, ch);
    const means = [];
    for (let i = 0; i < 3; i++) {
      const m = ch.get(i); const [, hi] = histPct(m, 0.70, 0.96, 8); m.delete(); // paper-ish high percentile
      means.push(Math.max(40, hi));
    }
    const target = (means[0] + means[1] + means[2]) / 3;
    for (let i = 0; i < 3; i++) {
      const g = target / means[i];
      if (Math.abs(g - 1) > 0.02) { const m = ch.get(i); lut(cv, m, (v) => v * g); m.delete(); }
    }
    cv.merge(ch, rgb); ch.delete();
  }
  /**
   * Piecewise document curve:
   *  - deep ink (<~inkHi) → pushed darker
   *  - midtones → gentle contrast
   *  - paper shoulder → steep lift to pure white
   * Never lifts true ink into gray.
   */
  function whitenCurve(cv, m, inkFloor, paperCeiling) {
    const inkHi = Math.max(55, Math.min(110, inkFloor + 55));
    const paperLo = Math.max(inkHi + 40, Math.min(210, paperCeiling - 15));
    const paperHi = Math.max(paperLo + 20, Math.min(252, paperCeiling + 10));
    lut(cv, m, (v) => {
      if (v <= inkHi) {
        // deepen ink: 0..inkHi → 0..inkHi*0.72
        return Math.round(v * 0.55);
      }
      if (v >= paperHi) return 255;
      if (v >= paperLo) {
        // shoulder: paperLo..paperHi → ~215..255
        const t = (v - paperLo) / (paperHi - paperLo);
        return Math.round(220 + t * t * 35);
      }
      // midtones: inkHi..paperLo → inkHi*0.72 .. 215
      const t = (v - inkHi) / (paperLo - inkHi);
      const a = inkHi * 0.55, b = 220;
      // slight contrast in mids (smoothstep)
      const s = t * t * (3 - 2 * t);
      return Math.round(a + s * (b - a));
    });
  }
  function sharpen(cv, m, amount = 0.35, sigma = 0.7) {
    const b = new cv.Mat();
    cv.GaussianBlur(m, b, new cv.Size(0, 0), sigma);
    cv.addWeighted(m, 1 + amount, b, -amount, 0, m);
    b.delete();
  }
  function denoise(cv, rgb) {
    const d = new cv.Mat();
    try {
      cv.bilateralFilter(rgb, d, 5, 40, 40);
      d.copyTo(rgb);
    } catch {}
    d.delete();
  }
  function claheL(cv, rgb, clip = 1.4, tiles = 8) {
    const lab = new cv.Mat(), ch = new cv.MatVector();
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    cv.split(lab, ch);
    const L = ch.get(0);
    const clahe = new cv.CLAHE(clip, new cv.Size(tiles, tiles));
    const Lo = new cv.Mat(); clahe.apply(L, Lo);
    ch.set(0, Lo); cv.merge(ch, lab); cv.cvtColor(lab, rgb, cv.COLOR_Lab2RGB);
    [lab, ch, L, Lo, clahe].forEach((x) => { try { x.delete(); } catch {} });
  }
  function bleachPaper(cv, rgb, lumaThresh = 200, chromaThresh = 22) {
    const lab = new cv.Mat();
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    // lookup tables instead of per-pixel hypot/min/max (≈5× faster at 2500px)
    const bt = new Float32Array(256);
    for (let v = 0; v < 256; v++) { const t = Math.max(0, Math.min(1, (v - (lumaThresh - 40)) / 40)); bt[v] = v < lumaThresh - 40 ? 0 : t * t; }
    const ct = new Float32Array(65536);
    for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) {
      const chroma = Math.hypot(a - 128, b - 128);
      ct[(a << 8) | b] = chroma > chromaThresh + 18 ? 0 : Math.max(0, Math.min(1, 1 - (chroma - chromaThresh) / 18));
    }
    const Ld = lab.data, d = rgb.data, n = rgb.rows * rgb.cols;
    for (let i = 0, k = 0; i < n; i++, k += 3) {
      const wl = bt[Ld[k]]; if (wl === 0) continue;
      const t = wl * ct[(Ld[k + 1] << 8) | Ld[k + 2]]; if (t <= 0.01) continue;
      const u = 255 * t, r = 1 - t;
      d[k] = d[k] * r + u + 0.5; d[k + 1] = d[k + 1] * r + u + 0.5; d[k + 2] = d[k + 2] * r + u + 0.5;
    }
    lab.delete();
  }
  function punchInkColor(cv, rgb, amount = 1.35) {
    const hsv = new cv.Mat(), ch = new cv.MatVector();
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    cv.split(hsv, ch);
    const s = ch.get(1);
    lut(cv, s, (v) => (v < 14 ? Math.round(v * 0.4) : Math.min(255, Math.round(v * amount))));
    ch.set(1, s); cv.merge(ch, hsv); cv.cvtColor(hsv, rgb, cv.COLOR_HSV2RGB);
    [hsv, ch, s].forEach((x) => x.delete());
  }
  const FILTERS = ['original', 'magic', 'white', 'bw', 'gray'];

  function filterMagic(cv, src) {
    const rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    whiteBalance(cv, rgb);
    // Shared-luma illumination map (same bg for R/G/B) kills colour-cast shadows.
    {
      const g = new cv.Mat(); cv.cvtColor(rgb, g, cv.COLOR_RGB2GRAY);
      const long = Math.max(g.cols, g.rows);
      const f = long > 1800 ? 0.22 : 0.3;
      const sm = new cv.Mat(), bg = new cv.Mat();
      cv.resize(g, sm, new cv.Size(0, 0), f, f, cv.INTER_AREA);
      const ksz = Math.max(15, Math.round(Math.max(sm.cols, sm.rows) / 18) | 1);
      const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ksz, ksz));
      cv.dilate(sm, sm, k);
      cv.medianBlur(sm, sm, Math.min(51, Math.max(21, (ksz | 1))));
      cv.GaussianBlur(sm, sm, new cv.Size(0, 0), Math.max(2, ksz / 4));
      cv.resize(sm, bg, new cv.Size(g.cols, g.rows), 0, 0, cv.INTER_LINEAR);
      { const [, hiP] = histPct(bg, 0.5, 0.97, 7); const floor = Math.max(36, Math.round(hiP * 0.62)); lut(cv, bg, (v) => Math.max(floor, v)); }
      const ch = new cv.MatVector(); cv.split(rgb, ch);
      const res = new cv.MatVector();
      for (let i = 0; i < 3; i++) {
        const c = ch.get(i), out = new cv.Mat();
        cv.divide(c, bg, out, 255, -1);
        res.push_back(out); c.delete(); out.delete();
      }
      cv.merge(res, rgb); res.delete(); ch.delete();
      [g, sm, bg, k].forEach((x) => x.delete());
    }
    const g = new cv.Mat(); cv.cvtColor(rgb, g, cv.COLOR_RGB2GRAY);
    const [ink, paper] = histPct(g, 0.03, 0.88, 5); g.delete();
    // gentle shared stretch that keeps ink dense
    const ch2 = new cv.MatVector(); cv.split(rgb, ch2);
    for (let i = 0; i < 3; i++) { const m = ch2.get(i); whitenCurve(cv, m, Math.max(5, ink - 5), Math.min(245, paper + 10)); m.delete(); }
    cv.merge(ch2, rgb); ch2.delete();
    bleachPaper(cv, rgb, 218, 16);
    claheL(cv, rgb, 1.35, 8);
    punchInkColor(cv, rgb, 1.38);
    denoise(cv, rgb);
    sharpen(cv, rgb, 0.32, 0.65);
    // final paper cleanup after CLAHE (which can reintroduce grain)
    bleachPaper(cv, rgb, 225, 14);
    return rgb;
  }
  /** Magic Colour 2: extra saturation for stamps, highlighter and coloured forms (paper stays white). */
  function vivid(cv, rgb) {
    const hsv = new cv.Mat(); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const ch = new cv.MatVector(); cv.split(hsv, ch); const sat = ch.get(1);
    cv.convertScaleAbs(sat, sat, 1.35, 0); cv.merge(ch, hsv); sat.delete(); ch.delete();
    cv.cvtColor(hsv, rgb, cv.COLOR_HSV2RGB); hsv.delete();
  }
  function filterWhite(cv, src) {
    const g0 = new cv.Mat(); cv.cvtColor(src, g0, cv.COLOR_RGBA2GRAY);
    const f = flatten(cv, g0, 1); g0.delete();
    const [ink, paper] = histPct(f, 0.03, 0.88, 4);
    whitenCurve(cv, f, Math.max(4, ink - 8), Math.min(242, paper + 6));
    // hard paper bleach on gray
    lut(cv, f, (v) => (v >= 215 ? 255 : v <= 35 ? Math.round(v * 0.75) : v));
    sharpen(cv, f, 0.4, 0.65);
    return f;
  }
  function filterBw(cv, src) {
    const g0 = new cv.Mat(); cv.cvtColor(src, g0, cv.COLOR_RGBA2GRAY);
    const f = flatten(cv, g0, 1); g0.delete();
    cv.GaussianBlur(f, f, new cv.Size(3, 3), 0);
    const long = Math.max(f.cols, f.rows);
    let bs = (Math.round(long / 40) | 1); if (bs < 31) bs = 31; if (bs > 91) bs = 91;
    const out = new cv.Mat();
    cv.adaptiveThreshold(f, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, bs, 12);
    const paper = new cv.Mat();
    cv.threshold(f, paper, 195, 255, cv.THRESH_BINARY);
    cv.bitwise_or(out, paper, out); paper.delete();
    // light open kills 1px speckles; tiny close heals broken strokes
    const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2, 2));
    cv.morphologyEx(out, out, cv.MORPH_OPEN, k);
    const k2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
    cv.morphologyEx(out, out, cv.MORPH_CLOSE, k2);
    [f, k, k2].forEach((x) => x.delete());
    return out;
  }
  function filterGray(cv, src) {
    const g = new cv.Mat(); cv.cvtColor(src, g, cv.COLOR_RGBA2GRAY);
    const f = flatten(cv, g, 1); g.delete();
    const [lo, hi] = histPct(f, 0.01, 0.99, 4);
    if (hi - lo > 30) { const a = 255 / (hi - lo); cv.convertScaleAbs(f, f, a, -lo * a); }
    sharpen(cv, f, 0.28, 0.7);
    return f;
  }

  /** Apply a scan filter + optional brightness/contrast (-100..100). Returns a new canvas. */
  function filter(cv, canvas, name = 'original', bc = null) {
    const src = cv.imread(canvas); let out = null;
    try {
      if (name === 'magic') out = filterMagic(cv, src);
      else if (name === 'magic2') { out = filterMagic(cv, src); punchInkColor(cv, out, 1.5); vivid(cv, out); }
      else if (name === 'white') out = filterWhite(cv, src);
      else if (name === 'bw') out = filterBw(cv, src);
      else if (name === 'gray') out = filterGray(cv, src);
      else { out = new cv.Mat(); cv.cvtColor(src, out, cv.COLOR_RGBA2RGB); }
      if (bc && (bc.b || bc.c)) {
        const a = 1 + bc.c / 100, b = bc.b * 1.28;
        cv.convertScaleAbs(out, out, a, 128 * (1 - a) + b);
      }
      const c = document.createElement('canvas'); cv.imshow(c, out); return c;
    } finally { src.delete(); if (out) out.delete(); }
  }

  /** Hard full-frame rule shared by every path (live outline, auto-capture, still detect, v2 refine). */
  function fullFrame(q, W, H) { return !q || polyArea(q) > FRAME_MAX * W * H; }
  return { decode, scaled, free, detect, warp, filter, order, fullFrame, FILTERS, OUT_LONG, FRAME_MAX };
})();
