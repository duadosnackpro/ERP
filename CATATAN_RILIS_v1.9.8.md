# v1.9.8: daftar bertahap, visualizer antrean offline, pembaruan yang tidak memutus sesi, dan 5 perbaikan di backend/klien

## Koreksi atas premis (penting dibaca dulu)
Dua dari tiga butir "CRITICAL" **sudah ada** sejak v1.8.x. Saya tidak menulis ulang yang sudah benar, tetapi mengaudit dan menambal celahnya:
- **LockService**: `withLock_` (Code.gs) sudah membungkus penjualan (`saleCreate_`, `saleBatch_`), retur, pemulihan, produksi, pembelian, opname, impor, arsip, dan pengaturan. Pemotongan stok `saleCore_` sudah atomik.
- **CacheService**: tabel master (`settings, channels, products, channel_prices, suppliers, recipes, recipe_items`) sudah di-cache terpecah (potongan 30 KB), `variant_meta`, sesi, nomor urut, versi data, dan hasil laporan juga. Yang belum: stok varian sengaja **tidak** di-cache (berubah di setiap penjualan).

## Ringkasan
| # | Permintaan | Yang dikerjakan | Terverifikasi |
|---|---|---|---|
| 1 | LockService | Sudah ada. **Menambal 2 celah**: `withLock_` kini aman bersarang (penghitung kedalaman; sebelumnya kunci kedua dalam eksekusi yang sama menunggu dirinya sendiri sampai habis waktu). `removeSafe_` memeriksa stok di luar kunci lalu menghapus di dalam kunci (produksi/pembelian bisa menyela); kini seluruhnya satu kunci | `tests/be_lock.js` (14 pemeriksaan), terbukti gagal pada kode lama |
| 2 | CacheService | Sudah ada. TTL 10 menit naik ke **30 menit** (`CACHE_TTL_`). **Menambal balapan cache**: pembaca tanpa kunci bisa menyimpan data basi sampai TTL habis bila `bust_` terjadi di antara baca-sheet dan simpan-cache; kini ada penanda generasi `cgen` | `be_lock.js`; **kecepatan di Apps Script belum diukur** (lihat Batasan) |
| 3 | Virtual scroll / paginasi | Daftar bertahap (`PGN`): produk 60, keranjang 40, riwayat 50, antrean 30 baris per halaman; muncul otomatis saat digulir (IntersectionObserver) atau lewat tombol | `tests/fe_ui.js`: 150 produk, 45 baris keranjang, 230 transaksi, 70 antrean |
| 4 | Modal error sinkronisasi offline | Jendela antrean terbuka **otomatis** sekali per kegagalan; tiap transaksi: nama produk, penyebab, saran tindakan, tombol Otorisasi/Coba lagi/Hapus; "Coba lagi semua"; yang bermasalah di atas | `fe_ui.js` |
| 5 | Service worker SWR | Inti tetap terkunci per versi (alasan di bawah); non-inti stale-while-revalidate; **pemuatan ulang tidak lagi memotong layar yang terbuka** | `fe_ui.js` dengan service worker sungguhan |

## Temuan kritikal saat perbaikan
1. **Pembaruan bisa me-reload paksa tengah transaksi.** `controllerchange` langsung `location.reload()`. Bila tab lain menekan "Muat ulang", tab kasir yang sedang di layar pembayaran/struk ikut dimuat ulang. Kini menunggu sampai tidak ada layar terbuka, permintaan, atau pengiriman antrean; tombol "Muat ulang" menolak dulu bila ada layar terbuka. Keranjang dan antrean tetap utuh (disimpan di perangkat).
2. **Balapan cache tabel** (poin 2 di atas): data harga/produk basi bisa bertahan sampai TTL.
3. **`removeSafe_` periksa-lalu-bertindak di luar kunci** (poin 1).
4. **Bug di fitur baru saya sendiri, tertangkap uji:** saat filter pencarian dihapus, *scroll anchoring* browser menahan posisi gulir di dasar daftar baru sehingga sentinel memuat berantai sampai semua 150 kartu masuk DOM (mengalahkan tujuan paginasi). Diperbaiki: gulir ke atas saat filter berganti + `overflow-anchor: none` pada daftar.
5. **Transaksi "Perlu ditinjau" tidak pernah diumumkan**: hanya teks lencana kecil. Padahal uang pelanggan mungkin sudah diterima. Kini dimunculkan otomatis (ditunda bila kasir sedang di layar pembayaran/struk, lalu muncul setelah ditutup; tidak berulang untuk kegagalan yang sama).

## Mengapa inti service worker bukan SWR murni
`app.js`, `modules.js`, `config.js`, dan `sw.js` harus berasal dari rilis yang sama. SWR per berkas dapat menyimpan campuran lama+baru (mis. saat GitHub Pages belum selesai menyebar) dan merusak aplikasi di tengah shift. Pada tingkat paket sebenarnya sudah SWR: browser memeriksa `sw.js` di latar belakang sementara versi lama tetap melayani. SWR berkas-per-berkas dipakai untuk aset **non-inti** (saat ini praktis tidak ada, jadi itu pengaman untuk ke depan, bukan percepatan hari ini).

## Cara menerapkan
1. **Backend:** tempel `Code.gs` dan `Master.gs` baru, deploy versi baru Web App (URL tetap). Tidak ada migrasi skema. Cache lama tetap terbaca.
2. **Klien:** `npm run build`, commit, push ke `main` seperti biasa. `VERSION` sudah `1.9.8` di `sw.js` dan `js/config.js`.
3. Setelah deploy, kasir melihat banner "Versi baru tersedia"; tidak ada yang terputus.

## Batasan yang jujur
- **Kecepatan backend belum diukur.** Tidak ada runtime Apps Script di lingkungan saya. Klaim "1,5 detik jadi <100 ms" **tidak saya buktikan**: `bootstrap` masih membaca sheet `product_variants` setiap panggilan (stok harus segar), dan owner juga `materials`. Yang di-cache hanya tabel master. Lihat Executions di Apps Script sebelum/sesudah.
- **Perilaku `LockService` saya turunkan dari dokumentasi dan uji dengan tiruan tidak-reentrant**, bukan di Apps Script sungguhan. Penghitung kedalaman benar baik kunci aslinya reentrant maupun tidak.
- Paginasi hanya di sisi tampilan. `sales.list` masih mengirim semua transaksi satu hari dalam satu jawaban (aman untuk ratusan, bukan puluhan ribu). Paginasi server belum dikerjakan.
- **ESLint belum dijalankan** (tanpa internet di sini). `node --check`, tipe (`tsc`, 0 galat baru dari baseline 134), dan semua uji lulus.
- Jalur `controllerchange` tab-ke-tab diuji lewat `ACT.reload`, bukan dengan dua tab sungguhan berganti service worker.
- Belum dicoba di perangkat kasir nyata (gulir di Android lama, printer).
- `qdel` masih memakai `prompt()` bawaan browser untuk alasan penghapusan; tidak diubah.
