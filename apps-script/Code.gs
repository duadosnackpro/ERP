/** Duado Snack API v1.9.8 (Google Apps Script). Dipanggil dari frontend GitHub Pages lewat satu endpoint POST JSON.
 *  Langkah awal: jalankan setup() sekali, lalu Deploy > Web app (Execute as: Me, Access: Anyone). */
const TZ = 'Asia/Jakarta';
const SCHEMA = {
  users: ['id','nama','username','salt','hash_pin','role','aktif','created_at','updated_at'],
  settings: ['key','value'],
  channels: ['id','nama','fee_persen','fee_tetap','aktif','created_at','updated_at','basis_fee'],
  materials: ['id','nama','tipe','satuan','stok','hpp_rata2','stok_minimum','aktif','created_at','updated_at','satuan_kecil','faktor_kecil'],
  suppliers: ['id','nama','kontak','catatan','aktif','created_at','updated_at'],
  purchases: ['id','tanggal','supplier_id','total','ongkir','catatan','user_id','created_at','updated_at','tgl'],
  purchase_items: ['id','purchase_id','material_id','qty','harga_satuan'],
  products: ['id','nama','kategori','aktif','created_at','updated_at','foto_url'],
  product_variants: ['id','product_id','sku','ukuran','level_pedas','stok','hpp_rata2','aktif','created_at','updated_at'],
  channel_prices: ['id','variant_id','channel_id','harga_jual','updated_at'],
  recipes: ['id','variant_id','nama','hasil_standar','jenis','aktif','created_at','updated_at','tenaga_kerja'],
  recipe_items: ['id','recipe_id','material_id','qty'],
  production_orders: ['id','tanggal','jenis','recipe_id','variant_id','qty_hasil','status','ref_sale_id','user_id','created_at','updated_at','jumlah_batch','qty_standar','catatan','tgl'],
  production_costs: ['id','production_id','bahan','kemasan','tenaga_kerja','overhead','total','hpp_per_unit'],
  sales: ['id','nomor','request_id','tanggal','channel_id','kasir_id','subtotal','diskon','fee_channel','ppn_persen','ppn_nominal','total','metode_bayar','status','catatan','created_at','updated_at','sync_at','total_klien','ref_sale_id','closing_id','tgl'],
  sale_items: ['id','sale_id','variant_id','qty','harga','hpp_snapshot'],
  stock_movements: ['id','tanggal','tipe','item_tipe','item_id','qty','nilai','ref_id','user_id'],
  expenses: ['id','tanggal','kategori','nominal','catatan','user_id','created_at','tgl'],
  audit_log: ['id','waktu','user_id','aksi','entitas','sebelum','sesudah','tgl'],
  cash_closings: ['id','kasir_id','dari','sampai','jumlah_trx','total_tunai','total_transfer','total_qris','total_lain','total_semua','uang_fisik','selisih_tunai','catatan','created_at','modal_awal','kas_keluar','tunai_diharapkan']
};
const SCHEMA_VER = '6';
const DEFAULT_SETTINGS = {diskon_maks_persen: '10', bayar_tunai: 'TRUE', bayar_transfer: 'TRUE', bayar_qris: 'TRUE', tolak_selisih_total: 'TRUE', email_laporan: '', backup_email: '', logo_aktif: 'FALSE', logo_nama: 'TRUE', header_aktif: 'TRUE', header_struk: '', footer_aktif: 'TRUE', qr_struk: '', kategori_masuk_hpp: '', kelipatan_harga: '500', tgl_scan_penuh: 'FALSE'};
const MASTER = ['channels','materials','suppliers','products','product_variants','channel_prices','recipes','recipe_items','expenses'];
const CACHED = ['settings','channels','products','channel_prices','suppliers','recipes','recipe_items']; // tabel yang jarang berubah
const PROTECTED = { materials: ['stok','hpp_rata2'], product_variants: ['stok','hpp_rata2'] }; // hanya diubah transaksi/opname
const TEXT_COLS = {users: ['nama', 'username'], channels: ['nama'], materials: ['nama', 'satuan'], suppliers: ['nama', 'kontak', 'catatan'], products: ['nama', 'kategori'], product_variants: ['sku', 'ukuran', 'level_pedas'], recipes: ['nama'], sales: ['nomor', 'request_id', 'catatan'], expenses: ['kategori', 'catatan']};
/* B9: kolom tgl = 10 karakter pertama kolom tanggal asli, disimpan sebagai TEKS (yyyy-MM-dd). Kolom tanggal asli berubah jadi Date oleh Sheets sehingga menyaring
   berdasarkan tanggal berarti memformat setiap baris; tgl cukup dibandingkan sebagai string. TAIL_: kolom waktu TULIS; baris ditambahkan berurutan menurut waktu tulis,
   sehingga pemindaian dari ekor boleh berhenti saat waktu tulis sudah lebih tua dari awal rentang (tanggal transaksi yang mundur, mis. impor Shopee, tetap tertangkap
   karena baris itu ditulis belakangan). expenses tidak punya TAIL_: tanggal biaya diisi bebas (boleh ke depan), jadi selalu dipindai penuh (hanya kolom tgl). */
const DATECOL_ = {sales: 'tanggal', purchases: 'tanggal', production_orders: 'tanggal', expenses: 'tanggal', audit_log: 'waktu'};
const TAIL_ = {sales: 'created_at', purchases: 'created_at', production_orders: 'created_at', audit_log: 'waktu'};
Object.keys(DATECOL_).forEach(t => { TEXT_COLS[t] = (TEXT_COLS[t] || []).concat('tgl'); });
const PUBLIC_SETTINGS = ['nama_usaha','footer_struk','ppn_aktif','ppn_persen','ppn_inklusif','blokir_stok_minus','lebar_struk','auto_cetak','stok_menipis','diskon_maks_persen','bayar_tunai','bayar_transfer','bayar_qris','logo_aktif','logo_nama','logo_data','header_aktif','header_struk','footer_aktif','qr_struk'];
const RESERVED_SETTINGS = ['logo_data']; // besar: hanya lewat setting.logo (divalidasi, dan isinya tidak dicatat di audit_log)

