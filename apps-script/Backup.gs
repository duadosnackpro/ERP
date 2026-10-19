/* ===== Backup berlapis, verifikasi, uji restore, audit harian ke email =====
   Lapisan: (1) salinan Sheets harian/mingguan/bulanan di Drive, (2) ekspor .xlsx mingguan di Drive + dikirim ke email cadangan terpisah,
   (3) riwayat versi bawaan Google Sheets. Setiap backup diverifikasi, dan restore diuji otomatis tiap minggu pada salinan sementara. */
const BK_KEEP = {H: 30, M: 12, B: 12, X: 8};
const backupFolder_ = () => { const it = DriveApp.getFoldersByName('Duado Backup'); return it.hasNext() ? it.next() : DriveApp.createFolder('Duado Backup'); };
const backupNow_ = label => DriveApp.getFileById(db_().getId()).makeCopy('Backup ' + label, backupFolder_()).getUrl();
const reportTo_ = () => { const e = String(settingsMap_().email_laporan || '').trim(); return e || Session.getEffectiveUser().getEmail(); };
function notify_(subject, body, attach) {
  const o = {name: 'Duado POS'}; if (attach) o.attachments = [attach];
  try { MailApp.sendEmail(reportTo_(), subject, body, o); } catch (e) { Logger.log('Email gagal: ' + e); }
}
function countsOf_(ss) { const o = {}; Object.keys(SCHEMA).forEach(t => { const sh = ss.getSheetByName(t); o[t] = sh ? Math.max(sh.getLastRow() - 1, 0) : -1; }); return o; }
function verifyBackup_(file) { // salinan harus punya semua tabel dan jumlah baris tidak berbeda jauh dari data hidup
  const prob = []; let ss;
  try { ss = SpreadsheetApp.openById(file.getId()); } catch (e) { return {ok: false, problems: ['Salinan tidak bisa dibuka: ' + e]}; }
  const live = countsOf_(db_()), bk = countsOf_(ss);
  Object.keys(SCHEMA).forEach(t => {
    if (bk[t] < 0) { if (live[t] > 0) prob.push('Tabel hilang di salinan: ' + t); return; }
    if (live[t] - bk[t] > 20 || bk[t] > live[t] + 20) prob.push(t + ': hidup ' + live[t] + ' baris, salinan ' + bk[t]);
    const sh = ss.getSheetByName(t), hd = sh.getRange(1, 1, 1, SCHEMA[t].length).getValues()[0];
    if (hd.join('|') !== SCHEMA[t].join('|')) prob.push('Header tidak cocok: ' + t);
  });
  return {ok: !prob.length, problems: prob, rows: bk};
}
function prune_(folder, re, keep) {
  const fs = [], it = folder.getFiles(); while (it.hasNext()) { const f = it.next(); if (re.test(f.getName())) fs.push(f); }
  fs.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(keep).forEach(f => f.setTrashed(true));
}
function exportXlsx_(name) {
  const r = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + db_().getId() + '/export?format=xlsx', {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true});
  if (r.getResponseCode() !== 200) throw new Error('Ekspor xlsx gagal (HTTP ' + r.getResponseCode() + ')');
  return r.getBlob().setName(name + '.xlsx');
}
function dailyBackup() {
  const d = new Date(), day = Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), dow = Number(Utilities.formatDate(d, TZ, 'u')), dom = Number(Utilities.formatDate(d, TZ, 'd')), folder = backupFolder_(), log = [], props = PropertiesService.getScriptProperties();
  try {
    const src = DriveApp.getFileById(db_().getId()), tiers = [['H', 'Backup-H ' + day]];
    if (dow === 7) tiers.push(['M', 'Backup-M ' + day]); if (dom === 1) tiers.push(['B', 'Backup-B ' + day.slice(0, 7)]);
    tiers.forEach(t => { const f = src.makeCopy(t[1], folder), v = verifyBackup_(f); log.push(t[1] + ': ' + (v.ok ? 'terverifikasi' : 'MASALAH ' + v.problems.join('; '))); if (!v.ok) throw new Error(log.join('\n')); });
    if (dow === 7) { // lapisan ke-2: .xlsx di Drive dan salinan ke email cadangan (akun terpisah)
      const blob = exportXlsx_('Duado-' + day); folder.createFile(blob); log.push('xlsx tersimpan (' + Math.round(blob.getBytes().length / 1024) + ' KB)');
      const to = String(settingsMap_().backup_email || '').trim();
      if (to && blob.getBytes().length < 24 * 1024 * 1024) { MailApp.sendEmail(to, 'Backup mingguan Duado ' + day, 'Terlampir ekspor lengkap database (.xlsx).', {attachments: [blob], name: 'Duado POS'}); log.push('xlsx dikirim ke ' + to); }
      else if (to) log.push('xlsx terlalu besar untuk email; hanya di Drive');
    }
    prune_(folder, /^Backup(-H)? \d{4}-\d{2}-\d{2}$/, BK_KEEP.H); prune_(folder, /^Backup-M /, BK_KEEP.M); prune_(folder, /^Backup-B /, BK_KEEP.B); prune_(folder, /^Duado-\d{4}-\d{2}-\d{2}\.xlsx$/, BK_KEEP.X);
    props.setProperty('last_backup', JSON.stringify({waktu: now_(), ok: true, log: log}));
  } catch (e) {
    props.setProperty('last_backup', JSON.stringify({waktu: now_(), ok: false, log: log.concat(String(e))}));
    notify_('[Duado] BACKUP GAGAL ' + day, 'Backup harian gagal atau tidak lolos verifikasi:\n\n' + String(e) + '\n\nPeriksa Drive (kuota/izin) dan jalankan dailyBackup secara manual.'); throw e;
  }
}
function restoreDrill() { // uji restore: buka salinan terbaru, jalankan pemeriksaan dan simulasi pemakaian, lalu buang salinan uji
  const folder = backupFolder_(), fs = [], it = folder.getFiles(); while (it.hasNext()) { const f = it.next(); if (/^Backup-H /.test(f.getName())) fs.push(f); }
  if (!fs.length) { notify_('[Duado] UJI RESTORE GAGAL', 'Tidak ada file backup harian di folder "Duado Backup".'); return {ok: false}; }
  fs.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  const src = fs[0], tmp = src.makeCopy('UJI-RESTORE ' + now_(), folder), prevSS = SS_, res = {backup: src.getName(), problems: []};
  try {
    SS_ = SpreadsheetApp.openById(tmp.getId()); NOCACHE_ = true;
    const c = countsOf_(SS_); Object.keys(c).forEach(t => { if (c[t] < 0) res.problems.push('Tabel hilang: ' + t); });
    const a = stockAudit_(); res.selisih_stok = a.selisih.length; res.penjualan_proses = a.penjualan_proses.length; res.penjualan_tanpa_item = a.penjualan_tanpa_item.length;
    const b = bootstrap_({role: 'owner', uid: 'drill'}); res.produk = b.products.length; res.varian = b.variants.length; if (!b.channels.length) res.problems.push('Tidak ada channel aktif di salinan.');
    dashboard_({period: 'bulan'}); res.baris = c;
  } catch (e) { res.problems.push('Galat saat uji: ' + e); }
  finally { SS_ = prevSS; NOCACHE_ = false; try { tmp.setTrashed(true); } catch (e) {} }
  res.ok = res.problems.length === 0;
  PropertiesService.getScriptProperties().setProperty('last_drill', JSON.stringify({waktu: now_(), ok: res.ok}));
  notify_('[Duado] Uji restore ' + (res.ok ? 'LULUS' : 'GAGAL'), 'File diuji: ' + res.backup + '\nProduk: ' + res.produk + ', varian: ' + res.varian + '\nSelisih stok di salinan: ' + res.selisih_stok + '\nPenjualan "proses" di salinan: ' + res.penjualan_proses + '\n' + (res.problems.length ? 'MASALAH:\n- ' + res.problems.join('\n- ') : 'Tidak ada masalah.'));
  return res;
}
/* RESTORE NYATA: isi FILE_ID dengan ID file backup (dari URL Drive), lalu jalankan dari editor. Data hidup dicadangkan dulu; backup tidak ditimpa, melainkan disalin lalu dijadikan database aktif. */
function restoreFromBackup() {
  const FILE_ID = ''; if (!FILE_ID) throw new Error('Isi FILE_ID di dalam fungsi ini dengan ID file backup yang akan dipulihkan.');
  const props = PropertiesService.getScriptProperties(), old = props.getProperty('DB_ID'); backupNow_('sebelum restore ' + now_().replace(/[: ]/g, '-'));
  const copy = DriveApp.getFileById(FILE_ID).makeCopy('Duado Snack DB (restore ' + now_() + ')');
  props.setProperty('DB_ID_SEBELUM_RESTORE', old); props.setProperty('DB_ID', copy.getId()); props.deleteProperty('schema_ver'); SS_ = null;
  const c = CacheService.getScriptCache(); c.removeAll(['schema_ok', 't_variant_meta'].concat(CACHED.map(t => 't_' + t))); bump_();
  Logger.log('Restore selesai. Database aktif: ' + copy.getUrl() + '. Database sebelumnya (ID ' + old + ') tidak dihapus.');
}
function dailyAudit() { // laporan harian ke email: kesesuaian stok, transaksi tersangkut, selisih total, status backup
  const a = stockAudit_(), props = PropertiesService.getScriptProperties(), bk = JSON.parse(props.getProperty('last_backup') || '{}'), dr = JSON.parse(props.getProperty('last_drill') || '{}');
  const y = ymd_(new Date()), today = rowsByDate_('sales', 'tanggal', y, y).filter(s => s.status === 'selesai');
  const tolak = rowsByDate_('audit_log', 'waktu', addDays_(y, -1), y).filter(x => x.aksi === 'tolak_transaksi'), minus = readAll_('product_variants').filter(v => String(v.aktif) !== 'false' && num_(v.stok) < 0);
  const un = {}; readAll_('users').forEach(u => un[u.id] = u.nama); const lastFisik = {}, cl = [];
  readAll_('cash_closings').forEach(x => { const f = lastFisik[x.kasir_id]; lastFisik[x.kasir_id] = num_(x.uang_fisik); if (String(fmt_(x.sampai)).slice(0, 10) === y) cl.push({x: x, f: f, nama: un[x.kasir_id] || '-'}); });
  const kasSel = cl.filter(c => num_(c.x.selisih_tunai) !== 0), kasKeluar = cl.filter(c => num_(c.x.kas_keluar) > 0), modalBeda = cl.filter(c => c.f !== undefined && Math.abs(num_(c.x.modal_awal) - c.f) > 0.5);
  const issues = kasSel.length + a.selisih.length + a.penjualan_proses.length + a.penjualan_tanpa_item.length + a.selisih_total.length + tolak.length + (minus.length ? 1 : 0) + (bk.ok === false ? 1 : 0);
  const L = n => (arr, f) => arr.length ? arr.slice(0, 15).map(f).join('\n') : '-';
  const body = ['Audit harian ' + now_(), '', 'Penjualan hari ini: ' + today.filter(s => !s.ref_sale_id).length + ' transaksi' + (today.some(s => s.ref_sale_id) ? ', ' + today.filter(s => s.ref_sale_id).length + ' retur' : '') + ', omzet setelah retur Rp' + today.reduce((x, s) => x + num_(s.total), 0), '',
    'Selisih uang laci saat tutup kasir (' + kasSel.length + '):', L()(kasSel, c => '- ' + c.nama + ' ' + String(fmt_(c.x.sampai)).slice(11, 16) + ': selisih Rp' + num_(c.x.selisih_tunai) + ' (seharusnya Rp' + num_(c.x.tunai_diharapkan) + ', uang laci Rp' + num_(c.x.uang_fisik) + ')'), '',
    'Kas keluar tunai yang diisi kasir (' + kasKeluar.length + '), periksa kewajarannya:', L()(kasKeluar, c => '- ' + c.nama + ': Rp' + num_(c.x.kas_keluar) + (c.x.catatan ? ' (' + c.x.catatan + ')' : '')), '',
    'Modal awal berbeda dari sisa laci penutupan sebelumnya (' + modalBeda.length + '; wajar bila ada setoran):', L()(modalBeda, c => '- ' + c.nama + ': modal Rp' + num_(c.x.modal_awal) + ' vs sisa laci sebelumnya Rp' + c.f), '',
    'Stok tidak sesuai riwayat (' + a.selisih.length + '):', L()(a.selisih, x => '- ' + x.nama + ': stok ' + x.stok + ', riwayat ' + x.riwayat), '',
    'Penjualan tersangkut status "proses" (' + a.penjualan_proses.length + '):', L()(a.penjualan_proses, x => '- ' + x.nomor + ' ' + x.tanggal + ' Rp' + x.total), '',
    'Penjualan tanpa item (' + a.penjualan_tanpa_item.length + '):', L()(a.penjualan_tanpa_item, x => '- ' + x.nomor + ' ' + x.tanggal + ' Rp' + x.total), '',
    'Total struk berbeda dari server (' + a.selisih_total.length + '):', L()(a.selisih_total, x => '- ' + x.nomor + ': struk Rp' + x.total_klien + ' vs server Rp' + x.total), '',
    'Transaksi ditolak server lalu dihapus kasir, 2 hari terakhir (' + tolak.length + '):', L()(tolak, x => '- ' + x.waktu + ' ' + String(x.sesudah).slice(0, 150)), '',
    'Produk jadi dengan stok minus (' + minus.length + '): ' + (minus.length ? minus.slice(0, 10).map(v => v.sku + ' ' + v.stok).join(', ') : '-'), '',
    'Backup terakhir: ' + (bk.waktu || 'belum ada') + ' ' + (bk.ok === false ? 'GAGAL' : 'ok'), 'Uji restore terakhir: ' + (dr.waktu || 'belum pernah') + ' ' + (dr.ok === false ? 'GAGAL' : dr.ok ? 'lulus' : ''), '',
    issues ? 'Tindak lanjut: buka aplikasi, Menu, Pemeriksaan data.' : 'Tidak ada temuan.'].concat(a.peringatan ? ['', 'Catatan: ' + a.peringatan] : []).join('\n');
  try { backfillTglLoop_(); } catch (e) { console.warn('Isi tgl gagal: ' + e); } // melanjutkan pengisian kolom tgl data lama bila belum selesai (diam bila sudah)
  notify_('[Duado] ' + (issues ? 'PERLU PERHATIAN (' + issues + ' temuan)' : 'Audit harian OK'), body); return {temuan: issues};
}
function isiTglLama() { // fungsi publik (bisa dipilih di menu Run editor): mempercepat pengisian kolom tgl data lama setelah pembaruan; aman diulang
  backfillTglLoop_(); const left = withLock_(() => backfillTgl_(0));
  Logger.log(left ? 'Masih ada sekitar ' + left + ' baris tgl kosong; jalankan sekali lagi (atau biarkan audit harian 06:00 melanjutkan).' : 'Selesai: semua tgl terisi.');
}
function installTriggers() { // jalankan sekali (dan setelah memperbarui kode): backup 02:00, arsip tgl 1, audit 06:00, uji restore Minggu 04:00
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).inTimezone(TZ).create();
  ScriptApp.newTrigger('monthlyArchive').timeBased().onMonthDay(1).atHour(3).inTimezone(TZ).create();
  ScriptApp.newTrigger('dailyAudit').timeBased().everyDays(1).atHour(6).inTimezone(TZ).create();
  ScriptApp.newTrigger('restoreDrill').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).inTimezone(TZ).create();
}
