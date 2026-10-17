'use strict';
/* DocSnap 3.3 — in-app live camera: continuous capture, live page outline, auto-capture. */

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
  small: null, stats: { n: 0, ms: 0 },
  get auto() { return settings.camAuto !== false; }, get hd() { return settings.camHD !== false; }
};
const camOk = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

function camMsg(t, hold) { const m = $('camMsg'); if (m.textContent !== t) m.textContent = t; m.classList.toggle('hold', !!hold); }
function camChrome() {
  $('camAuto').textContent = CAM.auto ? 'Auto' : 'Manual'; $('camAuto').classList.toggle('on', CAM.auto); $('camAuto').setAttribute('aria-pressed', CAM.auto);
  $('camHD').classList.toggle('on', CAM.hd); $('camHD').setAttribute('aria-pressed', CAM.hd);
  const bk = !!settings.book; $('camBook').classList.toggle('on', bk); $('camBook').setAttribute('aria-pressed', bk); $('camGrid').hidden = true;
  $('camTorch').classList.toggle('on', CAM.torch);
}
function openCam(fresh = true) {
  if (fresh) CAM.replace = null;
  if (fresh) { scan.pages = []; scan.i = 0; scan.returnTo = (curView === 'doc' || curView === 'page') && current ? current.id : null; scan.src = 'live'; }
  CAM.cool = null; CAM.q = CAM.disp = null; CAM.hist = []; disarm();
  $('camPerm').hidden = true; camChrome(); renderTray(false); $('cam').classList.toggle('replacing', !!CAM.replace); if (CAM.replace) camMsg(`Retake page ${scan.pages.indexOf(CAM.replace) + 1}`); camMsg('Starting camera…');
  show('cam', 'up');
  camStart();
}
async function camStart() {
  if (CAM.stream || CAM.starting) return CAM.starting;
  CAM.starting = (async () => {
    const v = $('camVideo');
    const want = CAM.hd ? { width: { ideal: 3840 }, height: { ideal: 2160 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } };
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
    const st = CAM.track.getSettings ? CAM.track.getSettings() : {};
    CAM.res = `${st.width || v.videoWidth}×${st.height || v.videoHeight}`;
    camChrome(); camMsg('Looking for page…');
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
  if (!CAM.inflight && now - CAM.lastDet > 110 && !CAM.shooting) {
    CAM.lastDet = now; CAM.inflight = true;
    const L = 960, s = Math.min(1, L / Math.max(v.videoWidth, v.videoHeight));
    const c = CAM.small || (CAM.small = document.createElement('canvas'));
    const w = Math.round(v.videoWidth * s), h = Math.round(v.videoHeight * s);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    Detector.live(c).then((d) => onLive(d, w, h)).catch(() => {}).finally(() => { CAM.inflight = false; });
  }
  // ease displayed corners toward the latest detection (~120ms)
  const e = 1 - Math.exp(-dt / 40);
  if (CAM.q) { if (!CAM.disp) CAM.disp = CAM.q.map((p) => ({ ...p })); else CAM.disp.forEach((p, i) => { p.x += (CAM.q[i].x - p.x) * e; p.y += (CAM.q[i].y - p.y) * e; }); }
  CAM.alpha += ((CAM.q ? 1 : 0) - CAM.alpha) * (1 - Math.exp(-dt / 70));
  drawCamOverlay();
  if (CAM.armQ && now - CAM.armT >= 600 && !CAM.shooting) camShoot(true);
}
function onLive(d, w, h) {
  if (curView !== 'cam') return;
  CAM.stats.n++; if (d) CAM.stats.ms += d.ms || 0;
  const v = $('camVideo'), sx = v.videoWidth / w, sy = v.videoHeight / h;
  if (!d) {
    if (++CAM.miss >= 2) { CAM.q = null; CAM.hist = []; if (CAM.armQ) disarm(); if (CAM.miss > 3) CAM.cool = null; if (!CAM.shooting && !CAM.capMsg) camMsg(settings.book ? (CAM.notBook ? 'Fit the open book in the frame' : 'Looking for book…') : 'Looking for page…'); }
    return;
  }
  CAM.miss = 0;
  const q = Vision.order(d.q).map((p) => ({ x: p.x * sx, y: p.y * sy }));
  CAM.q = q; CAM.hist.push(q); if (CAM.hist.length > 4) CAM.hist.shift();
  const diag = Math.hypot(v.videoWidth, v.videoHeight), tol = 0.018 * diag;
  if (CAM.cool && qDist(q, CAM.cool) > 0.08 * diag) CAM.cool = null; // a new page (or moved) → auto may fire again
  const stable = CAM.hist.length >= 3 && CAM.hist.slice(1).every((h2, i) => qDist(h2, CAM.hist[i]) < tol);
  if (CAM.armQ) { if (qDist(q, CAM.armQ) > tol * 1.4) { disarm(); } }
  else if (CAM.auto && stable && !CAM.cool && !CAM.shooting && $('busy').hidden) arm(q);
  if (!CAM.capMsg && !CAM.shooting) camMsg(CAM.cool ? 'Move to the next page' : CAM.auto ? 'Hold steady…' : 'Page found · tap to shoot', !!CAM.armQ);
}
function arm(q) {
  CAM.armQ = q; CAM.armT = performance.now();
  const r = $('camShutter').querySelector('.ring'); r.classList.remove('prog'); void r.getBoundingClientRect(); r.classList.add('prog');
  $('camShutter').classList.add('arming');
}
function disarm() { CAM.armQ = null; const s = $('camShutter'); if (!s) return; s.querySelector('.ring').classList.remove('prog'); s.classList.remove('arming'); }
function drawCamOverlay() {
  const c = $('camOverlay'), dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
  if (!CAM.disp || CAM.alpha < 0.02) { if (!CAM.q) CAM.disp = null; return; }
  const m = camMap(); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalAlpha = Math.min(1, CAM.alpha);
  x.beginPath(); CAM.disp.forEach((p, i) => { const X = m.ox + p.x * m.k, Y = m.oy + p.y * m.k; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.closePath();
  x.fillStyle = 'rgba(45,212,191,.12)'; x.fill();
  x.shadowColor = 'rgba(45,212,191,.9)'; x.shadowBlur = 8; x.strokeStyle = '#2dd4bf'; x.lineWidth = 2; x.lineJoin = 'round'; x.stroke();
  x.shadowBlur = 0;
  if (settings.book) { // Book mode: dashed spine guide where the spread will be split
    const d = CAM.disp, P = (p) => [m.ox + p.x * m.k, m.oy + p.y * m.k], a = P({ x: (d[0].x + d[1].x) / 2, y: (d[0].y + d[1].y) / 2 }), b = P({ x: (d[3].x + d[2].x) / 2, y: (d[3].y + d[2].y) / 2 });
    x.setLineDash([6, 5]); x.lineWidth = 1.5; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); x.setLineDash([]);
  }
}

async function camShoot(auto) {
  const v = $('camVideo'); if (CAM.shooting || !v.videoWidth) return;
  CAM.shooting = true; CAM.t0Shot = performance.now(); disarm();
  try {
    // full-resolution still straight from the video frame
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const fly = flyShot(c, CAM.disp && CAM.alpha > 0.5 ? CAM.disp : null);
    const f = $('camFlash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    haptic();
    CAM.cool = CAM.q || [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    if (!CAM.q) CAM.cool = null;
    // 3.3.1 fast shutter: a tray thumbnail straight from the frame; the full-res JPEG encodes in the background and
    // detection / v2 refine / warp run later in the batch chain — the next shot is possible right away
    const tc = document.createElement('canvas'), ts = 240 / Math.max(c.width, c.height); tc.width = Math.round(c.width * ts); tc.height = Math.round(c.height * ts);
    tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
    const thumb = tc.toDataURL('image/jpeg', 0.7); tc.width = tc.height = 0;
    const fileP = canvasToBlob(c, 0.92).then((blob) => { Vision.free(c); return new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' }); });
    if (CAM.replace) {
      const file = await fileP; // retake of one page from the grid / crop editor
      const pg = CAM.replace; CAM.replace = null;
      Object.assign(pg, { status: 'proc', file, raw: null, orig: null, found: false, _thumb: burl(file), _previews: null, _origUrl: null, _final: null, _finalF: null, _pblobs: null });
      batchChain.p = batchChain.p.then(() => processBatchPage(pg));
      await fly; CAM.shooting = false; camStop(); openBatch(); toast(`Page ${scan.pages.indexOf(pg) + 1} retaken`); return;
    }
    batchAdd([{ fileP, thumb, book: !!settings.book }]);
    const pg = scan.pages[scan.pages.length - 1]; if (pg) pg.auto = !!auto;
    CAM.capMsg = true; camMsg('Captured'); setTimeout(() => { CAM.capMsg = false; }, 900);
    CAM.lastShot = performance.now() - CAM.t0Shot;
    CAM.shooting = false;
    renderTray(false); // count + stack update at once; the badge bounces when the shot lands
    fly.then(() => { if (curView === 'cam') renderTray(true); });
    return;
  } catch (e) { toast('Couldn’t take the photo', 'err'); }
  CAM.shooting = false;
}
/** The captured (cropped) frame shrinks and flies into the tray. */
function flyShot(v, q) { // v: the captured frame (canvas) — same pixel size as the video
  const m = camMap(), cv2 = document.createElement('canvas'); cv2.width = m.W; cv2.height = m.H;
  cv2.getContext('2d').drawImage(v, m.ox, m.oy, m.vw * m.k, m.vh * m.k);
  let bx = 0, by = 0, bw = m.W, bh = m.H;
  if (q) {
    const pts = q.map((p) => [m.ox + p.x * m.k, m.oy + p.y * m.k]);
    bx = Math.min(...pts.map((p) => p[0])); by = Math.min(...pts.map((p) => p[1])); bw = Math.max(...pts.map((p) => p[0])) - bx; bh = Math.max(...pts.map((p) => p[1])) - by;
    cv2.style.clipPath = `polygon(${pts.map((p) => `${p[0]}px ${p[1]}px`).join(',')})`;
  }
  cv2.className = 'flyshot'; cv2.style.left = '0px'; cv2.style.top = '0px'; cv2.style.width = m.W + 'px'; cv2.style.height = m.H + 'px';
  const host = $('cam'); host.append(cv2);
  const t = $('camTray').getBoundingClientRect(), hr = host.getBoundingClientRect();
  const s = Math.min(44 / bw, 58 / bh), tx = t.left - hr.left + 8 - bx * s, ty = t.top - hr.top + 6 - by * s;
  return new Promise((res) => requestAnimationFrame(() => {
    cv2.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; cv2.style.opacity = '0.9';
    setTimeout(() => { cv2.remove(); res(); }, 360);
  }));
}
function renderTray(bump) {
  const n = scan.pages.length, tray = $('camTray');
  const last = scan.pages.slice(-3);
  if (!n) { tray.replaceChildren(icon('photos')); tray.setAttribute('aria-label', 'Import from Photos'); }
  else {
    tray.replaceChildren(...last.map((p) => el('img', { src: p._thumb || '', alt: '' })), el('span', { class: 'pn' }, String(n)));
    tray.setAttribute('aria-label', `Page ${n}. Tap to retake it`);
  }
  $('camDone').disabled = !n; const b = $('camBadge'); b.hidden = !n; b.textContent = n; $('camDoneN').hidden = !n; $('camDone').setAttribute('aria-label', n ? `Done, ${plural(n, 'page')}` : 'Done');
  if (bump) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
}
async function camRemoveLast(retake) {
  const pg = scan.pages[scan.pages.length - 1]; if (!pg) return;
  const n = scan.pages.length; scan.pages.pop(); freeBatchUrls(); renderTray(false); haptic(); CAM.cool = null;
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
$('camAuto').onclick = () => { settings.camAuto = !CAM.auto; saveSettings(); disarm(); camChrome(); haptic(); };
$('camHD').onclick = async () => { settings.camHD = !CAM.hd; saveSettings(); camChrome(); camStop(); camMsg('Starting camera…'); await camStart(); toast(CAM.hd ? 'HD on · sharper pages' : 'HD off · smaller files'); };
function bookCaption() { // 'Book mode on' fades out after 2 s (0.3 s ease-out)
  const c = $('camBookCap'); clearTimeout(bookCaption.t); c.classList.remove('fade'); c.classList.add('show'); $('cam').classList.add('capon');
  bookCaption.t = setTimeout(() => { c.classList.add('fade'); c.classList.remove('show'); setTimeout(() => $('cam').classList.remove('capon'), 300); }, 2000);
}
$('camBook').onclick = () => { settings.book = !settings.book; saveSettings(); camChrome(); haptic(); CAM.hist = []; disarm(); if (settings.book) bookCaption(); else { $('camBookCap').classList.remove('show'); toast('Book mode off · spreads stay one page'); } };
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
