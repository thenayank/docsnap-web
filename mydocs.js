'use strict';
/* DocSnap 3.5 — "My Docs": a family document vault. UI + flows; all crypto is in vault.js.
   Screens follow Vision's approved mockups (docsnap-audit/my-documents/mockups, 21 Oct 2026) and Loki's flow rev 2. */
const MD = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const DAY = 864e5;
  const FINAL_LINE = 'Naye phone par documents sirf do tarah se milenge: iPhone ka iCloud backup restore karke recovery code daalne par, ya DocSnap backup file import karne par. Isliye DocSnap backup zaroor lein.';
  const DELETE_LINE = 'DocSnap icon delete karne se saara data mit jaata hai. Pehle backup lein.';
  const DIGILOCKER = 'https://www.digilocker.gov.in/';
  // ---- slot types (10 per member, Other last) ----
  const TYPES = [
    { k: 'aadhaar', n: 'Aadhaar', full: 'Aadhaar', short: 'Aadhaar', mode: 'card', sides: 2, mask: true, alias: 'aadhaar aadhar uid uidai' },
    { k: 'pan', n: 'PAN', full: 'PAN Card', short: 'PAN', mode: 'card', sides: 2, alias: 'pan card income tax' },
    { k: 'passport', n: 'Passport', full: 'Passport', short: 'Passport', mode: 'book', sides: 2, exp: true, alias: 'passport' },
    { k: 'dl', n: 'Driving Licence', full: 'Driving Licence', short: 'DL', mode: 'card', sides: 2, exp: true, alias: 'dl driving licence license' },
    { k: 'voter', n: 'Voter ID', full: 'Voter ID', short: 'Voter ID', mode: 'card', sides: 2, alias: 'voter id epic election' },
    { k: 'ration', n: 'Ration Card', full: 'Ration Card', short: 'Ration Card', mode: 'doc', sides: 0, alias: 'ration card' },
    { k: 'birth', n: 'Birth Certificate', full: 'Birth Certificate', short: 'Birth Certificate', mode: 'doc', sides: 0, alias: 'birth certificate janm' },
    { k: 'marks', n: 'Marksheets', full: 'Marksheets', short: 'Marksheet', mode: 'doc', sides: 0, alias: 'marksheets marksheet marks result' },
    { k: 'ins', n: 'Insurance', full: 'Insurance', short: 'Insurance', mode: 'doc', sides: 0, exp: true, alias: 'insurance policy health' },
    { k: 'other', n: 'Other', full: 'Other', short: 'document', mode: 'doc', sides: 0, alias: 'other' },
  ];
  const T = Object.fromEntries(TYPES.map((t) => [t.k, t]));
  const RELS = ['Papa', 'Mummy', 'Spouse', 'Son', 'Daughter', 'Other'];
  const COLORS = ['#2dd4bf', '#60a5fa', '#f5b44a', '#a78bfa', '#f87171', '#4ade80', '#fb923c'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // ---- icons (DocSnap v2 set from the mockups: 24pt grid, 1.75 stroke, folded-corner motif) ----
  function sheetP(x, y, w, h, f, r = 2.5) { const X = x + w, Y = y + h; return `<path d="M${X - f} ${y}H${x + r}a${r} ${r} 0 0 0-${r} ${r}V${Y - r}a${r} ${r} 0 0 0 ${r} ${r}H${X - r}a${r} ${r} 0 0 0 ${r}-${r}V${y + f}z"/><path d="M${X - f} ${y}v${f - 1}a1 1 0 0 0 1 1h${f - 1}"/>`; }
  const P = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4 20.5 20.5"/><path d="M7.6 9.2a3 3 0 0 1 1.9-1.9"/>',
    lock: sheetP(5, 8.5, 14, 12.5, 3.5) + '<path d="M8.5 8.5V7a3.5 3.5 0 0 1 7 0"/><path d="M12 13.5v3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', chev: '<path d="m9.5 6 6 6-6 6"/>', x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    share: '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8 11H6.5A2.5 2.5 0 0 0 4 13.5v4.5a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-4.5a2.5 2.5 0 0 0-2.5-2.5H16"/>',
    more: '<circle cx="5.5" cy="12" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="18.5" cy="12" r=".9"/>',
    arrow: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
    mydocs: '<path d="M12 2.8 19.5 5.6V11c0 4.7-3.1 8.5-7.5 10.2C7.6 19.5 4.5 15.7 4.5 11V5.6z"/><path d="M9 8.5h3.6l2.4 2.4V15.5H9z"/><path d="M12.6 8.5v2.4H15"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.8"/><path d="M10.5 18.5h3"/>',
    faceid: '<path d="M3.5 8V6a2.5 2.5 0 0 1 2.5-2.5h2M16 3.5h2A2.5 2.5 0 0 1 20.5 6v2M20.5 16v2a2.5 2.5 0 0 1-2.5 2.5h-2M8 20.5H6A2.5 2.5 0 0 1 3.5 18v-2"/><path d="M8.5 9v1.5M15.5 9v1.5M12 9v3.5h-1"/><path d="M9 15.5c1.7 1.4 4.3 1.4 6 0"/>',
    backup: '<path d="M17.5 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V5"/><path d="M12 8v8M8.5 12.5 12 16l3.5-3.5"/>',
    importb: '<path d="M17.5 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V5"/><path d="M12 16V8M8.5 11.5 12 8l3.5 3.5"/>',
    warn: '<path d="M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.2v.1"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>', plus: '<path d="M12 5v14M5 12h14"/>', back: '<path d="m14.5 6-6 6 6 6"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    replace: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L20 9.5M20 4.5v5h-5"/><path d="M19.5 12a7.5 7.5 0 0 1-13 5.1L4 14.5M4 19.5v-5h5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M4 4l16 16"/><path d="M9.9 6c.7-.3 1.4-.5 2.1-.5 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.5 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.5 4.2-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    key: '<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8 20 3M17 6l2.5 2.5M14.5 8.5 16.5 10.5"/>',
    del2: '<path d="M9 5.5h10.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L3 12z"/><path d="m11.5 9.5 5 5M16.5 9.5l-5 5"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M3 19.5c.8-3.2 3.2-5 6-5s5.2 1.8 6 5"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.8c1.7.7 3 2.2 3.5 4.7"/>',
  };
  const ic = (n, cls = '', st = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"${st ? ` style="${st}"` : ''}>${P[n] || ''}</svg>`;

  // ---- state ----
  const st = { member: null, q: '', urls: [], pin: null, forced: false, after: null, hiddenAt: 0, grace: 0, cached: 'none', prfOn: false, setupCode: null, share: null };
  const urlOf = (b) => { const u = URL.createObjectURL(b); st.urls.push(u); return u; };
  function freeUrls() { st.urls.forEach((u) => URL.revokeObjectURL(u)); st.urls = []; }
  const I = () => Vault.index();
  const memberOf = (id) => I().members.find((m) => m.id === id);
  const docsOf = (mid) => I().docs.filter((d) => d.member === mid);
  const isMdView = (v) => ['mydocs', 'mdflow', 'mddoc', 'mdbackup', 'mdbpw'].includes(v);
  const fmtDate = (s) => { const d = new Date(s + 'T00:00:00'); return `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
  const daysTo = (s) => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(s + 'T00:00:00') - t) / DAY); };
  const possessive = (m) => (m.name === 'Aap' ? 'Aapka' : `${m.name} ka`);
  function ago(ts) { if (!ts) return 'never'; const d = Math.floor((Date.now() - ts) / DAY); return d <= 0 ? 'aaj' : d === 1 ? 'kal' : `${d} din pehle`; }
  function maskNum(n, type) {
    const s = String(n || '').replace(/\s+/g, ''); if (!s) return '';
    if (type === 'aadhaar') return 'XXXX XXXX ' + s.slice(-4);
    if (type === 'pan' && s.length === 10) return 'XXXXX' + s.slice(5);
    return 'X'.repeat(Math.max(0, s.length - 4)) + s.slice(-4);
  }
  const last4 = (d) => String(d.number || '').replace(/\D/g, '').slice(-4);

  // ======================================================================= entry / lock
  async function refreshCache() { st.cached = await Vault.state(); st.prfOn = await Vault.hasPrf().catch(() => false); st.grace = await Vault.getGrace().catch(() => 0); return st.cached; }
  /** Tab tapped. Runs synchronously into Face ID when possible so iOS keeps the user gesture. */
  function open(fromTap) {
    if (Vault.isUnlocked()) { renderHome(); return; }
    if (st.cached === 'locked') {
      renderLock();
      if (fromTap && st.prfOn) faceId();
      return;
    }
    $('mdMain').innerHTML = '';
    refreshCache().then((s) => {
      if (s === 'none') return renderIntro();
      if (s === 'newdevice') return renderNewDevice();
      if (s === 'unlocked') return renderHome();
      renderLock();
    });
  }
  function lockNow(reason) {
    const was = Vault.isUnlocked() || Vault.recovering();
    Vault.lock(); freeUrls(); closeShare(true); st.pin = null; st.q = '';
    document.querySelectorAll('.m-viewer').forEach((v) => v.remove());
    $('mdMain').innerHTML = ''; $('mdDoc').innerHTML = ''; $('mdBk').innerHTML = ''; $('mdPw').innerHTML = '';
    if (!st.forced) $('mdFlow').innerHTML = '';
    badge(false);
    if (typeof scan !== 'undefined' && scan.vault) { try { if (typeof camStop === 'function') camStop(); } catch (e) {} scan.pages = []; scan.vault = null; if (typeof freeBatchUrls === 'function') freeBatchUrls(); if (['cam', 'batch', 'review', 'crop'].includes(curView)) { show('mydocs', 'down'); } }
    if (was && sheetResolve) closeSheet(null);
    if (isMdView(curView) && curView !== 'mydocs' && !st.forced) show('mydocs', 'none');
    if (curView === 'mydocs' || isMdView(curView)) refreshCache().then(() => { if (!st.forced) open(false); });
    else refreshCache();
  }
  // privacy cover + auto-lock (grace: Immediately / 1 min / 5 min)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (st.cached !== 'none') $('mdCover').classList.add('on');
      st.hiddenAt = Date.now();
      if ((Vault.isUnlocked() || Vault.recovering()) && !st.grace && !st.noAutoLock) lockNow('hidden');
    } else {
      $('mdCover').classList.remove('on');
      if (Vault.isUnlocked() && st.grace && Date.now() - st.hiddenAt > st.grace) lockNow('grace');
    }
  });
  addEventListener('pagehide', () => { if (Vault.isUnlocked() && !st.grace) lockNow('pagehide'); });

  // ---- keypad ----
  const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ']];
  function keypad(face, disabled) {
    return `<div class="m-kp tnum${disabled ? ' disabled' : ''}"${disabled ? ' aria-disabled="true"' : ''}>${KEYS.map(([d, l]) => `<button class="m-k" data-d="${d}" aria-label="${d}">${d}<small>${l || '&nbsp;'}</small></button>`).join('')}`
      + (face ? `<button class="m-k n" data-face="1" aria-label="Use Face ID">${ic('faceid')}</button>` : '<span class="m-k n blank"></span>')
      + `<button class="m-k" data-d="0" aria-label="0">0</button><button class="m-k n d" data-d="del" aria-label="Delete">${ic('del2')}</button></div>`;
  }
  const dotsHtml = () => `<div class="m-dots" role="img" aria-label="PIN, 0 of 6 digits">${'<i></i>'.repeat(6)}</div>`;
  function wirePin(root, onPin) {
    let buf = '', busyP = false; const dots = root.querySelector('.m-dots'), di = [...dots.children];
    const paint = () => { di.forEach((d, i) => d.classList.toggle('f', i < buf.length)); dots.setAttribute('aria-label', `PIN, ${buf.length} of 6 digits`); };
    const press = async (d) => {
      if (busyP) return;
      if (d === 'del') { buf = buf.slice(0, -1); paint(); return; }
      if (buf.length >= 6) return;
      buf += d; paint(); if (typeof haptic === 'function') haptic('snap');
      if (buf.length === 6) { busyP = true; const p = buf; await wait(90); try { await onPin(p); } finally { busyP = false; buf = ''; if (dots.isConnected) paint(); } }
    };
    root.querySelectorAll('.m-k[data-d]').forEach((k) => (k.onclick = () => press(k.dataset.d)));
    st.pin = { root, press };
    return { shake() { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); if (typeof haptic === 'function') haptic('delete'); } };
  }
  document.addEventListener('keydown', (e) => {
    if (!st.pin || !st.pin.root.isConnected || e.target.closest && e.target.closest('input,textarea')) return;
    const v = st.pin.root.closest('.view'); if (!v || !v.classList.contains('active')) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); st.pin.press(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); st.pin.press('del'); }
  });

  async function faceId() {
    const r = await Vault.unlockPrf();
    if (r.ok) return unlocked();
    if (r.err === 'newdevice' || r.err === 'nomatch') { await refreshCache(); if (st.cached === 'newdevice') return renderNewDevice(); }
    // Face ID failed / cancelled: stay on the PIN keypad, no alert (spec §10)
  }
  async function unlocked() {
    await refreshCache(); persist();
    const a = st.after; st.after = null;
    renderHome();
    if (a === 'backup') openBackup();
    else if (typeof a === 'function') a();
  }
  function renderLock() {
    const root = $('mdMain');
    root.innerHTML = `<div class="m-wrap m-lockv">
      <div class="m-mk">${ic('mydocs')}</div>
      <h1 class="m-h1">My Docs locked</h1>
      <div class="m-s" id="mdLockS">${st.prfOn ? 'Face ID se kholein ya PIN daalein' : 'PIN daalein'}</div>
      ${dotsHtml()}${keypad(st.prfOn)}
      <button class="m-btnt m-fg" id="mdForgot">Forgot PIN?</button></div>`;
    Vault.lockInfo().then((l) => { if (l.lockedFor > 0) renderLockout(l); });
    const pad = wirePin(root, async (pin) => {
      const r = await Vault.unlockPin(pin);
      if (r.ok) return unlocked();
      if (r.err === 'newdevice') { await refreshCache(); return renderNewDevice(); }
      if (r.err === 'locked') return renderLockout(await Vault.lockInfo());
      pad.shake(); const s = $('mdLockS'); if (s) s.textContent = `Galat PIN. ${r.left} ${r.left === 1 ? 'koshish' : 'koshish'} baaki`;
    });
    const fb = root.querySelector('[data-face]'); if (fb) fb.onclick = faceId;
    $('mdForgot').onclick = () => recoveryEntry();
  }
  let lockTimer = 0;
  function renderLockout(l) {
    clearInterval(lockTimer);
    const root = $('mdMain'), mins = Math.round((l.until - Date.now()) / 60000) || 1;
    const step = l.fails <= 5 ? 1 : l.fails === 6 ? 5 : 15;
    root.innerHTML = `<div class="m-wrap m-lockout">
      <div class="m-mk">${ic('mydocs')}</div>
      <h1 class="m-h1">My Docs locked</h1>
      <div class="m-msg">${l.fails} baar galat PIN. ${step} minute baad dobara koshish karein</div>
      <div class="m-cd tnum" role="timer" aria-live="off">Dobara koshish <b id="mdCd">0:00</b></div>
      <div class="m-note">Aur galat PIN par wait badhta hai: 1, 5, 15 min. Aapka data kabhi delete nahi hota.</div>
      ${keypad(st.prfOn, true)}
      <button class="m-btnt m-fg" id="mdForgot">Forgot PIN?</button></div>`;
    const tick = () => { const ms = l.until - Date.now(); const e = $('mdCd'); if (!e) return clearInterval(lockTimer); if (ms <= 0) { clearInterval(lockTimer); return renderLock(); } const s = Math.ceil(ms / 1000); e.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    tick(); lockTimer = setInterval(tick, 1000); void mins;
    $('mdForgot').onclick = () => recoveryEntry();
  }

  // ======================================================================= flows (full screen)
  function flow(html, opts = {}) {
    st.forced = !!opts.forced; st.flowBack = opts.back || null;
    const f = $('mdFlow'); f.innerHTML = `<div class="m-wrap">${html}</div>`; f.scrollTop = 0;
    if (curView !== 'mdflow') show('mdflow', opts.mode || 'up');
    return f;
  }
  function closeFlow(to = 'mydocs') { st.forced = false; st.flowBack = null; st.pin = null; show(to, 'down'); setTimeout(() => { if (curView !== 'mdflow') $('mdFlow').innerHTML = ''; }, 520); }
  const navHtml = (back, step) => `<div class="m-nav">${back ? `<button class="m-bk" id="mdBack">${ic('back')}${esc(back)}</button>` : '<span></span>'}<span class="m-step tnum">${esc(step || '')}</span></div>`;
  function pinStepHtml({ back, step, icon = 'key', title, sub, cap }) {
    return `${navHtml(back, step)}<div class="m-mk" style="margin-top:4px">${ic(icon)}</div>
      <h1 class="m-h1">${esc(title)}</h1><div class="m-s" id="mdPinS" style="padding:0 12px;line-height:calc(22px + var(--dt) * 1.15)">${esc(sub)}</div>
      ${dotsHtml()}${keypad(false)}
      <div class="m-cap" style="text-align:center;margin-top:22px;font-weight:400;font-size:calc(15px + var(--dt) * 0.94)">${esc(cap || '')}</div>`;
  }
  /** Ask for a new 6-digit PIN twice. Resolves with the PIN. */
  function newPin({ back, step, title = '6-digit PIN banayein', sub, cap, forced, onBack }) {
    return new Promise((res) => {
      const ask = (first) => {
        // first == null: choosing the PIN; first == '123456': confirming it
        const f = flow(pinStepHtml({ back: first ? 'Back' : back, step, title: first ? 'PIN dobara daalein' : title, sub: first ? 'Wahi 6 digit dobara daalein.' : sub, cap: first ? 'Dono PIN match hone chahiye.' : cap }), { forced, back: first ? () => ask(null) : onBack });
        const b = $('mdBack'); if (b) b.onclick = first ? () => ask(null) : onBack;
        const pad = wirePin(f, async (p) => {
          if (!first) return ask(p);
          if (p === first) return res(p);
          pad.shake(); const s = $('mdPinS'); if (s) s.textContent = 'PIN match nahi hua. Dobara banayein.'; await wait(900); ask(null);
        });
      };
      ask(null);
    });
  }
  function codeCard(code, step) {
    const g = Vault.fmtCode(code).split('-');
    return `<div class="m-code" aria-label="Recovery code ${esc(g.join(' '))}">
      <div class="lab"><span>RECOVERY CODE · 7 × 4</span><span>${step}</span></div>
      <div class="g tnum">${g.map((x, i) => `<div${i === 6 ? ' class="last"' : ''}><small>${i + 1}</small>${x}</div>`).join('')}</div>
      <div class="fmt">${g.join('-')}</div></div>`;
  }
  /** Shows a recovery code once (no Copy, no PDF, S4). Resolves when the checkbox is ticked and the button tapped. */
  function showCode(code, { title, sub, step, btn, back, onBack, forced, label = 'DEMO' }) {
    return new Promise((res) => {
      flow(`${navHtml(back, step)}<div class="m-display" style="margin-top:4px">${esc(title)}</div>
        <div class="m-sub" style="margin-top:6px;font-size:calc(17px + var(--dt) * 1);line-height:1.294">${esc(sub)}</div>
        ${codeCard(code, label)}
        <div class="m-amber" style="margin-top:16px">${ic('warn')}<span>PIN aur recovery code dono bhool gaye to documents wapas nahi aayenge.</span></div>
        <button class="m-cb" id="mdCb" role="checkbox" aria-checked="false"><span class="bx">${ic('check')}</span><span>Maine ye code kagaz par surakshit jagah likh liya hai</span></button>
        </div><div class="m-bot"><button class="m-btnp" id="mdCodeOk" disabled>${esc(btn)}</button><div class="m-cap" style="text-align:center;margin-top:12px">Checkbox tick karne ke baad hi aage badh sakte hain</div>`, { forced, back: onBack });
      const cb = $('mdCb'), ok = $('mdCodeOk');
      cb.onclick = () => { const v = cb.getAttribute('aria-checked') !== 'true'; cb.setAttribute('aria-checked', v); ok.disabled = !v; if (typeof haptic === 'function') haptic('snap'); };
      ok.onclick = () => { if (!ok.disabled) res(); };
      const b = $('mdBack'); if (b && onBack) b.onclick = onBack;
    });
  }
  // ---- first-run setup: 5 screens ----
  function renderIntro() {
    flow(`${navHtml('', 'Step 1 of 5')}<div class="m-hero">${ic('mydocs')}</div>
      <div class="m-display" style="margin-top:20px">Aapke documents sirf is phone mein.</div>
      <div style="margin-top:8px;font-size:calc(20px + var(--dt) * 0.97);line-height:1.25;font-weight:500;color:var(--m-ink2)">Koi server nahi, koi account nahi.</div>
      <div style="margin-top:12px">
        <div class="m-ft"><div class="m-tile" style="--c:var(--accent-text)">${ic('phone')}</div><div><b>On this phone</b><span>Documents encrypted hokar sirf is iPhone mein rehte hain.</span></div></div>
        <div class="m-ft"><div class="m-tile" style="--c:var(--accent-text)">${ic('faceid')}</div><div><b>Locked with Face ID</b><span>Face ID ya PIN se khulega. App band hote hi turant lock.</span></div></div>
        <div class="m-ft"><div class="m-tile" style="--c:var(--accent-text)">${ic('backup')}</div><div><b>You control backup</b><span>${DELETE_LINE}</span></div></div>
      </div>
      <div class="m-cap" id="mdFinal" style="margin-top:20px;font-weight:400;font-size:calc(13px + var(--dt) * 0.86);line-height:1.385">${FINAL_LINE}</div>
      </div><div class="m-bot"><button class="m-btnp" id="mdSetup">Set up</button><button class="m-btnt" id="mdNotNow" style="margin-top:6px">Not now</button>`, { mode: 'up' });
    $('mdSetup').onclick = () => setupPin();
    $('mdNotNow').onclick = () => { closeFlow('home'); if (typeof renderHome === 'function') window.renderHome('none'); };
  }
  async function setupPin(fromBackup) {
    const pin = await newPin({ back: 'Back', step: 'Step 2 of 5', sub: 'Ye PIN aapke documents ko encrypt karta hai.', cap: 'PIN is phone se juda rehta hai. Agle step mein dobara daalein.', onBack: () => (fromBackup ? renderNewDevice() : renderIntro()) });
    busy('Encrypting…');
    let code;
    try { code = await Vault.setup(pin, fromBackup || {}); } catch (e) { busy(); console.warn('setup', e); toast('Setup nahi ho paya. Dobara koshish karein.', 'err'); return; }
    busy(); persist(); await refreshCache();
    st.setupCode = code;
    setupFace();
  }
  function setupFace() {
    if (!Vault.prfSupported()) return setupCode();
    flow(`${navHtml('', 'Step 3 of 5')}<div class="m-hero">${ic('faceid')}</div>
      <div class="m-display" style="margin-top:20px">Face ID se kholein</div>
      <div class="m-sub" style="margin-top:8px;font-size:calc(17px + var(--dt) * 1);line-height:1.294">Face ID sirf is phone ki chaabi kholta hai. Naye phone par Face ID ya PIN se My Docs nahi khulega.</div>
      </div><div class="m-bot"><button class="m-btnp" id="mdFaceOn">${ic('faceid')}Use Face ID</button><button class="m-btnt" id="mdFaceNo" style="margin-top:6px">Not now</button>`, { forced: true });
    $('mdFaceOn').onclick = async () => {
      // QC 1: confirm on the Face ID step itself for 1.5 s, then move on (never over the recovery-code screen)
      const btn = $('mdFaceOn'); btn.disabled = true;
      let ok = false;
      try { await Vault.enablePrf(); await refreshCache(); ok = true; }
      catch (e) { toast(e.code === 'PRF_UNSUPPORTED' ? 'Is phone par Face ID se key protect nahi ho sakti. PIN use hoga.' : 'Face ID on nahi hua. Settings se baad mein on kar sakte hain.', 'err', { ms: 1500 }); }
      if (ok) toast('Face ID on', 'ok', { ms: 1500 });
      await wait(1500); clearTimeout(toast._t); $('toast').classList.remove('show'); setupCode();
    };
    $('mdFaceNo').onclick = setupCode;
  }
  async function setupCode() {
    const code = st.setupCode;
    await showCode(code, { title: 'Recovery code', sub: 'PIN bhool gaye to isi code se My Docs khulega. Ye code sirf ek baar dikhega, isliye ise kagaz par likh lein.', step: 'Step 4 of 5', btn: 'Continue', back: 'Back', onBack: setupFace, forced: true });
    st.setupCode = null; // never kept after this screen (S4)
    if (st.restored) { st.restored = false; closeFlow('mydocs'); renderHome(); return; } // family list came from the backup
    setupMembers();
  }
  function setupMembers() {
    const list = () => I().members.map((m, i) => `<div class="m-row"><span class="m-av" style="--c:${COLORS[m.color % COLORS.length]}">${esc(m.name[0])}</span><span class="t">${esc(m.name)}<small>${esc(m.rel)}</small></span></div>`).join('');
    const draw = () => {
      flow(`${navHtml('', 'Step 5 of 5')}<div class="m-display" style="margin-top:4px">Family</div>
        <div class="m-sub" style="margin-top:6px;font-size:calc(17px + var(--dt) * 1);line-height:1.294">Kiske documents rakhne hain? Baad mein bhi add kar sakte hain.</div>
        <div class="m-card m-memlist">${list()}<button class="m-row" id="mdAddMem"><span class="ic" style="color:var(--accent-text);display:flex">${ic('plus')}</span><span class="t" style="color:var(--accent-text);font-weight:600">Add family member</span></button></div>
        </div><div class="m-bot"><button class="m-btnp" id="mdFirst">Add first document</button>`, { forced: true });
      $('mdAddMem').onclick = async () => { if (await addMember()) draw(); };
      $('mdFirst').onclick = () => { closeFlow('mydocs'); renderHome(); };
    };
    draw();
  }
  // ---- recovery: Forgot PIN / new phone ----
  function recoveryEntry(from) {
    flow(`${navHtml('Back', '')}<div class="m-display" style="margin-top:4px">Recovery code</div>
      <div class="m-sub" style="margin-top:6px;font-size:calc(17px + var(--dt) * 1);line-height:1.294">Kagaz par likha 28-character code daalein. Dash, space ya chhote-bade akshar se fark nahi padta.</div>
      <div class="m-fl"><div class="lab">Recovery code</div><label class="m-fld"><input id="mdRc" class="code" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder="XXXX-XXXX-XXXX-…" aria-label="Recovery code"></label>
      <div class="m-inl" id="mdRcErr" role="alert"></div></div>
      <div id="mdRcLock" class="m-rlock" role="status" hidden></div>
      </div><div class="m-bot"><button class="m-btnp" id="mdRcGo" disabled>Continue</button>`, { back: () => backFromRecovery(from) });
    const inp = $('mdRc'), go = $('mdRcGo');
    let locked = false;
    const showErr = (t) => { const e = $('mdRcErr'); e.innerHTML = t ? `${ic('warn')}<span>${esc(t)}</span>` : ''; e.classList.toggle('on', !!t); };
    // Same rule as the PIN (5 wrong → 1, 5, 15 min). The counter lives in the vault cfg, so a reload doesn't reset it.
    const lockout = (l) => {
      clearInterval(rcTimer); locked = true; showErr('');
      const box = $('mdRcLock'), step = l.fails <= 5 ? 1 : l.fails === 6 ? 5 : 15;
      box.hidden = false; inp.disabled = true; go.disabled = true; inp.closest('.m-fld').classList.add('off');
      box.innerHTML = `<div class="m-msg">${l.fails} baar galat code. ${step} minute baad dobara koshish karein</div>
        <div class="m-cd tnum" role="timer" aria-live="off">Dobara koshish <b id="mdRcCd">0:00</b></div>
        <div class="m-note">Aur galat code par wait badhta hai: 1, 5, 15 min. Aapka data kabhi delete nahi hota.</div>`;
      const tick = () => {
        const ms = l.until - Date.now(), e = $('mdRcCd'); if (!e) return clearInterval(rcTimer);
        if (ms <= 0) { clearInterval(rcTimer); locked = false; box.hidden = true; box.innerHTML = ''; inp.disabled = false; inp.closest('.m-fld').classList.remove('off'); go.disabled = !Vault.validCode(inp.value); return; }
        const sec = Math.ceil(ms / 1000); e.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      };
      tick(); rcTimer = setInterval(tick, 1000);
    };
    Vault.recLockInfo().then((l) => { if (l.lockedFor > 0 && $('mdRc') === inp) lockout(l); }).catch(() => {});
    inp.oninput = () => { go.disabled = locked || !Vault.validCode(inp.value); showErr(''); };
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !go.disabled) go.click(); };
    $('mdBack').onclick = () => backFromRecovery(from);
    go.onclick = async () => {
      go.disabled = true; busy('Code check ho raha hai…');
      let r; try { r = await Vault.unlockRecovery(inp.value); } catch (e) { r = { ok: false, err: 'error' }; } busy();
      if (!r.ok) {
        if (typeof haptic === 'function') haptic('delete');
        if (r.err === 'locked') return lockout(await Vault.recLockInfo());
        showErr(r.err === 'format' ? 'Code 28 characters ka hona chahiye.' : r.err === 'wrong' ? `Ye code sahi nahi hai. Kagaz se dobara milayein. ${r.left} ${r.left === 1 ? 'koshish' : 'koshish'} baaki.` : 'Code abhi check nahi ho paya. Dobara koshish karein.');
        go.disabled = false; return;
      }
      clearInterval(rcTimer);
      inp.value = '';
      afterRecovery();
    };
    setTimeout(() => inp.focus(), 400);
  }
  let rcTimer = 0;
  function backFromRecovery() { clearInterval(rcTimer); closeFlow('mydocs'); refreshCache().then(() => open(false)); }
  async function afterRecovery() {
    st.noAutoLock = false;
    const pin = await newPin({ step: 'Step 1 of 2', title: 'Naya 6-digit PIN', sub: 'Recovery code sahi hai. Ab naya PIN banana zaroori hai.', cap: 'Ye step skip nahi ho sakta. Agle step mein PIN dobara daalein.', forced: true });
    busy('Naya code ban raha hai…');
    let code; try { code = await Vault.finishRecovery(pin); } catch (e) { busy(); console.warn('finishRecovery', e); toast('Naya PIN set nahi ho paya. Dobara koshish karein.', 'err'); return; }
    busy(); await refreshCache(); persist();
    await showCode(code, { title: 'Naya recovery code', sub: 'Purana code ab kaam nahi karega. Ye naya code sirf ek baar dikhega, isliye ise kagaz par likh lein.', step: 'Step 2 of 2', btn: 'Done', forced: true });
    code = null; closeFlow('mydocs'); renderHome(); toast('My Docs khul gaya · naya PIN set');
  }
  function renderNewDevice() {
    if (curView === 'mdflow' && !st.forced) closeFlow('mydocs');
    $('mdMain').innerHTML = `<div class="m-wrap">
      <div class="m-mk">${ic('phone')}</div>
      <h1 class="m-h1">Naya phone</h1>
      <div class="m-s" style="padding:0 8px;line-height:calc(22px + var(--dt) * 1.15)">Is phone par My Docs PIN ya Face ID se nahi khulega. Recovery code daalein ya DocSnap backup file import karein.</div>
      <div style="margin-top:28px;display:flex;flex-direction:column;gap:12px"><button class="m-btnp" id="mdNdCode">${ic('key')}Recovery code daalein</button><button class="m-btns" id="mdNdFile">${ic('importb')}Backup file import karein</button></div>
      <div class="m-cap" style="margin-top:20px;font-weight:400;font-size:calc(13px + var(--dt) * 0.86);line-height:1.385;text-align:center">${FINAL_LINE}</div></div>`;
    $('mdNdCode').onclick = () => recoveryEntry('newdevice');
    $('mdNdFile').onclick = () => importFlow(true);
  }

  // ======================================================================= home (04)
  function persist() {
    if (navigator.storage && navigator.storage.persist) { st.persistCalls = (st.persistCalls || 0) + 1; navigator.storage.persist().then((v) => { st.persisted = v; }).catch(() => {}); }
  }
  function badge(on) {
    const t = document.querySelector('.tab[data-tab="mydocs"]'); if (!t) return;
    let d = t.querySelector('.mdot'); if (on && !d) { d = document.createElement('span'); d.className = 'mdot'; d.setAttribute('aria-hidden', 'true'); t.append(d); }
    if (!on && d) d.remove();
    t.setAttribute('aria-label', on ? 'My Docs, expiry reminder' : 'My Docs');
  }
  const dueDocs = () => I().docs.filter((d) => d.expiry && T[d.type].exp && daysTo(d.expiry) <= 30).sort((a, b) => a.expiry.localeCompare(b.expiry));
  async function thumbUrl(id) { if (!id) return ''; const b = await Vault.getBlob(id); return b ? urlOf(b) : ''; }
  function slotMeta(d) {
    const n = d.pages.length, t = T[d.type];
    const sides = t.sides === 2 ? (n >= 2 ? 'Front & back' : 'Front') : `${n} page${n === 1 ? '' : 's'}`;
    if (d.expiry && t.exp) { const dd = daysTo(d.expiry); return dd <= 365 ? `Exp ${fmtDate(d.expiry)}` : `${sides} · Exp ${d.expiry.slice(0, 4)}`; }
    return sides;
  }
  async function slotHtml(type, d, mem) {
    const t = T[type];
    if (!d) return `<button class="m-slot empty" data-scan="${type}" aria-label="${esc(mem.name)}, ${esc(t.n)}, empty, double-tap to scan"><div class="st">${esc(t.n)}</div><div class="scanl">${ic('plus')}Scan</div></button>`;
    const [u0, u1] = [await thumbUrl(d.thumbs[0]), await thumbUrl(d.thumbs[1] || d.thumbs[0])];
    const land = (d.aspect || 1.6) >= 1;
    const th = land
      ? `<span class="m-th" style="left:18px;top:18px;width:67px;height:42px">${u1 ? `<img src="${u1}" alt="">` : ''}</span><span class="m-th" style="left:12px;top:12px;width:67px;height:42px">${u0 ? `<img src="${u0}" alt="">` : ''}</span>`
      : `<span class="m-th pg" style="left:18px;top:14px;width:31px;height:42px">${u1 ? `<img src="${u1}" alt="">` : ''}</span><span class="m-th pg" style="left:12px;top:8px;width:31px;height:42px">${u0 ? `<img src="${u0}" alt="">` : ''}</span>`;
    const dd = d.expiry && t.exp ? daysTo(d.expiry) : null;
    const bd = dd != null && dd <= 30 ? `<div class="m-sbadge tnum">${dd < 0 ? 'Expired' : `${dd} din`}</div>` : '';
    const vo = `${mem.name}, ${t.full}, added${d.expiry && t.exp ? ', expires ' + fmtDate(d.expiry) : ''}`;
    return `<button class="m-slot card" data-doc="${d.id}" aria-label="${esc(vo)}">${th}${bd}<div class="st">${esc(t.n)}</div><div class="sm tnum">${esc(slotMeta(d))}</div></button>`;
  }
  let homeSeq = 0;
  async function renderHome(opt = {}) {
    if (!Vault.isUnlocked()) return open(false);
    const seq = ++homeSeq, idx = I();
    if (!st.member || !memberOf(st.member)) st.member = (idx.members.find((m) => docsOf(m.id).length) || idx.members[0]).id;
    const mem = memberOf(st.member), docs = docsOf(mem.id);
    freeUrls();
    const total = idx.docs.length, bk = idx.backup || {};
    const showBk = total >= 1 && (bk.last ? Date.now() - bk.last > 30 * DAY : total >= 3) && !(bk.snooze > Date.now());
    const due = dueDocs();
    badge(due.length > 0);
    const filled = TYPES.filter((t) => docs.some((d) => d.type === t.k)).length;
    let html = `<div class="m-display" style="margin-top:4px">My Docs</div>
      <div class="m-lk">${ic('lock')}Only on this phone · Locked</div>
      <label class="m-searchf" style="margin-top:12px">${ic('search')}<input id="mdSearch" type="search" placeholder="Search, jaise &quot;papa pan&quot;" autocomplete="off" enterkeyhint="search" aria-label="Search My Docs" value="${esc(st.q)}"></label>
      <div id="mdBody">`;
    if (st.q.trim().length >= 3) html += await resultsHtml(st.q);
    else {
      html += `<div class="m-mem" role="tablist" aria-label="Family members">${idx.members.map((m) => `<button class="m-mb${m.id === mem.id ? ' on' : ''}" role="tab" aria-selected="${m.id === mem.id}" data-mem="${m.id}"><span class="m-av" style="--c:${COLORS[m.color % COLORS.length]}">${esc(m.name[0].toUpperCase())}</span><span>${esc(m.name)}</span></button>`).join('')}
        <button class="m-mb" id="mdAddM" aria-label="Add family member"><span class="m-av add">${ic('plus')}</span><span>Add</span></button></div>
        <div class="m-prog tnum"><span>${filled} of 10 added</span><div class="bar"><i style="width:${filled * 10}%"></i></div></div>`;
      if (showBk) html += `<div class="m-card m-nudge bk2"><div class="ni" style="--c:var(--c-protect)">${ic('backup')}</div><div class="tx">Last backup: ${bk.last ? ago(bk.last) : 'never'}<span>Phone kharab hua to documents wapas nahi aayenge</span><button class="m-pill" id="mdBkNow" style="margin-top:10px">Back up now</button></div><button class="m-xb" id="mdBkSnooze" style="align-self:flex-start;margin-top:-6px" aria-label="Snooze 7 days">${ic('x')}</button></div>`;
      for (const d of due.slice(0, 2)) {
        const m = memberOf(d.member), dd = daysTo(d.expiry);
        html += `<div class="m-card m-nudge" style="padding-right:12px"><div class="ni" style="--c:var(--c-med)">${ic('cal')}</div><div class="tx">${esc(possessive(m))} ${esc(T[d.type].short)} ${dd < 0 ? 'expire ho chuka hai' : dd === 0 ? 'aaj expire hoga' : `${dd} din mein expire hoga`}<span class="tnum">Valid till ${fmtDate(d.expiry)}</span></div><button class="m-pill s" data-view="${d.id}">View</button></div>`;
      }
      if (due.length > 2) html += `<button class="m-more" id="mdComing">Coming up (${due.length - 2})${ic('chev', '', 'width:18px;height:18px')}</button>`;
      const slots = []; for (const t of TYPES) slots.push(await slotHtml(t.k, docs.find((d) => d.type === t.k), mem));
      html += `<div class="m-grid${opt.fade ? ' m-xfade' : ''}" id="mdGrid">${slots.join('')}</div>`;
      if (idx.members.length === 1 && !idx.docs.length) html += `<div class="m-cap" style="text-align:center;margin-top:16px;font-weight:400">Family ke documents ek jagah · <button class="m-dl" id="mdAddM2" style="display:inline;color:var(--accent-text);font-weight:600">+ Add family member</button></div>`;
    }
    html += '</div>';
    if (seq !== homeSeq) return;
    const root = $('mdMain'), y = root.scrollTop;
    root.innerHTML = `<div class="m-wrap">${html}</div>`; root.scrollTop = opt.keepScroll ? y : 0;
    if (opt.filled) { const s = root.querySelector(`[data-doc="${opt.filled}"]`); if (s) s.classList.add('fill-in'); }
    wireHome(root);
  }
  function wireHome(root) {
    const s = $('mdSearch'); let t = 0;
    s.oninput = () => { st.q = s.value; clearTimeout(t); t = setTimeout(async () => { const b = $('mdBody'); if (!b) return; if (st.q.trim().length >= 3) { freeUrls(); b.innerHTML = await resultsHtml(st.q); wireResults(b); } else if (!b.querySelector('#mdGrid')) { await renderHome({ keepScroll: true }); const n = $('mdSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 120); };
    root.querySelectorAll('[data-mem]').forEach((b) => {
      b.onclick = () => { if (st.member === b.dataset.mem) return; st.member = b.dataset.mem; renderHome({ fade: true, keepScroll: true }); };
      longPress(b, () => memberActions(b.dataset.mem));
    });
    const add = () => addMember().then((m) => { if (m) { st.member = m.id; renderHome({ fade: true, keepScroll: true }); } });
    if ($('mdAddM')) $('mdAddM').onclick = add; if ($('mdAddM2')) $('mdAddM2').onclick = add;
    root.querySelectorAll('[data-scan]').forEach((b) => (b.onclick = () => startCapture(st.member, b.dataset.scan)));
    root.querySelectorAll('[data-doc]').forEach((b) => (b.onclick = () => openDetail(b.dataset.doc)));
    root.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => openDetail(b.dataset.view)));
    if ($('mdBkNow')) $('mdBkNow').onclick = openBackup;
    if ($('mdBkSnooze')) $('mdBkSnooze').onclick = async () => { I().backup = { ...(I().backup || {}), snooze: Date.now() + 7 * DAY }; await Vault.saveIndex(); renderHome({ keepScroll: true }); };
    if ($('mdComing')) $('mdComing').onclick = async () => {
      const v = await menu('Coming up', dueDocs().slice(2).map((d) => ({ label: `${possessive(memberOf(d.member))} ${T[d.type].short} · ${fmtDate(d.expiry)}`, value: d.id, icon: 'calendar' })));
      if (v) openDetail(v);
    };
    wireResults(root);
  }
  function longPress(elm, fn) { let t = 0; elm.addEventListener('pointerdown', () => { t = setTimeout(() => { t = -1; fn(); }, 550); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => elm.addEventListener(e, () => clearTimeout(t))); elm.addEventListener('click', (e) => { if (t === -1) { e.stopImmediatePropagation(); e.preventDefault(); t = 0; } }, true); }
  // ---- search: member + type + name, 3+ chars ("papa pan") ----
  function searchDocs(q) {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    return I().docs.filter((d) => { const m = memberOf(d.member) || {}, t = T[d.type]; const hay = `${m.name} ${m.rel} ${t.n} ${t.full} ${t.alias} ${d.name || ''} ${d.notes || ''}`.toLowerCase(); return toks.every((k) => hay.includes(k)); });
  }
  async function resultsHtml(q) {
    const r = searchDocs(q);
    if (!r.length) return `<div class="m-empty"><h3>Kuch nahi mila</h3>“${esc(q.trim())}” se koi document match nahi hua. Member aur document ka naam likhein, jaise “papa pan”.</div>`;
    const rows = []; for (const d of r) { const m = memberOf(d.member), u = await thumbUrl(d.thumbs[0]), land = (d.aspect || 1.6) >= 1;
      rows.push(`<button class="m-res" data-doc="${d.id}"><span class="m-th${land ? '' : ' pg'}" style="width:${land ? 58 : 32}px;height:${land ? 36 : 43}px">${u ? `<img src="${u}" alt="">` : ''}</span><span class="rt"><b>${esc(m.name)} · ${esc(T[d.type].full)}</b><small class="tnum">${esc(slotMeta(d))}</small></span>${ic('chev', 'ch', 'width:18px;height:18px;color:var(--m-ink2)')}</button>`); }
    return `<div class="m-cap" style="margin:16px 4px 0">${r.length} result${r.length > 1 ? 's' : ''}</div><div class="m-card m-results" style="margin-top:8px">${rows.join('')}</div>`;
  }
  function wireResults(root) { root.querySelectorAll('.m-res[data-doc]').forEach((b) => (b.onclick = () => openDetail(b.dataset.doc))); }
  // ---- members ----
  function addMember(edit) {
    return openSheet((body, close) => {
      let rel = edit ? edit.rel : 'Papa';
      const wrap = document.createElement('div'); wrap.className = 'md';
      wrap.innerHTML = `<h3>${edit ? 'Edit member' : 'Family member'}</h3>
        <div class="m-fl" style="margin-top:8px"><div class="lab">Naam</div><label class="m-fld"><input id="mdMemName" maxlength="24" autocomplete="off" placeholder="Jaise Papa" value="${esc(edit ? edit.name : '')}" aria-label="Naam"></label></div>
        <div class="m-fl"><div class="lab">Rishta</div><div class="m-chips" role="radiogroup">${RELS.map((r) => `<button class="m-chip${r === rel ? ' on' : ''}" role="radio" aria-checked="${r === rel}" data-rel="${r}">${r}</button>`).join('')}</div></div>
        <button class="m-btnp" id="mdMemSave" style="margin:20px 0 8px">${edit ? 'Save' : 'Add'}</button>`;
      body.append(wrap);
      const name = wrap.querySelector('#mdMemName');
      wrap.querySelectorAll('[data-rel]').forEach((c) => (c.onclick = () => { rel = c.dataset.rel; wrap.querySelectorAll('[data-rel]').forEach((x) => { x.classList.toggle('on', x === c); x.setAttribute('aria-checked', x === c); }); if (!name.value.trim() || RELS.includes(name.value.trim())) name.value = rel === 'Other' ? '' : rel; }));
      if (!edit) name.value = 'Papa';
      wrap.querySelector('#mdMemSave').onclick = async () => {
        const n = name.value.trim().slice(0, 24); if (!n) { name.focus(); return; }
        let m;
        if (edit) { m = memberOf(edit.id); m.name = n; m.rel = rel; }
        else { m = { id: Vault.newId(), name: n, rel, color: I().members.length % COLORS.length }; I().members.push(m); }
        await Vault.saveIndex(); close(m);
      };
    });
  }
  async function memberActions(id) {
    const m = memberOf(id); if (!m) return;
    const n = docsOf(id).length;
    const v = await menu(m.name, [{ label: 'Edit', value: 'edit', icon: 'pencil' }, ...(I().members.length > 1 ? [{ label: 'Delete member', value: 'del', icon: 'trash', danger: true }] : [])], n ? `${n} document${n > 1 ? 's' : ''}` : 'Abhi koi document nahi');
    if (v === 'edit') { if (await addMember(m)) renderHome({ keepScroll: true }); }
    if (v === 'del') {
      if (!await confirmDelete(`${m.name} ko delete karein?`, n ? `${m.name} ke ${n} document bhi delete honge. Ye wapas nahi aayenge.` : 'Ye member hata diya jayega.')) return;
      const ids = docsOf(id).flatMap((d) => [...d.pages, ...d.thumbs]);
      I().docs = I().docs.filter((d) => d.member !== id); I().members = I().members.filter((x) => x.id !== id); st.member = null;
      await Vault.commit([], ids); renderHome();
    }
  }

  // ======================================================================= add a document (camera only, S10)
  function startCapture(memberId, type, replaceId) {
    if (!Vault.isUnlocked()) return;
    const t = T[type];
    CAM.vaultNext = { member: memberId, type, replace: replaceId || null, sides: t.sides, mode: t.mode };
    openCam(true);
  }
  /** Called by the scanner's Save (review screen) with final in-memory JPEG blobs. Nothing touches the Documents DB or disk. */
  async function saveScan(blobs, v) {
    if (!Vault.isUnlocked()) { toast('My Docs locked hai. Scan discard ho gaya.', 'err'); show('mydocs', 'down'); return; }
    show('mydocs', 'down');
    const mem = memberOf(v.member), t = T[v.type], old = v.replace && I().docs.find((d) => d.id === v.replace);
    const info = old ? { name: old.name, expiry: old.expiry, notes: old.notes } : await detailsSheet({ name: `${mem.name} · ${t.n}`, type: v.type });
    if (!info) { if (await confirmDelete('Scan discard karein?', 'Ye scan save nahi hua hai.', 'Discard')) { renderHome(); return; } return saveScan(blobs, v); }
    busy('Encrypting…');
    try {
      const put = [], pages = [], thumbs = []; let aspect = 1.6;
      for (let i = 0; i < blobs.length; i++) {
        const bmp = await createImageBitmap(blobs[i]); if (!i) aspect = bmp.width / bmp.height;
        const id = Vault.newId(); put.push([id, new Uint8Array(await blobs[i].arrayBuffer())]); pages.push(id);
        if (i < 2) { const tid = Vault.newId(); put.push([tid, new Uint8Array(await (await thumbOf(bmp)).arrayBuffer())]); thumbs.push(tid); }
        bmp.close();
      }
      const now = Date.now(); let doc;
      if (old) { const dels = [...old.pages, ...old.thumbs]; Object.assign(old, { pages, thumbs, aspect, updated: now }); doc = old; await Vault.commit(put, dels); }
      else {
        doc = { id: Vault.newId(), member: v.member, type: v.type, name: info.name, expiry: info.expiry || null, notes: info.notes || '', nameOnCard: '', number: '', pages, thumbs, aspect, added: now, updated: now };
        I().docs = I().docs.filter((d) => !(d.member === v.member && d.type === v.type && v.type !== 'other' && (dropOld(d), true)));
        I().docs.push(doc); await Vault.commit(put, st._drop || []); st._drop = null;
      }
      busy(); st.member = v.member; st.q = '';
      await renderHome({ filled: doc.id });
      if (typeof haptic === 'function') haptic('success');
      toast(old ? 'Replaced · Only on this phone' : 'Saved · Only on this phone');
      storageCheck();
      if (old && curView === 'mydocs') openDetail(doc.id);
    } catch (e) { busy(); toast('Save nahi hua: ' + e.message, 'err'); }
  }
  function dropOld(d) { st._drop = (st._drop || []).concat(d.pages, d.thumbs); }
  async function thumbOf(bmp) {
    const s = Math.min(1, 360 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); c.width = c.height = 0; return b;
  }
  async function storageCheck() {
    try { const e = await navigator.storage.estimate(); if (e.quota && e.quota - e.usage < 50 * 1048576) toast('Phone mein jagah kam hai. Backup export karke purane scans hata dein.', 'err'); } catch (e) {}
  }
  function scanCancelled() { show('mydocs', 'down'); renderHome(); }
  /** Details sheet: Name (prefilled), Expiry (Passport/DL/Insurance), Notes. Edit adds Name on card + Number. */
  function detailsSheet(o) {
    const t = T[o.type];
    return openSheet((body, close) => {
      const w = document.createElement('div'); w.className = 'md';
      w.innerHTML = `<h3>${o.edit ? 'Edit' : 'Details'}</h3>
        <div class="m-fl" style="margin-top:8px"><div class="lab">Naam</div><label class="m-fld"><input id="mdDName" maxlength="40" value="${esc(o.name)}" aria-label="Naam"></label></div>
        ${o.edit ? `<div class="m-fl"><div class="lab">Name on card (optional)</div><label class="m-fld"><input id="mdDCard" maxlength="40" value="${esc(o.nameOnCard || '')}" autocomplete="off" aria-label="Name on card"></label></div>
        <div class="m-fl"><div class="lab">Number (optional, app mein masked dikhega)</div><label class="m-fld"><input id="mdDNum" maxlength="24" value="${esc(o.number || '')}" autocomplete="off" spellcheck="false" aria-label="Number"></label></div>` : ''}
        ${t.exp ? `<div class="m-fl"><div class="lab">Expiry date (optional)</div><label class="m-fld"><input id="mdDExp" type="date" value="${esc(o.expiry || '')}" aria-label="Expiry date"></label><div class="m-cap" style="margin:6px 4px 0;font-weight:400">30 din pehle My Docs mein yaad dilayenge.</div></div>` : ''}
        <div class="m-fl"><div class="lab">Notes (optional)</div><label class="m-fld"><input id="mdDNotes" maxlength="120" value="${esc(o.notes || '')}" aria-label="Notes"></label></div>
        <button class="m-btnp" id="mdDSave" style="margin:20px 0 8px">Save</button>`;
      body.append(w);
      w.querySelector('#mdDSave').onclick = () => close({ name: w.querySelector('#mdDName').value.trim() || o.name, expiry: (w.querySelector('#mdDExp') || {}).value || null, notes: w.querySelector('#mdDNotes').value.trim(),
        nameOnCard: w.querySelector('#mdDCard') ? w.querySelector('#mdDCard').value.trim() : undefined, number: w.querySelector('#mdDNum') ? w.querySelector('#mdDNum').value.trim() : undefined });
    });
  }

  // ======================================================================= detail (05)
  let cur = null;
  async function openDetail(id, mode) {
    const d = I().docs.find((x) => x.id === id); if (!d) return;
    cur = { d, i: 0, urls: [] };
    await renderDetail();
    if (curView !== 'mddoc') show('mddoc', mode || 'push');
  }
  async function pageUrl(i) { if (!cur.urls[i]) { const b = await Vault.getBlob(cur.d.pages[i]); cur.urls[i] = b ? urlOf(b) : ''; } return cur.urls[i]; }
  function pageLabel(i) { const t = T[cur.d.type]; return t.sides === 2 && cur.d.pages.length <= 2 ? (i ? 'Back' : 'Front') : `Page ${i + 1}`; }
  async function renderDetail() {
    const d = cur.d, t = T[d.type], m = memberOf(d.member), n = d.pages.length;
    const added = new Date(d.added); const land = (d.aspect || 1.6) >= 1;
    const sides = t.sides === 2 ? (n >= 2 ? 'Front &amp; back' : 'Front') : `${n} page${n > 1 ? 's' : ''}`;
    const u0 = await pageUrl(cur.i), u1 = cur.i + 1 < n ? await pageUrl(cur.i + 1) : '';
    const exp = t.exp ? (d.expiry ? fmtDate(d.expiry) : 'Nahi hai') : 'Nahi hai';
    $('mdDoc').innerHTML = `<div class="m-wrap">
      <div class="m-nav"><button class="m-bk" id="mdDocBack">${ic('back')}My Docs</button><span></span></div>
      <div class="m-display" style="margin-top:2px">${esc(t.full)}</div>
      <div class="m-sub tnum" style="margin-top:2px">${esc(m.name)} · ${sides} · Added ${added.getDate()} ${MON[added.getMonth()]}</div>
      <div class="m-ref"><button class="m-chip" id="mdRefChip">${ic('info')}Reference copy</button></div>
      <div class="m-pager" id="mdPager" aria-roledescription="carousel" aria-label="${esc(t.full)} pages">
        <div class="fc${land ? '' : ' portrait'}" role="img" aria-label="${pageLabel(cur.i)}">${u0 ? `<img src="${u0}" alt="${pageLabel(cur.i)}">` : ''}</div>
        ${u1 ? `<div class="pk" aria-hidden="true"><img src="${u1}" alt=""></div>` : ''}
        <div class="m-pg">${d.pages.map((_, i) => `<i class="${i === cur.i ? 'on' : ''}"></i>`).join('')}<span style="margin-left:4px">${pageLabel(cur.i)}</span></div></div>
      <div class="m-card m-list">
        ${d.nameOnCard ? `<div class="m-row"><span class="t">Name on card</span><span class="v">${esc(d.nameOnCard)}</span></div>` : ''}
        ${d.number ? `<div class="m-row"><span class="t">Number</span><span class="v m-mono">${esc(maskNum(d.number, d.type))}</span></div>` : ''}
        <div class="m-row"><span class="t">Expiry</span><span class="v tnum">${exp}</span></div>
        ${d.notes ? `<div class="m-row"><span class="t">Notes</span><span class="v">${esc(d.notes)}</span></div>` : ''}
        <div class="m-row"><span class="t">Legally valid copy</span><a class="v m-dl" href="${DIGILOCKER}" target="_blank" rel="noopener noreferrer">DigiLocker${ic('arrow')}</a></div>
      </div>
      <div class="m-cap" style="margin-top:10px;padding:0 4px">Ye aapki khud ki scan copy hai. Legally valid copy ke liye DigiLocker dekhein.</div></div>`;
    $('mdDocBack').onclick = back;
    $('mdRefChip').onclick = refInfo;
    const pg = $('mdPager'); let x0 = null, y0 = 0;
    pg.onpointerdown = (e) => { x0 = e.clientX; y0 = e.clientY; };
    pg.onpointerup = (e) => {
      if (x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) { const ni = cur.i + (dx < 0 ? 1 : -1); if (ni >= 0 && ni < cur.d.pages.length) { cur.i = ni; renderDetail(); } }
      else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) viewer();
    };
  }
  async function viewer() {
    const u = await pageUrl(cur.i), v = document.createElement('div'); v.className = 'm-viewer md'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', pageLabel(cur.i));
    v.innerHTML = `<img src="${u}" alt="${pageLabel(cur.i)}"><button class="x" aria-label="Close">${ic('x')}</button>`;
    v.querySelector('.x').onclick = () => v.remove();
    let last = 0; v.querySelector('img').onclick = () => { const n = Date.now(); if (n - last < 320) v.classList.toggle('z'); last = n; };
    document.body.append(v);
  }
  function refInfo() {
    return openSheet((body, close) => {
      const w = document.createElement('div'); w.className = 'md';
      w.innerHTML = `<h3>Reference copy</h3><p class="m-sub" style="font-size:calc(17px + var(--dt) * 1);line-height:1.294;margin:8px 0 16px">Ye aapki khud ki scan copy hai. Legally valid copy ke liye DigiLocker dekhein.</p>
        <a class="m-btnp" href="${DIGILOCKER}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">DigiLocker kholein${ic('arrow')}</a><button class="m-btnt" style="margin:4px 0 8px">Done</button>`;
      w.querySelector('.m-btnt').onclick = () => close(null); body.append(w);
    });
  }
  async function editDoc() {
    const d = cur.d; const r = await detailsSheet({ edit: true, type: d.type, name: d.name, expiry: d.expiry, notes: d.notes, nameOnCard: d.nameOnCard, number: d.number });
    if (!r) return; Object.assign(d, { name: r.name, expiry: r.expiry, notes: r.notes, nameOnCard: r.nameOnCard, number: r.number, updated: Date.now() });
    await Vault.saveIndex(); renderDetail(); toast('Saved');
  }
  async function moreDoc() {
    const d = cur.d, m = memberOf(d.member);
    const v = await menu(`${m.name} · ${T[d.type].full}`, [{ label: 'Move', value: 'move', icon: 'folder' }, { label: 'Delete', value: 'del', icon: 'trash', danger: true }]);
    if (v === 'del') {
      if (!await confirmDelete(`${possessive(m)} ${T[d.type].short} delete karein?`, 'Ye wapas nahi aayega.')) return;
      I().docs = I().docs.filter((x) => x !== d); await Vault.commit([], [...d.pages, ...d.thumbs]); back(); toast('Deleted');
    }
    if (v === 'move') { const to = await pickTarget(d.member, d.type); if (!to) return; I().docs = I().docs.filter((x) => x === d || !(x.member === to.member && x.type === to.type && (dropOld(x), true))); Object.assign(d, to); await Vault.commit([], st._drop || []); st._drop = null; st.member = to.member; renderDetail(); toast('Moved'); }
  }
  function pickTarget(member, type) {
    return openSheet((body, close) => {
      let mm = member, tt = type; const w = document.createElement('div'); w.className = 'md';
      const draw = () => {
        w.innerHTML = `<h3>Kahan rakhein?</h3><div class="m-fl"><div class="lab">Member</div><div class="m-chips">${I().members.map((m) => `<button class="m-chip${m.id === mm ? ' on' : ''}" data-m="${m.id}">${esc(m.name)}</button>`).join('')}</div></div>
          <div class="m-fl"><div class="lab">Document</div><div class="m-chips">${TYPES.map((t) => `<button class="m-chip${t.k === tt ? ' on' : ''}" data-t="${t.k}">${esc(t.n)}</button>`).join('')}</div></div>
          <p class="m-cap" style="margin:12px 4px 0;font-weight:400">${I().docs.some((d) => d.member === mm && d.type === tt && !(d.member === member && d.type === type)) ? 'Is slot ka purana document replace ho jayega.' : '&nbsp;'}</p>
          <button class="m-btnp" id="mdPickOk" style="margin:12px 0 8px">Move here</button>`;
        w.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mm = b.dataset.m; draw(); }));
        w.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { tt = b.dataset.t; draw(); }));
        w.querySelector('#mdPickOk').onclick = () => close({ member: mm, type: tt });
      };
      draw(); body.append(w);
    });
  }
  /** Documents tab → long-press → "Move to My Docs": the original and its thumbnail are deleted after the move (S6). */
  async function moveFromDocuments(doc) {
    if (!Vault.isUnlocked()) { toast('Pehle My Docs kholein, phir move karein'); goTab('mydocs'); return false; }
    const to = await pickTarget(st.member || I().members[0].id, 'other'); if (!to) return false;
    busy('Encrypting…');
    try {
      const put = [], pages = [], thumbs = []; let aspect = 1.6;
      for (let i = 0; i < doc.pages.length; i++) {
        const b = doc.pages[i].img || doc.pages[i].orig, bmp = await createImageBitmap(b); if (!i) aspect = bmp.width / bmp.height;
        const id = Vault.newId(); put.push([id, new Uint8Array(await b.arrayBuffer())]); pages.push(id);
        if (i < 2) { const tid = Vault.newId(); put.push([tid, new Uint8Array(await (await thumbOf(bmp)).arrayBuffer())]); thumbs.push(tid); }
        bmp.close();
      }
      I().docs = I().docs.filter((x) => !(x.member === to.member && x.type === to.type && (dropOld(x), true)));
      const now = Date.now(); I().docs.push({ id: Vault.newId(), member: to.member, type: to.type, name: `${memberOf(to.member).name} · ${T[to.type].n}`, expiry: null, notes: '', nameOnCard: '', number: '', pages, thumbs, aspect, added: now, updated: now });
      await Vault.commit(put, st._drop || []); st._drop = null;
      await DB.del(doc.id); // the plain copy (pages + thumbnail) leaves the Documents database
      busy(); toast('Moved to My Docs'); return true;
    } catch (e) { busy(); toast('Move nahi hua: ' + e.message, 'err'); return false; }
  }

  // ======================================================================= share (06 / 06b) — privacy first, in memory only (S2, S9)
  const AAD_BOX = { num: { x: 0.222, y: 0.782, w: 0.36, h: 0.128, kind: 'num' }, qr: { x: 0.709, y: 0.185, w: 0.233, h: 0.37, kind: 'qr' } };
  async function openShare() {
    const d = cur.d, t = T[d.type], n = d.pages.length;
    const boxes = d.pages.map(() => []);
    // Aadhaar: number + QR box on BOTH sides by default (PVC/e-Aadhaar print the QR on the front too). User can drag/resize, or switch QR off per side.
    if (t.mask) for (let i = 0; i < Math.min(n, 2); i++) boxes[i].push({ ...AAD_BOX.num }, { ...AAD_BOX.qr });
    const asp = []; for (let i = 0; i < n; i++) { const b = await Vault.getBlob(d.pages[i]); const bm = await createImageBitmap(b); asp.push(bm.width / bm.height); bm.close(); await pageUrl(i); }
    st.share = { d, fmt: 'pdf', mask: !!t.mask, wm: false, wmText: '', boxes, asp, step: 1, out: null, sel: null, qrMem: [] };
    const root = document.createElement('div'); root.className = 'md'; root.id = 'mdShare';
    root.innerHTML = '<div class="m-dimmer"></div><div class="m-bsheet" role="dialog" aria-modal="true" aria-label="Share"></div>';
    root.querySelector('.m-dimmer').onclick = () => closeShare();
    document.body.append(root); shareStep1();
  }
  function closeShare(silent) {
    const r = $('mdShare'); if (!r) return;
    if (st.share && st.share.out) { st.share.out.urls.forEach((u) => URL.revokeObjectURL(u)); st.share.out = null; }
    st.share = null; r.remove();
  }
  const boxCount = (s) => s.boxes.reduce((a, b) => a + b.length, 0);
  const sideLbl = (d, i) => (T[d.type].sides === 2 && d.pages.length <= 2 ? (i ? 'Back' : 'Front') : `Page ${i + 1}`);
  const hasKind = (s, i, k) => s.boxes[i].some((b) => b.kind === k);
  /** Aadhaar rule: a number box on each side (first two pages) and the QR covered on at least one side. */
  function maskState(s) {
    const n = Math.min(s.d.pages.length, 2), sides = [...Array(n).keys()];
    const num = sides.filter((i) => hasKind(s, i, 'num')).length, qr = sides.filter((i) => hasKind(s, i, 'qr'));
    return { n, num, qr, open: sides.filter((i) => !hasKind(s, i, 'qr')), ok: num === n && qr.length > 0 };
  }
  function toggleQr(p) {
    const s = st.share, j = s.boxes[p].findIndex((b) => b.kind === 'qr');
    if (j >= 0) { s.qrMem[p] = s.boxes[p][j]; s.boxes[p] = s.boxes[p].filter((b) => b.kind !== 'qr'); }
    else s.boxes[p].push({ ...(s.qrMem[p] || AAD_BOX.qr) });
    s.sel = null; shareStep1();
  }
  function shareStep1() {
    const s = st.share, d = s.d, t = T[d.type], sh = $('mdShare').querySelector('.m-bsheet'); s.step = 1;
    const lbl = (i) => sideLbl(d, i);
    const sub = (i) => s.boxes[i].map((b) => (b.kind === 'qr' ? 'QR' : 'Number')).filter((v, j, a) => a.indexOf(v) === j).join(', ') || 'Koi box nahi';
    const ms = maskState(s), qrChip = (i) => (t.mask && i < 2 ? `<button class="m-qrc${hasKind(s, i, 'qr') ? ' on' : ''}" data-qr="${i}" role="switch" aria-checked="${hasKind(s, i, 'qr')}" aria-label="${lbl(i)} par QR chhupayein">${ic(hasKind(s, i, 'qr') ? 'check' : 'plus')}QR</button>` : '');
    const status = t.mask ? `Number ${ms.num}/${ms.n} · QR ${ms.qr.length ? ms.qr.map(lbl).join(' + ') : 'nahi chhupa'}` : '';
    sh.innerHTML = `<div class="m-grab"></div>
      <div class="m-hd"><button class="c" id="mdShX">Cancel</button><b>Share ${esc(t.short === 'document' ? 'document' : t.short)}</b><span class="r m-step tnum">Step 1 of 2</span></div>
      <div class="m-seg" role="radiogroup" aria-label="Format"><button class="${s.fmt === 'pdf' ? 'on' : ''}" data-f="pdf" role="radio" aria-checked="${s.fmt === 'pdf'}">PDF</button><button class="${s.fmt === 'img' ? 'on' : ''}" data-f="img" role="radio" aria-checked="${s.fmt === 'img'}">Image</button></div>
      <div class="m-cap" style="margin-top:12px;font-weight:400;font-size:calc(15px + var(--dt) * 0.94);line-height:1.333">${t.mask ? 'Number aur QR ke upar box rakhein. Box ko kheench kar khiskayein, kono se chhota-bada karein.' : 'Number chhupana ho to toggle on karein aur box kheenchein.'}</div>
      <div class="m-well2 m-cards" style="margin-top:10px">${d.pages.map((_, i) => `<div class="m-slab"><b>${lbl(i)}</b>${t.mask && i < 2 ? (hasKind(s, i, 'num') ? 'Number' : 'Number nahi') : sub(i)}${qrChip(i)}</div><div class="m-mask" data-p="${i}" style="height:${Math.round(254 / s.asp[i])}px"><img src="${cur.urls[i]}" alt="${lbl(i)}"></div>`).join('')}
        ${s.mask ? `<div class="m-mhint">${s.sel ? 'Box chuna gaya · <b>×</b> se hatayein' : 'Box par tap karke chunein · khaali jagah par kheench kar naya box'}</div>` : ''}</div>
      <div class="m-card" style="margin-top:12px">
        <div class="m-tr"><div class="t">Number chhupayein<small class="tnum">${t.mask ? `Aadhaar par zaroori · ${status}` : s.mask ? `${boxCount(s)} box · image par kheench kar aur jodein` : 'Off'}</small></div><button class="m-toggle${s.mask ? ' on' : ''}" id="mdMaskT" role="switch" aria-checked="${s.mask}" aria-label="Number chhupayein"${t.mask ? ' aria-disabled="true"' : ''}></button></div>
        <div class="m-tr"><div class="t">Add watermark<small>Jaise "Only for KYC at ___"</small>${s.wm ? `<input id="mdWm" maxlength="40" placeholder="Only for KYC at ___" value="${esc(s.wmText)}" aria-label="Watermark text">` : ''}</div><button class="m-toggle${s.wm ? ' on' : ''}" id="mdWmT" role="switch" aria-checked="${s.wm}" aria-label="Add watermark"></button></div>
      </div>
      <button class="m-btnp" id="mdShPrev" style="margin-top:14px"${t.mask && !ms.ok ? ' disabled' : ''}>Preview</button>
      ${t.mask && !ms.ok ? `<div class="m-cap m-warn" role="status">${ic('warn')}<span>${ms.num < ms.n ? 'Har side par number ke upar box zaroori hai.' : 'QR ko kam se kam ek side par chhupayein.'}</span></div>` : ''}`;
    sh.querySelectorAll('[data-qr]').forEach((b) => (b.onclick = () => toggleQr(+b.dataset.qr)));
    $('mdShX').onclick = () => closeShare();
    sh.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { s.fmt = b.dataset.f; shareStep1(); }));
    $('mdMaskT').onclick = () => {
      if (t.mask) { toast('Aadhaar par number chhupana zaroori hai'); return; }
      s.mask = !s.mask; if (s.mask && !boxCount(s)) s.boxes[0].push({ x: 0.3, y: 0.78, w: 0.4, h: 0.13, kind: 'box' }); if (!s.mask) s.boxes = s.boxes.map(() => []); shareStep1();
    };
    $('mdWmT').onclick = () => { s.wm = !s.wm; shareStep1(); if (s.wm) setTimeout(() => $('mdWm') && $('mdWm').focus(), 50); };
    if ($('mdWm')) $('mdWm').oninput = (e) => { s.wmText = e.target.value; };
    $('mdShPrev').onclick = sharePreview;
    sh.querySelectorAll('.m-mask').forEach((m) => wireMask(m, +m.dataset.p));
  }
  function boxEl(b, j, H, sel) {
    const txt = b.kind === 'num' ? 'XXXX XXXX' : b.kind === 'qr' ? 'QR' : '';
    const name = b.kind === 'num' ? 'Number' : b.kind === 'qr' ? 'QR' : 'Mask';
    return `<div class="m-box ${b.kind}${sel ? ' sel' : ''}" data-j="${j}" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%;font-size:${b.kind === 'qr' ? 10.6 : Math.max(8, b.h * H * 0.78).toFixed(1)}px" role="img" aria-label="${name} box">${txt}${sel ? '<button class="m-bx" data-del="1" aria-label="Box hatayein">×</button>' : ''}${['0,0', '100%,0', '0,100%', '100%,100%'].map((p, k) => { const [x, y] = p.split(','); return `<i data-h="${k}" style="left:${x};top:${y}"></i>`; }).join('')}</div>`;
  }
  function wireMask(m, p) {
    const s = st.share; const H = m.clientHeight || 159;
    const isSel = (j) => s.sel && s.sel.p === p && s.sel.j === j;
    const draw = () => { m.querySelectorAll('.m-box').forEach((e) => e.remove()); if (s.mask) m.insertAdjacentHTML('beforeend', s.boxes[p].map((b, j) => boxEl(b, j, H, isSel(j))).join('')); };
    draw();
    let drag = null;
    const fr = (e) => { const r = m.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    m.onpointerdown = (e) => {
      if (!s.mask) return; const pt = fr(e), be = e.target.closest('.m-box'), h = e.target.dataset && e.target.dataset.h;
      if (be && e.target.dataset.del) { s.boxes[p].splice(+be.dataset.j, 1); s.sel = null; e.preventDefault(); shareStep1(); return; }
      if (be) { const j = +be.dataset.j, b = s.boxes[p][j]; drag = h != null ? { j, mode: 'h', k: +h, b0: { ...b } } : { j, mode: 'm', o: { x: pt.x - b.x, y: pt.y - b.y } }; }
      else { s.boxes[p].push({ x: pt.x, y: pt.y, w: 0.001, h: 0.001, kind: 'box' }); drag = { j: s.boxes[p].length - 1, mode: 'new', a: pt }; }
      m.setPointerCapture(e.pointerId); e.preventDefault();
    };
    m.onpointermove = (e) => {
      if (!drag) return; const pt = fr(e), b = s.boxes[p][drag.j];
      drag.moved = true;
      if (drag.mode === 'm') { b.x = Math.max(0, Math.min(1 - b.w, pt.x - drag.o.x)); b.y = Math.max(0, Math.min(1 - b.h, pt.y - drag.o.y)); }
      else if (drag.mode === 'new') { b.x = Math.min(pt.x, drag.a.x); b.y = Math.min(pt.y, drag.a.y); b.w = Math.abs(pt.x - drag.a.x); b.h = Math.abs(pt.y - drag.a.y); }
      else { const o = drag.b0, L = drag.k % 2 === 0, Tp = drag.k < 2; const x2 = o.x + o.w, y2 = o.y + o.h;
        const nx = L ? Math.min(pt.x, x2 - 0.03) : o.x, ny = Tp ? Math.min(pt.y, y2 - 0.03) : o.y;
        b.x = nx; b.y = ny; b.w = (L ? x2 : Math.max(pt.x, o.x + 0.03)) - nx; b.h = (Tp ? y2 : Math.max(pt.y, o.y + 0.03)) - ny; }
      draw();
    };
    m.onpointerup = () => {
      if (!drag) return; const b = s.boxes[p][drag.j];
      if (drag.mode === 'new') { if (b.w < 0.03 || b.h < 0.03) { s.boxes[p].splice(drag.j, 1); s.sel = null; } else s.sel = { p, j: drag.j }; }
      else s.sel = { p, j: drag.j }; // tap or drag selects the box → shows its × button
      drag = null; shareStep1();
    };
    m.ondblclick = (e) => { const be = e.target.closest('.m-box'); if (!be) return; s.boxes[p].splice(+be.dataset.j, 1); s.sel = null; shareStep1(); };
  }
  /** Burn mask boxes into pixels (canvas), re-encode via canvas (drops EXIF/metadata). Returns a canvas. */
  async function burn(blob, boxes) {
    const bm = await createImageBitmap(blob, { imageOrientation: 'from-image' }); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
    const x = c.getContext('2d'); x.drawImage(bm, 0, 0); bm.close();
    for (const b of boxes) {
      const X = b.x * c.width, Y = b.y * c.height, W = b.w * c.width, Hh = b.h * c.height, r = Math.min(W, Hh) * 0.12;
      x.fillStyle = '#2f3433'; x.beginPath(); x.roundRect ? x.roundRect(X, Y, W, Hh, r) : x.rect(X, Y, W, Hh); x.fill();
      const txt = b.kind === 'num' ? 'XXXX XXXX' : b.kind === 'qr' ? 'QR' : '';
      if (txt) { let fs = b.kind === 'qr' ? Hh * 0.18 : Hh * 0.74; x.font = `700 ${fs}px "DejaVu Sans Mono", ui-monospace, monospace`; const tw = x.measureText(txt).width; if (tw > W * 0.94) { fs *= (W * 0.94) / tw; x.font = `700 ${fs}px "DejaVu Sans Mono", ui-monospace, monospace`; }
        x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, X + W / 2, Y + Hh / 2 + fs * 0.04); }
    }
    return c;
  }
  const A4 = [1240, 1754];
  function watermark(x, w, h, text) {
    x.save(); x.globalAlpha = 0.22; x.fillStyle = '#1b1f1e'; x.font = `600 ${Math.round(w / 22)}px Inter, -apple-system, system-ui, sans-serif`; x.textAlign = 'center';
    x.translate(w / 2, h / 2); x.rotate(-Math.PI / 6); for (let yy = -h; yy < h; yy += w / 7) x.fillText(text, 0, yy); x.restore();
  }
  async function composeOut() {
    const s = st.share, d = s.d, t = T[d.type], wm = s.wm ? (s.wmText.trim() || 'Only for KYC') : '';
    const masked = []; for (let i = 0; i < d.pages.length; i++) masked.push(await burn(await Vault.getBlob(d.pages[i]), s.mask ? s.boxes[i] : []));
    const pages = [];
    const cardLayout = t.mode === 'card' && masked.length <= 2 && masked.every((c) => c.width >= c.height);
    if (cardLayout) { // one A4 page, front over back (mockup 06b: x 21/222, y 22 & 166 of 314, width 180/222)
      const c = document.createElement('canvas'); [c.width, c.height] = A4; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      const k = A4[0] / 222, W = 180 * k; masked.forEach((m, i) => { const Hh = W * m.height / m.width; x.drawImage(m, 21 * k, (i ? 166 : 22) * k, W, Math.min(Hh, 136 * k)); });
      if (wm) watermark(x, c.width, c.height, wm); pages.push(c);
    } else for (const m of masked) {
      const c = document.createElement('canvas'); [c.width, c.height] = A4; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      const mg = 50, sc = Math.min((A4[0] - 2 * mg) / m.width, (A4[1] - 2 * mg) / m.height), w = m.width * sc, h = m.height * sc;
      x.drawImage(m, (A4[0] - w) / 2, (A4[1] - h) / 2, w, h); if (wm) watermark(x, c.width, c.height, wm); pages.push(c);
    }
    masked.forEach((m) => { m.width = m.height = 0; });
    const jpegs = []; for (const c of pages) { jpegs.push(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))); c.width = c.height = 0; }
    const m = memberOf(d.member), base = `${m.name}_${t.short === 'document' ? 'Document' : t.short.replace(/\s+/g, '')}${s.mask ? '_masked' : ''}`.replace(/[^\w\-]+/g, '_');
    let files;
    if (s.fmt === 'pdf') files = [new File([await pdfFromJpegs(jpegs)], base + '.pdf', { type: 'application/pdf' })];
    else files = jpegs.map((j, i) => new File([j], base + (jpegs.length > 1 ? `_${i + 1}` : '') + '.jpg', { type: 'image/jpeg' }));
    const prev = URL.createObjectURL(jpegs[0]);
    return { files, pages: jpegs.length, urls: [prev], prev };
  }
  /** Minimal PDF writer: each page is one full-page JPEG (DCTDecode). No text, no annotations, no /Info metadata. */
  async function pdfFromJpegs(jpegs) {
    const te = new TextEncoder(), parts = [], offs = []; let pos = 0;
    const push = (u) => { parts.push(u); pos += u.length; };
    const obj = (n, body, stream) => { offs[n] = pos; push(te.encode(`${n} 0 obj\n${body}\n`)); if (stream) { push(te.encode('stream\n')); push(stream); push(te.encode('\nendstream\n')); } push(te.encode('endobj\n')); };
    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const n = jpegs.length, kids = []; for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`);
    for (let i = 0; i < n; i++) {
      const bytes = new Uint8Array(await jpegs[i].arrayBuffer()), bm = await createImageBitmap(jpegs[i]), w = bm.width, h = bm.height; bm.close();
      const p = 3 + i * 3, W = 595.28, H = 841.89, cs = te.encode(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`);
      obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
      obj(p + 1, `<< /Length ${cs.length} >>`, cs);
      obj(p + 2, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`, bytes);
    }
    const xref = pos, total = 3 + n * 3; let x = `xref\n0 ${total}\n0000000000 65535 f \n`; for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(te.encode(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    return new Blob(parts, { type: 'application/pdf' });
  }
  async function sharePreview() {
    const s = st.share; busy('Preview ban raha hai…');
    try { if (s.out) s.out.urls.forEach((u) => URL.revokeObjectURL(u)); s.out = await composeOut(); } catch (e) { busy(); console.warn('preview', e); toast('Preview nahi bana. Dobara koshish karein.', 'err'); return; }
    busy(); s.step = 2;
    const d = s.d, t = T[d.type], f = s.out.files, l4 = last4(d), sh = $('mdShare').querySelector('.m-bsheet');
    const checks = [], warns = [];
    if (s.mask && t.mask) {
      const ms = maskState(s), L = (i) => sideLbl(d, i);
      for (let i = 0; i < ms.n; i++) checks.push(`${L(i)} number: ${l4 ? `<span class="m-mono2">XXXX XXXX ${esc(l4)}</span>` : 'chhupa hua'}`);
      if (ms.qr.length) checks.push(`QR code chhupa hua: ${ms.qr.map(L).join(' aur ')}`);
      if (ms.open.length) warns.push(`${ms.open.map(L).join(' aur ')} par QR khula hai. QR mein poora Aadhaar number hota hai.`);
    }
    else if (s.mask) checks.push(`${boxCount(s)} box${boxCount(s) > 1 ? 'es' : ''} se number chhupa hua`);
    if (s.wm) checks.push(`Watermark: ${esc(s.wmText.trim() || 'Only for KYC')}`);
    sh.innerHTML = `<div class="m-grab"></div>
      <div class="m-hd"><button class="c" id="mdShBack" style="margin-left:-8px">${ic('back', '', 'width:26px;height:26px;stroke-width:2.2')}Back</button><b>Preview</b><span class="r m-step tnum">Step 2 of 2</span></div>
      <div style="font-size:calc(15px + var(--dt) * 0.94);line-height:1.333;color:var(--m-ink2)">Yahi file share hogi. Ek baar dhyan se dekh lein.</div>
      <div class="m-pgw" style="margin-top:10px"><div class="m-pgp"><img src="${s.out.prev}" alt="Preview of the file to share"></div>
        <div class="m-cap tnum" style="text-align:center;margin-top:10px">${s.fmt === 'pdf' ? 'PDF' : 'Image'} · ${s.out.pages} ${s.fmt === 'pdf' ? 'page' : 'photo'}${s.out.pages > 1 ? 's' : ''} · ${esc(f.length > 1 ? f.length + ' files' : f[0].name)}</div></div>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:2px">${checks.map((c) => `<div class="m-ck">${ic('check')}<span>${c}</span></div>`).join('')}${warns.map((c) => `<div class="m-ck m-ckw">${ic('warn')}<span>${c}</span></div>`).join('')}</div>
      <button class="m-btnp" id="mdShGo" style="margin-top:14px">Haan, ye share karein</button>
      <button class="m-btnt" id="mdShEdit" style="margin-top:2px">Mask badlein</button>
      <div class="m-cap" style="text-align:center;font-weight:400">File sirf memory mein banti hai aur share ke baad turant mit jaati hai.</div>`;
    $('mdShBack').onclick = $('mdShEdit').onclick = () => { if (s.out) { s.out.urls.forEach((u) => URL.revokeObjectURL(u)); s.out = null; } s.sel = null; shareStep1(); };
    $('mdShGo').onclick = doShare;
  }
  async function doShare() {
    const s = st.share; if (!s || !s.out) return; const files = s.out.files;
    try {
      if (navigator.canShare && navigator.canShare({ files })) await navigator.share({ files });
      else for (const f of files) { const u = URL.createObjectURL(f), a = document.createElement('a'); a.href = u; a.download = f.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
      toast('Shared'); if (typeof haptic === 'function') haptic('success');
    } catch (e) { if (e.name !== 'AbortError') toast('Share nahi hua', 'err'); }
    finally { closeShare(); } // revokes the preview URL and drops the only reference to the file
  }

  // ======================================================================= backup (07 / 07b) + import
  function openBackup(from) {
    if (!Vault.isUnlocked()) { st.after = 'backup'; goTab('mydocs'); return; }
    st.bkFrom = from || (curView === 'settings' ? 'settings' : 'mydocs');
    renderBackup(); if (curView !== 'mdbackup') show('mdbackup', 'push');
  }
  function renderBackup() {
    const idx = I(), bk = idx.backup || {}, n = idx.docs.length;
    const mem = [...idx.members.filter((m) => m.name !== 'Aap'), ...idx.members.filter((m) => m.name === 'Aap')].map((m) => m.name).join(', ');
    $('mdBk').innerHTML = `<div class="m-wrap">
      <div class="m-nav"><button class="m-bk" id="mdBkBack">${ic('back')}${st.bkFrom === 'mydocs' ? 'My Docs' : 'Settings'}</button><span></span></div>
      <div class="m-display" style="margin-top:2px">Backup</div>
      <div class="m-sub" style="margin-top:2px">My Docs</div>
      <div class="m-amber" style="margin-top:14px">${ic('warn')}<span>${DELETE_LINE}</span></div>
      <div class="m-cap" id="mdFinal2" style="margin-top:8px;padding:0 4px;font-weight:400;font-size:calc(13px + var(--dt) * 0.86);line-height:1.385">${FINAL_LINE}</div>
      <div class="m-card m-stc"><div class="m-tile" style="--c:var(--c-protect)">${ic('backup')}</div><div class="t">Last backup: ${bk.last ? ago(bk.last) : 'never'}<small class="tnum">${esc(mem)} · ${n} document${n === 1 ? '' : 's'}</small></div></div>
      <button class="m-btnp" id="mdExport" style="margin-top:14px">${ic('backup')}Export backup</button>
      <div class="m-card m-list" style="margin-top:16px">
        <button class="m-row" id="mdImport"><span class="ic">${ic('importb')}</span><span class="t" style="color:var(--ink);font-size:calc(17px + var(--dt) * 1)">Import backup<small>File chunein, password daalein, merge ya replace</small></span>${ic('chev', 'ch')}</button>
        <div class="m-row"><span class="ic">${ic('cal')}</span><span class="t" style="color:var(--ink);font-size:calc(17px + var(--dt) * 1)">Backup reminder<small>3 documents ke baad, phir har 30 din. Band nahi hota.</small></span><span class="v" style="color:var(--m-ink2);font-weight:400;font-size:calc(17px + var(--dt) * 1)">On</span></div>
      </div>
      <div class="m-cap" style="margin-top:10px;padding:0 4px;font-weight:400">Backup ek .docsnapvault file banti hai, jo alag backup password se encrypted hoti hai. Ise Files ya AirDrop se save karein.</div></div>`;
    $('mdBkBack').onclick = back;
    $('mdExport').onclick = () => renderPwExport();
    $('mdImport').onclick = () => importFlow(false);
  }
  function pwField(id, label) {
    return `<div class="m-fl"><div class="lab">${label}</div><label class="m-fld"><input id="${id}" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off" aria-label="${label}"><button class="eye" data-eye="${id}" aria-label="Show password">${ic('eye')}</button></label>`;
  }
  function wireEyes(root) { root.querySelectorAll('[data-eye]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); const i = $(b.dataset.eye), sh = i.type === 'password'; i.type = sh ? 'text' : 'password'; b.innerHTML = ic(sh ? 'eyeoff' : 'eye'); b.setAttribute('aria-label', sh ? 'Hide password' : 'Show password'); })); }
  function renderPwExport() {
    const w = $('mdPw');
    w.innerHTML = `<div class="m-flow"><div class="m-wrap">
      <div class="m-nav"><button class="m-bk" id="mdPwX" style="margin-left:0">Cancel</button><span class="m-step tnum">Step 1 of 2</span></div>
      <div class="m-display" style="margin-top:2px">Backup password</div>
      <div class="m-sub" style="margin-top:6px;font-size:calc(17px + var(--dt) * 1);line-height:1.294">Ye password aapke PIN se alag hai. Backup file kholne ke liye isi ki zaroorat hogi.</div>
      ${pwField('mdPw1', 'Password')}
        <div class="m-meter"><div class="b" id="mdMeter"><i></i><i></i><i></i><i></i></div><span id="mdMeterL"></span></div>
        <div class="m-ck no tnum" id="mdLen">${ic('check')}<span>Kam se kam 12 characters (0)</span></div></div>
      ${pwField('mdPw2', 'Confirm password')}
        <div class="m-ck no" id="mdMatch">${ic('check')}<span>Dono password match karte hain</span></div></div>
      <div class="m-amber" style="margin-top:18px">${ic('warn')}<span>Ye password bhool gaye to ye backup kabhi nahi khulega. DocSnap bhi ise nahi khol sakta.</span></div>
      </div><div class="m-bot"><button class="m-btnp" id="mdPwGo" disabled>Create backup file</button><div class="m-cap" style="text-align:center;margin-top:12px;font-weight:400">Ye password kahin save nahi hota, phone par bhi nahi.</div></div></div>`;
    show('mdbpw', 'up'); wireEyes(w);
    const p1 = $('mdPw1'), p2 = $('mdPw2'), go = $('mdPwGo');
    const upd = () => {
      const s = Vault.strength(p1.value), m = $('mdMeter');
      [...m.children].forEach((b, i) => b.classList.toggle('on', p1.value && i < Math.max(1, s.score)));
      m.classList.toggle('weak', s.score < 3); $('mdMeterL').textContent = p1.value ? s.label : '';
      const len = $('mdLen'); len.className = 'm-ck tnum ' + (s.length >= 12 ? '' : 'no'); len.querySelector('span').textContent = `Kam se kam 12 characters (${s.length})`;
      const mt = $('mdMatch'), same = p2.value && p1.value === p2.value; mt.className = 'm-ck ' + (same ? '' : p2.value ? 'bad' : 'no'); mt.querySelector('span').textContent = same || !p2.value ? 'Dono password match karte hain' : 'Password match nahi karte';
      go.disabled = !(s.ok && same);
      if (p1.value && s.length >= 12 && !s.ok) { len.className = 'm-ck bad'; len.querySelector('span').textContent = 'Password kamzor hai. Lamba phrase ya numbers aur symbols milayein.'; }
    };
    p1.oninput = p2.oninput = upd; upd();
    $('mdPwX').onclick = () => { w.innerHTML = ''; show('mdbackup', 'down'); };
    go.onclick = async () => {
      if (go.disabled) return; go.disabled = true; busy('Backup encrypt ho raha hai…');
      let blob; try { blob = await Vault.exportBackup(p1.value); } catch (e) { busy(); console.warn('export', e); toast(e.code === 'WEAK_PASSWORD' ? 'Backup nahi bana: password kamzor hai' : 'Backup nahi bana. Dobara koshish karein.', 'err'); go.disabled = false; return; }
      p1.value = p2.value = ''; busy();
      const d = new Date(), name = `DocSnap-MyDocs-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.docsnapvault`;
      const file = new File([blob], name, { type: 'application/octet-stream' });
      let ok = false;
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); ok = true; }
        else { const u = URL.createObjectURL(file), a = document.createElement('a'); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1500); ok = true; }
      } catch (e) { if (e.name !== 'AbortError') toast('Backup save nahi hua', 'err'); }
      if (ok) { await Vault.markBackup(); toast('Backup ready · file ko Files mein save karein'); if (typeof haptic === 'function') haptic('success'); }
      w.innerHTML = ''; renderBackup(); show('mdbackup', 'down');
    };
  }
  async function importFlow(fresh) {
    const files = await pickFiles(''); if (!files.length) return;
    renderPwImport(files[0], fresh);
  }
  function renderPwImport(file, fresh) {
    const w = $('mdPw');
    w.innerHTML = `<div class="m-flow"><div class="m-wrap">
      <div class="m-nav"><button class="m-bk" id="mdPwX" style="margin-left:0">Cancel</button><span class="m-step tnum"></span></div>
      <div class="m-display" style="margin-top:2px">Backup kholein</div>
      <div class="m-sub" style="margin-top:6px;font-size:calc(17px + var(--dt) * 1);line-height:1.294">${esc(file.name)} · backup password daalein. Ye password PIN se alag hai.</div>
      ${pwField('mdPwI', 'Backup password')}<div class="m-inl" id="mdPwErr" role="alert"></div></div>
      </div><div class="m-bot"><button class="m-btnp" id="mdPwGo">Import</button><div class="m-cap" style="text-align:center;margin-top:12px;font-weight:400">Galat password par kuch nahi badalta.</div></div></div>`;
    show('mdbpw', 'up'); wireEyes(w);
    const back2 = () => { w.innerHTML = ''; if (fresh) { show('mydocs', 'down'); open(false); } else show('mdbackup', 'down'); };
    $('mdPwX').onclick = back2;
    const inp = $('mdPwI'), errEl = $('mdPwErr');
    // Only these vetted strings ever reach the screen — never a raw library / JS error (Shuri 3.5.0 item 10).
    const MSG = { BAD_FILE: 'Backup file kharab hai ya DocSnap ki nahi hai.', DECRYPT_FAILED: 'Password galat hai ya file kharab hai.', ARGON_LOAD: 'Encryption engine load nahi hua. Internet on karke dobara koshish karein.' };
    const showErr = (code) => {
      if (!code) { errEl.innerHTML = ''; errEl.classList.remove('on'); return; }
      const t = MSG[code] || 'Backup abhi nahi khul saka. Dobara koshish karein.';
      errEl.innerHTML = `${ic('warn')}<span>${esc(t)}${code === 'BAD_FILE' ? '<button class="m-dl" id="mdPwPick">Doosri file chunein</button>' : ''}</span>`;
      errEl.classList.add('on');
      const pk = $('mdPwPick'); if (pk) pk.onclick = async () => { const f = await pickFiles(''); if (f.length) renderPwImport(f[0], fresh); };
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') $('mdPwGo').click(); }; inp.oninput = () => showErr('');
    $('mdPwGo').onclick = async () => {
      busy('Backup khul raha hai…'); let data;
      try { data = await Vault.readBackup(file, inp.value); } catch (e) { busy(); showErr(e && e.code); if (typeof haptic === 'function') haptic('delete'); return; }
      inp.value = ''; busy();
      const n = data.index.docs.length;
      if (fresh || !Vault.isUnlocked()) { w.innerHTML = ''; st.restored = true; toast(`${n} document mile · ab naya PIN banayein`); return setupPin({ index: data.index, blobs: data.blobs }); }
      const mode = await menu('Backup import', [{ label: 'Merge (dono rakhein)', value: 'merge', icon: 'merge' }, { label: 'Replace (abhi wale hata kar)', value: 'replace', icon: 'trash', danger: true }], `${n} document is backup mein hain.`);
      if (!mode) return;
      busy('Import ho raha hai…'); try { await Vault.restore(data, mode); } catch (e) { busy(); console.warn('restore', e); toast('Import nahi hua. Dobara koshish karein.', 'err'); return; }
      busy(); w.innerHTML = ''; st.member = null; renderBackup(); show('mdbackup', 'down'); toast(`${n} document import hue`);
    };
    setTimeout(() => inp.focus(), 400);
  }

  // ======================================================================= settings rows, back, init
  const GRACE = [[0, 'Immediately'], [60e3, '1 min'], [300e3, '5 min']];
  async function settingsRows() {
    await refreshCache().catch(() => {});
    const on = st.cached !== 'none';
    if ($('setMdLockVal')) $('setMdLockVal').textContent = on ? (GRACE.find((g) => g[0] === st.grace) || GRACE[0])[1] : '—';
    if ($('setMdFaceVal')) $('setMdFaceVal').textContent = !on ? '—' : st.prfOn ? 'On' : 'Off';
    if ($('setMdBackupVal')) $('setMdBackupVal').textContent = !on ? 'Set up' : Vault.isUnlocked() ? (I().backup && I().backup.last ? ago(I().backup.last) : 'Never') : 'Locked';
  }
  function needUnlock(fn) { if (Vault.isUnlocked()) return fn(); st.after = fn; toast('Pehle My Docs kholein'); goTab('mydocs'); }
  function wireSettings() {
    const b = $('setMdBackup'), l = $('setMdLock'), f = $('setMdFace');
    if (b) b.onclick = () => (st.cached === 'none' ? goTab('mydocs') : openBackup('settings'));
    if (l) l.onclick = () => (st.cached === 'none' ? goTab('mydocs') : needUnlock(async () => {
      if (curView !== 'settings') show('settings', 'tab');
      const v = await menu('Auto-lock', GRACE.map(([ms, lb]) => ({ label: lb, value: String(ms), checked: ms === st.grace })), 'App band hone ke kitni der baad My Docs lock ho.');
      if (v != null) { await Vault.setGrace(+v); st.grace = +v; settingsRows(); }
    }));
    if (f) f.onclick = () => {
      if (st.cached === 'none') return goTab('mydocs');
      if (st.prfOn) return Vault.disablePrf().then(() => { toast('Face ID off'); return settingsRows(); });
      needUnlock(async () => {
        if (curView !== 'settings') show('settings', 'tab');
        try { await Vault.enablePrf(); toast('Face ID on'); } catch (e) { toast(e.code === 'PRF_UNSUPPORTED' ? 'Is phone par Face ID se key protect nahi ho sakti' : 'Face ID on nahi hua', 'err'); }
        settingsRows();
      });
    };
  }
  function back() {
    if (curView === 'mddoc') { cur = null; show('mydocs', 'pop'); renderHome({ keepScroll: true }); }
    else if (curView === 'mdbackup') { show(st.bkFrom || 'settings', 'pop'); if (st.bkFrom === 'settings' && typeof renderSettings === 'function') renderSettings(); }
    else if (curView === 'mdbpw') { const x = $('mdPwX'); if (x) x.click(); }
    else if (curView === 'mdflow') { if (st.forced) return; if (st.flowBack) st.flowBack(); else closeFlow(); }
  }
  function init() {
    wireSettings();
    $('mdDocActs').querySelector('[data-a=share]').onclick = () => cur && openShare();
    $('mdDocActs').querySelector('[data-a=edit]').onclick = () => cur && editDoc();
    $('mdDocActs').querySelector('[data-a=replace]').onclick = () => cur && startCapture(cur.d.member, cur.d.type, cur.d.id);
    $('mdDocActs').querySelector('[data-a=more]').onclick = () => cur && moreDoc();
    const ax = () => document.documentElement.classList.toggle('ax', parseFloat(getComputedStyle(document.documentElement).fontSize) >= 28);
    ax(); addEventListener('resize', ax);
    refreshCache();
  }
  init();
  return { open, lockNow, renderHome, saveScan, scanCancelled, openBackup, settingsRows, back, moveFromDocuments, isOpen: () => Vault.isUnlocked(), st, TYPES,
    _test: { renderPwImport, startCapture, openDetail, openShare, shareStep1, sharePreview, composeOut, pdfFromJpegs, burn, renderLock, recoveryEntry, renderNewDevice, renderIntro, refreshCache, addDoc: async (member, type, blobs, extra = {}) => {
      const v = { member, type }; const put = [], pages = [], thumbs = []; let aspect = 1.6;
      for (let i = 0; i < blobs.length; i++) { const bm = await createImageBitmap(blobs[i]); if (!i) aspect = bm.width / bm.height; const id = Vault.newId(); put.push([id, new Uint8Array(await blobs[i].arrayBuffer())]); pages.push(id); if (i < 2) { const tid = Vault.newId(); put.push([tid, new Uint8Array(await (await thumbOf(bm)).arrayBuffer())]); thumbs.push(tid); } bm.close(); }
      const now = Date.now(), d = { id: Vault.newId(), member, type, name: `${memberOf(member).name} · ${T[type].n}`, expiry: null, notes: '', nameOnCard: '', number: '', pages, thumbs, aspect, added: now, updated: now, ...extra };
      I().docs = I().docs.filter((x) => !(x.member === member && x.type === type)); I().docs.push(d); await Vault.commit(put); void v; return d;
    } } };
})();
