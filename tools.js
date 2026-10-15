'use strict';
/* DocSnap tools: ID card, passport photo, signature, PDF tools. All client-side. */
const loadPdfLib = () => loadScript('vendor/pdf-lib.min.js');
async function loadPdfJs() {
  await loadScript('vendor/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  return pdfjsLib;
}
const pdfFile = (bytes, name) => new File([bytes], name, { type: 'application/pdf' });
const baseName = (f) => f.name.replace(/\.[^.]+$/, '');
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB');

function openTool(title, build) {
  $('toolTitle').textContent = title;
  const body = $('toolBody'); body.innerHTML = '';
  build(body);
  show('tool');
}
$('toolBack').onclick = () => setTab('tools');
async function run(msg, fn) {
  busy(msg);
  try { await fn(); } catch (e) { console.error(e); toast(e.message || String(e)); }
  busy();
}
/** Reusable "pick PDFs" list UI. */
function fileListUI(body, { accept = 'application/pdf', multiple = true, label = 'Choose PDF' } = {}) {
  const state = { files: [] };
  const ul = el('ul', { class: 'filelist' });
  const render = () => {
    ul.innerHTML = '';
    state.files.forEach((f, i) => ul.append(el('li', {},
      el('span', { textContent: `${i + 1}. ${f.name} (${fmtSize(f.size)})` }),
      multiple && i > 0 ? el('button', { textContent: '▲', onclick: () => { [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]]; render(); } }) : null,
      el('button', { textContent: '✕', onclick: () => { state.files.splice(i, 1); render(); } }))));
  };
  body.append(el('div', { class: 'row' }, el('button', { textContent: '＋ ' + label, onclick: async () => {
    const f = await pickFiles(accept, multiple);
    state.files = multiple ? [...state.files, ...f] : f.slice(0, 1); render();
  } })), ul);
  return state;
}
/** Parse "1-3, 5, 8-" into 0-based indices. */
function parseRanges(s, n) {
  const out = [];
  for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; } else if (/^\d+$/.test(part)) { a = b = +part; } else throw new Error(`Bad range: "${part}"`);
    if (a < 1 || b > n || a > b) throw new Error(`Range ${part} is outside 1-${n}`);
    for (let i = a; i <= b; i++) out.push(i - 1);
  }
  if (!out.length) throw new Error('Enter pages, e.g. 1-3,5');
  return out;
}
async function loadPdf(file, password) {
  await loadPdfLib();
  const bytes = await file.arrayBuffer();
  try {
    return await PDFLib.PDFDocument.load(bytes, password !== undefined ? { password } : {});
  } catch (e) {
    if (/encrypt|password/i.test(e.message)) throw new Error(`"${file.name}" is password-protected. Use Remove Password first.`);
    throw e;
  }
}

