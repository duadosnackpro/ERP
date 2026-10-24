/* ===== Validasi dan konsistensi data master, audit stok ===== */
const r6_ = x => Math.round(Number(x) * 1e6) / 1e6; // buang noise desimal (0.30000000000000004)
const blank_ = x => x === undefined || x === null || String(x).trim() === '';
function masterSave_(p, s) {
  const t = p.table, d = Object.assign({}, p.data || {});
  if (t === 'product_variants' && !blank_(d.product_id) && blank_(d.sku)) d.sku = genSku_(d); // SKU otomatis bila dikosongkan
  if (t === 'channel_prices' && !d.id) { // satu harga per varian per channel; cari di cache dulu, pastikan ke sheet bila tidak ketemu (cache bisa basi setelah edit langsung di Sheets) agar tidak terbentuk harga ganda
    const same = x => x.variant_id === d.variant_id && x.channel_id === d.channel_id, ex = tbl_('channel_prices').find(same) || readAll_('channel_prices').find(same); if (ex) d.id = ex.id; }
  if (t === 'products') delete d.foto_url; // foto hanya lewat produk.foto (divalidasi); edit nama/kategori tidak menyentuh foto
  if (t === 'expenses') { d.user_id = s.uid; if (blank_(d.tanggal)) d.tanggal = now_().slice(0, 10); }
  validate_(t, d);
  return save_(t, clean_(t, d), s.uid);
}
function validate_(t, d) {
  const n = k => Number(d[k]);
  if (t === 'products' && blank_(d.nama)) throw new Error('Nama produk wajib diisi.');
  if (t === 'product_variants') {
    if (!tbl_('products').some(x => x.id === d.product_id && active_(x))) throw new Error('Pilih produk yang valid.');
    const sku = String(d.sku == null ? '' : d.sku).trim().toLowerCase();
    if (sku && variantMeta_().some(v => active_(v) && String(v.sku).trim().toLowerCase() === sku && v.id !== d.id)) throw new Error('SKU "' + d.sku + '" sudah dipakai varian lain.');
  }
  if (t === 'channel_prices') {
    if (!variantMeta_().some(v => v.id === d.variant_id && active_(v))) throw new Error('Pilih varian yang valid.');
    if (!tbl_('channels').some(c => c.id === d.channel_id && active_(c))) throw new Error('Pilih channel yang valid.');
    if (!(n('harga_jual') >= 0) || blank_(d.harga_jual)) throw new Error('Harga jual harus berupa angka 0 atau lebih.');
  }
  if (t === 'materials') {
    if (blank_(d.nama) || blank_(d.satuan)) throw new Error('Nama dan satuan bahan wajib diisi.');
    if (['bahan', 'kemasan', 'barang jadi beli'].indexOf(d.tipe) < 0) throw new Error('Tipe harus bahan, kemasan, atau barang jadi beli.');
    if (!blank_(d.satuan_kecil) && !(n('faktor_kecil') > 1)) throw new Error('Isi satuan kecil per 1 satuan harus lebih dari 1 (mis. 1000 ml per 1 Liter).');
  }
  if (t === 'channels') { if (blank_(d.nama)) throw new Error('Nama channel wajib diisi.'); if (!(n('fee_persen') >= 0 && n('fee_persen') <= 100)) throw new Error('Fee persen harus 0-100.'); if (!blank_(d.basis_fee) && ['total', 'subtotal', 'omzet'].indexOf(d.basis_fee) < 0) throw new Error('Basis fee harus total, subtotal, atau omzet.'); }
  if (t === 'expenses' && !(n('nominal') > 0)) throw new Error('Nominal biaya harus lebih dari 0.');
}
function removeSafe_(t, id, uid) { // v1.9.8: seluruh pemeriksaan + penghapusan dalam SATU kunci (sebelumnya periksa stok di luar kunci, hapus di dalam: produksi/pembelian bisa menyela di antaranya)
  return withLock_(() => removeSafeCore_(t, id, uid));
}
function removeSafeCore_(t, id, uid) { // soft delete dengan pengaman: tidak boleh menghapus yang masih punya stok atau masih dipakai
  const act = r => String(r.aktif) !== 'false';
  if (t === 'products') {
    const vs = readAll_('product_variants').filter(v => act(v) && v.product_id === id), bad = vs.filter(v => num_(v.stok) !== 0);
    if (bad.length) throw new Error('Varian masih punya stok: ' + bad.map(v => v.sku || v.ukuran).join(', ') + '. Nolkan stok lewat menu Stok dulu.');
    vs.forEach(v => removeSafe_('product_variants', v.id, uid));
  } else if (t === 'product_variants') {
    const v = readAll_('product_variants').find(x => x.id === id);
    if (v && num_(v.stok) !== 0) throw new Error('Varian masih punya stok ' + v.stok + '. Nolkan stok lewat menu Stok dulu.');
    readAll_('recipes').filter(r => act(r) && r.variant_id === id).forEach(r => remove_('recipes', r.id, uid));
  } else if (t === 'materials') {
    const m = readAll_('materials').find(x => x.id === id);
    if (m && num_(m.stok) !== 0) throw new Error('Bahan masih punya stok ' + m.stok + '. Nolkan stok lewat menu Stok dulu.');
    const rid = {}; readAll_('recipe_items').filter(i => i.material_id === id).forEach(i => rid[i.recipe_id] = true);
    const used = readAll_('recipes').filter(r => act(r) && rid[r.id]); if (used.length) throw new Error('Bahan masih dipakai di resep: ' + used.map(r => r.nama).join(', ') + '.');
  } else if (t === 'channels') { if (tbl_('channels').filter(act).length <= 1) throw new Error('Minimal harus ada 1 channel aktif.'); }
  return remove_(t, id, uid);
}
function stockLedger_() { const c = readCols_('stock_movements', ['item_tipe', 'item_id', 'qty']), sums = {}; for (let i = 0; i < c.item_id.length; i++) { const k = c.item_tipe[i] + '|' + c.item_id[i]; sums[k] = (sums[k] || 0) + num_(c.qty[i]); } return sums; }
function stockAudit_() { // bandingkan kolom stok dengan jumlah riwayat mutasi; periksa juga penjualan setengah jadi dan selisih total struk
  const sums = stockLedger_(), N = names_(), out = []; let checked = 0;
  readAll_('product_variants').forEach(v => { checked++; const led = r6_(sums['varian|' + v.id] || 0), st = r6_(num_(v.stok)); if (Math.abs(led - st) > 0.0001) { const l = N.label(v.id); out.push({tipe: 'varian', id: v.id, nama: l.produk + ' ' + l.varian, stok: st, riwayat: led, selisih: r6_(st - led)}); } });
  readAll_('materials').forEach(m => { checked++; const led = r6_(sums['bahan|' + m.id] || 0), st = r6_(num_(m.stok)); if (Math.abs(led - st) > 0.0001) out.push({tipe: 'bahan', id: m.id, nama: m.nama, stok: st, riwayat: led, selisih: r6_(st - led)}); });
  const S = readCols_('sales', ['id', 'nomor', 'tanggal', 'total', 'status', 'total_klien']), has = {}; readCols_('sale_items', ['sale_id']).sale_id.forEach(x => has[x] = 1);
  const yatim = [], proses = [], beda = []; // seluruh penjualan diperiksa, bukan hanya yang terakhir
  for (let i = 0; i < S.id.length; i++) {
    const row = {id: S.id[i], nomor: S.nomor[i], tanggal: String(fmt_(S.tanggal[i])).slice(0, 16), total: S.total[i]};
    if (S.status[i] === 'proses') proses.push(row);
    else if (S.status[i] === 'selesai' && !has[S.id[i]]) yatim.push(row);
    const tk = S.total_klien[i]; if (S.status[i] === 'selesai' && tk !== '' && tk != null && Math.abs(num_(tk) - num_(S.total[i])) > 0.5) beda.push(Object.assign({total_klien: tk}, row));
  }
  const nMut = Math.max(sh_('stock_movements').getLastRow() - 1, 0), pw = nMut > 300000 ? 'Tabel stock_movements sudah ' + nMut + ' baris; audit stok membacanya seluruhnya dan bisa mendekati batas waktu 6 menit Apps Script. Jalankan arsip (Menu, Pemeriksaan data) atau perkecil arsip_bulan.' : '';
  return {diperiksa: checked, baris_mutasi: nMut, peringatan: pw, selisih: out, penjualan_tanpa_item: yatim.slice(0, 20), penjualan_proses: proses.slice(0, 20), selisih_total: beda.slice(-20)};
}
function stockReconcile_(p, s) { // terima stok saat ini sebagai benar: catat mutasi koreksi agar riwayat sama dengan stok
  const t = p.tipe === 'bahan' ? 'materials' : 'product_variants'; if (['bahan', 'varian'].indexOf(p.tipe) < 0) throw new Error('Tipe tidak valid.');
  return withLock_(() => {
    const row = readAll_(t).find(x => x.id === p.id); if (!row) throw new Error('Item tidak ditemukan.');
    const led = r6_(stockLedger_()[p.tipe + '|' + p.id] || 0), diff = r6_(num_(row.stok) - led);
    if (diff !== 0) { appendRows_('stock_movements', [{id: id_(), tanggal: now_(), tipe: 'opname', item_tipe: p.tipe, item_id: p.id, qty: diff, nilai: diff * num_(row.hpp_rata2), ref_id: 'rekonsiliasi', user_id: s.uid}]); audit_(s.uid, 'rekonsiliasi', t, {riwayat: led}, {stok: row.stok}); }
    return {id: p.id, selisih_dikoreksi: diff};
  });
}

