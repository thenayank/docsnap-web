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
const settings = Object.assign({ filter: 'magic', lang: 'eng', layout: 'list' }, JSON.parse(localStorage.getItem('settings') || '{}'));
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
    else if (activeFolder) e.append(el('h3', { textContent: 'This folder is empty' }), el('p', { textContent: 'Scan something new, or move documents here from their ••• menu.' }), el('button', { class: 'btn primary', style: 'width:auto;padding:0 28px', onclick: () => startScan() }, icon('scan'), 'Scan Document'));
    else e.append(el('h3', { textContent: 'No Documents Yet' }), el('p', { textContent: 'Scan receipts, notes, IDs and more. They stay private on this device.' }), el('button', { class: 'btn primary', style: 'width:auto;padding:0 28px', onclick: () => startScan() }, icon('scan'), 'Scan Document'));
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
setTimeout(() => loadCv().catch(() => {}), 1200); // warm up the scanner engine so it's ready before the first photo
  } else if (v === 'del') {
    if (!await confirmDelete(`Delete “${activeFolder}”?`, 'Documents in this folder will be kept and moved out of it.')) return;
    for (const d of all.filter((x) => x.folder === activeFolder)) { d.folder = ''; await DB.put(d); }
    setFolders(savedFolders().filter((x) => x !== activeFolder)); activeFolder = ''; renderHome('none');
setTimeout(() => loadCv().catch(() => {}), 1200); // warm up the scanner engine so it's ready before the first photo
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
setTimeout(() => loadCv().catch(() => {}), 1200); // warm up the scanner engine so it's ready before the first photo
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
  const bytes = current.pages.reduce((a, p) => a + (p.img ? p.img.size : 0), 0);
  $('docMeta').replaceChildren(el('span', {}, icon('folder'), current.folder || 'No folder'), el('span', {}, icon('docs'), plural(current.pages.length, 'page')), el('span', {}, icon('storage'), docSize(bytes)), el('span', { textContent: relDate(current.updated || current.created) }));
  $('docSearchBar').hidden = true; $('docSearchHint').hidden = true; $('docSearch').value = '';
  const wrap = $('pages'); wrap.replaceChildren();
  current.pages.forEach((p, i) => {
    const tile = el('div', { class: 'pg' }, el('div', { class: 'thumb' }, el('img', { src: url(p.img), alt: `Page ${i + 1}`, draggable: false })), el('span', { class: 'num', textContent: i + 1 }));
    tile.dataset.i = i; wrap.append(tile);
  });
  if (mode !== 'none') show('doc', curView === 'home' || curView === 'tool' ? 'push' : 'pop');
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



// ---------- Document toolbar ----------
const docSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
$('docAdd').onclick = () => startScan();
$('docShare').onclick = async () => {
  const v = await menu('Share', [{ label: 'PDF', value: 'pdf', icon: 'pdf' }, { label: current.pages.length > 1 ? 'Images (JPG)' : 'Image (JPG)', value: 'jpg', icon: 'photo' }]);
  if (v === 'pdf') exportPdf(current);
  if (v === 'jpg') deliver(current.pages.map((p, i) => new File([p.img], `${safeName(current.name)}${current.pages.length > 1 ? ' - ' + (i + 1) : ''}.jpg`, { type: 'image/jpeg' })));
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
    const ok = await alertBox({ title: 'Find Text First?', message: 'DocSnap needs to read the text in your pages once (on this device) before you can search them.', actions: [{ label: 'Not Now', value: false }, { label: 'Read Text', value: true, style: 'b' }] });
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
$('docPdf').onclick = () => { let w = null; try { w = window.open('', '_blank'); } catch {} exportPdf(current, w || true); };

// ---------- Page view ----------
async function renderPage(p) {
  const { cv } = await loadCv();
  const c = await blobToCanvas(p.orig);
  const out = Vision.filter(cv, c, p.filter || 'original', p.bc);
  p.img = await canvasToBlob(out, 0.92); Vision.free(c, out);
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
  const { cv } = await loadCv();
  const w = Vision.warp(cv, raw, q);
  p.raw = await canvasToBlob(raw, 0.88); p.quad = q.map((t) => ({ x: t.x / raw.width, y: t.y / raw.height }));
  p.orig = await canvasToBlob(w, 0.92); Vision.free(w);
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
    startCrop(raw, { q: q || fullCorners(raw), found: !!q, title: 'Re-Crop', retake: true, done: async (r, q2) => { await setPageGeometry(p, r, q2); backToPage(); }, cancel: backToPage });
  } catch (e) { busy(); toast(e.message, 'err'); }
}
async function retakePage() {
  const p = current.pages[pageIdx];
  const files = await pickFiles('image/*', false, 'environment'); if (!files.length) return;
  const r = await photoToCrop(files[0]); if (!r) return;
  startCrop(r.raw, { q: r.q, found: r.found, title: 'Retake', retake: true, done: async (raw, q) => { await setPageGeometry(p, raw, q); backToPage(); }, cancel: backToPage });
}
// Brightness / contrast
const adj = { base: null };
async function openAdjust() {
  const p = current.pages[pageIdx];
  busy('Loading…');
  try {
    const { cv } = await loadCv(); const c = await blobToCanvas(p.orig, 1100);
    adj.base = Vision.filter(cv, c, p.filter || 'original'); Vision.free(c);
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
  const v = await menu('Download Page', [{ label: 'Image (JPG)', value: 'jpg', icon: 'photo' }, { label: 'PDF', value: 'pdf', icon: 'pdf' }]);
  const p = current.pages[pageIdx];
  if (v === 'jpg') deliver([new File([p.img], pageFileName() + '.jpg', { type: 'image/jpeg' })]);
  if (v === 'pdf') { busy('Preparing PDF…'); try { const b = await imagesToPdfBlob([p.img]); busy(); deliver([new File([b], pageFileName() + '.pdf', { type: 'application/pdf' })]); } catch { busy(); toast('Couldn’t create PDF', 'err'); } }
};
$('pgShare').onclick = () => deliver([new File([current.pages[pageIdx].img], pageFileName() + '.jpg', { type: 'image/jpeg' })]);
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

// ---------- Capture (native camera / Photos — full-res HEIC/JPEG) ----------
const FILTERS = [['original', 'Original'], ['magic', 'Magic Colour'], ['white', 'Magic White'], ['bw', 'B&W'], ['gray', 'Grayscale']];
const fullCorners = (c) => [{ x: 0, y: 0 }, { x: c.width, y: 0 }, { x: c.width, y: c.height }, { x: 0, y: c.height }];
async function startScan(opts = {}) {
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
      q: r.q, found: r.found, title: 'Adjust Corners',
      done: async (raw, q) => { busy('Straightening…'); let w = null; try { w = await warpDone(raw, q); } catch (e) { toast(e.message, 'err'); } busy(); opts.single(w); },
      cancel: () => opts.single(null)
    });
  }
  // multi-page scan → crop → review
  scan.pages = []; scan.i = 0; scan.returnTo = (curView === 'doc' || curView === 'page') && current ? current.id : null;
  scan.pending = [...files]; nextScanPhoto();
}
async function photoToCrop(file) {
  busy('Opening photo…');
  try {
    const raw = await Vision.decode(file, 3000);
    const { cv } = await loadCv();
    const det = Vision.detect(cv, raw);
    busy();
    return { raw, q: det ? det.q : fullCorners(raw), found: !!det };
  } catch (e) { busy(); toast('Couldn’t open that photo', 'err'); return null; }
}
async function nextScanPhoto() {
  const f = scan.pending.shift();
  if (!f) return openReview();
  const r = await photoToCrop(f); if (!r) { if (scan.pending.length) return nextScanPhoto(); if (scan.pages.length) return openReview(); return; }
  startCrop(r.raw, {
    q: r.q, found: r.found,
    title: scan.pending.length ? `Page ${scan.pages.length + 1} · ${scan.pending.length} more` : `Page ${scan.pages.length + 1}`,
    retake: true,
    done: async (raw, q) => {
      busy('Straightening…');
      try {
        const { cv } = await loadCv();
        const warped = Vision.warp(cv, raw, q);
        scan.pages.push({
          raw: await canvasToBlob(raw, 0.88),
          quad: q.map((t) => ({ x: t.x / raw.width, y: t.y / raw.height })),
          orig: await canvasToBlob(warped, 0.92),
          filter: settings.filter || 'magic', bc: null, text: '', _preview: null
        });
        Vision.free(warped, raw);
      } catch (e) { toast(e.message, 'err'); }
      busy();
      if (scan.pending.length) return nextScanPhoto();
      openReview();
    },
    cancel: () => {
      Vision.free(r.raw);
      if (scan.pages.length) return openReview();
      if (scan.returnTo) return openDoc(scan.returnTo);
      show('home', 'down');
    }
  });
}
async function warpDone(raw, q) {
  const { cv } = await loadCv();
  const w = Vision.warp(cv, raw, q); Vision.free(raw); return w;
}
const scan = { pages: [], i: 0, pending: [], returnTo: null, filter: 'magic' };