const TOOLS = {
  // ----- PDF: merge -----
  merge: () => openTool('Merge PDFs', (body) => {
    body.append(el('p', { textContent: 'Pick 2 or more PDFs. Use ▲ to change the order.' }));
    const st = fileListUI(body);
    body.append(el('div', { class: 'row' }, el('button', { class: 'primary', textContent: 'Merge & share', onclick: () => run('Merging…', async () => {
      if (st.files.length < 2) throw new Error('Pick at least 2 PDFs');
      await loadPdfLib();
      const out = await PDFLib.PDFDocument.create();
      for (const f of st.files) {
        const src = await loadPdf(f);
        (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      busy(); await deliver([pdfFile(bytes, 'Merged.pdf')]);
    }) })));
  }),

  // ----- PDF: split / extract -----
  split: () => openTool('Split / Extract pages', (body) => {
    const st = fileListUI(body, { multiple: false });
    const rng = el('input', { type: 'text', placeholder: 'e.g. 1-3, 5, 8-', inputMode: 'text' });
    body.append(el('label', { textContent: 'Pages to extract' }), rng);
    body.append(el('div', { class: 'row' },
      el('button', { class: 'primary', textContent: 'Extract to one PDF', onclick: () => run('Extracting…', async () => {
        if (!st.files[0]) throw new Error('Choose a PDF');
        const src = await loadPdf(st.files[0]);
        const idx = parseRanges(rng.value, src.getPageCount());
        const out = await PDFLib.PDFDocument.create();
        (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
        busy(); await deliver([pdfFile(await out.save(), `${baseName(st.files[0])}_pages.pdf`)]);
      }) }),
      el('button', { textContent: 'Split every page', onclick: () => run('Splitting…', async () => {
        if (!st.files[0]) throw new Error('Choose a PDF');
        const src = await loadPdf(st.files[0]);
        const idx = rng.value.trim() ? parseRanges(rng.value, src.getPageCount()) : src.getPageIndices();
        const files = [];
        for (const i of idx) {
          const out = await PDFLib.PDFDocument.create();
          const [p] = await out.copyPages(src, [i]); out.addPage(p);
          files.push(pdfFile(await out.save(), `${baseName(st.files[0])}_p${i + 1}.pdf`));
        }
        busy(); await deliver(files);
      }) })));
  }),

  // ----- PDF: compress (re-render pages as JPEG) -----
  compress: () => openTool('Compress PDF', (body) => {
    const st = fileListUI(body, { multiple: false });
    const q = el('select', {}, el('option', { value: 'low', textContent: 'Smallest (lower quality)' }),
      el('option', { value: 'med', textContent: 'Balanced', selected: true }), el('option', { value: 'high', textContent: 'Better quality' }));
    body.append(el('label', { textContent: 'Level' }), q,
      el('p', { class: 'note', textContent: 'Pages are re-saved as images, so text will no longer be selectable. Works best for scanned PDFs.' }));
    const res = el('p');
    body.append(el('div', { class: 'row' }, el('button', { class: 'primary', textContent: 'Compress & share', onclick: () => run('Compressing…', async () => {
      const f = st.files[0]; if (!f) throw new Error('Choose a PDF');
      const [scale, jq] = { low: [1.0, 0.5], med: [1.4, 0.62], high: [2.0, 0.75] }[q.value];
      const pdfjs = await loadPdfJs(); await loadPdfLib();
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      const out = await PDFLib.PDFDocument.create();
      for (let i = 1; i <= doc.numPages; i++) {
        busy(`Compressing page ${i}/${doc.numPages}…`);
        const page = await doc.getPage(i), vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale });
        const c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const jpg = await out.embedJpg(await (await canvasToBlob(c, jq)).arrayBuffer());
        out.addPage([vp1.width, vp1.height]).drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      }
      const bytes = await out.save();
      res.textContent = `${fmtSize(f.size)} → ${fmtSize(bytes.length)} (${Math.round(100 - bytes.length / f.size * 100)}% smaller)`;
      if (bytes.length >= f.size) { res.textContent = 'This PDF is already well compressed (no smaller version possible).'; return; }
      busy(); await deliver([pdfFile(bytes, `${baseName(f)}_compressed.pdf`)]);
    }) })), res);
  }),

  // ----- PDF: add password (AES-256) -----
  lock: () => openTool('Add password', (body) => {
    const st = fileListUI(body, { multiple: false });
    const pw = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'new-password' });
    const pw2 = el('input', { type: 'password', placeholder: 'Repeat password', autocomplete: 'new-password' });
    body.append(el('label', { textContent: 'Password' }), pw, el('label', { textContent: 'Confirm' }), pw2,
      el('p', { class: 'note', textContent: 'Encrypted with AES-256. Don\'t forget the password, it cannot be recovered.' }));
    body.append(el('div', { class: 'row' }, el('button', { class: 'primary', textContent: 'Lock & share', onclick: () => run('Encrypting…', async () => {
      const f = st.files[0]; if (!f) throw new Error('Choose a PDF');
      if (!pw.value) throw new Error('Enter a password');
      if (pw.value !== pw2.value) throw new Error('Passwords do not match');
      const doc = await loadPdf(f);
      doc.encrypt({ userPassword: pw.value, ownerPassword: pw.value, permissions: { printing: 'highResolution', copying: true, modifying: true } });
      busy(); await deliver([pdfFile(await doc.save(), `${baseName(f)}_locked.pdf`)]);
    }) })));
  }),

  // ----- PDF: remove password -----
  unlock: () => openTool('Remove password', (body) => {
    const st = fileListUI(body, { multiple: false });
    const pw = el('input', { type: 'password', placeholder: 'Current password', autocomplete: 'current-password' });
    body.append(el('label', { textContent: 'Current password' }), pw,
      el('p', { class: 'note', textContent: 'You need to know the password. This only removes it so the file opens without one.' }));
    body.append(el('div', { class: 'row' }, el('button', { class: 'primary', textContent: 'Unlock & share', onclick: () => run('Decrypting…', async () => {
      const f = st.files[0]; if (!f) throw new Error('Choose a PDF');
      await loadPdfLib();
      let doc;
      try { doc = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { password: pw.value }); }
      catch (e) { throw new Error('Wrong password or unsupported encryption'); }
      // copy pages into a fresh document so no encryption dictionary is carried over
      const out = await PDFLib.PDFDocument.create();
      (await out.copyPages(doc, doc.getPageIndices())).forEach((p) => out.addPage(p));
      busy(); await deliver([pdfFile(await out.save(), `${baseName(f)}_unlocked.pdf`)]);
    }) })));
  }),

  // ----- Images → PDF -----
  img2pdf: () => openTool('Images → PDF', (body) => {
    const st = fileListUI(body, { accept: 'image/*', label: 'Choose images' });
    body.append(el('div', { class: 'row' },
      el('button', { class: 'primary', textContent: 'Create PDF & share', onclick: () => run('Creating PDF…', async () => {
        if (!st.files.length) throw new Error('Choose images');
        const blob = await imagesToPdfBlob(st.files);
        busy(); await deliver([pdfFile(blob, 'Images.pdf')]);
      }) }),
      el('button', { textContent: 'Save as document', onclick: () => run('Saving…', async () => {
        if (!st.files.length) throw new Error('Choose images');
        const pages = [];
        for (const f of st.files) { const b = await canvasToBlob(await blobToCanvas(f, MAX_SIDE)); pages.push({ orig: b, img: b, filter: 'original', text: '' }); }
        const d = await newDoc(`Images ${stamp()}`, pages); busy(); openDoc(d.id);
      }) })));
  }),

  // ----- PDF → Images -----
  pdf2img: () => openTool('PDF → Images', (body) => {
    const st = fileListUI(body, { multiple: false });
    const render = async () => {
      const f = st.files[0]; if (!f) throw new Error('Choose a PDF');
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      const imgs = [];
      for (let i = 1; i <= doc.numPages; i++) {
        busy(`Rendering page ${i}/${doc.numPages}…`);
        const page = await doc.getPage(i), vp = page.getViewport({ scale: 2 });
        const c = el('canvas', { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        imgs.push(await canvasToBlob(c, 0.9));
      }
      return { f, imgs };
    };
    body.append(el('div', { class: 'row' },
      el('button', { class: 'primary', textContent: 'Export JPGs', onclick: () => run('Rendering…', async () => {
        const { f, imgs } = await render();
        busy(); await deliver(imgs.map((b, i) => new File([b], `${baseName(f)}_${i + 1}.jpg`, { type: 'image/jpeg' })));
      }) }),
      el('button', { textContent: 'Import as document', onclick: () => run('Importing…', async () => {
        const { f, imgs } = await render();
        const d = await newDoc(baseName(f), imgs.map((b) => ({ orig: b, img: b, filter: 'original', text: '' })));
        busy(); openDoc(d.id);
      }) })));
  }),

  // ----- Signature -----
  signature: () => {
    const data = localStorage.getItem('signature');
    openTool('My signature', (body) => {
      body.append(data ? el('img', { src: data, style: 'max-width:100%;background:#fff;border-radius:12px;padding:8px' }) : el('p', { textContent: 'No signature saved yet.' }),
        el('p', { class: 'note', textContent: 'To sign a document: open a page → ✍️ Sign, then drag it into place.' }),
        el('div', { class: 'row' }, el('button', { class: 'primary', textContent: data ? 'Draw new' : 'Draw signature', onclick: () => openSigPad((ok) => TOOLS.signature()) }),
          data ? el('button', { class: 'danger', textContent: 'Delete', onclick: () => { localStorage.removeItem('signature'); TOOLS.signature(); } }) : null));
    });
  },

  // ----- ID card: front + back on one A4 -----
  idcard: () => {
    const st = { front: null, back: null };
    const build = (body) => {
      body.append(el('p', { textContent: 'Scan both sides. Each side is auto-cropped, then both are placed at real card size (85.6 × 54 mm) on one A4 page, ready to print.' }));
      const slot = (key, label) => el('div', { class: 'slot' },
        st[key] ? el('img', { src: st[key].toDataURL('image/jpeg', 0.7) }) : el('p', { textContent: label }),
        el('button', { textContent: st[key] ? 'Rescan' : 'Scan ' + label.toLowerCase(), onclick: () => scanOne(`ID card – ${label}`, (c) => { if (c) st[key] = c.width < c.height ? rotateCanvas(c) : c; openTool('ID Card', build); }) }));
      body.append(el('div', { class: 'slots' }, slot('front', 'Front'), slot('back', 'Back')));
      body.append(el('div', { class: 'row' }, el('button', { class: 'primary', textContent: 'Create A4 page', onclick: () => run('Composing…', async () => {
        if (!st.front) throw new Error('Scan the front first');
        const dpi = 200, mm = dpi / 25.4, A4 = el('canvas', { width: Math.round(210 * mm), height: Math.round(297 * mm) });
        const ctx = A4.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, A4.width, A4.height);
        const cw = 85.6 * mm, ch = 54 * mm, x = (A4.width - cw) / 2;
        const draw = (c, y) => { ctx.drawImage(c, x, y, cw, ch); ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; ctx.strokeRect(x, y, cw, ch); };
        draw(st.front, 40 * mm);
        if (st.back) draw(st.back, 40 * mm + ch + 20 * mm);
        const b = await canvasToBlob(A4, 0.9);
        const d = await newDoc(`ID Card ${stamp()}`, [{ orig: b, img: b, filter: 'original', text: '' }]);
        busy(); openDoc(d.id);
      }) })));
    };
    openTool('ID Card', build);
  },

  passport: () => chooseSource((files) => startPassport(files[0]), 'Passport photo', false),
};
document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => TOOLS[b.dataset.tool]()));

