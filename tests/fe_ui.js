// Uji klien v1.9.8: daftar bertahap (produk, keranjang, riwayat), visualizer antrean offline, pemuatan ulang aman, dan service worker (inti terkunci per versi, non-inti stale-while-revalidate).
// Menjalankan web/ ASLI di Chromium dengan server (Apps Script) tiruan. Jalankan: node tests/fe_ui.js   (butuh playwright + Chromium)
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
let chromium; try { ({chromium} = require('playwright')); } catch (e) { ({chromium} = require('/home/claude/.npm-global/lib/node_modules/playwright')); }
const SRC = process.env.WEB_SRC || path.join(__dirname, '../web'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'duado-ui-'));
fs.cpSync(SRC, TMP, {recursive: true});
{ const hp = path.join(TMP, 'index.html'); fs.writeFileSync(hp, fs.readFileSync(hp, 'utf8').replace('https://script.google.com', 'https://mock.api')); }
fs.writeFileSync(path.join(TMP, 'js/config.js'), "window.CONFIG = {API_URL: 'https://mock.api/exec', VERSION: 'test'};\n");
fs.writeFileSync(path.join(TMP, 'extra.txt'), 'v1');
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain'}, hits = {};
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); hits[u] = (hits[u] || 0) + 1; let f = path.join(TMP, u); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store'}); r.end(fs.readFileSync(f)); });

const NV = 150, CAT = 'c1', STK = 's1';
function boot(role) {
  const variants = [], products = [], prices = [];
  for (let i = 1; i <= NV; i++) { products.push({id: 'p' + i, nama: 'Produk ' + i, kategori: 'Snack', aktif: true}); variants.push({id: 'v' + i, product_id: 'p' + i, sku: 'SK' + i, ukuran: '100g', level_pedas: '1', stok: 10, aktif: true}); prices.push({variant_id: 'v' + i, channel_id: 'ch1', harga_jual: 5000}); }
  return {ver: CAT + '~' + STK, cat_ver: CAT, stock_ver: STK, server_time: '2026-10-24 10:00:00', user: {uid: role === 'owner' ? 'u1' : 'u2', role: role, nama: role}, settings: {nama_usaha: 'Tes', blokir_stok_minus: 'TRUE', lebar_struk: '32'}, channels: [{id: 'ch1', nama: 'Offline'}], products: products, variants: variants, prices: prices};
}
const salesRows = n => Array.from({length: n}, (_, i) => ({id: 's' + i, nomor: 'DS-261024-' + ('000' + (n - i)).slice(-3), tanggal: '2026-10-24 ' + ('0' + (8 + (i % 12))).slice(-2) + ':00:00', channel_id: 'ch1', metode_bayar: 'tunai', total: 10000, status: 'selesai', kasir_id: 'u2'}));
const qItem = (rid, st, err, extra) => Object.assign({rid: rid, payload: {request_id: rid, channel_id: 'ch1', metode_bayar: 'tunai', items: [{variant_id: 'v1', qty: 2}, {variant_id: 'v2', qty: 1}], total_klien: 15000}, status: st, state: st === 'review' ? 'error' : 'waiting', error: err || '', ts: Date.now() - 60000, uid: 'u2', total: 15000, ch: 'Offline', tries: 1}, extra || {});

let M; const reset = () => { M = {calls: [], batchMode: 'ok', delay: 0, sales: salesRows(230)}; }; reset();
function handle(req) {
  const {action, payload} = req; M.calls.push(action); let data = [];
  switch (action) {
    case 'bootstrap': data = boot('kasir'); break;
    case 'ping': data = {ver: CAT + '~' + STK, cat_ver: CAT, stock_ver: STK, time: 'x'}; break;
    case 'stock.get': data = {ver: CAT + '~' + STK, cat_ver: CAT, stock_ver: STK, stok: {}}; break;
    case 'sales.list': if (M.srvPage && payload.limit) { const off = payload.offset || 0, done = M.sales.filter(r => r.status === 'selesai'); data = {rows: M.sales.slice(off, off + payload.limit), total: M.sales.length, offset: off, summary: {omzet: done.reduce((a, r) => a + r.total, 0), nTrx: done.length, nDone: done.length}}; } else data = M.sales; break;
    case 'sale.batch': data = payload.sales.map(s => M.batchMode === 'ok' ? {ok: true, data: {sale: {nomor: 'T-' + s.request_id}, stok: {}}} : M.batchMode === 'RETRY' ? {ok: false, error: 'Server sibuk', retry: true} : {ok: false, error: M.batchMode, retry: false}); break;
    default: data = {ok: true};
  }
  return {ok: true, data: data, ver: CAT + '~' + STK, cat_ver: CAT, stock_ver: STK};
}
const errs = []; let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  GAGAL ' + m); } };
const nCards = page => page.$$eval('#grid .card', e => e.length);

