'use strict';
/* DocSnap tools: ID card, passport photo, signature, PDF tools. All on-device. */
const loadPdfLib = () => loadScript('vendor/pdf-lib.min.js');
async function loadPdfJs() {
  await loadScript('vendor/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  return pdfjsLib;
}
const pdfFile = (bytes, name) => new File([bytes], name, { type: 'application/pdf' });
const baseName = (f) => f.name.replace(/\.[^.]+$/, '');
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

let toolBack = 'tools';
function openTool(title, build, back) {
  if (back) toolBack = back;
  $('toolTitle').textContent = title;
  const body = $('toolBody'), cta = $('toolCta');
  body.replaceChildren(); cta.replaceChildren();
  build(body, cta);
  $('tool').querySelector('[data-back]').dataset.back = toolBack;
  $('tool').querySelector('[data-back]').lastChild.textContent = toolBack === 'settings' ? 'Settings' : 'Tools';
  $('tool').querySelector('.scroll').scrollTop = 0;
  if (curView !== 'tool') show('tool', ['tools', 'settings'].includes(curView) ? 'push' : (curView === 'crop' || curView === 'sigpad' ? 'down' : 'pop'));
}
async function run(msg, fn) {
  busy(msg);
  try { await fn(); } catch (e) { console.error(e); busy(); toast(e.message || String(e), 'err'); }
  busy();
}
const lead = (t) => el('p', { class: 'lead', textContent: t });
/** File picker drop-zone + reorderable list. onChange(files) refreshes CTA state. */
function filePicker(body, { accept = 'application/pdf', multiple = true, label = 'Choose PDF', hint = 'From Files', onChange = () => {} } = {}) {
  const st = { files: [] };
  const ul = el('ul', { class: 'filelist' });
  const drop = el('button', { class: 'drop', onclick: async () => {
    const f = await pickFiles(accept, multiple);
    if (!f.length) return;
    st.files = multiple ? [...st.files, ...f] : f.slice(0, 1); render();
  } });
  const render = () => {
    drop.replaceChildren(icon(accept.startsWith('image') ? 'photos' : 'doc'), el('span', { textContent: st.files.length ? (multiple ? 'Add More' : 'Choose Another') : label }), el('small', { textContent: hint }));
    ul.replaceChildren(...st.files.map((f, i) => el('li', {},
      el('span', { class: 'ic' }, icon(f.type.startsWith('image') ? 'photo' : 'doc')),
      el('span', {}, el('b', { textContent: f.name }), el('small', { textContent: fmtSize(f.size) })),
      multiple && st.files.length > 1 && i > 0 ? el('button', { 'aria-label': 'Move up', onclick: () => { [st.files[i - 1], st.files[i]] = [st.files[i], st.files[i - 1]]; render(); } }, icon('back', '')) : null,
      el('button', { 'aria-label': 'Remove', onclick: () => { st.files.splice(i, 1); render(); } }, icon('x')))));
    ul.querySelectorAll('button[aria-label="Move up"] svg').forEach((s) => (s.style.transform = 'rotate(90deg)'));
    onChange(st.files);
  };
  body.append(drop, ul); render();
  return st;
}
function parseRanges(s, n) {
  const out = [];
  for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; } else if (/^\d+$/.test(part)) { a = b = +part; } else throw new Error(`“${part}” isn’t a page number`);
    if (a < 1 || b > n || a > b) throw new Error(`This PDF has pages 1 to ${n}`);
    for (let i = a; i <= b; i++) out.push(i - 1);
  }
  if (!out.length) throw new Error('Type the pages you want, like 1-3, 5');
  return out;
}
async function loadPdf(file, password) {
  await loadPdfLib();
  const bytes = await file.arrayBuffer();
  try { return await PDFLib.PDFDocument.load(bytes, password !== undefined ? { password } : {}); }
  catch (e) {
    if (/encrypt|password/i.test(e.message)) throw new Error(`“${file.name}” has a password. Remove it first.`);
    throw new Error(`“${file.name}” couldn’t be opened`);
  }
}
const btn = (label, onclick, primary = true, disabled = false) => el('button', { class: 'btn' + (primary ? ' primary' : ''), textContent: label, onclick, disabled });
const field = (...inputs) => el('div', { class: 'field' }, inputs);

