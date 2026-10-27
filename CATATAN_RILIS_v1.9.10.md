# v1.9.10 (mencakup v1.9.9): efisiensi, performa, UI, paginasi server, dan pengukuran backend

## Performa dan efisiensi
- **Indeks Map O(1)** untuk `vById`, `pById`, `priceOf`, `chName` (sebelumnya pencarian linear per kartu). Diukur di Chromium, 800 produk x 60 putaran: **207 ms -> 22 ms (~9x)**. Indeks dibuang otomatis bila larik data diganti/berubah panjang; `patchMaster` memanggil `idxReset()`.
- **Debounce 90 ms** pada kolom cari Kasir (ketikan beruntun = satu penggambaran).
- **MutationObserver** tidak lagi memicu `initFades` (pengukuran tata letak paksa) pada tiap ketuk produk/keranjang; `resize` dibatasi per frame.
- `contain: layout paint` pada kartu produk, transisi kartu hanya `transform`, `touch-action: manipulation` (tanpa jeda ketuk ganda).
- Preload font judul (Baloo 2 800).

## UI
- Header Kasir lengket kini **opak**: sebelumnya kartu tembus di balik baris "22 produk / Sembunyikan yang habis".
- Foto kartu **4:3** (lebih banyak produk per layar).
- Baris keranjang dua baris (nama + total / varian + stepper): nama tidak lagi terjepit 3 baris.
- **Tablet: tombol Bayar tidak lagi terpotong** pada layar ~820 px; panel pesanan bisa digulir, tombol lengket.
- Tombol Bayar lengket tanpa kartu mengintip di sudut.

## Aksesibilitas
- Toast `role=status aria-live=polite`; dialog `aria-modal`; **Escape** menutup sheet; fokus kembali ke pemicu saat sheet ditutup.

## Verifikasi
`build:check`, `release_check` (48), `fe_sync` (61), `fe_ui` (47) lulus. Tangkapan layar sebelum/sesudah diambil di Chromium (390x800, 360x640, 1180x820).

## Tambahan v1.9.10 (butir yang sebelumnya tertunda)
- **Paginasi server `sales.list`** (Code.gs): parameter `limit`/`offset` (maks. 500) mengembalikan `{rows,total,offset,summary}`; KPI (omzet, jumlah transaksi, terlaris) dihitung server atas SEMUA transaksi hari itu. Tanpa `limit` tetap larik penuh, jadi klien lama dan server lama saling kompatibel. Klien memuat 50 baris per halaman, halaman berikutnya diambil dari server (otomatis saat digulir atau lewat tombol), tanpa baris ganda. Uji baru: `tests/be_sales.js` (10), plus 11 pemeriksaan baru di `tests/fe_ui.js`.
- **Hapus transaksi dari antrean** tidak lagi memakai `prompt()` browser: sheet khusus dengan kolom alasan terfokus, validasi minimal 3 huruf, Escape membatalkan, daftar antrean kembali setelah selesai.
- **Header Kasir ponsel lebih ringkas**: pemilih channel ikut tergulir; yang menempel hanya pencarian + kategori + filter habis (tinggi menempel turun dari ~275 px ke ~205 px pada layar 390 px). Tablet tidak berubah.
- **Pengukuran backend**: setiap jawaban server memuat `ms` (waktu proses). Menu > Diagnostik > "Uji koneksi dan kecepatan server" menampilkan ping, waktu muat data penuh, ukurannya (KB), dan waktu server. Jalankan sebelum dan sesudah deploy untuk membandingkan.
- `tsc` dijalankan: 0 galat baru dari baseline 134. Satu galat tipe dari kode sendiri sempat muncul dan sudah diperbaiki.

## Cara memasang v1.9.10
1. Backend: tempel `Code.gs` baru ke Apps Script, deploy versi baru Web App (URL tetap; tanpa migrasi). Boleh dipasang sebelum atau sesudah klien.
2. Klien: `npm run build`, commit, push. Kasir melihat banner "Versi baru tersedia".

## Verifikasi
`build:check`, `release_check` (48), `fe_sync` (61), `fe_ui` (60, dijalankan berulang kali: stabil), `be_ver` (21), `be_pin` (23), `be_lock` (14), `be_sales` (10), `typecheck`. Tangkapan layar di Chromium.

## Batasan yang masih ada
- **ESLint tidak dijalankan** (tidak ada paket dan internet di sini); jalankan `npm ci && npm run check` di mesin Anda atau lewat CI.
- **Kecepatan backend tetap belum terukur**: tidak ada runtime Apps Script di sini. Alat ukurnya sudah dipasang (lihat di atas); angkanya baru ada setelah dijalankan di produksi.
- Paginasi server masih membaca seluruh baris sehari di sisi Apps Script sebelum dipotong; yang berkurang adalah ukuran jawaban dan beban gambar di perangkat.
- Belum dicoba di perangkat kasir nyata (Android lama, printer).