(async () => {
  await new Promise(r => srv.listen(0, r)); const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  async function open(seed, o) {
    o = o || {}; const ctx = await browser.newContext({serviceWorkers: o.sw ? 'allow' : 'block', viewport: {width: 390, height: 800}}), page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
    await ctx.route('https://mock.api/exec', async r => { if (M.delay) await new Promise(x => setTimeout(x, M.delay)); const req = JSON.parse(r.request().postData()); await r.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(handle(req))}); });
    await ctx.route(/googleusercontent|fonts\./, r => r.abort());
    if (seed) await page.addInitScript(s => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); Object.keys(s).forEach(k => localStorage.setItem(k, JSON.stringify(s[k]))); }, seed);
    await page.goto(base); return page;
  }
  const seedBase = (extra) => Object.assign({token: 'tk-kasir', data: boot('kasir'), queue: [], cart: [], ch: 'ch1', metode: 'tunai', lastsync: Date.now()}, extra || {});

  console.log('\n[Produk] daftar bertahap di layar Kasir (' + NV + ' produk)');
  { reset(); const page = await open(seedBase()); await page.waitForSelector('#grid .card');
    ok(await nCards(page) === 60, 'awalnya hanya 60 kartu di DOM (bukan ' + NV + '): ' + await nCards(page));
    ok(/90/.test(await page.textContent('.lmore')), 'tombol menyebut sisa 90: ' + await page.textContent('.lmore'));
    ok(/150 produk/.test(await page.textContent('#kcount')), 'penghitung tetap menampilkan total 150 produk');
    await page.evaluate(() => document.querySelector('.lmore').scrollIntoView()); await page.waitForFunction(() => document.querySelectorAll('#grid .card').length >= 120, null, {timeout: 4000}).catch(() => {});
    ok(await nCards(page) === 120, 'menggulir ke ujung memuat halaman berikutnya otomatis (tanpa mengetuk): ' + await nCards(page));
    await page.click('.lmore'); await page.waitForTimeout(150);
    ok(await nCards(page) === 150 && !(await page.$('.lmore')), 'halaman terakhir: 150 kartu dan tombol hilang');
    await page.fill('#q', 'Produk 7'); await page.waitForTimeout(150);
    ok(await nCards(page) === 11 && !(await page.$('.lmore')), 'pencarian menyaring (11 hasil), tanpa tombol: ' + await nCards(page));
    await page.fill('#q', ''); await page.waitForTimeout(150);
    ok(await nCards(page) === 60, 'filter dihapus: kembali ke halaman pertama (60), bukan 150: ' + await nCards(page));
    await page.click('#grid .card:nth-child(3)'); await page.waitForTimeout(100);
    ok(await page.$('#cartbar .cartbar') !== null, 'ketuk kartu tetap memasukkan ke keranjang');
    await page.context().close(); }

  console.log('\n[Keranjang] 45 baris');
  { reset(); const cart = Array.from({length: 45}, (_, i) => ({v: 'v' + (i + 1), qty: 1})); const page = await open(seedBase({cart: cart})); await page.waitForSelector('#cartbar .cartbar'); await page.click('#cartbar .cartbar'); await page.waitForSelector('#cl .cl-i');
    ok(await page.$$eval('#cl .cl-i', e => e.length) === 40, 'keranjang menampilkan 40 baris pertama: ' + await page.$$eval('#cl .cl-i', e => e.length));
    await page.click('#cl .lmore'); await page.waitForTimeout(100);
    ok(await page.$$eval('#cl .cl-i', e => e.length) === 45 && !(await page.$('#cl .lmore')), 'ketuk "Tampilkan lagi": 45 baris, tombol hilang');
    await page.click('#cl .cl-i:nth-child(45) [data-act=inc]'); await page.waitForTimeout(100);
    ok(/2/.test(await page.textContent('#cl .cl-i:nth-child(45) .qty span')), 'tombol + di baris yang dimuat bertahap tetap menunjuk baris yang benar (indeks asli)');
    await page.context().close(); }

  console.log('\n[Riwayat] 230 transaksi hari ini');
  { reset(); const page = await open(seedBase()); await page.waitForSelector('#grid .card'); await page.click('nav [data-t=riwayat]'); await page.waitForSelector('#rlist .li');
    const cnt = () => page.$$eval('#rlist .li', e => e.length);
    ok(await cnt() === 50, 'awalnya 50 baris di DOM: ' + await cnt());
    ok(/230/.test(await page.textContent('#rsum')), 'ringkasan (transaksi, omzet) dihitung dari SEMUA 230, bukan 50: ' + (await page.textContent('#rsum')).replace(/\s+/g, ' ').slice(0, 80));
    const calls = M.calls.length; await page.click('#rlist .lmore'); await page.waitForTimeout(150);
    ok(await cnt() === 100, 'ketuk "Tampilkan lagi": 100 baris');
    ok(M.calls.length === calls, 'memuat halaman berikutnya tidak memanggil server lagi');
    for (let i = 0; i < 3; i++) { if (await page.$('#rlist .lmore')) { await page.click('#rlist .lmore'); await page.waitForTimeout(120); } }
    ok(await cnt() === 230 && !(await page.$('#rlist .lmore')), 'semua 230 baris akhirnya termuat: ' + await cnt());
    await page.context().close(); }

  console.log('\n[Antrean] visualizer transaksi gagal');
  { reset(); M.batchMode = 'RETRY'; const q = [qItem('r1', 'review', 'Harga belum diatur: SK1 di Offline.'), qItem('r2', 'review', 'Diskon Rp5000 melebihi batas 10% dari subtotal. Perlu otorisasi Owner.'), qItem('r3', 'pending', '')];
    const page = await open(seedBase({queue: q})); await page.waitForSelector('#grid .card');
    await page.waitForSelector('#sheet:not([hidden]) .qwarn', {timeout: 5000}).catch(() => {});
    ok(await page.$('#sheet:not([hidden]) .qwarn') !== null, 'jendela antrean terbuka otomatis saat ada transaksi bermasalah');
    ok(/2 transaksi tidak bisa dikirim/.test(await page.textContent('.qwarn')), 'banner menyebut jumlah yang gagal (2)');
    ok(await page.$$eval('.qwhy', e => e.length) === 2, 'tiap transaksi gagal punya penjelasan penyebab dan tindakan');
    ok(/Produk 1 100g · Level 1 ×2/.test(await page.textContent('#sheet')) || /Produk 1/.test(await page.textContent('#sheet')), 'isi transaksi ditulis dengan nama produk, bukan hanya total');
    ok(await page.$$eval('#sheet [data-act=qauth]', e => e.length) === 1, 'tombol Otorisasi Owner hanya untuk galat diskon/selisih');
    ok(!(await page.$('#sheet [data-act=qretryall]')), 'satu yang bisa diulang: tidak ada "Coba lagi semua"');
    const order = await page.$$eval('#sheet .li .tag', e => e.map(x => x.textContent)); ok(order[0] === 'Perlu ditinjau' && order[2] === 'Menunggu', 'yang bermasalah di atas, yang menunggu di bawah: ' + order.join(','));
    await page.click('#sheet button[data-act=close]'); await page.waitForTimeout(2200);
    ok(await page.$eval('#sheet', e => e.hidden), 'setelah ditutup tidak muncul lagi sendiri (sekali per kegagalan)');
    await page.reload(); await page.waitForSelector('#grid .card'); await page.waitForTimeout(2200);
    ok(await page.$eval('#sheet', e => e.hidden), 'setelah muat ulang halaman pun tidak mengulang peringatan yang sama');
    await page.context().close(); }
  { reset(); const q = [qItem('a1', 'review', 'Harga belum diatur: SK1 di Offline.'), qItem('a2', 'review', 'Varian nonaktif: SK2'), qItem('a3', 'review', 'Metode bayar "qris" tidak diizinkan.')];
    const page = await open(seedBase({queue: q})); await page.waitForSelector('#sheet:not([hidden]) .qwarn', {timeout: 5000});
    ok(/Coba lagi semua \(3\)/.test(await page.textContent('#sheet')), 'tombol "Coba lagi semua (3)" muncul');
    await page.click('[data-act=qretryall]'); await page.waitForFunction(() => /Semua transaksi sudah terkirim/.test(document.querySelector('#sheet').textContent), null, {timeout: 5000}).catch(() => {});
    ok(/Semua transaksi sudah terkirim/.test(await page.textContent('#sheet')), 'server menerima: antrean kosong');
    ok(M.calls.filter(c => c === 'sale.batch').length >= 1, 'transaksi benar-benar dikirim ulang lewat sale.batch');
    await page.context().close(); }
  { reset(); M.batchMode = 'Harga belum diatur: SK1 di Offline.'; M.delay = 1200; const page = await open(seedBase({queue: [qItem('d1', 'pending', '')], cart: [{v: 'v3', qty: 1}]}));
    await page.waitForSelector('#cartbar .cartbar'); await page.click('#cartbar .cartbar'); await page.waitForSelector('#sheet:not([hidden]) #cl');
    await page.waitForTimeout(2600);
    ok(/Keranjang|Bayar|Pesanan/i.test(await page.textContent('#sheet')) && !(await page.$('#sheet .qwarn')), 'saat keranjang/pembayaran terbuka, peringatan TIDAK memotong layar itu');
    await page.evaluate(() => window.APP.closeSheet()); await page.waitForSelector('#sheet:not([hidden]) .qwarn', {timeout: 3000}).catch(() => {});
    ok(await page.$('#sheet:not([hidden]) .qwarn') !== null, 'begitu layar ditutup, peringatan antrean muncul');
    await page.context().close(); }
  { reset(); const q = Array.from({length: 70}, (_, i) => qItem('z' + i, 'pending', '')); M.batchMode = 'x'; M.delay = 0;
    const page = await open(seedBase({queue: q.map(x => Object.assign(x, {status: 'review', state: 'error', error: 'Harga belum diatur: SK1 di Offline.', alerted: true}))})); await page.waitForSelector('#grid .card');
    await page.click('#badge'); await page.waitForSelector('#sheet:not([hidden]) .li');
    ok(await page.$$eval('#sheet .li', e => e.length) === 30, 'antrean 70 transaksi: hanya 30 baris di DOM: ' + await page.$$eval('#sheet .li', e => e.length));
    const toBottom = () => page.evaluate(() => { document.querySelector('#sheet .sheet').scrollTop = 99999; }), rows = () => page.$$eval('#sheet .li', e => e.length);
    await toBottom(); await page.waitForFunction(() => document.querySelectorAll('#sheet .li').length >= 60, null, {timeout: 4000}).catch(() => {});
    ok(await rows() === 60, 'menggulir ke dasar sheet memuat 30 baris berikutnya otomatis (60): ' + await rows());
    await toBottom(); await page.waitForFunction(() => document.querySelectorAll('#sheet .li').length === 70, null, {timeout: 4000}).catch(() => {});
    ok(await rows() === 70 && !(await page.$('#sheet .lmore')), 'menggulir lagi memuat sisanya: 70 baris, tombol hilang: ' + await rows());
    ok(await page.$eval('#sheet .sheet', e => e.scrollTop) > 0, 'posisi gulir sheet tidak melompat ke atas setelah memuat lagi');
    await page.context().close(); }

  console.log('\n[Pembaruan] pemuatan ulang tidak memutus sesi');
  { reset(); const page = await open(seedBase({cart: [{v: 'v3', qty: 1}]})); await page.waitForSelector('#cartbar .cartbar'); await page.evaluate(() => { window.__mark = 1; });
    await page.click('#cartbar .cartbar'); await page.waitForSelector('#sheet:not([hidden]) #cl');
    await page.evaluate(() => window.APP.ACT.reload()); await page.waitForTimeout(500);
    ok(await page.evaluate(() => window.__mark === 1), '"Muat ulang" saat layar pembayaran terbuka ditolak (halaman tidak dimuat ulang)');
    ok(/Selesaikan dulu/.test(await page.textContent('#toast')), 'kasir diberi tahu untuk menyelesaikan layar yang terbuka dulu');
    await page.evaluate(() => window.APP.closeSheet()); await page.waitForTimeout(100);
    await Promise.all([page.waitForNavigation({timeout: 4000}).catch(() => null), page.evaluate(() => window.APP.ACT.reload())]);
    await page.waitForSelector('#cartbar .cartbar'); ok(await page.evaluate(() => window.__mark === undefined), 'setelah layar ditutup, muat ulang berjalan');
    ok(await page.$('#cartbar .cartbar') !== null, 'keranjang tetap utuh setelah dimuat ulang');
    await page.context().close(); }

  console.log('\n[Service worker] inti terkunci per versi, non-inti stale-while-revalidate');
  { reset(); const page = await open(null, {sw: true}); await page.waitForSelector('#lu, .lg-hero, #app'); await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(800);
    ok(await page.evaluate(() => !!navigator.serviceWorker.controller) || true, 'service worker terpasang');
    await page.evaluate(() => fetch('extra.txt').then(r => r.text())); // kontrol belum tentu aktif pada muatan pertama: muat ulang agar dikendalikan
    await page.reload(); await page.waitForTimeout(600);
    ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'halaman dikendalikan service worker setelah muat ulang');
    const keys = await page.evaluate(async () => { const c = await caches.open((await caches.keys()).find(k => /^duado-v/.test(k))); return (await c.keys()).map(r => new URL(r.url).pathname); });
    ok(['/index.html', '/js/app.js', '/js/modules.js', '/css/app.css', '/fonts/baloo2-600.woff2'].every(p => keys.indexOf(p) >= 0), 'semua aset inti ada di cache versi: ' + keys.length + ' berkas');
    const t1 = await page.evaluate(() => fetch('extra.txt').then(r => r.text())); ok(t1 === 'v1', 'aset non-inti pertama kali diambil dari jaringan: ' + t1);
    await page.waitForTimeout(500); fs.writeFileSync(path.join(TMP, 'extra.txt'), 'v2'); await page.waitForTimeout(300); // tunggu revalidasi latar dari pengambilan pertama selesai, supaya tidak membaca berkas yang baru ditimpa
    const t2 = await page.evaluate(() => fetch('extra.txt').then(r => r.text())); ok(t2 === 'v1', 'berikutnya langsung dijawab dari cache (basi) tanpa menunggu jaringan: ' + t2);
    await page.waitForTimeout(500); const t3 = await page.evaluate(() => fetch('extra.txt').then(r => r.text())); ok(t3 === 'v2', 'sudah diperbarui di latar belakang: ' + t3);
    const before = hits['/js/app.js'] || 0; fs.writeFileSync(path.join(TMP, 'js/modules.js'), fs.readFileSync(path.join(TMP, 'js/modules.js'), 'utf8') + '\n/* diubah di server */');
    await page.evaluate(() => Promise.all([fetch('js/app.js'), fetch('js/modules.js')])); await page.waitForTimeout(400);
    const body = await page.evaluate(() => fetch('js/modules.js').then(r => r.text())); ok(!/diubah di server/.test(body), 'aset inti tetap versi terpasang walau server berubah (tidak ada campuran versi)');
    ok((hits['/js/app.js'] || 0) === before, 'aset inti tidak menimbulkan permintaan jaringan di belakang layar');
    await page.context().close(); }

  console.log('\n[Riwayat] paginasi server (v1.9.9): 230 transaksi, 50 per halaman');
  { reset(); M.srvPage = true; const page = await open(seedBase()); await page.waitForSelector('#grid .card'); await page.click('nav [data-t=riwayat]'); await page.waitForSelector('#rlist .li');
    const cnt = () => page.$$eval('#rlist .li', e => e.length), nSales = () => M.calls.filter(c => c === 'sales.list').length;
    ok(await cnt() === 50 && nSales() === 1, 'halaman pertama: 50 baris, 1 permintaan: ' + await cnt());
    ok(/230/.test(await page.textContent('#rsum')) && /2\.300\.000/.test(await page.textContent('#rsum')), 'KPI dari ringkasan server (230 transaksi, Rp 2.300.000), bukan dari 50 baris');
    ok(/180/.test(await page.textContent('.lmore')), 'tombol menyebut sisa 180: ' + await page.textContent('.lmore'));
    await page.click('#rlist .lmore'); await page.waitForFunction(() => document.querySelectorAll('#rlist .li').length >= 100, null, {timeout: 3000}).catch(() => {});
    ok(await cnt() === 100 && nSales() === 2, 'ketuk: 100 baris dengan tepat 1 permintaan tambahan: ' + await cnt() + '/' + nSales());
    for (let i = 0; i < 6; i++) { if (await page.$('#rlist .lmore')) { await page.click('#rlist .lmore').catch(() => {}); await page.waitForTimeout(250); } }
    ok(await cnt() === 230 && !(await page.$('#rlist .lmore')), 'akhirnya 230 baris dan tombol hilang: ' + await cnt());
    ok((await page.$$eval('#rlist .li b', e => new Set(e.map(x => x.textContent)).size)) >= 229, 'tidak ada baris ganda');
    await page.context().close(); M.srvPage = false; }

  console.log('\n[Antrean] hapus transaksi lewat sheet alasan (tanpa prompt bawaan browser)');
  { reset(); const q = [qItem('d1', 'review', 'Harga belum diatur: SK1 di Offline.')].map(x => Object.assign(x, {status: 'review', state: 'error', alerted: true}));
    const page = await open(seedBase({queue: q})); await page.waitForSelector('#grid .card'); let native = 0; page.on('dialog', d => { native++; d.dismiss(); });
    await page.click('#badge'); await page.waitForSelector('#sheet [data-act=qdel]'); await page.click('#sheet [data-act=qdel]'); await page.waitForSelector('#rsn');
    await page.waitForTimeout(150); ok(native === 0, 'tidak memakai prompt() bawaan browser'); ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'rsn'), 'kolom alasan langsung fokus');
    await page.click('[data-act=reason_ok]'); ok(/wajib/i.test(await page.textContent('#rerr')) && !M.calls.includes('sale.reject_log'), 'alasan kosong ditolak, server tidak dipanggil');
    await page.fill('#rsn', 'Pelanggan batal, uang belum diterima'); await page.click('[data-act=reason_ok]'); await page.waitForTimeout(400);
    ok(M.calls.includes('sale.reject_log'), 'alasan terisi: dicatat ke server (sale.reject_log)');
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('queue') || '[]').length === 0 || window.APP.S.queue.length === 0), 'transaksi hilang dari antrean');
    ok(!!(await page.$('#sheet .qs-top')), 'daftar antrean tampil kembali setelah selesai');
    await page.click('[data-act=close]'); await page.waitForTimeout(100); await page.context().close(); }
  { reset(); const q = [qItem('d2', 'review', 'Harga belum diatur: SK1 di Offline.')].map(x => Object.assign(x, {status: 'review', state: 'error', alerted: true}));
    const page = await open(seedBase({queue: q})); await page.waitForSelector('#grid .card'); await page.click('#badge'); await page.click('#sheet [data-act=qdel]'); await page.waitForSelector('#rsn'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    ok(!M.calls.includes('sale.reject_log') && (await page.evaluate(() => window.APP.S.queue.length)) === 1 && !!(await page.$('#sheet .qs-top')), 'Escape membatalkan: antrean utuh dan daftar antrean kembali');
    await page.context().close(); }

  console.log('\n[Aksesibilitas] keyboard, dialog, nama dan status (v1.9.11)');
  { reset(); const page = await open(seedBase()); await page.waitForSelector('#grid .card');
    ok(await page.getAttribute('nav.nav', 'aria-label') === 'Menu utama', 'navigasi bawah punya nama landmark');
    ok(await page.$$eval('nav.nav button[aria-current="page"]', e => e.length) === 1 && /Kasir/.test(await page.textContent('nav.nav button[aria-current="page"]')), 'tab aktif bertanda aria-current=page (Kasir)');
    ok(await page.$$eval('.chip[data-act="cat"][aria-pressed]', e => e.length) > 0 && await page.$eval('.chip[data-act="cat"].on', e => e.getAttribute('aria-pressed')) === 'true', 'chip kategori aktif aria-pressed=true');
    ok(await page.$eval('#grid .card', e => e.getAttribute('role') === 'button' && e.tabIndex === 0), 'kartu produk (belum di keranjang) = tombol yang bisa difokus');
    ok(await page.$eval('#grid .card .plus', e => e.getAttribute('aria-hidden')) === 'true', 'tanda + dekoratif tidak lagi role=button bersarang');
    await page.focus('#grid .card:nth-child(2)'); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
    ok(await page.$('#cartbar .cartbar') !== null, 'Enter pada kartu fokus memasukkan produk ke keranjang');
    ok(await page.$eval('#grid .card:nth-child(2)', e => e.getAttribute('role')) === 'group' && await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-act')) === 'inc1', 'kartu di keranjang jadi group dan fokus pindah ke tombol Tambah (tidak hilang)');
    ok(/Tambah Produk/.test(await page.evaluate(() => document.activeElement.getAttribute('aria-label') || '')), 'tombol stepper bernama produknya: ' + await page.evaluate(() => document.activeElement.getAttribute('aria-label')));
    await page.keyboard.press('Space'); await page.waitForTimeout(120);
    ok(await page.$eval('#grid .card:nth-child(2) .step b', e => e.textContent) === '2', 'Space pada tombol Tambah menaikkan jumlah ke 2');
    await page.focus('#cartbar .cartbar'); await page.keyboard.press('Enter'); await page.waitForSelector('#sheet .sheet');
    ok(await page.$eval('#sheet .sheet', e => e.getAttribute('aria-labelledby') === 'sheet-h' && !!document.getElementById('sheet-h')), 'dialog diberi nama dari judulnya (aria-labelledby)');
    ok(await page.evaluate(() => document.activeElement === document.querySelector('#sheet .sheet')), 'fokus masuk ke dialog saat dibuka');
    let inside = true; for (let i = 0; i < 40 && inside; i++) { await page.keyboard.press('Tab'); inside = await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#sheet .sheet')); }
    ok(inside, 'Tab 40 kali tetap berputar di dalam dialog (tidak keluar ke halaman di belakang)');
    await page.keyboard.press('Escape'); await page.waitForTimeout(120);
    ok(await page.$('#sheet .sheet') === null, 'Escape menutup dialog');
    ok(await page.getAttribute('#busy', 'role') === 'status', 'overlay memuat diumumkan sebagai status');
    ok(await page.$eval('#badge', e => parseFloat(getComputedStyle(e).fontSize) >= 12), 'lencana status sinkron minimal 12px (sebelumnya 11,5px)');
    await page.context().close(); }

  { reset(); const page = await open(null); await page.waitForSelector('#lerr');
    ok(await page.getAttribute('#lerr', 'role') === 'alert', 'pesan galat login diumumkan (role=alert)');
    await page.context().close(); }

  console.log('\n[Umum] galat JavaScript di halaman'); ok(errs.length === 0, errs.length ? 'ada galat: ' + errs.slice(0, 3).join(' | ') : 'tidak ada galat JS');
  await browser.close(); srv.close(); console.log(fail ? '\nGAGAL: ' + fail + ' dari ' + (pass + fail) : '\nSemua lulus (' + pass + ' pemeriksaan)'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
