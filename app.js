'use strict';
/* DocSnap – original code. Storage: IndexedDB. Vision: OpenCV.js. OCR: Tesseract.js. PDF: jsPDF. */
const $ = (id) => document.getElementById(id);
const LANGS = [['eng', 'English'], ['hin', 'Hindi'], ['eng+hin', 'English + Hindi']];

// ---------- tiny DOM helpers ----------
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.includes('-')) e.setAttribute(k, v);
    else e[k] = v;
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}
function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i ' + cls);
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-' + name);
  s.append(u); return s;
}
const haptic = () => { try { navigator.vibrate && navigator.vibrate(8); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- settings ----------
/** v2 confidence below this → orange dot + 'Check the corners' hint, and no live 'Page found'. Single knob (was 0.5).
 *  3.3.2: pure v2 rule — v1's score is a heuristic, not a calibrated confidence, so it no longer overrides the flag. */
const CONF_FLAG = 0.4;
const isLow = (conf) => !(conf >= CONF_FLAG);
const settings = Object.assign({ filter: 'magic', lang: 'eng', layout: 'list' }, JSON.parse(localStorage.getItem('settings') || '{}'));
const saveSettings = () => localStorage.setItem('settings', JSON.stringify(settings));

// ---------- navigation ----------
const TABS = ['home', 'tools', 'settings'];
let curView = 'home';
const navStack = [];
/** Show a view. mode: push | pop | up | down | tab | none */
function show(id, mode = 'push') {
  if (curView === 'cam' && id !== 'cam' && typeof camStop === 'function') camStop();
  if (id !== 'home' && typeof homeSel !== 'undefined' && homeSel.on) { homeSel.on = false; homeSel.ids.clear(); $('homeSelBar').hidden = true; $('docList').classList.remove('selmode'); $('homeSel').textContent = 'Select'; $('homeNavT').textContent = 'Documents'; $('viewToggle').classList.remove('txt'); updateLayoutBtn(); }
  const from = $(curView), to = $(id);
  if (id === curView) { to.classList.add('active'); return; }
  const clear = (v) => v.classList.remove('in-push', 'out-push', 'in-pop', 'out-pop', 'in-up', 'out-down', 'in-fade');
  clear(from); clear(to);
  if (mode === 'push' || mode === 'up') navStack.push(curView);
  else if (mode === 'pop' || mode === 'down') navStack.pop();
  if (TABS.includes(id)) navStack.length = 0;
  // canonical parents, so Back always lands somewhere sensible no matter how the view was reached
  if (id === 'doc') navStack.splice(0, navStack.length, 'home');
  if (id === 'tool' || id === 'passport') navStack.splice(0, navStack.length, typeof toolBack !== 'undefined' ? toolBack : 'tools');
  from.classList.remove('active'); to.classList.add('active');
  from.inert = true; to.inert = false;
  const anim = { push: ['out-push', 'in-push'], pop: ['out-pop', 'in-pop'], up: [null, 'in-up'], down: ['out-down', null], tab: [null, 'in-fade'] }[mode];
  if (anim) {
    if (anim[0]) { from.classList.add(anim[0]); setTimeout(() => clear(from), 460); }
    if (anim[1]) { to.classList.add(anim[1]); setTimeout(() => clear(to), 460); }
  }
  curView = id;
  $('tabbar').classList.toggle('hide', !TABS.includes(id));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
  syncHistory();
}
// ---- History integration: iOS edge-swipe / browser Back = in-app Back; Back closes sheets & alerts first ----
let histDepth = 0, pendingGo = false, goT = 0;
// One traversal at a time: history.go() is async, so pushes wait until it lands (otherwise entries drift).
function syncHistory() {
  if (pendingGo) return;
  const want = navStack.length;
  if (histDepth > want) {
    pendingGo = true; clearTimeout(goT);
    goT = setTimeout(() => { pendingGo = false; syncHistory(); }, 1000);
    history.go(want - histDepth); return;
  }
  while (histDepth < want) history.pushState({ d: ++histDepth }, '');
}
if (!history.state || history.state.d !== 0) history.replaceState({ d: 0 }, '');
const VIEW_BACK = { doc: 'docBack', page: 'pageBack', ocr: 'ocrBack', crop: 'cropCancel', sigpad: 'sigBack', place: 'placeBack', passport: 'ppBack', pdfv: 'pdfvBack' };
function appBack() {
  if (curView === 'review') return openBatch();
  if (curView === 'batch') return batchLeave();
  if (curView === 'cam') return camLeave();
  if (curView === 'page' && !$('adjust').hidden) return $('adjCancel').click();
  if (curView === 'tool') return $('tool').querySelector('[data-back]').click();
  const b = VIEW_BACK[curView] && $(VIEW_BACK[curView]); if (b) b.click();
}
window.addEventListener('popstate', (e) => {
  histDepth = (e.state && e.state.d) || 0;
  if (pendingGo) { pendingGo = false; clearTimeout(goT); syncHistory(); return; }
  if ($('alert').classList.contains('on')) { const bs = $('alert').querySelectorAll('.aa button'); (bs[0] || {}).click?.(); setTimeout(syncHistory, 0); return; }
  if (sheetResolve) { closeSheet(null); setTimeout(syncHistory, 0); return; }
  if (!$('busy').hidden) { setTimeout(syncHistory, 0); return; }
  appBack();
  setTimeout(syncHistory, 900); // if Back was declined (e.g. "Keep Scanning"), restore the entry
});
let tabT = 0;
function goTab(id) {
  const now = Date.now(); if (now - tabT < 250 && curView === id) return; tabT = now; // rapid-tap guard
  navStack.length = 0;
  if (id === 'home') return renderHome('tab');
  if (id === 'settings') renderSettings();
  show(id, 'tab');
}
// collapse large titles on scroll
document.querySelectorAll('.view').forEach((v) => {
  const sc = v.querySelector('.scroll'); if (!sc) return;
  sc.addEventListener('scroll', () => v.classList.toggle('scrolled', sc.scrollTop > 36), { passive: true });
});
// press feedback on primary buttons
document.addEventListener('pointerdown', (e) => { if (e.target.closest('.btn.primary,.scanbtn,.shutter')) haptic(); }, { passive: true });

// ---------- toasts & HUD ----------
function toast(msg, kind = 'ok') {
  const t = $('toast'); t.className = 'toast' + (kind === 'err' ? ' err' : '');
  t.replaceChildren(icon(kind === 'err' ? 'x' : 'check'), el('span', { textContent: msg }));
  // never cover an open action sheet: sit just above it
  const sh = $('sheet'); t.style.bottom = sh.classList.contains('on') ? `${innerHeight - sh.getBoundingClientRect().top + 12}px` : '';
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function busy(msg) {
  const b = $('busy');
  if (msg) { $('busyMsg').textContent = msg; if (b.hidden) { b.hidden = false; } $('toast').classList.remove('show'); }
  else b.hidden = true;
}

// ---------- sheets & alerts ----------
let sheetResolve = null;
function openSheet(build) {
  return new Promise((res) => {
    sheetResolve = res;
    const body = $('sheetBody'); body.replaceChildren();
    build(body, closeSheet);
    $('scrim').classList.add('on'); $('sheet').classList.add('on'); $('toast').classList.remove('show');
  });
}
function closeSheet(v = null) {
  $('scrim').classList.remove('on'); $('sheet').classList.remove('on'); $('sheet').style.transform = '';
  const r = sheetResolve; sheetResolve = null; if (r) r(v);
}
$('scrim').addEventListener('click', () => { if (sheetResolve) closeSheet(null); });
// drag-to-dismiss from the top strip (grabber / title). Touch events are used on touch devices because
// pointer events get cancelled as soon as the browser starts a scroll gesture.
(() => {
  const s = $('sheet'); let y0 = null, dy = 0;
  const canStart = (t, y) => (t.closest('.grabber,h3,.sub') || y - s.getBoundingClientRect().top < 48) && !t.closest('input,textarea') && s.scrollTop === 0;
  const begin = (y) => { y0 = y; dy = 0; s.classList.add('drag'); };
  const move = (y) => { dy = Math.max(0, y - y0); s.style.transform = `translateY(${dy}px)`; };
  const end = () => { if (y0 == null) return; s.classList.remove('drag'); y0 = null; if (dy > 90) closeSheet(null); else s.style.transform = ''; };
  s.addEventListener('touchstart', (e) => { if (e.touches.length === 1 && canStart(e.target, e.touches[0].clientY)) begin(e.touches[0].clientY); }, { passive: true });
  s.addEventListener('touchmove', (e) => { if (y0 == null) return; e.preventDefault(); move(e.touches[0].clientY); }, { passive: false });
  s.addEventListener('touchend', end); s.addEventListener('touchcancel', end);
  s.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; if (canStart(e.target, e.clientY)) { begin(e.clientY); s.setPointerCapture(e.pointerId); } });
  s.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' || y0 == null) return; move(e.clientY); });
  s.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') end(); });
  s.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'touch') end(); });
})();
/** Action sheet. items: [{label, value, icon, danger, checked}] */
function menu(title, items, sub) {
  return openSheet((body, close) => {
    if (title) body.append(el('h3', { textContent: title }));
    if (sub) body.append(el('p', { class: 'sub', textContent: sub }));
    if (!title && !sub) body.append(el('div', { style: 'height:4px' }));
    body.append(el('div', { class: 'group' }, items.map((it) => el('button', { class: 'cell' + (it.danger ? ' danger' : ''), onclick: () => close(it.value) },
      it.icon ? el('span', { class: 'ic' }, icon(it.icon)) : null, el('span', { class: 'ct' }, el('b', { textContent: it.label })),
      it.checked ? icon('check', 'check') : null))));
    body.append(el('div', { class: 'group' }, el('button', { class: 'cell cancel', textContent: 'Cancel', onclick: () => close(null) })));
  });
}
/** iOS alert. opts: {title, message, input, placeholder, actions:[{label,value,style:'b'|'d'}]} */
function alertBox(opts) {
  return new Promise((res) => {
    const a = $('alert'); a.replaceChildren();
    const inp = opts.input != null ? el('input', { value: opts.input, placeholder: opts.placeholder || '', type: opts.type || 'text' }) : null;
    const done = (v) => {
      a.classList.remove('on'); $('scrim').classList.remove('on');
      res(v === '__input' ? inp.value : v);
    };
    a.append(el('div', { class: 'ab' }, el('h4', { textContent: opts.title }), opts.message ? el('p', { textContent: opts.message }) : null, inp),
      el('div', { class: 'aa' }, opts.actions.map((x) => el('button', { class: x.style || '', textContent: x.label, onclick: () => done(x.value) }))));
    $('scrim').classList.add('on'); a.classList.add('on');
    if (inp) { setTimeout(() => { inp.focus(); inp.select(); }, 50); inp.onkeydown = (e) => { if (e.key === 'Enter') done('__input'); }; }
  });
}
async function askText(title, value = '', ok = 'Save', message) {
  const v = await alertBox({ title, message, input: value, actions: [{ label: 'Cancel', value: null }, { label: ok, value: '__input', style: 'b' }] });
  return v == null ? null : (v.trim() || null);
}
const confirmDelete = (title, message, label = 'Delete') =>
  alertBox({ title, message, actions: [{ label: 'Cancel', value: false }, { label, value: true, style: 'd b' }] });

// ---------- files ----------
function pickFiles(accept, multiple = false, capture) {
  return new Promise((res) => {
    const i = el('input', { type: 'file', accept, multiple, hidden: true });
    if (capture) i.setAttribute('capture', capture);
    i.onchange = () => { res([...i.files]); i.remove(); };
    i.addEventListener('cancel', () => { res([]); i.remove(); });
    document.body.append(i); i.click();
  });
}
async function deliver(files) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  for (const f of files) {
    const a = el('a', { href: URL.createObjectURL(f), download: f.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    await sleep(300);
  }
  toast(files.length > 1 ? `${files.length} files saved` : 'Saved to Downloads');
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
function scaleCanvas(s, maxSide) {
  const k = Math.min(1, maxSide / Math.max(s.width, s.height));
  const c = el('canvas', { width: Math.round(s.width * k), height: Math.round(s.height * k) });
  c.getContext('2d').drawImage(s, 0, 0, c.width, c.height); return c;
}
const scripts = {};
function loadScript(src) {
  if (scripts[src]) return scripts[src];
  scripts[src] = new Promise((res, rej) => {
    const s = el('script', { src, async: true });
    s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error('Could not load a component. Check your connection.')); };
    document.head.append(s);
  });
  return scripts[src];
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
  put(doc) { doc.updated = Date.now(); return this.tx('readwrite', (s) => s.put(doc)); },
  del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
  clear() { return this.tx('readwrite', (s) => s.clear()); },
};
function migrate(d) {
  d.pages = d.pages.map((p) => (p instanceof Blob ? { orig: p, img: p, filter: 'original', text: '' } : p));
  d.folder = d.folder || '';
  return d;
}
let activeFolder = '';
async function newDoc(name, pages = []) {
  const d = { id: String(Date.now()) + Math.floor(Math.random() * 1000), name, created: Date.now(), folder: activeFolder, pages };
  await DB.put(d); return d;
}
const mkPage = (b, extra = {}) => ({ orig: b, img: b, filter: 'original', text: '', ...extra });

// ---------- state ----------
let current = null, pageIdx = 0;
let objectUrls = [];
function revokeUrls() { objectUrls.forEach(URL.revokeObjectURL); objectUrls = []; }
function url(blob) { const u = URL.createObjectURL(blob); objectUrls.push(u); return u; }
const pad = (n) => String(n).padStart(2, '0');
function stamp() { const d = new Date(); return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`; }
const defaultName = async () => {
  const d = new Date(), base = `Scan ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
  const names = new Set((await DB.all()).map((x) => x.name));
  if (!names.has(base)) return base;
  let n = 2; while (names.has(`${base} (${n})`)) n++; return `${base} (${n})`;
};
function relDate(t) {
  const d = new Date(t), now = new Date(), day = 864e5;
  const diff = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / day);
  if (diff === 0) return 'Today, ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- folders ----------
function savedFolders() { try { return JSON.parse(localStorage.getItem('folders') || '[]'); } catch { return []; } }
function setFolders(f) { localStorage.setItem('folders', JSON.stringify([...new Set(f)].sort())); }
async function allFolders(docs) {
  return [...new Set([...savedFolders(), ...(docs || await DB.all()).map((d) => d.folder).filter(Boolean)])].sort();
}
async function askNewFolder() {
  const n = await askText('New Folder', '', 'Create', 'Enter a name for this folder.');
  if (!n) return null;
  setFolders([...savedFolders(), n]); return n;
}