const TOOLS = {
  merge: () => openTool('Combine PDFs', (body, cta) => {
    body.append(lead('Choose two or more PDFs. They’re joined in the order shown.'));
    const go = btn('Combine', () => run('Combining…', async () => {
      await loadPdfLib();
      const out = await PDFLib.PDFDocument.create();
      for (const f of st.files) { const src = await loadPdf(f); (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p)); }
      const bytes = await out.save(); busy(); await deliver([pdfFile(bytes, 'Combined.pdf')]);
    }), true, true);
    const st = filePicker(body, { label: 'Choose PDFs', onChange: (f) => (go.disabled = f.length < 2) });
    cta.append(go);
  }),

  split: () => openTool('Split PDF', (body, cta) => {
    body.append(lead('Pick a PDF, then type the pages to keep. Leave empty to save every page as its own file.'));
    const rng = el('input', { type: 'text', placeholder: 'Pages, e.g. 1-3, 5', inputMode: 'numeric' });
    const go = btn('Save Pages', () => run('Splitting…', async () => {
      const src = await loadPdf(st.files[0]);
      if (rng.value.trim()) {
        const idx = parseRanges(rng.value, src.getPageCount());
        const out = await PDFLib.PDFDocument.create(); (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
        busy(); await deliver([pdfFile(await out.save(), `${baseName(st.files[0])} (pages).pdf`)]);
      } else {
        const files = [];
        for (const i of src.getPageIndices()) { const out = await PDFLib.PDFDocument.create(); const [p] = await out.copyPages(src, [i]); out.addPage(p); files.push(pdfFile(await out.save(), `${baseName(st.files[0])} p${i + 1}.pdf`)); }
        busy(); await deliver(files);
      }
    }), true, true);
    const st = filePicker(body, { multiple: false, onChange: (f) => (go.disabled = !f.length) });
    body.append(el('h2', { class: 'ghead', textContent: 'Pages' }), field(rng));
    cta.append(go);
  }),

  compress: () => openTool('Reduce File Size', (body, cta) => {
    body.append(lead('Best for scanned PDFs. Pages are saved as images, so text can’t be selected afterwards.'));
    let level = 'med';
    const seg = el('div', { class: 'seg' }, [['low', 'Smallest'], ['med', 'Balanced'], ['high', 'Sharper']].map(([v, l]) => el('button', { textContent: l, class: v === level ? 'on' : '', onclick: (e) => { level = v; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); } })));
    const res = el('div', { class: 'result' });
    const go = btn('Reduce Size', () => run('Reducing…', async () => {
      const f = st.files[0];
      const [scale, jq] = { low: [1.0, 0.5], med: [1.4, 0.62], high: [2.0, 0.75] }[level];
      const pdfjs = await loadPdfJs(); await loadPdfLib();
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      const out = await PDFLib.PDFDocument.create();
      for (let i = 1; i <= doc.numPages; i++) {
        busy(`Reducing page ${i} of ${doc.numPages}…`);
        const page = await doc.getPage(i), vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale });
        const c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const jpg = await out.embedJpg(await (await canvasToBlob(c, jq)).arrayBuffer());
        out.addPage([vp1.width, vp1.height]).drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      }
      const bytes = await out.save();
      if (bytes.length >= f.size) { res.replaceChildren(icon('check'), el('span', { textContent: 'This PDF is already as small as it can be.' })); return; }
      res.replaceChildren(icon('check'), el('span', { textContent: `${fmtSize(f.size)} → ${fmtSize(bytes.length)} · ${Math.round(100 - bytes.length / f.size * 100)}% smaller` }));
      busy(); await deliver([pdfFile(bytes, `${baseName(f)} (small).pdf`)]);
    }), true, true);
    const st = filePicker(body, { multiple: false, onChange: (f) => { go.disabled = !f.length; res.replaceChildren(); } });
    body.append(el('h2', { class: 'ghead', textContent: 'Quality' }), seg, res);
    cta.append(go);
  }),

  lock: () => openTool('Add Password', (body, cta) => {
    body.append(lead('Anyone opening the PDF will need this password. It can’t be recovered if you forget it.'));
    const pw = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'new-password' });
    const pw2 = el('input', { type: 'password', placeholder: 'Confirm Password', autocomplete: 'new-password' });
    const go = btn('Protect PDF', () => run('Protecting…', async () => {
      if (!pw.value) throw new Error('Enter a password');
      if (pw.value !== pw2.value) throw new Error('Passwords don’t match');
      const doc = await loadPdf(st.files[0]);
      doc.encrypt({ userPassword: pw.value, ownerPassword: pw.value, permissions: { printing: 'highResolution', copying: true, modifying: true } });
      busy(); await deliver([pdfFile(await doc.save(), `${baseName(st.files[0])} (protected).pdf`)]);
    }), true, true);
    const st = filePicker(body, { multiple: false, onChange: (f) => (go.disabled = !f.length) });
    body.append(el('h2', { class: 'ghead', textContent: 'Password' }), field(pw, pw2));
    cta.append(go);
  }),

  unlock: () => openTool('Remove Password', (body, cta) => {
    body.append(lead('Enter the current password to save a copy that opens without one.'));
    const pw = el('input', { type: 'password', placeholder: 'Current Password', autocomplete: 'current-password' });
    const go = btn('Remove Password', () => run('Unlocking…', async () => {
      await loadPdfLib();
      let doc;
      try { doc = await PDFLib.PDFDocument.load(await st.files[0].arrayBuffer(), { password: pw.value }); }
      catch (e) { throw new Error('Wrong password'); }
      const out = await PDFLib.PDFDocument.create();
      (await out.copyPages(doc, doc.getPageIndices())).forEach((p) => out.addPage(p));
      busy(); await deliver([pdfFile(await out.save(), `${baseName(st.files[0])} (unlocked).pdf`)]);
    }), true, true);
    const st = filePicker(body, { multiple: false, onChange: (f) => (go.disabled = !f.length) });
    body.append(el('h2', { class: 'ghead', textContent: 'Password' }), field(pw));
    cta.append(go);
  }),

  img2pdf: () => openTool('Photos to PDF', (body, cta) => {
    body.append(lead('Each photo becomes one page.'));
    const share = btn('Share PDF', () => run('Creating PDF…', async () => {
      const blob = await imagesToPdfBlob(st.files); busy(); await deliver([pdfFile(blob, 'Photos.pdf')]);
    }), true, true);
    const save = btn('Save to Documents', () => run('Saving…', async () => {
      const pages = [];
      for (const f of st.files) { const b = await canvasToBlob(await blobToCanvas(f, MAX_SIDE)); pages.push(mkPage(b)); }
      const d = await newDoc(`Photos ${stamp()}`, pages); busy(); toast('Saved to Documents'); openDoc(d.id);
    }), false, true);
    const st = filePicker(body, { accept: 'image/*', label: 'Choose Photos', hint: 'From your library', onChange: (f) => (share.disabled = save.disabled = !f.length) });
    cta.append(share, save);
  }),

  pdf2img: () => openTool('PDF to Photos', (body, cta) => {
    body.append(lead('Every page is saved as a high-quality image.'));
    const render = async () => {
      const f = st.files[0], pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise; const imgs = [];
      for (let i = 1; i <= doc.numPages; i++) {
        busy(`Page ${i} of ${doc.numPages}…`);
        const page = await doc.getPage(i), vp = page.getViewport({ scale: 2 });
        const c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise; imgs.push(await canvasToBlob(c, 0.9));
      }
      return { f, imgs };
    };
    const share = btn('Save Photos', () => run('Converting…', async () => { const { f, imgs } = await render(); busy(); await deliver(imgs.map((b, i) => new File([b], `${baseName(f)} ${i + 1}.jpg`, { type: 'image/jpeg' }))); }), true, true);
    const imp = btn('Add to Documents', () => run('Importing…', async () => { const { f, imgs } = await render(); const d = await newDoc(baseName(f), imgs.map((b) => mkPage(b))); busy(); toast('Added to Documents'); openDoc(d.id); }), false, true);
    const st = filePicker(body, { multiple: false, onChange: (f) => (share.disabled = imp.disabled = !f.length) });
    cta.append(share, imp);
  }),

  signature: (back) => {
    const data = localStorage.getItem('signature');
    openTool('My Signature', (body, cta) => {
      body.append(lead('Draw your signature once. Then open any page and tap Sign to place it.'));
      body.append(el('div', { class: 'sigprev' }, data ? el('img', { src: data, alt: 'Your signature' }) : el('span', { style: 'color:#8e8e93', textContent: 'No signature yet' })));
      cta.append(btn(data ? 'Draw New Signature' : 'Draw Signature', () => openSigPad((ok) => { setTimeout(() => TOOLS.signature(), ok ? 420 : 0); })));
      if (data) cta.append(el('button', { class: 'btn danger', textContent: 'Delete Signature', onclick: async () => { if (await confirmDelete('Delete Signature?')) { localStorage.removeItem('signature'); TOOLS.signature(); } } }));
    }, back);
  },

  idcard: () => {
    const st = { front: null, back: null };
    const build = (body, cta) => {
      body.append(lead('Scan both sides of the card. They’re placed at real size on one A4 page, ready to print.'));
      const slot = (key, label) => el('button', { class: 'slot', onclick: () => openCamera({ single: (c) => { if (c) st[key] = c.width < c.height ? rotateCanvas(c) : c; openTool('ID Card', build); } }) },
        el('div', { class: 'ph' + (st[key] ? ' has' : ''), style: st[key] ? `background-image:url(${st[key].toDataURL('image/jpeg', 0.6)})` : '' }, st[key] ? null : icon('camera')),
        el('b', { textContent: label }), el('small', { textContent: st[key] ? 'Retake' : 'Tap to scan' }));
      body.append(el('div', { class: 'slots' }, slot('front', 'Front'), slot('back', 'Back')));
      cta.append(btn(st.back || !st.front ? 'Create Page' : 'Create Page (front only)', () => run('Creating…', async () => {
        const dpi = 200, mm = dpi / 25.4, A4 = el('canvas', { width: Math.round(210 * mm), height: Math.round(297 * mm) });
        const ctx = A4.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, A4.width, A4.height);
        const cw = 85.6 * mm, ch = 54 * mm, x = (A4.width - cw) / 2;
        const draw = (c, y) => { ctx.save(); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, cw, ch, 3.2 * mm) : ctx.rect(x, y, cw, ch); ctx.clip(); ctx.drawImage(c, x, y, cw, ch); ctx.restore(); ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, cw, ch, 3.2 * mm) : ctx.rect(x, y, cw, ch); ctx.stroke(); };
        draw(st.front, 40 * mm); if (st.back) draw(st.back, 40 * mm + ch + 20 * mm);
        const b = await canvasToBlob(A4, 0.9);
        const d = await newDoc(`ID Card ${stamp()}`, [mkPage(b)]); busy(); toast('ID card saved'); openDoc(d.id);
      }), true, !st.front));
    };
    openTool('ID Card', build);
  },

  passport: async () => {
    const v = await menu('Passport Photo', [{ label: 'Take Photo', value: 'cam', icon: 'camera' }, { label: 'Choose from Photos', value: 'lib', icon: 'photos' }], 'Use a well-lit photo, facing the camera.');
    if (!v) return;
    const f = await pickFiles('image/*', false, v === 'cam' ? 'user' : undefined);
    if (f.length) startPassport(f[0]);
  },
};
document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => {
  const t = b.dataset.tool; toolBack = b.closest('#settings') ? 'settings' : 'tools';
  TOOLS[t](toolBack);
}));

