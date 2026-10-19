/* ---------- Kerangka ---------- */
const MENU_TABS = ['menu', 'master', 'users', 'settings', 'resep', 'laporan', 'shopee', 'cek', 'diag', 'arsip', 'tutup'];
function render() {
  if (!S.token || !S.data) return renderLogin();
  const d = S.data; if (!S.ch || !d.channels.some(c => c.id === S.ch)) S.ch = d.channels[0] && d.channels[0].id;
  const o = own(), tabs = o ? [['dash', 'Beranda'], ['kasir', 'Kasir'], ['stok', 'Stok'], ['produksi', 'Produksi'], ['menu', 'Menu']] : [['kasir', 'Kasir'], ['riwayat', 'Riwayat'], ['stok', 'Stok'], ['menu', 'Menu']],
    inMenu = MENU_TABS.concat(o ? ['riwayat'] : []).indexOf(S.tab) >= 0;
  $('#app').innerHTML = '<header class="top"><img class="logo" src="icons/icon-192.png" alt="" width="38" height="38"><div class="brand"><b class="wordmark">' + esc(String(d.settings.nama_usaha || 'Duado Snack').toUpperCase()) + '</b><small>Jajanan Cemilan Pedas</small></div><button class="badge" id="badge" data-act="queue" aria-label="Status sinkronisasi"></button></header><div class="accent"></div><main id="main"></main><div id="cartbar"></div>' +
    '<nav class="nav">' + tabs.map(t => '<button data-act="tab" data-t="' + t[0] + '" class="' + ((S.tab === t[0] || (t[0] === 'menu' && inMenu)) ? 'on' : '') + '"><span class="ni">' + svg(t[0], 22) + '</span><span>' + t[1] + '</span></button>').join('') + '</nav>';
  badge();
  (APP.views[S.tab] || vKasir)();
  cartbar();
}
function badge() {
  const b = $('#badge');
  if (b) {
    const mineQ = S.data ? mineAll() : S.queue, p = mineQ.filter(q => q.status === 'pending').length, r = mineQ.filter(q => q.status === 'review').length, off = !navigator.onLine, busyNow = pending > 0 || mineQ.some(q => q.state === 'sending');
    let cls, txt;
    if (r) { cls = 'warn'; txt = r + ' perlu ditinjau'; }
    else if (off) { cls = 'off'; txt = 'Offline' + (p ? ' · ' + p : ''); }
    else if (busyNow) { cls = 'wait spin'; txt = 'Menyinkronkan'; }
    else if (p) { cls = 'wait'; txt = 'Menunggu kirim ' + p; }
    else { cls = 'ok'; txt = 'Tersinkron'; }
    b.className = 'badge ' + cls; b.textContent = txt;
  }
  qstatUpd(); if (S.qopen && !$('#sheet').hidden) queueSheet();
}
function qstatUpd() {
  const el = $('#qstat'); if (!el) return;
  const mineQ = S.data ? mineAll() : [], p = mineQ.filter(q => q.status === 'pending').length, r = mineQ.filter(q => q.status === 'review').length, sending = mineQ.some(q => q.state === 'sending'), off = !navigator.onLine;
  if (!p && !r && !off) { el.className = ''; el.innerHTML = ''; return; }
  const msg = r ? r + ' transaksi ditolak server, perlu ditinjau' : sending ? 'Mengirim ' + p + ' transaksi…' : off ? (p ? 'Offline: ' + p + ' transaksi tersimpan di perangkat, dikirim otomatis saat online' : 'Mode offline: transaksi tetap tersimpan di perangkat dan dikirim saat online') : p + ' transaksi menunggu dikirim';
  el.className = 'qstat ' + (r ? 'err' : off ? 'off' : 'wait'); el.innerHTML = '<span class="qdot"></span><span class="qt">' + esc(msg) + '</span>' + svg('chev', 16);
}
const qrefresh = () => { if (S.qopen && !$('#sheet').hidden) queueSheet(); else if (S.tab === 'riwayat') vRiwayat(); };
function queueSheet() {
  S.qopen = true; const mineQ = S.data ? mineAll() : S.queue, off = !navigator.onLine;
  const secs = n => n < 60 ? n + ' detik' : Math.round(n / 60) + ' menit', next = S.nextFlush && S.nextFlush > Date.now() ? 'Percobaan otomatis berikutnya sekitar ' + secs(Math.round((S.nextFlush - Date.now()) / 1000)) + '.' : '';
  const item = q => { const i = S.queue.indexOf(q), n = q.payload.items.reduce((a, x) => a + x.qty, 0), st = q.status === 'review' ? '<span class="tag red">Perlu ditinjau</span>' : q.state === 'sending' ? '<span class="tag busy">Mengirim…</span>' : '<span class="tag">Menunggu</span>';
    return '<div class="li" style="display:block"><div class="kv"><b>' + rp(q.total) + '</b>' + st + '</div><div class="muted">' + esc(fmtDT(q.ts).slice(11)) + ' · ' + esc(q.ch) + ' · ' + n + ' item' + (q.tries ? ' · percobaan ke-' + q.tries : '') + '</div>' + (q.error ? '<div style="color:var(--err);font-size:13px">' + esc(q.error) + '</div>' : '') +
      (q.status === 'review' ? '<div class="row2">' + (/^Diskon|^Total struk/.test(q.error || '') ? '<button class="btn pri sm" data-act="qauth" data-i="' + i + '">Otorisasi Owner</button>' : '') + '<button class="btn sec sm" data-act="qretry" data-i="' + i + '">Coba lagi</button><button class="btn dan sm" data-act="qdel" data-i="' + i + '">Hapus</button></div>' : '') + '</div>'; };
  sheet('<div class="grab"></div><h2>Antrean transaksi</h2><div class="qs-top"><span class="tag ' + (off ? '' : 'grn') + '">' + (off ? 'Offline' : 'Online') + '</span><span class="muted">Terakhir sinkron: ' + (S.lastSync ? fmtDT(S.lastSync).slice(11) : '-') + ' · penyimpanan: ' + Store.mode() + '</span></div>' +
    (mineQ.length ? mineQ.map(item).join('') : '<div class="okmark sm">' + svg('check', 22) + '</div><p class="muted" style="text-align:center">Semua transaksi sudah terkirim ke server.</p>') + (next ? '<p class="muted">' + next + '</p>' : '') +
    (mineQ.some(q => q.status === 'pending') ? '<button class="btn pri" data-act="qnow">Kirim sekarang</button>' : '') + '<button class="btn sec" data-act="close">Tutup</button>');
  S.qopen = true;
}

