'use strict';
/* DocSnap PWA – original code. Storage: IndexedDB. Crop/filters: OpenCV.js. OCR: Tesseract.js. PDF: jsPDF. */
const $ = (id) => document.getElementById(id);
const MAX_SIDE = 2000;

// ---------- UI helpers ----------
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === view));
  window.scrollTo(0, 0);
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function busy(msg) { $('busyMsg').textContent = msg || 'Working…'; $('busy').hidden = !msg; }
const scripts = {};
function loadScript(src) {
  if (scripts[src]) return scripts[src];
  scripts[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
  return scripts[src];
}
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e[k] = v;
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
/** Simple action-sheet. items: [{label, value}] → resolves value or null. */
function menu(title, items) {
  return new Promise((res) => {
    const d = $('menuDlg'); $('menuTitle').textContent = title;
    const box = $('menuItems'); box.innerHTML = '';
    for (const it of [...items, { label: 'Cancel', value: null }]) {
      box.append(el('button', { textContent: it.label, class: it.cls || '', onclick: () => { d.close(); res(it.value); } }));
    }
    d.showModal();
  });
}
/** Open a native file picker (must be called from a user gesture). */
function pickFiles(accept, multiple = false) {
  return new Promise((res) => {
    const i = el('input', { type: 'file', accept, multiple, hidden: true });
    i.onchange = () => { res([...i.files]); i.remove(); };
    document.body.append(i); i.click();
  });
}
/** Share via the iOS share sheet when possible, otherwise download. */
async function deliver(files) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  for (const f of files) {
    const a = el('a', { href: URL.createObjectURL(f), download: f.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    await new Promise((r) => setTimeout(r, 300));
  }
}
const canvasToBlob = (c, q = 0.88, type = 'image/jpeg') => new Promise((r) => c.toBlob(r, type, q));
async function blobToCanvas(blob, maxSide = 0) {
  const img = new Image(); img.src = URL.createObjectURL(blob);
  await img.decode();
  const s = maxSide ? Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c;
}
function rotateCanvas(s) {
  const c = document.createElement('canvas'); c.width = s.height; c.height = s.width;
  const ctx = c.getContext('2d'); ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(s, 0, 0);
  return c;
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
  async all() { return (await this.tx('readonly', (s) => s.getAll())).map(migrate); },
  async get(id) { const d = await this.tx('readonly', (s) => s.get(id)); return d && migrate(d); },
  put(doc) { return this.tx('readwrite', (s) => s.put(doc)); },
  del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
};
/** v1 stored pages as plain Blobs; v2 stores {orig, img, filter, text}. */
function migrate(d) {
  d.pages = d.pages.map((p) => (p instanceof Blob ? { orig: p, img: p, filter: 'original', text: '' } : p));
  d.folder = d.folder || '';
  return d;
}
async function newDoc(name, pages = []) {
  const d = { id: String(Date.now()) + Math.floor(Math.random() * 1000), name, created: Date.now(), folder: activeFolder, pages };
  await DB.put(d); return d;
}

// ---------- State ----------
let current = null;          // doc being viewed
let pageIdx = 0;             // page being edited
let activeFolder = '';       // '' = all
let objectUrls = [];
function revokeUrls() { objectUrls.forEach(URL.revokeObjectURL); objectUrls = []; }
function url(blob) { const u = URL.createObjectURL(blob); objectUrls.push(u); return u; }
const pad = (n) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const defaultName = () => `Scan ${stamp()}`;

// ---------- Folders ----------
function savedFolders() { try { return JSON.parse(localStorage.getItem('folders') || '[]'); } catch { return []; } }
function setFolders(f) { localStorage.setItem('folders', JSON.stringify([...new Set(f)].sort())); }
async function allFolders(docs) {
  return [...new Set([...savedFolders(), ...(docs || await DB.all()).map((d) => d.folder).filter(Boolean)])].sort();
}
async function askNewFolder() {
  const n = (prompt('Folder name') || '').trim();
  if (!n) return null;
  setFolders([...savedFolders(), n]); return n;
}

// ---------- Home ----------
async function renderHome() {
  revokeUrls();
  const all = (await DB.all()).sort((a, b) => b.created - a.created);
  // folder chips
  const folders = await allFolders(all);
  if (activeFolder && !folders.includes(activeFolder)) activeFolder = '';
  const fc = $('folders'); fc.innerHTML = '';
  const chip = (label, val) => fc.append(el('button', {
    textContent: label, class: activeFolder === val ? 'on' : '',
    onclick: () => { activeFolder = val; renderHome(); },
  }));
  chip('All', '');
  folders.forEach((f) => chip('📁 ' + f, f));
  fc.append(el('button', { textContent: '＋ Folder', onclick: async () => { const n = await askNewFolder(); if (n) { activeFolder = n; renderHome(); } } }));
  if (activeFolder) {
    fc.append(el('button', { textContent: '✕ Delete folder', onclick: async () => {
      if (!confirm(`Delete folder "${activeFolder}"? Documents inside are kept (moved out).`)) return;
      for (const d of all.filter((x) => x.folder === activeFolder)) { d.folder = ''; await DB.put(d); }
      setFolders(savedFolders().filter((x) => x !== activeFolder)); activeFolder = ''; renderHome();
    } }));
  }
  // search
  const q = $('search').value.trim().toLowerCase();
  let docs = all.filter((d) => !activeFolder || d.folder === activeFolder);
  const snippets = {};
  if (q) {
    docs = docs.filter((d) => {
      if (d.name.toLowerCase().includes(q) || d.folder.toLowerCase().includes(q)) return true;
      for (const p of d.pages) {
        const t = (p.text || ''); const i = t.toLowerCase().indexOf(q);
        if (i >= 0) { snippets[d.id] = '…' + t.slice(Math.max(0, i - 20), i + q.length + 30).replace(/\s+/g, ' ') + '…'; return true; }
      }
      return false;
    });
  }
  const list = $('docList'); list.innerHTML = '';
  $('empty').style.display = docs.length ? 'none' : 'block';
  $('empty').innerHTML = q ? 'No matches.' : 'No documents yet.<br>Tap <b>Scan</b> to capture your first one.';
  for (const d of docs) {
    const img = el('img', { alt: '' }); if (d.pages[0]) img.src = url(d.pages[0].img);
    const info = el('div', { class: 'info' },
      el('b', { textContent: d.name }),
      el('small', { textContent: `${d.pages.length} page${d.pages.length === 1 ? '' : 's'} • ${new Date(d.created).toLocaleDateString()}${d.folder && !activeFolder ? ' • 📁 ' + d.folder : ''}` }),
      snippets[d.id] ? el('span', { class: 'snip', textContent: snippets[d.id] }) : null);
    const more = el('button', { class: 'more', textContent: '⋮', onclick: (e) => { e.stopPropagation(); docActions(d); } });
    list.append(el('div', { class: 'card', onclick: () => openDoc(d.id) }, img, info, more));
  }
  setTab('home');
}
let searchT; $('search').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(renderHome, 200); });
function setTab(t) {
  show(t);
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
}
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => (b.dataset.tab === 'home' ? renderHome() : setTab('tools'))));

