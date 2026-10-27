// Uji backend v1.9.9: sales.list dengan paginasi server. Memuat salesList_ ASLI dari Code.gs ke sandbox dengan rowsByDate_ tiruan.
// Jalankan: node tests/be_sales.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(process.env.GS_SRC || path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const i = src.indexOf('function salesList_('), j = src.indexOf('/* ===== Inventory', i); if (i < 0 || j < 0) throw new Error('salesList_ tidak ditemukan');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('GAGAL: ' + m); } };
const rows = []; for (let n = 1; n <= 230; n++) rows.push({id: 's' + n, nomor: 'N' + n, total: 1000, status: n % 50 === 0 ? 'batal' : 'selesai', kasir_id: n % 2 ? 'k1' : 'k2', ref_sale_id: n % 10 === 0 && n % 50 ? 'x' : ''});
const sb = {Utilities: {formatDate: () => '2026-10-27'}, TZ: 'Asia/Jakarta', Math, Number, Array, rowsByDate_: () => rows.slice()}; vm.createContext(sb);
vm.runInContext(src.slice(i, j) + '\nthis.f = salesList_;', sb); const f = sb.f, own = {role: 'owner', uid: 'o'}, kas = {role: 'kasir', uid: 'k1'};
const all = f({tanggal: '2026-10-27'}, own); ok(Array.isArray(all) && all.length === 230 && all[0].id === 's230', 'tanpa limit: larik penuh, terbaru dulu (kompatibel klien lama)');
const pg = f({limit: 50}, own); ok(!Array.isArray(pg) && pg.rows.length === 50 && pg.total === 230 && pg.offset === 0 && pg.rows[0].id === 's230', 'halaman pertama 50 baris, total 230');
const done = rows.filter(r => r.status === 'selesai'); ok(pg.summary.nDone === done.length && pg.summary.omzet === done.length * 1000 && pg.summary.nTrx === done.filter(r => !r.ref_sale_id).length, 'ringkasan atas SEMUA baris, retur tidak dihitung transaksi');
const ids = new Set(); for (let o = 0; o < 230; o += 50) f({limit: 50, offset: o}, own).rows.forEach(r => ids.add(r.id)); ok(ids.size === 230, 'seluruh halaman bersambung tanpa ganda atau hilang');
ok(f({limit: 50, offset: 200}, own).rows.length === 30, 'halaman terakhir 30 baris'); ok(f({limit: 50, offset: 999}, own).rows.length === 0, 'offset melewati akhir: kosong');
ok(f({limit: 9999}, own).rows.length === 230 && f({limit: 600}, own).rows.length === 230, 'limit dibatasi 500 tanpa galat'); ok(f({limit: 'abc'}, own).length === 230 && f({limit: -5}, own).length === 230, 'limit tidak valid: larik penuh');
const k = f({limit: 50}, kas); ok(k.total === 115 && k.rows.every(r => r.kasir_id === 'k1'), 'kasir hanya melihat transaksinya sendiri (total 115)'); ok(k.summary.nDone <= 115, 'ringkasan kasir juga hanya miliknya');
console.log(fail ? fail + ' GAGAL, ' + pass + ' lulus' : 'Semua lulus (' + pass + ' pemeriksaan)'); process.exit(fail ? 1 : 0);
