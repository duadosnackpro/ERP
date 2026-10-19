/* ===== Resep dan Produksi (HPP produksi) ===== */
function recipeSave_(p, s) {
  const items = (p.items || []).filter(i => i.material_id && Number(i.qty) > 0);
  if (!p.variant_id || !String(p.nama || '').trim()) throw new Error('Nama resep dan produk hasil wajib diisi.');
  if (!(Number(p.hasil_standar) > 0)) throw new Error('Hasil standar per batch harus lebih dari 0.');
  if (!items.length) throw new Error('Resep minimal memiliki 1 bahan.');
  if (['batch', 'repack'].indexOf(p.jenis || 'batch') < 0) throw new Error('Jenis resep tidak valid.');
  return withLock_(() => {
    const rec = saveRaw_('recipes', {id: p.id, variant_id: p.variant_id, nama: String(p.nama).trim(), hasil_standar: Number(p.hasil_standar),
      jenis: p.jenis || 'batch', tenaga_kerja: Number(p.tenaga_kerja) || 0, aktif: true}, s.uid);
    const rid = readCols_('recipe_items', ['recipe_id']).recipe_id, old = []; rid.forEach((x, i) => { if (x === rec.id) old.push(i); });
    const add = items.map(i => ({id: id_(), recipe_id: rec.id, material_id: i.material_id, qty: Number(i.qty)}));
    const contiguous = old.length > 0 && old[old.length - 1] - old[0] === old.length - 1;
    if (contiguous && old.length === add.length) { // kasus umum: timpa blok baris lama dengan satu panggilan, tanpa menulis ulang seluruh tabel
      sh_('recipe_items').getRange(old[0] + 2, 1, add.length, SCHEMA.recipe_items.length).setValues(add.map(o => SCHEMA.recipe_items.map(k => o[k])));
    } else { if (old.length) deleteIdx_(sh_('recipe_items'), old.map(i => i + 1)); appendRows_('recipe_items', add); }
    bust_('recipes'); bust_('recipe_items'); bump_();
    return {recipe: rec, items: add};
  });
}
function productionCreate_(p, s) {
  const rec = tbl_('recipes').find(r => r.id === p.recipe_id && active_(r)); if (!rec) throw new Error('Resep tidak ditemukan.');
  const batch = Number(p.jumlah_batch); if (!(batch > 0)) throw new Error('Jumlah batch harus lebih dari 0.');
  const jenis = ['batch', 'pesanan', 'repack'].indexOf(p.jenis) >= 0 ? p.jenis : 'batch';
  return withLock_(() => saveRaw_('production_orders', {tanggal: now_(), jenis: jenis, recipe_id: rec.id, variant_id: rec.variant_id, qty_hasil: 0,
    status: 'rencana', user_id: s.uid, jumlah_batch: batch, qty_standar: Number(rec.hasil_standar) * batch, catatan: p.catatan || ''}, s.uid));
}
function productionCancel_(p, s) {
  return withLock_(() => {
    const sh = sh_('production_orders'), v = sh.getDataRange().getValues(), h = v[0], i = v.findIndex((r, n) => n > 0 && r[0] === p.id);
    if (i < 1) throw new Error('Produksi tidak ditemukan.');
    if (v[i][h.indexOf('status')] !== 'rencana') throw new Error('Hanya produksi berstatus rencana yang bisa dibatalkan.');
    v[i][h.indexOf('status')] = 'batal'; v[i][h.indexOf('updated_at')] = now_(); sh.getRange(i + 1, 1, 1, h.length).setValues([v[i]]);
    audit_(s.uid, 'cancel', 'production_orders', {id: p.id}, null); bump_('stok'); return {id: p.id, status: 'batal'}; // bump: daftar Produksi di perangkat lain ikut berubah
  });
}
function productionComplete_(p, s) {
  return withLock_(() => {
    const osh = sh_('production_orders'), ov = osh.getDataRange().getValues(), oHead = ov[0], oc = k => oHead.indexOf(k);
    const oi = ov.findIndex((r, n) => n > 0 && r[0] === p.id); if (oi < 1) throw new Error('Produksi tidak ditemukan.');
    if (ov[oi][oc('status')] !== 'rencana') throw new Error('Produksi ini sudah berstatus ' + ov[oi][oc('status')] + '.');
    const qty = Number(p.qty_hasil); if (!(qty > 0)) throw new Error('Hasil aktual harus lebih dari 0.');
    const batch = Number(ov[oi][oc('jumlah_batch')]), rec = readAll_('recipes').find(r => r.id === ov[oi][oc('recipe_id')]);
    if (!rec) throw new Error('Resep tidak ditemukan.');
    const need = {}; readAll_('recipe_items').filter(i => i.recipe_id === rec.id).forEach(i => need[i.material_id] = (need[i.material_id] || 0) + Number(i.qty) * batch);
    const msh = sh_('materials'), mv = msh.getDataRange().getValues(), mc = k => mv[0].indexOf(k), rowOf = {}; for (let i = 1; i < mv.length; i++) rowOf[mv[i][0]] = i;
    let bahan = 0, kem = 0; const short = [], moves = [], upd = [], now = now_();
    Object.keys(need).forEach(id => {
      const i = rowOf[id]; if (i === undefined) throw new Error('Bahan resep tidak ditemukan.');
      const q = need[id], stok = Number(mv[i][mc('stok')]) || 0, c = q * (Number(mv[i][mc('hpp_rata2')]) || 0);
      if (r6_(stok) < r6_(q)) short.push(mv[i][mc('nama')] + ' (butuh ' + q + ', stok ' + stok + ')');
      if (mv[i][mc('tipe')] === 'kemasan') kem += c; else bahan += c;
      upd.push({i: i, id: id, stok: r6_(stok - q)});
      moves.push({id: id_(), tanggal: now, tipe: 'produksi', item_tipe: 'bahan', item_id: id, qty: -q, nilai: -c, ref_id: p.id, user_id: s.uid});
    });
    if (short.length) throw new Error('Stok bahan kurang: ' + short.join('; '));
    const blank = x => x === undefined || x === null || x === '', set = settingsMap_();
    const tk = blank(p.tenaga_kerja) ? (Number(rec.tenaga_kerja) || 0) * batch : Number(p.tenaga_kerja);
    const oh = blank(p.overhead) ? (set.metode_overhead === 'per_batch' ? (Number(set.overhead_per_batch) || 0) * batch : (Number(set.overhead_per_unit) || 0) * qty) : Number(p.overhead);
    if (!(tk >= 0) || !(oh >= 0)) throw new Error('Biaya tidak valid.');
    const total = bahan + kem + tk + oh, hppUnit = Math.round(total / qty * 100) / 100;
    const vsh = sh_('product_variants'), vv = vsh.getDataRange().getValues(), vc = k => vv[0].indexOf(k), vi = vv.findIndex((r, n) => n > 0 && r[0] === rec.variant_id);
    if (vi < 1) throw new Error('Produk hasil resep tidak ditemukan.');
    const stokLama = Number(vv[vi][vc('stok')]) || 0, hppLama = Number(vv[vi][vc('hpp_rata2')]) || 0, pos = Math.max(stokLama, 0);
    const hppBaru = Math.round((pos * hppLama + qty * hppUnit) / (pos + qty) * 100) / 100, stokBaru = r6_(stokLama + qty);
    upd.forEach(u => msh.getRange(u.i + 1, mc('stok') + 1).setValue(u.stok));
    vsh.getRange(vi + 1, vc('stok') + 1, 1, 2).setValues([[stokBaru, hppBaru]]);
    moves.push({id: id_(), tanggal: now, tipe: 'produksi', item_tipe: 'varian', item_id: rec.variant_id, qty: qty, nilai: total, ref_id: p.id, user_id: s.uid});
    appendRows_('production_costs', [{id: id_(), production_id: p.id, bahan: bahan, kemasan: kem, tenaga_kerja: tk, overhead: oh, total: total, hpp_per_unit: hppUnit}]);
    appendRows_('stock_movements', moves);
    ov[oi][oc('status')] = 'selesai'; ov[oi][oc('qty_hasil')] = qty; ov[oi][oc('updated_at')] = now; osh.getRange(oi + 1, 1, 1, oHead.length).setValues([ov[oi]]);
    audit_(s.uid, 'produksi', 'production_orders', {id: p.id}, {qty: qty, total: total, hpp_unit: hppUnit}); bump_();
    return {id: p.id, status: 'selesai', qty_hasil: qty, costs: {bahan: bahan, kemasan: kem, tenaga_kerja: tk, overhead: oh, total: total, hpp_per_unit: hppUnit},
      materials: upd.map(u => ({id: u.id, stok: u.stok})), variant: {id: rec.variant_id, stok: stokBaru, hpp_rata2: hppBaru}};
  });
}
function productionList_(p) {
  const list = lastRows_('production_orders', Number(p.limit) || 60).reverse(), oids = {}, costs = {}; list.forEach(o => oids[o.id] = 1);
  rowsByKey_('production_costs', 'production_id', oids).forEach(c => costs[c.production_id] = c); // hanya biaya milik produksi yang ditampilkan, bukan seluruh tabel
  return list.map(o => {
    const c = costs[o.id]; if (c) { o.bahan = c.bahan; o.kemasan = c.kemasan; o.tenaga_kerja = c.tenaga_kerja; o.overhead = c.overhead; o.total = c.total; o.hpp_per_unit = c.hpp_per_unit; }
    return o;
  });
}
