/* ===== Kontrol kasir: tutup kasir (rekap shift), retur/void, log penolakan, dan pemulihan transaksi yang tersangkut ===== */
function lastClosingRow_(uid) {
  const c = readCols_('cash_closings', ['kasir_id', 'sampai']); let best = '', bi = -1;
  for (let i = 0; i < c.kasir_id.length; i++) if (c.kasir_id[i] === uid) { const x = String(fmt_(c.sampai[i])); if (x >= best) { best = x; bi = i; } }
  return bi < 0 ? null : rowsAt_('cash_closings', [bi])[0];
}
function lastClosing_(uid) { const r = lastClosingRow_(uid); return r ? String(fmt_(r.sampai)) : ''; }
/* Rekap shift berbasis PENANDA, bukan jam perangkat: setiap penjualan yang masuk penutupan diberi closing_id, sehingga tidak ada transaksi yang
   terlewat atau terhitung dua kali walau jam HP kasir bergeser. Batas bawah (lantai) hanya melindungi data lama sebelum penanda ada. */
function shiftOpen_(uid) {
  const c = readCols_('sales', ['kasir_id', 'status', 'closing_id', 'sync_at', 'tanggal']), floor = lastClosing_(uid) || now_().slice(0, 10) + ' 00:00:00', idx = [];
  for (let i = 0; i < c.kasir_id.length; i++) {
    if (c.kasir_id[i] !== uid || c.status[i] !== 'selesai' || c.closing_id[i]) continue;
    if (String(fmt_(c.sync_at[i] || c.tanggal[i])) >= floor) idx.push(i);
  }
  return {idx: idx, floor: floor};
}
function shiftTotals_(uid) {
  const o = shiftOpen_(uid), rows = rowsAt_('sales', o.idx), per = {tunai: 0, transfer: 0, qris: 0, lain: 0}; let total = 0, n = 0, retur = 0;
  rows.forEach(x => {
    const m = per[x.metode_bayar] !== undefined ? x.metode_bayar : 'lain'; per[m] += num_(x.total); total += num_(x.total);
    if (x.ref_sale_id) retur += -num_(x.total); else n++;
  });
  return {idx: o.idx, dari: o.floor, jumlah_trx: n, tunai: per.tunai, transfer: per.transfer, qris: per.qris, lain: per.lain, total: total, retur: retur};
}
function markClosing_(idx, closingId) { // tulis closing_id per blok baris berurutan (sedikit panggilan Sheets)
  if (!idx.length) return;
  const sh = sh_('sales'), col = SCHEMA.sales.indexOf('closing_id') + 1, ix = idx.slice().sort((a, b) => a - b); let i = 0;
  while (i < ix.length) { let j = i; while (j + 1 < ix.length && ix[j + 1] === ix[j] + 1) j++; sh.getRange(ix[i] + 2, col, j - i + 1, 1).setValues(ix.slice(i, j + 1).map(() => [closingId])); i = j + 1; }
}
function shiftSummary_(s) { // HITUNG BUTA: nominal sengaja tidak ditampilkan sebelum kasir mengisi uang laci
  const t = shiftTotals_(s.uid), last = lastClosingRow_(s.uid);
  return {dari: t.dari, sampai: now_(), jumlah_trx: t.jumlah_trx, modal_terakhir: last ? num_(last.modal_awal) : 0};
}
function shiftClose_(p, s) {
  const fisik = Number(p.uang_fisik); if (!(fisik >= 0) || p.uang_fisik === '' || p.uang_fisik === null || p.uang_fisik === undefined) throw new Error('Isi jumlah uang tunai di laci (0 atau lebih).');
  const modal = Number(p.modal_awal) || 0, keluar = Number(p.kas_keluar) || 0; if (modal < 0 || keluar < 0) throw new Error('Modal awal dan kas keluar tidak boleh negatif.');
  return withLock_(() => {
    const t = shiftTotals_(s.uid), sampai = now_(), diharap = modal + t.tunai - keluar, selisih = fisik - diharap;
    const rec = saveRaw_('cash_closings', {kasir_id: s.uid, dari: t.dari, sampai: sampai, jumlah_trx: t.jumlah_trx, total_tunai: t.tunai, total_transfer: t.transfer,
      total_qris: t.qris, total_lain: t.lain, total_semua: t.total, uang_fisik: fisik, selisih_tunai: selisih, catatan: String(p.catatan || '').slice(0, 200),
      modal_awal: modal, kas_keluar: keluar, tunai_diharapkan: diharap}, s.uid);
    markClosing_(t.idx, rec.id); bump_('stok');
    return {id: rec.id, dari: t.dari, sampai: sampai, jumlah_trx: t.jumlah_trx, tunai: t.tunai, transfer: t.transfer, qris: t.qris, lain: t.lain, total: t.total, retur: t.retur,
      modal_awal: modal, kas_keluar: keluar, tunai_diharapkan: diharap, uang_fisik: fisik, selisih_tunai: selisih};
  });
}
function shiftList_(s) {
  const nm = {}, prev = {}, all = readAll_('cash_closings'); readAll_('users').forEach(u => nm[u.id] = u.nama);
  all.forEach(x => { x.fisik_sebelumnya = prev[x.kasir_id] === undefined ? null : prev[x.kasir_id]; prev[x.kasir_id] = num_(x.uang_fisik); }); // sisa laci penutupan sebelumnya, pembanding modal awal
  return all.filter(x => s.role === 'owner' || x.kasir_id === s.uid).slice(-30).reverse().map(x => Object.assign(x, {kasir: nm[x.kasir_id] || '-'}));
}