/* ===== Angka dari keyboard Indonesia: "0,5" dibaca sebagai 0.5 (hanya untuk kolom angka yang dikenal) ===== */
const NUM_KEYS = ['qty', 'stok_baru', 'harga_satuan', 'harga_jual', 'jumlah_batch', 'qty_hasil', 'tenaga_kerja', 'overhead', 'hasil_standar', 'ongkir', 'fee_persen', 'fee_tetap', 'stok_minimum', 'nominal', 'hpp', 'diskon', 'faktor_kecil', 'harga', 'ppn_persen', 'overhead_per_unit', 'overhead_per_batch', 'target_margin'];
function normNums_(o, key) {
  if (Array.isArray(o)) return o.map(x => normNums_(x, key));
  if (o && typeof o === 'object') { const r = {}; Object.keys(o).forEach(k => r[k] = normNums_(o[k], k)); return r; }
  if (typeof o === 'string' && NUM_KEYS.indexOf(key) >= 0 && /^\s*-?\d+,\d+\s*$/.test(o)) return o.trim().replace(',', '.');
  return o;
}

/* ===== SKU otomatis: SINGKATAN PRODUK - UKURAN - LEVEL (mis. MKR-80GR-L3), dijamin unik ===== */
function skuAbbr_(name) {
  const words = String(name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'PRD';
  if (words.length > 1) return words.slice(0, 3).map(w => w[0]).join('');
  const w = words[0]; let s = w[0] + w.slice(1).replace(/[AEIOU]/g, ''); if (s.length < 3) s = w; return s.slice(0, 3);
}
function skuSize_(u) {
  const s = String(u == null ? '' : u).toUpperCase(), m = s.match(/(\d+(?:[.,]\d+)?)\s*(KG|GR|G|ML|LT|L|PCS|PACK)?/);
  if (m) return m[1].replace(/[.,]/g, '') + (m[2] || ''); const w = s.replace(/[^A-Z]/g, ''); return w ? w[0] : '';
}
function skuLevel_(lv) {
  const raw = String(lv == null ? '' : lv).trim(); if (!raw) return ''; const n = parseInt(raw.replace(/\D/g, ''), 10);
  return isNaN(n) ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) : 'L' + n;
}
function genSku_(d, taken) {
  const p = tbl_('products').find(x => x.id === d.product_id), base = [skuAbbr_(p && p.nama), skuSize_(d.ukuran), skuLevel_(d.level_pedas)].filter(Boolean).join('-');
  taken = taken || new Set(readAll_('product_variants').filter(v => v.id !== d.id).map(v => String(v.sku).trim().toUpperCase()));
  let sku = base, i = 2; while (taken.has(sku)) sku = base + '-' + i++; return sku;
}
function skuAutoFill_(s) { // isi SKU untuk semua varian aktif yang masih kosong
  return withLock_(() => {
    const vars = readAll_('product_variants'), taken = new Set(vars.map(v => String(v.sku).trim().toUpperCase()).filter(Boolean)), out = [];
    vars.filter(v => String(v.aktif) !== 'false' && blank_(v.sku)).forEach(v => { const sku = genSku_(v, taken); taken.add(sku); saveRaw_('product_variants', {id: v.id, sku: sku}, s.uid); out.push({id: v.id, sku: sku}); });
    return {diisi: out.length, daftar: out};
  });
}

