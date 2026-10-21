'use strict';
/* DocSnap 3.4 — in-app live camera: continuous capture, live page outline, auto-capture, "Lift-off" capture motion.
 * Lift-off (motion README v2): the captured sheet flattens, tilts and flies into the tray on its own compositor layer
 * (#camFx). It never blocks the camera: detection resumes at shutter +180 ms and the next capture is accepted from +300 ms. */

/** Detection behind one small interface so the detector can be swapped (e.g. detector-v2) without touching the UI.
 *  live(canvas)  → { q:[{x,y}×4] in canvas px, conf } | null   (small ~480px frames, worker)
 *  still(canvas) → { q, conf } | null                           (full photo, worker) */
const Detector = {
  async live(canvas) {
    const bmp = await createImageBitmap(canvas);
    const r = await VW.call('detectLive', { src: bmp, conf: CONF_FLAG, book: !!settings.book }, [bmp], -1);
    CAM.notBook = !!(r && r.notBook); CAM.lastLive = r && { conf: r.conf, q: !!r.q, notBook: !!r.notBook };
    return r && r.q && !Vision.fullFrame(r.q, canvas.width, canvas.height) ? { q: r.q, conf: r.conf, ms: r.ms } : null;
  },
  async still(canvas) { const d = await vDetectBest(canvas); return d ? { q: d.q, conf: d.conf } : null; },
  detect(canvas) { return this.still(canvas); }
};

const CAM = {
  stream: null, track: null, starting: null, torch: false, raf: 0, inflight: false, lastDet: 0, miss: 0,
  q: null, disp: null, alpha: 0, hist: [], armQ: null, armT: 0, cool: null, shooting: false, lastFrame: 0,
  small: null, stats: { n: 0, ms: 0 }, readyAt: 0, detResume: 0, queued: false, fx: 0, ready: [], pend: [],
  get auto() { return settings.camAuto !== false; }, get hd() { return settings.camHD !== false; }
};
const camOk = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

