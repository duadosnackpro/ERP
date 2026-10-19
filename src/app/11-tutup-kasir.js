/* ---------- Tutup kasir ---------- */
async function vTutup() {
  const back = '<button class="chip" data-act="tab" data-t="menu">← Menu</button>';
  $('#main').innerHTML = back + '<div class="li" style="display:block;margin-top:8px"><b>Tutup kasir</b><p class="muted">Hitung uang tunai di laci lebih dulu, isi jumlahnya, lalu tutup. Rekap penjualan baru tampil setelah penutupan (hitung buta) agar selisihnya jujur.</p></div><div id="tbody">' + skel(3) + '</div>';
  const unsent = mineAll().length;
  if (unsent) { flush(); $('#tbody').innerHTML = '<div class="notice"><span>Masih ada ' + unsent + ' transaksi yang belum terkirim ke server. Kirim dulu agar rekap lengkap.</span><button class="chip" data-act="tab" data-t="tutup">Periksa lagi</button></div><button class="btn pri" data-act="qnow">Kirim sekarang</button>'; return; }
  await vload('shift.summary', {}, r => {
    if (S.tab !== 'tutup' || !$('#tbody')) return; const typed = $('#tf') && ($('#tf').value || ($('#tk') || {}).value || ($('#tn') || {}).value); S.shift = r; if (typed) return; /* jangan menimpa isian yang sedang diketik */ const kv = (a, b) => '<div class="kv"><span>' + a + '</span><span>' + b + '</span></div>';
    $('#tbody').innerHTML = '<div class="li" style="display:block">' + kv('Sejak', esc(String(r.dari).slice(0, 16))) + kv('Jumlah transaksi', num(r.jumlah_trx)) + '</div>' +
      '<label>Modal awal laci (Rp)<input class="inp" id="tm" inputmode="numeric" placeholder="0" value="' + (r.modal_terakhir ? esc(r.modal_terakhir) : '') + '"></label>' +
      '<label>Kas keluar tunai selama shift (Rp)<input class="inp" id="tk" inputmode="numeric" placeholder="0"></label><p class="muted" style="margin:-4px 0 6px">Mis. beli es batu atau plastik memakai uang laci.</p>' +
      '<label>Uang tunai di laci sekarang (Rp)<input class="inp" id="tf" inputmode="numeric" placeholder="Hitung dulu, lalu isi"></label><label>Catatan (opsional)<input class="inp" id="tn"></label><button class="btn pri big" data-act="tclose">Tutup kasir</button><div id="tlist"></div>';
    tutupList();
  }, {fail: e => { if ($('#tbody')) $('#tbody').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }});
}
async function tutupList() { await vload('shift.list', {}, L => { let el = $('#tlist'); if (!el && $('#tbody')) { el = document.createElement('div'); el.id = 'tlist'; $('#tbody').appendChild(el); } if (!el) return; const h = '<h3 style="margin:14px 0 6px">Penutupan terakhir</h3>' + (L.length ? L.slice(0, 10).map(x => '<div class="li" style="display:block"><div class="kv"><b>' + esc(x.kasir) + '</b><span>' + esc(String(x.sampai).slice(0, 16)) + '</span></div><div class="muted">' + num(x.jumlah_trx) + ' trx · total ' + rp(x.total_semua) + ' · tunai laci ' + rp(x.uang_fisik) + (own() ? ' · modal ' + rp(x.modal_awal) + (x.fisik_sebelumnya != null && Math.abs(Number(x.modal_awal) - x.fisik_sebelumnya) > 0.5 ? ' (sisa laci sebelumnya ' + rp(x.fisik_sebelumnya) + ')' : '') + (Number(x.kas_keluar) > 0 ? ' · kas keluar ' + rp(x.kas_keluar) : '') : '') + ' · selisih <b style="color:' + (Number(x.selisih_tunai) === 0 ? 'var(--ok)' : 'var(--err)') + '">' + rp(x.selisih_tunai) + '</b></div></div>').join('') : '<p class="muted">Belum ada.</p>'); el.innerHTML = h; }); }
async function tutupSimpan() {
  const v = dnum(($('#tf') || {}).value), opt = id => { const x = ($(id) || {}).value; return x === '' || x == null ? 0 : dnum(x); }, modal = opt('#tm'), keluar = opt('#tk');
  if (isNaN(v) || v < 0 || ($('#tf') || {}).value === '') return toast('Isi jumlah uang tunai di laci');
  if (isNaN(modal) || modal < 0 || isNaN(keluar) || keluar < 0) return toast('Modal awal dan kas keluar harus berupa angka 0 atau lebih');
  if (mineAll().length) return toast('Masih ada transaksi belum terkirim');
  return busy('Menutup kasir…', async () => { try { const r = await api('shift.close', {uang_fisik: v, modal_awal: modal, kas_keluar: keluar, catatan: ($('#tn') || {}).value || ''}); const d = r.selisih_tunai, kv = (a, b) => '<div class="kv"><span>' + a + '</span><span>' + b + '</span></div>';
    $('#tbody').innerHTML = '<div class="okmark">' + svg('check', 30) + '</div><h2 class="c">Kasir ditutup</h2><div class="li" style="display:block">' + kv('Jumlah transaksi', num(r.jumlah_trx)) + kv('Tunai (setelah retur)', rp(r.tunai)) + kv('Transfer', rp(r.transfer)) + kv('QRIS', rp(r.qris)) + (r.lain ? kv('Lainnya', rp(r.lain)) : '') + (r.retur ? kv('Retur di shift ini', rp(r.retur)) : '') + kv('<b>Total</b>', '<b>' + rp(r.total) + '</b>') + '</div>' +
      '<div class="li" style="display:block">' + kv('Modal awal', rp(r.modal_awal)) + kv('Kas keluar', rp(r.kas_keluar)) + kv('Tunai seharusnya di laci', rp(r.tunai_diharapkan)) + kv('Uang di laci', rp(r.uang_fisik)) + '</div>' +
      '<div class="rc-sum"><div><small>Selisih tunai</small><b style="color:' + (d === 0 ? 'var(--ok)' : 'var(--err)') + '">' + (d > 0 ? '+' : '') + rp(d) + '</b></div></div><p class="muted c">' + (d === 0 ? 'Uang laci sesuai.' : d > 0 ? 'Uang laci lebih dari catatan.' : 'Uang laci kurang dari catatan.') + '</p><div id="tlist"></div>'; tutupList(); } catch (e) { toast(e.message); } });
}

