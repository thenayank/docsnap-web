'use strict';
/* DocSnap – original code. Storage: IndexedDB. Vision: OpenCV.js. OCR: Tesseract.js. PDF: jsPDF. */
const $ = (id) => document.getElementById(id);
const MAX_SIDE = 2000;
const FILTERS = [['original', 'Original'], ['magic', 'Enhanced'], ['bw', 'Black & White'], ['gray', 'Grayscale']];
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
const settings = Object.assign({ auto: true, filter: 'magic', lang: 'eng', layout: 'grid' }, JSON.parse(localStorage.getItem('settings') || '{}'));
const saveSettings = () => localStorage.setItem('settings', JSON.stringify(settings));

// ---------- navigation ----------
const TABS = ['home', 'tools', 'settings'];
let curView = 'home';
const navStack = [];
/** Show a view. mode: push | pop | up | down | tab | none */
function show(id, mode = 'push') {
  const from = $(curView), to = $(id);
  if (id === curView) { to.classList.add('active'); return; }
  const clear = (v) => v.classList.remove('in-push', 'out-push', 'in-pop', 'out-pop', 'in-up', 'out-down', 'in-fade');
  clear(from); clear(to);
  if (mode === 'push' || mode === 'up') navStack.push(curView);
  from.classList.remove('active'); to.classList.add('active');
  const anim = { push: ['out-push', 'in-push'], pop: ['out-pop', 'in-pop'], up: [null, 'in-up'], down: ['out-down', null], tab: [null, 'in-fade'] }[mode];
  if (anim) {
    if (anim[0]) { from.classList.add(anim[0]); setTimeout(() => clear(from), 460); }
    if (anim[1]) { to.classList.add(anim[1]); setTimeout(() => clear(to), 460); }
  }
  curView = id;
  $('tabbar').classList.toggle('hide', !TABS.includes(id));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
}
function goTab(id) {
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
    $('scrim').classList.add('on'); $('sheet').classList.add('on');
  });
}
function closeSheet(v = null) {
  $('scrim').classList.remove('on'); $('sheet').classList.remove('on'); $('sheet').style.transform = '';
  const r = sheetResolve; sheetResolve = null; if (r) r(v);
}
$('scrim').addEventListener('click', () => { if (sheetResolve) closeSheet(null); });
// drag-to-dismiss on the grabber area
(() => {
  const s = $('sheet'); let y0 = null, dy = 0;
  s.addEventListener('pointerdown', (e) => { if (e.target.closest('.grabber,h3,.sub') && s.scrollTop === 0) { y0 = e.clientY; dy = 0; s.classList.add('drag'); s.setPointerCapture(e.pointerId); } });
  s.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); s.style.transform = `translateY(${dy}px)`; });
  const end = () => { if (y0 == null) return; s.classList.remove('drag'); y0 = null; if (dy > 90) closeSheet(null); else s.style.transform = ''; };
  s.addEventListener('pointerup', end); s.addEventListener('pointercancel', end);
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
function stamp() { const d = new Date(); return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}, ${d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}`; }
const defaultName = () => `Scan ${stamp()}`;
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
  const list = $('docList');
  if (!docs.length) {
    const e = el('div', { class: 'empty', html: q ? SEARCH_ILL : EMPTY_ILL });
    if (q) e.append(el('h3', { textContent: 'No Results' }), el('p', { textContent: `Nothing matches “${$('search').value.trim()}”. Text inside pages is searchable after you use Text on a document.` }));
    else if (activeFolder) e.append(el('h3', { textContent: 'This folder is empty' }), el('p', { textContent: 'Scan something new, or move documents here from their ••• menu.' }), el('button', { class: 'btn primary', style: 'width:auto;padding:0 28px', onclick: () => openCamera() }, icon('scan'), 'Scan Document'));
    else e.append(el('h3', { textContent: 'No Documents Yet' }), el('p', { textContent: 'Scan receipts, notes, IDs and more. They stay private on this device.' }), el('button', { class: 'btn primary', style: 'width:auto;padding:0 28px', onclick: () => openCamera() }, icon('scan'), 'Scan Document'));
    list.replaceChildren(e); return;
  }
  const meta = (d) => `${relDate(d.updated || d.created)} · ${plural(d.pages.length, 'page')}${d.folder && !activeFolder ? ' · ' + d.folder : ''}`;
  const thumb = (d) => { const i = el('img', { alt: '', onload: function () { this.classList.add('ld'); } }); if (d.pages[0]) i.src = url(d.pages[0].img); return i; };
  if (settings.layout === 'grid') {
    list.replaceChildren(el('div', { class: 'dgrid' }, docs.map((d) => el('div', { class: 'tile' },
      el('button', { class: 'thumb', style: 'display:block;width:100%', onclick: () => openDoc(d.id), 'aria-label': d.name }, thumb(d), d.pages.length > 1 ? el('span', { class: 'count', textContent: d.pages.length }) : null),
      el('div', { class: 'tinfo' }, el('div', {}, el('div', { class: 'tname', textContent: d.name }), el('div', { class: 'tmeta', textContent: meta(d) }), snippets[d.id] ? el('div', { class: 'snip', textContent: snippets[d.id] }) : null),
        el('button', { class: 'tmore', 'aria-label': 'More', onclick: () => docActions(d) }, icon('more')))))));
  } else {
    list.replaceChildren(el('div', { class: 'dlist' }, docs.map((d) => swipeRow(d, thumb(d), meta(d), snippets[d.id]))));
  }
}
function swipeRow(d, img, meta, snip) {
  const content = el('div', { class: 'rowc' }, img, el('div', { class: 'rt' }, el('div', { class: 'tname', textContent: d.name }), el('div', { class: 'tmeta', textContent: meta }), snip ? el('div', { class: 'snip', textContent: snip }) : null), icon('chev', 'chev'));
  content.querySelector('.chev').style.cssText = 'width:16px;height:16px;color:var(--label3);stroke-width:2.4';
  const row = el('div', { class: 'swipe' }, el('div', { class: 'sacts' },
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
  if (v === 'share') return exportPdf(d);
  if (v === 'rename') { if (await renameDoc(d)) curView === 'doc' ? openDoc(d.id, 'none') : renderHome('none'); }
  if (v === 'move') { await moveDoc(d); if (curView === 'doc') openDoc(d.id, 'none'); }
  if (v === 'delete') return deleteDoc(d);
}

// ---------- Document view (with long-press drag to reorder) ----------
async function openDoc(id, mode = 'push') {
  current = await DB.get(id);
  if (!current) return renderHome();
  revokeUrls();
  $('docTitle').textContent = current.name;
  $('doc').querySelector('.nav-t').textContent = current.name;
  $('docMeta').textContent = `${plural(current.pages.length, 'page')} · ${relDate(current.updated || current.created)}${current.folder ? ' · ' + current.folder : ''}`;
  const wrap = $('pages'); wrap.replaceChildren();
  current.pages.forEach((p, i) => {
    const tile = el('div', { class: 'pg' }, el('div', { class: 'thumb' }, el('img', { src: url(p.img), alt: `Page ${i + 1}`, draggable: false })), el('span', { class: 'num', textContent: i + 1 }));
    tile.dataset.i = i; wrap.append(tile);
  });
  $('ocrBtn').querySelector('span').textContent = 'Text';
  if (mode !== 'none') show('doc', curView === 'home' || curView === 'tool' || curView === 'camera' || curView === 'crop' ? (curView === 'camera' || curView === 'crop' ? 'tab' : 'push') : 'pop');
}
$('docTitle').onclick = async () => { if (await renameDoc(current)) openDoc(current.id, 'none'); };
(() => {
  const wrap = $('pages'); let st = null;
  const tileAt = (x, y) => { const e = document.elementFromPoint(x, y); const t = e && e.closest('.pg'); return t && !t.classList.contains('lift') ? t : null; };
  wrap.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.pg'); if (!t) return;
    st = { t, x: e.clientX, y: e.clientY, drag: false, moved: false, id: e.pointerId };
    st.timer = setTimeout(() => { if (!st || st.moved) return; st.drag = true; haptic(); t.classList.add('lift'); wrap.setPointerCapture(st.id); }, 320);
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
    if (!s.drag) { if (!s.moved) openPage(+s.t.dataset.i); return; }
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
$('docBack').onclick = () => { current = null; renderHome('pop'); };
$('docMenu').onclick = () => docActions(current);
$('addPage').onclick = () => openCamera();
$('pdfBtn').onclick = () => exportPdf(current);

// ---------- Page editor ----------
let previewCache = {};
async function openPage(i, mode) {
  pageIdx = i; const p = current.pages[i];
  $('pageTitle').textContent = `Page ${i + 1} of ${current.pages.length}`;
  $('pageImg').src = url(p.img);
  if (curView !== 'page') show('page', mode || 'push');
  renderFilters();
}
async function renderFilters() {
  const p = current.pages[pageIdx], box = $('filters');
  box.replaceChildren(...FILTERS.map(([f, label]) => el('button', { class: 'flt' + ((p.filter || 'original') === f ? ' on' : ''), onclick: () => setFilter(f) }, el('span', { class: 'p' }), label === 'Black & White' ? 'B&W' : label)));
  const key = current.id + ':' + pageIdx + ':' + p.orig.size;
  if (!previewCache[key]) {
    try {
      const small = scaleCanvas(await blobToCanvas(p.orig, 400), 160);
      previewCache = { [key]: {} };
      for (const [f] of FILTERS) previewCache[key][f] = (await applyFilter(small, f)).toDataURL('image/jpeg', 0.7);
    } catch { return; }
  }
  [...box.children].forEach((b, k) => { b.querySelector('.p').style.backgroundImage = `url(${previewCache[key][FILTERS[k][0]]})`; });
}
async function applyFilter(canvas, f) {
  if (!f || f === 'original') return canvas;
  const { cv } = await loadCv();
  const src = cv.imread(canvas), out = new cv.Mat();
  try {
    if (f === 'gray') cv.cvtColor(src, out, cv.COLOR_RGBA2GRAY);
    else if (f === 'bw') {
      const g = new cv.Mat(); cv.cvtColor(src, g, cv.COLOR_RGBA2GRAY);
      const bs = Math.max(15, (Math.round(Math.max(canvas.width, canvas.height) / 60) | 1));
      cv.adaptiveThreshold(g, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, bs % 2 ? bs : bs + 1, 12); g.delete();
    } else if (f === 'magic') {
      const rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      const ch = new cv.MatVector(); cv.split(rgb, ch);
      const res = new cv.MatVector(); const k = cv.Mat.ones(7, 7, cv.CV_8U);
      const mb = Math.max(5, (Math.round(Math.max(canvas.width, canvas.height) / 90) | 1));
      for (let c = 0; c < 3; c++) {
        const m = ch.get(c), bg = new cv.Mat(), d = new cv.Mat();
        cv.dilate(m, bg, k); cv.medianBlur(bg, bg, Math.min(mb, 255));
        cv.divide(m, bg, d, 255, -1); cv.convertScaleAbs(d, d, 1.12, -18);
        res.push_back(d); m.delete(); bg.delete(); d.delete();
      }
      cv.merge(res, out); [rgb, ch, res, k].forEach((x) => x.delete());
    }
    const c = document.createElement('canvas'); cv.imshow(c, out); return c;
  } finally { src.delete(); out.delete(); }
}
/** Persist a new "orig" for the current page (optional) and re-apply its filter. */
async function savePage(orig) {
  const p = current.pages[pageIdx];
  if (orig) p.orig = await canvasToBlob(orig, 0.9);
  p.img = await canvasToBlob(await applyFilter(await blobToCanvas(p.orig), p.filter || 'original'));
  await DB.put(current);
}
async function setFilter(f) {
  const p = current.pages[pageIdx]; if ((p.filter || 'original') === f) return;
  busy('Applying…');
  try { p.filter = f; await savePage(); } catch (e) { toast(e.message, 'err'); }
  busy(); openPage(pageIdx);
}
$('pageRotate').onclick = async () => {
  busy('Rotating…');
  try { const p = current.pages[pageIdx]; if (p.raw) p.raw = await canvasToBlob(rotateCanvas(await blobToCanvas(p.raw)), 0.9); await savePage(rotateCanvas(await blobToCanvas(p.orig))); } catch (e) { toast(e.message, 'err'); }
  busy(); openPage(pageIdx);
};
$('pageCrop').onclick = async () => {
  const p = current.pages[pageIdx];
  busy('Opening…');
  const src = await blobToCanvas(p.raw || p.orig);
  cropCallback = async (out) => {
    if (!out) return show('page', 'down');
    busy('Saving…'); try { await savePage(out); } catch (e) { toast(e.message, 'err'); } busy();
    show('page', 'down'); openPage(pageIdx);
  };
  startCrop(src, 'Crop', p.raw ? undefined : fullCorners(src));
};
$('pageDelete').onclick = async () => {
  if (!await confirmDelete('Delete this page?', current.pages.length === 1 ? 'This is the only page, so the document will be deleted too.' : undefined)) return;
  current.pages.splice(pageIdx, 1);
  if (!current.pages.length) { await DB.del(current.id); current = null; toast('Document deleted'); return renderHome('pop'); }
  await DB.put(current); toast('Page deleted'); openDoc(current.id);
};
$('pageBack').onclick = () => openDoc(current.id);
$('pageWatermark').onclick = async () => {
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
  busy(); openPage(pageIdx);
};

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
$('pageSign').onclick = startPlace;

// ---------- Settings ----------
async function renderSettings() {
  $('setAuto').checked = settings.auto;
  $('setFilterVal').textContent = Object.fromEntries(FILTERS)[settings.filter];
  $('setLangVal').textContent = Object.fromEntries(LANGS)[settings.lang];
  $('setSigVal').textContent = localStorage.getItem('signature') ? 'Saved' : 'Not set';
  try {
    const est = await navigator.storage.estimate();
    $('setStorage').textContent = est.usage > 1048576 ? (est.usage / 1048576).toFixed(1) + ' MB' : Math.round(est.usage / 1024) + ' KB';
  } catch { $('setStorage').textContent = '—'; }
}
$('setAuto').onchange = () => { settings.auto = $('setAuto').checked; saveSettings(); };
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


// ---------- Camera (live edge detection + auto-capture) ----------
const cam = { stream: null, timer: 0, q: null, last: null, stable: 0, count: 0, cool: 0, opts: {}, returnTo: 'home', doc: null, busy: false };
const camHint = (t, ok) => { const h = $('camHint'); h.textContent = t; h.classList.toggle('ok', !!ok); };
async function openCamera(opts = {}) {
  cam.opts = opts; cam.count = 0; cam.returnTo = curView; cam.q = cam.last = null; cam.stable = 0; cam.busy = false; cam.armed = true; cam.capQ = null;
  cam.doc = opts.single ? null : ((curView === 'doc' || curView === 'page') && current ? current : null);
  $('camDone').classList.remove('has'); $('camAuto').classList.toggle('on', settings.auto);
  $('camAuto').style.display = opts.single ? 'none' : '';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return cameraFallback();
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
  } catch (e) { return cameraFallback(); }
  const v = $('camVideo'); v.srcObject = cam.stream;
  try { await v.play(); } catch {}
  camHint(opts.single ? 'Fit the card in view' : 'Point at a document');
  show('camera', 'up');
  loadCv().then(() => { if (cam.stream) camLoop(); }).catch(() => camHint('Tap the shutter to take a photo'));
}
function stopCamera() {
  clearTimeout(cam.timer); cam.timer = 0;
  if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
  cam.stream = null; $('camVideo').srcObject = null;
  const o = $('camOverlay'); o.getContext('2d').clearRect(0, 0, o.width, o.height);
}
async function cameraFallback() {
  const v = await menu('Add a Photo', [{ label: 'Take Photo', value: 'cam', icon: 'camera' }, { label: 'Choose from Photos', value: 'lib', icon: 'photos' }], 'The live camera isn’t available here.');
  if (!v) return;
  const files = await pickFiles('image/*', v === 'lib' && !cam.opts.single, v === 'cam' ? 'environment' : undefined);
  if (files.length) importFiles(files);
}
function camLoop() {
  if (!cam.stream) return;
  const v = $('camVideo'), vw = v.videoWidth, vh = v.videoHeight;
  if (vw && !cam.busy) {
    const sw = 360, sh = Math.round(vh * sw / vw);
    const small = camLoop.c || (camLoop.c = document.createElement('canvas'));
    small.width = sw; small.height = sh; small.getContext('2d').drawImage(v, 0, 0, sw, sh);
    let q = null;
    try { q = detectCorners(window.cv, small); } catch {}
    if (q) q = q.map((p) => ({ x: p.x * vw / sw, y: p.y * vh / sh }));
    if (q && cam.last) {
      const d = Math.max(...q.map((p, i) => Math.hypot(p.x - cam.last[i].x, p.y - cam.last[i].y))) / vw;
      cam.stable = d < 0.018 ? cam.stable + 1 : 0;
    } else cam.stable = 0;
    // after a capture, wait until the page changes (or leaves the view) before auto-capturing again
    if (!cam.armed && (!q || !cam.capQ || Math.max(...q.map((p, i) => Math.hypot(p.x - cam.capQ[i].x, p.y - cam.capQ[i].y))) / vw > 0.06)) cam.armed = true;
    cam.q = q; cam.last = q;
    drawCamOverlay(q, vw, vh);
    const cooling = Date.now() < cam.cool;
    if (!cooling) {
      if (!q) camHint(cam.opts.single ? 'Fit the card in view' : 'Point at a document');
      else if (settings.auto && !cam.opts.single) camHint(!cam.armed ? 'Move to the next page' : cam.stable >= 3 ? 'Hold still…' : 'Document found', true);
      else camHint('Ready', true);
    }
    if (q && settings.auto && cam.armed && !cam.opts.single && !cooling && cam.stable >= 7) camCapture();
  }
  cam.timer = setTimeout(camLoop, 100);
}
function drawCamOverlay(q, vw, vh) {
  const o = $('camOverlay'), dpr = devicePixelRatio || 1, cw = o.clientWidth, ch = o.clientHeight;
  if (o.width !== Math.round(cw * dpr)) { o.width = Math.round(cw * dpr); o.height = Math.round(ch * dpr); }
  const ctx = o.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
  if (!q) return;
  const s = Math.max(cw / vw, ch / vh), ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
  const P = q.map((p) => [p.x * s + ox, p.y * s + oy]);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a9c8c';
  ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  ctx.fillStyle = 'rgba(45,212,191,0.22)'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = accent; ctx.lineJoin = 'round'; ctx.stroke();
  for (const [x, y] of P) { ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); }
}
async function camCapture() {
  if (cam.busy) return; cam.busy = true; haptic();
  const f = $('camFlash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  try {
    const v = $('camVideo'), vw = v.videoWidth, vh = v.videoHeight;
    if (!vw) throw new Error('Camera not ready');
    const k = Math.min(1, MAX_SIDE / Math.max(vw, vh));
    const frame = el('canvas', { width: Math.round(vw * k), height: Math.round(vh * k) });
    frame.getContext('2d').drawImage(v, 0, 0, frame.width, frame.height);
    const q = cam.q ? cam.q.map((p) => ({ x: p.x * k, y: p.y * k })) : null;
    if (cam.opts.single) {
      stopCamera(); cropCallback = cam.opts.single; cam.busy = false;
      return startCrop(frame, 'Adjust Corners', q);
    }
    const warped = q ? warp(window.cv, frame, q) : frame;
    await addPageToCamDoc(frame, warped);
    cam.cool = Date.now() + 1600; cam.stable = 0; cam.armed = false; cam.capQ = cam.q;
    camHint(`Page ${cam.count} saved`, true);
  } catch (e) { toast(e.message, 'err'); }
  cam.busy = false;
}
async function addPageToCamDoc(raw, warped) {
  let img = warped;
  try { img = await applyFilter(warped, settings.filter); } catch {}
  const page = { raw: await canvasToBlob(raw, 0.85), orig: await canvasToBlob(warped, 0.9), img: await canvasToBlob(img, 0.88), filter: img === warped ? 'original' : settings.filter, text: '' };
  if (!cam.doc) cam.doc = await newDoc(defaultName());
  cam.doc.pages.push(page); await DB.put(cam.doc);
  cam.count++; current = cam.doc;
  $('camThumb').src = URL.createObjectURL(page.img); $('camCount').textContent = cam.count;
  const st = $('camDone'); st.classList.remove('has'); void st.offsetWidth; st.classList.add('has');
}
function camFinish() {
  stopCamera();
  if (cam.count > 0) { current = cam.doc; openDoc(cam.doc.id); }
  else show(cam.returnTo, 'down');
}
$('camShutter').onclick = () => camCapture();
$('camDone').onclick = camFinish;
$('camClose').onclick = () => { if (cam.opts.single) { stopCamera(); show(cam.returnTo, 'down'); } else camFinish(); };
$('camAuto').onclick = () => { settings.auto = !settings.auto; saveSettings(); $('camAuto').classList.toggle('on', settings.auto); toast(settings.auto ? 'Auto-capture on' : 'Auto-capture off'); };
$('camPhotos').onclick = async () => {
  const files = await pickFiles('image/*', !cam.opts.single);
  if (!files.length) return;
  stopCamera(); importFiles(files);
};
/** Imported photos always get a crop review. */
let pendingFiles = [], cropCallback = null;
function importFiles(files) {
  if (cam.opts.single) { cropCallback = cam.opts.single; pendingFiles = [files[0]]; }
  else { cropCallback = null; pendingFiles = [...files]; }
  nextPending();
}
async function nextPending() {
  const f = pendingFiles.shift();
  if (!f) return;
  try { busy('Opening photo…'); await startCrop(await blobToCanvas(f, MAX_SIDE), pendingFiles.length ? `Photo (${pendingFiles.length} more)` : 'Adjust Corners'); }
  catch (e) { busy(); toast('Could not open that photo', 'err'); }
}

// ---------- Crop editor ----------
const crop = { canvas: null, corners: null, drag: -1, disp: 1, from: 'home' };
async function startCrop(canvas, title = 'Adjust Corners', preset) {
  crop.canvas = canvas; crop.corners = preset || null; $('cropTitle').textContent = title;
  if (!crop.corners) {
    busy('Finding edges…');
    try { const { cv } = await loadCv(); crop.corners = detectCorners(cv, canvas); } catch {}
  }
  $('cropHint').textContent = crop.corners ? 'Drag the corners to fine-tune' : 'Drag the corners to the edges of the page';
  if (!crop.corners) {
    const c = canvas, m = 0.08;
    crop.corners = [{ x: c.width * m, y: c.height * m }, { x: c.width * (1 - m), y: c.height * m }, { x: c.width * (1 - m), y: c.height * (1 - m) }, { x: c.width * m, y: c.height * (1 - m) }];
  }
  busy();
  if (curView !== 'crop') show('crop', curView === 'camera' ? 'tab' : 'up');
  requestAnimationFrame(drawCrop);
}
function drawCrop() {
  const cc = $('cropCanvas'), src = crop.canvas;
  if (cc.width !== src.width || cc.height !== src.height) { cc.width = src.width; cc.height = src.height; }
  const ctx = cc.getContext('2d'); ctx.drawImage(src, 0, 0);
  const rect = cc.getBoundingClientRect();
  crop.disp = rect.width ? src.width / rect.width : 1;
  const q = crop.corners, d = crop.disp;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath();
  ctx.rect(0, 0, cc.width, cc.height); ctx.moveTo(q[0].x, q[0].y);
  [3, 2, 1].forEach((i) => ctx.lineTo(q[i].x, q[i].y)); ctx.closePath(); ctx.fill('evenodd');
  ctx.strokeStyle = '#2dd4bf'; ctx.lineWidth = 2 * d; ctx.lineJoin = 'round'; ctx.beginPath();
  q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
  q.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(p.x, p.y, (crop.drag === i ? 15 : 11) * d, 0, 7);
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6 * d; ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = 3 * d; ctx.strokeStyle = '#2dd4bf'; ctx.stroke();
  });
}
function canvasPoint(e) { const cc = $('cropCanvas'), r = cc.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cc.width / r.width), y: (e.clientY - r.top) * (cc.height / r.height) }; }
$('cropCanvas').addEventListener('pointerdown', (e) => {
  const p = canvasPoint(e); let best = -1, bd = 48 * crop.disp;
  crop.corners.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = i; } });
  crop.drag = best; if (best >= 0) { e.target.setPointerCapture(e.pointerId); haptic(); drawCrop(); }
});
$('cropCanvas').addEventListener('pointermove', (e) => {
  if (crop.drag < 0) return;
  const p = canvasPoint(e), c = crop.canvas;
  crop.corners[crop.drag] = { x: Math.max(0, Math.min(c.width, p.x)), y: Math.max(0, Math.min(c.height, p.y)) };
  drawCrop();
});
['pointerup', 'pointercancel'].forEach((t) => $('cropCanvas').addEventListener(t, () => { crop.drag = -1; if (crop.canvas) drawCrop(); }));
$('cropReset').onclick = () => { crop.corners = fullCorners(crop.canvas); drawCrop(); };
$('cropRotate').onclick = () => {
  const W = crop.canvas.height; // after rotation, a point (x,y) maps to (H - y, x)
  const H0 = crop.canvas.height; crop.corners = orderCorners(crop.corners.map((p) => ({ x: H0 - p.y, y: p.x })));
  crop.canvas = rotateCanvas(crop.canvas); void W; drawCrop();
};
$('cropCancel').onclick = () => {
  pendingFiles = [];
  if (cropCallback) { const cb = cropCallback; cropCallback = null; return cb(null); }
  if (cam.doc && cam.doc.pages.length) return openDoc(cam.doc.id);
  show(cam.returnTo || 'home', 'down');
};
$('cropDone').onclick = async () => {
  busy('Straightening…');
  try {
    let out = crop.canvas;
    const q = orderCorners(crop.corners), full = fullCorners(crop.canvas);
    if (!q.every((p, i) => Math.hypot(p.x - full[i].x, p.y - full[i].y) < 2)) {
      try { out = warp((await loadCv()).cv, crop.canvas, q); } catch { toast('Saved without straightening', 'err'); }
    }
    if (cropCallback) { const cb = cropCallback; cropCallback = null; busy(); return cb(out); }
    await addPageToCamDoc(crop.canvas, out);
    busy();
    if (pendingFiles.length) return nextPending();
    openDoc(cam.doc.id);
  } catch (e) { busy(); toast('Couldn’t save: ' + e.message, 'err'); }
};
window.addEventListener('resize', () => { if (curView === 'crop') drawCrop(); if (curView === 'place') drawPlace(); });

// ---------- Text (OCR) ----------
function setOcrLang(v) { document.querySelectorAll('#ocrLang button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }
document.querySelectorAll('#ocrLang button').forEach((b) => (b.onclick = () => { setOcrLang(b.dataset.v); runOcr(b.dataset.v); }));
const pagesText = () => current.pages.map((p, i) => (p.text ? (current.pages.length > 1 ? `Page ${i + 1}\n` : '') + p.text : '')).filter(Boolean).join('\n\n');
$('ocrBtn').onclick = () => {
  setOcrLang(settings.lang);
  $('ocrText').textContent = pagesText();
  show('ocr');
  if (!current.pages.some((p) => p.text)) setTimeout(() => runOcr(settings.lang), 350);
};
async function runOcr(lang) {
  try {
    busy('Getting ready…');
    await loadScript('vendor/tesseract.min.js');
    const worker = await Tesseract.createWorker(lang, 1, { logger: (m) => { if (m.status === 'recognizing text') busy(`Reading${current.pages.length > 1 ? ` page ${(runOcr.i || 0) + 1} of ${current.pages.length}` : ''}… ${Math.round(m.progress * 100)}%`); } });
    for (let i = 0; i < current.pages.length; i++) {
      runOcr.i = i;
      const { data } = await worker.recognize(current.pages[i].img);
      current.pages[i].text = data.text.trim();
    }
    await worker.terminate(); await DB.put(current);
    const t = pagesText(); $('ocrText').textContent = t;
    busy(); toast(t ? 'Text found · now searchable' : 'No text found', t ? 'ok' : 'err');
  } catch (e) { busy(); toast('Couldn’t read text. ' + (navigator.onLine ? '' : 'First use needs internet.'), 'err'); }
}
$('ocrRun').onclick = () => runOcr(document.querySelector('#ocrLang .on')?.dataset.v || settings.lang);
$('ocrCopy').onclick = async () => {
  const t = $('ocrText').textContent; if (!t) return toast('Nothing to copy yet', 'err');
  try { await navigator.clipboard.writeText(t); } catch { const r = document.createRange(); r.selectNodeContents($('ocrText')); getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand('copy'); }
  toast('Copied');
};
$('ocrBack').onclick = () => openDoc(current.id);

// ---------- PDF ----------
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
const safeName = (n) => n.replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Document';
async function exportPdf(doc) {
  busy('Preparing PDF…');
  try {
    const blob = await imagesToPdfBlob(doc.pages.map((p) => p.img));
    busy(); await deliver([new File([blob], safeName(doc.name) + '.pdf', { type: 'application/pdf' })]);
  } catch (e) { busy(); toast('Couldn’t create PDF', 'err'); }
}

// ---------- wiring ----------
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => {
  if (b.dataset.tab === 'search') { goTab('home'); setTimeout(() => $('search').focus(), 60); return; }
  goTab(b.dataset.tab);
}));
$('tabScan').onclick = () => { current = null; openCamera(); };
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => show(b.dataset.back, 'pop')));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
renderHome('none');