/* ===== Retur / void. Tidak pernah mengubah transaksi lama: retur dicatat sebagai transaksi baru bernilai NEGATIF (ref_sale_id = transaksi asal), tanggal hari retur,
   stok kembali lewat mutasi bertipe "retur". Omzet, HPP, laporan, dan rekap shift otomatis ikut berkurang; periode yang sudah ditutup tidak berubah. ===== */
function returnState_(sale) { // jumlah terjual, sudah diretur, dan sisa per varian
  const c = readCols_('sales', ['id', 'ref_sale_id', 'status']), pidx = [];
  for (let i = 0; i < c.id.length; i++) if (c.ref_sale_id[i] === sale.id && c.status[i] === 'selesai') pidx.push(i);
  const prior = rowsAt_('sales', pidx), set = {}; set[sale.id] = 1; prior.forEach(r => set[r.id] = 1);
  const agg = {}, order = [];
  rowsByKey_('sale_items', 'sale_id', set).forEach(it => {
    let a = agg[it.variant_id]; if (!a) { a = agg[it.variant_id] = {jual: 0, kembali: 0, nilai: 0, hppn: 0}; order.push(it.variant_id); }
    const q = num_(it.qty); if (it.sale_id === sale.id) { a.jual += q; a.nilai += q * num_(it.harga); a.hppn += q * num_(it.hpp_snapshot); } else a.kembali += -q;
  });
  return {prior: prior, lines: order.map(id => { const a = agg[id]; return {variant_id: id, jual: r6_(a.jual), kembali: r6_(a.kembali), sisa: r6_(a.jual - a.kembali), harga: a.jual ? a.nilai / a.jual : 0, hpp: a.jual ? a.hppn / a.jual : 0}; })};
}
function saleDetail_(p, s) {
  const i = readCols_('sales', ['id']).id.indexOf(p.id); if (i < 0) throw new Error('Penjualan tidak ditemukan.');
  const sale = rowsAt_('sales', [i])[0]; if (s.role !== 'owner' && sale.kasir_id !== s.uid) throw new Error('Akses ditolak.');
  return {sale: sale, items: sale.ref_sale_id ? [] : returnState_(sale).lines};
}
function saleReturn_(p, s) {
  const rid = String(p.request_id || ''); if (!rid) throw new Error('request_id wajib.');
  // Kirim ulang (koneksi putus) harus dikenali sebagai duplikat SEBELUM memeriksa otorisasi, karena token sekali pakai sudah terpakai pada percobaan pertama.
  const dup0 = CacheService.getScriptCache().get('req_' + rid); if (dup0) return Object.assign({cached: true}, JSON.parse(dup0));
  const ex0 = findSale_(rid, 2000); if (ex0) return {duplicate: true, sale: {id: ex0.id, nomor: ex0.nomor, tanggal: ex0.tanggal, total: num_(ex0.total)}};
  const alasan = String(p.alasan || '').trim(); if (alasan.length < 3) throw new Error('Alasan retur wajib diisi.');
  let approver = s.uid; // kasir butuh otorisasi Owner (PIN sekali pakai terikat ke transaksi retur ini)
  if (s.role !== 'owner') { const o = overrideCheck_(p.override_token, 'retur', rid, 0); if (!o) throw new Error('Retur oleh kasir perlu otorisasi Owner.'); approver = o.by; }
  return withLock_(() => {
    const cache = CacheService.getScriptCache(), dup = cache.get('req_' + rid); if (dup) return Object.assign({cached: true}, JSON.parse(dup));
    const ex = findSale_(rid, 2000); if (ex) return {duplicate: true, sale: {id: ex.id, nomor: ex.nomor, tanggal: ex.tanggal, total: num_(ex.total)}};
    const oi = readCols_('sales', ['id']).id.indexOf(p.id); if (oi < 0) throw new Error('Penjualan asal tidak ditemukan.');
    const orig = rowsAt_('sales', [oi])[0];
    if (orig.status !== 'selesai') throw new Error('Hanya transaksi selesai yang bisa diretur.');
    if (orig.ref_sale_id) throw new Error('Transaksi retur tidak bisa diretur lagi.');
    const st = returnState_(orig), byV = {}; st.lines.forEach(l => byV[l.variant_id] = l);
    const want = {}; (p.semua ? st.lines.filter(l => l.sisa > 0).map(l => ({variant_id: l.variant_id, qty: l.sisa})) : (p.items || [])).forEach(r => { const q = Number(r.qty); if (!(q > 0)) return; want[r.variant_id] = r6_((want[r.variant_id] || 0) + q); });
    const req = Object.keys(want).map(id => ({variant_id: id, qty: want[id]})); if (!req.length) throw new Error('Pilih minimal satu item yang diretur.');
    req.forEach(r => { const l = byV[r.variant_id]; if (!l) throw new Error('Item tidak ada di transaksi asal.'); if (r.qty > l.sisa + 0.0001) throw new Error('Jumlah retur melebihi sisa yang bisa diretur (sisa ' + l.sisa + ').'); });
    const sub0 = num_(orig.subtotal), dis0 = num_(orig.diskon), ppn0 = num_(orig.ppn_nominal), tot0 = num_(orig.total), fee0 = num_(orig.fee_channel);
    const excl = ppn0 > 0 && Math.abs(tot0 - (sub0 - dis0)) > 0.5, reqOf = {}; req.forEach(r => reqOf[r.variant_id] = r.qty);
    const finalRet = st.lines.every(l => Math.abs(l.sisa - (reqOf[l.variant_id] || 0)) < 0.0001);
    let subR, disR, ppnR, totR, feeR;
    if (finalRet) { // sisa terakhir: ambil sisa nilai agar jumlah seluruh retur persis menghapus transaksi asal (tanpa selisih pembulatan)
      const sum = k => st.prior.reduce((a, x) => a + Math.abs(num_(x[k])), 0);
      subR = sub0 - sum('subtotal'); disR = dis0 - sum('diskon'); ppnR = ppn0 - sum('ppn_nominal'); totR = tot0 - sum('total'); feeR = fee0 - sum('fee_channel');
    } else {
      const bruto = req.reduce((a, r) => a + r.qty * byV[r.variant_id].harga, 0), f = sub0 > 0 ? bruto / sub0 : 0;
      subR = Math.round(bruto); disR = Math.round(dis0 * f); ppnR = Math.round(ppn0 * f); feeR = Math.round(fee0 * f); totR = (subR - disR) + (excl ? ppnR : 0);
    }
    const vsh = sh_('product_variants'), vv = vsh.getDataRange().getValues(), vh = vv[0], ci = k => vh.indexOf(k), rowOf = {}; for (let i = 1; i < vv.length; i++) rowOf[vv[i][0]] = i;
    req.forEach(r => { if (rowOf[r.variant_id] === undefined) throw new Error('Varian sudah tidak ada di data master.'); });
    ['sales', 'sale_items', 'stock_movements'].forEach((t, i) => ensureRows_(sh_(t), t, sh_(t).getLastRow() + (i ? req.length : 1)));
    const now = now_(), day = Utilities.formatDate(new Date(), TZ, 'yyMMdd'), props = PropertiesService.getScriptProperties();
    const seq = (Number(props.getProperty('seqr_' + day)) || 0) + 1; props.setProperty('seqr_' + day, String(seq));
    if (seq === 1) props.getKeys().forEach(k => { if (k.indexOf('seqr_') === 0 && k !== 'seqr_' + day) props.deleteProperty(k); });
    const nomor = 'RT-' + day + '-' + ('00' + seq).slice(-3), saleId = id_();
    const row = appendRows_('sales', [{id: saleId, nomor: nomor, request_id: rid, tanggal: now, channel_id: orig.channel_id, kasir_id: s.uid, subtotal: -subR, diskon: -disR, fee_channel: -feeR,
      ppn_persen: orig.ppn_persen, ppn_nominal: -ppnR, total: -totR, metode_bayar: orig.metode_bayar, status: 'proses', catatan: ('RETUR ' + orig.nomor + ': ' + alasan).slice(0, 300),
      created_at: now, updated_at: now, sync_at: now, ref_sale_id: orig.id}]);
    appendRows_('sale_items', req.map(r => ({id: id_(), sale_id: saleId, variant_id: r.variant_id, qty: -r.qty, harga: byV[r.variant_id].harga, hpp_snapshot: byV[r.variant_id].hpp})));
    appendRows_('stock_movements', req.map(r => ({id: id_(), tanggal: now, tipe: 'retur', item_tipe: 'varian', item_id: r.variant_id, qty: r.qty, nilai: r.qty * byV[r.variant_id].hpp, ref_id: saleId, user_id: s.uid})));
    const stok = {}; req.forEach(r => { const k = rowOf[r.variant_id], n = r6_((Number(vv[k][ci('stok')]) || 0) + r.qty); vsh.getRange(k + 1, ci('stok') + 1).setValue(n); stok[r.variant_id] = n; });
    setSaleStatus_(row, saleId, 'selesai');
    audit_(s.uid, 'retur', 'sales', {id: orig.id, nomor: orig.nomor}, {nomor: nomor, total: -totR, alasan: alasan, item: req.map(r => r.variant_id + ' x' + r.qty), disetujui: approver});
    if (p.override_token) cache.remove('ov_' + p.override_token);
    const res = {sale: {id: saleId, nomor: nomor, tanggal: now, subtotal: -subR, diskon: -disR, ppn_nominal: -ppnR, total: -totR}, refund: totR, metode: orig.metode_bayar, stok: stok};
    bump_('stok'); cache.put('req_' + rid, JSON.stringify(res), 21600); return res;
  });
}