/* ===== Setup, migrasi skema ===== */
let SS_ = null, NOCACHE_ = false, AUDITQ_ = [];
function db_() {
  if (SS_) return SS_;
  const p = PropertiesService.getScriptProperties(), id = p.getProperty('DB_ID');
  if (id) return (SS_ = SpreadsheetApp.openById(id));
  const ss = SpreadsheetApp.create('Duado Snack DB'); p.setProperty('DB_ID', ss.getId()); return (SS_ = ss);
}
function sh_(t) { // tabel yang belum ada (mis. tabel baru setelah pembaruan kode) dibuat otomatis
  const ss = db_(); let sh = ss.getSheetByName(t);
  if (!sh && SCHEMA[t]) { sh = ss.insertSheet(t); sh.getRange(1, 1, 1, SCHEMA[t].length).setValues([SCHEMA[t]]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function ensureSchema_(full) { // pastikan semua tabel dan kolom ada; full=true juga memformat kolom teks (lambat pada tabel besar)
  const ss = db_();
  Object.keys(SCHEMA).forEach(t => {
    const isNew = !ss.getSheetByName(t), sh = ss.getSheetByName(t) || ss.insertSheet(t);
    sh.getRange(1, 1, 1, SCHEMA[t].length).setValues([SCHEMA[t]]).setFontWeight('bold'); sh.setFrozenRows(1);
    if (full || isNew) (TEXT_COLS[t] || []).forEach(k => sh.getRange(2, SCHEMA[t].indexOf(k) + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@')); // teks murni: cegah "1/2" atau "3-4" berubah jadi tanggal
  });
  const d = ss.getSheetByName('Sheet1'); if (d && ss.getSheets().length > 1) ss.deleteSheet(d);
}
function backfillTgl_(budgetMs) { // isi tgl untuk baris lama, per potongan 20.000 baris dan dengan batas waktu; mengembalikan sisa baris. Selama belum terisi, pembaca memakai kolom tanggal asli.
  const t0 = Date.now(); let left = 0;
  Object.keys(DATECOL_).forEach(t => {
    const sh = sh_(t), last = sh.getLastRow(); if (last < 2) return;
    const h = SCHEMA[t], tc = h.indexOf('tgl') + 1, dc = h.indexOf(DATECOL_[t]) + 1, tg = sh.getRange(2, tc, last - 1, 1).getValues(), blank = [];
    for (let i = 0; i < tg.length; i++) if (tg[i][0] === '' || tg[i][0] == null) blank.push(i);
    if (!blank.length) return; if (Date.now() - t0 > budgetMs) { left += blank.length; return; }
    const part = blank.slice(0, 20000), lo = part[0], hi = part[part.length - 1], dv = sh.getRange(lo + 2, dc, hi - lo + 1, 1).getValues(), out = [];
    for (let i = lo; i <= hi; i++) { const cur = tg[i][0]; out.push([cur !== '' && cur != null ? cur : tglOf_(dv[i - lo][0])]); }
    sh.getRange(lo + 2, tc, hi - lo + 1, 1).setValues(out); left += blank.length - part.length;
  });
  return left;
}
function backfillTglLoop_() { // dari pemicu malam: potongan demi potongan, kunci dilepas di antaranya
  for (let i = 0; i < 12; i++) { let left = 0; try { left = withLock_(() => backfillTgl_(15000), 30000); } catch (e) { console.warn('Isi tgl ditunda: ' + e.message); return; } if (!left) return; }
}
function migrate_() { // dijalankan otomatis sekali per versi skema; aman dijalankan berulang
  ensureSchema_(false);
  Object.keys(DATECOL_).forEach(t => { const sh = sh_(t); sh.getRange(2, SCHEMA[t].indexOf('tgl') + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@'); }); // seluruh kolom tgl berformat teks SEBELUM diisi
  backfillTgl_(20000);
  const have = {}; readAll_('settings').forEach(r => have[r.key] = 1);
  Object.keys(DEFAULT_SETTINGS).forEach(k => { if (!have[k]) sh_('settings').appendRow([k, DEFAULT_SETTINGS[k]]); });
  bust_('settings');
  pepper_(); // v1.9.7: pastikan rahasia server untuk hash PIN sudah ada (dibuat sekali, di bawah kunci)
}
function schemaCheck_() {
  const c = CacheService.getScriptCache(); if (c.get('schema_ok') === SCHEMA_VER) return;
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('schema_ver') !== SCHEMA_VER) withLock_(() => { if (p.getProperty('schema_ver') !== SCHEMA_VER) { migrate_(); p.setProperty('schema_ver', SCHEMA_VER); } });
  c.put('schema_ok', SCHEMA_VER, 21600);
}
function setup() { // jalankan sekali; boleh diulang setelah pembaruan kode (tidak menghapus data)
  const ss = db_(); ss.setSpreadsheetTimeZone(TZ); ensureSchema_(true);
  if (readAll_('settings').length === 0) {
    [['nama_usaha','Duado Snack'],['footer_struk','Terima kasih, selamat menikmati!'],['ppn_aktif','FALSE'],['ppn_persen','0'],
     ['ppn_inklusif','TRUE'],['blokir_stok_minus','TRUE'],['overhead_per_unit','0'],['metode_overhead','per_unit'],['overhead_per_batch','0'],['target_margin','30'],['lebar_struk','32'],['auto_cetak','FALSE'],['arsip_bulan','13']].forEach(r => sh_('settings').appendRow(r));
  }
  migrate_(); PropertiesService.getScriptProperties().setProperty('schema_ver', SCHEMA_VER);
  if (readAll_('channels').length === 0) ['Offline','Shopee','WhatsApp/Instagram'].forEach(n => save_('channels', {nama: n, fee_persen: 0, fee_tetap: 0, aktif: true}, 'system'));
  if (readAll_('users').length === 0) {
    const pin = genPin_();
    saveUser_({nama: 'Owner', username: 'owner', role: 'owner', pin: pin, aktif: true}, 'system');
    Logger.log('Login awal -> username: owner | PIN: ' + pin + ' (segera ganti lewat menu Pengguna)');
  }
  Logger.log('Setup selesai. Spreadsheet: ' + ss.getUrl() + '. Jalankan installTriggers() agar backup, audit harian, dan uji restore berjalan otomatis.');
}
function genPin_() { for (;;) { const p = String(Math.floor(100000 + Math.random() * 900000)); if (!pinProblem_(p)) return p; } }

/* ===== Helper data ===== */
const now_ = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
const id_ = () => 'D' + Utilities.getUuid().replace(/-/g, '').slice(0, 8); // awalan huruf agar Sheets tidak menganggapnya angka
const isDate_ = v => Object.prototype.toString.call(v) === '[object Date]';
const fmt_ = v => isDate_(v) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss') : v;
const isTrue_ = v => String(v).toUpperCase() === 'TRUE';
const tglOf_ = v => isDate_(v) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v == null ? '' : v).slice(0, 10);
function readAll_(t) {
  const v = sh_(t).getDataRange().getValues(), h = v.shift();
  return v.map(r => { const o = {}; h.forEach((k, i) => o[k] = fmt_(r[i])); return o; });
}
/* Pembacaan hemat: baca hanya kolom yang diperlukan, lalu hanya baris yang cocok. Menggantikan lastRows_ (yang memotong data lama). */
function readCols_(t, keys) {
  const sh = sh_(t), last = sh.getLastRow(), out = {}; keys.forEach(k => out[k] = []);
  if (last < 2) return out;
  keys.forEach(k => { out[k] = sh.getRange(2, SCHEMA[t].indexOf(k) + 1, last - 1, 1).getValues().map(r => r[0]); });
  return out;
}
function rowsAt_(t, idxs) { // idxs: indeks baris data 0-based (baris sheet = idx + 2); baris berdekatan dibaca dalam satu blok
  if (!idxs.length) return [];
  const sh = sh_(t), h = SCHEMA[t], w = h.length, out = [], ix = idxs.slice().sort((a, b) => a - b); let i = 0;
  while (i < ix.length) {
    let j = i; while (j + 1 < ix.length && ix[j + 1] - ix[j] <= 300) j++;
    const a = ix[i], b = ix[j], v = sh.getRange(a + 2, 1, b - a + 1, w).getValues();
    for (let k = i; k <= j; k++) { const r = v[ix[k] - a], o = {}; h.forEach((key, c) => o[key] = fmt_(r[c])); out.push(o); }
    i = j + 1;
  }
  return out;
}
const DATE_BLOCK_ = 400, DATE_BLOCK_MAX_ = 6400, TAIL_MIN_ROWS_ = 10000, cms_ = v => isDate_(v) ? v.getTime() : (Date.parse(String(v).replace(' ', 'T') + '+07:00') || 0); // TZ tetap +07:00 (Asia/Jakarta tanpa DST)
function dateScan_(t, from, to) { // indeks baris data (0-based) bertanggal dalam [from, to] (yyyy-MM-dd), tanpa batas jumlah baris. first: indeks terawal yang dibaca; tail: dipindai dari ekor
  const sh = sh_(t), last = sh.getLastRow(); if (last < 2) return {idx: [], first: 0, tail: false};
  const h = SCHEMA[t], n = last - 1, tc = h.indexOf('tgl') + 1, dc = h.indexOf(DATECOL_[t]) + 1;
  const dayAt = (a, b) => { // tgl baris a..b; baris yang tgl-nya masih kosong (data lama, belum terisi) memakai kolom tanggal asli: selalu benar
    const tg = sh.getRange(a + 2, tc, b - a + 1, 1).getValues(); let dv = null;
    return tg.map((r, k) => { let v = r[0]; if (v === '' || v == null) { if (!dv) dv = sh.getRange(a + 2, dc, b - a + 1, 1).getValues(); v = dv[k][0]; } return typeof v === 'string' ? v.slice(0, 10) : tglOf_(v); });
  };
  const full = () => { const days = dayAt(0, n - 1), idx = []; for (let i = 0; i < n; i++) if (days[i] >= from && days[i] <= to) idx.push(i); return {idx: idx, first: 0, tail: false}; };
  const cc = TAIL_[t] && !isTrue_(settingsMap_().tgl_scan_penuh) ? h.indexOf(TAIL_[t]) + 1 : 0;
  if (!cc || n <= TAIL_MIN_ROWS_) return full(); // tabel kecil atau tanpa urutan tulis: satu pembacaan kolom tgl lebih murah daripada beberapa panggilan ekor
  const startMs = Date.parse(addDays_(from, -1) + 'T00:00:00+07:00'), idx = []; let prevFirst = Infinity; // satu hari kelonggaran: tanggal transaksi boleh 10 menit melewati waktu tulis
  for (let b = n - 1, blk = DATE_BLOCK_; b >= 0; b = b - blk, blk = Math.min(blk * 2, DATE_BLOCK_MAX_)) { // blok membesar: rentang sempit (hari ini) hanya membaca beberapa ratus baris
    const a = Math.max(0, b - blk + 1), days = dayAt(a, b), cr = sh.getRange(a + 2, cc, b - a + 1, 1).getValues().map(r => cms_(r[0]));
    if (cr.some(x => !x) || cr[cr.length - 1] > prevFirst) return full(); // waktu tulis tidak terbaca atau tidak naik: urutan tabel tidak dipercaya, pindai penuh
    for (let k = 1; k < cr.length; k++) if (cr[k] < cr[k - 1]) return full();
    prevFirst = cr[0];
    for (let k = 0; k < days.length; k++) if (days[k] >= from && days[k] <= to) idx.push(a + k);
    if (cr[0] < startMs) return {idx: idx.sort((x, y) => x - y), first: a, tail: true}; // baris di atas blok ini ditulis sebelum rentang dimulai
  }
  return {idx: idx.sort((x, y) => x - y), first: 0, tail: true};
}
function rowsByDate_(t, dateKey, from, to) { return rowsAt_(t, dateScan_(t, from, to).idx); }
function rowsByKey_(t, key, set) { // semua baris yang nilai kolom `key`-nya ada di `set` (objek id -> truthy)
  const col = readCols_(t, [key])[key], idx = [];
  for (let i = 0; i < col.length; i++) if (set[col[i]]) idx.push(i);
  return rowsAt_(t, idx);
}
/* Cache tabel: satu entri CacheService maksimal 100 KB, sedangkan tabel seperti channel_prices (varian x channel) bisa melewatinya. Karena itu JSON dipecah
   menjadi potongan ~30.000 karakter; kunci t_<tabel> hanya memuat meta {stempel, jumlah potongan} dan setiap potongan diawali stempel yang sama, sehingga
   pembacaan yang bertepatan dengan penulisan ulang tidak pernah menghasilkan data campuran. Gagal menyimpan dicatat (console.warn), bukan ditelan. */
const CACHE_CHUNK_ = 30000, CACHE_MAXCHUNK_ = 60, CACHE_TTL_ = 1800; // v1.9.8: TTL 30 menit (sebelumnya 10). Aman karena setiap penulisan lewat API memanggil bust_; hanya edit langsung di Sheets yang butuh tombol Perbarui (sistem.refresh).
function cachePutTable_(c, t, json) {
  const parts = []; for (let i = 0; i < json.length; i += CACHE_CHUNK_) parts.push(json.slice(i, i + CACHE_CHUNK_));
  if (parts.length > CACHE_MAXCHUNK_) { console.warn('Cache tabel ' + t + ' dilewati: terlalu besar (' + json.length + ' karakter). Dibaca langsung dari sheet.'); return false; }
  const stamp = Date.now() + '' + Math.floor(Math.random() * 1000), o = {};
  parts.forEach((p, k) => o['t_' + t + '_' + k] = stamp + '|' + p);
  try { c.putAll(o, CACHE_TTL_); c.put('t_' + t, JSON.stringify({s: stamp, n: parts.length}), CACHE_TTL_); return true; }
  catch (e) { console.warn('Gagal menyimpan cache tabel ' + t + ': ' + e.message); return false; }
}
function cacheGetTable_(c, t) {
  const m = c.get('t_' + t); if (!m) return null; let meta; try { meta = JSON.parse(m); } catch (e) { return null; }
  if (!meta || !meta.s || !(meta.n > 0)) return null; // entri lama (format sebelum v1.8.2) diperlakukan sebagai kosong
  const keys = []; for (let k = 0; k < meta.n; k++) keys.push('t_' + t + '_' + k);
  const got = c.getAll(keys), pre = meta.s + '|', out = [];
  for (let k = 0; k < keys.length; k++) { const v = got[keys[k]]; if (!v || v.indexOf(pre) !== 0) return null; out.push(v.slice(pre.length)); }
  try { return JSON.parse(out.join('')); } catch (e) { return null; }
}
/* v1.9.8: penjaga balapan cache. Pembaca (bootstrap, ping, dst.) tidak memegang kunci: bila sheet ditulis dan bust_ dipanggil SETELAH pembaca membaca sheet tetapi
   SEBELUM ia menyimpan ke cache, data basi akan tersimpan sampai TTL habis. Kini bust_ menaikkan penanda generasi ('cgen'); pembaca hanya menyimpan bila generasi
   tidak berubah sejak sebelum ia membaca (hilang/berubah = tidak disimpan; arah kegagalan selalu aman: hanya membaca ulang dari sheet pada permintaan berikutnya). */
const gen_ = c => { try { return c.get('cgen'); } catch (e) { return null; } };
function tbl_(t) {
  const c = CacheService.getScriptCache(), use = CACHED.indexOf(t) >= 0 && !NOCACHE_;
  if (use) { const hit = cacheGetTable_(c, t); if (hit) return hit; }
  const g = use ? gen_(c) : null, r = readAll_(t);
  if (use && gen_(c) === g) cachePutTable_(c, t, JSON.stringify(r));
  return r;
}
const bust_ = t => { if (NOCACHE_) return; const c = CacheService.getScriptCache(); c.remove('t_' + t); if (t === 'product_variants') c.remove('t_variant_meta'); try { c.put('cgen', newVer_(), 21600); } catch (e) {} };
function variantMeta_() { // varian TANPA kolom stok dan HPP (yang berubah di setiap penjualan): aman di-cache sampai katalog berubah. Untuk label dan validasi.
  const c = CacheService.getScriptCache(), use = !NOCACHE_;
  if (use) { const hit = cacheGetTable_(c, 'variant_meta'); if (hit) return hit; }
  const g = use ? gen_(c) : null, r = readAll_('product_variants').map(v => ({id: v.id, product_id: v.product_id, sku: v.sku, ukuran: v.ukuran, level_pedas: v.level_pedas, aktif: v.aktif}));
  if (use && gen_(c) === g) cachePutTable_(c, 'variant_meta', JSON.stringify(r));
  return r;
}
/* Versi data dipisah: cat_ver (produk, harga, channel, pengaturan, bahan, resep) dan stock_ver (stok produk jadi). Penjualan, retur, dan pemulihan hanya menaikkan
   stock_ver, sehingga perangkat lain cukup mengambil peta stok kecil (stock.get), bukan seluruh katalog. `ver` gabungan tetap dikirim untuk klien lama.
   Versi hidup di cache (maks. 6 jam). Agar perangkat tidak memuat ulang katalog tanpa ada data baru, cat_ver juga disimpan permanen (Script Properties, hanya
   ditulis saat katalog berubah, jarang) dan dipulihkan dari sana bila cache terbuang atau kedaluwarsa. stock_ver sengaja hanya di cache (berubah di setiap
   penjualan, menulis Properties tiap penjualan memperlambat kunci): bila cache terbuang, stock_ver baru dibuat dan perangkat cukup mengambil peta stok kecil.
   Arah kegagalan selalu aman: versi yang berbeda hanya memicu muat ulang, tidak pernah melewatkan perubahan. */
const newVer_ = () => Date.now() + '.' + Math.floor(Math.random() * 1000);
let VERS_ = null, BUMP_ = null; // per eksekusi: salinan versi (dibaca dari cache sekali saja) dan {prev, clean} = versi tepat sebelum perubahan pertama oleh permintaan ini
function readVers_() {
  const c = CacheService.getScriptCache(), g = c.getAll(['cat_ver', 'stock_ver']), put = {};
  let cat = g.cat_ver, stk = g.stock_ver;
  if (!cat) {
    try { cat = PropertiesService.getScriptProperties().getProperty('cat_ver'); } catch (e) { cat = null; }
    if (!cat) { cat = newVer_(); try { PropertiesService.getScriptProperties().setProperty('cat_ver', cat); } catch (e) {} }
    put.cat_ver = cat;
  }
  if (!stk) { stk = newVer_(); put.stock_ver = stk; }
  if (put.cat_ver || put.stock_ver) c.putAll(put, 21600);
  return {cat_ver: cat, stock_ver: stk};
}
function vers_() { return VERS_ || (VERS_ = readVers_()); } // objek tidak pernah diubah di tempat: v0 yang disimpan pemanggil tetap utuh setelah bump_
const ver_ = () => { const v = vers_(); return v.cat_ver + '~' + v.stock_ver; };
function bump_(kind) { // kind === 'stok': hanya stok produk jadi yang berubah; selain itu katalog dan stok sama-sama naik
  const cur = readVers_(), v = newVer_(), o = {stock_ver: v}; // dibaca ulang dari cache (dipanggil di dalam kunci): tahu pasti versi tepat sebelum perubahan ini
  if (!BUMP_) BUMP_ = {prev: cur, clean: true}; else if (!VERS_ || cur.cat_ver !== VERS_.cat_ver || cur.stock_ver !== VERS_.stock_ver) BUMP_.clean = false; // perangkat lain menyela di antara dua perubahan
  if (kind !== 'stok') { o.cat_ver = v; try { PropertiesService.getScriptProperties().setProperty('cat_ver', v); } catch (e) { console.warn('Gagal menyimpan cat_ver permanen: ' + e.message); } }
  CacheService.getScriptCache().putAll(o, 21600);
  VERS_ = {cat_ver: o.cat_ver || cur.cat_ver, stock_ver: v};
}
function stockGet_() { // peta stok produk jadi saja (beberapa KB), untuk menyegarkan stok di perangkat lain tanpa memuat ulang katalog
  const v = vers_(), c = readCols_('product_variants', ['id', 'stok']), o = {}; // versi dibaca SEBELUM data: bila ada penjualan di sela, klien cukup menyegarkan lagi
  for (let i = 0; i < c.id.length; i++) o[c.id[i]] = num_(c.stok[i]);
  return {ver: v.cat_ver + '~' + v.stock_ver, cat_ver: v.cat_ver, stock_ver: v.stock_ver, stok: o};
}
/* Galat sementara (kunci penuh, kuota, gangguan layanan Google) ditandai retry:true agar klien mengulang otomatis, bukan memindahkan transaksi valid ke "Perlu ditinjau".
   Pola sengaja dijangkarkan ke awal pesan galat Google (bukan pencarian bebas), supaya nama SKU atau produk yang kebetulan memuat kata "lock" tidak salah dikenali. */
const TRANSIENT_RE_ = /^(Exception: )?(Lock timeout|Could not obtain lock|Service invoked too many times|Service Spreadsheets failed|Service unavailable|Server error|Limit Exceeded|Too many simultaneous|We're sorry, a server error occurred)/i;
const isTransient_ = e => !!(e && e.retry) || TRANSIENT_RE_.test(String((e && e.message) || e || ''));
const SALE_LOCK_MS_ = 30000;
/* v1.9.8: kunci aman bersarang. Kunci skrip Google tidak reentrant: waitLock kedua dalam eksekusi yang sama menunggu dirinya sendiri sampai habis waktu. Penghitung
   kedalaman membuat pemanggilan bersarang langsung menjalankan fn (kunci sudah dipegang); audit ditulis dan kunci dilepas hanya di lapisan terluar. */
let LOCK_DEPTH_ = 0;
function withLock_(fn, waitMs) {
  if (LOCK_DEPTH_ > 0) return fn();
  const l = LockService.getScriptLock();
  try { l.waitLock(waitMs || 20000); } catch (e) { const b = new Error('Server sedang sibuk (antrean penulisan penuh). Akan dicoba lagi otomatis.'); b.retry = true; throw b; }
  LOCK_DEPTH_++;
  try { return fn(); } finally { LOCK_DEPTH_--; try { flushAudit_(); } finally { l.releaseLock(); } }
}
/* Grid Google Sheets bawaan hanya 1000 baris; menulis di luar grid menimbulkan galat. Kapasitas ditambah (dengan format Teks untuk kolom teks) sebelum menulis. */
const BIGT_ = {sales: 1, sale_items: 1, stock_movements: 1, audit_log: 1}; // tabel yang tumbuh cepat: tambah 2.000 baris sekali jalan (lebih jarang memperluas grid)
function ensureRows_(sh, t, needLast) {
  const max = sh.getMaxRows(); if (needLast <= max) return; const add = needLast - max + (BIGT_[t] ? 2000 : 500);
  sh.insertRowsAfter(max, add);
  (TEXT_COLS[t] || []).forEach(k => sh.getRange(max + 1, SCHEMA[t].indexOf(k) + 1, add, 1).setNumberFormat('@'));
}
function appendRows_(t, objs, at) { // mengembalikan nomor baris sheet pertama yang ditulis. `at`: baris awal bila pemanggil sudah memastikan kapasitas (hemat panggilan Sheets)
  if (!objs.length) return 0; const h = SCHEMA[t], sh = sh_(t);
  const vals = objs.map(o => h.map(k => k === 'tgl' && DATECOL_[t] ? tglOf_(o[DATECOL_[t]]) : (o[k] === undefined ? '' : o[k]))), start = at || sh.getLastRow() + 1;
  if (!at) ensureRows_(sh, t, start - 1 + vals.length);
  sh.getRange(start, 1, vals.length, h.length).setValues(vals); return start;
}
/* Audit ditampung dan ditulis sekali di akhir kunci (satu panggilan Sheets, bukan satu per perubahan). */
const redact_ = (ent, o) => { if (ent !== 'users' || !o) return o; const c = Object.assign({}, o); if ('salt' in c) c.salt = '***'; if ('hash_pin' in c) c.hash_pin = '***'; return c; };
function audit_(uid, aksi, ent, before, after) {
  before = redact_(ent, before); after = redact_(ent, after);
  AUDITQ_.push({id: id_(), waktu: now_(), user_id: uid, aksi: aksi, entitas: ent, sebelum: before ? JSON.stringify(before) : '', sesudah: after ? JSON.stringify(after) : ''});
}
function flushAudit_() { if (!AUDITQ_.length) return; const q = AUDITQ_; AUDITQ_ = []; appendRows_('audit_log', q); }
function save_(t, o, uid) { return withLock_(() => saveRaw_(t, o, uid)); }
function saveRaw_(t, o, uid) { // tanpa kunci; dipanggil dari dalam withLock_. Data baru tidak perlu membaca sheet sama sekali.
  const sh = sh_(t), h = SCHEMA[t], now = now_(); let row = 0, old = null;
  if (o.id) {
    const last = sh.getLastRow();
    if (last >= 2) { const ids = sh.getRange(2, 1, last - 1, 1).getValues(); for (let i = 0; i < ids.length; i++) if (ids[i][0] === o.id) { row = i + 2; break; } }
    if (row) { const r = sh.getRange(row, 1, 1, h.length).getValues()[0]; old = Object.fromEntries(h.map((k, i) => [k, fmt_(r[i])])); }
  }
  if (!o.id) o.id = id_();
  const rec = Object.assign({}, old || {}, o);
  if (h.includes('updated_at')) rec.updated_at = now;
  if (!old && h.includes('created_at')) rec.created_at = now;
  if (!old && h.includes('aktif') && rec.aktif === undefined) rec.aktif = true;
  if (!old && PROTECTED[t]) PROTECTED[t].forEach(k => rec[k] = 0);
  if (DATECOL_[t]) rec.tgl = tglOf_(rec[DATECOL_[t]]); // tanggal bisa diubah (mis. biaya): tgl ikut
  if (row) sh.getRange(row, 1, 1, h.length).setValues([h.map(k => rec[k] === undefined ? '' : rec[k])]); else appendRows_(t, [rec]);
  audit_(uid, old ? 'update' : 'create', t, old, rec); bust_(t); bump_(); return rec;
}
function remove_(t, id, uid) { // soft delete bila ada kolom aktif; selain itu hapus baris
  if (SCHEMA[t].includes('aktif')) return save_(t, {id: id, aktif: false}, uid);
  return withLock_(() => {
    const sh = sh_(t), v = sh.getDataRange().getValues(), i = v.findIndex((r, n) => n > 0 && r[0] === id);
    if (i > 0) { sh.deleteRow(i + 1); audit_(uid, 'delete', t, {id: id}, null); bust_(t); bump_(); }
    return {id: id, deleted: true};
  });
}
function writeSettings_(vals) { // tanpa kunci; dipanggil dari dalam withLock_
  const sh = sh_('settings'), v = sh.getDataRange().getValues();
  Object.keys(vals).forEach(k => {
    const i = v.findIndex((r, n) => n > 0 && r[0] === k);
    if (i > 0) { sh.getRange(i + 1, 2).setValue(vals[k]); v[i][1] = vals[k]; } else { sh.appendRow([k, vals[k]]); v.push([k, vals[k]]); }
  });
}
const LIMIT_SETTINGS_ = {header_struk: 300, footer_struk: 300, qr_struk: 120}; // panjang catatan struk (karakter)
function setSettings_(vals, uid) {
  Object.keys(LIMIT_SETTINGS_).forEach(k => { if (k in vals && String(vals[k]).length > LIMIT_SETTINGS_[k]) throw new Error('Isi "' + k + '" terlalu panjang (maks. ' + LIMIT_SETTINGS_[k] + ' karakter).'); });
  RESERVED_SETTINGS.forEach(k => { if (k in vals) throw new Error('Pengaturan "' + k + '" tidak dapat diubah lewat jalur ini.'); });
  return withLock_(() => {
    writeSettings_(vals);
    audit_(uid, 'settings', 'settings', null, vals); bust_('settings'); bump_(); return {saved: Object.keys(vals).length};
  });
}
/* Logo struk: bitmap 1-bit (1 = titik hitam, MSB dahulu, per baris) dalam format "L1;<lebar>x<tinggi>;<t|h>;<base64>".
   t = hitam-putih tegas, h = halftone. Lebar kelipatan 8 dan <= 576 titik (80 mm), tinggi <= 256. Isi base64 dicek panjangnya terhadap ukuran. */
const LOGO_RE_ = /^L1;(\d{1,3})x(\d{1,3});([th]);([A-Za-z0-9+\/]+={0,2})$/;
function setLogo_(p, uid) {
  const d = String(p.data == null ? '' : p.data); let info = 'dihapus';
  if (d !== '') {
    const m = LOGO_RE_.exec(d); if (!m) throw new Error('Format logo tidak valid.');
    const w = Number(m[1]), h = Number(m[2]), b = m[4];
    const bytes = b.length % 4 === 0 ? b.length / 4 * 3 - (b.slice(-2) === '==' ? 2 : b.slice(-1) === '=' ? 1 : 0) : -1;
    if (w < 8 || w > 576 || w % 8 || h < 1 || h > 256 || bytes !== w / 8 * h || d.length > 40000) throw new Error('Ukuran logo tidak valid (lebar maks. 576 titik, tinggi maks. 256 titik).');
    info = w + 'x' + h;
  }
  return withLock_(() => {
    const vals = {logo_data: d}; if (d !== '' && p.aktif === true) vals.logo_aktif = 'TRUE'; // logo pertama: langsung diaktifkan
    writeSettings_(vals);
    audit_(uid, 'logo', 'settings', null, {logo: info}); bust_('settings'); bump_(); return {ok: true, ukuran: info};
  });
}
const settingsMap_ = () => { const o = Object.assign({}, DEFAULT_SETTINGS); tbl_('settings').forEach(r => { if (r.value !== '' || !(r.key in DEFAULT_SETTINGS)) o[r.key] = r.value; }); return o; };

/* ===== Auth: PIN berlapis hash, penguncian akun persisten bertingkat, sesi yang bisa dicabut ===== */
const PIN_ROUNDS = 2000, LOCK_STEPS = [15, 60, 360, 1440]; // PIN_ROUNDS = putaran PBKDF2 untuk hash BARU; hash lama tetap sah dan ditingkatkan saat login. Bisa diubah tanpa deploy lewat Script Property PIN_ROUNDS.
const bytes_ = x => Utilities.newBlob(x).getBytes();
const hash_ = (pin, salt) => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pin)); // format lama (tetap dikenali)
function hashV2_(pin, salt, rounds) { // format v2 (tetap dikenali; tidak lagi dibuat)
  const sb = bytes_(salt); let d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes_(salt + ':' + pin));
  for (let i = 1; i < rounds; i++) d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.concat(sb));
  return 'v2$' + rounds + '$' + Utilities.base64Encode(d);
}
/* v3 (v1.9.7): PBKDF2-HMAC-SHA256 yang dikunci dengan "pepper" rahasia di Script Properties. Isi spreadsheet saja (salt + hash) tidak cukup untuk menebak PIN secara offline:
   penyerang juga butuh pepper yang tidak pernah ada di spreadsheet. Hilangnya pepper = hash v3 tidak bisa diverifikasi (pulihkan dengan resetOwnerPin lalu atur ulang PIN pengguna). */
function pepper_() {
  const p = PropertiesService.getScriptProperties(); let v = p.getProperty('PIN_PEPPER');
  if (!v) { v = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid(); p.setProperty('PIN_PEPPER', v); }
  return v;
}
const pinRounds_ = () => { const n = Number(PropertiesService.getScriptProperties().getProperty('PIN_ROUNDS')); return n >= 1000 && n <= 100000 ? Math.floor(n) : PIN_ROUNDS; };
function pbkdf2_(pwBytes, saltBytes, rounds) { // PBKDF2-HMAC-SHA256, 1 blok (32 byte). Byte Apps Script bertanda (-128..127); XOR tetap benar.
  const mac = (k, m) => Utilities.computeHmacSha256Signature(m, k);
  let u = mac(pwBytes, saltBytes.concat([0, 0, 0, 1])); const t = u.slice();
  for (let i = 1; i < rounds; i++) { u = mac(pwBytes, u); for (let j = 0; j < 32; j++) t[j] ^= u[j]; }
  return t;
}
function hashV3_(pin, salt, rounds, pepper) {
  const pre = Utilities.computeHmacSha256Signature(bytes_(salt + ':' + pin), bytes_(pepper)); // pin dilebur dengan pepper sebelum diregang
  return 'v3$' + rounds + '$' + Utilities.base64Encode(pbkdf2_(pre, bytes_(salt), rounds));
}
const hashNew_ = (pin, salt) => hashV3_(String(pin), salt, pinRounds_(), pepper_());
function same_(a, b) { a = String(a); b = String(b); let r = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return r === 0; }
function pinOk_(pin, u) {
  const h = String(u.hash_pin || ''), m3 = h.match(/^v3\$(\d+)\$/), m2 = h.match(/^v2\$(\d+)\$/);
  if (m3) return same_(hashV3_(String(pin), u.salt, Number(m3[1]), pepper_()), h);
  return m2 ? same_(hashV2_(String(pin), u.salt, Number(m2[1])), h) : same_(hash_(String(pin), u.salt), h);
}
const needsRehash_ = h => { const m = String(h || '').match(/^v3\$(\d+)\$/); return !m || Number(m[1]) < pinRounds_(); };
function pinProblem_(pin) {
  pin = String(pin);
  if (!/^\d{6,10}$/.test(pin)) return 'PIN harus 6-10 angka.';
  if (/^(\d)\1+$/.test(pin)) return 'PIN tidak boleh angka yang sama semua.';
  if ('01234567890123456789'.indexOf(pin) >= 0 || '98765432109876543210'.indexOf(pin) >= 0) return 'PIN tidak boleh berurutan (mis. 123456).';
  if (/^(\d{2,3})\1+$/.test(pin) || ['112233', '696969', '159753', '147258', '202020', '121314'].indexOf(pin) >= 0) return 'PIN terlalu mudah ditebak. Hindari pola berulang.';
  return '';
}
function killSessions_(uid) {
  const c = CacheService.getScriptCache(), raw = c.get('tk_' + uid); if (!raw) return;
  try { JSON.parse(raw).forEach(t => c.remove('s_' + t)); } catch (e) {} c.remove('tk_' + uid);
}
function saveUser_(u, uid) {
  if (u.pin) { const pr = pinProblem_(u.pin); if (pr) throw new Error(pr); }
  if (u.role && ['owner','kasir','admin'].indexOf(u.role) < 0) throw new Error('Peran tidak valid.');
  const o = {id: u.id, nama: u.nama, username: String(u.username || '').trim().toLowerCase(), role: u.role, aktif: u.aktif !== false};
  if (!o.username || !o.nama) throw new Error('Nama dan username wajib diisi.');
  const all = readAll_('users'); if (all.some(x => x.username === o.username && x.id !== o.id)) throw new Error('Username sudah dipakai.');
  const old = u.id ? all.find(x => x.id === u.id) : null;
  if (old && old.role === 'owner' && (o.role !== 'owner' || !o.aktif) && !all.some(x => x.id !== old.id && x.role === 'owner' && String(x.aktif) !== 'false')) throw new Error('Minimal harus ada 1 Owner aktif.');
  if (u.pin) { o.salt = Utilities.getUuid(); o.hash_pin = hashNew_(u.pin, o.salt); } else if (!u.id) throw new Error('PIN wajib untuk pengguna baru.');
  const r = save_('users', o, uid);
  if (old && (u.pin || !o.aktif || old.role !== o.role)) { killSessions_(u.id); PropertiesService.getScriptProperties().deleteProperty('dv_' + u.id); } // PIN diganti, dinonaktifkan, atau peran berubah: sesi dan perangkat tepercaya dicabut
  return {id: r.id, nama: r.nama, username: r.username, role: r.role, aktif: r.aktif};
}
/* Penguncian: per pengguna disimpan di Script Properties (tidak hilang bila cache dibersihkan). Username tak dikenal memakai cache dengan aturan sama sehingga tidak bisa dibedakan. */
const lkKey_ = un => 'lk_' + un;
function lockGet_(u) { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(lkKey_(u.username)) || '{}'); } catch (e) { return {}; } }
function lockMsg_(until) { return 'Akun terkunci sementara karena terlalu banyak percobaan. Coba lagi dalam ' + Math.max(1, Math.ceil((until - Date.now()) / 60000)) + ' menit, atau minta Owner membuka kunci.'; }
/* Perangkat tepercaya: setelah login berhasil, perangkat (id acak 128-bit yang disimpan di browser; server hanya menyimpan hash-nya) dicatat untuk pengguna itu.
   Penguncian akun dan rem global hanya membatasi perangkat TIDAK dikenal, sehingga orang luar yang menebak PIN atau username tidak bisa mengunci kasir dan Owner
   dari perangkatnya sendiri. Perangkat dikenal tetap dibatasi 5 salah per 15 menit. Id perangkat dihapus saat PIN diganti atau akun dinonaktifkan. */
function devKey_(d) {
  d = String(d || ''); if (!/^[A-Za-z0-9_-]{16,64}$/.test(d)) return '';
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('').slice(0, 24);
}
const devList_ = uid => { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('dv_' + uid) || '[]'); } catch (e) { return []; } };
function devTrust_(uid, dk) { if (!dk) return; const l = devList_(uid); if (l.indexOf(dk) >= 0) return; l.push(dk); PropertiesService.getScriptProperties().setProperty('dv_' + uid, JSON.stringify(l.slice(-8))); }
function checkCred_(username, pin, dev) { // memvalidasi username + PIN; melempar galat seragam. Dipakai login dan otorisasi owner.
  const c = CacheService.getScriptCache(), un = String(username || '').trim().toLowerCase().slice(0, 40), dk = devKey_(dev), gk = 'gfail', g = Number(c.get(gk)) || 0;
  const u = readAll_('users').find(r => r.username === un && String(r.aktif) !== 'false'), uk = 'fail_' + un;
  if (!u) { // username tak dikenal: rem global hanya berlaku untuk tebakan username, jadi tidak bisa dipakai menutup login pengguna yang sah
    if (g >= 60) throw new Error('Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.');
    const f = Number(c.get(uk)) || 0; if (f >= 5) throw new Error(lockMsg_(Date.now() + 15 * 60000));
    c.put(uk, String(f + 1), 900); c.put(gk, String(g + 1), 900); throw new Error('Username atau PIN salah.');
  }
  const trusted = !!dk && devList_(u.id).indexOf(dk) >= 0, fk = 'fdv_' + un + '_' + dk, st = lockGet_(u);
  if (trusted) { if ((Number(c.get(fk)) || 0) >= 5) throw new Error(lockMsg_(Date.now() + 15 * 60000)); }
  else if (st.until && st.until > Date.now()) throw new Error(lockMsg_(st.until));
  if (!pinOk_(pin, u)) {
    if (trusted) { c.put(fk, String((Number(c.get(fk)) || 0) + 1), 900); throw new Error('Username atau PIN salah.'); }
    const n = (st.until && st.until <= Date.now() ? 0 : Number(st.n) || 0) + 1; let nx = {n: n, lvl: st.lvl || 0, until: 0};
    if (n >= 5) { nx = {n: 0, lvl: nx.lvl + 1, until: Date.now() + LOCK_STEPS[Math.min(nx.lvl, LOCK_STEPS.length - 1)] * 60000}; }
    PropertiesService.getScriptProperties().setProperty(lkKey_(un), JSON.stringify(nx));
    if (nx.until) { try { withLock_(() => { audit_(u.id, 'akun_terkunci', 'users', null, {username: un, sampai: new Date(nx.until).toISOString()}); bump_('stok'); }); } catch (e) {} throw new Error(lockMsg_(nx.until)); }
    throw new Error('Username atau PIN salah.');
  }
  if (st.n || st.until || st.lvl) PropertiesService.getScriptProperties().deleteProperty(lkKey_(un)); // login benar membuktikan pemilik akun hadir: hitungan salah dan kunci dibersihkan
  if (trusted) c.remove(fk);
  return u;
}
function login_(username, pin, dev) {
  const u = checkCred_(username, pin, dev), c = CacheService.getScriptCache(), token = Utilities.getUuid() + Utilities.getUuid(), weak = !!pinProblem_(pin);
  if (needsRehash_(u.hash_pin)) { try { const salt = Utilities.getUuid(), hp = hashNew_(pin, salt); withLock_(() => saveRaw_('users', {id: u.id, salt: salt, hash_pin: hp}, 'system')); } catch (e) {} } // tingkatkan hash lama secara otomatis saat login berhasil
  devTrust_(u.id, devKey_(dev)); // perangkat ini dikenal untuk pengguna ini
  c.put('s_' + token, JSON.stringify({uid: u.id, role: u.role, nama: u.nama, t: Date.now()}), 21600);
  let tk = []; try { tk = JSON.parse(c.get('tk_' + u.id) || '[]'); } catch (e) {} tk.push(token); c.put('tk_' + u.id, JSON.stringify(tk.slice(-20)), 21600);
  if (u.role === 'owner') { try { withLock_(() => audit_(u.id, 'login', 'users', null, {role: 'owner'})); } catch (e) {} }
  return {token: token, role: u.role, nama: u.nama, uid: u.id, pin_lemah: weak};
}
function auth_(token) {
  const c = CacheService.getScriptCache(), raw = token && c.get('s_' + token);
  if (!raw) throw new Error('Sesi berakhir, silakan masuk lagi.');
  const s = JSON.parse(raw);
  if (Date.now() - (s.t || 0) > 30 * 60000) { s.t = Date.now(); c.put('s_' + token, JSON.stringify(s), 21600); } // perpanjang sesi paling sering tiap 30 menit
  return s;
}
function logout_(token) { if (token) CacheService.getScriptCache().remove('s_' + token); return {ok: true}; }
const need_ = (s, role) => { if (s.role !== role) throw new Error('Akses ditolak.'); };
function unlockUser_(p, s) {
  const u = readAll_('users').find(r => r.id === p.id); if (!u) throw new Error('Pengguna tidak ditemukan.');
  PropertiesService.getScriptProperties().deleteProperty(lkKey_(u.username)); CacheService.getScriptCache().remove('fail_' + u.username);
  withLock_(() => { audit_(s.uid, 'buka_kunci', 'users', null, {username: u.username}); bump_('stok'); }); return {id: u.id};
}
function lockedNow_(u) { const st = lockGet_(u); return !!(st.until && st.until > Date.now()); }
/* Otorisasi Owner di perangkat kasir (diskon melebihi batas, selisih total): Owner memasukkan PIN, server memberi token sekali pakai yang terikat pada satu transaksi. PIN tidak pernah disimpan di perangkat. */
function overrideGrant_(p, s) {
  const kind = p.kind, rid = String(p.request_id || '');
  if (['diskon', 'selisih', 'retur'].indexOf(kind) < 0 || !rid) throw new Error('Permintaan otorisasi tidak valid.');
  const o = checkCred_(p.username, p.pin, p.dev); if (o.role !== 'owner') throw new Error('Otorisasi hanya bisa dilakukan oleh Owner.');
  const token = Utilities.getUuid(); CacheService.getScriptCache().put('ov_' + token, JSON.stringify({kind: kind, rid: rid, maks: Number(p.nilai) || 0, by: o.id}), 21600);
  withLock_(() => audit_(s.uid, 'otorisasi', 'override', null, {kind: kind, rid: rid, nilai: Number(p.nilai) || 0, oleh: o.id}));
  return {token: token};
}
function overrideCheck_(token, kind, rid, need) {
  const raw = token && CacheService.getScriptCache().get('ov_' + token); if (!raw) return null;
  const o = JSON.parse(raw); if (o.kind !== kind || o.rid !== rid || (kind === 'diskon' && need > o.maks + 0.5)) return null; return o;
}