// ---------- Crop editor (always shown; loupe while dragging) ----------
const crop = { canvas: null, corners: null, drag: -1, disp: 1, opts: null };
async function startCrop(canvas, opts = {}) {
  crop.canvas = canvas; crop.opts = opts; crop.corners = opts.q ? opts.q.map((p) => ({ ...p })) : fullCorners(canvas);
  $('cropTitle').textContent = opts.title || 'Adjust Corners';
  $('cropHint').textContent = opts.found === false ? 'Drag the corners to the edges of the page' : 'Drag the corners to fine-tune';
  $('cropRetake').style.display = opts.retake ? '' : 'none';
  $('loupe').classList.remove('on');
  if (curView !== 'crop') show('crop', 'up');
  requestAnimationFrame(drawCrop);
}
function drawCrop() {
  const cc = $('cropCanvas'), src = crop.canvas; if (!src) return;
  if (cc.width !== src.width || cc.height !== src.height) { cc.width = src.width; cc.height = src.height; }
  const ctx = cc.getContext('2d'); ctx.drawImage(src, 0, 0);
  const rect = cc.getBoundingClientRect();
  crop.disp = rect.width ? src.width / rect.width : 1;
  const q = crop.corners, d = crop.disp;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath();
  ctx.rect(0, 0, cc.width, cc.height); ctx.moveTo(q[0].x, q[0].y);
  [3, 2, 1].forEach((i) => ctx.lineTo(q[i].x, q[i].y)); ctx.closePath(); ctx.fill('evenodd');
  ctx.strokeStyle = '#2dd4bf'; ctx.lineWidth = 2.5 * d; ctx.lineJoin = 'round'; ctx.beginPath();
  q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
  q.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(p.x, p.y, (crop.drag === i ? 16 : 12) * d, 0, 7);
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 8 * d; ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = 3 * d; ctx.strokeStyle = '#2dd4bf'; ctx.stroke();
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
  lx = Math.max(8, Math.min(wrap.width - 128, lx)); ly = Math.max(8, Math.min(wrap.height - 140, ly));
  L.style.transform = `translate(${lx}px,${ly}px)`; L.classList.add('on');
}
function canvasPoint(e) { const cc = $('cropCanvas'), r = cc.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cc.width / r.width), y: (e.clientY - r.top) * (cc.height / r.height) }; }
$('cropCanvas').addEventListener('pointerdown', (e) => {
  const p = canvasPoint(e); let best = -1, bd = 52 * crop.disp;
  crop.corners.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = i; } });
  crop.drag = best; if (best >= 0) { e.target.setPointerCapture(e.pointerId); haptic(); drawCrop(); drawLoupe(crop.corners[best]); }
});
$('cropCanvas').addEventListener('pointermove', (e) => {
  if (crop.drag < 0) return;
  const p = canvasPoint(e), c = crop.canvas;
  crop.corners[crop.drag] = { x: Math.max(0, Math.min(c.width, p.x)), y: Math.max(0, Math.min(c.height, p.y)) };
  drawCrop(); drawLoupe(crop.corners[crop.drag]);
});
['pointerup', 'pointercancel'].forEach((t) => $('cropCanvas').addEventListener(t, () => { crop.drag = -1; $('loupe').classList.remove('on'); if (crop.canvas) drawCrop(); }));
$('cropReset').onclick = () => { crop.corners = fullCorners(crop.canvas); drawCrop(); };
$('cropAuto').onclick = async () => {
  busy('Finding edges…');
  try { const { cv } = await loadCv(); const det = Vision.detect(cv, crop.canvas); if (det) { crop.corners = det.q; drawCrop(); toast('Edges found'); } else toast('Couldn’t find edges — drag the corners', 'err'); }
  catch (e) { toast(e.message, 'err'); } busy();
};
$('cropRotate').onclick = () => {
  const H0 = crop.canvas.height;
  crop.corners = Vision.order(crop.corners.map((p) => ({ x: H0 - p.y, y: p.x })));
  crop.canvas = rotateCanvas(crop.canvas); drawCrop();
};
$('cropRetake').onclick = async () => {
  const files = await pickFiles('image/*', false, 'environment'); if (!files.length) return;
  const r = await photoToCrop(files[0]); if (!r) return;
  Vision.free(crop.canvas); crop.canvas = r.raw; crop.corners = r.q; crop.opts.found = r.found;
  $('cropHint').textContent = r.found ? 'Drag the corners to fine-tune' : 'Drag the corners to the edges of the page';
  drawCrop();
};
$('cropCancel').onclick = () => {
  const o = crop.opts; crop.opts = null; Vision.free(crop.canvas); crop.canvas = null;
  (o && o.cancel) ? o.cancel() : show('home', 'down');
};
$('cropDone').onclick = async () => {
  const o = crop.opts, raw = crop.canvas, q = Vision.order(crop.corners);
  crop.opts = null; crop.canvas = null;
  if (o && o.done) return o.done(raw, q);
  show('home', 'down');
};
window.addEventListener('resize', () => { if (curView === 'crop') drawCrop(); if (curView === 'place') drawPlace(); });