/* ===== Produk tambahan (mis. kantong kresek): produk berkategori "Tambahan" muncul di menu pembayaran kasir, bukan di daftar produk ===== */
function addonCreate_(p, s) {
  const nama = String(p.nama || '').trim(), harga = Number(p.harga), hpp = Number(p.hpp) || 0, stok = Number(p.stok) || 0;
  if (!nama) throw new Error('Nama produk tambahan wajib diisi.'); if (!(harga >= 0)) throw new Error('Harga jual tidak valid.'); if (hpp < 0 || stok < 0) throw new Error('HPP dan stok tidak boleh negatif.');
  return withLock_(() => {
    if (readAll_('products').some(x => String(x.aktif) !== 'false' && String(x.kategori).trim().toLowerCase() === 'tambahan' && String(x.nama).trim().toLowerCase() === nama.toLowerCase())) throw new Error('Produk tambahan "' + nama + '" sudah ada.');
    const pr = saveRaw_('products', {nama: nama, kategori: 'Tambahan', aktif: true}, s.uid);
    const v = saveRaw_('product_variants', {product_id: pr.id, sku: genSku_({product_id: pr.id, ukuran: '', level_pedas: ''}), ukuran: '', level_pedas: '', aktif: true}, s.uid);
    readAll_('channels').filter(active_).forEach(c => saveRaw_('channel_prices', {variant_id: v.id, channel_id: c.id, harga_jual: harga}, s.uid));
    if (stok > 0 || hpp > 0) {
      const sh = sh_('product_variants'), vv = sh.getDataRange().getValues(), i = vv.findIndex((r, n) => n > 0 && r[0] === v.id), si = vv[0].indexOf('stok');
      sh.getRange(i + 1, si + 1, 1, 2).setValues([[r6_(stok), hpp]]);
      appendRows_('stock_movements', [{id: id_(), tanggal: now_(), tipe: 'opname', item_tipe: 'varian', item_id: v.id, qty: r6_(stok), nilai: stok * hpp, ref_id: 'tambahan', user_id: s.uid}]);
    }
    bump_(); return {product_id: pr.id, variant_id: v.id, sku: v.sku};
  });
}