/* ===== Endpoint ===== */
const out_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
function doGet() { return out_({ok: true, app: 'duado-snack-api', version: '1.9.8', time: now_()}); }
function doPost(e) {
  let req; try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ok: false, error: 'Permintaan tidak valid.'}); }
  return out_(api(req));
}
function api(req) {
  const T0 = Date.now(); // v1.9.9: waktu proses server dikirim balik (ms) agar kecepatan backend bisa diukur dari Diagnostik
  try {
    VERS_ = null; BUMP_ = null; // aman bila instans dipakai ulang antar permintaan
    schemaCheck_();
    const s = req.action === 'login' ? null : auth_(req.token), v0 = vers_(), data = route_(Object.assign({}, req, {payload: normNums_(req.payload || {})}), s), v1 = vers_();
    // ver_prev = versi tepat sebelum perubahan pertama permintaan ini (dibaca di dalam kunci). Bila perangkat lain menyela di antara perubahan, tidak dikirim, agar klien tidak mengira ia sudah mutakhir.
    const pv = BUMP_ ? (BUMP_.clean ? BUMP_.prev : {}) : v0;
    return {ok: true, data: data, ver: v1.cat_ver + '~' + v1.stock_ver, ver_prev: pv.cat_ver ? pv.cat_ver + '~' + pv.stock_ver : undefined, cat_ver: v1.cat_ver, cat_prev: pv.cat_ver, stock_ver: v1.stock_ver, stock_prev: pv.stock_ver, ms: Date.now() - T0};
  } catch (e) { return {ok: false, error: String((e && e.message) || e), retry: isTransient_(e), ms: Date.now() - T0}; }
}
function route_(r, s) {
  const p = r.payload || {};
  switch (r.action) {
    case 'login': return login_(p.username, p.pin, p.dev);
    case 'logout': return logout_(r.token);
    case 'ping': { const v = vers_(); return {ver: v.cat_ver + '~' + v.stock_ver, cat_ver: v.cat_ver, stock_ver: v.stock_ver, time: now_()}; }
    case 'stock.get': return stockGet_();
    case 'override.grant': return overrideGrant_(p, s);
    case 'shift.summary': return shiftSummary_(s);
    case 'shift.close': return shiftClose_(p, s);
    case 'shift.list': return shiftList_(s);
    case 'sale.recover': need_(s, 'owner'); return saleRecover_(p, s);
    case 'sale.detail': return saleDetail_(p, s);
    case 'sale.return': return saleReturn_(p, s);
    case 'sale.reject_log': return saleRejectLog_(p, s);
    case 'overhead.saran': need_(s, 'owner'); return overheadSuggest_();
    case 'user.unlock': need_(s, 'owner'); return unlockUser_(p, s);
    case 'audit.email': need_(s, 'owner'); return dailyAudit();
    case 'bootstrap': return bootstrap_(s);
    case 'sale.create': return saleCreate_(p, s);
    case 'sale.batch': return saleBatch_(p, s);
    case 'sales.list': return salesList_(p, s);
    case 'purchase.create': need_(s, 'owner'); return purchaseCreate_(p, s);
    case 'stock.adjust': need_(s, 'owner'); return stockAdjust_(p, s);
    case 'produk.foto': need_(s, 'owner'); return setFoto_(p, s.uid);
    case 'master.save': need_(s, 'owner'); chk_(p.table); return masterSave_(p, s);
    case 'master.remove': need_(s, 'owner'); chk_(p.table); return removeSafe_(p.table, p.id, s.uid);
    case 'sistem.refresh': need_(s, 'owner'); CACHED.concat(['product_variants']).forEach(bust_); bump_(); return {ok: true}; // setelah data diedit langsung di Google Sheets
    case 'sku.auto': need_(s, 'owner'); return skuAutoFill_(s);
    case 'addon.create': need_(s, 'owner'); return addonCreate_(p, s);
    case 'recipe.copy': need_(s, 'owner'); return recipeCopy_(p, s);
    case 'data.reset': need_(s, 'owner'); return dataReset_(p, s);
    case 'archive.status': need_(s, 'owner'); return archiveStatus_();
    case 'archive.run': need_(s, 'owner'); return archiveRun_(p, s);
    case 'stock.audit': need_(s, 'owner'); return stockAudit_();
    case 'stock.reconcile': need_(s, 'owner'); return stockReconcile_(p, s);
    case 'user.list': need_(s, 'owner'); return readAll_('users').map(u => ({id: u.id, nama: u.nama, username: u.username, role: u.role, aktif: u.aktif, terkunci: lockedNow_(u)}));
    case 'user.save': need_(s, 'owner'); return saveUser_(p, s.uid);
    case 'setting.get': return publicSettings_(s);
    case 'setting.logo': need_(s, 'owner'); return setLogo_(p, s.uid);
    case 'setting.setMany': need_(s, 'owner'); return setSettings_(p.values || {}, s.uid);
    case 'master.list': need_(s, 'owner'); chk_(p.table); return p.table === 'expenses' ? readAll_('expenses').slice(-300).reverse() : readAll_(p.table);
    case 'recipe.save': need_(s, 'owner'); return recipeSave_(p, s);
    case 'production.list': need_(s, 'owner'); return productionList_(p);
    case 'production.create': need_(s, 'owner'); return productionCreate_(p, s);
    case 'production.complete': need_(s, 'owner'); return productionComplete_(p, s);
    case 'production.cancel': need_(s, 'owner'); return productionCancel_(p, s);
    case 'dashboard.get': need_(s, 'owner'); return memo_('dash|' + (p.period || 'hari'), 300, () => dashboard_(p));
    case 'report.get': need_(s, 'owner'); return memo_('rep|' + p.type + '|' + (p.from || '') + '|' + (p.to || ''), 300, () => report_(p));
    case 'shopee.import': need_(s, 'owner'); return shopeeImport_(p, s);
    default: throw new Error('Aksi tidak dikenal: ' + r.action);
  }
}
function chk_(t) { if (MASTER.indexOf(t) < 0) throw new Error('Tabel tidak diizinkan: ' + t); }
function clean_(t, d) { const o = Object.assign({}, d); if (d.id && PROTECTED[t]) PROTECTED[t].forEach(k => delete o[k]); return o; }
function publicSettings_(s) { const o = {}; tbl_('settings').forEach(r => { if (s.role === 'owner' || PUBLIC_SETTINGS.indexOf(r.key) >= 0) o[r.key] = r.value; }); return o; }
const active_ = r => String(r.aktif) !== 'false';
function bootstrap_(s) { // hanya data aktif dan konsisten: varian milik produk aktif, harga milik varian dan channel aktif
  const vs = vers_(), owner = s.role === 'owner', products = tbl_('products').filter(active_), pIds = {}; products.forEach(p => pIds[p.id] = true);
  let variants = readAll_('product_variants').filter(v => active_(v) && pIds[v.product_id]); const vIds = {}; variants.forEach(v => vIds[v.id] = true);
  if (!owner) variants = variants.map(v => { delete v.hpp_rata2; return v; }); // Kasir tidak melihat HPP
  const channels = tbl_('channels').filter(active_), cIds = {}; channels.forEach(c => cIds[c.id] = true);
  const d = {ver: vs.cat_ver + '~' + vs.stock_ver, cat_ver: vs.cat_ver, stock_ver: vs.stock_ver, server_time: now_(), user: s, settings: publicSettings_(s), channels: channels, products: products, variants: variants,
    prices: tbl_('channel_prices').filter(x => vIds[x.variant_id] && cIds[x.channel_id])};
  if (owner) {
    d.materials = readAll_('materials').filter(active_); d.suppliers = tbl_('suppliers').filter(active_);
    const recs = tbl_('recipes').filter(r => active_(r) && vIds[r.variant_id]), rIds = {}; recs.forEach(r => rIds[r.id] = true);
    d.recipes = recs; d.recipe_items = tbl_('recipe_items').filter(i => rIds[i.recipe_id]);
  }
  return slimData_(d);
}
function slimData_(d) { // kecilkan muatan: kolom yang tidak dipakai aplikasi dibuang
  ['channels', 'products', 'variants', 'prices', 'materials', 'suppliers', 'recipes', 'recipe_items'].forEach(k => { if (d[k]) d[k].forEach(r => { delete r.created_at; delete r.updated_at; }); });
  return d;
}

