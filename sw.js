// Service worker: cache-first murni. Aset aplikasi disimpan saat pemasangan (dengan cache: 'reload' agar melewati cache HTTP GitHub Pages),
// lalu dilayani dari cache tanpa menunggu jaringan. Pembaruan terjadi HANYA lewat penaikan VERSION di bawah (naikkan juga CONFIG.VERSION di js/config.js).
// Pengguna lalu melihat banner "Versi baru tersedia" dan menekan "Muat ulang".
const VERSION = 'duado-v1.8.2';
const CORE = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/app.js', 'js/modules.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const OPTIONAL = ['fonts/baloo2-600.woff2', 'fonts/baloo2-800.woff2']; // font lokal; aplikasi tetap jalan (font cadangan) bila belum diunduh
const fresh = u => fetch(new Request(u, {cache: 'reload'}));
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await Promise.all(CORE.map(async u => { const r = await fresh(u); if (!r.ok) throw new Error('Gagal memuat ' + u + ' (' + r.status + ')'); await c.put(u, r); })); // satu aset gagal = pemasangan dibatalkan, versi lama tetap dipakai
    await Promise.all(OPTIONAL.map(u => fresh(u).then(r => r.ok ? c.put(u, r) : null).catch(() => {})));
  })); // sengaja tanpa skipWaiting otomatis: menunggu pengguna menekan "Muat ulang"
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return; // API (Apps Script) dan situs lain tidak pernah lewat cache
  e.respondWith(caches.match(r, {ignoreSearch: true}).then(hit => {
    if (hit) return hit; // cache-first murni: tidak ada permintaan jaringan di belakang layar
    return fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(VERSION).then(c => c.put(r, cp)); } return res; })
      .catch(() => r.mode === 'navigate' ? caches.match('index.html') : Response.error());
  }));
});
