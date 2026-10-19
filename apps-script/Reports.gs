/* ===== Dashboard dan laporan (hanya Owner). Omzet = total - PPN. Laba kotor = omzet - HPP snapshot. ===== */
/* lastRows_ hanya untuk daftar singkat (mis. produksi terbaru). JANGAN dipakai untuk laporan: akan memotong data lama. */
function lastRows_(t, maxRows) {
  const sh = sh_(t), last = sh.getLastRow(); if (last < 2) return [];
  const h = SCHEMA[t], n = Math.min(maxRows, last - 1), v = sh.getRange(last - n + 1, 1, n, h.length).getValues();
  return v.map(r => { const o = {}; h.forEach((k, i) => o[k] = fmt_(r[i])); return o; });
}
const ymd_ = d => Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
const dayOf_ = o => String(o.tanggal).slice(0, 10);
function addDays_(ds, n) { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd_(d); }
const num_ = x => Number(x) || 0;
const net_ = s => num_(s.total) - num_(s.ppn_nominal);
function periodRange_(period) { // pembanding: hari = kemarin; minggu = 7 hari sebelumnya; bulan = tanggal 1 s.d. N bulan lalu
  const to = ymd_(new Date()); let from = to, pfrom, pto;
  if (period === 'minggu') { from = addDays_(to, -6); pto = addDays_(from, -1); pfrom = addDays_(pto, -6); }
  else if (period === 'bulan') {
    from = to.slice(0, 8) + '01'; const pm = addDays_(from, -1), pmStart = pm.slice(0, 8) + '01', dn = Number(to.slice(8, 10)), pmLast = Number(pm.slice(8, 10));
    pfrom = pmStart; pto = pm.slice(0, 8) + ('0' + Math.min(dn, pmLast)).slice(-2);
  } else { pfrom = pto = addDays_(to, -1); }
  return {from: from, to: to, pfrom: pfrom, pto: pto};
}
function salesData_(from, to) {
  const sc = dateScan_('sales', from, to), sales = rowsAt_('sales', sc.idx).filter(s => s.status === 'selesai'), byId = {}; // seluruh baris pada rentang tanggal, tanpa batas jumlah baris
  sales.forEach(s => byId[s.id] = s);
  return netoLines_({sales: sales, byId: byId, items: itemsOf_(sc, byId)});
}
/* Item milik penjualan terpilih. Bila penjualan dipindai dari ekor, sale_items juga dipindai dari ekor (item ditulis tepat setelah penjualannya, dengan urutan sama) dan berhenti
   pada item milik penjualan yang lebih tua dari wilayah itu; tanpa ini pembacaan seluruh kolom sale_id tetap O(seluruh riwayat). Penjagaan: bila ada penjualan terpilih yang itemnya
   tidak ditemukan, hasil jalan pintas tidak dipercaya dan dipakai pembacaan penuh (hasil selalu benar, hanya lebih lambat). */
function itemsOf_(sc, byId) {
  const ids = Object.keys(byId); if (!ids.length) return [];
  const full = () => rowsByKey_('sale_items', 'sale_id', byId);
  if (!sc.tail || sc.first <= 0) return full();
  const sh = sh_('sale_items'), n = sh.getLastRow() - 1, sl = sh_('sales'), sn = sl.getLastRow() - 1 - sc.first; if (n < 1 || sn < 1) return full();
  const region = {}; sl.getRange(sc.first + 2, 1, sn, 1).getValues().forEach(r => { region[r[0]] = 1; }); // semua penjualan (apa pun statusnya) di wilayah yang dipindai
  const col = SCHEMA.sale_items.indexOf('sale_id') + 1, idx = [], seen = {}; let started = false, stop = false;
  for (let b = n - 1, blk = DATE_BLOCK_; b >= 0 && !stop; b = b - blk, blk = Math.min(blk * 2, DATE_BLOCK_MAX_)) {
    const a = Math.max(0, b - blk + 1), v = sh.getRange(a + 2, col, b - a + 1, 1).getValues();
    for (let k = v.length - 1; k >= 0; k--) {
      const sid = v[k][0];
      if (!region[sid]) { if (started) { stop = true; break; } continue; } // sebelum item pertama wilayah: boleh penjualan baru yang masuk saat membaca
      started = true; if (byId[sid]) { idx.push(a + k); seen[sid] = 1; }
    }
  }
  if (ids.some(id => !seen[id])) return full();
  return rowsAt_('sale_items', idx);
}
/* B10: hasil dashboard/laporan disimpan di cache menurut KEDUA versi data (cat_ver dan stock_ver; penjualan hanya menaikkan stock_ver) + tanggal hari ini + parameter, TTL pendek
   sebagai pengaman. Kunci dibuat SEBELUM data dihitung, jadi hasil tersimpan tidak pernah lebih lama dari versi pada kuncinya. Tidak dipakai saat uji restore (NOCACHE_). */