/* ===== Penjualan (inti POS) =====
   Penulisan dua tahap: (1) baris penjualan berstatus "proses", lalu rincian item, mutasi, dan stok; (2) status diubah ke "selesai".
   Laporan hanya menghitung "selesai". Transaksi yang tersangkut di "proses" muncul di audit harian dan bisa diselesaikan/dibatalkan Owner. */
let SALES_LAST_ = -1; // baris terakhir sheet sales yang baru dibaca findSale_ (dipakai saleCore_ agar tidak membaca ulang)
function findSale_(rid, nmax) { // cari penjualan dengan request_id sama pada nmax baris terakhir; kolom request_id saja yang dibaca
  const sh = sh_('sales'), last = sh.getLastRow(); SALES_LAST_ = last; if (last < 2) return null;
  const n = Math.min(nmax || 2000, last - 1), first = last - n + 1, col = SCHEMA.sales.indexOf('request_id') + 1;
  const v = sh.getRange(first, col, n, 1).getValues();
  for (let k = n - 1; k >= 0; k--) if (v[k][0] === rid) return rowsAt_('sales', [first - 2 + k])[0];
  return null;
}
function dropEmptyProses_(ex) { // baris "proses" tanpa item dan tanpa mutasi: aman dibuang agar kiriman ulang bisa diproses normal
  const set = {}; set[ex.id] = 1;
  if (rowsByKey_('sale_items', 'sale_id', set).length || rowsByKey_('stock_movements', 'ref_id', set).length) return false;
  const ids = readCols_('sales', ['id']).id, i = ids.indexOf(ex.id); if (i < 0) return true;
  sh_('sales').deleteRow(i + 2); return true;
}
function clientTime_(ts, nowMs) { // waktu transaksi dari perangkat kasir; ditolak bila tidak masuk akal (jam HP salah)
  ts = Number(ts); if (!(ts > 0)) return null;
  if (ts > nowMs + 10 * 60000 || ts < nowMs - 14 * 86400000) return null;
  return Utilities.formatDate(new Date(ts), TZ, 'yyyy-MM-dd HH:mm:ss');
}
function allowedMethods_(set) { return ['tunai', 'transfer', 'qris'].filter(m => String(set['bayar_' + m] === undefined ? 'TRUE' : set['bayar_' + m]).toUpperCase() !== 'FALSE'); }
function setSaleStatus_(row, saleId, status, trusted) { // trusted: baris baru saja ditulis dalam kunci yang sama, tanpa verifikasi ulang
  const sh = sh_('sales'), sc = SCHEMA.sales.indexOf('status') + 1, ic = SCHEMA.sales.indexOf('id') + 1;
  if (row && trusted) { sh.getRange(row, sc).setValue(status); return; }
  if (row && sh.getRange(row, ic).getValue() === saleId) { sh.getRange(row, sc).setValue(status); return; }
  const i = readCols_('sales', ['id']).id.indexOf(saleId); if (i < 0) throw new Error('Baris penjualan tidak ditemukan.');
  sh.getRange(i + 2, sc).setValue(status);
}
/* Basis perhitungan fee channel: total (bawaan, termasuk PPN), subtotal (sebelum diskon), atau omzet (total - PPN). */
function feeBasis_(b, subtotal, total, ppn) { return b === 'subtotal' ? subtotal : b === 'omzet' ? total - ppn : total; }
function saleBatch_(p, s) { // beberapa transaksi tertunda dikirim sekaligus: SATU permintaan, tetapi kunci diambil per transaksi sehingga kasir lain bisa menyela di antaranya
  const list = p.sales || []; if (list.length > 15) throw new Error('Maksimal 15 transaksi per permintaan.');
  let busy = false;
  return list.map(x => {
    if (busy) return {ok: false, error: 'Server sedang sibuk. Akan dicoba lagi otomatis.', retry: true}; // kunci sudah penuh: sisanya tidak menunggu lagi (hindari melewati batas waktu eksekusi)
    try { if (!x.request_id) throw new Error('request_id wajib.'); return {ok: true, data: withLock_(() => saleCore_(x, s, {}), SALE_LOCK_MS_)}; }
    catch (e) { const r = isTransient_(e); if (e && e.retry) busy = true; return {ok: false, error: String((e && e.message) || e), retry: r}; }
  });
}
function saleCreate_(p, s) {
  if (!p.request_id) throw new Error('request_id wajib.');
  return withLock_(() => saleCore_(p, s, {}), SALE_LOCK_MS_);
}
function saleCore_(p, s, opt) { // dipanggil dari dalam withLock_; opt: {import, abaikanStok, tanggal}
  const cache = CacheService.getScriptCache(), nowMs = Date.now();
  const dup = cache.get('req_' + p.request_id); if (dup) return Object.assign({cached: true}, JSON.parse(dup));
  const ex = findSale_(p.request_id, opt.import ? 5000 : 2000), salesLast = ex ? -1 : SALES_LAST_; SALES_LAST_ = -1;
  if (ex) {
    if (ex.status !== 'proses') return {duplicate: true, sale: {id: ex.id, nomor: ex.nomor, tanggal: ex.tanggal, subtotal: num_(ex.subtotal), diskon: num_(ex.diskon), ppn_nominal: num_(ex.ppn_nominal), total: num_(ex.total)}};
    if (!dropEmptyProses_(ex)) throw new Error('Transaksi ' + ex.nomor + ' tersangkut setengah jalan (status proses). Minta Owner menyelesaikannya di Menu, Pemeriksaan data.');
  }
  const items = p.items || []; if (!items.length) throw new Error('Keranjang kosong.');
  const set = settingsMap_(), notes = [];
  let kasirId = s.uid, effRole = s.role; // Owner boleh mengirim antrean milik kasir lain atas nama kasir tersebut
  if (p.kasir_id && p.kasir_id !== s.uid) { need_(s, 'owner'); const ku = readAll_('users').find(u => u.id === p.kasir_id && String(u.aktif) !== 'false'); if (!ku) throw new Error('Kasir asal transaksi tidak ditemukan.'); kasirId = ku.id; effRole = ku.role; }
  const metode = String(p.metode_bayar || 'tunai').toLowerCase();
  if (!opt.import && allowedMethods_(set).indexOf(metode) < 0) throw new Error('Metode bayar "' + metode + '" tidak diizinkan.');
  const ch = tbl_('channels').find(c => c.id === p.channel_id && active_(c)); if (!ch) throw new Error('Channel tidak valid.');
  const prices = tbl_('channel_prices');
  const vsh = sh_('product_variants'), vv = vsh.getDataRange().getValues(), vh = vv[0], ci = k => vh.indexOf(k);
  const rowOf = {}; for (let i = 1; i < vv.length; i++) rowOf[vv[i][0]] = i;
  const lines = [], need = {}; let subtotal = 0;
  items.forEach(it => {
    const i = rowOf[it.variant_id]; if (i === undefined) throw new Error('Varian tidak ditemukan.');
    const r = vv[i], sku = r[ci('sku')], qty = Number(it.qty);
    if (String(r[ci('aktif')]) === 'false') throw new Error('Varian nonaktif: ' + sku);
    if (!(qty > 0)) throw new Error('Jumlah tidak valid: ' + sku);
    const pr = prices.find(x => x.variant_id === it.variant_id && x.channel_id === ch.id);
    const hOv = opt.import && it.harga !== undefined && it.harga !== null && it.harga !== '' ? Number(it.harga) : NaN;
    if (!pr && !(hOv >= 0)) throw new Error('Harga belum diatur: ' + sku + ' di ' + ch.nama);
    const harga = hOv >= 0 ? hOv : Number(pr.harga_jual);
    need[it.variant_id] = (need[it.variant_id] || 0) + qty;
    lines.push({variant_id: it.variant_id, qty: qty, harga: harga, hpp: Number(r[ci('hpp_rata2')]) || 0});
    subtotal += qty * harga;
  });
  // Blokir stok hanya berlaku di layar kasir. Server menerima penjualan yang sudah terjadi secara fisik, memberi tanda [STOK MINUS], dan membiarkan stok negatif tampil di dashboard agar dikoreksi lewat opname.
  const minus = [];
  if (isTrue_(set.blokir_stok_minus)) Object.keys(need).forEach(id => { const st = Number(vv[rowOf[id]][ci('stok')]) || 0; if (st < need[id]) minus.push({variant_id: id, sku: vv[rowOf[id]][ci('sku')], stok: st, jual: need[id]}); });
  if (minus.length) notes.push('[STOK MINUS: ' + minus.map(m => m.sku + ' stok ' + m.stok + ' terjual ' + m.jual).join('; ') + ']');
  const diskon = Math.min(Math.max(Number(p.diskon) || 0, 0), subtotal), base = subtotal - diskon, ov = p.override || {}, used = [];
  const maksPct = set.diskon_maks_persen === '' || isNaN(Number(set.diskon_maks_persen)) ? 100 : Number(set.diskon_maks_persen);
  if (!opt.import && effRole !== 'owner' && diskon > subtotal * maksPct / 100 + 0.5) { // kontrol kasir: diskon di atas batas butuh otorisasi Owner
    const o = overrideCheck_(ov.diskon, 'diskon', p.request_id, diskon);
    if (!o) throw new Error('Diskon Rp' + diskon + ' melebihi batas ' + maksPct + '% dari subtotal. Perlu otorisasi Owner.');
    used.push(ov.diskon); notes.push('[diskon di atas batas, disetujui owner ' + o.by + ']');
  }
  const pp = Number(set.ppn_persen) || 0, ppnOn = isTrue_(set.ppn_aktif) && pp > 0;
  let ppn = 0, total = base;
  if (ppnOn) { if (isTrue_(set.ppn_inklusif)) ppn = Math.round(base * pp / (100 + pp)); else { ppn = Math.round(base * pp / 100); total = base + ppn; } }
  const tk = p.total_klien === undefined || p.total_klien === null || p.total_klien === '' ? null : Number(p.total_klien);
  if (!opt.import && tk !== null && isFinite(tk) && Math.abs(tk - total) > 0.5) { // struk yang diterima pelanggan harus sama dengan data
    const msg = 'Total struk Rp' + tk + ' berbeda dari server Rp' + total + ' (harga atau pengaturan berubah).';
    if (isTrue_(set.tolak_selisih_total)) {
      const o = overrideCheck_(ov.selisih, 'selisih', p.request_id, 0);
      if (!o) throw new Error(msg + ' Perlu otorisasi Owner.');
      used.push(ov.selisih); notes.push('[selisih total struk Rp' + tk + ' vs server Rp' + total + ', disetujui owner ' + o.by + ']');
    } else notes.push('[PERINGATAN selisih total struk Rp' + tk + ' vs server Rp' + total + ']');
  }
  const fa = opt.feeAktual === undefined || opt.feeAktual === null || opt.feeAktual === '' ? NaN : Number(opt.feeAktual); // fee aktual dari laporan pencairan (impor), bila ada
  const fee = fa >= 0 ? Math.round(fa) : Math.round(feeBasis_(ch.basis_fee, subtotal, total, ppn) * (Number(ch.fee_persen) || 0) / 100) + (Number(ch.fee_tetap) || 0);
  const at = {}; // kapasitas disiapkan SEBELUM menulis; posisi tulis dipakai ulang sehingga baris terakhir tidak dibaca dua kali
  ['sales', 'sale_items', 'stock_movements'].forEach((t, i) => { const sh = sh_(t), last = t === 'sales' && salesLast >= 1 ? salesLast : sh.getLastRow(); at[t] = last + 1; ensureRows_(sh, t, last + (i ? lines.length : 1)); });
  const now = now_(), ct = opt.tanggal ? null : clientTime_(p.client_ts, nowMs), tgl = opt.tanggal || ct || now;
  if (!opt.import && p.client_ts && !ct) notes.push('[waktu perangkat tidak valid, dipakai waktu server]');
  const day = Utilities.formatDate(new Date(), TZ, 'yyMMdd'), seq = nextSeq_(day);
  const nomor = 'DS-' + day + '-' + ('00' + seq).slice(-3), saleId = id_(), catatan = [p.catatan || ''].concat(notes).join(' ').trim();
  // Tahap 1: tulis sebagai "proses"
  const saleRow = appendRows_('sales', [{id: saleId, nomor: nomor, request_id: p.request_id, tanggal: tgl, channel_id: ch.id, kasir_id: kasirId, subtotal: subtotal,
    diskon: diskon, fee_channel: fee, ppn_persen: ppnOn ? pp : 0, ppn_nominal: ppn, total: total, metode_bayar: metode,
    status: 'proses', catatan: catatan, created_at: now, updated_at: now, sync_at: now, total_klien: tk === null || !isFinite(tk) ? '' : tk}], at.sales);
  appendRows_('sale_items', lines.map(l => ({id: id_(), sale_id: saleId, variant_id: l.variant_id, qty: l.qty, harga: l.harga, hpp_snapshot: l.hpp})), at.sale_items);
  appendRows_('stock_movements', lines.map(l => ({id: id_(), tanggal: tgl, tipe: 'jual', item_tipe: 'varian', item_id: l.variant_id, qty: -l.qty, nilai: -l.qty * l.hpp, ref_id: saleId, user_id: kasirId})), at.stock_movements);
  const stok = {};
  const ids = Object.keys(need);
  ids.forEach(id => { const i = rowOf[id], n = r6_((Number(vv[i][ci('stok')]) || 0) - need[id]); vv[i][ci('stok')] = n; stok[id] = n; });
  if (ids.length === 1) vsh.getRange(rowOf[ids[0]] + 1, ci('stok') + 1).setValue(stok[ids[0]]);
  else vsh.getRange(2, ci('stok') + 1, vv.length - 1, 1).setValues(vv.slice(1).map(r => [r[ci('stok')]])); // beberapa varian: satu tulisan untuk kolom stok (kunci dipegang, tidak ada penulis lain)
  // Tahap 2: tandai selesai
  setSaleStatus_(saleRow, saleId, 'selesai', true);
  used.forEach(t => cache.remove('ov_' + t));
  const res = {sale: {id: saleId, nomor: nomor, tanggal: tgl, subtotal: subtotal, diskon: diskon, ppn_nominal: ppn, total: total}, stok: stok};
  if (notes.some(n => /PERINGATAN/.test(n))) res.peringatan = 'Total struk berbeda dari server.';
  if (minus.length) { res.stok_minus = minus; res.peringatan = (res.peringatan ? res.peringatan + ' ' : '') + 'Stok server kurang (' + minus.map(m => m.sku).join(', ') + '); transaksi tetap tercatat, mohon opname stok.'; }
  bump_('stok'); cache.put('req_' + p.request_id, JSON.stringify(res), 21600); return res;
}
/* Nomor urut harian. Berjalan di cache; Script Properties (lambat dan berkuota) hanya menyimpan CADANGAN berupa batas blok 10 nomor. Bila cache terbuang,
   penomoran lanjut dari cadangan (paling banyak ada loncatan nomor, tidak pernah nomor ganda). Penghitung hari lama dibersihkan saat hari baru dimulai. */