/* ===== Salin resep ke varian lain (bahan, hasil standar, tenaga kerja ikut disalin) ===== */
function recipeCopy_(p, s) {
  const src = readAll_('recipes').find(r => r.id === p.source_id); if (!src) throw new Error('Resep sumber tidak ditemukan.');
  const items = readAll_('recipe_items').filter(i => i.recipe_id === src.id), targets = p.targets || [], vars = {};
  if (!targets.length) throw new Error('Pilih minimal satu varian tujuan.'); if (targets.length > 30) throw new Error('Maksimal 30 varian sekali salin.');
  readAll_('product_variants').forEach(v => vars[v.id] = v);
  targets.forEach(t => { const v = vars[t.variant_id]; if (!v || String(v.aktif) === 'false') throw new Error('Varian tujuan tidak valid.'); }); // validasi semua dulu agar tidak ada yang setengah jadi
  return withLock_(() => {
    const out = [], rows = [];
    targets.forEach(t => {
      const nama = String(t.nama || src.nama).trim() || src.nama;
      const rec = saveRaw_('recipes', {variant_id: t.variant_id, nama: nama, hasil_standar: Number(src.hasil_standar), jenis: src.jenis || 'batch', tenaga_kerja: Number(src.tenaga_kerja) || 0, aktif: true}, s.uid);
      items.forEach(i => rows.push({id: id_(), recipe_id: rec.id, material_id: i.material_id, qty: Number(i.qty)})); out.push({id: rec.id, nama: nama});
    });
    appendRows_('recipe_items', rows); bust_('recipes'); bust_('recipe_items'); bump_(); return {dibuat: out};
  });
}

