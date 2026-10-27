# v2.0.0: reset tampilan ("Dapur Pedas"), logika dan fitur tidak berubah

Hanya klien (`web/`); **backend (`apps-script/`) tidak berubah**, tanpa migrasi. Sudah mencakup v1.9.11 (aksesibilitas keyboard/pembaca layar).
Aturan desain lengkap: `design-system/duado-pos/MASTER.md`.

## Apa yang diganti
`web/css/app.css` ditulis ulang dari nol (sistem token, bukan tumpukan penimpaan v1.4 sampai v1.9). Kelas HTML dan seluruh logika JS dipertahankan, jadi risiko fungsi nyaris nol.
- **Warna punya tugas**: kuning = satu aksi utama (Bayar, Masuk, tambah produk); marun = struktur dan merek (kepala, kartu hero, chip terpilih); oranye cabai = aksen panas (grafik, indikator); hijau/kuning tua/merah hanya untuk status.
- **Kepala marun** dengan logo berbingkai kuning (sebelumnya kepala krem polos); lencana sinkron berwarna jelas dengan titik status.
- **Angka uang memakai angka lebar-sama** (tabular) di harga, total, KPI, tabel, dan keranjang: kolom rapi dan mudah dibaca sekilas.
- **Tipografi**: dasar 16px (sebelumnya 15px; juga mencegah zoom otomatis iOS pada kolom isian), judul Baloo 2, teks terkecil 12px.
- **Kartu produk**: foto 4:3, harga lebih besar, tombol tambah bulat kuning 44px; kartu di keranjang berbingkai marun 2px dengan stepper di dalamnya.
- **Navigasi bawah**: tab aktif berpil kuning di belakang ikon. **Bar keranjang** gelap melayang dengan tombol Bayar kuning.
- **Permukaan datar bergaris tipis**; bayangan hanya untuk lapisan melayang (bar keranjang, sheet, toast).
- **Kolom isian**: tinggi 52px, batas 3:1 (sebelumnya samar), cincin fokus jelas. Chip dan segmen 44px, tombol utama 52px.
- Grafik dan komposisi channel di dasbor memakai palet baru (`web/js/modules.js`, hanya konstanta warna).
- Warna bilah status peramban dan manifest PWA mengikuti marun baru.
- Kontras: semua pasangan teks minimal 4,5:1 (diperiksa dengan skrip), batas kolom dan saklar minimal 3:1.

## Yang sengaja tidak diubah
Struk, lebar karakter struk, pratinjau logo struk, dan aturan cetak (disalin utuh). Tata letak dua panel tablet (>= 900px). Tidak ada mode gelap.

## Pengujian
`build:check`, `release_check` (48), `be_*`, `fe_sync` (61), `fe_ui` (76) lulus; typecheck tanpa galat baru. Tangkapan layar Chromium diperiksa: login, Kasir, sheet bayar, Riwayat, Stok, Menu, Beranda Owner (data tiruan), tablet 1180x820.
Belum diuji di perangkat kasir nyata (Android lama, printer) dan dengan pembaca layar sungguhan; ESLint tidak dijalankan di sini. Jalankan `npm ci && npm run check`.

## Cara memasang
`npm run build` (sudah), commit, push. Kasir melihat banner "Versi baru tersedia".
