// Uji versi data backend (v1.9.5): memuat kode ASLI dari Code.gs (blok versi + api()) ke sandbox dengan Cache/Properties tiruan.
// Jalankan: node tests/be_ver.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(process.env.GS_SRC || path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('penanda tidak ditemukan: ' + a); return src.slice(i, j); };
const verCode = cut('const newVer_ =', 'function stockGet_()'), apiCode = cut('function api(req) {', 'function route_(r, s) {');

let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('GAGAL: ' + m); } };
function mk() {
  const store = new Map(), props = {}, calls = {cacheGetAll: 0, propGet: 0, propSet: 0, cachePutAll: 0};
  const sb = {console, Date, Math, JSON, Object, String, Number, undefined};
  sb.CacheService = {getScriptCache: () => ({
    getAll: ks => { calls.cacheGetAll++; const o = {}; ks.forEach(k => { if (store.has(k)) o[k] = store.get(k); }); return o; },
    putAll: o => { calls.cachePutAll++; Object.keys(o).forEach(k => store.set(k, o[k])); }, put: (k, v) => store.set(k, v), get: k => store.get(k), remove: k => store.delete(k)})};
  sb.PropertiesService = {getScriptProperties: () => ({getProperty: k => { calls.propGet++; return k in props ? props[k] : null; }, setProperty: (k, v) => { calls.propSet++; props[k] = v; }})};
  vm.createContext(sb);
  // Date.now() unik agar versi baru selalu berbeda walau dibuat di milidetik yang sama
  let t = 1000000; sb.Date = Object.assign(function () { return new Date(...arguments); }, Date, {now: () => ++t});
  vm.runInContext(verCode + '\n' + apiCode + '\nthis.__x = {vers_, bump_, readVers_, api, newVer_, getV: () => VERS_};', sb);
  sb.schemaCheck_ = () => {}; sb.auth_ = () => ({uid: 'u'}); sb.normNums_ = o => o; sb.isTransient_ = () => false;
  sb.route_ = (r) => (sb.__route || (() => null))(r);
  return {sb, x: sb.__x, store, props, calls};
}
const ver = r => r.cat_ver + '~' + r.stock_ver;

// 1. Awal: cat_ver dibuat dan disimpan permanen; pembacaan ulang konsisten
{ const m = mk(); const a = m.sb.api({action: 'ping'}); ok(a.ok && a.cat_ver && a.stock_ver, 'ping memberi versi');
  ok(m.props.cat_ver === a.cat_ver, 'cat_ver awal disimpan permanen'); const b = m.sb.api({action: 'ping'}); ok(ver(a) === ver(b), 'ping berturut-turut: versi sama');
  ok(b.ver_prev === b.ver && b.cat_prev === b.cat_ver && b.stock_prev === b.stock_ver, 'ping: ver_prev = ver (tidak ada perubahan)'); }

// 2. Cache terbuang (kedaluwarsa 6 jam / evict): cat_ver TETAP (tak ada muat ulang katalog), stock_ver baru (hanya peta stok)
{ const m = mk(); const a = m.sb.api({action: 'ping'}); m.store.clear(); const b = m.sb.api({action: 'ping'});
  ok(b.cat_ver === a.cat_ver, 'cache hilang: cat_ver dipulihkan dari penyimpanan permanen');
  ok(b.stock_ver !== a.stock_ver, 'cache hilang: stock_ver dibuat baru (arah aman)');
  const c = m.sb.api({action: 'ping'}); ok(c.cat_ver === b.cat_ver && c.stock_ver === b.stock_ver, 'setelah pulih: stabil'); }

// 3. Penjualan (bump stok): hanya stock_ver naik; tak menulis Properties
{ const m = mk(); const a = m.sb.api({action: 'ping'}); const w0 = m.calls.propSet;
  m.sb.__route = () => { m.x.bump_('stok'); return {ok: 1}; }; const r = m.sb.api({action: 'sale.create'});
  ok(r.cat_ver === a.cat_ver, 'bump stok: cat_ver tidak berubah'); ok(r.stock_ver !== a.stock_ver, 'bump stok: stock_ver naik');
  ok(r.cat_prev === a.cat_ver && r.stock_prev === a.stock_ver && r.ver_prev === ver(a), 'bump stok: *_prev = versi sebelum perubahan');
  ok(m.calls.propSet === w0, 'bump stok: tidak menulis Properties (kunci penjualan tetap singkat)'); }