/* ===== Reset data transaksi (pemutihan). Data master tidak disentuh. Cadangan Drive dibuat dulu; bila gagal, tidak ada yang dihapus. ===== */
function clearRows_(t) { const sh = sh_(t), last = sh.getLastRow(); if (last < 2) return 0; sh.getRange(2, 1, last - 1, SCHEMA[t].length).clearContent(); return last - 1; }
function dataReset_(p, s) {
  if (p.konfirmasi !== 'RESET') throw new Error('Ketik RESET untuk mengonfirmasi.');
  return withLock_(() => {
    const url = backupNow_('sebelum reset ' + now_().replace(/[: ]/g, '-')), out = {backup: url, dihapus: {}};
    const tabs = ['sales', 'sale_items']; if (p.pembelian !== false) tabs.push('purchases', 'purchase_items'); if (p.produksi !== false) tabs.push('production_orders', 'production_costs'); if (p.biaya !== false) tabs.push('expenses');
    tabs.forEach(t => { out.dihapus[t] = clearRows_(t); });
    out.dihapus.stock_movements = clearRows_('stock_movements'); // riwayat mutasi dikosongkan; saldo saat ini dicatat sebagai saldo awal agar audit stok tetap cocok
    const rows = [], now = now_();
    [['product_variants', 'varian'], ['materials', 'bahan']].forEach(pair => {
      const sh = sh_(pair[0]), v = sh.getDataRange().getValues(), si = v[0].indexOf('stok'), hi = v[0].indexOf('hpp_rata2');
      for (let i = 1; i < v.length; i++) {
        const st = Number(v[i][si]) || 0; if (!st) continue;
        if (p.nol_stok) sh.getRange(i + 1, si + 1).setValue(0);
        else rows.push({id: id_(), tanggal: now, tipe: 'saldo_awal', item_tipe: pair[1], item_id: v[i][0], qty: st, nilai: st * (Number(v[i][hi]) || 0), ref_id: 'reset', user_id: s.uid});
      }
    });
    appendRows_('stock_movements', rows);
    const props = PropertiesService.getScriptProperties(); props.getKeys().forEach(k => { if (k.indexOf('seq_') === 0) props.deleteProperty(k); }); // nomor transaksi mulai lagi dari 001
    audit_(s.uid, 'reset', 'transaksi', null, {tabel: out.dihapus, nol_stok: !!p.nol_stok, backup: url}); bump_(); return out;
  });
}
