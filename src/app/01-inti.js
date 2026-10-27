/* Duado Snack POS - frontend local-first (tanpa build). Data master disimpan di perangkat; transaksi masuk antrean lalu disinkronkan. */
(function () {
'use strict';
const C = window.CONFIG || {};
const $ = s => document.querySelector(s);
const rp = n => 'Rp\u00a0' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const num = n => Math.round(Number(n) || 0).toLocaleString('id-ID');
/* angka dari keyboard Indonesia: "0,5" = 0.5; "1.250" = 1250; "1.250,5" = 1250.5; "0.125" = 0.125 */
function dnum(s) {
  if (typeof s === 'number') return s; s = String(s == null ? '' : s).trim().replace(/\s/g, ''); if (!s) return NaN;
  s = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) && !/^0\./.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.'); return Number(s);
}
const qf = n => (Math.round(Number(n) * 1000) / 1000).toLocaleString('id-ID', {maximumFractionDigits: 3});
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* Penyimpanan lokal: IndexedDB (kapasitas besar, tidak memblokir layar) dengan cermin di memori agar pembacaan tetap sinkron.
   Cadangan ke localStorage bila IndexedDB tidak tersedia. Data lama di localStorage dimigrasi sekali. Kunci penting (antrean, keranjang, sesi) ditulis seketika. */
const Store = (() => {
  const mem = {}, dirty = {}, CRIT = ['queue', 'cart', 'token', 'hideOut', 'metode', 'ch']; let db = null, idb = false, timer = null, writing = Promise.resolve();
  const journal = (k, o) => { try { localStorage.setItem('j:' + k, JSON.stringify(o)); } catch (e) {} }; // jurnal sinkron: selamat walau halaman ditutup sebelum IndexedDB selesai menulis
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('duado', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); });
  const readAll = () => new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').openCursor(); q.onsuccess = () => { const c = q.result; if (c) { mem[c.key] = c.value; c.continue(); } else res(); }; q.onerror = () => rej(q.error); });
  function flushNow() {
    clearTimeout(timer); const keys = Object.keys(dirty); if (!idb || !keys.length) return writing;
    const batch = keys.map(k => [k, dirty[k]]); keys.forEach(k => delete dirty[k]);
    writing = writing.then(() => new Promise(res => {
      const undo = () => { batch.forEach(([k, op]) => { if (!(k in dirty)) dirty[k] = op; }); res(); };
      try { const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'); batch.forEach(([k, op]) => { if (op === 2) st.delete(k); else st.put(mem[k], k); }); tx.oncomplete = () => { batch.forEach(([k]) => { if (!(k in dirty)) { try { localStorage.removeItem('j:' + k); } catch (e) {} } }); res(); }; tx.onerror = tx.onabort = undo; } catch (e) { undo(); }
    }));
    return writing;
  }
  async function init() {
    try { if (window.indexedDB) { db = await open(); await readAll(); idb = true; } } catch (e) { idb = false; }
    try { // terapkan jurnal yang belum sempat masuk IndexedDB (mis. aplikasi ditutup tepat setelah transaksi)
      if (idb) Object.keys(localStorage).filter(k => k.indexOf('j:') === 0).forEach(jk => { const k = jk.slice(2); try { const o = JSON.parse(localStorage.getItem(jk)); if (o && o.x) { delete mem[k]; dirty[k] = 2; } else if (o && 'v' in o) { mem[k] = o.v; dirty[k] = 1; } } catch (e) {} });
      if (idb && Object.keys(dirty).length) await flushNow();
    } catch (e) {}
    try {
      const moved = []; Object.keys(localStorage).forEach(k => { if (k.indexOf('j:') !== 0 && !(k in mem)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v != null) { mem[k] = v; if (idb) dirty[k] = 1; moved.push(k); } } catch (e) {} } });
      if (idb && moved.length) { await flushNow(); if (!Object.keys(dirty).length) moved.forEach(k => localStorage.removeItem(k)); } // hapus salinan lama hanya setelah berhasil tertulis
    } catch (e) {}
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {} // minta agar data tidak dibersihkan otomatis oleh browser
  }
  return {
    init: init, flush: flushNow, mode: () => idb ? 'IndexedDB' : 'localStorage',
    get: (k, d) => mem[k] == null ? d : mem[k],
    set: (k, v, now) => { mem[k] = v; if (idb) { if (CRIT.indexOf(k) >= 0) journal(k, {v: v}); dirty[k] = 1; if (now) flushNow(); else { clearTimeout(timer); timer = setTimeout(flushNow, 400); } } else { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Penyimpanan perangkat penuh'); } } },
    del: k => { delete mem[k]; if (idb) { if (CRIT.indexOf(k) >= 0) journal(k, {x: 1}); dirty[k] = 2; if (CRIT.indexOf(k) >= 0) flushNow(); else { clearTimeout(timer); timer = setTimeout(flushNow, 400); } } else { try { localStorage.removeItem(k); } catch (e) {} } }
  };
})();
const devId = () => { let d = LS.get('dev', ''); if (!/^[0-9a-f]{32}$/.test(d)) { const a = new Uint8Array(16); (window.crypto && window.crypto.getRandomValues) ? window.crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); }); d = Array.from(a, b => ('0' + b.toString(16)).slice(-2)).join(''); LS.set('dev', d); } return d; }; // id perangkat untuk penguncian login (server hanya menyimpan hash-nya)
const LS = {get: Store.get, set: (k, v) => Store.set(k, v, ['queue', 'cart', 'token', 'hideOut', 'metode', 'ch'].indexOf(k) >= 0), del: Store.del};
const T = v => String(v).toUpperCase() === 'TRUE';
const APP = window.APP = {views: {}};
const S = {token: null, data: null, queue: [], tab: 'kasir', ch: null, cat: 'Semua', q: '',
  cart: [], diskon: '', metode: 'tunai', terima: '', catatan: '', nomor: {}, mt: 'products', stab: 'varian', day: null, pb: {items: [], ongkir: '', sup: ''}, rc: null,
  sq: '', scat: 'Semua', hideOut: false, dirty: false, rcustom: false, installEv: null};