// ---------- Home ----------
const EMPTY_ILL = `<svg class="ill" viewBox="0 0 150 130" fill="none">
  <rect x="38" y="14" width="64" height="86" rx="8" fill="var(--bg2)" stroke="var(--label3)" stroke-width="1.5" transform="rotate(-8 70 57)"/>
  <rect x="50" y="20" width="64" height="86" rx="8" fill="var(--bg2)" stroke="var(--accent)" stroke-width="2"/>
  <path d="M62 42h40M62 54h40M62 66h28" stroke="var(--label3)" stroke-width="3" stroke-linecap="round"/>
  <path d="M40 108v-8a4 4 0 0 1 4-4h8M124 96h-8M128 100v8M44 124h-0" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>
  <circle cx="122" cy="28" r="4" fill="var(--accent)" opacity=".5"/><circle cx="32" cy="44" r="3" fill="var(--accent)" opacity=".35"/>
  <path d="M128 52l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="var(--accent)"/></svg>`;
const SEARCH_ILL = `<svg class="ill" viewBox="0 0 150 130" fill="none"><circle cx="66" cy="58" r="30" stroke="var(--label3)" stroke-width="5"/><path d="M88 80l24 24" stroke="var(--label3)" stroke-width="8" stroke-linecap="round"/></svg>`;
let homeFirst = true;
function skeleton() {
  return el('div', { class: 'dgrid' }, [0, 1, 2, 3].map(() => el('div', {}, el('div', { class: 'thumb sk' }), el('div', { class: 'sk l1' }), el('div', { class: 'sk l2' }))));
}
function updateLayoutBtn() {
  $('viewToggle').replaceChildren(icon(settings.layout === 'grid' ? 'list' : 'grid'));
}
$('viewToggle').onclick = () => { settings.layout = settings.layout === 'grid' ? 'list' : 'grid'; saveSettings(); renderHome('none'); };
async function renderHome(mode = 'pop') {
  if (homeFirst) { $('docList').replaceChildren(skeleton()); homeFirst = false; }
  if (mode !== 'none' && curView !== 'home') show('home', mode);
  updateLayoutBtn();
  const all = (await DB.all()).sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  revokeUrls();
  // folders
  const folders = await allFolders(all);
  if (activeFolder && !folders.includes(activeFolder)) activeFolder = '';
  const fc = $('folders'); fc.replaceChildren();
  const chip = (label, val, ic) => fc.append(el('button', { class: 'chip' + (activeFolder === val ? ' on' : ''), onclick: () => { activeFolder = val; renderHome('none'); } }, ic ? icon(ic) : null, label));
  if (folders.length || all.length) {
    chip('All', '');
    folders.forEach((f) => chip(f, f, 'folder'));
    fc.append(el('button', { class: 'chip', onclick: async () => { const n = await askNewFolder(); if (n) { activeFolder = n; renderHome('none'); } } }, icon('plus'), 'Folder'));
    if (activeFolder) fc.append(el('button', { class: 'chip', onclick: () => folderActions(all) }, icon('more')));
  }
  // search
  const q = $('search').value.trim().toLowerCase();
  let docs = all.filter((d) => !activeFolder || d.folder === activeFolder);
  const snippets = {};
  if (q) {
    docs = docs.filter((d) => {
      if (d.name.toLowerCase().includes(q) || d.folder.toLowerCase().includes(q)) return true;
      for (const p of d.pages) {
        const t = p.text || ''; const i = t.toLowerCase().indexOf(q);
        if (i >= 0) { snippets[d.id] = '…' + t.slice(Math.max(0, i - 24), i + q.length + 40).replace(/\s+/g, ' ') + '…'; return true; }
      }
      return false;
    });
  }
  const list = $('docList'); list.classList.toggle('selmode', homeSel.on); homeSel.all = docs.map((d) => d.id);
  if (!docs.length) {
    const e = el('div', { class: 'empty', html: q ? SEARCH_ILL : EMPTY_ILL });
    if (q) e.append(el('h3', { textContent: 'No Results' }), el('p', { textContent: `Nothing matches “${$('search').value.trim()}”. Text inside pages is searchable after you use Text on a document.` }));
    else if (activeFolder) e.append(el('h3', { textContent: 'This folder is empty' }), el('p', { textContent: 'Scan something new, or move documents here from their ••• menu.' }), el('button', { class: 'btn primary', style: 'width:auto;padding:0 28px', onclick: () => startScan() }, icon('scan'), 'Scan Document'));
    else e.append(el('h3', { textContent: 'No Documents Yet' }), el('p', { textContent: 'Scan receipts, notes, IDs and more. They stay private on this device.' }), el('button', { class: 'btn primary', style: 'width:auto;padding:0 28px', onclick: () => startScan() }, icon('scan'), 'Scan Document'));
    list.replaceChildren(e); return;
  }
  const meta = (d) => `${relDate(d.updated || d.created)} · ${plural(d.pages.length, 'page')}${d.folder && !activeFolder ? ' · ' + d.folder : ''}`;
  const thumb = (d) => { const i = el('img', { alt: '', onload: function () { this.classList.add('ld'); } }); if (d.pages[0]) i.src = url(d.pages[0].img); return i; };
  if (settings.layout === 'grid') {
    list.replaceChildren(el('div', { class: 'dgrid' }, docs.map((d) => el('div', { class: 'tile' + (homeSel.ids.has(d.id) ? ' sel' : ''), 'data-id': d.id },
      el('button', { class: 'thumb', style: 'display:block;width:100%', onclick: () => openDoc(d.id), 'aria-label': d.name }, thumb(d), d.pages.length > 1 ? el('span', { class: 'count', textContent: d.pages.length }) : null, el('span', { class: 'selck' }, icon('check'))),
      el('div', { class: 'tinfo' }, el('div', {}, el('div', { class: 'tname', textContent: d.name }), el('div', { class: 'tmeta', textContent: meta(d) }), snippets[d.id] ? el('div', { class: 'snip', textContent: snippets[d.id] }) : null),
        el('button', { class: 'tmore', 'aria-label': 'More', onclick: () => docActions(d) }, icon('more')))))));
  } else {
    list.replaceChildren(el('div', { class: 'dlist' }, docs.map((d) => swipeRow(d, thumb(d), meta(d), snippets[d.id]))));
  }
}
function swipeRow(d, img, meta, snip) {
  const content = el('div', { class: 'rowc' }, el('span', { class: 'selck' }, icon('check')), img, el('div', { class: 'rt' }, el('div', { class: 'tname', textContent: d.name }), el('div', { class: 'tmeta', textContent: meta }), snip ? el('div', { class: 'snip', textContent: snip }) : null), icon('chev', 'chev'));
  content.querySelector('.chev').style.cssText = 'width:16px;height:16px;color:var(--label3);stroke-width:2.4';
  const row = el('div', { class: 'swipe' + (homeSel.ids.has(d.id) ? ' sel' : ''), 'data-id': d.id }, el('div', { class: 'sacts' },
    el('button', { class: 'mv', onclick: () => moveDoc(d) }, icon('folder'), 'Move'),
    el('button', { class: 'del', onclick: () => deleteDoc(d) }, icon('trash'), 'Delete')), content);
  let x0 = null, y0 = 0, dx = 0, open = false, horiz = null;
  content.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; dx = 0; horiz = null; });
  content.addEventListener('pointermove', (e) => {
    if (x0 == null) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (horiz == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) { horiz = Math.abs(mx) > Math.abs(my); if (horiz) { content.setPointerCapture(e.pointerId); content.classList.add('drag'); } }
    if (!horiz) return;
    dx = Math.min(0, Math.max(-200, mx + (open ? -160 : 0)));
    content.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (x0 == null) return; x0 = null; content.classList.remove('drag');
    if (horiz) { open = dx < -70; content.style.transform = open ? 'translateX(-160px)' : ''; if (open) haptic(); }
  };
  content.addEventListener('pointerup', end); content.addEventListener('pointercancel', end);
  content.addEventListener('click', () => { if (horiz) return; if (open) { open = false; content.style.transform = ''; return; } openDoc(d.id); });
  return row;
}
let searchT; $('search').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => renderHome('none'), 180); });
async function folderActions(all) {
  const v = await menu(activeFolder, [{ label: 'Rename Folder', value: 'ren', icon: 'pencil' }, { label: 'Delete Folder', value: 'del', icon: 'trash', danger: true }]);
  if (v === 'ren') {
    const n = await askText('Rename Folder', activeFolder); if (!n || n === activeFolder) return;
    for (const d of all.filter((x) => x.folder === activeFolder)) { d.folder = n; await DB.put(d); }
    setFolders([...savedFolders().filter((x) => x !== activeFolder), n]); activeFolder = n; renderHome('none');
  } else if (v === 'del') {
    if (!await confirmDelete(`Delete “${activeFolder}”?`, 'Documents in this folder will be kept and moved out of it.')) return;
    for (const d of all.filter((x) => x.folder === activeFolder)) { d.folder = ''; await DB.put(d); }
    setFolders(savedFolders().filter((x) => x !== activeFolder)); activeFolder = ''; renderHome('none');
  }
}
async function renameDoc(d) {
  const n = await askText('Rename', d.name); if (!n) return false;
  d.name = n; await DB.put(d); return true;
}
async function moveDoc(d) {
  const fs = await allFolders();
  let f = await menu('Move to Folder', [{ label: 'No Folder', value: '', icon: 'docs', checked: !d.folder },
    ...fs.map((x) => ({ label: x, value: x, icon: 'folder', checked: d.folder === x })), { label: 'New Folder…', value: '__new', icon: 'plus' }]);
  if (f === '__new') f = await askNewFolder();
  if (f == null) return;
  d.folder = f; await DB.put(d); toast(f ? `Moved to ${f}` : 'Removed from folder');
  if (curView === 'home') renderHome('none');
}
async function deleteDoc(d) {
  if (!await confirmDelete(`Delete “${d.name}”?`, 'This document will be deleted from this device.')) { if (curView === 'home') renderHome('none'); return; }
  await DB.del(d.id); if (current && current.id === d.id) current = null;
  toast('Document deleted'); renderHome(curView === 'home' ? 'none' : 'pop');
}
async function docActions(d) {
  const v = await menu(d.name, [
    { label: 'Share PDF', value: 'share', icon: 'share' }, { label: 'Rename', value: 'rename', icon: 'pencil' },
    { label: 'Move to Folder', value: 'move', icon: 'folder' }, { label: 'Delete', value: 'delete', icon: 'trash', danger: true }],
  `${plural(d.pages.length, 'page')} · ${relDate(d.updated || d.created)}`);
  if (v === 'share') { const w = await shareMenu(d); if (w === 'jpg') { const dd = await ensureFinal(d); busy(); return deliver(dd.pages.map((p, i) => new File([p.img], `${safeName(dd.name)}${dd.pages.length > 1 ? ' - ' + (i + 1) : ''}.jpg`, { type: 'image/jpeg' }))); } return w && exportPdf(d, null, w === 'small'); }
  if (v === 'rename') { if (await renameDoc(d)) curView === 'doc' ? openDoc(d.id, 'none') : renderHome('none'); }
  if (v === 'move') { await moveDoc(d); if (curView === 'doc') openDoc(d.id, 'none'); }
  if (v === 'delete') return deleteDoc(d);
}

// ---------- Document view (with long-press drag to reorder) ----------
async function openDoc(id, mode = 'push') {
  if (current && current.id !== id) { docSel.on = false; docSel.ids.clear(); }
  current = await DB.get(id);
  if (!current) return renderHome();
  revokeUrls();
  $('docTitle').textContent = current.name;
  $('doc').querySelector('.nav-t').textContent = current.name;
  const bytes = current.pages.reduce((a, p) => a + (p.img ? p.img.size : 0), 0);
  $('docMeta').replaceChildren(el('span', {}, icon('folder'), current.folder || 'No folder'), el('span', {}, icon('docs'), plural(current.pages.length, 'page')), el('span', {}, icon('storage'), docSize(bytes)), el('span', { textContent: relDate(current.updated || current.created) }));
  $('docSearchBar').hidden = true; $('docSearchHint').hidden = true; $('docSearch').value = '';
  const wrap = $('pages'); wrap.replaceChildren();
  current.pages.forEach((p, i) => {
    const tile = el('div', { class: 'pg' + (docSel.ids.has(i) ? ' sel' : '') }, el('div', { class: 'thumb' }, el('img', { src: url(p.img), alt: `Page ${i + 1}`, draggable: false }), el('span', { class: 'selck' }, icon('check'))), el('span', { class: 'num', textContent: i + 1 }));
    tile.dataset.i = i; wrap.append(tile);
  });
  $('doc').querySelector('.tip').hidden = current.pages.length < 2;
  // 'none' = refresh in place without animation; if the document screen isn't showing yet, show it (3.3.1 fix: callers
  // that open a document with 'none' from another screen used to stay where they were)
  if (mode !== 'none') show('doc', curView === 'home' || curView === 'tool' ? 'push' : 'pop');
  else if (curView !== 'doc') show('doc', 'none');
  docSelChrome();
}
$('docTitle').onclick = async () => { if (await renameDoc(current)) openDoc(current.id, 'none'); };
(() => {
  const wrap = $('pages'); let st = null;
  const tileAt = (x, y) => { const e = document.elementFromPoint(x, y); const t = e && e.closest('.pg'); return t && !t.classList.contains('lift') ? t : null; };
  wrap.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.pg'); if (!t) return;
    st = { t, x: e.clientX, y: e.clientY, drag: false, moved: false, id: e.pointerId };
    st.timer = setTimeout(() => { if (!st || st.moved || docSel.on) return; st.drag = true; haptic(); t.classList.add('lift'); wrap.setPointerCapture(st.id); }, 320);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.drag) { if (Math.hypot(dx, dy) > 8) { st.moved = true; clearTimeout(st.timer); } return; }
    st.t.style.transform = `translate(${dx}px,${dy}px) scale(1.06)`;
    wrap.querySelectorAll('.target').forEach((x) => x.classList.remove('target'));
    const over = tileAt(e.clientX, e.clientY); if (over) over.classList.add('target'); st.over = over;
  });
  wrap.addEventListener('touchmove', (e) => { if (st && st.drag) e.preventDefault(); }, { passive: false });
  const end = async () => {
    if (!st) return; clearTimeout(st.timer); const s = st; st = null;
    if (!s.drag) { if (!s.moved) (docSel.on ? docSelToggle(+s.t.dataset.i) : openPage(+s.t.dataset.i)); return; }
    s.t.classList.remove('lift'); s.t.style.transform = '';
    wrap.querySelectorAll('.target').forEach((x) => x.classList.remove('target'));
    if (s.over) {
      const from = +s.t.dataset.i, to = +s.over.dataset.i;
      const [p] = current.pages.splice(from, 1); current.pages.splice(to, 0, p);
      await DB.put(current); openDoc(current.id, 'none'); toast(`Moved to position ${to + 1}`);
    }
  };
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', () => { if (st) { clearTimeout(st.timer); st.t.classList.remove('lift'); st.t.style.transform = ''; st = null; } });
})();
$('docBack').onclick = () => { if (docSel.on) return setDocSel(false); current = null; renderHome('pop'); };
$('docMenu').onclick = () => docActions(current);