// ---------- Passport photo (India: 35 × 45 mm) ----------
const PP = { img: null, zoom: 1, cx: 0.5, cy: 0.45, drag: null, OUT_W: 413, OUT_H: 531 }; // 300 dpi
let segFrame = null;
async function removeBackground(canvas) {
  if (!segFrame) {
    segFrame = el('iframe', { src: 'seg.html', style: 'display:none' }); document.body.append(segFrame);
    await new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (segFrame.contentWindow && segFrame.contentWindow.segReady) { clearInterval(iv); res(); }
        else if (Date.now() - t0 > 30000) { clearInterval(iv); rej(new Error('segmenter load timeout')); }
      }, 100);
    });
  }
  const src = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const r = await segFrame.contentWindow.segment(src);
  const mw = r.width, mh = r.height, m = r.data;
  const out = el('canvas', { width: canvas.width, height: canvas.height }), ctx = out.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const id = ctx.getImageData(0, 0, out.width, out.height), d = id.data;
  for (let y = 0; y < out.height; y++) {
    const my = Math.min(mh - 1, Math.floor(y * mh / out.height));
    for (let x = 0; x < out.width; x++) {
      const v = m[my * mw + Math.min(mw - 1, Math.floor(x * mw / out.width))];
      const a = Math.min(1, Math.max(0, (v - 0.35) / 0.3)); const i = (y * out.width + x) * 4;
      d[i] = d[i] * a + 255 * (1 - a); d[i + 1] = d[i + 1] * a + 255 * (1 - a); d[i + 2] = d[i + 2] * a + 255 * (1 - a);
    }
  }
  ctx.putImageData(id, 0, 0);
  return out;
}
async function startPassport(file) {
  busy('Loading photo…');
  try {
    let c = await blobToCanvas(file, 1400);
    busy('Removing background…');
    try { c = await removeBackground(c); $('ppHint').textContent = 'Background made white. Drag to fit the face in the oval.'; }
    catch (e) { console.warn(e); $('ppHint').textContent = 'Background removal unavailable – use a photo with a plain light background. Drag to fit the face.'; }
    PP.img = c; PP.zoom = 1; PP.cx = 0.5; PP.cy = 0.42; $('ppZoom').value = 100;
    busy(); show('passport'); drawPP();
  } catch (e) { busy(); toast('Could not open photo: ' + e.message); }
}
/** Source rectangle (in image px) that maps to the 35×45 frame. */
function ppRect() {
  const W = PP.img.width, H = PP.img.height, ar = 35 / 45;
  let h = Math.min(H, W / ar) / PP.zoom, w = h * ar;
  let x = PP.cx * W - w / 2, y = PP.cy * H - h / 2;
  x = Math.max(Math.min(x, W - w), 0); y = Math.max(Math.min(y, H - h), 0);
  return { x, y, w, h };
}
function renderPP(c, guides) {
  const ctx = c.getContext('2d'), r = ppRect();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(PP.img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  if (guides) {
    ctx.strokeStyle = 'rgba(0,137,123,.9)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
    // face oval: head ~ 70-80% of photo height
    ctx.beginPath(); ctx.ellipse(c.width / 2, c.height * 0.43, c.width * 0.3, c.height * 0.33, 0, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
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
$('ppBack').onclick = () => setTab('tools');
function ppPhoto() { const c = el('canvas', { width: PP.OUT_W, height: PP.OUT_H }); renderPP(c, false); return c; }
$('ppSingle').onclick = () => run('Saving…', async () => {
  const b = await canvasToBlob(ppPhoto(), 0.95);
  busy(); await deliver([new File([b], 'passport_35x45.jpg', { type: 'image/jpeg' })]);
});
$('ppSheet').onclick = () => run('Creating sheet…', async () => {
  const n = +$('ppCopies').value, photo = ppPhoto();
  const A4 = el('canvas', { width: 2480, height: 3508 }), ctx = A4.getContext('2d'); // 300 dpi
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, A4.width, A4.height);
  const gap = 24, m = 60, cols = 5;
  for (let i = 0; i < n; i++) {
    const x = m + (i % cols) * (PP.OUT_W + gap), y = m + Math.floor(i / cols) * (PP.OUT_H + gap);
    ctx.drawImage(photo, x, y); ctx.strokeStyle = '#999'; ctx.lineWidth = 2; ctx.strokeRect(x, y, PP.OUT_W, PP.OUT_H);
  }
  const b = await canvasToBlob(A4, 0.92);
  const d = await newDoc(`Passport photos ${stamp()}`, [{ orig: b, img: b, filter: 'original', text: '' }]);
  busy(); toast('Saved. Print the PDF at 100% (actual size).'); openDoc(d.id);
});