function nextSeq_(day) {
  const c = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties(), ck = 'seqc_' + day, rk = 'seqr_' + day, pk = 'seq_' + day;
  let n = c.get(ck), r = c.get(rk), fresh = false;
  if (n === null || r === null) { const pr = props.getProperty(pk); fresh = pr === null; r = pr === null ? 0 : Number(pr) || 0; n = r; } else { n = Number(n); r = Number(r); }
  n++;
  if (n > r) { r = n + 9; props.setProperty(pk, String(r)); if (fresh) props.getKeys().forEach(k => { if (k.indexOf('seq_') === 0 && k !== pk) props.deleteProperty(k); }); }
  const o = {}; o[ck] = String(n); o[rk] = String(r); c.putAll(o, 21600);
  return n;
}
function salesList_(p, s) {
  const day = p.tanggal || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const all = rowsByDate_('sales', 'tanggal', day, day).filter(o => s.role === 'owner' || o.kasir_id === s.uid).reverse();
  const lim = Math.min(Math.floor(Number(p.limit)) || 0, 500);
  if (!(lim > 0)) return all; // klien lama: semua baris sehari dalam satu larik
  const off = Math.max(Math.floor(Number(p.offset)) || 0, 0), done = all.filter(o => o.status === 'selesai'); // v1.9.9: paginasi server; ringkasan dihitung atas SEMUA transaksi hari itu
  return {rows: all.slice(off, off + lim), total: all.length, offset: off, summary: {omzet: done.reduce((a, o) => a + Number(o.total), 0), nTrx: done.filter(o => !o.ref_sale_id).length, nDone: done.length}};
}