// ---------- Passport photo (India: 35 × 45 mm) ----------
const PP = { img: null, zoom: 1, cx: 0.5, cy: 0.45, drag: null, OUT_W: 413, OUT_H: 531, copies: 12 }; // 300 dpi
let segFrame = null;
/** Runs MediaPipe in an isolated iframe (OpenCV's global `Module` breaks MediaPipe's loader). Returns {canvas, box}. */
async function removeBackground(canvas) {
  if (!segFrame) {
    segFrame = el('iframe', { src: 'seg.html', style: 'display:none' }); document.body.append(segFrame);
    await new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (segFrame.contentWindow && segFrame.contentWindow.segReady) { clearInterval(iv); res(); }
        else if (Date.now() - t0 > 30000) { clearInterval(iv); rej(new Error('timeout')); }
      }, 100);
    });
  }
  const r = await segFrame.contentWindow.segment(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
  const mw = r.width, mh = r.height, m = r.data;
  const out = el('canvas', { width: canvas.width, height: canvas.height }), ctx = out.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const id = ctx.getImageData(0, 0, out.width, out.height), d = id.data;
  const rows = new Array(out.height).fill(null);
  for (let y = 0; y < out.height; y++) {
    const my = Math.min(mh - 1, Math.floor(y * mh / out.height));
    for (let x = 0; x < out.width; x++) {
      const v = m[my * mw + Math.min(mw - 1, Math.floor(x * mw / out.width))];
      const a = Math.min(1, Math.max(0, (v - 0.35) / 0.3)); const i = (y * out.width + x) * 4;
      if (a < 1) { d[i] = d[i] * a + 255 * (1 - a); d[i + 1] = d[i + 1] * a + 255 * (1 - a); d[i + 2] = d[i + 2] * a + 255 * (1 - a); }
      if (v > 0.5) { const rw = rows[y] || (rows[y] = [x, x]); if (x < rw[0]) rw[0] = x; if (x > rw[1]) rw[1] = x; }
    }
  }
  ctx.putImageData(id, 0, 0);
  // estimate the head: top of the person mask, width from the rows just below it
  const top = rows.findIndex((r) => r && r[1] - r[0] > out.width * 0.04);
  let box = null;
  if (top >= 0) {
    const ws = [], cs = [];
    for (let y = top + Math.round(out.height * 0.04); y < Math.min(out.height, top + out.height * 0.14); y++) if (rows[y]) { ws.push(rows[y][1] - rows[y][0]); cs.push((rows[y][0] + rows[y][1]) / 2); }
    if (ws.length) { ws.sort((a, b) => a - b); const w = ws[Math.floor(ws.length * 0.6)]; box = { top, w, cx: cs.reduce((a, b) => a + b, 0) / cs.length }; }
  }
  return { canvas: out, box };
}
async function startPassport(file) {
  busy('Opening photo…');
  try {
    let c = await blobToCanvas(file, 1400), box = null;
    busy('Removing background…');
    try { ({ canvas: c, box } = await removeBackground(c)); $('ppHint').textContent = 'Background removed. Drag to adjust.'; }
    catch (e) { console.warn(e); $('ppHint').textContent = 'Use a plain, light background. Drag to adjust.'; }
    PP.img = c; PP.zoom = 1; PP.cx = 0.5; PP.cy = 0.42;
    if (box) {
      // head (crown→chin ≈ 1.3 × head width) should fill ~60% of the photo height; crown ~10% from the top
      const headH = box.w * 1.32, frameH = headH / 0.6, base = Math.min(c.height, c.width / (35 / 45));
      PP.zoom = Math.min(5, Math.max(1, base / frameH));
      const h = base / PP.zoom; PP.cx = box.cx / c.width; PP.cy = (box.top - h * 0.1 + h / 2) / c.height;
    }
    $('ppZoom').value = Math.round(PP.zoom * 100);
    busy(); show('passport', 'push'); drawPP();
  } catch (e) { busy(); toast('Couldn’t open that photo', 'err'); }
}
function ppRect() {
  const W = PP.img.width, H = PP.img.height, ar = 35 / 45;
  const h = Math.min(H, W / ar) / PP.zoom, w = h * ar;
  let x = PP.cx * W - w / 2, y = PP.cy * H - h / 2;
  x = Math.max(Math.min(x, W - w), 0); y = Math.max(Math.min(y, H - h), 0);
  return { x, y, w, h };
}
function renderPP(c, guides) {
  const ctx = c.getContext('2d'), r = ppRect();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(PP.img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  if (guides) {
    ctx.strokeStyle = 'rgba(10,156,140,.9)'; ctx.setLineDash([10, 7]); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(c.width / 2, c.height * 0.43, c.width * 0.3, c.height * 0.32, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
}
function drawPP() { renderPP($('ppCanvas'), true); }
$('ppCanvas').addEventListener('pointerdown', (e) => { PP.drag = { x: e.clientX, y: e.clientY, cx: PP.cx, cy: PP.cy }; e.target.setPointerCapture(e.pointerId); });
$('ppCanvas').addEventListener('pointermove', (e) => {
  if (!PP.drag) return;
  const r = ppRect(), b = e.target.getBoundingClientRect();
  PP.cx = PP.drag.cx - (e.clientX - PP.drag.x) / b.width * r.w / PP.img.width;
  PP.cy = PP.drag.cy - (e.clientY - PP.drag.y) / b.height * r.h / PP.img.height;
  drawPP();
});
['pointerup', 'pointercancel'].forEach((t) => $('ppCanvas').addEventListener(t, () => { PP.drag = null; }));
$('ppZoom').oninput = () => { PP.zoom = $('ppZoom').value / 100; drawPP(); };
document.querySelectorAll('#ppCopies button').forEach((b) => (b.onclick = () => { PP.copies = +b.dataset.v; document.querySelectorAll('#ppCopies button').forEach((x) => x.classList.toggle('on', x === b)); }));
$('ppBack').onclick = () => show('tools', 'pop');
function ppPhoto() { const c = el('canvas', { width: PP.OUT_W, height: PP.OUT_H }); renderPP(c, false); return c; }
$('ppSingle').onclick = () => run('Saving…', async () => {
  const b = await canvasToBlob(ppPhoto(), 0.95);
  busy(); await deliver([new File([b], 'Passport photo 35x45.jpg', { type: 'image/jpeg' })]);
});
$('ppSheet').onclick = () => run('Creating sheet…', async () => {
  const n = PP.copies, photo = ppPhoto();
  const A4 = el('canvas', { width: 2480, height: 3508 }), ctx = A4.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, A4.width, A4.height);
  const gap = 24, m = 60, cols = 5;
  for (let i = 0; i < n; i++) {
    const x = m + (i % cols) * (PP.OUT_W + gap), y = m + Math.floor(i / cols) * (PP.OUT_H + gap);
    ctx.drawImage(photo, x, y); ctx.strokeStyle = '#bdbdbd'; ctx.lineWidth = 2; ctx.strokeRect(x, y, PP.OUT_W, PP.OUT_H);
  }
  const b = await canvasToBlob(A4, 0.92);
  const d = await newDoc(`Passport Photos ${stamp()}`, [mkPage(b)]);
  busy(); toast('Saved · print at 100% size'); openDoc(d.id);
});