const LIFT = { detResume: 180, ready: 300, flatten: [80, 200], hold: 280, fly: [310, 250], land: [560, 340], refine: 750, done: 900 };
function camMsg(t, hold) { const m = $('camMsg'); if (m.textContent !== t) m.textContent = t; $('camStat').classList.toggle('hold', !!hold); $('camStat').classList.toggle('ok', /^Captured/.test(t)); $('camAuto').hidden = !t || /^(Captured|Retake|Page \d+ deleted|Starting)/.test(t); }
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function camChrome() {
  $('camAuto').textContent = CAM.auto ? 'Auto' : 'Manual'; $('camAuto').classList.toggle('on', CAM.auto); $('camAuto').setAttribute('aria-pressed', CAM.auto);
  $('camHD').classList.toggle('on', CAM.hd); $('camHD').setAttribute('aria-pressed', CAM.hd);
  const bk = !!settings.book; $('camGrid').hidden = true;
  $('camModes').querySelectorAll('button').forEach((b) => { const on = b.dataset.m === (bk ? 'book' : 'doc'); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('camBook').setAttribute('aria-pressed', bk); $('camBook').classList.toggle('on', bk);
  $('camModes').hidden = !!CAM.replace;
  $('camTorch').classList.toggle('on', CAM.torch);
}
function openCam(fresh = true) {
  if (fresh) CAM.replace = null;
  if (fresh) { scan.pages = []; scan.i = 0; scan.returnTo = (curView === 'doc' || curView === 'page') && current ? current.id : null; scan.src = 'live'; }
  CAM.cool = null; CAM.q = CAM.disp = null; CAM.hist = []; CAM.trayHold = 0; CAM.queued = false; CAM.readyAt = CAM.detResume = 0; disarm();
  $('camPerm').hidden = true; camChrome(); renderTray(false); $('cam').classList.toggle('replacing', !!CAM.replace); camMsg('Starting camera…'); camHint();
  show('cam', 'up');
  camStart();
}
async function camStart() {
  if (CAM.stream || CAM.starting) return CAM.starting;
  CAM.starting = (async () => {
    const v = $('camVideo');
    // 3.3.3: ask for the sensor's full 4:3 frame (pages are ~4:3; a 16:9 4K stream crops the sensor). The browser picks its max.
    const want = CAM.hd ? { width: { ideal: 4032 }, height: { ideal: 3024 }, aspectRatio: { ideal: 4 / 3 } } : { width: { ideal: 1920 }, height: { ideal: 1440 } };
    let s = null, err = null;
    for (const c of [{ facingMode: { ideal: 'environment' }, ...want }, { facingMode: { ideal: 'environment' } }, true]) {
      try { s = await navigator.mediaDevices.getUserMedia({ video: c, audio: false }); break; }
      catch (e) { err = e; if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break; }
    }
    if (curView !== 'cam') { if (s) s.getTracks().forEach((t) => t.stop()); return; }
    if (!s) return camDenied(err);
    CAM.stream = s; CAM.track = s.getVideoTracks()[0];
    v.srcObject = s; v.setAttribute('playsinline', ''); v.muted = true;
    try { await v.play(); } catch {}
    let caps = {}; try { caps = CAM.track.getCapabilities ? CAM.track.getCapabilities() : {}; } catch {}
    $('camTorch').hidden = !caps.torch; CAM.torch = false;
    if (caps.focusMode && caps.focusMode.includes('continuous')) CAM.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    // full-resolution stills where the browser can take them (ImageCapture: Chrome/Android); otherwise the video frame
    CAM.ic = null; try { if (CAM.hd && typeof ImageCapture === 'function') CAM.ic = new ImageCapture(CAM.track); } catch {}
    const st = CAM.track.getSettings ? CAM.track.getSettings() : {};
    CAM.res = `${st.width || v.videoWidth}×${st.height || v.videoHeight}`;
    camChrome(); camMsg(CAM.replace ? `Retake page ${scan.pages.indexOf(CAM.replace) + 1}` : 'Looking for a page');
    cancelAnimationFrame(CAM.raf); CAM.last = performance.now(); CAM.raf = requestAnimationFrame(camLoop);
  })().finally(() => { CAM.starting = null; });
  return CAM.starting;
}
function camDenied(e) {
  const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
  $('camPermT').textContent = denied ? 'Camera access is off' : 'Camera isn’t available';
  $('camPermM').textContent = denied ? 'To scan here, allow Camera for this site in Settings › Safari › Camera. You can still use the iPhone camera or Photos.' : 'You can still scan with the iPhone camera or pick from Photos.';
  $('camPerm').hidden = false; camMsg('');
}
function camStop() {
  cancelAnimationFrame(CAM.raf); CAM.raf = 0;
  if (CAM.stream) CAM.stream.getTracks().forEach((t) => t.stop());
  CAM.stream = null; CAM.track = null; $('camVideo').srcObject = null; disarm();
}

// ---- geometry: video px ↔ screen (object-fit: cover)
function camMap() {
  const v = $('camVideo'), W = v.clientWidth, H = v.clientHeight, vw = v.videoWidth || 1, vh = v.videoHeight || 1;
  const k = Math.max(W / vw, H / vh); return { k, ox: (W - vw * k) / 2, oy: (H - vh * k) / 2, W, H, vw, vh };
}
const qDist = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

function camLoop(now) {
  CAM.raf = requestAnimationFrame(camLoop);
  const v = $('camVideo'); if (!v.videoWidth) return;
  const dt = Math.min(100, now - (CAM.last || now)); CAM.last = now;
  // detection: throttled, one frame in flight, small frame reused
  if (!CAM.inflight && now - CAM.lastDet > 110 && !CAM.shooting && now >= CAM.detResume) {
    CAM.lastDet = now; CAM.inflight = true; const tf = now;
    const L = 720, s = Math.min(1, L / Math.max(v.videoWidth, v.videoHeight)); // 3.3.3: detector-v3 live outline on a 720px frame
    const c = CAM.small || (CAM.small = document.createElement('canvas'));
    const w = Math.round(v.videoWidth * s), h = Math.round(v.videoHeight * s);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    Detector.live(c).then((d) => onLive(d, w, h, tf)).catch(() => {}).finally(() => { CAM.inflight = false; });
  }
  // ease displayed corners toward the latest detection (~120ms)
  const e = 1 - Math.exp(-dt / 40);
  if (CAM.q) { if (!CAM.disp) CAM.disp = CAM.q.map((p) => ({ ...p })); else CAM.disp.forEach((p, i) => { p.x += (CAM.q[i].x - p.x) * e; p.y += (CAM.q[i].y - p.y) * e; }); }
  CAM.alpha += ((CAM.q ? 1 : 0) - CAM.alpha) * (1 - Math.exp(-dt / 70));
  drawCamOverlay();
  if (CAM.armQ && now - CAM.armT >= 600 && !CAM.shooting && now >= CAM.readyAt) camShoot(true);
  if (CAM.queued && now >= CAM.readyAt && !CAM.shooting) { CAM.queued = false; camShoot(false); } // a tap during the 300 ms re-arm fires as soon as it opens
}
function onLive(d, w, h, tf) {
  if (curView !== 'cam') return;
  CAM.stats.n++; if (d) CAM.stats.ms += d.ms || 0;
  // shutter → ready: the first live detection result from a frame grabbed after the shot, and captures accepted again
  if (CAM.pend.length) { const nw = performance.now(); CAM.pend = CAM.pend.filter((t0) => { if (tf <= t0) return true; CAM.ready.push(Math.round(Math.max(nw, t0 + LIFT.ready) - t0)); return false; }); }
  const v = $('camVideo'), sx = v.videoWidth / w, sy = v.videoHeight / h;
  if (!d) {
    if (++CAM.miss >= 2) { CAM.q = null; CAM.hist = []; if (CAM.armQ) disarm(); if (CAM.miss > 3) CAM.cool = null; if (!CAM.shooting && !CAM.capMsg) camMsg(settings.book ? (CAM.notBook ? 'Fit the open book in the frame' : 'Looking for a book') : 'Looking for a page'); camHint(); }
    return;
  }
  CAM.miss = 0;
  const q = Vision.order(d.q).map((p) => ({ x: p.x * sx, y: p.y * sy }));
  CAM.q = q; CAM.hist.push(q); if (CAM.hist.length > 4) CAM.hist.shift();
  const diag = Math.hypot(v.videoWidth, v.videoHeight), tol = 0.018 * diag;
  if (CAM.cool && qDist(q, CAM.cool) > 0.08 * diag) CAM.cool = null; // a new page (or moved) → auto may fire again
  const stable = CAM.hist.length >= 3 && CAM.hist.slice(1).every((h2, i) => qDist(h2, CAM.hist[i]) < tol);
  if (CAM.armQ) { if (qDist(q, CAM.armQ) > tol * 1.4) { disarm(); } }
  else if (CAM.auto && stable && !CAM.cool && !CAM.shooting && $('busy').hidden && performance.now() >= CAM.readyAt) arm(q);
  if (!CAM.capMsg && !CAM.shooting) camMsg(CAM.cool ? 'Turn to the next page' : CAM.auto ? (CAM.armQ ? 'Hold steady' : 'Page found') : 'Page found · tap to shoot', !!CAM.armQ);
  camHint(true);
}
function camHint(found) { $('camHint').textContent = curView === 'cam' && found && !CAM.replace ? `Page ${scan.pages.length + 1} · Edges found` : ''; }
function arm(q) {
  CAM.armQ = q; CAM.armT = performance.now();
  const r = $('camShutter').querySelector('.ring'); r.classList.remove('prog'); void r.getBoundingClientRect(); r.classList.add('prog');
  $('camShutter').classList.add('arming');
}
function disarm() { CAM.armQ = null; const s = $('camShutter'); if (!s) return; s.querySelector('.ring').classList.remove('prog'); s.classList.remove('arming'); }
/** Live overlay (spec §2.1 phases 1–3): searching brackets on an A4 guide; found = quad + 8% wash + corner brackets;
 *  locking = clockwise perimeter sweep timed with the 600 ms ring. Fades under the flash and back in by +300. */
function drawCamOverlay() {
  const c = $('camOverlay'), dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight, now = performance.now();
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
  x.setTransform(dpr, 0, 0, dpr, 0, 0); x.lineCap = 'round'; x.lineJoin = 'round';
  // fade out under the flash (0–80), back in during the re-arm (180–300)
  const since = now - (CAM.t0Shot || -1e9), fx = since < 80 ? 1 - since / 80 : since < LIFT.detResume ? 0 : since < LIFT.ready ? (since - LIFT.detResume) / (LIFT.ready - LIFT.detResume) : 1;
  const bracket = (pts, arm, col, lw) => {
    x.strokeStyle = col; x.lineWidth = lw; x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 4;
    for (let i = 0; i < 4; i++) {
      const p = pts[i], a = pts[(i + 3) % 4], b = pts[(i + 1) % 4], la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const ka = Math.min(arm, la * 0.3) / la, kb = Math.min(arm, lb * 0.3) / lb;
      x.beginPath(); x.moveTo(p[0] + (a[0] - p[0]) * ka, p[1] + (a[1] - p[1]) * ka); x.lineTo(p[0], p[1]); x.lineTo(p[0] + (b[0] - p[0]) * kb, p[1] + (b[1] - p[1]) * kb); x.stroke();
    }
    x.shadowBlur = 0;
  };
  if (!CAM.disp || CAM.alpha < 0.02) {
    if (!CAM.q) CAM.disp = null;
    if ($('camPerm').hidden && CAM.stream && !CAM.replace) { // searching: four brackets on a centred A4 box (62% width), breathing
      const u = (Math.sin(now / 1600 * Math.PI * 2) + 1) / 2, s = 0.98 + 0.04 * u, bw = W * 0.62 * s, bh = bw * 297 / 210, cx = W / 2, cy = H * 0.41;
      x.globalAlpha = (0.55 + 0.25 * u) * fx * (1 - Math.min(1, CAM.alpha * 3));
      bracket([[cx - bw / 2, cy - bh / 2], [cx + bw / 2, cy - bh / 2], [cx + bw / 2, cy + bh / 2], [cx - bw / 2, cy + bh / 2]], 24, '#d9fbf5', 2);
      x.globalAlpha = 1;
    }
    return;
  }
  const m = camMap(), P = CAM.disp.map((p) => [m.ox + p.x * m.k, m.oy + p.y * m.k]);
  x.globalAlpha = Math.min(1, CAM.alpha) * fx;
  const path = () => { x.beginPath(); P.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); };
  path(); x.fillStyle = 'rgba(45,212,191,.08)'; x.fill();
  x.shadowColor = 'rgba(45,212,191,.9)'; x.shadowBlur = 8; x.strokeStyle = 'rgba(45,212,191,.75)'; x.lineWidth = CAM.armQ ? 2.5 : 1.5; x.stroke(); x.shadowBlur = 0;
  if (CAM.armQ) { // locking sweep: clockwise from top-left, in step with the ring
    const per = P.reduce((a, p, i) => a + Math.hypot(P[(i + 1) % 4][0] - p[0], P[(i + 1) % 4][1] - p[1]), 0), u = Math.min(1, (now - CAM.armT) / 600);
    path(); x.setLineDash([per * u, per]); x.strokeStyle = '#d9fbf5'; x.lineWidth = 2.5; x.shadowColor = 'rgba(45,212,191,.9)'; x.shadowBlur = 10; x.stroke(); x.setLineDash([]); x.shadowBlur = 0;
  }
  bracket(P, 30, '#2dd4bf', 5);
  if (settings.book) { // Book mode: dashed spine guide where the spread will be split
    const d = CAM.disp, Q = (p) => [m.ox + p.x * m.k, m.oy + p.y * m.k], a = Q({ x: (d[0].x + d[1].x) / 2, y: (d[0].y + d[1].y) / 2 }), b = Q({ x: (d[3].x + d[2].x) / 2, y: (d[3].y + d[2].y) / 2 });
    x.strokeStyle = '#2dd4bf'; x.setLineDash([6, 5]); x.lineWidth = 1.5; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); x.setLineDash([]);
  }
  x.globalAlpha = 1;
}

