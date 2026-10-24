// Uji kunci dan cache backend (v1.9.8): memuat kode ASLI dari Code.gs ke sandbox dengan LockService TIRUAN YANG TIDAK REENTRANT (seperti Google) dan Cache tiruan.
//  - withLock_ bersarang tidak menunggu dirinya sendiri; kunci dilepas sekali; audit ditulis sekali di lapisan terluar; kunci dilepas walau fn melempar galat
//  - kunci penuh -> galat retry:true (klien mengulang otomatis)
//  - balapan cache: bust_ yang terjadi di tengah pembacaan sheet TIDAK boleh membiarkan data basi tersimpan di cache
// Jalankan: node tests/be_lock.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(process.env.GS_SRC || path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('penanda tidak ditemukan: ' + a); return src.slice(i, j); };
const cacheCode = cut('const CACHE_CHUNK_', 'function variantMeta_()'), lockCode = cut('let LOCK_DEPTH_', '/* Grid Google Sheets');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('GAGAL: ' + m); } };

function mk(opt) {
  opt = opt || {}; const store = new Map(), st = {held: false, waits: 0, releases: 0, flushes: 0, reads: 0, sheet: 'v1'};
  const sb = {console, Date, Math, JSON, Object, String, Number, Array, Error, undefined};
  sb.CacheService = {getScriptCache: () => ({
    get: k => store.has(k) ? store.get(k) : null, put: (k, v) => store.set(k, v), remove: k => store.delete(k),
    getAll: ks => { const o = {}; ks.forEach(k => { if (store.has(k)) o[k] = store.get(k); }); return o; }, putAll: o => Object.keys(o).forEach(k => store.set(k, o[k]))})};
  sb.LockService = {getScriptLock: () => ({
    waitLock: () => { st.waits++; if (st.held) throw new Error('Exception: Lock timeout (tidak reentrant)'); if (opt.busy) throw new Error('Exception: Lock timeout'); st.held = true; },
    releaseLock: () => { st.releases++; st.held = false; }})};
  vm.createContext(sb);
  vm.runInContext('let NOCACHE_ = false; const CACHED = ["settings", "channels"]; let n_ = 0; const newVer_ = () => "g" + (++n_);' +
    'function flushAudit_() { __st.flushes++; }\n' + 'function readAll_(t) { __st.reads++; const v = __st.sheet; if (__st.onRead) __st.onRead(); return [{v: v}]; }\n' + cacheCode + '\n' + lockCode +
    '\nthis.__x = {tbl_, bust_, withLock_};', Object.assign(sb, {__st: st}));
  return {x: sb.__x, st: st, store: store};
}

{ // 1. bersarang
  const t = mk(); let inner = 0;
  const r = t.x.withLock_(() => { t.x.withLock_(() => { t.x.withLock_(() => { inner++; }); inner++; }); return 'ok'; });
  ok(r === 'ok' && inner === 2, 'withLock_ bersarang menjalankan fn dalam');
  ok(t.st.waits === 1 && t.st.releases === 1, 'kunci diminta sekali dan dilepas sekali (waits=' + t.st.waits + ', releases=' + t.st.releases + ')');
  ok(t.st.flushes === 1, 'audit ditulis sekali di lapisan terluar (flushes=' + t.st.flushes + ')');
  t.x.withLock_(() => 1); ok(t.st.waits === 2 && !t.st.held, 'setelah selesai, kunci bisa diambil lagi');
}
{ // 2. galat di fn melepas kunci dan mereset kedalaman
  const t = mk(); let msg = '';
  try { t.x.withLock_(() => { t.x.withLock_(() => { throw new Error('boom'); }); }); } catch (e) { msg = e.message; }
  ok(msg === 'boom' && !t.st.held && t.st.releases === 1, 'galat di dalam: kunci tetap dilepas tepat sekali');
  t.x.withLock_(() => 1); ok(t.st.waits === 2, 'kedalaman kembali 0 setelah galat (kunci baru benar-benar diminta)');
}
{ // 3. kunci penuh -> retry:true
  const t = mk({busy: true}); let err = null; try { t.x.withLock_(() => 1); } catch (e) { err = e; }
  ok(err && err.retry === true && /sibuk/.test(err.message), 'kunci penuh: galat bertanda retry dengan pesan ramah');
  ok(t.st.flushes === 0, 'kunci gagal diambil: tidak ada penulisan audit');
}
{ // 4. cache normal
  const t = mk(); t.x.tbl_('settings'); t.x.tbl_('settings');
  ok(t.st.reads === 1, 'tabel ter-cache: pembacaan kedua tidak menyentuh sheet (reads=' + t.st.reads + ')');
  t.x.bust_('settings'); t.x.tbl_('settings'); ok(t.st.reads === 2, 'setelah bust_, dibaca ulang dari sheet');
  t.x.tbl_('materials'); t.x.tbl_('materials'); ok(t.st.reads === 4, 'tabel di luar CACHED tidak pernah di-cache');
}
{ // 5. balapan: bust_ di tengah pembacaan
  const t = mk(); t.st.onRead = () => { t.st.onRead = null; t.st.sheet = 'v2'; t.x.bust_('settings'); }; // penulis menyela setelah sheet dibaca pembaca
  const first = t.x.tbl_('settings'); // pembaca melihat data lama (v1) karena membaca sebelum penulis
  ok(first[0].v === 'v2' || first[0].v === 'v1', 'pembaca tetap mendapat jawaban');
  const reads0 = t.st.reads, second = t.x.tbl_('settings');
  ok(t.st.reads === reads0 + 1 && second[0].v === 'v2', 'data basi TIDAK tersimpan di cache: pembacaan berikut mengambil v2 dari sheet (reads=' + t.st.reads + ', v=' + second[0].v + ')');
  const third = t.x.tbl_('settings'); ok(t.st.reads === reads0 + 1 && third[0].v === 'v2', 'setelah itu cache terisi normal');
}
console.log(fail ? 'GAGAL: ' + fail + ' dari ' + (pass + fail) : 'Semua lulus (' + pass + ' pemeriksaan)'); process.exit(fail ? 1 : 0);