function memo_(key, ttl, fn) {
  if (NOCACHE_) return fn();
  const c = CacheService.getScriptCache(), v = vers_(), k = 'rc|' + v.cat_ver + '~' + v.stock_ver + '|' + ymd_(new Date()) + '|' + key;
  if (k.length < 250) { const hit = c.get(k); if (hit) { try { return JSON.parse(hit); } catch (e) {} } }
  const r = fn(); if (k.length >= 250) return r;
  const js = JSON.stringify(r); if (js.length > 95000) { console.warn('Hasil ' + key + ' tidak di-cache: terlalu besar (' + js.length + ' karakter).'); return r; }
  try { c.put(k, js, ttl); } catch (e) { console.warn('Gagal menyimpan cache hasil ' + key + ': ' + e.message); }
  return r;
}
/* Alokasi diskon dan PPN ke setiap baris item: neto = bruto x (omzet bersih transaksi / dasar sesudah diskon). Jumlah neto baris dalam satu transaksi
   selalu sama dengan omzet bersih transaksi itu (sisa pembulatan di baris terakhir), sehingga laba per produk = laba kotor ringkasan. Berlaku juga untuk retur (nilai negatif). */
function netoLines_(D) {
  const by = {}; D.items.forEach(i => (by[i.sale_id] = by[i.sale_id] || []).push(i));
  Object.keys(by).forEach(sid => {
    const sl = D.byId[sid], base = num_(sl.subtotal) - num_(sl.diskon), f = base ? net_(sl) / base : 0, ls = by[sid]; let acc = 0;
    ls.forEach((i, k) => { const bruto = num_(i.qty) * num_(i.harga); i.bruto = bruto; i.neto = k === ls.length - 1 ? net_(sl) - acc : bruto * f; acc += i.neto; });
  });
  return D;
}
const hppCats_ = () => String(settingsMap_().kategori_masuk_hpp || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean); // kategori biaya yang sudah masuk HPP (tidak dipotong lagi di laba bersih)
const inHpp_ = (e, cats) => cats.indexOf(String(e.kategori || '').trim().toLowerCase()) >= 0;
function names_(live) { // live=true hanya bila butuh HPP/stok terkini per varian (laporan HPP); selain itu cukup metadata varian dari cache
  const pm = {}, vm = {}, cm = {}; tbl_('products').forEach(p => pm[p.id] = p); tbl_('channels').forEach(c => cm[c.id] = c);
  (live ? readAll_('product_variants') : variantMeta_()).forEach(v => vm[v.id] = v);
  const label = id => { const v = vm[id] || {}, p = pm[v.product_id] || {}; return {produk: p.nama || '?', varian: [v.ukuran, v.level_pedas].filter(Boolean).join(' · ')}; };
  return {pm: pm, vm: vm, cm: cm, label: label};
}
const liveProduct_ = (N, v) => !!N.pm[v.product_id] && active_(N.pm[v.product_id]); // varian milik produk yang sudah dihapus diabaikan
function dashboard_(p) {
  const period = ['hari', 'minggu', 'bulan'].indexOf(p.period) >= 0 ? p.period : 'hari', r = periodRange_(period);
  const sFrom = period === 'bulan' ? r.from : addDays_(r.to, -6), D = salesData_([r.pfrom, sFrom].sort()[0], r.to);
  const inR = (o, f, t) => dayOf_(o) >= f && dayOf_(o) <= t;
  const sum = (f, t) => {
    let omzet = 0, trx = 0, hpp = 0, fee = 0;
    D.sales.forEach(s => { if (inR(s, f, t)) { omzet += net_(s); if (!s.ref_sale_id) trx++; fee += num_(s.fee_channel); } });
    D.items.forEach(i => { if (inR(D.byId[i.sale_id], f, t)) hpp += num_(i.qty) * num_(i.hpp_snapshot); });
    return {omzet: omzet, trx: trx, hpp: hpp, fee: fee, laba: omzet - hpp};
  };
  const cur = sum(r.from, r.to), prev = sum(r.pfrom, r.pto), series = [], idx = {};
  for (let d = sFrom; d <= r.to; d = addDays_(d, 1)) { idx[d] = series.length; series.push({d: d, omzet: 0, laba: 0}); }
  D.sales.forEach(s => { const k = idx[dayOf_(s)]; if (k !== undefined) { series[k].omzet += net_(s); series[k].laba += net_(s); } });
  D.items.forEach(i => { const k = idx[dayOf_(D.byId[i.sale_id])]; if (k !== undefined) series[k].laba -= num_(i.qty) * num_(i.hpp_snapshot); });
  const N = names_(), chs = {}, top = {};
  D.sales.forEach(s => { if (inR(s, r.from, r.to)) { const c = chs[s.channel_id] = chs[s.channel_id] || {nama: (N.cm[s.channel_id] || {}).nama || '-', omzet: 0, trx: 0}; c.omzet += net_(s); if (!s.ref_sale_id) c.trx++; } });
  D.items.forEach(i => {
    if (!inR(D.byId[i.sale_id], r.from, r.to)) return;
    const t = top[i.variant_id] = top[i.variant_id] || {variant_id: i.variant_id, qty: 0, omzet: 0, laba: 0};
    t.qty += num_(i.qty); t.omzet += i.neto; t.laba += i.neto - num_(i.qty) * num_(i.hpp_snapshot); // neto = sesudah diskon, tanpa PPN (sama dasar dengan laba kotor)
  });
  const topList = Object.values(top).map(t => { const l = N.label(t.variant_id); t.nama = l.produk + ' ' + l.varian; return t; }).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const low = readAll_('materials').filter(m => active_(m) && num_(m.stok_minimum) > 0 && num_(m.stok) <= num_(m.stok_minimum)).map(m => ({nama: m.nama, stok: m.stok, satuan: m.satuan}));
  const hc = hppCats_(), biaya = rowsByDate_('expenses', 'tanggal', r.from, r.to).filter(e => !inHpp_(e, hc)).reduce((a, e) => a + num_(e.nominal), 0);
  const warn = [], set = settingsMap_(), ohNol = set.metode_overhead === 'per_batch' ? !(num_(set.overhead_per_batch) > 0) : !(num_(set.overhead_per_unit) > 0);
  if (ohNol && rowsByDate_('production_orders', 'tanggal', addDays_(r.to, -30), r.to).some(o => o.status === 'selesai')) warn.push('Overhead produksi masih Rp0: HPP kemungkinan terlalu rendah dan laba tampak lebih besar dari kenyataan. Isi di Pengaturan, atau pakai Hitung saran overhead.');
  const minus = readAll_('product_variants').filter(v => active_(v) && liveProduct_(N, v) && num_(v.stok) < 0).map(v => { const l = N.label(v.id); return {nama: (l.produk + ' ' + l.varian).trim(), stok: num_(v.stok)}; })
    .concat(readAll_('materials').filter(m => active_(m) && num_(m.stok) < 0).map(m => ({nama: m.nama, stok: num_(m.stok)})));
  return {period: period, from: r.from, to: r.to, pfrom: r.pfrom, pto: r.pto, cur: cur, prev: prev, series: series, channels: Object.values(chs).sort((a, b) => b.omzet - a.omzet),
    top: topList, low: low.slice(0, 8), biaya: biaya, laba_bersih: cur.laba - cur.fee - biaya, peringatan: warn, stok_minus: minus.slice(0, 10)};
}
function report_(p) {
  const to = p.to || ymd_(new Date()), from = p.from || to.slice(0, 8) + '01', N = names_(p.type === 'hpp'), inR = o => dayOf_(o) >= from && dayOf_(o) <= to;
  const arsip = from < archCutoff_(), R = (title, columns, fmt, rows, summary) => ({type: p.type, title: title, from: from, to: to, columns: columns, fmt: fmt, rows: rows, summary: summary || [], peringatan: arsip ? 'Sebagian periode ini sudah dipindahkan ke arsip (sebelum ' + archCutoff_() + '), sehingga angkanya tidak lengkap.' : ''});
  const margin = (l, h) => l && h ? Math.round((h - 0) ? (l / h) * 1000 : 0) / 10 : 0;
  switch (p.type) {
    case 'penjualan': {
      const D = salesData_(from, to), per = {};
      D.items.forEach(i => { const t = per[i.variant_id] = per[i.variant_id] || {qty: 0, kotor: 0, neto: 0, hpp: 0}; t.qty += num_(i.qty); t.kotor += i.bruto; t.neto += i.neto; t.hpp += num_(i.qty) * num_(i.hpp_snapshot); });
      const rows = Object.keys(per).map(id => { const t = per[id], l = N.label(id), lb = t.neto - t.hpp; return [l.produk, l.varian, t.qty, t.kotor, t.neto, t.hpp, lb, t.neto ? Math.round(lb / t.neto * 1000) / 10 : 0]; }).sort((a, b) => b[4] - a[4]);
      const omzet = D.sales.reduce((a, s) => a + net_(s), 0), hpp = rows.reduce((a, r) => a + r[5], 0), dis = D.sales.reduce((a, s) => a + num_(s.diskon), 0), ret = D.sales.filter(s => s.ref_sale_id).reduce((a, s) => a + -net_(s), 0);
      return R('Penjualan per produk', ['Produk', 'Varian', 'Qty', 'Penjualan kotor', 'Omzet bersih', 'HPP', 'Laba kotor', 'Margin'], ['txt', 'txt', 'num', 'rp', 'rp', 'rp', 'rp', 'pct'], rows,
        [{label: 'Transaksi', value: D.sales.filter(s => !s.ref_sale_id).length, fmt: 'num'}, {label: 'Omzet bersih', value: omzet, fmt: 'rp'}, {label: 'Diskon', value: dis, fmt: 'rp'}, {label: 'Retur (sudah dikurangkan)', value: ret, fmt: 'rp'}, {label: 'HPP', value: hpp, fmt: 'rp'}, {label: 'Laba kotor', value: omzet - hpp, fmt: 'rp'}]);
    }
    case 'labarugi': {
      const D = salesData_(from, to), omzet = D.sales.reduce((a, s) => a + net_(s), 0), fee = D.sales.reduce((a, s) => a + num_(s.fee_channel), 0);
      const hpp = D.items.reduce((a, i) => a + num_(i.qty) * num_(i.hpp_snapshot), 0), ex = rowsByDate_('expenses', 'tanggal', from, to), kat = {};
      ex.forEach(e => kat[e.kategori || 'Lain-lain'] = (kat[e.kategori || 'Lain-lain'] || 0) + num_(e.nominal));
      const hc = hppCats_(), exo = ex.filter(e => !inHpp_(e, hc)), biaya = exo.reduce((a, e) => a + num_(e.nominal), 0), rows = [['Omzet bersih (tanpa PPN)', omzet], ['HPP', -hpp], ['Laba kotor', omzet - hpp], ['Biaya channel (fee)', -fee]];
      Object.keys(kat).filter(k => hc.indexOf(k.trim().toLowerCase()) < 0).forEach(k => rows.push(['Biaya: ' + k, -kat[k]])); rows.push(['Laba bersih', omzet - hpp - fee - biaya]);
      Object.keys(kat).filter(k => hc.indexOf(k.trim().toLowerCase()) >= 0).forEach(k => rows.push(['(Info) ' + k + ': sudah masuk HPP, tidak dipotong lagi', kat[k]]));
      return R('Laba rugi sederhana', ['Komponen', 'Nilai'], ['txt', 'rp'], rows, [{label: 'Margin kotor', value: omzet ? Math.round((omzet - hpp) / omzet * 1000) / 10 : 0, fmt: 'pct'}, {label: 'Margin bersih', value: omzet ? Math.round((omzet - hpp - fee - biaya) / omzet * 1000) / 10 : 0, fmt: 'pct'}]);
    }
    case 'channel': {
      const D = salesData_(from, to), per = {};
      D.sales.forEach(s => { const c = per[s.channel_id] = per[s.channel_id] || {trx: 0, omzet: 0, fee: 0, hpp: 0}; if (!s.ref_sale_id) c.trx++; c.omzet += net_(s); c.fee += num_(s.fee_channel); });
      D.items.forEach(i => { const c = per[D.byId[i.sale_id].channel_id]; c.hpp += num_(i.qty) * num_(i.hpp_snapshot); });
      return R('Penjualan per channel', ['Channel', 'Transaksi', 'Omzet', 'Fee', 'Laba setelah fee'], ['txt', 'num', 'rp', 'rp', 'rp'],
        Object.keys(per).map(id => [(N.cm[id] || {}).nama || '-', per[id].trx, per[id].omzet, per[id].fee, per[id].omzet - per[id].hpp - per[id].fee]).sort((a, b) => b[2] - a[2]));
    }
    case 'hpp': {
      const set = settingsMap_(), target = num_(set.target_margin), kel = num_(set.kelipatan_harga) || 500, rows = [];
      const pp = isTrue_(set.ppn_aktif) ? num_(set.ppn_persen) : 0, incl = isTrue_(set.ppn_inklusif), rc = recipeCosts_(set);
      tbl_('channel_prices').forEach(cp => {
        const v = N.vm[cp.variant_id], c = N.cm[cp.channel_id]; if (!v || !c || !active_(v) || !liveProduct_(N, v)) return;
        const harga = num_(cp.harga_jual), hargaNet = pp ? (incl ? harga / (1 + pp / 100) : harga) : harga, total = pp && !incl ? harga * (1 + pp / 100) : harga, ppnNom = total - hargaNet;
        const fp = num_(c.fee_persen) / 100, ft = num_(c.fee_tetap), fee = feeBasis_(c.basis_fee, harga, total, ppnNom) * fp + ft;
        const hpp = num_(v.hpp_rata2), hppP = rc[v.id] !== undefined ? rc[v.id] : hpp, laba = hargaNet - hpp - fee, mg = hargaNet ? Math.round(laba / hargaNet * 1000) / 10 : 0;
        const mgP = hargaNet ? Math.round((hargaNet - hppP - fee) / hargaNet * 1000) / 10 : 0, l = N.label(v.id);
        const unit = {subtotal: incl ? 1 + pp / 100 : 1, total: pp ? 1 + pp / 100 : 1}, k = fp * feeBasis_(c.basis_fee, unit.subtotal, unit.total, pp ? pp / 100 : 0), den = 1 - k - target / 100;
        let rek = ''; if (den > 0 && Math.max(hpp, hppP) > 0) { const net = (Math.max(hpp, hppP) + ft) / den, etalase = pp && incl ? net * (1 + pp / 100) : net; rek = Math.ceil(etalase / kel - 1e-9) * kel; }
        rows.push([l.produk, l.varian, c.nama, harga, hargaNet, hpp, hppP, fee, laba, mg, mgP, rek, !(hpp > 0) && !(hppP > 0) ? 'HPP belum diisi' : mg < target ? 'Di bawah target' : mgP < target ? 'Harga bahan terbaru: margin di bawah target' : 'OK']);
      });
      rows.sort((a, b) => Math.min(a[9], a[10]) - Math.min(b[9], b[10]));
      return R('HPP dan margin per channel', ['Produk', 'Varian', 'Channel', 'Harga etalase', 'Harga bersih (tanpa PPN)', 'HPP rata-rata', 'HPP harga beli terakhir', 'Fee', 'Laba/unit', 'Margin', 'Margin (HPP terbaru)', 'Harga rekomendasi', 'Status'],
        ['txt', 'txt', 'txt', 'rp', 'rp', 'rp', 'rp', 'rp', 'rp', 'pct', 'pct', 'rp', 'txt'], rows,
        [{label: 'Target margin', value: target, fmt: 'pct'}, {label: 'Di bawah target', value: rows.filter(r => r[9] < target).length, fmt: 'num'}, {label: 'Margin turun bila beli harga terbaru', value: rows.filter(r => r[9] >= target && r[10] < target).length, fmt: 'num'}]);
    }
    case 'stok': {
      const rows = []; let nv = 0, nm = 0;
      readAll_('product_variants').filter(v => active_(v) && liveProduct_(N, v)).forEach(v => { const l = N.label(v.id), n = num_(v.stok) * num_(v.hpp_rata2); nv += n; rows.push(['Produk jadi', l.produk + ' ' + l.varian, num_(v.stok), 'unit', num_(v.hpp_rata2), n]); });
      readAll_('materials').filter(active_).forEach(m => { const n = num_(m.stok) * num_(m.hpp_rata2); nm += n; rows.push([m.tipe === 'kemasan' ? 'Kemasan' : 'Bahan', m.nama, num_(m.stok), m.satuan, num_(m.hpp_rata2), n]); });
      return R('Stok dan nilai persediaan', ['Jenis', 'Item', 'Stok', 'Satuan', 'HPP rata-rata', 'Nilai'], ['txt', 'txt', 'num', 'txt', 'rp', 'rp'], rows,
        [{label: 'Nilai produk jadi', value: nv, fmt: 'rp'}, {label: 'Nilai bahan dan kemasan', value: nm, fmt: 'rp'}, {label: 'Total persediaan', value: nv + nm, fmt: 'rp'}]);
    }
    case 'produksi': {
      const orders = rowsByDate_('production_orders', 'tanggal', from, to).filter(o => o.status === 'selesai'), oids = {}, costs = {}; orders.forEach(o => oids[o.id] = 1);
      rowsByKey_('production_costs', 'production_id', oids).forEach(c => costs[c.production_id] = c); // hanya biaya milik produksi pada periode ini, bukan seluruh tabel
      const rows = orders.map(o => {
        const l = N.label(o.variant_id), c = costs[o.id] || {}; return [dayOf_(o), o.jenis, l.produk + ' ' + l.varian, num_(o.jumlah_batch), num_(o.qty_standar), num_(o.qty_hasil), num_(o.qty_standar) - num_(o.qty_hasil), num_(c.hpp_per_unit), num_(c.total)]; });
      const std = rows.reduce((a, r) => a + r[4], 0), akt = rows.reduce((a, r) => a + r[5], 0);
      return R('Produksi, hasil dan HPP', ['Tanggal', 'Jenis', 'Produk', 'Batch', 'Hasil standar', 'Hasil aktual', 'Susut', 'HPP/unit', 'Total biaya'], ['txt', 'txt', 'txt', 'num', 'num', 'num', 'num', 'rp', 'rp'], rows,
        [{label: 'Total hasil', value: akt, fmt: 'num'}, {label: 'Yield', value: std ? Math.round(akt / std * 1000) / 10 : 0, fmt: 'pct'}, {label: 'Total biaya', value: rows.reduce((a, r) => a + r[8], 0), fmt: 'rp'}]);
    }
    case 'pembelian': {
      const pur = rowsByDate_('purchases', 'tanggal', from, to), ids = {}; pur.forEach(x => ids[x.id] = true);
      const per = {}, mm = {}; readAll_('materials').forEach(m => mm[m.id] = m);
      rowsByKey_('purchase_items', 'purchase_id', ids).forEach(i => { const t = per[i.material_id] = per[i.material_id] || {qty: 0, nilai: 0, last: 0}; t.qty += num_(i.qty); t.nilai += num_(i.qty) * num_(i.harga_satuan); t.last = num_(i.harga_satuan); });
      const rows = Object.keys(per).map(id => [(mm[id] || {}).nama || '?', (mm[id] || {}).satuan || '', per[id].qty, per[id].nilai, per[id].qty ? per[id].nilai / per[id].qty : 0, per[id].last]).sort((a, b) => b[3] - a[3]);
      return R('Pembelian bahan', ['Bahan', 'Satuan', 'Qty', 'Total belanja', 'Harga rata-rata', 'Harga terakhir'], ['txt', 'txt', 'num', 'rp', 'rp', 'rp'], rows, [{label: 'Total belanja + ongkir', value: pur.reduce((a, x) => a + num_(x.total), 0), fmt: 'rp'}]);
    }
    case 'pengeluaran': {
      const ex = rowsByDate_('expenses', 'tanggal', from, to), per = {};
      ex.forEach(e => { const k = e.kategori || 'Lain-lain', t = per[k] = per[k] || {n: 0, total: 0}; t.n++; t.total += num_(e.nominal); });
      return R('Biaya operasional', ['Kategori', 'Jumlah catatan', 'Total'], ['txt', 'num', 'rp'], Object.keys(per).map(k => [k, per[k].n, per[k].total]).sort((a, b) => b[2] - a[2]), [{label: 'Total biaya', value: ex.reduce((a, e) => a + num_(e.nominal), 0), fmt: 'rp'}]);
    }
    default: throw new Error('Jenis laporan tidak dikenal.');
  }
}