// 4. Ubah katalog (bump penuh): keduanya naik; cat_ver disimpan permanen
{ const m = mk(); const a = m.sb.api({action: 'ping'}); m.sb.__route = () => { m.x.bump_(); return 1; }; const r = m.sb.api({action: 'master.save'});
  ok(r.cat_ver !== a.cat_ver && r.stock_ver !== a.stock_ver, 'bump penuh: dua versi naik'); ok(m.props.cat_ver === r.cat_ver, 'bump penuh: cat_ver tersimpan permanen');
  m.sb.__route = null; m.store.clear(); const p = m.sb.api({action: 'ping'}); ok(p.cat_ver === r.cat_ver, 'bump penuh lalu cache hilang: cat_ver tetap yang terbaru'); }

// 5. Perangkat lain menyela SEBELUM bump pertama (menunggu kunci): ver_prev harus versi tepat sebelum bump, bukan versi saat permintaan dimulai
{ const m = mk(); const a = m.sb.api({action: 'ping'});
  m.sb.__route = () => { const other = m.x.newVer_(); m.store.set('stock_ver', other); /* perangkat B menjual saat kita menunggu kunci */ m.x.bump_('stok'); return 1; };
  const r = m.sb.api({action: 'sale.create'});
  ok(r.stock_prev !== a.stock_ver, 'sela sebelum bump: stock_prev BUKAN versi awal permintaan (klien tidak keliru menganggap sudah mutakhir)');
  ok(r.stock_ver !== a.stock_ver, 'sela sebelum bump: versi tetap naik'); }

// 6. Dua bump dalam satu permintaan tanpa sela: prev = versi sebelum bump pertama; dengan sela: prev dikosongkan
{ const m = mk(); const a = m.sb.api({action: 'ping'}); m.sb.__route = () => { m.x.bump_('stok'); m.x.bump_('stok'); return 1; };
  const r = m.sb.api({action: 'sale.batch'}); ok(r.stock_prev === a.stock_ver && r.stock_ver !== a.stock_ver, 'dua bump bersih: prev = sebelum bump pertama');
  const m2 = mk(); const a2 = m2.sb.api({action: 'ping'}); m2.sb.__route = () => { m2.x.bump_('stok'); m2.store.set('stock_ver', m2.x.newVer_()); m2.x.bump_('stok'); return 1; };
  const r2 = m2.sb.api({action: 'sale.batch'}); ok(r2.stock_prev === undefined && r2.ver_prev === undefined, 'perangkat lain menyela di antara dua bump: *_prev tidak dikirim (klien memuat ulang)'); }

// 7. Efisiensi: satu pembacaan versi dari cache per permintaan ping (dulu dua), tanpa menyentuh Properties saat cache hangat
{ const m = mk(); m.sb.api({action: 'ping'}); const g0 = m.calls.cacheGetAll, p0 = m.calls.propGet; m.sb.api({action: 'ping'});
  ok(m.calls.cacheGetAll - g0 === 1, 'ping: tepat 1 pembacaan versi dari cache (terukur ' + (m.calls.cacheGetAll - g0) + ')'); ok(m.calls.propGet === p0, 'ping: tidak membaca Properties saat cache hangat'); }

// 8. Versi satu permintaan tidak bocor ke permintaan berikutnya
{ const m = mk(); m.sb.__route = () => { m.x.bump_('stok'); return 1; }; const r1 = m.sb.api({action: 'sale.create'}); m.sb.__route = () => null; const r2 = m.sb.api({action: 'ping'});
  ok(r2.stock_ver === r1.stock_ver && r2.stock_prev === r2.stock_ver, 'permintaan berikutnya: tidak membawa status bump permintaan sebelumnya'); }

console.log(fail ? `\n${fail} GAGAL, ${pass} lulus` : `Semua lulus (${pass} pemeriksaan)`); process.exit(fail ? 1 : 0);