// ---------- Filter review (applied to all pages) ----------
async function openReview() {
  if (!scan.pages.length) return show('home', 'down');
  scan.i = Math.min(scan.i, scan.pages.length - 1);
  scan.filter = scan.pages[0].filter || settings.filter || 'magic';
  show('review', 'up');
  renderReviewFilters();
  await showReviewPage();
}
function renderReviewFilters() {
  const box = $('revFilters');
  box.replaceChildren(...FILTERS.map(([f, label]) => el('button', {
    class: 'flt' + (scan.filter === f ? ' on' : ''),
    onclick: () => setReviewFilter(f)
  }, el('span', { class: 'p', style: `background-image:url(${f === 'original' ? '' : ''})` }), label)));
  // generate tiny previews from first page
  (async () => {
    try {
      const { cv } = await loadCv();
      const base = await blobToCanvas(scan.pages[0].orig, 180);
      for (let i = 0; i < FILTERS.length; i++) {
        const c = Vision.filter(cv, base, FILTERS[i][0]);
        box.children[i].querySelector('.p').style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.7)})`;
        Vision.free(c);
      }
      Vision.free(base);
    } catch {}
  })();
}
async function showReviewPage() {
  const p = scan.pages[scan.i];
  $('revCount').textContent = `${scan.i + 1} / ${scan.pages.length}`;
  $('revBanner').textContent = scan.pages.length > 1 ? 'Filter will be applied to all pages' : 'Choose a look for this page';
  $('revPrev').disabled = scan.i === 0; $('revNext').disabled = scan.i === scan.pages.length - 1;
  $('revSpin').hidden = false; $('revImg').style.opacity = 0.3;
  try {
    if (!p._preview || p._previewF !== scan.filter) {
      const { cv } = await loadCv();
      const c = await blobToCanvas(p.orig, 1400);
      const out = Vision.filter(cv, c, scan.filter);
      p._preview = out.toDataURL('image/jpeg', 0.85); p._previewF = scan.filter;
      Vision.free(c, out);
    }
    $('revImg').src = p._preview;
  } catch (e) { toast(e.message, 'err'); }
  $('revSpin').hidden = true; $('revImg').style.opacity = 1;
}
async function setReviewFilter(f) {
  if (scan.filter === f) return;
  scan.filter = f; scan.pages.forEach((p) => { p.filter = f; p._preview = null; });
  [...$('revFilters').children].forEach((b, i) => b.classList.toggle('on', FILTERS[i][0] === f));
  await showReviewPage();
}
$('revPrev').onclick = () => { if (scan.i > 0) { scan.i--; showReviewPage(); } };
$('revNext').onclick = () => { if (scan.i < scan.pages.length - 1) { scan.i++; showReviewPage(); } };
$('revBack').onclick = () => {
  // go back to re-crop the last page
  const last = scan.pages.pop();
  if (!last) return show('home', 'down');
  (async () => {
    const raw = await blobToCanvas(last.raw);
    const q = last.quad.map((t) => ({ x: t.x * raw.width, y: t.y * raw.height }));
    startCrop(raw, {
      q, found: true, title: `Page ${scan.pages.length + 1}`, retake: true,
      done: async (r, qq) => {
        busy('Straightening…');
        try {
          const { cv } = await loadCv(); const w = Vision.warp(cv, r, qq);
          scan.pages.push({ raw: await canvasToBlob(r, 0.88), quad: qq.map((t) => ({ x: t.x / r.width, y: t.y / r.height })), orig: await canvasToBlob(w, 0.92), filter: scan.filter, bc: null, text: '', _preview: null });
          Vision.free(w, r);
        } catch (e) { toast(e.message, 'err'); }
        busy(); openReview();
      },
      cancel: () => { if (scan.pages.length) openReview(); else show('home', 'down'); }
    });
  })();
};
$('revAdd').onclick = async () => {
  const files = await pickFiles('image/*', true);
  if (!files.length) return;
  scan.pending = [...files]; nextScanPhoto();
};
$('revCrop').onclick = async () => {
  const p = scan.pages[scan.i];
  const raw = await blobToCanvas(p.raw);
  const q = p.quad.map((t) => ({ x: t.x * raw.width, y: t.y * raw.height }));
  startCrop(raw, {
    q, found: true, title: 'Re-Crop', retake: true,
    done: async (r, qq) => {
      busy('Straightening…');
      try {
        const { cv } = await loadCv(); const w = Vision.warp(cv, r, qq);
        Object.assign(p, { raw: await canvasToBlob(r, 0.88), quad: qq.map((t) => ({ x: t.x / r.width, y: t.y / r.height })), orig: await canvasToBlob(w, 0.92), _preview: null });
        Vision.free(w, r);
      } catch (e) { toast(e.message, 'err'); }
      busy(); openReview();
    },
    cancel: () => openReview()
  });
};
$('revRotate').onclick = async () => {
  const p = scan.pages[scan.i]; busy('Rotating…');
  try {
    p.raw = await canvasToBlob(rotateCanvas(await blobToCanvas(p.raw)), 0.88);
    p.orig = await canvasToBlob(rotateCanvas(await blobToCanvas(p.orig)), 0.92);
    if (p.quad) p.quad = Vision.order(p.quad.map((t) => ({ x: 1 - t.y, y: t.x })));
    p._preview = null;
  } catch (e) { toast(e.message, 'err'); }
  busy(); showReviewPage();
};
$('revDel').onclick = async () => {
  if (scan.pages.length === 1) {
    if (!await confirmDelete('Discard this scan?', 'Nothing has been saved yet.')) return;
    scan.pages = []; return show('home', 'down');
  }
  scan.pages.splice(scan.i, 1); if (scan.i >= scan.pages.length) scan.i = scan.pages.length - 1;
  showReviewPage();
};
$('revDone').onclick = async () => {
  busy(`Saving ${scan.pages.length} page${scan.pages.length > 1 ? 's' : ''}…`);
  try {
    const { cv } = await loadCv();
    const pages = [];
    for (let i = 0; i < scan.pages.length; i++) {
      if (scan.pages.length > 1) busy(`Saving… ${i + 1} of ${scan.pages.length}`);
      const p = scan.pages[i];
      const c = await blobToCanvas(p.orig);
      const out = Vision.filter(cv, c, p.filter || scan.filter, p.bc);
      pages.push({
        raw: p.raw, quad: p.quad, orig: p.orig,
        img: await canvasToBlob(out, 0.92),
        filter: p.filter || scan.filter, bc: p.bc || null, text: ''
      });
      Vision.free(c, out);
    }
    settings.filter = scan.filter; saveSettings();
    let doc;
    if (scan.returnTo) {
      doc = await DB.get(scan.returnTo);
      doc.pages.push(...pages); doc.updated = Date.now(); await DB.put(doc);
    } else {
      doc = await newDoc(defaultName(), pages);
    }
    scan.pages = []; current = doc; busy(); openDoc(doc.id);
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
    const worker = await Tesseract.createWorker(lang, 1, { logger: (m) => { if (m.status === 'recognizing text') busy(`Reading${idxs.length > 1 ? ` page ${(runOcr.i || 0) + 1} of ${idxs.length}` : ''}… ${Math.round(m.progress * 100)}%`); } });
    for (let k = 0; k < idxs.length; k++) {
      runOcr.i = k;
      const { data } = await worker.recognize(current.pages[idxs[k]].img);
      current.pages[idxs[k]].text = data.text.trim();
    }
    await worker.terminate(); await DB.put(current);
    const t = pagesText(openOcr.only); $('ocrText').textContent = t;
    busy(); toast(t ? 'Text found · now searchable' : 'No text found', t ? 'ok' : 'err');
  } catch (e) { busy(); toast('Couldn’t read text. ' + (navigator.onLine ? '' : 'First use needs internet.'), 'err'); }
}
$('ocrRun').onclick = () => runOcr(document.querySelector('#ocrLang .on')?.dataset.v || settings.lang);
$('ocrCopy').onclick = async () => {
  const t = $('ocrText').textContent; if (!t) return toast('Nothing to copy yet', 'err');
  try { await navigator.clipboard.writeText(t); } catch { const r = document.createRange(); r.selectNodeContents($('ocrText')); getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand('copy'); }
  toast('Copied');
};
$('ocrBack').onclick = () => (openOcr.only != null ? (show('page', 'pop'), openPage(openOcr.only, 'none')) : openDoc(current.id));

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
async function exportPdf(doc, view) {
  busy('Preparing PDF…');
  try {
    const blob = await imagesToPdfBlob(doc.pages.map((p) => p.img));
    busy();
    if (view) { const u = URL.createObjectURL(blob); if (view.location) view.location.href = u; else location.href = u; setTimeout(() => URL.revokeObjectURL(u), 300000); }
    else await deliver([new File([blob], safeName(doc.name) + '.pdf', { type: 'application/pdf' })]);
  } catch (e) { busy(); toast('Couldn’t create PDF', 'err'); }
}

// ---------- wiring ----------
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => {
  if (b.dataset.tab === 'search') { goTab('home'); setTimeout(() => $('search').focus(), 60); return; }
  goTab(b.dataset.tab);
}));
$('tabScan').onclick = () => startScan();
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => show(b.dataset.back, 'pop')));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
renderHome('none');
setTimeout(() => loadCv().catch(() => {}), 1200); // warm up the scanner engine so it's ready before the first photo
(() => { // swipe between pages on the filter screen
  let x0 = null, y0 = 0; const w = $('revWrap');
  w.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
  w.addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? $('revNext') : $('revPrev')).click(); });
})();
