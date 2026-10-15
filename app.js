'use strict';
/* DocSnap PWA – original code. Storage: IndexedDB. Crop: OpenCV.js. OCR: Tesseract.js. PDF: jsPDF. */
const $ = (id) => document.getElementById(id);
const MAX_SIDE = 2000;

// ---------- UI helpers ----------
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === view));
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function busy(msg) { $('busyMsg').textContent = msg || 'Working…'; $('busy').hidden = !msg; }
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

// ---------- IndexedDB ----------
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('docsnap', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('docs', mode); const st = t.objectStore('docs');
      const out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx('readonly', (s) => s.getAll()); },
  get(id) { return this.tx('readonly', (s) => s.get(id)); },
  put(doc) { return this.tx('readwrite', (s) => s.put(doc)); },
  del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
};

// ---------- State ----------
let current = null;          // doc being viewed
let objectUrls = [];
function revokeUrls() { objectUrls.forEach(URL.revokeObjectURL); objectUrls = []; }
function url(blob) { const u = URL.createObjectURL(blob); objectUrls.push(u); return u; }
const pad = (n) => String(n).padStart(2, '0');
function defaultName() {
  const d = new Date();
  return `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Home ----------
async function renderHome() {
  revokeUrls();
  const docs = (await DB.all()).sort((a, b) => b.created - a.created);
  const list = $('docList'); list.innerHTML = '';
  $('empty').style.display = docs.length ? 'none' : 'block';
  for (const d of docs) {
    const c = document.createElement('div'); c.className = 'card';
    const img = document.createElement('img'); if (d.pages[0]) img.src = url(d.pages[0]); img.alt = '';
    const info = document.createElement('div'); info.className = 'info';
    const b = document.createElement('b'); b.textContent = d.name;
    const sm = document.createElement('small');
    sm.textContent = `${d.pages.length} page${d.pages.length === 1 ? '' : 's'} • ${new Date(d.created).toLocaleDateString()}`;
    info.append(b, sm);
    const share = document.createElement('button'); share.className = 'icon'; share.textContent = '⇪'; share.title = 'Share PDF';
    share.onclick = (e) => { e.stopPropagation(); exportPdf(d); };
    c.append(img, info, share);
    c.onclick = () => openDoc(d.id);
    list.appendChild(c);
  }
  show('home');
}

// ---------- Document view ----------
async function openDoc(id) {
  current = await DB.get(id);
  if (!current) return renderHome();
  revokeUrls();
  $('docTitle').textContent = current.name;
  const wrap = $('pages'); wrap.innerHTML = '';
  current.pages.forEach((p, i) => {
    const el = document.createElement('div'); el.className = 'page';
    const img = document.createElement('img'); img.src = url(p);
    const n = document.createElement('span'); n.textContent = i + 1;
    const del = document.createElement('button'); del.textContent = '✕'; del.title = 'Delete page';
    del.onclick = async () => {
      if (!confirm(`Delete page ${i + 1}?`)) return;
      current.pages.splice(i, 1);
      if (!current.pages.length) { await DB.del(current.id); return renderHome(); }
      await DB.put(current); openDoc(current.id);
    };
    el.append(img, n, del); wrap.appendChild(el);
  });
  show('doc');
}

// ---------- Capture ----------
let pendingFiles = [];
function chooseSource() { $('srcDlg').showModal(); }
$('srcCam').onclick = () => { $('srcDlg').close(); $('fileCam').click(); };
$('srcLib').onclick = () => { $('srcDlg').close(); $('fileLib').click(); };
$('srcCancel').onclick = () => $('srcDlg').close();
for (const inp of [$('fileCam'), $('fileLib')]) {
  inp.onchange = () => {
    pendingFiles = [...inp.files]; inp.value = '';
    nextPending();
  };
}
async function nextPending() {
  const f = pendingFiles.shift();
  if (!f) return;
  try {
    busy('Loading image…');
    const canvas = await fileToCanvas(f);
    await startCrop(canvas);
  } catch (e) { busy(); toast('Could not open image: ' + e.message); }
}
async function fileToCanvas(file) {
  const img = new Image(); img.src = URL.createObjectURL(file);
  await img.decode(); // browsers apply EXIF orientation for <img>
  const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c;
}

// ---------- OpenCV ----------
let cvReady = null;
// Note: the OpenCV module object is "thenable", so never return it directly from an async
// function (that would recurse forever). We wrap it in { cv }.
function loadCv() {
  if (cvReady) return cvReady;
  cvReady = (async () => {
    await loadScript('vendor/opencv.js');
    const m = window.cv;
    const ready = () => { try { new m.Mat().delete(); return true; } catch { return false; } };
    if (!ready()) {
      await new Promise((res, rej) => {
        const prev = m.onRuntimeInitialized;
        m.onRuntimeInitialized = () => { if (prev) prev(); res(); };
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (ready()) { clearInterval(iv); res(); }
          else if (Date.now() - t0 > 60000) { clearInterval(iv); rej(new Error('OpenCV timeout')); }
        }, 200);
      });
    }
    return { cv: m };
  })().catch((e) => { cvReady = null; throw e; });
  return cvReady;
}
function orderCorners(pts) {
  const s = pts.map((p) => p.x + p.y), d = pts.map((p) => p.y - p.x);
  return [pts[s.indexOf(Math.min(...s))], pts[d.indexOf(Math.min(...d))],
    pts[s.indexOf(Math.max(...s))], pts[d.indexOf(Math.max(...d))]]; // TL, TR, BR, BL
}
function fullCorners(c) {
  return [{ x: 0, y: 0 }, { x: c.width, y: 0 }, { x: c.width, y: c.height }, { x: 0, y: c.height }];
}
function detectCorners(cv, canvas) {
  const scale = Math.min(1, 800 / Math.max(canvas.width, canvas.height));
  const small = document.createElement('canvas');
  small.width = Math.round(canvas.width * scale); small.height = Math.round(canvas.height * scale);
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  const src = cv.imread(small), gray = new cv.Mat(), edges = new cv.Mat();
  const contours = new cv.MatVector(), hier = new cv.Mat();
  let best = null, bestArea = small.width * small.height * 0.15;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 50, 150);
    const k = cv.Mat.ones(3, 3, cv.CV_8U); cv.dilate(edges, edges, k); k.delete();
    cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i), approx = new cv.Mat();
      const peri = cv.arcLength(cnt, true);
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      const area = cv.contourArea(approx);
      if (approx.rows === 4 && area > bestArea && cv.isContourConvex(approx)) {
        bestArea = area; best = [];
        for (let j = 0; j < 4; j++) best.push({ x: approx.data32S[j * 2] / scale, y: approx.data32S[j * 2 + 1] / scale });
      }
      approx.delete(); cnt.delete();
    }
  } finally { [src, gray, edges, contours, hier].forEach((m) => m.delete()); }
  return best ? orderCorners(best) : null;
}
function warp(cv, canvas, q) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const s = Math.min(1, MAX_SIDE / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
  const src = cv.imread(canvas), dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap((p) => [p.x, p.y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const M = cv.getPerspectiveTransform(from, to);
  cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  const out = document.createElement('canvas'); cv.imshow(out, dst);
  [src, dst, from, to, M].forEach((m) => m.delete());
  return out;
}

// ---------- Crop editor ----------
const crop = { canvas: null, corners: null, drag: -1, disp: 1 };
async function startCrop(canvas) {
  crop.canvas = canvas; crop.corners = null;
  busy('Detecting page edges…');
  try {
    const { cv } = await loadCv();
    crop.corners = detectCorners(cv, canvas);
    $('cropHint').textContent = crop.corners ? 'Page detected. Drag circles to fine-tune.' : 'No page found. Drag the circles to the corners.';
  } catch (e) {
    $('cropHint').textContent = 'Edge detection unavailable – adjust manually.';
  }
  if (!crop.corners) {
    const c = canvas, m = 0.08;
    crop.corners = [{ x: c.width * m, y: c.height * m }, { x: c.width * (1 - m), y: c.height * m },
      { x: c.width * (1 - m), y: c.height * (1 - m) }, { x: c.width * m, y: c.height * (1 - m) }];
  }
  busy(); show('crop'); drawCrop();
}
function drawCrop() {
  const cc = $('cropCanvas'), src = crop.canvas;
  cc.width = src.width; cc.height = src.height;
  const ctx = cc.getContext('2d'); ctx.drawImage(src, 0, 0);
  const rect = cc.getBoundingClientRect();
  crop.disp = rect.width ? src.width / rect.width : 1;
  const q = crop.corners, r = 14 * crop.disp;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath();
  ctx.rect(0, 0, cc.width, cc.height); ctx.moveTo(q[0].x, q[0].y);
  [3, 2, 1].forEach((i) => ctx.lineTo(q[i].x, q[i].y)); ctx.closePath(); ctx.fill('evenodd');
  ctx.strokeStyle = '#26a69a'; ctx.lineWidth = 3 * crop.disp; ctx.beginPath();
  q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
  for (const p of q) {
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fillStyle = 'rgba(38,166,154,.5)'; ctx.fill();
    ctx.lineWidth = 2 * crop.disp; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
}
function canvasPoint(e) {
  const cc = $('cropCanvas'), r = cc.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (cc.width / r.width), y: (e.clientY - r.top) * (cc.height / r.height) };
}
$('cropCanvas').addEventListener('pointerdown', (e) => {
  const p = canvasPoint(e); let best = -1, bd = 60 * crop.disp;
  crop.corners.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = i; } });
  crop.drag = best; if (best >= 0) e.target.setPointerCapture(e.pointerId);
});
$('cropCanvas').addEventListener('pointermove', (e) => {
  if (crop.drag < 0) return;
  const p = canvasPoint(e), c = crop.canvas;
  crop.corners[crop.drag] = { x: Math.max(0, Math.min(c.width, p.x)), y: Math.max(0, Math.min(c.height, p.y)) };
  drawCrop();
});
['pointerup', 'pointercancel'].forEach((t) => $('cropCanvas').addEventListener(t, () => { crop.drag = -1; }));
$('cropReset').onclick = () => { crop.corners = fullCorners(crop.canvas); drawCrop(); };
$('cropRotate').onclick = () => {
  const s = crop.canvas, c = document.createElement('canvas'); c.width = s.height; c.height = s.width;
  const ctx = c.getContext('2d'); ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(s, 0, 0);
  startCrop(c);
};
$('cropCancel').onclick = () => { pendingFiles = []; current ? openDoc(current.id) : renderHome(); };
$('cropDone').onclick = async () => {
  busy('Straightening page…');
  try {
    let out = crop.canvas;
    const q = orderCorners(crop.corners);
    const isFull = q.every((p, i) => { const f = fullCorners(crop.canvas)[i]; return Math.hypot(p.x - f.x, p.y - f.y) < 2; });
    if (!isFull) {
      try { out = warp((await loadCv()).cv, crop.canvas, q); }
      catch { toast('Perspective correction unavailable, saved uncropped'); }
    }
    const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.85));
    if (!current) {
      current = { id: String(Date.now()), name: defaultName(), created: Date.now(), pages: [] };
    }
    current.pages.push(blob);
    await DB.put(current);
    busy();
    if (pendingFiles.length) return nextPending();
    openDoc(current.id);
  } catch (e) { busy(); toast('Save failed: ' + e.message); }
};

// ---------- OCR ----------
let tessLoaded = null;
$('ocrBtn').onclick = () => { $('ocrText').value = ''; show('ocr'); };
$('ocrRun').onclick = async () => {
  const lang = $('ocrLang').value;
  try {
    busy('Loading OCR engine (first time needs internet)…');
    tessLoaded = tessLoaded || loadScript('vendor/tesseract.min.js');
    await tessLoaded;
    const worker = await Tesseract.createWorker(lang, 1, {
      logger: (m) => { if (m.status === 'recognizing text') busy(`Reading text… ${Math.round(m.progress * 100)}%`); },
    });
    let text = '';
    for (let i = 0; i < current.pages.length; i++) {
      busy(`Reading page ${i + 1}/${current.pages.length}…`);
      const { data } = await worker.recognize(current.pages[i]);
      text += (current.pages.length > 1 ? `--- Page ${i + 1} ---\n` : '') + data.text.trim() + '\n\n';
    }
    await worker.terminate();
    $('ocrText').value = text.trim() || '(No text found)';
  } catch (e) { toast('OCR failed: ' + e.message); tessLoaded = null; }
  busy();
};
$('ocrCopy').onclick = async () => {
  const t = $('ocrText').value; if (!t) return;
  try { await navigator.clipboard.writeText(t); }
  catch { $('ocrText').select(); document.execCommand('copy'); }
  toast('Copied to clipboard');
};
$('ocrBack').onclick = () => openDoc(current.id);

// ---------- PDF ----------
async function blobToImg(blob) { const i = new Image(); i.src = URL.createObjectURL(blob); await i.decode(); return i; }
async function blobToDataUrl(blob) {
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}
async function exportPdf(doc) {
  busy('Creating PDF…');
  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    for (let i = 0; i < doc.pages.length; i++) {
      const img = await blobToImg(doc.pages[i]);
      const s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      if (i) pdf.addPage();
      pdf.addImage(await blobToDataUrl(doc.pages[i]), 'JPEG', (W - w) / 2, (H - h) / 2, w, h);
      URL.revokeObjectURL(img.src);
    }
    const name = doc.name.replace(/[^\w\- ]+/g, '_') + '.pdf';
    const blob = pdf.output('blob');
    const file = new File([blob], name, { type: 'application/pdf' });
    busy();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: doc.name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) { busy(); toast('PDF failed: ' + e.message); }
}

// ---------- Wiring ----------
$('fabScan').onclick = () => { current = null; chooseSource(); };
$('addPage').onclick = chooseSource;
$('pdfBtn').onclick = () => exportPdf(current);
$('docBack').onclick = () => { current = null; renderHome(); };
$('docRename').onclick = async () => {
  const n = prompt('Rename document', current.name);
  if (!n || !n.trim()) return;
  current.name = n.trim(); await DB.put(current); $('docTitle').textContent = current.name;
};
$('docDelete').onclick = async () => {
  if (!confirm(`Delete "${current.name}"? This cannot be undone.`)) return;
  await DB.del(current.id); current = null; renderHome();
};
window.addEventListener('resize', () => { if ($('crop').classList.contains('active')) drawCrop(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
renderHome();
// expose for tests
window.DocSnap = { detectCorners, warp, loadCv, DB, startCrop };