/* Biaya per unit dari resep dengan HARGA BELI TERAKHIR bahan (termasuk alokasi ongkir). HPP rata-rata bergerak lambat saat harga bahan naik; angka ini lebih cepat memberi peringatan. */
function recipeCosts_(set) {
  const pu = readCols_('purchases', ['id', 'total', 'ongkir']), up = {}; // ongkir dialokasikan ke semua item pembelian (sama seperti HPP rata-rata): harga efektif = harga x (1 + ongkir / nilai barang)
  for (let i = 0; i < pu.id.length; i++) { const o = num_(pu.ongkir[i]), v = num_(pu.total[i]) - o; up[pu.id[i]] = o > 0 && v > 0 ? 1 + o / v : 1; }
  const pi = readCols_('purchase_items', ['purchase_id', 'material_id', 'harga_satuan']), last = {};
  for (let i = 0; i < pi.material_id.length; i++) if (pi.harga_satuan[i] !== '') last[pi.material_id[i]] = num_(pi.harga_satuan[i]) * (up[pi.purchase_id[i]] || 1);
  const mm = {}; readAll_('materials').forEach(m => mm[m.id] = m);
  const items = {}; tbl_('recipe_items').forEach(i => (items[i.recipe_id] = items[i.recipe_id] || []).push(i));
  const out = {}, perBatch = set.metode_overhead === 'per_batch';
  tbl_('recipes').filter(r => active_(r) && (r.jenis || 'batch') === 'batch').forEach(r => {
    if (out[r.variant_id] !== undefined) return; const hs = num_(r.hasil_standar); if (!(hs > 0)) return;
    const bahan = (items[r.id] || []).reduce((a, i) => { const m = mm[i.material_id] || {}, h = last[i.material_id] !== undefined ? last[i.material_id] : num_(m.hpp_rata2); return a + num_(i.qty) * h; }, 0);
    out[r.variant_id] = Math.round((bahan + num_(r.tenaga_kerja) + (perBatch ? num_(set.overhead_per_batch) : num_(set.overhead_per_unit) * hs)) / hs * 100) / 100;
  });
  return out;
}
/* Saran overhead per unit = biaya bulan lalu pada kategori yang ditandai "sudah masuk HPP" dibagi unit yang diproduksi bulan lalu. */
function overheadSuggest_() {
  const now = ymd_(new Date()), pmEnd = addDays_(now.slice(0, 8) + '01', -1), pmStart = pmEnd.slice(0, 8) + '01', hc = hppCats_();
  if (!hc.length) return {saran_per_unit: null, pesan: 'Tandai dulu kategori biaya yang sudah masuk HPP di Pengaturan (mis. Listrik, Gas).'};
  const biaya = rowsByDate_('expenses', 'tanggal', pmStart, pmEnd).filter(e => inHpp_(e, hc)).reduce((a, e) => a + num_(e.nominal), 0);
  const unit = rowsByDate_('production_orders', 'tanggal', pmStart, pmEnd).filter(o => o.status === 'selesai').reduce((a, o) => a + num_(o.qty_hasil), 0);
  return {bulan: pmStart.slice(0, 7), biaya: biaya, unit: unit, saran_per_unit: unit > 0 ? Math.round(biaya / unit * 100) / 100 : null, pesan: unit > 0 ? '' : 'Tidak ada produksi selesai bulan lalu.'};
}
