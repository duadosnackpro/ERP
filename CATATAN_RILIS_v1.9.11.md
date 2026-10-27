# v1.9.11: aksesibilitas keyboard dan pembaca layar, teks kecil

Hanya klien (`web/`); **backend (`apps-script/`) tidak berubah**. Tanpa migrasi data.

## Yang diperbaiki
- **Kartu produk tidak bisa dipakai lewat keyboard.** Kartu berperan `role=button` dan `tabindex=0` tetapi tidak ada penanganan Enter/Spasi, jadi kasir yang memakai keyboard fisik (tablet + keyboard) atau pengguna alat bantu tidak bisa menambah produk. Kini Enter dan Spasi pada kartu yang fokus menambah produk.
- **Kartu di keranjang**: tombol - dan + sungguhan berada di dalam `role=button` (anak-anaknya dianggap dekoratif oleh pembaca layar, jadi tidak terbaca). Kartu yang sudah di keranjang kini `role=group` bernama produknya; tombol - dan + bernama produknya ("Tambah Produk 2", sebelumnya hanya "Tambah"). Fokus keyboard dipindah ke tombol + (atau kembali ke kartu saat jumlah 0) agar tidak hilang saat isi kartu digambar ulang.
- Tanda `+` pada kartu bukan lagi `role=button` bersarang; kini dekoratif (`aria-hidden`).
- **Dialog (sheet)**: nama dialog kini diambil dari judulnya (`aria-labelledby`, sebelumnya semua bernama "Dialog"); fokus masuk ke dialog saat dibuka (wadah, bukan kolom isian, jadi keyboard layar tidak muncul sendiri); **Tab berputar di dalam dialog** dan tidak lagi keluar ke halaman di belakangnya. Escape dan kembalinya fokus ke pemicu tetap seperti sebelumnya.
- **Navigasi bawah**: `aria-label="Menu utama"` dan `aria-current="page"` pada tab aktif.
- **Status terpilih**: chip kategori, chip metode bayar, dan pemilih channel kini `aria-pressed` (sebelumnya status terpilih hanya warna).
- Pesan galat login dan overlay "memuat" kini diumumkan pembaca layar (`role=alert` / `role=status`).
- **Teks kecil**: lencana status, label stok, ukuran, tag, label grafik, dan angka di ikon keranjang dinaikkan dari 11 - 11,5px ke 12px. Pratinjau struk (meniru lebar kertas) sengaja tidak diubah.

## Tidak diubah (sengaja)
Tampilan, warna, tata letak, alur, dan logika bisnis. Perubahan visual hanya pada ukuran teks bantu (+0,5 - 1px) dan cincin fokus keyboard.

## Pengujian
- `tests/fe_ui.js`: 16 pemeriksaan baru (keyboard Enter/Spasi, perpindahan fokus, nama dialog, jebakan Tab 40 kali, Escape, aria-current/pressed, role galat login, ukuran teks). Total fe_ui 76.
- `build:check`, `release_check` (48), `be_*` (21, 23, 14, 10), `fe_sync` (61), `fe_ui` (76) lulus. `typecheck`: 134 galat lama (baseline), 0 baru. Tangkapan layar Chromium 390x800 diperiksa.
- Belum diuji dengan pembaca layar sungguhan (TalkBack/VoiceOver) dan ESLint tidak dijalankan di sini; jalankan `npm ci && npm run check` di mesin/CI Anda.

## Cara memasang
`npm run build` (sudah dijalankan di zip ini), commit, push. `VERSION` di `sw.js` dan `js/config.js` sudah 1.9.11; kasir melihat banner "Versi baru tersedia".