/* ===== Inventory: pembelian (HPP rata-rata tertimbang) dan penyesuaian stok ===== */
function purchaseCreate_(p, s) {
  const items = p.items || []; if (!items.length) throw new Error('Daftar pembelian kosong.');
  return withLock_(() => {
    const msh = sh_('materials'), mv = msh.getDataRange().getValues(), mh = mv[0], ci = k => mh.indexOf(k);
    const rowOf = {}; for (let i = 1; i < mv.length; i++) rowOf[mv[i][0]] = i;
    const sumVal = items.reduce((a, it) => a + Number(it.qty) * Number(it.harga_satuan), 0);
    const ongkir = Math.max(Number(p.ongkir) || 0, 0), alok = p.alokasi_ongkir !== false;
    const now = now_(), pid = id_(), pitems = [], moves = [], upd = [];
    items.forEach(it => {
      const i = rowOf[it.material_id], qty = Number(it.qty), hs = Number(it.harga_satuan);
      if (i === undefined) throw new Error('Bahan tidak ditemukan.');
      if (!(qty > 0) || !(hs >= 0)) throw new Error('Jumlah atau harga tidak valid.');
      const eff = hs + (alok && sumVal > 0 ? ongkir * (qty * hs / sumVal) / qty : 0);
      const lama = Number(mv[i][ci('stok')]) || 0, hl = Number(mv[i][ci('hpp_rata2')]) || 0, baru = r6_(lama + qty);
      const hppBaru = Math.round((baru > 0 ? (lama * hl + qty * eff) / baru : eff) * 100) / 100;
      mv[i][ci('stok')] = baru; mv[i][ci('hpp_rata2')] = hppBaru;
      pitems.push({id: id_(), purchase_id: pid, material_id: it.material_id, qty: qty, harga_satuan: hs});
      moves.push({id: id_(), tanggal: now, tipe: 'beli', item_tipe: 'bahan', item_id: it.material_id, qty: qty, nilai: qty * eff, ref_id: pid, user_id: s.uid});
      upd.push({id: it.material_id, stok: baru, hpp_rata2: hppBaru});
    });
    upd.forEach(u => { const i = rowOf[u.id]; msh.getRange(i + 1, ci('stok') + 1, 1, 2).setValues([[u.stok, u.hpp_rata2]]); });
    appendRows_('purchases', [{id: pid, tanggal: now, supplier_id: p.supplier_id || '', total: sumVal + ongkir, ongkir: ongkir, catatan: p.catatan || '', user_id: s.uid, created_at: now, updated_at: now}]);
    appendRows_('purchase_items', pitems); appendRows_('stock_movements', moves);
    audit_(s.uid, 'purchase', 'purchases', null, {id: pid, total: sumVal + ongkir}); bump_();
    return {id: pid, total: sumVal + ongkir, materials: upd};
  });
}
function stockAdjust_(p, s) { // opname / stok awal; HPP awal opsional
  if (['bahan','varian'].indexOf(p.tipe) < 0) throw new Error('Tipe stok tidak valid.');
  const t = p.tipe === 'bahan' ? 'materials' : 'product_variants';
  return withLock_(() => {
    const sh = sh_(t), v = sh.getDataRange().getValues(), ci = k => v[0].indexOf(k), i = v.findIndex((r, n) => n > 0 && r[0] === p.id);
    if (i < 1) throw new Error('Item tidak ditemukan.');
    const lama = Number(v[i][ci('stok')]) || 0, baru = r6_(p.stok_baru); if (!(Number(p.stok_baru) >= 0)) throw new Error('Stok baru tidak valid.');
    let hpp = Number(v[i][ci('hpp_rata2')]) || 0;
    if (p.hpp !== undefined && p.hpp !== null && p.hpp !== '') { hpp = Number(p.hpp); if (!(hpp >= 0)) throw new Error('HPP tidak valid.'); }
    sh.getRange(i + 1, ci('stok') + 1, 1, 2).setValues([[baru, hpp]]);
    appendRows_('stock_movements', [{id: id_(), tanggal: now_(), tipe: 'opname', item_tipe: p.tipe, item_id: p.id, qty: baru - lama, nilai: (baru - lama) * hpp, ref_id: '', user_id: s.uid}]);
    audit_(s.uid, 'opname', t, {stok: lama}, {stok: baru, hpp: hpp, alasan: p.alasan || ''}); bump_();
    return {id: p.id, stok: baru, hpp_rata2: hpp};
  });
}

/** Lupa PIN owner? Jalankan fungsi ini dari editor Apps Script, lalu lihat PIN baru di Execution log.
 *  Isi PIN_BARU (4-8 angka) jika ingin menentukan sendiri; kosongkan untuk PIN acak. */
function resetOwnerPin() {
  const PIN_BARU = '';
  const pin = PIN_BARU || genPin_();
  const u = readAll_('users').find(r => r.username === 'owner');
  if (!u) throw new Error('User owner tidak ditemukan. Jalankan setup() terlebih dahulu.');
  saveUser_({id: u.id, nama: u.nama, username: u.username, role: 'owner', pin: pin, aktif: true}, 'system');
  CacheService.getScriptCache().remove('fail_owner'); PropertiesService.getScriptProperties().deleteProperty(lkKey_('owner')); // buka kunci akun jika sempat terkunci
  Logger.log('PIN owner baru -> username: owner | PIN: ' + pin);
}