/* Transaksi di antrean perangkat yang ditolak server lalu dihapus kasir: kirim catatannya agar uang yang sudah diterima tetap punya jejak (audit_log dan email harian). */
function saleRejectLog_(p, s) {
  const rid = String(p.request_id || ''); if (!rid) throw new Error('request_id wajib.');
  return withLock_(() => {
    if (findSale_(rid, 2000)) throw new Error('Transaksi ini sudah tercatat di server. Tekan Coba lagi, jangan dihapus.');
    audit_(s.uid, 'tolak_transaksi', 'sales', null, {request_id: rid, total: Number(p.total) || 0, metode: String(p.metode || '').slice(0, 20), channel: String(p.channel || '').slice(0, 40), waktu: String(p.waktu || '').slice(0, 20),
      item: (p.items || []).slice(0, 20).map(i => String(i.sku || i.variant_id || '?') + ' x' + (Number(i.qty) || 0)), galat: String(p.error || '').slice(0, 200), alasan: String(p.alasan || '').slice(0, 200)});
    return {logged: true};
  });
}
/* Transaksi berstatus "proses" yang tersangkut: Owner memilih menyelesaikan atau membatalkan. Stok disesuaikan hanya bila belum terpotong
   (dideteksi dari kesesuaian kolom stok dengan riwayat mutasi), sehingga tidak pernah terpotong dua kali. */