async function docActions(d) {
  const v = await menu(d.name, [
    { label: '✎ Rename', value: 'rename' }, { label: '📁 Move to folder', value: 'move' },
    { label: '⇪ Share PDF', value: 'share' }, { label: '🗑 Delete', value: 'delete', cls: 'danger' }]);
  if (v === 'rename') {
    const n = prompt('Rename document', d.name);
    if (n && n.trim()) { d.name = n.trim(); await DB.put(d); }
  } else if (v === 'move') {
    const fs = await allFolders();
    let f = await menu('Move to folder', [{ label: '— No folder —', value: '' }, ...fs.map((x) => ({ label: '📁 ' + x, value: x })), { label: '＋ New folder…', value: '__new' }]);
    if (f === '__new') f = await askNewFolder();
    if (f !== null) { d.folder = f; await DB.put(d); toast(f ? `Moved to ${f}` : 'Removed from folder'); }
  } else if (v === 'share') return exportPdf(d);
  else if (v === 'delete') {
    if (!confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    await DB.del(d.id); if (current && current.id === d.id) current = null;
    return renderHome();
  }
  if (current && current.id === d.id) openDoc(d.id); else renderHome();
}

// ---------- Document view ----------
async function openDoc(id) {
  current = await DB.get(id);
  if (!current) return renderHome();
  revokeUrls();
  $('docTitle').textContent = current.name;
  const wrap = $('pages'); wrap.innerHTML = '';
  const n = current.pages.length;
  current.pages.forEach((p, i) => {
    const move = async (e, dir) => {
      e.stopPropagation();
      const j = i + dir; if (j < 0 || j >= n) return;
      [current.pages[i], current.pages[j]] = [current.pages[j], current.pages[i]];
      await DB.put(current); openDoc(current.id);
    };
    wrap.append(el('div', { class: 'page', onclick: () => openPage(i) },
      el('img', { src: url(p.img) }), el('span', { textContent: i + 1 }),
      i > 0 ? el('button', { class: 'mv l', textContent: '◀', title: 'Move left', onclick: (e) => move(e, -1) }) : null,
      i < n - 1 ? el('button', { class: 'mv r', textContent: '▶', title: 'Move right', onclick: (e) => move(e, 1) }) : null));
  });
  show('doc');
}

// ---------- Page editor: filters, rotate, sign, watermark ----------
async function openPage(i) {
  pageIdx = i; const p = current.pages[i];
  $('pageTitle').textContent = `Page ${i + 1} of ${current.pages.length}`;
  revokeUrls(); $('pageImg').src = url(p.img);
  document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b.dataset.f === (p.filter || 'original')));
  show('page');
}
async function applyFilter(canvas, f) {
  if (f === 'original') return canvas;
  const { cv } = await loadCv();
  const src = cv.imread(canvas), out = new cv.Mat();
  try {
    if (f === 'gray') {
      cv.cvtColor(src, out, cv.COLOR_RGBA2GRAY);
    } else if (f === 'bw') {
      const g = new cv.Mat(); cv.cvtColor(src, g, cv.COLOR_RGBA2GRAY);
      cv.adaptiveThreshold(g, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 25, 12); g.delete();
    } else if (f === 'magic') {
      // Remove shadows: divide each channel by its estimated background, then boost contrast.
      const rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      const ch = new cv.MatVector(); cv.split(rgb, ch);
      const res = new cv.MatVector(); const k = cv.Mat.ones(7, 7, cv.CV_8U);
      for (let c = 0; c < 3; c++) {
        const m = ch.get(c), bg = new cv.Mat(), d = new cv.Mat();
        cv.dilate(m, bg, k); cv.medianBlur(bg, bg, 21);
        cv.divide(m, bg, d, 255, -1);
        cv.convertScaleAbs(d, d, 1.15, -20);
        res.push_back(d); m.delete(); bg.delete(); d.delete();
      }
      cv.merge(res, out); [rgb, ch, res, k].forEach((x) => x.delete());
    }
    const c = document.createElement('canvas'); cv.imshow(c, out); return c;
  } finally { src.delete(); out.delete(); }
}
async function savePage(orig) {
  const p = current.pages[pageIdx];
  if (orig) p.orig = await canvasToBlob(orig, 0.9);
  const base = await blobToCanvas(p.orig);
  p.img = await canvasToBlob(await applyFilter(base, p.filter || 'original'));
  await DB.put(current);
}
document.querySelectorAll('#filters button').forEach((b) => (b.onclick = async () => {
  busy('Applying filter…');
  try { current.pages[pageIdx].filter = b.dataset.f; await savePage(); } catch (e) { toast('Filter failed: ' + e.message); }
  busy(); openPage(pageIdx);
}));
$('pageRotate').onclick = async () => {
  busy('Rotating…');
  try { await savePage(rotateCanvas(await blobToCanvas(current.pages[pageIdx].orig))); } catch (e) { toast(e.message); }
  busy(); openPage(pageIdx);
};
$('pageDelete').onclick = async () => {
  if (!confirm(`Delete page ${pageIdx + 1}?`)) return;
  current.pages.splice(pageIdx, 1);
  if (!current.pages.length) { await DB.del(current.id); current = null; return renderHome(); }
  await DB.put(current); openDoc(current.id);
};
$('pageBack').onclick = () => openDoc(current.id);
$('pageWatermark').onclick = async () => {
  const text = (prompt('Watermark text', 'CONFIDENTIAL') || '').trim(); if (!text) return;
  busy('Adding watermark…');
  try {
    const c = await blobToCanvas(current.pages[pageIdx].orig), ctx = c.getContext('2d');
    const fs = Math.min(c.width, c.height) / Math.max(4, text.length * 0.6);
    ctx.save(); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(-Math.atan2(c.height, c.width));
    ctx.font = `bold ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(120,120,120,0.28)'; ctx.fillText(text, 0, 0); ctx.restore();
    await savePage(c);
  } catch (e) { toast(e.message); }
  busy(); openPage(pageIdx);
};

// ---------- Signature ----------
const sig = { drawing: false, has: false, after: null };
function openSigPad(after) {
  sig.after = after; show('sigpad');
  const c = $('sigCanvas'); const r = c.getBoundingClientRect();
  c.width = Math.round(r.width * 2); c.height = Math.round(r.height * 2);
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
  ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0d1b4c'; sig.has = false;
}
function sigPt(e) { const c = $('sigCanvas'), r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; }
$('sigCanvas').addEventListener('pointerdown', (e) => { sig.drawing = true; sig.has = true; e.target.setPointerCapture(e.pointerId); const ctx = e.target.getContext('2d'); ctx.beginPath(); ctx.moveTo(...sigPt(e)); });
$('sigCanvas').addEventListener('pointermove', (e) => { if (!sig.drawing) return; const ctx = e.target.getContext('2d'); ctx.lineTo(...sigPt(e)); ctx.stroke(); });
['pointerup', 'pointercancel'].forEach((t) => $('sigCanvas').addEventListener(t, () => { sig.drawing = false; }));
$('sigClear').onclick = () => { const c = $('sigCanvas'); c.getContext('2d').clearRect(0, 0, c.width, c.height); sig.has = false; };
$('sigBack').onclick = () => (sig.after ? sig.after(false) : setTab('tools'));
$('sigSave').onclick = () => {
  if (!sig.has) return toast('Draw your signature first');
  // trim transparent margins
  const c = $('sigCanvas'), ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const t = el('canvas', { width: x1 - x0 + 10, height: y1 - y0 + 10 });
  t.getContext('2d').drawImage(c, x0 - 5, y0 - 5, t.width, t.height, 0, 0, t.width, t.height);
  localStorage.setItem('signature', t.toDataURL('image/png'));
  toast('Signature saved');
  sig.after ? sig.after(true) : setTab('tools');
};
const place = { page: null, sig: null, x: 0.7, y: 0.85, drag: false };
async function startPlace() {
  const data = localStorage.getItem('signature');
  if (!data) return openSigPad((ok) => (ok ? startPlace() : openPage(pageIdx)));
  busy('Loading…');
  place.page = await blobToCanvas(current.pages[pageIdx].orig);
  place.sig = new Image(); place.sig.src = data; await place.sig.decode();
  busy(); show('place'); drawPlace();
}
function sigRect() {
  const W = place.page.width, w = W * $('placeSize').value / 100, h = w * place.sig.height / place.sig.width;
  return { x: place.x * W - w / 2, y: place.y * place.page.height - h / 2, w, h };
}
function drawPlace() {
  const c = $('placeCanvas'); c.width = place.page.width; c.height = place.page.height;
  const ctx = c.getContext('2d'); ctx.drawImage(place.page, 0, 0);
  const r = sigRect(); ctx.drawImage(place.sig, r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#26a69a'; ctx.setLineDash([12, 8]); ctx.lineWidth = Math.max(2, c.width / 300); ctx.strokeRect(r.x, r.y, r.w, r.h);
}
function placeMove(e) {
  const c = $('placeCanvas'), r = c.getBoundingClientRect();
  place.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); place.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  drawPlace();
}
$('placeCanvas').addEventListener('pointerdown', (e) => { place.drag = true; e.target.setPointerCapture(e.pointerId); placeMove(e); });
$('placeCanvas').addEventListener('pointermove', (e) => place.drag && placeMove(e));
['pointerup', 'pointercancel'].forEach((t) => $('placeCanvas').addEventListener(t, () => { place.drag = false; }));
$('placeSize').oninput = drawPlace;
$('placeBack').onclick = () => openPage(pageIdx);
$('placeRedraw').onclick = () => openSigPad((ok) => (ok ? startPlace() : show('place')));
$('placeDone').onclick = async () => {
  busy('Applying signature…');
  try {
    const r = sigRect(); place.page.getContext('2d').drawImage(place.sig, r.x, r.y, r.w, r.h);
    await savePage(place.page);
  } catch (e) { toast(e.message); }
  busy(); openPage(pageIdx);
};
$('pageSign').onclick = startPlace;

// ---------- Capture ----------
let srcHandler = null;
/** Ask camera vs photos; handler(files) receives the chosen files. */
function chooseSource(handler, title = 'Add page', multiple = true) {
  srcHandler = handler; $('srcTitle').textContent = title; $('srcDlg').dataset.multi = multiple ? '1' : ''; $('srcDlg').showModal();
}
$('srcLib').onclick = async () => { $('srcDlg').close(); const f = await pickFiles('image/*', !!$('srcDlg').dataset.multi); if (f.length) srcHandler(f); };
$('srcCancel').onclick = () => $('srcDlg').close();
// The camera button uses an <input capture> so iOS opens the camera directly.
$('srcCam').onclick = () => {
  $('srcDlg').close();
  const i = el('input', { type: 'file', accept: 'image/*', hidden: true }); i.setAttribute('capture', 'environment');
  i.onchange = () => { if (i.files.length) srcHandler([...i.files]); i.remove(); };
  document.body.append(i); i.click();
};

let pendingFiles = [];
let cropCallback = null; // when set, cropped canvas goes here instead of into current doc
function scanIntoDoc(files) { cropCallback = null; pendingFiles = [...files]; nextPending(); }
async function nextPending() {
  const f = pendingFiles.shift();
  if (!f) return;
  try {
    busy('Loading image…');
    await startCrop(await blobToCanvas(f, MAX_SIDE));
  } catch (e) { busy(); toast('Could not open image: ' + e.message); }
}
/** Scan one page with crop, then call cb(canvas). */
function scanOne(title, cb) {
  chooseSource((files) => { cropCallback = cb; pendingFiles = [files[0]]; nextPending(); }, title, false);
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
$('cropRotate').onclick = () => startCrop(rotateCanvas(crop.canvas));
$('cropCancel').onclick = () => {
  pendingFiles = [];
  if (cropCallback) { const cb = cropCallback; cropCallback = null; return cb(null); }
  current ? openDoc(current.id) : renderHome();
};
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
    if (cropCallback) { const cb = cropCallback; cropCallback = null; busy(); return cb(out); }
    const blob = await canvasToBlob(out, 0.88);
    if (!current) current = await newDoc(defaultName());
    current.pages.push({ orig: blob, img: blob, filter: 'original', text: '' });
    await DB.put(current);
    busy();
    if (pendingFiles.length) return nextPending();
    openDoc(current.id);
  } catch (e) { busy(); toast('Save failed: ' + e.message); }
};

// ---------- OCR ----------
$('ocrBtn').onclick = () => {
  $('ocrText').value = current.pages.map((p, i) => (p.text ? (current.pages.length > 1 ? `--- Page ${i + 1} ---\n` : '') + p.text : '')).filter(Boolean).join('\n\n');
  show('ocr');
};
$('ocrRun').onclick = async () => {
  const lang = $('ocrLang').value;
  try {
    busy('Loading OCR engine (first time needs internet)…');
    await loadScript('vendor/tesseract.min.js');
    const worker = await Tesseract.createWorker(lang, 1, {
      logger: (m) => { if (m.status === 'recognizing text') busy(`Reading text… ${Math.round(m.progress * 100)}%`); },
    });
    let text = '';
    for (let i = 0; i < current.pages.length; i++) {
      busy(`Reading page ${i + 1}/${current.pages.length}…`);
      const { data } = await worker.recognize(current.pages[i].img);
      current.pages[i].text = data.text.trim();
      text += (current.pages.length > 1 ? `--- Page ${i + 1} ---\n` : '') + current.pages[i].text + '\n\n';
    }
    await worker.terminate();
    await DB.put(current);
    $('ocrText').value = text.trim() || '(No text found)';
  } catch (e) { toast('OCR failed: ' + e.message); }
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
async function blobToDataUrl(blob) {
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}
async function imagesToPdfBlob(blobs) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < blobs.length; i++) {
    const c = await blobToCanvas(blobs[i], 2600);
    const s = Math.min(W / c.width, H / c.height), w = c.width * s, h = c.height * s;
    if (i) pdf.addPage();
    pdf.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', (W - w) / 2, (H - h) / 2, w, h);
  }
  return pdf.output('blob');
}
const safeName = (n) => n.replace(/[^\w\- ]+/g, '_');
async function exportPdf(doc) {
  busy('Creating PDF…');
  try {
    const blob = await imagesToPdfBlob(doc.pages.map((p) => p.img));
    busy();
    await deliver([new File([blob], safeName(doc.name) + '.pdf', { type: 'application/pdf' })]);
  } catch (e) { busy(); toast('PDF failed: ' + e.message); }
}

// ---------- Wiring ----------
$('fabScan').onclick = () => { current = null; chooseSource(scanIntoDoc); };
$('addPage').onclick = () => chooseSource(scanIntoDoc);
$('pdfBtn').onclick = () => exportPdf(current);
$('docBack').onclick = () => { current = null; renderHome(); };
$('docMenu').onclick = () => docActions(current);
window.addEventListener('resize', () => { if ($('crop').classList.contains('active')) drawCrop(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
renderHome();
