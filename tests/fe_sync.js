// Uji klien v1.9.5: sinkronisasi hanya bila ada data baru. Menjalankan web/ ASLI di Chromium dengan server (Apps Script) tiruan yang menghitung permintaan.
// Jalankan: node tests/fe_sync.js   (butuh playwright; CHROMIUM sudah terpasang di PLAYWRIGHT_BROWSERS_PATH)
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
let chromium; try { ({chromium} = require('playwright')); } catch (e) { ({chromium} = require('/home/claude/.npm-global/lib/node_modules/playwright')); }

// ---- salin web/ ke folder sementara dengan API_URL tiruan ----
const SRC = process.env.WEB_SRC || path.join(__dirname, '../web'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'duado-'));
fs.cpSync(SRC, TMP, {recursive: true});
{ const hp = path.join(TMP, 'index.html'); fs.writeFileSync(hp, fs.readFileSync(hp, 'utf8').replace('https://script.google.com', 'https://mock.api')); } // CSP ASLI dipakai; hanya host API diganti ke server tiruan (pelanggaran CSP = galat konsol = uji gagal)
fs.writeFileSync(path.join(TMP, 'js/config.js'), "window.CONFIG = {API_URL: 'https://mock.api/exec', VERSION: 'test'};\n");
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2'};
const srv = http.createServer((q, r) => { let f = path.join(TMP, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'}); r.end(fs.readFileSync(f)); });

// ---- server tiruan ----
let uid = 0; const nv = p => p + (++uid);
const M = {cat: nv('c'), stock: nv('s'), stok: 10, calls: []};
const dash = () => ({period: 'hari', from: '2026-10-18', to: '2026-10-18', pfrom: '2026-10-17', pto: '2026-10-17', cur: {omzet: 50000, trx: 2, hpp: 20000, fee: 0, laba: 30000}, prev: {omzet: 0, trx: 0, hpp: 0, fee: 0, laba: 0}, series: [{d: '2026-10-18', omzet: 50000, laba: 30000}], channels: [{nama: 'Offline', omzet: 50000}], top: [{nama: 'Keripik', qty: 3}], low: [], stok_minus: [], laba_bersih: 30000, biaya: 0, peringatan: []});
function boot(role) {
  const d = {ver: M.cat + '~' + M.stock, cat_ver: M.cat, stock_ver: M.stock, server_time: '2026-10-18 10:00:00', user: {uid: role === 'owner' ? 'u1' : 'u2', role: role, nama: role}, settings: {nama_usaha: 'Tes', blokir_stok_minus: 'TRUE', lebar_struk: '32'},
    channels: [{id: 'ch1', nama: 'Offline'}], products: [{id: 'p1', nama: 'Keripik', kategori: 'Snack', aktif: true}], variants: [{id: 'v1', product_id: 'p1', sku: 'KRP', ukuran: '100g', level_pedas: '1', stok: M.stok, aktif: true, hpp_rata2: 1000}],
    prices: [{variant_id: 'v1', channel_id: 'ch1', harga_jual: 5000}]};
  if (role === 'owner') Object.assign(d, {materials: [], suppliers: [], recipes: [], recipe_items: []}); return d;
}
const roleOf = {}; // token -> role
function handle(req) {
  const {action, token, payload} = req, prev = {cat: M.cat, stock: M.stock}; M.calls.push(action); let data = null, bump = null;
  switch (action) {
    case 'login': { const role = payload.username === 'owner' ? 'owner' : 'kasir', tk = 'tk-' + role; roleOf[tk] = role; data = {token: tk, uid: role === 'owner' ? 'u1' : 'u2', role: role}; break; }
    case 'bootstrap': data = boot(roleOf[token]); break;
    case 'ping': data = {ver: M.cat + '~' + M.stock, cat_ver: M.cat, stock_ver: M.stock, time: 'x'}; break;
    case 'stock.get': data = {ver: M.cat + '~' + M.stock, cat_ver: M.cat, stock_ver: M.stock, stok: {v1: M.stok}}; break;
    case 'dashboard.get': data = dash(); break;
    case 'sales.list': data = []; break;
    case 'report.get': data = {type: payload.type, title: 'T', from: payload.from, to: payload.to, columns: [], summary: [], rows: [], fmt: []}; M.calls.push('report.' + payload.type); break;
    case 'production.list': data = []; break;
    case 'user.list': data = [{id: 'u1', nama: 'Owner', username: 'owner', role: 'owner', aktif: true, terkunci: false}]; break;
    case 'shift.summary': data = {dari: '2026-10-18 08:00:00', jumlah_trx: 2, modal_terakhir: 0}; break;
    case 'shift.list': data = []; break;
    case 'archive.status': data = {sel: 100, batas: 10000000, persen: 1, kandidat: [], tabel: [], bulan: 13, cutoff: '2025-09-18'}; break;
    case 'master.list': data = []; break;
    case 'sale.batch': M.stock = nv('s'); M.stok -= 1; data = payload.sales.map(() => ({ok: true, data: {sale: {nomor: 'T-1'}, stok: {v1: M.stok}}})); break;
    case 'logout': data = {ok: true}; break;
    default: data = [];
  }
  return {ok: true, data: data, ver: M.cat + '~' + M.stock, ver_prev: prev.cat + '~' + prev.stock, cat_ver: M.cat, cat_prev: prev.cat, stock_ver: M.stock, stock_prev: prev.stock};
}
// Mode OLD_SERVER=1: meniru backend sebelum 1.8.x (hanya `ver` gabungan, tanpa cat_ver/stock_ver dan tanpa stock.get) untuk uji kompatibilitas web baru
const OLD = !!process.env.OLD_SERVER;
function respond(req) {
  if (!OLD) return handle(req);
  if (req.action === 'stock.get') { M.calls.push('stock.get'); return {ok: false, error: 'Aksi tidak dikenal: stock.get'}; }
  const r = handle(req); ['cat_ver', 'cat_prev', 'stock_ver', 'stock_prev'].forEach(k => delete r[k]);
  if (req.action === 'bootstrap') { delete r.data.cat_ver; delete r.data.stock_ver; } if (req.action === 'ping') { delete r.data.cat_ver; delete r.data.stock_ver; } return r;
}
// perubahan dari "perangkat lain"
const otherSale = () => { M.stock = nv('s'); M.stok -= 3; }, otherCatalog = () => { M.cat = nv('c'); M.stock = nv('s'); };

const errs = []; let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  GAGAL ' + m); } };
const n = a => M.calls.filter(x => x === a).length, snap = () => ({ping: n('ping'), boot: n('bootstrap'), stock: n('stock.get'), dash: n('dashboard.get'), sales: n('sales.list'), login: n('login')});
const diff = (a, b) => Object.keys(b).filter(k => b[k] !== a[k]).map(k => k + '+' + (b[k] - a[k])).join(' ') || '(tidak ada)';

(async () => {
  await new Promise(r => srv.listen(0, r)); const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  async function open() {
    const ctx = await browser.newContext({serviceWorkers: 'block', viewport: {width: 390, height: 800}}), page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
    await page.route('https://mock.api/exec', async r => { const req = JSON.parse(r.request().postData()); const body = JSON.stringify(respond(req)); await r.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body}); });
    await page.route(/googleusercontent|fonts\./, r => r.abort());
    await page.clock.install(); await page.goto(base); return page;
  }
  const login = async (page, user) => { await page.fill('#lu', user); await page.fill('#lp', '123456'); await page.click('[data-act=login]'); };
  const ff = async (page, ms) => { await page.clock.fastForward(ms); await page.waitForTimeout(150); };
  const settle = page => page.waitForTimeout(350);
  const tab = async (page, t) => { await page.click('nav [data-t=' + t + ']'); await settle(page); };

  if (OLD) {
    console.log('\n[Server lama] Owner');
    M.calls = []; let pg = await open(); await login(pg, 'owner'); await pg.waitForSelector('#dbody .kpi', {timeout: 5000}); await settle(pg);
    let x = snap(); ok(x.boot === 1 && x.dash === 1, 'login + Beranda: 1 bootstrap, 1 dashboard (' + JSON.stringify(x) + ')');
    await tab(pg, 'kasir'); await tab(pg, 'dash'); let y = snap(); ok(diff(x, y) === '(tidak ada)', 'dibuka ulang cepat: 0 permintaan (' + diff(x, y) + ')');
    await ff(pg, 20000); x = snap(); await tab(pg, 'kasir'); await tab(pg, 'dash'); y = snap(); ok(y.ping - x.ping === 1 && y.dash === x.dash && y.boot === x.boot, 'tanpa data baru: 1 ping saja (' + diff(x, y) + ')');
    otherSale(); await ff(pg, 20000); x = snap(); await tab(pg, 'kasir'); await tab(pg, 'dash'); await pg.waitForTimeout(300); y = snap(); ok(y.boot - x.boot === 1 && y.dash - x.dash === 1, 'ada data baru: muat penuh 1x + dashboard 1x, tanpa galat (' + diff(x, y) + ')');
    await pg.close(); pg = await open(); await login(pg, 'kasir'); await pg.waitForSelector('#grid .card'); await settle(pg); x = snap();
    await pg.evaluate(() => window.APP.ACT.sync()); await pg.waitForTimeout(500); y = snap(); ok(y.boot === x.boot && y.ping - x.ping === 1, 'Kasir Perbarui data tanpa data baru: 1 ping, tanpa bootstrap (' + diff(x, y) + ')');
    ok(errs.length === 0, 'tidak ada galat JS' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : '')); await browser.close(); srv.close(); fs.rmSync(TMP, {recursive: true, force: true});
    console.log(fail ? `\n${fail} GAGAL, ${pass} lulus` : `\nSemua lulus (${pass} pemeriksaan)`); process.exit(fail ? 1 : 0);
  }

  console.log('\n[Owner] login lalu Beranda');
  M.calls = []; let page = await open(); await login(page, 'owner'); try { await page.waitForSelector('#dbody .kpi', {timeout: 5000}); } catch (e) { console.log('DEBUG calls=', M.calls.join(','), '\nDEBUG html=', (await page.textContent('#dbody'))); throw e; } await settle(page);
  let s0 = snap(); ok(s0.login === 1 && s0.boot === 1 && s0.dash === 1, 'login: 1 login, 1 bootstrap, 1 dashboard (' + JSON.stringify(s0) + ')'); ok(s0.ping === 0, 'tidak ada ping tepat setelah muat penuh (bootstrap sudah pemeriksaan versi)');

  console.log('\n[Owner] pindah tab bolak-balik tanpa data baru');
  let a = snap(); await tab(page, 'kasir'); await tab(page, 'dash'); await tab(page, 'kasir'); await tab(page, 'dash'); await page.waitForSelector('#dbody .kpi');
  let b = snap(); ok(diff(a, b) === '(tidak ada)', 'Beranda dibuka ulang 2x dalam 15 dtk: 0 permintaan (' + diff(a, b) + ')'); ok(await page.locator('#dbody .kpi').count() > 0, 'Beranda tetap tampil dari hasil tersimpan');

  console.log('\n[Owner] >15 dtk berlalu, tidak ada data baru');
  await ff(page, 20000); a = snap(); await tab(page, 'kasir'); await tab(page, 'dash'); b = snap();
  ok(b.ping - a.ping === 1 && b.dash === a.dash && b.boot === a.boot && b.stock === a.stock, 'hanya 1 ping murah; tanpa dashboard/bootstrap/stock.get (' + diff(a, b) + ')');

  console.log('\n[Owner] ada penjualan dari perangkat lain');
  otherSale(); await ff(page, 20000); a = snap(); await tab(page, 'kasir'); await tab(page, 'dash'); await page.waitForTimeout(300); b = snap();
  ok(b.ping - a.ping === 1 && b.stock - a.stock === 1 && b.boot === a.boot, 'ping + peta stok kecil, TANPA bootstrap (' + diff(a, b) + ')'); ok(b.dash - a.dash === 1, 'dashboard diambil ulang tepat 1x karena data berubah');

  console.log('\n[Owner] katalog berubah (harga/produk)');
  otherCatalog(); await ff(page, 20000); const mark = M.calls.length; a = snap(); await tab(page, 'kasir'); await tab(page, 'dash'); await page.waitForTimeout(300); b = snap();
  if (process.env.TRACE) console.log('  urutan:', M.calls.slice(mark).join(' > ')); ok(b.boot - a.boot === 1 && b.dash - a.dash === 1 && b.ping - a.ping === 1, 'tepat 1 ping + bootstrap 1x + dashboard 1x, tanpa ping ganda (' + diff(a, b) + ')');
  await ff(page, 20000); a = snap(); await tab(page, 'kasir'); await tab(page, 'dash'); b = snap(); ok(b.boot === a.boot && b.dash === a.dash, 'sesudah itu tenang lagi: tak ada bootstrap/dashboard (' + diff(a, b) + ')');

  console.log('\n[Owner] tombol muat ulang ↻ memaksa ambil ulang');
  a = snap(); await page.click('#dbody >> xpath=..'); await page.click('.chip[aria-label="Muat ulang"]'); await page.waitForTimeout(400); b = snap(); ok(b.dash - a.dash === 1, '↻ mengambil dashboard 1x walau versi sama (' + diff(a, b) + ')');

  console.log('\n[Owner] jawaban server apa pun yang memuat versi baru memicu pemeriksaan (tanpa polling)');
  await ff(page, 1000); otherSale(); a = snap(); await page.evaluate(() => window.APP.api('shift.list', {})); await page.waitForTimeout(900); b = snap();
  ok(b.ping - a.ping === 1 && b.stock - a.stock === 1 && b.boot === a.boot, 'dari satu panggilan biasa: otomatis ping + stock.get, tanpa bootstrap (' + diff(a, b) + ')');
  a = snap(); await page.evaluate(() => window.APP.api('shift.list', {})); await page.waitForTimeout(900); b = snap(); ok(diff(a, b) === '(tidak ada)', 'sesudah sinkron: panggilan biasa tidak memicu apa-apa (tidak ada loop)');

  console.log('\n[Owner] tanpa polling: diam 5 menit = 0 permintaan');
  a = snap(); await ff(page, 300000); await page.waitForTimeout(300); b = snap(); ok(diff(a, b) === '(tidak ada)', 'tidak ada ping berkala (' + diff(a, b) + ')');

  console.log('\n[Owner] layar lain: Produksi, Pengguna, Tutup kasir, Arsip, Biaya, Laporan');
  const go = async t => { await page.evaluate(t => window.APP.ACT.tab({dataset: {t}}), t); await page.waitForTimeout(350); };
  await page.evaluate(() => { window.APP.S.mt = 'expenses'; window.APP.S.rt = 'stok'; });
  const screens = [['produksi', ['production.list']], ['users', ['user.list']], ['tutup', ['shift.summary', 'shift.list']], ['arsip', ['archive.status']], ['master', ['master.list']], ['laporan', ['report.stok']]];
  for (const [scr, acts] of screens) {
    const c = () => acts.map(n).join('+'), tot = () => acts.reduce((x, k) => x + n(k), 0); let t0 = tot();
    await go(scr); const first = tot() - t0; ok(first === acts.length, scr + ': dibuka pertama kali = ' + acts.length + ' permintaan data (terukur ' + first + ')');
    t0 = tot(); const p0 = n('ping'); await go('dash'); await go(scr); await go('dash'); await go(scr); ok(tot() === t0 && n('ping') === p0, scr + ': dibuka ulang tanpa data baru = 0 permintaan (data +' + (tot() - t0) + ', ping +' + (n('ping') - p0) + ')');
    await ff(page, 20000); t0 = tot(); const b0 = n('boot'); await go('dash'); await go(scr); ok(tot() === t0 && n('boot') === b0, scr + ': >15 dtk tanpa data baru = tidak ambil ulang (data +' + (tot() - t0) + ')');
    otherSale(); await ff(page, 20000); t0 = tot(); await go('dash'); await go(scr); await page.waitForTimeout(300); ok(tot() - t0 === acts.length, scr + ': ada data baru = ambil ulang ' + acts.length + 'x (terukur ' + (tot() - t0) + ')');
  }
  await go('dash');

  console.log('\n[Owner] Diagnostik: penanda versi dan deteksi unggahan web tidak lengkap');
  await go('diag'); let dt = await page.textContent('#main'); ok(/Versi data/.test(dt) && /Layar tersimpan/.test(dt), 'Diagnostik menampilkan versi data dan jumlah layar tersimpan');
  await page.evaluate(() => caches.open('duado-v0.0.1')); await go('menu'); await go('diag'); await page.waitForTimeout(300); dt = await page.textContent('#main');
  ok(/tidak sama/.test(dt) && /0\.0\.1/.test(dt), 'versi config.js \u2260 versi cache sw.js: peringatan unggahan tidak lengkap tampil');
  await page.evaluate(() => caches.delete('duado-v0.0.1')); await go('dash');
  await page.close();

  console.log('\n[Kasir] Kasir: stok berubah ditampilkan tanpa menggambar ulang layar');
  M.calls = []; M.stok = 10; page = await open(); await login(page, 'kasir'); await page.waitForSelector('#grid .card', {timeout: 5000}); await settle(page);
  ok((await page.textContent('#grid')).includes('Stok 10'), 'kartu menampilkan Stok 10');
  await page.fill('#q', 'kerip'); await page.evaluate(() => { document.querySelector('#main').dataset.mark = 'tetap'; });
  otherSale(); a = snap(); await page.evaluate(() => window.APP.checkUpdates(true)); await page.waitForTimeout(500); b = snap();
  ok(b.stock - a.stock === 1 && b.boot === a.boot, 'hanya peta stok yang diambil (' + diff(a, b) + ')');
  ok((await page.textContent('#grid')).includes('Stok 7'), 'kartu kini menampilkan Stok 7');
  ok(await page.evaluate(() => document.querySelector('#main').dataset.mark === 'tetap' && document.querySelector('#q').value === 'kerip'), 'layar tidak digambar ulang: pencarian dan elemen utama utuh');

  console.log('\n[Kasir] Riwayat: daftar diambil hanya bila versi data berubah');
  M.calls = []; await tab(page, 'riwayat'); await page.waitForTimeout(300); a = snap(); ok(a.sales === 1, 'kunjungan pertama: 1 sales.list');
  await tab(page, 'kasir'); await tab(page, 'riwayat'); b = snap(); ok(b.sales === 1 && b.ping === a.ping, 'kunjungan ulang cepat: 0 permintaan, tampil seketika dari hasil tersimpan');
  await ff(page, 20000); await tab(page, 'kasir'); a = snap(); await tab(page, 'riwayat'); await page.waitForTimeout(300); b = snap(); ok(b.ping - a.ping === 1 && b.sales === a.sales, 'setelah >15 dtk tanpa data baru: 1 ping saja, daftar tidak diambil ulang (' + diff(a, b) + ')');
  otherSale(); await ff(page, 20000); await tab(page, 'kasir'); a = snap(); await tab(page, 'riwayat'); await page.waitForTimeout(400); b = snap(); ok(b.sales - a.sales === 1, 'ada penjualan baru: daftar diambil ulang 1x (' + diff(a, b) + ')');

  console.log('\n[Kasir] tombol "Perbarui data"');
  a = snap(); await page.evaluate(() => window.APP.ACT.sync()); await page.waitForTimeout(500); b = snap(); ok(b.boot === a.boot && b.ping - a.ping === 1, 'tanpa data baru: 1 ping, tanpa bootstrap (' + diff(a, b) + ')');
  ok((await page.textContent('#toast')).includes('Sudah yang terbaru'), 'pesan: "Sudah yang terbaru"');
  otherSale(); a = snap(); await page.evaluate(() => window.APP.ACT.sync()); await page.waitForTimeout(500); b = snap(); ok(b.boot === a.boot && b.stock - a.stock === 1, 'ada penjualan baru: hanya peta stok (' + diff(a, b) + ')');
  ok((await page.textContent('#toast')).includes('Data diperbarui'), 'pesan: "Data diperbarui"');
  await page.close();

  console.log('\n[UI] login, font, CSP, cetak');
  {
    const ctx = await browser.newContext({serviceWorkers: 'block', viewport: {width: 390, height: 800}}), pg = await ctx.newPage(), bad = [], viol = [];
    pg.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) bad.push(r.status() + ' ' + r.url().replace(base, '')); });
    pg.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) viol.push(m.text().slice(0, 140)); });
    await pg.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || ''))); });
    await pg.route('https://mock.api/exec', async r => { await r.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(respond(JSON.parse(r.request().postData()))) }); });
    await pg.route(/googleusercontent/, r => r.abort());
    await pg.goto(base); await pg.waitForSelector('.lg-hero .wordmark'); await pg.waitForTimeout(400);
    // kontras judul login terhadap bagian TERTERANG latar (#7b2424 di gradien radial) = kasus terburuk
    const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
    const col = (await pg.$eval('.lg-hero .wordmark', e => getComputedStyle(e).color)).match(/\d+/g).slice(0, 3).map(Number), bgc = [0x7b, 0x24, 0x24];
    const ratio = (Math.max(lum(col), lum(bgc)) + .05) / (Math.min(lum(col), lum(bgc)) + .05);
    ok(ratio >= 4.5, 'judul login terbaca: kontras ' + ratio.toFixed(1) + ':1 (minimal 4.5:1) warna rgb(' + col + ')');
    const sub = (await pg.$eval('.lg-hero p', e => getComputedStyle(e).color)).match(/\d+/g).slice(0, 3).map(Number), r2 = (Math.max(lum(sub), lum(bgc)) + .05) / (Math.min(lum(sub), lum(bgc)) + .05);
    ok(r2 >= 4.5, 'subjudul login terbaca: kontras ' + r2.toFixed(1) + ':1');
    const f = await pg.evaluate(async () => { await Promise.all([document.fonts.load('600 16px "Baloo 2"'), document.fonts.load('800 16px "Baloo 2"')]); return Array.from(document.fonts).map(x => x.weight + ':' + x.status); });
    ok(f.length === 2 && f.every(x => /:loaded$/.test(x)), 'font Baloo 2 (600 dan 800) termuat dari fonts/ (' + f.join(',') + ')');
    ok(bad.length === 0, 'tidak ada 404/galat unduhan aset' + (bad.length ? ': ' + bad.join(', ') : ''));
    // CSP benar-benar aktif: atribut handler inline DIBLOKIR, sedangkan penanganan galat foto lewat listener tetap berfungsi
    const inl = await pg.evaluate(async () => { window.__x = 0; const d = document.createElement('div'); d.innerHTML = '<img src="data:,x" onerror="window.__x=1">'; document.body.appendChild(d); await new Promise(r => setTimeout(r, 300)); d.remove(); return {ran: window.__x, v: window.__csp.length}; });
    ok(inl.ran === 0 && inl.v >= 1, 'CSP aktif: onerror inline tidak jalan dan tercatat sebagai pelanggaran (' + JSON.stringify(inl) + ')');
    await pg.evaluate(() => { window.__csp.length = 0; }); viol.length = 0; // pelanggaran di atas disengaja; hitung ulang dari sini
    await pg.evaluate(() => { const i = document.createElement('img'); i.id = 'tfoto'; i.setAttribute('data-foto', '1'); i.setAttribute('crossorigin', 'anonymous'); i.src = 'https://lh3.googleusercontent.com/d/tes=w480'; document.body.appendChild(i); });
    await pg.waitForFunction(() => !document.getElementById('tfoto'), null, {timeout: 4000}).then(() => ok(true, 'foto gagal dimuat: dicoba ulang tanpa CORS lalu dibuang (huruf awal tampil)'), () => ok(false, 'foto gagal dimuat tidak dibersihkan oleh fotoErr'));
    // login sungguhan dengan CSP aktif, lalu cetak browser: aturan @page masuk lewat CSSOM (bukan elemen <style>)
    await pg.fill('#lu', 'kasir'); await pg.fill('#lp', '123456'); await pg.click('[data-act=login]'); await pg.waitForSelector('#grid .card', {timeout: 5000});
    const pr = await pg.evaluate(() => { window.print = () => { window.__printed = 1; }; window.APP.ACT.print(); window.APP.ACT.print(); const ss = Array.from(document.styleSheets).find(x => /app\.css/.test(x.href || '')); return {pages: Array.from(ss.cssRules).filter(r => r.type === 6).map(r => r.cssText), styleEls: document.querySelectorAll('style').length}; });
    await pg.waitForTimeout(200);
    ok(pr.pages.length === 1 && /margin:\s*0/.test(pr.pages[0]), 'cetak: dua kali cetak tetap satu aturan @page (tidak menumpuk): ' + (pr.pages[0] || '-')); // catatan: Chromium membuang "size:58mm auto" (tidak valid); perilaku v1.9.6 sengaja dipertahankan sampai diuji di printer asli
    ok(pr.styleEls === 0, 'tidak ada elemen <style> sisipan');
    const v2 = await pg.evaluate(() => window.__csp.slice());
    ok(viol.length === 0 && v2.length === 0, 'tidak ada pelanggaran CSP selama login dan cetak' + (viol.length || v2.length ? ': ' + viol.concat(v2).slice(0, 3).join(' | ') : ''));
    await ctx.close();
  }

  console.log('\n[Umum] galat JavaScript di halaman'); ok(errs.length === 0, 'tidak ada galat JS' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await browser.close(); srv.close(); fs.rmSync(TMP, {recursive: true, force: true});
  console.log(fail ? `\n${fail} GAGAL, ${pass} lulus` : `\nSemua lulus (${pass} pemeriksaan)`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TES ERROR:', e.message.split('\n')[0]); if (errs.length) console.error('Galat halaman:', errs.slice(0, 5)); process.exit(2); });