async function camShoot(auto) {
  const v = $('camVideo'); if (CAM.shooting || !v.videoWidth) return;
  const now = performance.now();
  if (now < CAM.readyAt) { if (!auto) CAM.queued = true; return; } // re-arming: a manual tap is kept and fires at +300
  CAM.shooting = true; CAM.t0Shot = now; CAM.detResume = now + LIFT.detResume; CAM.readyAt = now + LIFT.ready; CAM.pend.push(now); disarm();
  const sh = $('camShutter'); sh.classList.add('press'); setTimeout(() => sh.classList.remove('press'), 80);
  try {
    // full-resolution still straight from the video frame
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    haptic('shutter');
    const quad = CAM.disp && CAM.alpha > 0.5 ? CAM.disp.map((p) => ({ ...p })) : null;
    CAM.cool = CAM.q || null; CAM.hist = []; CAM.miss = 0; // the outline fades under the flash and returns, found, during the re-arm
    const lift = liftOff(c, quad);
    // 3.3.1 fast shutter: a tray thumbnail straight from the frame; the full-res JPEG encodes in the background and
    // detection / v2 refine / warp run later in the batch chain — the next shot is possible right away
    const tc = document.createElement('canvas'), ts = 240 / Math.max(c.width, c.height); tc.width = Math.round(c.width * ts); tc.height = Math.round(c.height * ts);
    tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
    const thumb = tc.toDataURL('image/jpeg', 0.7); tc.width = tc.height = 0;
    const frameP = () => canvasToBlob(c, 0.92);
    const fileP = (CAM.ic ? Promise.race([CAM.ic.takePhoto(), sleep(2500).then(() => null)]).catch(() => null).then(async (ph) => (ph && ph.size > 50000 ? ph : frameP())) : frameP())
      .then((blob) => { Vision.free(c); return new File([blob], `scan-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' }); });
    if (CAM.replace) {
      const file = await fileP; // retake of one page from the grid / crop editor
      const pg = CAM.replace; CAM.replace = null;
      Object.assign(pg, { status: 'proc', file, raw: null, orig: null, found: false, _thumb: burl(file), _previews: null, _origUrl: null, _final: null, _finalF: null, _pblobs: null });
      batchChain.p = batchChain.p.then(() => processBatchPage(pg));
      await lift.landed; CAM.shooting = false; camStop(); openBatch(); toast(`Page ${scan.pages.indexOf(pg) + 1} retaken`); return;
    }
    batchAdd([{ fileP, thumb, book: !!settings.book }]);
    const pg = scan.pages[scan.pages.length - 1]; if (pg) pg.auto = !!auto;
    const n = scan.pages.length;
    CAM.capMsg = true; clearTimeout(CAM.capT);
    setTimeout(() => { if (curView === 'cam') camMsg(`Captured · ${n}`); }, 120); // pill rolls during the re-arm (+120 → +300)
    CAM.capT = setTimeout(() => { CAM.capMsg = false; }, LIFT.done);
    CAM.lastShot = performance.now() - CAM.t0Shot;
    CAM.shooting = false;
    CAM.trayHold = (CAM.trayHold || 0) + 1; renderTray(false); // the new page joins the tray when its sheet lands
    lift.landed.then(() => { CAM.trayHold = Math.max(0, CAM.trayHold - 1); if (curView === 'cam') renderTray(true); });
    return;
  } catch (e) { toast('Couldn’t take the photo', 'err'); }
  CAM.shooting = false;
}

// ---- Lift-off motion helpers ----
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function waapiEase(name, fallback) { const v = cssVar(name); try { return v && CSS.supports('transition-timing-function', v) ? v : fallback; } catch { return fallback; } }
/** Sample a CSS linear() easing (evenly spaced stops) as a JS function, for the rAF-driven flatten. */
function easeFn(name) {
  const m = /linear\(([^)]*)\)/.exec(cssVar(name) || ''); if (!m) return (u) => 1 - Math.pow(1 - u, 3);
  const pts = m[1].split(',').map((s) => parseFloat(s)); const k = pts.length - 1;
  return (u) => { if (u <= 0) return 0; if (u >= 1) return 1; const f = u * k, i = Math.floor(f); return pts[i] + (pts[i + 1] - pts[i]) * (f - i); };
}
function cubicBezier(x1, y1, x2, y2) {
  const B = (t, a, b) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
  return (x) => { let lo = 0, hi = 1, t = x; for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; if (B(t, x1, x2) < x) lo = t; else hi = t; } return B(t, y1, y2); };
}
/** 2D projective transform mapping 4 src points onto 4 dst points, as a CSS matrix3d (applied with transform-origin 0 0). */
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) { // Gaussian elimination with partial pivoting
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return `matrix3d(${h[0]},${h[3]},0,${h[6]},${h[1]},${h[4]},0,${h[7]},0,0,1,0,${h[2]},${h[5]},0,1)`;
}
/** Lift-off (spec §2.1, motion README v2). Returns { landed, done } promises; the camera never waits on them. */
function liftOff(frame, quad) {
  const t0 = CAM.t0Shot, host = $('camFx'), m = camMap(), W = m.W, H = m.H;
  const flash = $('camFlash');
  if (reduceMotion() || !host.animate) { // Reduce Motion: a soft flash, the tray updates in place
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    return { landed: Promise.resolve(), done: Promise.resolve() };
  }
  const P = quad ? quad.map((p) => [m.ox + p.x * m.k, m.oy + p.y * m.k]) : [[16, 120], [W - 16, 120], [W - 16, H - 260], [16, H - 260]];
  const side = (a, b) => Math.hypot(P[b][0] - P[a][0], P[b][1] - P[a][1]);
  const aspect = Math.min(1.9, Math.max(0.6, (side(1, 2) + side(3, 0)) / Math.max(1, side(0, 1) + side(2, 3))));
  const rw = W * 0.62, rh = Math.min(H * 0.5, rw * aspect), rcx = W / 2, rcy = H * 0.41;
  const R = [[rcx - rw / 2, rcy - rh / 2], [rcx + rw / 2, rcy - rh / 2], [rcx + rw / 2, rcy + rh / 2], [rcx - rw / 2, rcy + rh / 2]];
  // layers: X (fly x) › Y (fly y + lift) › S (scale + tilt about the sheet centre, shadow) › F (the frame, clipped to the quad, homography)
  const dpr = Math.min(2, devicePixelRatio || 1), cv = document.createElement('canvas'); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.getContext('2d').drawImage(frame, m.ox * dpr, m.oy * dpr, m.vw * m.k * dpr, m.vh * m.k * dpr);
  const poly = `polygon(${P.map((p) => `${p[0]}px ${p[1]}px`).join(',')})`;
  const F = el('div', { style: `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;clip-path:${poly};-webkit-clip-path:${poly}` });
  cv.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px`;
  const fl = el('div', { style: `position:absolute;inset:0;background:radial-gradient(closest-side at ${(P[0][0] + P[2][0]) / 2}px ${(P[0][1] + P[2][1]) / 2}px,#fff,rgba(255,255,255,.6));opacity:0` });
  F.append(cv, fl);
  const S = el('div', { style: `position:absolute;inset:0;transform-origin:${rcx}px ${rcy}px` }, F);
  const Y = el('div', { style: 'position:absolute;inset:0' }, S), X = el('div', { class: 'fsheet-layer', style: 'position:absolute;inset:0;will-change:transform' }, Y);
  host.append(X); CAM.fx++;
  const at = (ms) => Math.max(0, t0 + ms - performance.now());
  const smooth = waapiEase('--sp-smooth', 'cubic-bezier(.32,.72,0,1)'), eOut = 'cubic-bezier(.32,.72,0,1)';
  // flash: 0 → .6 (0–40) → 0 (40–200), clipped to the quad
  fl.animate([{ opacity: 0 }, { opacity: 0.6, offset: 0.2 }, { opacity: 0 }], { duration: 200, easing: 'ease-in-out' });
  // flatten +80 for 200 ms: per-frame homography of the corners easing from the quad to the upright sheet
  const es = easeFn('--sp-smooth');
  const flat = () => new Promise((res) => {
    const t1 = t0 + LIFT.flatten[0];
    const step = () => {
      const u = Math.min(1, Math.max(0, (performance.now() - t1) / LIFT.flatten[1])), e = es(u);
      const C = P.map((p, i) => [p[0] + (R[i][0] - p[0]) * e, p[1] + (R[i][1] - p[1]) * e]);
      try { F.style.transform = homography(P, C); } catch {}
      if (u < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  flat();
  S.animate([{ filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))' }, { filter: 'drop-shadow(0 6px 14px rgba(0,0,0,.45))' }], { duration: 200, delay: at(LIFT.flatten[0]), fill: 'forwards', easing: eOut });
  // tray target: centre of the front thumbnail (40×54 at 12,4 inside the 64pt tray)
  const tr = $('camTray').getBoundingClientRect(), hr = host.getBoundingClientRect();
  const tx = tr.left - hr.left + 32, ty = tr.top - hr.top + 31, s = 40 / rw;
  const dx = tx - rcx, dy = ty - rcy;
  // hold +280: tilt 0 → −4° (30 ms)
  S.animate([{ transform: 'rotate(0deg) scale(1)' }, { transform: 'rotate(-4deg) scale(1)' }], { duration: 30, delay: at(LIFT.hold), fill: 'forwards', easing: eOut });
  // fly +310 for 250 ms: x + scale + rotate on --sp-smooth; y on cubic-bezier(.5,0,.75,0) with a −36pt sine lift
  const by = cubicBezier(0.5, 0, 0.75, 0), N = 12, yk = [];
  for (let i = 0; i <= N; i++) { const u = i / N; yk.push({ transform: `translateY(${dy * by(u) - 36 * Math.sin(Math.PI * u)}px)`, offset: u }); }
  const flyOpts = { duration: LIFT.fly[1], delay: at(LIFT.fly[0]), fill: 'forwards' };
  X.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)` }], { ...flyOpts, easing: smooth });
  Y.animate(yk, { ...flyOpts, easing: 'linear' });
  S.animate([{ transform: 'rotate(-4deg) scale(1)' }, { transform: `rotate(0deg) scale(${s})` }], { ...flyOpts, easing: smooth });
  const landed = new Promise((res) => setTimeout(() => { X.remove(); cv.width = cv.height = 0; res(); }, at(LIFT.land[0])));
  const done = new Promise((res) => setTimeout(() => { CAM.fx = Math.max(0, CAM.fx - 1); res(); }, at(LIFT.done)));
  return { landed, done };
}
function renderTray(land) {
  const n = Math.max(0, scan.pages.length - (CAM.trayHold || 0)), tray = $('camTray');
  const last = scan.pages.slice(0, n).slice(-3);
  if (!n) { tray.replaceChildren(icon('photos')); tray.setAttribute('aria-label', 'Import from Photos'); }
  else {
    tray.replaceChildren(...last.map((p) => el('img', { src: p._thumb || '', alt: '', class: p.status === 'proc' ? 'shim' : '' })), // 3.3.3: shimmer while edges refine in the background
      el('span', { class: 'pn' }, String(n)));
    tray.setAttribute('aria-label', `Page ${n}. Tap to retake it`);
    if (land && !reduceMotion()) { // land: front 1→.94→1; older pages settle with a 30 ms stagger
      const imgs = [...tray.querySelectorAll('img')].reverse();
      imgs.forEach((im, i) => im.animate(i ? [{ translate: '4px 0' }, { translate: '0 0' }] : [{ scale: 1 }, { scale: 0.94, offset: 0.176 }, { scale: 1 }],
        { duration: i ? 280 : 340, delay: i * 30, easing: i ? waapiEase('--sp-snappy', 'ease-out') : 'ease-out' }));
    }
  }
  $('camDone').disabled = !scan.pages.length; const b = $('camBadge'); b.hidden = !n;
  if (b.textContent !== String(n)) { b.textContent = n; if (land) { b.classList.remove('roll'); void b.offsetWidth; b.classList.add('roll'); } }
  $('camDoneN').hidden = true; $('camDone').setAttribute('aria-label', n ? `Done, ${plural(n, 'page')}` : 'Done');
}
async function camRemoveLast(retake) {
  const pg = scan.pages[scan.pages.length - 1]; if (!pg) return;
  const n = scan.pages.length; scan.pages.pop(); freeBatchUrls(); renderTray(false); CAM.cool = null;
  CAM.capMsg = true; camMsg(retake ? `Retake page ${n}` : `Page ${n} deleted`); setTimeout(() => { CAM.capMsg = false; }, 1200);
}
async function camLeave() {
  if (CAM.replace) { CAM.replace = null; camStop(); return openBatch(); }
  if (scan.pages.length) {
    const n = scan.pages.length;
    const v = await alertBox({ title: 'Discard this scan?', message: `${plural(n, 'page')} ${n > 1 ? 'haven’t' : 'hasn’t'} been saved yet.`, actions: [{ label: 'Keep Scanning', value: false, style: 'b' }, { label: 'Discard', value: true, style: 'd' }] });
    if (!v) return;
  }
  camStop(); scan.pages = []; freeBatchUrls();
  scan.returnTo ? openDoc(scan.returnTo) : show('home', 'down');
}
$('camShutter').onclick = () => camShoot(false);
$('camDone').onclick = () => { if (!scan.pages.length) return; camStop(); openBatch(); };
$('camClose').onclick = camLeave;
$('camTray').onclick = async () => {
  if (scan.pages.length) return camRemoveLast(true);
  const f = await pickFiles('image/*', true); if (f.length) { batchAdd(f); renderTray(true); }
};
$('camAuto').onclick = () => { settings.camAuto = !CAM.auto; saveSettings(); disarm(); camChrome(); };
$('camHD').onclick = async () => { settings.camHD = !CAM.hd; saveSettings(); camChrome(); camStop(); camMsg('Starting camera…'); await camStart(); toast(CAM.hd ? 'HD on · sharper pages' : 'HD off · smaller files'); };
function bookCaption() { // 'Book mode on' fades out after 2 s (0.3 s ease-out)
  const c = $('camBookCap'); clearTimeout(bookCaption.t); c.classList.remove('fade'); c.classList.add('show'); $('cam').classList.add('capon');
  bookCaption.t = setTimeout(() => { c.classList.add('fade'); c.classList.remove('show'); setTimeout(() => $('cam').classList.remove('capon'), 300); }, 2000);
}
function setBook(on) { if (!!settings.book === on) return; settings.book = on; saveSettings(); camChrome(); CAM.hist = []; disarm(); if (on) bookCaption(); else { $('camBookCap').classList.remove('show'); toast('Book mode off · spreads stay one page'); } }
/** Scan-type modes: Document / Book switch the live scanner; Aadhaar, Passport and Signature open their tools. */
$('camModes').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-m]'); if (!b) return;
  const m = b.dataset.m;
  if (m === 'doc' || m === 'book') return setBook(m === 'book');
  if (scan.pages.length) {
    const n = scan.pages.length;
    const ok = await alertBox({ title: `Switch to ${b.textContent}?`, message: `${plural(n, 'page')} in this scan ${n > 1 ? 'haven’t' : 'hasn’t'} been saved yet.`, actions: [{ label: 'Keep Scanning', value: false, style: 'b' }, { label: 'Discard', value: true, style: 'd' }] });
    if (!ok) return;
  }
  camStop(); scan.pages = []; freeBatchUrls(); toolBack = 'tools'; TOOLS[m]('tools');
});
$('camTorch').onclick = async () => {
  if (!CAM.track) return; const on = !CAM.torch;
  try { await CAM.track.applyConstraints({ advanced: [{ torch: on }] }); CAM.torch = on; } catch { toast('Flash isn’t available', 'err'); }
  camChrome();
};
$('camNative').onclick = async () => { const f = await pickFiles('image/*', false, 'environment'); if (f.length) { camStop(); openBatch(); batchAdd(f); } };
$('camRetry').onclick = () => { $('camPerm').hidden = true; camMsg('Starting camera…'); camStart(); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (CAM.stream) camStop(); }
  else if (curView === 'cam' && $('camPerm').hidden) camStart();
});