// ---------- Document toolbar ----------
const docSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
$('docAdd').onclick = () => startScan();
$('docShare').onclick = async () => {
  const v = await shareMenu(current);
  if (v === 'pdf' || v === 'small') exportPdf(current, null, v === 'small');
  if (v === 'jpg') { await ensureFinal(current); busy(); } if (v === 'jpg') deliver(current.pages.map((p, i) => new File([p.img], `${safeName(current.name)}${current.pages.length > 1 ? ' - ' + (i + 1) : ''}.jpg`, { type: 'image/jpeg' })));
};
$('docEdit').onclick = async () => {
  const v = await menu('Edit Document', [
    { label: 'Filters for All Pages', value: 'filter', icon: 'wand' }, { label: 'Rename', value: 'rename', icon: 'pencil' },
    { label: 'Move to Folder', value: 'move', icon: 'folder' }, { label: 'Delete Document', value: 'delete', icon: 'trash', danger: true }]);
  if (v === 'filter') {
    const f = await menu('Filters', FILTERS.map(([k, l]) => ({ label: l, value: k, icon: 'wand', checked: current.pages.every((p) => (p.filter || 'original') === k) })), 'Applied to every page in this document.');
    if (f) { await setPageFilter(f, true); openDoc(current.id, 'none'); toast('Filter applied to all pages'); }
  }
  if (v === 'rename') { if (await renameDoc(current)) openDoc(current.id, 'none'); }
  if (v === 'move') { await moveDoc(current); openDoc(current.id, 'none'); }
  if (v === 'delete') deleteDoc(current);
};
$('docFind').onclick = async () => {
  const bar = $('docSearchBar');
  if (!bar.hidden) { bar.hidden = true; $('docSearchHint').hidden = true; $('docSearch').value = ''; docSearch(); return; }
  if (!current.pages.some((p) => p.text)) {
    const ok = await alertBox({ title: 'Find Text First?', message: 'DocSnap needs to read the text in your pages once (on this device) before you can search them.', actions: [{ label: 'Not Now', value: false }, { label: 'Find Text', value: true, style: 'b' }] });
    if (!ok) return;
    openOcr.only = null; await runOcr(settings.lang);
  }
  bar.hidden = false; $('docSearch').focus();
};
function docSearch() {
  const q = $('docSearch').value.trim().toLowerCase(), hint = $('docSearchHint');
  const hits = [];
  $('pages').querySelectorAll('.pg').forEach((t) => {
    const p = current.pages[+t.dataset.i], hit = q && (p.text || '').toLowerCase().includes(q);
    t.classList.toggle('hit', !!hit); t.classList.toggle('dim', !!q && !hit); if (hit) hits.push(+t.dataset.i + 1);
  });
  hint.hidden = !q; hint.textContent = !q ? '' : hits.length ? `Found on page${hits.length > 1 ? 's' : ''} ${hits.join(', ')}` : 'No matches in this document';
}
$('docSearch').addEventListener('input', docSearch);
$('docPdf').onclick = () => openPdfView(current);
function openPdfView(doc) {
  const list = $('pdfvPages'); list.replaceChildren();
  $('pdfvTitle').textContent = doc.name;
  $('pdfvInfo').textContent = plural(doc.pages.length, 'page') + ' · A4';
  doc.pages.forEach((p, i) => list.append(el('figure', { class: 'pdfpg' }, el('img', { src: url(p.img), alt: `Page ${i + 1}`, loading: i > 1 ? 'lazy' : 'eager', decoding: 'async' }), el('figcaption', { textContent: `${i + 1}` }))));
  list.parentElement.scrollTop = 0;
  show('pdfv', 'push');
  ensureJsPdf().catch(() => {}); // warm up the PDF writer so Share is instant
}
$('pdfvBack').onclick = () => show('doc', 'pop');
$('pdfvShare').onclick = () => exportPdf(current);
$('pdfvShare2').onclick = () => $('pdfvShare').click();