const own = () => !!(S.data && S.data.user.role === 'owner');
/* v1.9.9: indeks Map (O(1)) menggantikan pencarian linear. Dibangun malas dan dibuang bila larik data diganti atau berubah panjang; perubahan di tempat (patchMaster) memanggil idxReset(). */
let IDX = null;
function idxReset() { IDX = null; }
function idx() {
  const d = S.data; if (IDX && IDX.d === d && IDX.v === d.variants && IDX.nv === d.variants.length && IDX.p === d.products && IDX.np === d.products.length && IDX.pr === d.prices && IDX.npr === d.prices.length && IDX.c === d.channels && IDX.nc === d.channels.length) return IDX;
  const v = new Map(), p = new Map(), pr = new Map(), c = new Map();
  d.variants.forEach(x => { if (!v.has(x.id)) v.set(x.id, x); }); d.products.forEach(x => { if (!p.has(x.id)) p.set(x.id, x); });
  d.prices.forEach(x => { const k = x.variant_id + '|' + x.channel_id; if (!pr.has(k)) pr.set(k, x); }); d.channels.forEach(x => { if (!c.has(x.id)) c.set(x.id, x); });
  return IDX = {d: d, v: d.variants, nv: d.variants.length, p: d.products, np: d.products.length, pr: d.prices, npr: d.prices.length, c: d.channels, nc: d.channels.length, mv: v, mp: p, mpr: pr, mc: c};
}
const vById = id => idx().mv.get(id);
const pById = id => idx().mp.get(id);
const vName = v => { const p = pById(v.product_id); return p ? p.nama : '(produk dihapus)'; };
const lvl = x => /^\d+$/.test(String(x).trim()) ? 'Level ' + String(x).trim() : x;
const vSub = v => [v.ukuran, v.level_pedas === '' || v.level_pedas == null ? '' : lvl(v.level_pedas)].filter(x => x !== '' && x != null).join(' · ');
const r6 = x => Math.round(Number(x) * 1e6) / 1e6;
const priceOf = (vid, ch) => { const x = idx().mpr.get(vid + '|' + ch); return x ? Number(x.harga_jual) : null; };
const chName = id => { const c = idx().mc.get(id); return c ? c.nama : '-'; };
const p2 = n => ('0' + n).slice(-2);
const fmtDT = d => { d = new Date(d); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const today = () => fmtDT(new Date()).slice(0, 10);
/* Daftar bertahap (v1.9.8): DOM hanya memuat sebagian baris; sisanya muncul saat digulir mendekati ujung (IntersectionObserver) atau lewat tombol. Mencegah layar macet pada >100 baris.
   LIM menyimpan jumlah baris yang sedang ditampilkan per daftar; bertambah satu halaman tiap kali, dan di-reset pemanggil saat filter/hari berganti. */
const PGN = {grid: 60, cart: 40, hist: 50, q: 30}, LIM = {}; let moreIO = null;
const lim = k => LIM[k] || PGN[k];
function moreBtn(k, total) { const n = total - lim(k); return n > 0 ? '<button class="btn sec lmore" data-act="more" data-k="' + k + '">Tampilkan ' + Math.min(n, PGN[k]) + ' lagi (sisa ' + n + ')</button>' : ''; }
function watchMore() {
  if (moreIO) { moreIO.disconnect(); moreIO = null; }
  const els = document.querySelectorAll('.lmore'); if (!els.length || !window.IntersectionObserver) return; // tanpa IntersectionObserver tombol tetap bisa diketuk
  moreIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && e.target.isConnected) { moreIO.unobserve(e.target); /** @type {HTMLElement} */ (e.target).click(); } }), {rootMargin: '300px'});
  els.forEach(e => moreIO.observe(e));
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 2600); }
function sheet(html) {
  const b = $('#sheet'), opening = b.hidden; if (opening) S.sheetFrom = document.activeElement;
  b.innerHTML = '<div class="sheet-bg" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" tabindex="-1">' + html + '</div>'; b.hidden = false;
  const d = /** @type {HTMLElement|null} */ (b.querySelector('.sheet')), h = d && d.querySelector('h2');
  if (!d) return;
  if (h) { h.id = 'sheet-h'; d.setAttribute('aria-labelledby', 'sheet-h'); } else d.setAttribute('aria-label', 'Dialog'); // nama dialog = judulnya, bukan kata generik
  if (opening) d.focus({preventScroll: true}); // fokus masuk ke dialog (wadah, bukan kolom isian: keyboard layar tidak muncul sendiri)
}
/* Tab tetap berputar di dalam dialog yang terbuka (aria-modal): tanpa ini Tab keluar ke halaman di belakang sheet. */
function trapTab(/** @type {KeyboardEvent} */ e) {
  const b = $('#sheet'); if (!b || b.hidden || S.busyOn) return;
  const d = /** @type {HTMLElement|null} */ (b.querySelector('.sheet')); if (!d) return;
  const f = /** @type {HTMLElement[]} */ (Array.from(d.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))).filter(x => x.offsetParent !== null);
  if (!f.length) { e.preventDefault(); d.focus(); return; }
  const first = f[0], last = f[f.length - 1], a = document.activeElement;
  if (!a || !d.contains(a) || a === d) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
}
function closeSheet() { if (S.opin) { const r = S.opin.res; S.opin = null; r(null); } const b = $('#sheet'); S.qopen = false; b.hidden = true; b.innerHTML = ''; try { const f = S.sheetFrom; S.sheetFrom = null; if (f && f.isConnected && f.focus) f.focus({preventScroll: true}); } catch (e) {} if (S.deferRender) { S.deferRender = false; render(); } if (S.conflictPending) setTimeout(notifyConflicts, 250); }