function saleRecover_(p, s) {
  if (['selesai', 'batal'].indexOf(p.aksi) < 0) throw new Error('Aksi tidak valid.');
  return withLock_(() => {
    const i = readCols_('sales', ['id']).id.indexOf(p.id); if (i < 0) throw new Error('Penjualan tidak ditemukan.');
    const sale = rowsAt_('sales', [i])[0]; if (sale.status !== 'proses') throw new Error('Transaksi ini tidak berstatus proses.');
    const set = {}; set[sale.id] = 1;
    const items = rowsByKey_('sale_items', 'sale_id', set), mv = rowsByKey_('stock_movements', 'ref_id', set).filter(m => m.tipe === 'jual' || m.tipe === 'retur'), led = stockLedger_();
    const qtyOf = {}; mv.forEach(m => qtyOf[m.item_id] = (qtyOf[m.item_id] || 0) - num_(m.qty)); // jumlah terjual per varian menurut mutasi
    const vsh = sh_('product_variants'), vv = vsh.getDataRange().getValues(), vc = k => vv[0].indexOf(k), rowOf = {}; for (let r = 1; r < vv.length; r++) rowOf[vv[r][0]] = r;
    const applied = id => Math.abs(r6_(num_(vv[rowOf[id]][vc('stok')]) - (led['varian|' + id] || 0))) < 0.0001; // stok sudah mencerminkan mutasi ini?
    if (p.aksi === 'selesai') {
      const want = {}; items.forEach(it => want[it.variant_id] = (want[it.variant_id] || 0) + num_(it.qty));
      Object.keys(want).forEach(id => { if (Math.abs((qtyOf[id] || 0) - want[id]) > 0.0001) throw new Error('Data transaksi tidak lengkap (mutasi stok kurang). Pilih Batalkan.'); });
      if (!items.length) throw new Error('Transaksi tidak punya item. Pilih Batalkan.');
      Object.keys(want).forEach(id => { if (rowOf[id] !== undefined && !applied(id)) vsh.getRange(rowOf[id] + 1, vc('stok') + 1).setValue(r6_(num_(vv[rowOf[id]][vc('stok')]) - want[id])); });
      setSaleStatus_(0, sale.id, 'selesai'); sh_('sales').getRange(i + 2, SCHEMA.sales.indexOf('sync_at') + 1).setValue(now_()); // masuk rekap shift berikutnya
    } else {
      const rev = [];
      Object.keys(qtyOf).forEach(id => {
        if (rowOf[id] !== undefined && applied(id)) vsh.getRange(rowOf[id] + 1, vc('stok') + 1).setValue(r6_(num_(vv[rowOf[id]][vc('stok')]) + qtyOf[id]));
        rev.push({id: id_(), tanggal: now_(), tipe: 'batal', item_tipe: 'varian', item_id: id, qty: qtyOf[id], nilai: 0, ref_id: sale.id, user_id: s.uid});
      });
      appendRows_('stock_movements', rev); setSaleStatus_(0, sale.id, 'batal');
    }
    audit_(s.uid, 'pulihkan_penjualan', 'sales', {id: sale.id, status: 'proses'}, {aksi: p.aksi, nomor: sale.nomor}); bump_('stok');
    return {id: sale.id, status: p.aksi};
  });
}
