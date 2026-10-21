'use strict';
/* DocSnap 3.5 "My Docs" vault — crypto + encrypted storage (no DOM).
   Design (approved by Nick Fury, 21 Oct 2026):
   - A random 256-bit data key (DK, AES-GCM) encrypts every vault record (index + images) in IndexedDB 'docsnap-vault'.
   - Device secret: a non-extractable WebCrypto HMAC-SHA256 key kept in IndexedDB (raw bytes never exist in JS).
   - DK is wrapped three ways:
       PIN       KEK = HKDF( Argon2id(PIN, 64 MiB) || HMAC(dev, "pin") )
       Face ID   KEK = HKDF( WebAuthn PRF output || HMAC(dev, "prf") )      → Face ID alone never opens another phone
       Recovery  KEK = HKDF( Argon2id(code, 64 MiB) )                         → no device secret: works after an iCloud restore
   - Canary: a known value sealed under HMAC(dev, "canary"); if it can't be opened this is a new phone → recovery code / backup only.
   - After a recovery-code unlock: new PIN, new device secret, new DK (all records re-encrypted), new recovery code; one IDB transaction.
   - Backup file (.docsnapvault): Argon2id(password, 64 MiB) + AES-GCM over the whole decrypted vault. */
const Vault = (() => {
  const te = new TextEncoder(), td = new TextDecoder();
  const KDF = { m: 65536, t: 3, p: 1 }; // Argon2id: 64 MiB, 3 passes, 1 lane (~0.5 s on a recent iPhone)
  const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const LOCK_STEPS = [60e3, 300e3, 900e3]; // 5 wrong PINs → 1 min, then 5, then 15 min
  const PIN_TRIES = 5;
  const stats = []; // Argon2id timings (ms) — read by tests and the About row
  const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
  const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const wipe = (u) => { if (u && u.fill) u.fill(0); };
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });

  // ---------- IndexedDB ----------
  let db = null;
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('docsnap-vault', 1);
      r.onupgradeneeded = () => { for (const s of ['cfg', 'dev', 'rec']) r.result.createObjectStore(s); };
      r.onsuccess = () => { db = r.result; db.onversionchange = () => { db.close(); db = null; }; res(db); };
      r.onerror = () => rej(r.error);
    });
  }
  async function get(store, key) { const d = await open(); return req(d.transaction(store).objectStore(store).get(key)); }
  async function keys(store) { const d = await open(); return req(d.transaction(store).objectStore(store).getAllKeys()); }
  /** One atomic transaction. ops: [store, 'put'|'delete'|'clear', key, value] */
  async function write(ops) {
    const d = await open(), stores = [...new Set(ops.map((o) => o[0]))];
    return new Promise((res, rej) => {
      const t = d.transaction(stores, 'readwrite');
      for (const [s, op, k, v] of ops) { const st = t.objectStore(s); if (op === 'put') st.put(v, k); else if (op === 'delete') st.delete(k); else st.clear(); }
      t.oncomplete = () => { for (const [s, op, k, v] of ops) if (s === 'cfg') C = op === 'put' && k === 'cfg' ? structuredClone(v) : op === 'put' ? C : null; res(); }; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || err('ABORT'));
    });
  }

  // ---------- primitives ----------
  let argonP = null;
  function ensureArgon() {
    if (self.hashwasm && self.hashwasm.argon2id) return Promise.resolve();
    return argonP || (argonP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/hash-wasm/argon2.umd.min.js';
      s.onload = () => res(); s.onerror = () => { argonP = null; rej(err('ARGON_LOAD', 'Couldn’t load the encryption engine')); }; document.head.append(s);
    }));
  }
  async function argon(secret, salt, k = KDF, tag = '') {
    await ensureArgon();
    const t0 = performance.now();
    const h = await self.hashwasm.argon2id({ password: secret, salt, parallelism: k.p, iterations: k.t, memorySize: k.m, hashLength: 32, outputType: 'binary' });
    stats.push({ tag, ms: Math.round(performance.now() - t0), m: k.m, t: k.t, p: k.p });
    return h;
  }
  async function hkdf(ikm, info, usages = ['encrypt', 'decrypt']) {
    const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('docsnap-mydocs-v1'), info: te.encode(info) }, k, { name: 'AES-GCM', length: 256 }, false, usages);
  }
  async function seal(key, data, aad) {
    const iv = rnd(12);
    return { iv, ct: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, data)) };
  }
  async function unseal(key, box, aad) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv, additionalData: te.encode(aad) }, key, box.ct));
  }
  const importDk = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  // device secret
  const newDevKey = () => crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  async function devKey() { const r = await get('dev', 'k'); return r || null; }
  async function devPart(label, key) {
    const k = key || await devKey(); if (!k) throw err('NO_DEVICE_SECRET');
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode('docsnap/' + label + '/v1')));
  }
  // KEKs
  async function pinKek(pin, salt, k, dev) { const a = await argon(te.encode(pin), salt, k, 'pin'); const d = await devPart('pin', dev); const kk = await hkdf(cat(a, d), 'docsnap pin kek v1'); wipe(a); wipe(d); return kk; }
  async function prfKek(prf, dev) { const d = await devPart('prf', dev); const kk = await hkdf(cat(prf, d), 'docsnap prf kek v1'); wipe(d); return kk; }
  async function recKek(code, salt, k) { const a = await argon(te.encode(normCode(code)), salt, k, 'recovery'); const kk = await hkdf(a, 'docsnap recovery kek v1'); wipe(a); return kk; }
  async function canaryKey(dev) { const d = await devPart('canary', dev); const kk = await hkdf(d, 'docsnap canary v1'); wipe(d); return kk; }
  const CANARY = 'docsnap-canary-v1';

  // ---------- recovery code: 28 Crockford base32 chars (7 × 4) = 140 bits ----------
  function genCode() { const r = rnd(28); let s = ''; for (const b of r) s += CROCK[b & 31]; wipe(r); return s; } // 256 % 32 === 0 → unbiased
  function normCode(s) { return String(s || '').toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1'); }
  const validCode = (s) => { const n = normCode(s); return n.length === 28 && [...n].every((c) => CROCK.includes(c)); };
  const fmtCode = (s) => normCode(s).match(/.{1,4}/g).join('-');

  // ---------- backup password strength (S5: min 12, live meter) ----------
  const COMMON = ['password', 'passw0rd', 'qwerty', 'docsnap', 'aadhaar', 'india', 'letmein', 'welcome', 'admin', 'iloveyou', 'abc123', '123456', 'asdf', 'zxcv'];
  function strength(pw) {
    pw = String(pw || ''); const L = pw.length, lo = pw.toLowerCase();
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    const uniq = new Set(pw).size;
    let seq = 0; for (let i = 2; i < L; i++) { const a = pw.charCodeAt(i - 2), b = pw.charCodeAt(i - 1), c = pw.charCodeAt(i); if ((b - a === 1 && c - b === 1) || (a - b === 1 && b - c === 1) || (a === b && b === c)) seq++; }
    const common = COMMON.some((w) => lo.includes(w));
    let score = 0;
    if (L >= 8) score = 1;
    if (L >= 12 && uniq >= 6) score = 2;
    if (L >= 12 && uniq >= 8 && classes >= 2) score = 3;
    if ((L >= 14 && uniq >= 9 && classes >= 3) || (L >= 20 && uniq >= 10)) score = 4;
    if (common || seq > L / 3) score = Math.min(score, 1);
    const label = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][score];
    return { score, label, length: L, ok: L >= 12 && score >= 3, reason: L < 12 ? 'short' : score < 3 ? 'weak' : '' };
  }

  // ---------- session ----------
  let S = null; // { dkRaw, dk, index, recovering }
  const isUnlocked = () => !!(S && S.dk && !S.recovering);
  // C mirrors the stored config so Face ID can start inside the tap's user gesture (no await before credentials.get on iOS)
  let C = null;
  async function cfg() { C = (await get('cfg', 'cfg')) || null; return C ? structuredClone(C) : null; }
  async function putCfg(c) { await write([['cfg', 'put', 'cfg', c]]); }
  /** 'none' (no vault) | 'newdevice' (device secret missing or canary fails) | 'locked' | 'unlocked' */
  async function state() {
    const c = await cfg(); if (!c) return 'none';
    if (isUnlocked()) return 'unlocked';
    try { const ck = await canaryKey(); const v = td.decode(await unseal(ck, c.canary, 'canary')); if (v !== CANARY) return 'newdevice'; } catch (e) { return 'newdevice'; }
    return 'locked';
  }
  async function encRec(id, bytes, key = S.dk) { return seal(key, bytes, 'rec:' + id); }
  async function decRec(id, box, key = S.dk) { return unseal(key, box, 'rec:' + id); }
  const newId = () => { const r = rnd(12); return [...r].map((b) => b.toString(16).padStart(2, '0')).join(''); };
  function emptyIndex() { return { v: 1, members: [{ id: newId(), name: 'Aap', rel: 'Self', color: 0 }], docs: [], backup: { last: 0, snooze: 0 }, created: Date.now() }; }

  async function begin(dkRaw, index) { S = { dkRaw, dk: await importDk(dkRaw), index }; }
  async function loadIndex() { const box = await get('rec', 'index'); S.index = box ? JSON.parse(td.decode(await decRec('index', box))) : emptyIndex(); return S.index; }

  /** First-time setup. Returns the recovery code (show once, never stored). */
  async function setup(pin, opts = {}) {
    if (!/^\d{6}$/.test(pin)) throw err('PIN_FORMAT');
    const dev = await newDevKey(), dkRaw = rnd(32), code = genCode();
    const ps = rnd(16), rs = rnd(16);
    const pinW = await seal(await pinKek(pin, ps, KDF, dev), dkRaw, 'wrap:pin');
    const recW = await seal(await recKek(code, rs, KDF), dkRaw, 'wrap:rec');
    const can = await seal(await canaryKey(dev), te.encode(CANARY), 'canary');
    const index = opts.index || emptyIndex();
    const dk = await importDk(dkRaw);
    const ops = [['cfg', 'clear'], ['dev', 'clear'], ['rec', 'clear'], ['dev', 'put', 'k', dev]];
    // records from a backup restored on a fresh phone get sealed under the new DK in the same transaction
    for (const [id, bytes] of (opts.blobs || new Map())) ops.push(['rec', 'put', id, await encRec(id, bytes, dk)]);
    ops.push(['rec', 'put', 'index', await encRec('index', te.encode(JSON.stringify(index)), dk)]);
    ops.push(['cfg', 'put', 'cfg', { v: 1, created: Date.now(), pin: { salt: ps, kdf: KDF, ...pinW }, rec: { salt: rs, kdf: KDF, ...recW }, canary: can, prf: null, lock: { fails: 0, until: 0 }, grace: 0 }]);
    await write(ops);
    await begin(dkRaw, index);
    return code;
  }

  // ---------- unlock paths ----------
  async function lockInfo() { const c = await cfg(); const l = (c && c.lock) || { fails: 0, until: 0 }; return { fails: l.fails, until: l.until, left: Math.max(0, PIN_TRIES - l.fails), lockedFor: Math.max(0, l.until - Date.now()) }; }
  async function unlockPin(pin) {
    const c = await cfg(); if (!c) throw err('NO_VAULT');
    const l = c.lock || { fails: 0, until: 0 };
    if (l.until > Date.now()) return { ok: false, err: 'locked', until: l.until, fails: l.fails };
    let dkRaw = null;
    try { dkRaw = await unseal(await pinKek(String(pin), c.pin.salt, c.pin.kdf), c.pin, 'wrap:pin'); }
    catch (e) { if (e.code === 'NO_DEVICE_SECRET') return { ok: false, err: 'newdevice' }; }
    const c2 = await cfg(); // re-read: the lock state may have moved while Argon2 ran
    if (!dkRaw) {
      const fails = (c2.lock.fails || 0) + 1; let until = 0;
      if (fails >= PIN_TRIES) until = Date.now() + LOCK_STEPS[Math.min(fails - PIN_TRIES, LOCK_STEPS.length - 1)];
      c2.lock = { fails, until }; await putCfg(c2);
      return { ok: false, err: until ? 'locked' : 'wrong', until, fails, left: Math.max(0, PIN_TRIES - fails) };
    }
    c2.lock = { fails: 0, until: 0 }; await putCfg(c2);
    await begin(dkRaw, null); await loadIndex(); return { ok: true };
  }
  // WebAuthn PRF (Face ID / Touch ID passkey)
  const prfSupported = () => !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext && !/^\d+\.\d+\.\d+\.\d+$/.test(location.hostname));
  async function prfEval(credId, salt) {
    const a = await navigator.credentials.get({ publicKey: { challenge: rnd(32), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: credId }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
    const r = a.getClientExtensionResults(); const out = r && r.prf && r.prf.results && r.prf.results.first;
    if (!out) throw err('PRF_UNSUPPORTED', 'Face ID can’t protect keys on this device');
    return new Uint8Array(out);
  }
  async function enablePrf() {
    if (!isUnlocked()) throw err('LOCKED');
    if (!prfSupported()) throw err('PRF_UNSUPPORTED', 'Face ID isn’t available here');
    const salt = rnd(32);
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'DocSnap', id: location.hostname }, user: { id: rnd(16), name: 'DocSnap My Docs', displayName: 'My Docs' }, challenge: rnd(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' }, timeout: 60000,
      extensions: { prf: { eval: { first: salt } } } } });
    const ext = cred.getClientExtensionResults() || {};
    if (!ext.prf || ext.prf.enabled === false) throw err('PRF_UNSUPPORTED', 'Face ID can’t protect keys on this device');
    const credId = new Uint8Array(cred.rawId);
    let out = ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : await prfEval(credId, salt);
    const w = await seal(await prfKek(out), S.dkRaw, 'wrap:prf'); wipe(out);
    const c = await cfg(); c.prf = { credId, salt, ...w }; await putCfg(c); return true;
  }
  async function disablePrf() { const c = await cfg(); c.prf = null; await putCfg(c); }
  async function hasPrf() { const c = await cfg(); return !!(c && c.prf); }
  async function unlockPrf() {
    const c = C && C.prf ? C : await cfg(); if (!c || !c.prf) return { ok: false, err: 'off' };
    let out;
    try { out = await prfEval(c.prf.credId, c.prf.salt); } catch (e) { return { ok: false, err: e.name === 'NotAllowedError' ? 'cancel' : 'error', msg: e.message }; }
    try { const dkRaw = await unseal(await prfKek(out), c.prf, 'wrap:prf'); wipe(out); const c2 = await cfg(); c2.lock = { fails: 0, until: 0 }; await putCfg(c2); await begin(dkRaw, null); await loadIndex(); return { ok: true }; }
    catch (e) { wipe(out); return { ok: false, err: e.code === 'NO_DEVICE_SECRET' ? 'newdevice' : 'nomatch' }; }
  }
  /** Recovery code: opens DK without the device secret. The vault stays in "recovering" state (not usable) until finishRecovery(newPin). */
  async function unlockRecovery(code) {
    if (!validCode(code)) return { ok: false, err: 'format' };
    const c = await cfg(); if (!c) throw err('NO_VAULT');
    try { const dkRaw = await unseal(await recKek(code, c.rec.salt, c.rec.kdf), c.rec, 'wrap:rec'); S = { dkRaw, dk: await importDk(dkRaw), index: null, recovering: true }; return { ok: true }; }
    catch (e) { return { ok: false, err: 'wrong' }; }
  }
  /** Mandatory after a recovery-code unlock: new PIN, new device secret, new DK (re-encrypt everything), new recovery code.
      All of it lands in one IndexedDB transaction, so the old code stops working the moment this resolves. Returns the new code. */
  async function finishRecovery(newPin) {
    if (!S || !S.recovering) throw err('NOT_RECOVERING');
    if (!/^\d{6}$/.test(newPin)) throw err('PIN_FORMAT');
    const oldDk = S.dk, ids = await keys('rec');
    const plain = new Map(); for (const id of ids) plain.set(id, await decRec(id, await get('rec', id), oldDk));
    const dev = await newDevKey(), dkRaw = rnd(32), dk = await importDk(dkRaw), code = genCode(), ps = rnd(16), rs = rnd(16);
    const pinW = await seal(await pinKek(newPin, ps, KDF, dev), dkRaw, 'wrap:pin');
    const recW = await seal(await recKek(code, rs, KDF), dkRaw, 'wrap:rec');
    const can = await seal(await canaryKey(dev), te.encode(CANARY), 'canary');
    const c = await cfg();
    const ops = [['dev', 'put', 'k', dev], ['rec', 'clear']];
    for (const [id, bytes] of plain) { ops.push(['rec', 'put', id, await encRec(id, bytes, dk)]); wipe(bytes); }
    Object.assign(c, { pin: { salt: ps, kdf: KDF, ...pinW }, rec: { salt: rs, kdf: KDF, ...recW }, canary: can, prf: null, lock: { fails: 0, until: 0 }, rotated: Date.now() });
    ops.push(['cfg', 'put', 'cfg', c]);
    await write(ops);
    wipe(S.dkRaw); await begin(dkRaw, null); await loadIndex();
    return code;
  }
  async function changePin(newPin) {
    if (!isUnlocked()) throw err('LOCKED'); if (!/^\d{6}$/.test(newPin)) throw err('PIN_FORMAT');
    const c = await cfg(), ps = rnd(16); c.pin = { salt: ps, kdf: KDF, ...await seal(await pinKek(newPin, ps, KDF), S.dkRaw, 'wrap:pin') }; await putCfg(c);
  }
  function lock() { if (S) { wipe(S.dkRaw); S = null; } }

  // ---------- records ----------
  async function saveIndex() { if (!isUnlocked()) throw err('LOCKED'); await write([['rec', 'put', 'index', await encRec('index', te.encode(JSON.stringify(S.index)))]]); }
  async function putBlob(bytes, id = newId()) { if (!isUnlocked()) throw err('LOCKED'); await write([['rec', 'put', id, await encRec(id, bytes)]]); return id; }
  async function getBlob(id, type = 'image/jpeg') { if (!isUnlocked()) throw err('LOCKED'); const box = await get('rec', id); if (!box) return null; return new Blob([await decRec(id, box)], { type }); }
  async function delBlobs(ids) { if (ids.length) await write(ids.map((id) => ['rec', 'delete', id])); }
  /** Save several blobs + the index in one transaction (no half-saved document). */
  async function commit(blobs = [], dels = []) {
    if (!isUnlocked()) throw err('LOCKED');
    const ops = [];
    for (const [id, bytes] of blobs) ops.push(['rec', 'put', id, await encRec(id, bytes)]);
    for (const id of dels) ops.push(['rec', 'delete', id]);
    ops.push(['rec', 'put', 'index', await encRec('index', te.encode(JSON.stringify(S.index)))]);
    await write(ops);
  }

  // ---------- backup file ----------
  const MAGIC = te.encode('DSVAULT1');
  async function exportBackup(password) {
    if (!isUnlocked()) throw err('LOCKED'); if (!strength(password).ok) throw err('WEAK_PASSWORD');
    const ids = (await keys('rec')).filter((id) => id !== 'index'), parts = [], list = []; let off = 0;
    for (const id of ids) { const b = await decRec(id, await get('rec', id)); list.push({ id, off, len: b.length }); parts.push(b); off += b.length; }
    const idx = { ...S.index, backup: { ...S.index.backup } };
    const man = te.encode(JSON.stringify({ index: idx, blobs: list }));
    const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, man.length);
    const plain = cat(len, man, ...parts); parts.forEach(wipe);
    const salt = rnd(16), kdf = { alg: 'argon2id', ...KDF };
    const key = await hkdf(await argon(te.encode(password), salt, KDF, 'backup'), 'docsnap backup v1');
    const iv = rnd(12);
    const head = te.encode(JSON.stringify({ v: 1, app: 'DocSnap', kdf, salt: b64(salt), iv: b64(iv) }));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: head }, key, plain)); wipe(plain);
    const hl = new Uint8Array(4); new DataView(hl.buffer).setUint32(0, head.length);
    return new Blob([MAGIC, hl, head, ct], { type: 'application/octet-stream' });
  }
  /** Decrypt a backup into memory. Returns { index, blobs: Map(id → bytes) } or throws {code:'BAD_FILE'|'WRONG_PASSWORD'}. */
  async function readBackup(file, password) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.length < 16 || td.decode(buf.subarray(0, 8)) !== 'DSVAULT1') throw err('BAD_FILE', 'Ye DocSnap backup file nahi hai');
    const hl = new DataView(buf.buffer, buf.byteOffset + 8, 4).getUint32(0), head = buf.subarray(12, 12 + hl);
    let h; try { h = JSON.parse(td.decode(head)); } catch (e) { throw err('BAD_FILE', 'Ye DocSnap backup file nahi hai'); }
    const k = { m: h.kdf.m, t: h.kdf.t, p: h.kdf.p };
    if (h.kdf.alg !== 'argon2id' || k.m < 65536 || k.m > 1048576 || k.t < 1 || k.t > 10) throw err('BAD_FILE', 'Unsupported backup');
    const key = await hkdf(await argon(te.encode(password), unb64(h.salt), k, 'backup'), 'docsnap backup v1');
    let plain; try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(h.iv), additionalData: head }, key, buf.subarray(12 + hl))); }
    catch (e) { throw err('WRONG_PASSWORD', 'Password sahi nahi hai'); }
    const ml = new DataView(plain.buffer, 0, 4).getUint32(0), man = JSON.parse(td.decode(plain.subarray(4, 4 + ml))), base = 4 + ml;
    const blobs = new Map(); for (const b of man.blobs) blobs.set(b.id, plain.slice(base + b.off, base + b.off + b.len));
    wipe(plain); return { index: man.index, blobs };
  }
  /** Bring a decrypted backup into the open vault. mode: 'merge' | 'replace'. */
  async function restore(data, mode = 'merge') {
    if (!isUnlocked()) throw err('LOCKED');
    const ops = []; let dels = [];
    if (mode === 'replace') { dels = (await keys('rec')).filter((id) => id !== 'index'); S.index = { ...data.index, backup: S.index.backup }; }
    else {
      const have = new Set(S.index.docs.map((d) => d.id));
      for (const m of data.index.members) if (!S.index.members.some((x) => x.id === m.id || (x.name === m.name && x.rel === m.rel))) S.index.members.push(m);
      const memMap = new Map(data.index.members.map((m) => [m.id, (S.index.members.find((x) => x.id === m.id) || S.index.members.find((x) => x.name === m.name && x.rel === m.rel)).id]));
      for (const d of data.index.docs) if (!have.has(d.id)) S.index.docs.push({ ...d, member: memMap.get(d.member) || d.member });
    }
    for (const [id, bytes] of data.blobs) ops.push([id, bytes]);
    await commit(ops, dels.filter((id) => !data.blobs.has(id)));
    return S.index;
  }
  async function markBackup() { S.index.backup = { ...(S.index.backup || {}), last: Date.now(), snooze: 0 }; await saveIndex(); }
  async function setGrace(ms) { const c = await cfg(); c.grace = ms; await putCfg(c); }
  async function getGrace() { const c = await cfg(); return (c && c.grace) || 0; }
  /** Debug/test only: drop the device secret, as on a phone restored from an iCloud backup that didn't carry it. */
  async function _forgetDevice() { await write([['dev', 'clear']]); lock(); }
  async function _raw() { const out = {}; for (const s of ['cfg', 'dev', 'rec']) { out[s] = {}; for (const k of await keys(s)) out[s][k] = await get(s, k); } return out; }
  async function destroy() { lock(); await write([['cfg', 'clear'], ['dev', 'clear'], ['rec', 'clear']]); }

  return { KDF, stats, state, setup, unlockPin, unlockPrf, unlockRecovery, finishRecovery, changePin, enablePrf, disablePrf, hasPrf, prfSupported, lock, lockInfo,
    isUnlocked, recovering: () => !!(S && S.recovering), index: () => S && S.index, saveIndex, putBlob, getBlob, delBlobs, commit, newId,
    exportBackup, readBackup, restore, markBackup, setGrace, getGrace, genCode, normCode, validCode, fmtCode, strength, argon, ensureArgon, destroy, _forgetDevice, _raw, CROCK };
})();
