/* ===== Pengarsipan data lama: memindahkan baris lama ke spreadsheet arsip per tahun agar database utama tetap ringan ===== */
const ARCH = [
  {t: 'sales', date: 'tanggal', kids: [['sale_items', 'sale_id']]},
  {t: 'purchases', date: 'tanggal', kids: [['purchase_items', 'purchase_id']]},
  {t: 'production_orders', date: 'tanggal', kids: [['production_costs', 'production_id']], skip: r => r.status === 'rencana'},
  {t: 'expenses', date: 'tanggal'},
  {t: 'audit_log', date: 'waktu'},
  {t: 'stock_movements', date: 'tanggal', saldo: true} // diringkas menjadi saldo agar stok tetap cocok dengan riwayat
];
function archCutoff_() { const m = Number(settingsMap_().arsip_bulan) || 13, d = new Date(); d.setMonth(d.getMonth() - m); return ymd_(d); }
function ensureSheet_(ss, t) { const sh = ss.getSheetByName(t) || ss.insertSheet(t); if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, SCHEMA[t].length).setValues([SCHEMA[t]]).setFontWeight('bold'); return sh; }
function archiveSS_(year) {
  const props = PropertiesService.getScriptProperties(), key = 'ARCH_' + year, id = props.getProperty(key);
  let ss; if (id) ss = SpreadsheetApp.openById(id); else { ss = SpreadsheetApp.create('Duado Snack Arsip ' + year); props.setProperty(key, ss.getId()); }
  ARCH.forEach(a => { ensureSheet_(ss, a.t); (a.kids || []).forEach(k => ensureSheet_(ss, k[0])); });
  const d = ss.getSheetByName('Sheet1'); if (d && ss.getSheets().length > 1) ss.deleteSheet(d); return ss;
}
function deleteIdx_(sh, idxs) { // idxs: indeks 0-based pada array data (header = 0); hapus per blok berurutan dari bawah
  if (sh.getMaxRows() - sh.getLastRow() < 2) sh.insertRowsAfter(sh.getMaxRows(), 5); // Sheets menolak menghapus SEMUA baris tidak beku; sisakan baris kosong
  const rows = idxs.map(i => i + 1).sort((a, b) => b - a); let i = 0;
  while (i < rows.length) { let j = i; while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++; sh.deleteRows(rows[j], j - i + 1); i = j + 1; }
}
function appendArchive_(ss, t, rows, width) {
  const ash = ss.getSheetByName(t), before = ash.getLastRow(); if (!rows.length) return; ensureRows_(ash, t, before + rows.length);
  ash.getRange(before + 1, 1, rows.length, width).setValues(rows);
  if (ash.getLastRow() !== before + rows.length) throw new Error('Verifikasi arsip gagal pada tabel ' + t + '; data utama tidak diubah.'); // salin dulu, verifikasi, baru hapus
}
function archiveTable_(a, cutoff, dry, out) { // diproses di dalam kunci; satu tabel (beserta anaknya) per kunci
  const sh = sh_(a.t), v = sh.getDataRange().getValues(); if (v.length < 2) { out.tabel[a.t] = 0; return; }
  const h = v[0], di = h.indexOf(a.date), ii = h.indexOf('id'), si = h.indexOf('status'), old = [];
  for (let i = 1; i < v.length; i++) { const d = String(fmt_(v[i][di])).slice(0, 10); if (d && d < cutoff && !(a.skip && a.skip({status: si >= 0 ? v[i][si] : ''}))) old.push(i); }
  out.tabel[a.t] = old.length; if (dry || !old.length) return;
  const yearOf = {}, byYear = {}; old.forEach(i => { const y = String(fmt_(v[i][di])).slice(0, 4); yearOf[v[i][ii]] = y; (byYear[y] = byYear[y] || []).push(i); });
  Object.keys(byYear).forEach(y => { const ss = archiveSS_(y); appendArchive_(ss, a.t, byYear[y].map(i => v[i].map(fmt_)), h.length); out.urls[y] = ss.getUrl(); });
  (a.kids || []).forEach(k => {
    const ksh = sh_(k[0]), kv = ksh.getDataRange().getValues(), kh = kv[0], pi = kh.indexOf(k[1]), kold = [], kyear = {};
    for (let i = 1; i < kv.length; i++) { const y = yearOf[kv[i][pi]]; if (y) { kold.push(i); (kyear[y] = kyear[y] || []).push(i); } }
    Object.keys(kyear).forEach(y => appendArchive_(archiveSS_(y), k[0], kyear[y].map(i => kv[i].map(fmt_)), kh.length));
    deleteIdx_(ksh, kold); out.tabel[k[0]] = kold.length;
  });
  let saldo = null;
  if (a.saldo) { const sums = {}; old.forEach(i => { const key = v[i][h.indexOf('item_tipe')] + '|' + v[i][h.indexOf('item_id')], x = sums[key] = sums[key] || {qty: 0, nilai: 0}; x.qty += num_(v[i][h.indexOf('qty')]); x.nilai += num_(v[i][h.indexOf('nilai')]); }); saldo = sums; }
  deleteIdx_(sh, old);
  if (saldo) appendRows_('stock_movements', Object.keys(saldo).map(k => { const [it, id] = k.split('|'); return {id: id_(), tanggal: cutoff + ' 00:00:00', tipe: 'arsip', item_tipe: it, item_id: id, qty: r6_(saldo[k].qty), nilai: saldo[k].nilai, ref_id: 'arsip<=' + cutoff, user_id: 'system'}; }));
}
function archiveRun_(p, s) {
  const dry = !!p.dry, cutoff = archCutoff_(), t0 = Date.now(), out = {cutoff: cutoff, tabel: {}, urls: {}, sebagian: false};
  for (const a of ARCH) {
    if (Date.now() - t0 > 240000) { out.sebagian = true; break; } // batas waktu Apps Script 6 menit: lanjutkan pada jalankan berikutnya
    withLock_(() => archiveTable_(a, cutoff, dry, out)); // kunci dilepas di antara tabel agar transaksi kasir tidak tertahan lama
  }
  if (!dry) withLock_(() => { audit_(s && s.uid || 'system', 'arsip', 'archive', null, out); if (Object.keys(out.urls).length) bump_(); }); // data lama berpindah: hasil laporan yang di-cache harus dihitung ulang
  return out;
}
function archiveStatus_() {
  let cells = 0; const rows = [];
  Object.keys(SCHEMA).forEach(t => { const sh = sh_(t); cells += sh.getMaxRows() * sh.getMaxColumns(); rows.push({tabel: t, baris: Math.max(sh.getLastRow() - 1, 0)}); });
  const dry = archiveRun_({dry: true}, {uid: 'system'}), kandidat = Object.keys(dry.tabel).filter(t => dry.tabel[t] > 0).map(t => ({tabel: t, baris: dry.tabel[t]}));
  return {cutoff: dry.cutoff, bulan: Number(settingsMap_().arsip_bulan) || 13, sel: cells, batas: 10000000, persen: Math.round(cells / 100000) / 10, tabel: rows.sort((a, b) => b.baris - a.baris).slice(0, 8), kandidat: kandidat};
}
function monthlyArchive() { try { archiveRun_({}, {uid: 'system'}); } catch (e) { Logger.log('Arsip gagal: ' + e); } }
