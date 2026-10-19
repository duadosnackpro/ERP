/* ===== Impor pesanan Shopee (dari CSV yang sudah dipetakan di aplikasi). Aman diimpor ulang: request_id = SHP-<no pesanan>. ===== */
function shopeeImport_(p, s) {
  const orders = p.orders || []; if (orders.length > 25) throw new Error('Maksimal 25 pesanan per permintaan.');
  const ch = tbl_('channels').find(c => /shopee/i.test(c.nama) && active_(c)); if (!ch) throw new Error('Channel Shopee tidak ditemukan. Tambahkan di Data Master, Channel.');
  return withLock_(() => {
    const bySku = {}; readAll_('product_variants').forEach(v => { bySku[String(v.sku).trim().toLowerCase()] = v; });
    const res = {ok: 0, duplikat: 0, gagal: []};
    orders.forEach(o => {
      try {
        const items = (o.items || []).map(i => { const v = bySku[String(i.sku || '').trim().toLowerCase()]; if (!v) throw new Error('SKU tidak dikenal: ' + i.sku); return {variant_id: v.id, qty: Number(i.qty), harga: i.harga}; });
        const r = saleCore_({request_id: 'SHP-' + o.order_id, channel_id: ch.id, items: items, metode_bayar: 'marketplace', catatan: 'Shopee ' + o.order_id}, s, {import: true, abaikanStok: p.abaikan_stok !== false, tanggal: o.tanggal, feeAktual: o.fee});
        if (r.duplicate || r.cached) res.duplikat++; else res.ok++;
      } catch (e) { res.gagal.push({order_id: o.order_id, error: String(e.message || e)}); }
    });
    return res;
  });
}