// ---------- Page view ----------
async function renderPage(p) { p.img = await vFilter(p.orig, p.filter || 'original', p.bc); delete p.pending; }
/** Finish full-resolution renders for pages saved with a preview stand-in. */
const finishing = new Map();
function finishPending(id) {
  if (finishing.has(id)) return finishing.get(id);
  const pr = finishPending1(id).finally(() => finishing.delete(id)); finishing.set(id, pr); return pr;
}
/** Make sure a document has its full-res pages before it leaves the app. */
async function ensureFinal(doc) {
  if (!doc.pages.some((x) => x.pending)) return doc;
  busy('Finishing pages…'); await finishPending(doc.id);
  const d = await DB.get(doc.id); if (current && current.id === d.id) current = d; return d;
}
async function finishPending1(id) {
  try {
    for (;;) {
      const d = await DB.get(id); if (!d) break;
      const i = d.pages.findIndex((x) => x.pending); if (i < 0) break;
      const pg = d.pages[i], f = pg.filter, pid = pg.pid;
      const img = await vFilter(pg.orig, f || 'original', pg.bc, null, 0.92, 1);
      const d2 = await DB.get(id); if (!d2) break;
      const j = d2.pages.findIndex((x) => x.pid === pid);
      if (j >= 0 && d2.pages[j].pending && d2.pages[j].filter === f) { d2.pages[j].img = img; delete d2.pages[j].pending; await DB.put(d2); }
      else if (j >= 0) { delete d2.pages[j].pending; await DB.put(d2); }
      if (current && current.id === id) {
        const cp = current.pages.find((x) => x.pid === pid);
        if (cp && cp.pending) { cp.img = img; delete cp.pending; }
        const k = current.pages.indexOf(cp);
        const tile = k >= 0 && document.querySelector(`#pages .pg[data-i="${k}"] img`); if (tile) tile.src = url(img);
        if (curView === 'page' && pageIdx === k) $('pageImg').src = url(img);
      }
    }
  } catch (e) { console.warn('finishPending', e); }
}
/** Persist a new "orig" for the current page (optional) and re-apply its filter + adjustments. */
async function savePage(orig) {
  const p = current.pages[pageIdx];
  if (orig) p.orig = await canvasToBlob(orig, 0.92);
  await renderPage(p); current.updated = Date.now();
  await DB.put(current);
}
async function openPage(i, mode) {
  pageIdx = Math.max(0, Math.min(i, current.pages.length - 1)); const p = current.pages[pageIdx];
  $('pageTitle').textContent = `Page ${pageIdx + 1} of ${current.pages.length}`;
  $('pageImg').src = url(p.img); $('pageImg').hidden = false; $('adjCanvas').hidden = true;
  $('adjust').hidden = true; $('pageBar').hidden = false;
  if (curView !== 'page') show('page', mode || 'push');
}
(() => { // swipe between pages
  let x0 = null, y0 = 0;
  $('pageView').addEventListener('pointerdown', (e) => { if ($('adjust').hidden) { x0 = e.clientX; y0 = e.clientY; } });
  $('pageView').addEventListener('pointerup', (e) => {
    if (x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { const n = pageIdx + (dx < 0 ? 1 : -1); if (n >= 0 && n < current.pages.length) { haptic(); openPage(n); } }
  });
})();
async function setPageFilter(f, all) {
  busy('Applying…');
  try {
    const list = all ? current.pages : [current.pages[pageIdx]];
    for (let i = 0; i < list.length; i++) { if (all && list.length > 1) busy(`Applying… ${i + 1} of ${list.length}`); list[i].filter = f; await renderPage(list[i]); }
    current.updated = Date.now(); await DB.put(current); settings.filter = f; saveSettings();
  } catch (e) { toast(e.message, 'err'); }
  busy();
}
async function pageFilters() {
  const p = current.pages[pageIdx];
  const v = await menu('Filters', FILTERS.map(([f, l]) => ({ label: l, value: f, icon: 'wand', checked: (p.filter || 'original') === f })), current.pages.length > 1 ? 'Choose a look for this page. You can apply it to every page next.' : undefined);
  if (!v) return;
  let all = false;
  if (current.pages.length > 1) all = (await menu('Apply To', [{ label: 'This Page', value: 'one', icon: 'doc' }, { label: `All ${current.pages.length} Pages`, value: 'all', icon: 'docs' }])) === 'all';
  await setPageFilter(v, all); openPage(pageIdx, 'none');
}
async function rotatePage() {
  busy('Rotating…');
  try {
    const p = current.pages[pageIdx];
    if (p.raw) { p.raw = await canvasToBlob(rotateCanvas(await blobToCanvas(p.raw)), 0.9); if (p.quad) p.quad = Vision.order(p.quad.map((t) => ({ x: 1 - t.y, y: t.x }))); }
    await savePage(rotateCanvas(await blobToCanvas(p.orig)));
  } catch (e) { toast(e.message, 'err'); }
  busy(); openPage(pageIdx, 'none');
}
async function setPageGeometry(p, raw, q) {
  busy('Straightening…');
  const w = await vWarp(raw, q, 0.88);
  p.raw = w.raw; p.quad = q.map((t) => ({ x: t.x / raw.width, y: t.y / raw.height })); p.orig = w.orig;
  await renderPage(p); current.updated = Date.now(); await DB.put(current);
}
const backToPage = () => { show('page', 'down'); openPage(pageIdx, 'none'); };
async function recropPage() {
  const p = current.pages[pageIdx];
  busy('Opening…');
  try {
    const raw = await blobToCanvas(p.raw || p.orig);
    const q = p.quad && p.raw ? p.quad.map((t) => ({ x: t.x * raw.width, y: t.y * raw.height })) : null;
    busy();
    startCrop(raw, { q: q || fullCorners(raw), found: !!q, title: 'Re-Crop', retake: true, done: async (r, q2) => { try { await setPageGeometry(p, r, q2); } catch (e) { toast(e.message, 'err'); } busy(); backToPage(); }, cancel: backToPage });
  } catch (e) { busy(); toast(e.message, 'err'); }
}
async function retakePage() {
  const p = current.pages[pageIdx];
  const files = await pickFiles('image/*', false, 'environment'); if (!files.length) return;
  const r = await photoToCrop(files[0]); if (!r) return;
  startCrop(r.raw, { q: r.q, found: r.found, det: r.det, title: 'Retake', retake: true, done: async (raw, q) => { try { await setPageGeometry(p, raw, q); } catch (e) { toast(e.message, 'err'); } busy(); backToPage(); }, cancel: backToPage });
}
// Brightness / contrast
const adj = { base: null };
async function openAdjust() {
  const p = current.pages[pageIdx];
  busy('Loading…');
  try {
    adj.base = await blobToCanvas(await vFilter(p.orig, p.filter || 'original', null, 1100, 0.9));
  } catch (e) { busy(); return toast(e.message, 'err'); }
  busy();
  const bc = p.bc || { b: 0, c: 0 }; $('adjB').value = bc.b; $('adjC').value = bc.c;
  const ac = $('adjCanvas'); ac.width = adj.base.width; ac.height = adj.base.height;
  $('pageImg').hidden = true; ac.hidden = false; $('adjust').hidden = false; $('pageBar').hidden = true;
  drawAdjust();
}
function drawAdjust() {
  const b = +$('adjB').value, c = +$('adjC').value; $('adjBv').textContent = b; $('adjCv').textContent = c;
  const ac = $('adjCanvas'), ctx = ac.getContext('2d'); ctx.drawImage(adj.base, 0, 0);
  if (!b && !c) return;
  const im = ctx.getImageData(0, 0, ac.width, ac.height), d = im.data, a = 1 + c / 100, off = 128 * (1 - a) + b * 1.28;
  const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) t[i] = a * i + off;
  for (let i = 0; i < d.length; i += 4) { d[i] = t[d[i]]; d[i + 1] = t[d[i + 1]]; d[i + 2] = t[d[i + 2]]; }
  ctx.putImageData(im, 0, 0);
}
$('adjB').oninput = $('adjC').oninput = drawAdjust;
$('adjReset').onclick = () => { $('adjB').value = 0; $('adjC').value = 0; drawAdjust(); };
$('adjCancel').onclick = () => { Vision.free(adj.base); openPage(pageIdx, 'none'); };
$('adjApply').onclick = async () => {
  const p = current.pages[pageIdx], b = +$('adjB').value, c = +$('adjC').value;
  busy('Applying…');
  try { p.bc = b || c ? { b, c } : null; await savePage(); } catch (e) { toast(e.message, 'err'); }
  busy(); Vision.free(adj.base); openPage(pageIdx, 'none');
};
async function watermarkPage() {
  const text = await askText('Watermark', 'CONFIDENTIAL', 'Add', 'This text is placed across the page.'); if (!text) return;
  busy('Adding watermark…');
  try {
    const c = await blobToCanvas(current.pages[pageIdx].orig), ctx = c.getContext('2d');
    const fs = Math.min(c.width, c.height) / Math.max(4, text.length * 0.62);
    ctx.save(); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(-Math.atan2(c.height, c.width));
    ctx.font = `700 ${fs}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(128,128,128,0.25)'; ctx.fillText(text, 0, 0); ctx.restore();
    await savePage(c); toast('Watermark added');
  } catch (e) { toast(e.message, 'err'); }
  busy(); openPage(pageIdx, 'none');
}
$('pgEdit').onclick = async () => {
  const v = await menu('Edit Page', [
    { label: 'Brightness & Contrast', value: 'bc', icon: 'sliders' }, { label: 'Retake', value: 'retake', icon: 'retake' },
    { label: 'Re-Crop', value: 'crop', icon: 'crop' }, { label: 'Filters', value: 'filter', icon: 'wand' },
    { label: 'Rotate', value: 'rotate', icon: 'rotate' }, { label: 'Watermark', value: 'wm', icon: 'drop' }]);
  ({ bc: openAdjust, retake: retakePage, crop: recropPage, filter: pageFilters, rotate: rotatePage, wm: watermarkPage })[v]?.();
};
$('pgOcr').onclick = () => openOcr(pageIdx);
$('pgSign').onclick = () => startPlace();
const pageFileName = () => `${safeName(current.name)}${current.pages.length > 1 ? ' - ' + (pageIdx + 1) : ''}`;
$('pgDownload').onclick = async () => {
  if (current.pages[pageIdx].pending) { await ensureFinal(current); busy(); }
  const v = await menu('Download Page', [{ label: 'Image (JPG)', value: 'jpg', icon: 'photo' }, { label: 'PDF', value: 'pdf', icon: 'pdf' }]);
  const p = current.pages[pageIdx];
  if (v === 'jpg') deliver([new File([p.img], pageFileName() + '.jpg', { type: 'image/jpeg' })]);
  if (v === 'pdf') { busy('Preparing PDF…'); try { const b = await imagesToPdfBlob([p.img]); busy(); deliver([new File([b], pageFileName() + '.pdf', { type: 'application/pdf' })]); } catch { busy(); toast('Couldn’t create PDF', 'err'); } }
};
$('pgShare').onclick = async () => { if (current.pages[pageIdx].pending) { await ensureFinal(current); busy(); } return deliver([new File([current.pages[pageIdx].img], pageFileName() + '.jpg', { type: 'image/jpeg' })]); };
$('pageDelete').onclick = async () => {
  if (!await confirmDelete('Delete this page?', current.pages.length === 1 ? 'This is the only page, so the document will be deleted too.' : undefined)) return;
  current.pages.splice(pageIdx, 1);
  if (!current.pages.length) { await DB.del(current.id); current = null; toast('Document deleted'); return renderHome('pop'); }
  await DB.put(current); toast('Page deleted'); openDoc(current.id);
};
$('pageBack').onclick = () => openDoc(current.id);

// ---------- Signature ----------
const sig = { drawing: false, has: false, after: null, back: 'tools' };
function openSigPad(after) {
  sig.after = after; sig.back = curView; show('sigpad', 'up');
  requestAnimationFrame(() => {
    const c = $('sigCanvas'), r = c.getBoundingClientRect(), dpr = Math.min(3, devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.6 * dpr; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f4d'; sig.has = false; sig.dpr = dpr;
  });
}
function sigPt(e) { const c = $('sigCanvas'), r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; }
$('sigCanvas').addEventListener('pointerdown', (e) => { sig.drawing = true; sig.has = true; e.target.setPointerCapture(e.pointerId); const ctx = e.target.getContext('2d'); const [x, y] = sigPt(e); ctx.beginPath(); ctx.moveTo(x, y); sig.last = [x, y]; });
$('sigCanvas').addEventListener('pointermove', (e) => {
  if (!sig.drawing) return; const ctx = e.target.getContext('2d'); const [x, y] = sigPt(e);
  const [lx, ly] = sig.last; ctx.quadraticCurveTo(lx, ly, (x + lx) / 2, (y + ly) / 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo((x + lx) / 2, (y + ly) / 2); sig.last = [x, y];
});
['pointerup', 'pointercancel'].forEach((t) => $('sigCanvas').addEventListener(t, () => { sig.drawing = false; }));
$('sigClear').onclick = () => { const c = $('sigCanvas'); c.getContext('2d').clearRect(0, 0, c.width, c.height); sig.has = false; };
$('sigBack').onclick = () => { show(sig.back, 'down'); if (sig.after) sig.after(false, true); };
$('sigSave').onclick = () => {
  if (!sig.has) return toast('Draw your signature first', 'err');
  const c = $('sigCanvas'), ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const m = 8, t = el('canvas', { width: x1 - x0 + 2 * m, height: y1 - y0 + 2 * m });
  t.getContext('2d').drawImage(c, x0 - m, y0 - m, t.width, t.height, 0, 0, t.width, t.height);
  localStorage.setItem('signature', t.toDataURL('image/png'));
  toast('Signature saved');
  show(sig.back, 'down');
  if (sig.after) sig.after(true);
};
const place = { page: null, sig: null, x: 0.7, y: 0.85, drag: false };
async function startPlace() {
  const data = localStorage.getItem('signature');
  if (!data) return openSigPad((ok) => { if (ok) setTimeout(startPlace, 450); });
  busy('Loading…');
  place.page = await blobToCanvas(current.pages[pageIdx].orig);
  place.sig = new Image(); place.sig.src = data; await place.sig.decode();
  busy(); show('place', 'up'); requestAnimationFrame(drawPlace);
}
function sigRect() {
  const W = place.page.width, w = W * $('placeSize').value / 100, h = w * place.sig.height / place.sig.width;
  return { x: place.x * W - w / 2, y: place.y * place.page.height - h / 2, w, h };
}
function drawPlace() {
  const c = $('placeCanvas'); c.width = place.page.width; c.height = place.page.height;
  const ctx = c.getContext('2d'); ctx.drawImage(place.page, 0, 0);
  const r = sigRect(); ctx.drawImage(place.sig, r.x, r.y, r.w, r.h);
  const lw = Math.max(2, c.width / 250);
  ctx.strokeStyle = '#2dd4bf'; ctx.setLineDash([lw * 4, lw * 3]); ctx.lineWidth = lw; ctx.strokeRect(r.x - lw * 3, r.y - lw * 3, r.w + lw * 6, r.h + lw * 6);
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
$('placeBack').onclick = () => show('page', 'down');
$('placeRedraw').onclick = () => openSigPad((ok) => { if (ok) setTimeout(startPlace, 450); });
$('placeDone').onclick = async () => {
  busy('Signing…');
  try { const r = sigRect(); place.page.getContext('2d').drawImage(place.sig, r.x, r.y, r.w, r.h); await savePage(place.page); toast('Signed'); } catch (e) { toast(e.message, 'err'); }
  busy(); show('page', 'down'); openPage(pageIdx);
};

// ---------- Settings ----------
async function renderSettings() {
  $('setFilterVal').textContent = Object.fromEntries(FILTERS)[settings.filter];
  $('setLangVal').textContent = Object.fromEntries(LANGS)[settings.lang];
  $('setSigVal').textContent = localStorage.getItem('signature') ? 'Saved' : 'Not set';
  try {
    const est = await navigator.storage.estimate();
    $('setStorage').textContent = est.usage > 1048576 ? (est.usage / 1048576).toFixed(1) + ' MB' : Math.round(est.usage / 1024) + ' KB';
  } catch { $('setStorage').textContent = '—'; }
}
$('setFilterBtn').onclick = async () => {
  const v = await menu('Default Look', FILTERS.map(([f, l]) => ({ label: l, value: f, checked: settings.filter === f })), 'Applied to new scans. You can change it for any page later.');
  if (v) { settings.filter = v; saveSettings(); renderSettings(); }
};
$('setLangBtn').onclick = async () => {
  const v = await menu('Text Language', LANGS.map(([f, l]) => ({ label: l, value: f, checked: settings.lang === f })), 'The language used when finding text in your scans.');
  if (v) { settings.lang = v; saveSettings(); renderSettings(); }
};
$('setWipe').onclick = async () => {
  if (!await confirmDelete('Delete All Documents?', 'Every document on this device will be permanently deleted.', 'Delete All')) return;
  await DB.clear(); localStorage.removeItem('folders'); activeFolder = ''; toast('All documents deleted'); renderSettings();
};
// ---------- OpenCV ----------
let cvReady = null;
// The OpenCV module object is "thenable": never return it from an async function. Wrap it as { cv }.
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
        const iv = setInterval(() => { if (ready()) { clearInterval(iv); res(); } else if (Date.now() - t0 > 90000) { clearInterval(iv); rej(new Error('Scanner engine didn’t load. Check your connection.')); } }, 150);
      });
    }
    return { cv: m };
  })().catch((e) => { cvReady = null; throw e; });
  return cvReady;
}
const openCamera = (opts) => startScan(opts);

// ---------- Vision worker client (OpenCV off the main thread; falls back to main thread) ----------
const VW = {
  w: null, failed: false, seq: 0, pend: new Map(), q: [], busy: false, wd: 0, restarts: 0,
  start() {
    if (this.w || this.failed) return;
    try {
      if (typeof OffscreenCanvas === 'undefined' || !OffscreenCanvas.prototype.convertToBlob) throw new Error('no OffscreenCanvas');
      this.w = new Worker('cvworker.js');
      this.w.onmessage = (e) => {
        const { id, ok, res, err, fatal, heap } = e.data; if (!id) return;
        if (heap) this.heap = heap;
        const p = this.pend.get(id);
        if (!ok && fatal && p) { console.warn('vision worker fatal: ' + err); clearTimeout(this.wd); return this.restart(p); } // fresh heap + retry once
        this.pend.delete(id); this.busy = false; clearTimeout(this.wd);
        if (p) (ok ? p.res(res) : p.rej(new Error(err)));
        this.pump();
      };
      this.w.onerror = (e) => { e.preventDefault && e.preventDefault(); console.warn('vision worker error', e.message); const j = [...this.pend.values()][0]; if (j) this.restart(j); else { try { this.w.terminate(); } catch {} this.w = null; } };
    } catch { this.failed = true; }
  },
  fail() {
    this.failed = true; try { this.w.terminate(); } catch {} this.w = null; this.busy = false;
    const err = new Error('__fallback__');
    for (const p of this.pend.values()) p.rej(err); this.pend.clear();
    this.q.splice(0).forEach((j) => j.rej(err));
  },
  /** prio: 0 = user is waiting (preview, detect), 1 = background (full-res precompute) */
  call(op, data, transfer = [], prio = 0) {
    this.start();
    if (this.failed) return Promise.reject(new Error('__fallback__'));
    return new Promise((res, rej) => {
      const job = { id: ++this.seq, op, data, transfer, prio, res, rej };
      const i = this.q.findIndex((j) => j.prio > prio); i < 0 ? this.q.push(job) : this.q.splice(i, 0, job);
      this.pump();
    });
  },
  pump() {
    if (this.busy || !this.q.length || !this.w) return;
    const j = this.q.shift(); this.busy = true; this.pend.set(j.id, j);
    // watchdog: a worker that was killed (memory pressure) or wedged gets replaced and the job retried once
    clearTimeout(this.wd);
    this.wd = setTimeout(() => this.restart(j), j.op === 'detect' ? 15000 : 30000);
    this.w.postMessage({ id: j.id, op: j.op, ...j.data });
  },
  restart(j) {
    console.warn('vision worker restarted');
    try { this.w.terminate(); } catch {}
    this.w = null; this.busy = false; this.pend.delete(j.id);
    if (++this.restarts > 4) { j.rej(new Error('__fallback__')); return this.fail(); }
    if (!j.retried) { j.retried = true; this.q.unshift(j); } else j.rej(new Error('The scanner took too long. Please try again.'));
    this.start(); this.pump();
  }
};
const isFallback = (e) => e && e.message === '__fallback__';
async function vDetect(canvas) {
  try {
    const { c, k } = Vision.scaled(canvas, 1000);
    const bmp = await createImageBitmap(c); if (c !== canvas) Vision.free(c);
    const d = await VW.call('detect', { src: bmp }); bmp.close();
    return d && { ...d, q: d.q.map((p) => ({ x: p.x / k, y: p.y / k })) };
  } catch (e) { if (!isFallback(e)) throw e; const { cv } = await loadCv(); const d = Vision.detect(cv, canvas); return d && Vision.fullFrame(d.q, canvas.width, canvas.height) ? null : d; }
}
/** detector-v2 refinement (worker). v2 corners are used directly; v1 is kept only if v2 errors, times out (>3 s) or returns null. */
async function vRefine(canvas, det) {
  if (!det) return det;
  try {
    const { c, k } = Vision.scaled(canvas, 2000);
    const bmp = await createImageBitmap(c); if (c !== canvas) Vision.free(c);
    const r = await Promise.race([VW.call('refine', { src: bmp, q: det.q.map((p) => ({ x: p.x * k, y: p.y * k })), votes: det.votes }), sleep(3000).then(() => { throw new Error('refine timeout'); })]);
    bmp.close && bmp.close();
    if (!r) return { ...det, v: 1 };
    if (r.noPage) return { ...det, v: 1, conf: r.conf, low: true }; // v2 sees no real page edges: keep v1 corners but ask the user to check
    const q = r.q.map((p) => ({ x: p.x / k, y: p.y / k }));
    if (Vision.fullFrame(q, canvas.width, canvas.height)) return { ...det, v: 1, conf: r.conf, low: isLow(r.conf, det) }; // hard rule: v2 may not grow to the frame
    return { ...det, q, conf: r.conf, v: 2, low: isLow(r.conf, det) };
  } catch (e) { return { ...det, v: 1 }; }
}
/** v1 detect + v2 refine: used after capture / import and by the crop editor. */
async function vDetectBest(canvas) { return vRefine(canvas, await vDetect(canvas)); }
/** → { orig: Blob, raw?: Blob } */
async function vWarp(canvas, q, rawQ) {
  try {
    const bmp = await createImageBitmap(canvas);
    const r = await VW.call('warp', { src: bmp, q, outLong: Vision.OUT_LONG, rawQ }); bmp.close(); return r;
  } catch (e) {
    if (!isFallback(e)) throw e;
    const { cv } = await loadCv(); const w = Vision.warp(cv, canvas, q);
    const out = { orig: await canvasToBlob(w, 0.92) }; if (rawQ) out.raw = await canvasToBlob(canvas, rawQ); Vision.free(w); return out;
  }
}
/** Filter a stored JPEG → JPEG Blob. maxLong caps size for previews. */
async function vFilter(blob, name, bc, maxLong, quality = 0.92, prio = 0) {
  try { return (await VW.call('filter', { src: blob, name, bc, maxLong, quality }, [], prio)).blob; }
  catch (e) {
    if (!isFallback(e)) throw e;
    const { cv } = await loadCv(); const c = await blobToCanvas(blob, maxLong); const o = Vision.filter(cv, c, name, bc);
    const b = await canvasToBlob(o, quality); Vision.free(c, o); return b;
  }
}

// ---------- Capture (native camera / Photos — full-res HEIC/JPEG) ----------
const FILTERS = [['original', 'Original'], ['magic', 'Magic Colour'], ['magic2', 'Vivid Colour'], ['white', 'Magic White'], ['bw', 'B&W'], ['gray', 'Grayscale']];
const NOTFOUND_HINT = 'Page not found, so the whole photo is used. Drag the corners or edges to adjust.';
const fullCorners = (c) => [{ x: 0, y: 0 }, { x: c.width, y: 0 }, { x: c.width, y: c.height }, { x: 0, y: c.height }];
async function startScan(opts = {}) {
  if (!opts.single && camOk() && settings.liveCam !== false) return openCam(true);
  const v = await menu(opts.single ? 'Add Photo' : 'New Scan', [
    { label: 'Camera', value: 'cam', icon: 'camera' },
    { label: 'Photos', value: 'lib', icon: 'photos' }],
  opts.single ? undefined : 'Uses the iPhone camera so every page is full resolution.');
  if (!v) return;
  const files = await pickFiles('image/*', v === 'lib' && !opts.single, v === 'cam' ? 'environment' : undefined);
  if (!files.length) return;
  if (opts.single) {
    const r = await photoToCrop(files[0]); if (!r) return;
    return startCrop(r.raw, {
      q: r.q, found: r.found, det: r.det, title: 'Adjust Corners',
      done: async (raw, q) => { busy('Straightening…'); let w = null; try { w = await warpDone(raw, q); } catch (e) { toast(e.message, 'err'); } busy(); opts.single(w); },
      cancel: () => opts.single(null)
    });
  }
  // multi-page batch: capture/pick many → every page auto-cropped in the background → review grid
  scan.pages = []; scan.i = 0; scan.returnTo = (curView === 'doc' || curView === 'page') && current ? current.id : null;
  scan.src = v; openBatch(); batchAdd(files);
}
async function photoToCrop(file) {
  busy('Opening photo…');
  try {
    const raw = await Vision.decode(file, 3000);
    busy();
    // detection runs in the worker while the crop screen is already visible
    const det = vDetectBest(raw).catch(() => null);
    return { raw, q: inset(raw), found: null, det };
  } catch (e) { busy(); toast('Couldn’t open that photo', 'err'); return null; }
}
const inset = (c) => { const dx = c.width * 0.08, dy = c.height * 0.08; return [{ x: dx, y: dy }, { x: c.width - dx, y: dy }, { x: c.width - dx, y: c.height - dy }, { x: dx, y: c.height - dy }]; };
/** Apply an async detection result to the crop screen if the user hasn't moved corners yet. */
function applyDetection(det, raw) {
  $('crop').classList.add('finding'); $('cropHint').textContent = 'Finding edges…';
  det.then((d) => {
    if (crop.canvas !== raw) return;
    $('crop').classList.remove('finding');
    if (crop.touched) return;
    if (d) { $('cropAuto').classList.remove('hl'); crop.corners = d.q; crop.opts && (crop.opts.found = true); $('cropHint').textContent = 'Drag the corners or edges to fine-tune'; }
    else { crop.corners = fullCorners(raw); $('cropHint').textContent = NOTFOUND_HINT; $('cropAuto').classList.add('hl'); }
    drawCrop();
  });
}
async function nextScanPhoto() {
  const f = scan.pending.shift();
  if (!f) return openReview();
  const r = await photoToCrop(f); if (!r) { if (scan.pending.length) return nextScanPhoto(); if (scan.pages.length) return openReview(); return; }
  startCrop(r.raw, {
    q: r.q, found: r.found, det: r.det,
    title: scan.pending.length ? `Page ${scan.pages.length + 1} · ${scan.pending.length} more` : `Page ${scan.pages.length + 1}`,
    retake: true,
    done: async (raw, q) => {
      busy('Straightening…');
      try {
        const w = await vWarp(raw, q, 0.88);
        scan.pages.push({
          raw: w.raw, quad: q.map((t) => ({ x: t.x / raw.width, y: t.y / raw.height })), orig: w.orig,
          filter: scan.pages.length ? scan.filter : (settings.filter || 'magic'), bc: null, text: '', _preview: null
        });
        Vision.free(raw);
      } catch (e) { toast(e.message, 'err'); }
      busy();
      if (scan.pending.length) return nextScanPhoto();
      openReview();
    },
    cancel: () => {
      Vision.free(r.raw);
      if (scan.pending.length) { toast('Photo skipped'); return nextScanPhoto(); }
      if (scan.pages.length) return openReview();
      if (scan.returnTo) return openDoc(scan.returnTo);
      show('home', 'down');
    }
  });
}
async function warpDone(raw, q) {
  const w = await vWarp(raw, q); Vision.free(raw); return blobToCanvas(w.orig);
}
const scan = { pages: [], i: 0, pending: [], returnTo: null, filter: 'magic', src: 'cam' };

// ---------- Batch scan (3.2): shoot/pick pages back-to-back, fix only the ones that need it ----------
let batchSeq = 0, batchUrls = [];
// batch thumbnails own their object URLs, so a home/doc re-render (which revokes its own) can't break them
const burl = (b) => { const u = URL.createObjectURL(b); batchUrls.push(u); return u; };
function freeBatchUrls() { const keep = new Set(scan.pages.map((p) => p._thumb)); batchUrls = batchUrls.filter((u) => keep.has(u) || (URL.revokeObjectURL(u), false)); }
const batchChain = { p: Promise.resolve() };
function batchAdd(files) {
  const had = scan.pages.length;
  for (const f of files) {
    const fast = f && f.fileP; // camera: { fileP: Promise<File>, thumb: dataURL, book } — the shutter never waits for JPEG encoding
    const pg = { id: ++batchSeq, status: 'proc', file: fast ? null : f, fileP: fast ? f.fileP : null, book: fast ? !!f.book : !!settings.book && scan.src === 'live', filter: scan.filter || settings.filter || 'magic', bc: null, text: '' };
    if (fast) pg._thumb = f.thumb; else try { pg._thumb = burl(f); } catch {}
    scan.pages.push(pg);
    // one page at a time in the worker, in capture order; the UI never waits on it
    batchChain.p = batchChain.p.then(() => processBatchPage(pg));
  }
  renderBatch(had > 0);
}
async function processBatchPage(pg) {
  if (!scan.pages.includes(pg)) return;
  const t0 = performance.now();
  let raw = null;
  try {
    if (!pg.file && pg.fileP) { pg.file = await pg.fileP; pg.fileP = null; }
    raw = await Vision.decode(pg.file, 3000); const t1 = performance.now();
    let det = null; try { det = await vDetect(raw); } catch {}
    if (det) { pg.stage = 'refine'; updateBatchTile(pg); det = await vRefine(raw, det); pg.v = det.v; pg.low = !!det.low; pg.conf = det.conf; }
    const t2 = performance.now(), q = Vision.order(det ? det.q : fullCorners(raw));
    const rel = (qq) => qq.map((t) => ({ x: t.x / raw.width, y: t.y / raw.height }));
    if (pg.book && det && scan.pages.includes(pg)) {
      // Book mode: split the spread at the spine (vertical centre of the quad) → left page, then right page
      const [qL, qR] = splitQuad(q, 0.5), spread = { quad: rel(q), t: 0.5 };
      const wl = await vWarp(raw, qL, 0.88), wr = await vWarp(raw, qR, 0.88);
      const pg2 = { id: ++batchSeq, status: 'ok', filter: pg.filter, bc: null, text: '', book: true, half: 'R', v: pg.v, low: pg.low, conf: pg.conf, auto: pg.auto,
        raw: wr.raw || wl.raw, quad: rel(qR), orig: wr.orig, found: true, spread, _thumb: burl(wr.orig) };
      Object.assign(pg, { half: 'L', spread, raw: wl.raw, quad: rel(qL), orig: wl.orig, found: true, status: 'ok', _thumb: burl(wl.orig) });
      scan.pages.splice(scan.pages.indexOf(pg) + 1, 0, pg2);
      pg.t = { decode: Math.round(t1 - t0), detect: Math.round(t2 - t1), warp: Math.round(performance.now() - t2) };
      freeBatchUrls(); delete pg.file;
      if (raw) Vision.free(raw); pg.ms = Math.round(performance.now() - t0);
      if (curView === 'batch') renderBatch(); else updateBatchTile(pg);
      return;
    }
    const w = await vWarp(raw, q, 0.88);
    pg.t = { decode: Math.round(t1 - t0), detect: Math.round(t2 - t1), warp: Math.round(performance.now() - t2) };
    Object.assign(pg, { raw: w.raw, quad: rel(q), orig: w.orig, found: !!det, status: 'ok', _thumb: burl(w.orig) });
    freeBatchUrls();
    delete pg.file;
  } catch (e) { console.warn('batch page failed', e && e.message); pg.status = 'err'; }
  if (raw) Vision.free(raw);
  pg.ms = Math.round(performance.now() - t0);
  updateBatchTile(pg);
}
function openBatch() {
  show('batch', curView === 'review' || (curView === 'cam' && navStack[navStack.length - 1] === 'batch') ? 'down' : 'up');
  renderBatch();
}
function batchTile(pg, i) {
  const img = el('img', { alt: `Page ${i + 1}`, src: pg._thumb || '', draggable: 'false' });
  const t = el('div', { class: 'bt' + (pg.status === 'proc' ? ' proc' : ''), 'data-id': pg.id, role: 'button', 'aria-label': `Page ${i + 1}, adjust crop` },
    img, el('span', { class: 'num' }, String(i + 1)),
    el('button', { class: 'del', 'aria-label': `Delete page ${i + 1}`, onclick: (e) => { e.stopPropagation(); batchDelete(pg); } }, el('span', {}, icon('x'))));
  if (pg.status === 'proc') t.append(el('div', { class: 'spin small' }), pg.stage === 'refine' ? el('span', { class: 'stage' }, 'Refining edges…') : null);
  else if (pg.status === 'err') t.append(el('span', { class: 'warn' }, 'Couldn’t read'));
  else if (!pg.found) t.append(el('span', { class: 'warn' }, 'Page not found'));
  else if (pg.low) t.append(el('i', { class: 'odot', 'aria-label': 'Check the corners' }));
  if (pg.override) t.append(el('span', { class: 'ov' }, FILTERS.find((f) => f[0] === pg.filter)?.[1] || ''));
  wireTile(t, pg);
  return t;
}
function renderBatch(scrollEnd) {
  const g = $('batGrid');
  const addT = el('button', { class: 'bt add', 'aria-label': 'Add pages from Photos', onclick: () => $('batPhotos').click() }, icon('plus'), 'Add Pages');
  g.replaceChildren(...scan.pages.map(batchTile), addT);
  updateBatchChrome();
  if (scrollEnd) requestAnimationFrame(() => g.scrollTo({ top: g.scrollHeight, behavior: 'smooth' }));
}
function updateBatchTile(pg) {
  if (curView === 'cam') renderTray(false);
  if (curView === 'crop') renderCropStrip();
  if (curView !== 'batch' && curView !== 'crop') return;
  const i = scan.pages.indexOf(pg), old = $('batGrid').querySelector(`[data-id="${pg.id}"]`);
  if (i < 0 || !old) return;
  const t = batchTile(pg, i); t.style.animation = 'none'; old.replaceWith(t); updateBatchChrome();
}
function updateBatchChrome() {
  const n = scan.pages.length, proc = scan.pages.filter((p) => p.status === 'proc').length;
  $('batTitle').textContent = n ? plural(n, 'Page') : 'Scan';
  $('batBanner').textContent = !n ? 'Tap the shutter to scan your first page'
    : proc ? `Auto-cropping ${proc} page${proc > 1 ? 's' : ''}… keep scanning`
    : scan.pages.some((p) => !p.found) ? 'Page not found on some photos, so the whole photo is used · tap to adjust'
    : n > 1 ? 'Tap a page to adjust its crop · hold to reorder' : 'Tap the page to adjust its crop';
  $('batNext').disabled = $('batDone').disabled = !n;
}
async function batchDelete(pg) {
  const t = $('batGrid').querySelector(`[data-id="${pg.id}"]`);
  haptic();
  scan.pages = scan.pages.filter((p) => p !== pg); if (pg.spread) scan.pages.forEach((p) => { if (p.spread === pg.spread) p.spread = null; });
  if (t) { t.style.transition = 'transform .22s ease, opacity .22s'; t.style.transform = 'scale(.6)'; t.style.opacity = 0; await new Promise((r) => setTimeout(r, 200)); }
  freeBatchUrls(); renderBatch();
}
/** Long-press (280ms) lifts a tile; drag to reorder. Plain tap opens the crop editor. */
function wireTile(t, pg) {
  let timer = 0, lifted = false, sx = 0, sy = 0, moved = false, pid = null;
  t.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.del')) return;
    sx = e.clientX; sy = e.clientY; moved = false; lifted = false; pid = e.pointerId;
    timer = setTimeout(() => { if (scan.pages.length < 2) return; lifted = true; haptic(); t.classList.add('lift'); try { t.setPointerCapture(pid); } catch {} }, 280);
  });
  t.addEventListener('pointermove', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!lifted) { if (Math.hypot(dx, dy) > 8) { moved = true; clearTimeout(timer); } return; }
    e.preventDefault(); t.style.transform = `translate(${dx}px,${dy}px) scale(1.08)`;
    const tiles = [...$('batGrid').querySelectorAll('.bt:not(.add)')];
    const over = tiles.find((o) => { if (o === t) return false; const r = o.getBoundingClientRect(); return e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom; });
    if (over) {
      const from = scan.pages.indexOf(pg), to = scan.pages.findIndex((p) => String(p.id) === over.dataset.id);
      scan.pages.splice(from, 1); scan.pages.splice(to, 0, pg); haptic();
      const r0 = t.getBoundingClientRect();
      if (to > from) over.after(t); else over.before(t);
      const r1 = t.getBoundingClientRect(); sx += r1.left - r0.left; sy += r1.top - r0.top;
      t.style.transform = `translate(${e.clientX - sx}px,${e.clientY - sy}px) scale(1.08)`;
      [...$('batGrid').querySelectorAll('.bt:not(.add) .num')].forEach((n, i) => (n.textContent = i + 1));
    }
  });
  const end = (e) => {
    clearTimeout(timer);
    if (lifted) { lifted = false; t.classList.remove('lift'); t.style.transform = ''; renderBatch(); return; }
    if (e.type === 'pointerup' && !moved && !e.target.closest('.del')) batchCrop(pg);
  };
  t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
  t.addEventListener('contextmenu', (e) => e.preventDefault());
  t.addEventListener('touchmove', (e) => { if (lifted) e.preventDefault(); }, { passive: false }); // keep the grid from scrolling mid-drag
}
const LOWCONF_HINT = 'Check the corners';
/** Book mode: split a spread quad [TL,TR,BR,BL] at spine fraction t (0.5 = vertical centre) → [left, right]. */
function splitQuad(q, t = 0.5) {
  const L = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }), [TL, TR, BR, BL] = q, MT = L(TL, TR), MB = L(BL, BR);
  return [[TL, MT, MB, BL], [MT, TR, BR, MB]];
}
/** Crop editor for a scanned page. 3.3.1: filmstrip of all pages under the image — tap to jump, Next = next page, the last
 *  page's Done goes on to the filter screen. Pages are only re-warped when their corners were actually moved. */
async function batchCrop(pg) {
  if (pg.status === 'proc') { busy('Finishing auto-crop…'); while (pg.status === 'proc') await new Promise((r) => setTimeout(r, 60)); busy(); }
  if (pg.status === 'err' || !pg.raw) return toast('Couldn’t read that photo — delete it and try again', 'err');
  const idx = scan.pages.indexOf(pg); if (idx < 0) return;
  // Book-mode halves share one spread: edit the whole spread with a draggable spine, re-split both pages on Next
  const halves = pg.spread ? scan.pages.filter((p) => p.spread === pg.spread) : [pg];
  const pair = halves.length === 2 ? halves : null, lastIdx = scan.pages.indexOf((pair || [pg])[(pair || [pg]).length - 1]);
  const raw = await blobToCanvas(pg.raw), n = scan.pages.length, last = lastIdx === n - 1;
  const q = (pair ? pg.spread.quad : pg.quad).map((t) => ({ x: t.x * raw.width, y: t.y * raw.height }));
  const i0 = scan.pages.indexOf((pair || [pg])[0]);
  const o = {
    q, found: pg.found, low: pg.found && (pair ? pair.some((p) => p.low) : pg.low), retake: true, spine: pair ? pg.spread.t : null,
    title: pair ? `Pages ${i0 + 1}–${i0 + 2} of ${n}` : n > 1 ? `Page ${idx + 1} of ${n}` : 'Adjust Corners',
    doneLabel: last ? 'Done' : 'Next', strip: { cur: pg, pair },
    retakeFn: camOk() && settings.liveCam !== false ? () => { Vision.free(raw); crop.opts = null; crop.canvas = null; CAM.replace = pg; (pair || []).forEach((h) => { h.spread = null; }); openCam(false); } : null,
    done: async (r, qq, info = {}) => {
      if (info.touched && pair) {
        busy('Straightening…');
        try {
          const t = crop.lastSpine != null ? crop.lastSpine : pg.spread.t, [qL, qR] = splitQuad(qq, t), rl = (x) => x.map((p) => ({ x: p.x / r.width, y: p.y / r.height }));
          const sp = { quad: rl(qq), t };
          for (const [h, qh] of [[pair[0], qL], [pair[1], qR]]) {
            const w = await vWarp(r, qh, 0.88);
            Object.assign(h, { raw: w.raw, quad: rl(qh), orig: w.orig, found: true, low: false, spread: sp, _thumb: burl(w.orig), _previews: null, _origUrl: null, _final: null, _finalF: null, _pblobs: null });
          }
        } catch (e) { toast(e.message, 'err'); }
        busy(); freeBatchUrls();
      } else if (info.touched) {
        busy('Straightening…');
        try {
          const w = await vWarp(r, qq, 0.88);
          Object.assign(pg, { raw: w.raw, quad: qq.map((t) => ({ x: t.x / r.width, y: t.y / r.height })), orig: w.orig, found: true, low: false, _thumb: burl(w.orig), _previews: null, _origUrl: null, _final: null, _finalF: null, _pblobs: null });
        } catch (e) { toast(e.message, 'err'); }
        busy(); freeBatchUrls();
      }
      Vision.free(r);
      const go = o.jump != null ? scan.pages[o.jump] : scan.pages[scan.pages.indexOf((pair || [pg])[(pair || [pg]).length - 1]) + 1];
      if (go && !(pair || [pg]).includes(go)) return batchCrop(go);
      if (o.jump == null && scan.pages.length) return batchNext(); // last page → filter screen
      show('batch', 'down'); renderBatch();
    },
    cancel: () => { show('batch', 'down'); renderBatch(); }
  };
  startCrop(raw, o);
}
function renderCropStrip() {
  const box = $('cropStrip'), o = crop.opts, st = o && o.strip;
  box.hidden = !st || scan.pages.length < 1;
  if (box.hidden) return box.replaceChildren();
  const tiles = scan.pages.map((p, i) => {
    const on = p === st.cur || !!(st.pair && st.pair.includes(p));
    const b = el('button', { class: on ? 'on' : '', role: 'tab', 'aria-selected': String(on), 'aria-label': `Page ${i + 1}${p.low ? ', check corners' : ''}`,
      onclick: () => { if (on || !crop.opts) return; haptic(); crop.opts.jump = i; $('cropDone').onclick(); } },
      el('img', { alt: '', src: p._thumb || '', draggable: 'false' }), el('span', { class: 'n' }, String(i + 1)));
    if (p.status === 'ok' && (p.low || !p.found)) b.append(el('i', { class: 'dot' }));
    return b;
  });
  const add = el('button', { class: 'add', 'aria-label': 'Add pages', onclick: () => {
    if (!crop.opts) return; const c = crop.canvas; crop.opts = null; crop.canvas = null; if (c) Vision.free(c);
    camOk() && settings.liveCam !== false ? openCam(false) : (show('batch', 'down'), renderBatch(), $('batPhotos').click());
  } }, icon('plus'));
  box.replaceChildren(...tiles, add);
  const cur = box.querySelector('.on'); if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
}
async function batchLeave() {
  const n = scan.pages.length;
  if (n) {
    const v = await alertBox({ title: 'Discard this scan?', message: `${plural(n, 'page')} ${n > 1 ? 'haven’t' : 'hasn’t'} been saved yet.`, actions: [{ label: 'Keep Scanning', value: false, style: 'b' }, { label: 'Discard', value: true, style: 'd' }] });
    if (!v) return;
  }
  scan.pages = []; freeBatchUrls(); scan.returnTo ? openDoc(scan.returnTo) : show('home', 'down');
}
async function batchNext() {
  if (!scan.pages.length) return;
  if (scan.pages.some((p) => p.status === 'proc')) {
    busy('Finishing auto-crop…'); await batchChain.p; busy();
  }
  const bad = scan.pages.filter((p) => p.status === 'err');
  if (bad.length) { scan.pages = scan.pages.filter((p) => p.status !== 'err'); toast(`${plural(bad.length, 'photo')} couldn’t be read and ${bad.length > 1 ? 'were' : 'was'} skipped`, 'err'); }
  if (!scan.pages.length) return renderBatch();
  scan.i = 0; openReview();
}
$('batCancel').onclick = batchLeave;
$('batNext').onclick = batchNext; $('batDone').onclick = batchNext;
$('batCam').onclick = async () => { if (camOk() && settings.liveCam !== false) return openCam(false); const f = await pickFiles('image/*', false, 'environment'); if (f.length) batchAdd(f); };
$('batPhotos').onclick = async () => { const f = await pickFiles('image/*', true); if (f.length) batchAdd(f); };

// ---------- Crop editor (always shown; loupe while dragging) ----------
const crop = { canvas: null, corners: null, drag: -1, disp: 1, opts: null };
async function startCrop(canvas, opts = {}) {
  $('cropAuto').classList.toggle('hl', opts.found === false);
  crop.canvas = canvas; crop.opts = opts; crop.touched = false; crop.spine = opts.spine != null ? opts.spine : null; crop.lastSpine = null; crop.corners = opts.q ? opts.q.map((p) => ({ ...p })) : fullCorners(canvas);
  $('cropTitle').textContent = opts.title || 'Adjust Corners';
  $('cropHint').textContent = opts.found === false ? NOTFOUND_HINT : opts.low ? LOWCONF_HINT : 'Drag the corners or edges to fine-tune';
  $('cropHint').classList.toggle('warn', opts.found === false || !!opts.low);
  $('cropAuto').classList.toggle('hl', opts.found === false || !!opts.low);
  $('cropDone').textContent = opts.doneLabel || 'Next';
  renderCropStrip();
  $('cropRetake').style.display = opts.retake ? '' : 'none';
  $('loupe').classList.remove('on'); $('crop').classList.remove('finding');
  if (curView !== 'crop') show('crop', 'up');
  requestAnimationFrame(drawCrop);
  if (opts.det) applyDetection(opts.det, canvas);
}
function drawCrop() {
  const cc = $('cropCanvas'), src = crop.canvas; if (!src) return;
  if (cc.width !== src.width || cc.height !== src.height) { cc.width = src.width; cc.height = src.height; }
  const ctx = cc.getContext('2d'); ctx.drawImage(src, 0, 0);
  const rect = cc.getBoundingClientRect();
  crop.disp = rect.width ? src.width / rect.width : 1;
  const q = crop.corners, d = crop.disp;
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath();
  ctx.rect(0, 0, cc.width, cc.height); ctx.moveTo(q[0].x, q[0].y);
  [3, 2, 1].forEach((i) => ctx.lineTo(q[i].x, q[i].y)); ctx.closePath(); ctx.fill('evenodd');
  ctx.strokeStyle = '#2dd4bf'; ctx.lineWidth = 2.5 * d; ctx.lineJoin = 'round'; ctx.beginPath();
  q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
  for (let k = 0; k < 4; k++) { // edge midpoint handles: white capsules aligned with the edge
    const a = q[k], b = q[(k + 1) % 4], m = edgeMid(q, k), on = crop.drag === 4 + k;
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
    const hw = (on ? 18 : 14) * d, hh = (on ? 4.5 : 3.5) * d;
    ctx.beginPath(); ctx.roundRect(-hw, -hh, hw * 2, hh * 2, hh);
    ctx.fillStyle = on ? '#2dd4bf' : '#fff'; ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 6 * d; ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = 2 * d; ctx.strokeStyle = on ? '#fff' : '#2dd4bf'; ctx.stroke(); ctx.restore();
  }
  if (crop.spine != null) { // Book mode: dashed teal spine where the spread is split, with a draggable grip
    const [a, b] = spineLine(q, crop.spine), on = crop.drag === 8, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.save(); ctx.setLineDash([7 * d, 6 * d]); ctx.lineWidth = 2 * d; ctx.strokeStyle = '#2dd4bf'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
    const hw = (on ? 18 : 14) * d, hh = (on ? 4.5 : 3.5) * d;
    ctx.beginPath(); ctx.roundRect(-hw, -hh, hw * 2, hh * 2, hh); ctx.fillStyle = on ? '#2dd4bf' : '#fff'; ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 6 * d; ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = 2 * d; ctx.strokeStyle = on ? '#fff' : '#2dd4bf'; ctx.stroke(); ctx.restore();
  }
  q.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(p.x, p.y, (crop.drag === i ? 13 : 10) * d, 0, 7);
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 8 * d; ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = 2.5 * d; ctx.strokeStyle = '#2dd4bf'; ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, 3 * d, 0, 7); ctx.fillStyle = '#2dd4bf'; ctx.fill();
  });
}
function drawLoupe(p) {
  const L = $('loupe'), r = 80, zoom = 2.4, src = crop.canvas;
  const ctx = L.getContext('2d'); ctx.clearRect(0, 0, 240, 240);
  ctx.save(); ctx.beginPath(); ctx.arc(120, 120, 110, 0, 7); ctx.clip();
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 240, 240);
  ctx.drawImage(src, p.x - r / zoom, p.y - r / zoom, (2 * r) / zoom, (2 * r) / zoom, 0, 0, 240, 240);
  ctx.restore();
  ctx.strokeStyle = '#2dd4bf'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(120, 120, 110, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(110, 120); ctx.lineTo(130, 120); ctx.moveTo(120, 110); ctx.lineTo(120, 130);
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.stroke();
  // position above the finger
  const wrap = $('cropWrap').getBoundingClientRect(), cc = $('cropCanvas').getBoundingClientRect();
  const sx = cc.left + p.x / crop.disp, sy = cc.top + p.y / crop.disp;
  let lx = sx - wrap.left - 60, ly = sy - wrap.top - 150;
  if (ly < 8) ly = sy - wrap.top + 40; // finger near the top: show the loupe below it so it never hides the corner
  lx = Math.max(8, Math.min(wrap.width - 128, lx)); ly = Math.max(8, Math.min(wrap.height - 140, ly));
  L.style.transform = `translate(${lx}px,${ly}px)`; L.classList.add('on');
}
function canvasPoint(e) { const cc = $('cropCanvas'), r = cc.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cc.width / r.width), y: (e.clientY - r.top) * (cc.height / r.height) }; }
// Hit targets: corners (index 0-3) and edge midpoints (4-7, edge k joins corner k and k+1). ≥44pt each.
const spineLine = (q, t) => [{ x: q[0].x + (q[1].x - q[0].x) * t, y: q[0].y + (q[1].y - q[0].y) * t }, { x: q[3].x + (q[2].x - q[3].x) * t, y: q[3].y + (q[2].y - q[3].y) * t }];
const spineMid = (q, t) => { const [a, b] = spineLine(q, t); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
const edgeMid = (q, k) => { const a = q[k], b = q[(k + 1) % 4]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
function quadValid(q) {
  // convex, non-self-intersecting, not degenerate (consistent turn direction + min area)
  let sgn = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-6) return false;
    if (!sgn) sgn = Math.sign(z); else if (Math.sign(z) !== sgn) return false;
  }
  const area = Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % 4]; return s + p.x * n.y - n.x * p.y; }, 0)) / 2;
  const minSide = 40 * crop.disp;
  for (let i = 0; i < 4; i++) { const n = q[(i + 1) % 4]; if (Math.hypot(n.x - q[i].x, n.y - q[i].y) < minSide) return false; }
  return area > minSide * minSide;
}
const clampPt = (p, c) => ({ x: Math.max(0, Math.min(c.width, p.x)), y: Math.max(0, Math.min(c.height, p.y)) });
$('cropCanvas').addEventListener('pointerdown', (e) => {
  if (!crop.canvas) return;
  const p = canvasPoint(e), q = crop.corners; let best = -1, bd = 34 * crop.disp; // 68pt-wide corner targets
  q.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = i; } });
  if (best < 0) { bd = 30 * crop.disp; for (let k = 0; k < 4; k++) { const m = edgeMid(q, k), d = Math.hypot(m.x - p.x, m.y - p.y); if (d < bd) { bd = d; best = 4 + k; } } }
  if (crop.spine != null) { const m = spineMid(q, crop.spine), d = Math.hypot(m.x - p.x, m.y - p.y), dm = 30 * crop.disp;
    if (d < dm && (best < 0 || best >= 4)) best = 8; else if (best < 0) { const [a, b] = spineLine(q, crop.spine), ex = b.x - a.x, ey = b.y - a.y, L2 = ex * ex + ey * ey || 1, u = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / L2)); if (Math.hypot(a.x + ex * u - p.x, a.y + ey * u - p.y) < 22 * crop.disp) best = 8; } }
  crop.drag = best; if (best < 0) return;
  crop.touched = true; crop.start = { p, q: q.map((t) => ({ ...t })), t: crop.spine };
  e.target.setPointerCapture(e.pointerId); haptic(); drawCrop(); drawLoupe(dragPoint());
});
const dragPoint = () => (crop.drag === 8 ? spineMid(crop.corners, crop.spine) : crop.drag < 4 ? crop.corners[crop.drag] : edgeMid(crop.corners, crop.drag - 4));
$('cropCanvas').addEventListener('pointermove', (e) => {
  if (crop.drag < 0 || !crop.canvas) return;
  const p = canvasPoint(e), c = crop.canvas, s = crop.start;
  if (crop.drag === 8) { // spine: slide along the spread's width (average of top and bottom edges), kept between 20% and 80%
    const q = crop.corners, ux = (q[1].x - q[0].x + q[2].x - q[3].x) / 2, uy = (q[1].y - q[0].y + q[2].y - q[3].y) / 2, L2 = ux * ux + uy * uy || 1;
    crop.spine = crop.lastSpine = Math.max(0.2, Math.min(0.8, s.t + ((p.x - s.p.x) * ux + (p.y - s.p.y) * uy) / L2));
    drawCrop(); drawLoupe(dragPoint()); return;
  }
  let nq = crop.corners.map((t) => ({ ...t }));
  if (crop.drag < 4) nq[crop.drag] = clampPt({ x: s.q[crop.drag].x + p.x - s.p.x, y: s.q[crop.drag].y + p.y - s.p.y }, c);
  else {
    // edge drag: slide both corners of the edge along its normal (the line moves parallel to itself)
    const k = crop.drag - 4, i = k, j = (k + 1) % 4, a = s.q[i], b = s.q[j];
    const ex = b.x - a.x, ey = b.y - a.y, L = Math.hypot(ex, ey) || 1, nx = -ey / L, ny = ex / L;
    let t = (p.x - s.p.x) * nx + (p.y - s.p.y) * ny;
    // clamp t so both corners stay inside the image (keeps the edge parallel instead of bending it)
    const lim = (v, d, max) => (d > 1e-9 ? [(0 - v) / d, (max - v) / d] : d < -1e-9 ? [(max - v) / d, (0 - v) / d] : [-Infinity, Infinity]);
    let lo = -Infinity, hi = Infinity;
    for (const P of [a, b]) { const [l1, h1] = lim(P.x, nx, c.width), [l2, h2] = lim(P.y, ny, c.height); lo = Math.max(lo, l1, l2); hi = Math.min(hi, h1, h2); }
    t = Math.max(lo, Math.min(hi, t));
    nq[i] = { x: a.x + nx * t, y: a.y + ny * t }; nq[j] = { x: b.x + nx * t, y: b.y + ny * t };
  }
  if (!quadValid(nq)) return; // refuse moves that would fold the frame; the handle just stops
  crop.corners = nq; drawCrop(); drawLoupe(dragPoint());
});
['pointerup', 'pointercancel'].forEach((t) => $('cropCanvas').addEventListener(t, () => { crop.drag = -1; $('loupe').classList.remove('on'); if (crop.canvas) drawCrop(); }));
$('cropReset').onclick = () => { crop.corners = fullCorners(crop.canvas); crop.touched = true; drawCrop(); $('cropHint').textContent = 'No crop · the whole photo is used'; haptic(); };
$('cropAuto').onclick = async () => {
  $('crop').classList.add('finding'); $('cropHint').textContent = 'Finding edges…';
  try { const det = await vDetectBest(crop.canvas); $('crop').classList.remove('finding'); $('cropHint').textContent = 'Drag the corners or edges to fine-tune'; if (det) { $('cropAuto').classList.remove('hl'); crop.corners = det.q; drawCrop(); toast('Edges found'); } else toast('Page not found · drag the corners or edges', 'err'); }
  catch (e) { $('crop').classList.remove('finding'); toast(e.message, 'err'); }
};
$('cropRotate').onclick = () => {
  const H0 = crop.canvas.height;
  crop.corners = Vision.order(crop.corners.map((p) => ({ x: H0 - p.y, y: p.x })));
  crop.canvas = rotateCanvas(crop.canvas); drawCrop();
};
$('cropRetake').onclick = async () => {
  if (crop.opts && crop.opts.retakeFn) return crop.opts.retakeFn();
  const files = await pickFiles('image/*', false, 'environment'); if (!files.length) return;
  const r = await photoToCrop(files[0]); if (!r) return;
  Vision.free(crop.canvas); crop.canvas = r.raw; crop.corners = r.q; crop.touched = false;
  drawCrop(); applyDetection(r.det, r.raw);
};
$('cropCancel').onclick = () => {
  const o = crop.opts; crop.opts = null; Vision.free(crop.canvas); crop.canvas = null;
  (o && o.cancel) ? o.cancel() : show('home', 'down');
};
$('cropDone').onclick = async () => {
  if (!crop.opts || !crop.canvas) return;
  if (crop.opts.det && !crop.touched && $('crop').classList.contains('finding')) { // tapped before edges arrived
    busy('Finding edges…'); const d = await crop.opts.det; busy(); if (d && !crop.touched) crop.corners = d.q;
  }
  const o = crop.opts, raw = crop.canvas, q = Vision.order(crop.corners);
  crop.opts = null; crop.canvas = null;
  if (o && o.done) return o.done(raw, q, { touched: crop.touched || o.dirty });
  show('home', 'down');
};
window.addEventListener('resize', () => { if (curView === 'crop') drawCrop(); if (curView === 'place') drawPlace(); });

// ---------- Filter review (applied to all pages) ----------
async function openReview() {
  if (!scan.pages.length) return show('home', 'down');
  scan.i = Math.min(scan.i, scan.pages.length - 1);
  scan.filter = scan.pages[0].filter || settings.filter || 'magic'; if (!scan.pages.some((p) => p.override)) revScope('all');
  // coming back from a re-crop launched on this screen → slide down, don't stack another entry
  show('review', curView === 'crop' && navStack[navStack.length - 1] === 'review' ? 'down' : 'up');
  renderReviewFilters();
  await showReviewPage();
}
function renderReviewFilters() {
  const box = $('revFilters');
  box.replaceChildren(...FILTERS.map(([f, label]) => el('button', {
    class: 'flt' + ((scan.pages[scan.i] || {}).filter === f ? ' on' : ''),
    onclick: () => setReviewFilter(f)
  }, el('span', { class: 'p', style: `background-image:url(${f === 'original' ? '' : ''})` }), label)));
  // generate tiny previews from first page
  (renderReviewFilters.urls || []).forEach(URL.revokeObjectURL); const mine = (renderReviewFilters.urls = []);
  (async () => {
    try {
      const base = await canvasToBlob(await blobToCanvas(scan.pages[0].orig, 180), 0.85);
      for (let i = 0; i < FILTERS.length; i++) {
        const b = await vFilter(base, FILTERS[i][0], null, 180, 0.7);
        if (renderReviewFilters.urls !== mine) return; // a newer render took over
        const u = URL.createObjectURL(b); mine.push(u); box.children[i].querySelector('.p').style.backgroundImage = `url(${u})`;
      }
    } catch {}
  })();
}
async function showReviewPage() {
  const p = scan.pages[scan.i];
  $('revCount').textContent = `${scan.i + 1} / ${scan.pages.length}`;
  $('revNote').textContent = scan.pages.length > 1 ? (scan.scope === 'one' ? `Only page ${scan.i + 1} changes` : 'Filter will be applied to all pages (can be changed later)') : 'Choose a look · can be changed later';
  $('revScope').hidden = scan.pages.length < 2;
  [...$('revFilters').children].forEach((b, i) => b.classList.toggle('on', FILTERS[i][0] === p.filter));
  $('revPrev').disabled = scan.i === 0; $('revNext').disabled = scan.i === scan.pages.length - 1;
  const f = p.filter || scan.filter, tok = (showReviewPage.tok = (showReviewPage.tok || 0) + 1);
  p._previews = p._previews || {};
  if (!p._previews[f]) {
    // instant feedback: keep the current image visible (dimmed) with a spinner; never block the UI
    if (!p._origUrl) p._origUrl = url(p.orig);
    if (!$('revImg').src || $('revImg').dataset.page !== String(scan.i)) { $('revImg').src = p._origUrl; $('revImg').dataset.page = scan.i; }
    $('revSpin').hidden = false; $('revImg').style.opacity = 0.55;
    try { const b = await vFilter(p.orig, f, null, 1200, 0.85); (p._pblobs = p._pblobs || {})[f] = b; p._previews[f] = url(b); }
    catch (e) { toast(e.message, 'err'); }
  }
  if (tok !== showReviewPage.tok) return; // user moved on
  if (p._previews[f]) { $('revImg').src = p._previews[f]; $('revImg').dataset.page = scan.i; }
  $('revSpin').hidden = true; $('revImg').style.opacity = 1;
  schedulePrecompute();
}
// Background: render full-res final pages for the chosen filter so Save is instant; also warm other looks' previews.
let preT = 0;
function schedulePrecompute() { clearTimeout(preT); preT = setTimeout(precomputeNext, 250); }
async function precomputeNext() {
  if (curView !== 'review' || !scan.pages.length) return;
  const p = scan.pages.find((x) => x._finalF !== x.filter || !x._final);
  if (p) {
    const f = p.filter;
    try { const b = await vFilter(p.orig, f, p.bc, null, 0.92, 1); if (p.filter === f && scan.pages.includes(p)) { p._final = b; p._finalF = f; } } catch {}
    return schedulePrecompute();
  }
  const cur = scan.pages[scan.i]; if (!cur) return;
  const miss = FILTERS.map(([k]) => k).find((k) => !(cur._previews || {})[k]);
  if (miss) { try { const b = await vFilter(cur.orig, miss, null, 1200, 0.85, 1); cur._previews = cur._previews || {}; cur._previews[miss] = url(b); (cur._pblobs = cur._pblobs || {})[miss] = b; } catch {} schedulePrecompute(); }
}
function revScope(s) { scan.scope = s; $('revScope').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === s)); }
$('revScope').querySelectorAll('button').forEach((b) => (b.onclick = () => { revScope(b.dataset.s); haptic(); showReviewPage(); }));
async function setReviewFilter(f) {
  const cur = scan.pages[scan.i];
  if (scan.scope === 'one' && scan.pages.length > 1) { if (cur.filter === f) return; cur.filter = f; cur.override = true; }
  else { if (scan.filter === f && scan.pages.every((p) => p.filter === f)) return; scan.filter = f; scan.pages.forEach((p) => { p.filter = f; p.override = false; }); }
  [...$('revFilters').children].forEach((b, i) => b.classList.toggle('on', FILTERS[i][0] === f));
  haptic();
  await showReviewPage();
}
$('revPrev').onclick = () => { if (scan.i > 0) { scan.i--; showReviewPage(); } };
$('revNext').onclick = () => { if (scan.i < scan.pages.length - 1) { scan.i++; showReviewPage(); } };
$('revBack').onclick = () => openBatch();
/** Leaving the review screen without saving always asks first (C1). */
async function reviewLeave() {
  const n = scan.pages.length;
  const v = await alertBox({ title: 'Discard this scan?', message: `${plural(n, 'page')} ${n > 1 ? 'haven’t' : 'hasn’t'} been saved yet.`, actions: [{ label: 'Keep Scanning', value: false, style: 'b' }, { label: 'Discard', value: true, style: 'd' }] });
  if (!v) return;
  scan.pages = []; scan.returnTo ? openDoc(scan.returnTo) : show('home', 'down');
}
async function recropReview(idx) {
  const p = scan.pages[idx]; if (!p) return;
  const raw = await blobToCanvas(p.raw);
  const q = p.quad.map((t) => ({ x: t.x * raw.width, y: t.y * raw.height }));
  startCrop(raw, {
    q, found: true, title: scan.pages.length > 1 ? `Re-Crop Page ${idx + 1}` : 'Re-Crop', retake: true,
    done: async (r, qq) => {
      busy('Straightening…');
      try {
        const w = await vWarp(r, qq, 0.88);
        Object.assign(p, { raw: w.raw, quad: qq.map((t) => ({ x: t.x / r.width, y: t.y / r.height })), orig: w.orig, _previews: null, _origUrl: null, _final: null, _finalF: null });
        Vision.free(r);
      } catch (e) { toast(e.message, 'err'); }
      busy(); scan.i = idx; openReview();
    },
    cancel: () => { scan.i = idx; openReview(); } // pages untouched
  });
}
$('revAdd').onclick = async () => {
  const files = await pickFiles('image/*', true);
  if (!files.length) return;
  openBatch(); batchAdd(files);
};
$('revCrop').onclick = () => recropReview(scan.i);
$('revRotate').onclick = async () => {
  const p = scan.pages[scan.i]; busy('Rotating…');
  try {
    p.raw = await canvasToBlob(rotateCanvas(await blobToCanvas(p.raw)), 0.88);
    p.orig = await canvasToBlob(rotateCanvas(await blobToCanvas(p.orig)), 0.92);
    if (p.quad) p.quad = Vision.order(p.quad.map((t) => ({ x: 1 - t.y, y: t.x })));
    p._previews = null; p._origUrl = null; p._final = null; p._finalF = null;
  } catch (e) { toast(e.message, 'err'); }
  busy(); showReviewPage();
};
$('revDel').onclick = async () => {
  if (scan.pages.length === 1) {
    if (!await confirmDelete('Discard this scan?', 'Nothing has been saved yet.')) return;
    scan.pages = []; return scan.returnTo ? openDoc(scan.returnTo) : show('home', 'down');
  }
  scan.pages.splice(scan.i, 1); if (scan.i >= scan.pages.length) scan.i = scan.pages.length - 1;
  showReviewPage();
};
$('revDone').onclick = async () => {
  busy(`Saving ${scan.pages.length} page${scan.pages.length > 1 ? 's' : ''}…`);
  try {
    // Save instantly: pages whose full-res render isn't ready yet use the on-screen preview for a moment
    // and are finished in the background (and on next launch, if the app is closed first).
    clearTimeout(preT); VW.q = VW.q.filter((j) => (j.prio === 0 ? true : (j.rej(new Error('cancelled')), false))); // drop background previews
    const pages = scan.pages.map((p) => {
      const f = p.filter || scan.filter, ready = p._final && p._finalF === f;
      const img = ready ? p._final : ((p._pblobs || {})[f] || p.orig);
      return { pid: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), raw: p.raw, quad: p.quad, orig: p.orig, img, filter: f, bc: p.bc || null, text: '', ...(ready ? {} : { pending: true }) };
    });
    settings.filter = scan.filter; saveSettings(); revScope('all');
    let doc;
    if (scan.returnTo) {
      doc = await DB.get(scan.returnTo);
      doc.pages.push(...pages); doc.updated = Date.now(); await DB.put(doc);
    } else {
      doc = await newDoc(await defaultName(), pages);
    }
    scan.pages = []; freeBatchUrls(); current = doc; busy(); await openDoc(doc.id);
    toast(scan.returnTo ? `Added to “${doc.name}”` : 'Saved');
    finishPending(doc.id);
  } catch (e) { busy(); toast('Couldn’t save: ' + e.message, 'err'); }
};

// ---------- Text (OCR) ----------
function setOcrLang(v) { document.querySelectorAll('#ocrLang button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }
document.querySelectorAll('#ocrLang button').forEach((b) => (b.onclick = () => { setOcrLang(b.dataset.v); runOcr(b.dataset.v); }));
const pagesText = (only) => current.pages.map((p, i) => (only != null && i !== only) ? '' : (p.text ? (current.pages.length > 1 && only == null ? `Page ${i + 1}\n` : '') + p.text : '')).filter(Boolean).join('\n\n');
function openOcr(onlyPage) {
  openOcr.only = onlyPage;
  setOcrLang(settings.lang);
  $('ocrText').textContent = pagesText(onlyPage);
  show('ocr');
  const p = onlyPage == null ? current.pages : [current.pages[onlyPage]];
  if (!p.some((x) => x.text)) setTimeout(() => runOcr(settings.lang), 350);
}
async function runOcr(lang) {
  try {
    busy('Getting ready…');
    await loadScript('vendor/tesseract.min.js');
    const idxs = openOcr.only == null ? current.pages.map((_, i) => i) : [openOcr.only];
    const abs = (u) => new URL(u, location.href).href;
    const worker = await Tesseract.createWorker(lang, 1, { workerPath: abs('vendor/tesseract/worker.min.js'), corePath: abs('vendor/tesseract/'), langPath: abs('vendor/tesseract/lang'), workerBlobURL: false, logger: (m) => { if (m.status === 'recognizing text') busy(`Reading${idxs.length > 1 ? ` page ${(runOcr.i || 0) + 1} of ${idxs.length}` : ''}… ${Math.round(m.progress * 100)}%`); } });
    for (let k = 0; k < idxs.length; k++) {
      runOcr.i = k;
      const { data } = await worker.recognize(current.pages[idxs[k]].img);
      current.pages[idxs[k]].text = data.text.trim();
    }
    await worker.terminate(); await DB.put(current);
    const t = pagesText(openOcr.only); $('ocrText').textContent = t;
    busy(); toast(t ? 'Text found · now searchable' : 'No text found', t ? 'ok' : 'err');
  } catch (e) { busy(); toast('Couldn’t read text. ' + (navigator.onLine ? '' : 'Open DocSnap once online so text reading is saved for offline use.'), 'err'); }
}
$('ocrRun').onclick = () => runOcr(document.querySelector('#ocrLang .on')?.dataset.v || settings.lang);
$('ocrCopy').onclick = async () => {
  const t = $('ocrText').textContent; if (!t) return toast('Nothing to copy yet', 'err');
  try { await navigator.clipboard.writeText(t); } catch { const r = document.createRange(); r.selectNodeContents($('ocrText')); getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand('copy'); }
  toast('Copied');
};
$('ocrBack').onclick = () => (openOcr.only != null ? (show('page', 'pop'), openPage(openOcr.only, 'none')) : openDoc(current.id));

// ---------- PDF ----------
const ensureJsPdf = () => loadScript('vendor/jspdf.umd.min.js').then(() => window.jspdf);
/** Fast PDF: JPEG pages are embedded as-is (no canvas re-encode); other images are converted once. */
async function imagesToPdfBlob(blobs, small) {
  const { jsPDF } = await ensureJsPdf();
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: false });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < blobs.length; i++) {
    let b = blobs[i], iw, ih;
    if (small) { const c = await blobToCanvas(b, 1600); iw = c.width; ih = c.height; b = await canvasToBlob(c, 0.68); Vision.free(c); }
    else if (b.type !== 'image/jpeg') { const c = await blobToCanvas(b, 2600); iw = c.width; ih = c.height; b = await canvasToBlob(c, 0.9); Vision.free(c); }
    else { const bmp = await createImageBitmap(b); iw = bmp.width; ih = bmp.height; bmp.close(); }
    const s = Math.min(W / iw, H / ih), w = iw * s, h = ih * s;
    if (i) pdf.addPage();
    pdf.addImage(new Uint8Array(await b.arrayBuffer()), 'JPEG', (W - w) / 2, (H - h) / 2, w, h, undefined, 'NONE');
  }
  return pdf.output('blob');
}
const safeName = (n) => n.replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Document';
async function exportPdf(doc, view, small) {
  busy('Preparing PDF…');
  try {
    doc = await ensureFinal(doc); busy('Preparing PDF…');
    const blob = await imagesToPdfBlob(doc.pages.map((p) => p.img), small);
    busy();
    await deliver([new File([blob], safeName(doc.name) + (small ? ' (small)' : '') + '.pdf', { type: 'application/pdf' })]);
  } catch (e) { busy(); toast('Couldn’t create PDF', 'err'); }
}

// ---------- wiring ----------
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => {
  if (b.dataset.tab === 'search') { goTab('home'); setTimeout(() => $('search').focus(), 60); return; }
  goTab(b.dataset.tab);
}));
$('tabScan').onclick = () => startScan();
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => (TABS.includes(b.dataset.back) ? goTab(b.dataset.back) : show(b.dataset.back, 'pop'))));
document.querySelectorAll('.view').forEach((v) => (v.inert = !v.classList.contains('active')));
// user-visible errors instead of silent failures
window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver|Script error/.test(e.message)) { console.error(e.error || e.message); busy(); toast('Something went wrong. Please try again.', 'err'); } });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); busy(); toast((e.reason && e.reason.message) ? `Couldn’t finish: ${e.reason.message}` : 'Something went wrong. Please try again.', 'err'); });
// rapid-tap guard: async buttons ignore taps while their previous run is still going
['batNext', 'batCancel', 'batCam', 'batPhotos', 'batDone', 'cropDone', 'cropCancel', 'cropAuto', 'cropRetake', 'revDone', 'revBack', 'revAdd', 'revCrop', 'revRotate', 'revDel', 'docAdd', 'docShare', 'docEdit', 'docFind', 'docPdf', 'pdfvShare', 'pgEdit', 'pgOcr', 'pgSign', 'pgDownload', 'pgShare', 'pageDelete', 'adjApply', 'placeDone', 'ocrRun', 'tabScan'].forEach((id) => {
  const b = $(id); if (!b || !b.onclick) return; const fn = b.onclick; let running = false;
  b.onclick = async (e) => { if (running) { return; } running = true; setTimeout(() => (running = false), 1500); try { await fn.call(b, e); } finally { running = false; } };
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
renderHome('none');
// Prewarm the scanner engine in its worker once the app is idle (never competes with first paint)
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1));
addEventListener('load', () => setTimeout(() => idle(async () => {
  VW.start();
  try { for (const d of await DB.all()) if (d.pages.some((x) => x.pending)) finishPending(d.id); } catch {}
}), 1500));
(() => { // swipe between pages on the filter screen
  let x0 = null, y0 = 0; const w = $('revWrap');
  w.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
  w.addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? $('revNext') : $('revPrev')).click(); });
})();

// ---------- 3.3: Share sheet with size choice ----------
async function shareMenu(doc, n = doc.pages.length) {
  const bytes = doc.pages.reduce((a, p) => a + (p.img ? p.img.size : 0), 0);
  return menu('Share', [
    { label: `PDF · Best quality (${docSize(bytes)})`, value: 'pdf', icon: 'pdf' },
    { label: 'PDF · Small file (for WhatsApp, email)', value: 'small', icon: 'compress' },
    { label: n > 1 ? 'Images (JPG)' : 'Image (JPG)', value: 'jpg', icon: 'photo' }]);
}

// ---------- 3.3: Multi-select documents (home) ----------
const homeSel = { on: false, ids: new Set(), all: [] };
function homeSelChrome() {
  const n = homeSel.ids.size;
  $('homeSel').textContent = homeSel.on ? 'Done' : 'Select';
  $('homeNavT').textContent = homeSel.on ? (n ? `${n} Selected` : 'Select Items') : 'Documents';
  $('home').classList.toggle('selecting', homeSel.on);
  $('homeSelBar').hidden = !homeSel.on; $('tabbar').classList.toggle('hide', homeSel.on || curView !== 'home');
  $('hsShare').disabled = !n; $('hsDelete').disabled = !n; $('hsMerge').disabled = n < 2;
  $('viewToggle').textContent = ''; homeSel.on ? $('viewToggle').replaceChildren(document.createTextNode(n === homeSel.all.length && n ? 'None' : 'All')) : updateLayoutBtn();
  $('viewToggle').classList.toggle('txt', homeSel.on);
}
function setHomeSel(on) { homeSel.on = on; homeSel.ids.clear(); renderHome('none').then(homeSelChrome); homeSelChrome(); }
$('homeSel').onclick = () => setHomeSel(!homeSel.on);
const vt0 = $('viewToggle').onclick;
$('viewToggle').onclick = (e) => {
  if (!homeSel.on) return vt0(e);
  if (homeSel.ids.size === homeSel.all.length) homeSel.ids.clear(); else homeSel.all.forEach((i) => homeSel.ids.add(i));
  $('docList').querySelectorAll('[data-id]').forEach((t) => t.classList.toggle('sel', homeSel.ids.has(t.dataset.id))); homeSelChrome();
};
$('docList').addEventListener('click', (e) => {
  if (!homeSel.on) return;
  const t = e.target.closest('[data-id]'); if (!t) return;
  e.preventDefault(); e.stopPropagation();
  const id = t.dataset.id; homeSel.ids.has(id) ? homeSel.ids.delete(id) : homeSel.ids.add(id);
  t.classList.toggle('sel', homeSel.ids.has(id)); haptic(); homeSelChrome();
}, true);
$('docList').addEventListener('pointerdown', (e) => { if (homeSel.on && e.target.closest('.rowc')) e.stopPropagation(); }, true); // no swipe while selecting
const selDocs = async () => (await DB.all()).filter((d) => homeSel.ids.has(d.id)).sort((a, b) => homeSel.all.indexOf(a.id) - homeSel.all.indexOf(b.id));
$('hsShare').onclick = async () => {
  const docs = await selDocs(); if (!docs.length) return;
  const v = await menu(`Share ${plural(docs.length, 'Document')}`, [{ label: 'PDFs · Best quality', value: 'pdf', icon: 'pdf' }, { label: 'PDFs · Small files', value: 'small', icon: 'compress' }, { label: 'Images (JPG)', value: 'jpg', icon: 'photo' }]);
  if (!v) return;
  busy('Preparing…');
  try {
    const files = [];
    for (const d0 of docs) {
      const d = await ensureFinal(d0);
      if (v === 'jpg') d.pages.forEach((p, i) => files.push(new File([p.img], `${safeName(d.name)}${d.pages.length > 1 ? ' - ' + (i + 1) : ''}.jpg`, { type: 'image/jpeg' })));
      else files.push(new File([await imagesToPdfBlob(d.pages.map((p) => p.img), v === 'small')], safeName(d.name) + (v === 'small' ? ' (small)' : '') + '.pdf', { type: 'application/pdf' }));
    }
    busy(); await deliver(files);
  } catch (e) { busy(); toast('Couldn’t prepare files', 'err'); }
};
$('hsMerge').onclick = async () => {
  const docs = await selDocs(); if (docs.length < 2) return;
  const name = await askText('Merge Into One', `${docs[0].name} + ${docs.length - 1} more`, 'Merge', `${plural(docs.reduce((a, d) => a + d.pages.length, 0), 'page')} in this order. The originals are kept.`);
  if (!name) return;
  busy('Merging…');
  try {
    const pages = docs.flatMap((d) => d.pages.map((p) => ({ ...p, pid: Date.now().toString(36) + Math.random().toString(36).slice(2, 7) })));
    const d = await newDoc(name, pages); busy(); homeSel.on = false; homeSel.ids.clear(); homeSelChrome(); await openDoc(d.id); toast('Merged');
  } catch (e) { busy(); toast('Couldn’t merge: ' + e.message, 'err'); }
};
$('hsDelete').onclick = async () => {
  const n = homeSel.ids.size; if (!n) return;
  if (!await confirmDelete(`Delete ${plural(n, 'Document')}?`, 'They will be deleted from this device.')) return;
  for (const id of homeSel.ids) await DB.del(id);
  toast(`${plural(n, 'document')} deleted`); setHomeSel(false);
};

// ---------- 3.3: Multi-select pages (document) ----------
const docSel = { on: false, ids: new Set() };
function docSelChrome() {
  const n = docSel.ids.size;
  $('docSel').textContent = docSel.on ? 'Done' : 'Select';
  $('doc').querySelector('.nav-t').textContent = docSel.on ? (n ? `${n} Selected` : 'Select Pages') : current.name;
  $('doc').querySelector('footer.toolbar:not(.selt)').hidden = docSel.on; $('docSelBar').hidden = !docSel.on;
  $('pages').classList.toggle('selmode', docSel.on); $('docMenu').hidden = docSel.on;
  $('dsShare').disabled = $('dsCopy').disabled = !n; $('dsDelete').disabled = !n;
}
function setDocSel(on) { docSel.on = on; docSel.ids.clear(); $('pages').querySelectorAll('.pg').forEach((t) => t.classList.remove('sel')); docSelChrome(); }
function docSelToggle(i) {
  docSel.ids.has(i) ? docSel.ids.delete(i) : docSel.ids.add(i);
  const t = $('pages').querySelector(`.pg[data-i="${i}"]`); if (t) t.classList.toggle('sel', docSel.ids.has(i)); haptic(); docSelChrome();
}
$('docSel').onclick = () => setDocSel(!docSel.on);
const selIdx = () => [...docSel.ids].sort((a, b) => a - b);
$('dsShare').onclick = async () => {
  const idx = selIdx(); if (!idx.length) return;
  const v = await menu(`Share ${plural(idx.length, 'Page')}`, [{ label: 'PDF · Best quality', value: 'pdf', icon: 'pdf' }, { label: 'PDF · Small file', value: 'small', icon: 'compress' }, { label: idx.length > 1 ? 'Images (JPG)' : 'Image (JPG)', value: 'jpg', icon: 'photo' }]);
  if (!v) return;
  busy('Preparing…');
  try {
    const d = await ensureFinal(current), pages = idx.map((i) => d.pages[i]), base = safeName(d.name);
    const files = v === 'jpg' ? pages.map((p, k) => new File([p.img], `${base} - ${idx[k] + 1}.jpg`, { type: 'image/jpeg' }))
      : [new File([await imagesToPdfBlob(pages.map((p) => p.img), v === 'small')], `${base} (pages ${idx.map((i) => i + 1).join(',')}).pdf`, { type: 'application/pdf' })];
    busy(); await deliver(files);
  } catch (e) { busy(); toast('Couldn’t prepare files', 'err'); }
};
$('dsCopy').onclick = async () => {
  const idx = selIdx(); if (!idx.length) return;
  const name = await askText('New Document', `${current.name} (part)`, 'Create', `${plural(idx.length, 'page')} copied into a new document.`); if (!name) return;
  const d = await newDoc(name, idx.map((i) => ({ ...current.pages[i], pid: Date.now().toString(36) + Math.random().toString(36).slice(2, 7) })));
  setDocSel(false); await openDoc(d.id, 'none'); toast('New document created');
};
$('dsDelete').onclick = async () => {
  const idx = selIdx(); if (!idx.length) return;
  const all = idx.length === current.pages.length;
  if (!await confirmDelete(`Delete ${plural(idx.length, 'Page')}?`, all ? 'These are all the pages, so the document will be deleted too.' : undefined)) return;
  if (all) { await DB.del(current.id); current = null; docSel.on = false; docSel.ids.clear(); toast('Document deleted'); return renderHome('pop'); }
  current.pages = current.pages.filter((_, i) => !docSel.ids.has(i)); current.updated = Date.now(); await DB.put(current);
  toast(`${plural(idx.length, 'page')} deleted`); docSel.on = false; docSel.ids.clear(); await openDoc(current.id, 'none'); docSelChrome();
};
