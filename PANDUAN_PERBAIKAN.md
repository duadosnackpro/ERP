# Duado POS v1.8.3: perbaikan backend B9 dan B10 (kolom tgl, pindai ekor, cache dashboard/laporan)

Ringkasan dan cara memasang: lihat `CATATAN_RILIS_v1.8.3.md`. Ganti 6 file di `apps-script/` (Code, Reports, Master, Production, Archive, Backup), deploy versi baru, jalankan `setup()` sekali (migrasi kolom `tgl`). `web/` tidak berubah.

---

# Duado POS v1.8.2: perbaikan backend tingkat tinggi (B1, B2, B3, B5, B7, B8)

Ringkasan dan cara memasang: lihat `CATATAN_RILIS_v1.8.2.md`. Pasang **Code.gs** dan **Kasir.gs** lalu unggah ulang `web/`; tanpa `setup()`.

---

# Duado POS v1.8.1: perbaikan dari dokumen "Analisis Algoritma dari Sudut Pandang Bisnis" (Tahap 1 dan 2)

## Perubahan v1.8.1 (setelah v1.8.0)
- **Pembanding dashboard "Hari" kembali ke KEMARIN** (di v1.8.0 salah dibuat "hari yang sama minggu lalu"). Minggu = 7 hari sebelumnya; Bulan = tanggal 1 s.d. N bulan ini vs tanggal 1 s.d. N bulan lalu.
- **Bug tampilan laporan**: tanda "?" (margin belum bisa dihitung karena HPP kosong) membaca kolom lama sehingga bergeser setelah kolom laporan bertambah. Sudah diperbaiki untuk laporan Penjualan dan HPP; kolom angka kosong tampil "-".
- **HPP harga beli terakhir kini memuat alokasi ongkir**, sama dengan HPP rata-rata, sehingga keduanya sebanding. Harga rekomendasi tidak lagi muncul bila HPP belum diisi (status "HPP belum diisi").
- **Kontrol kas (visibilitas Owner)**: kolom "kas keluar" dan "modal awal" diisi kasir, sehingga bisa dipakai menutupi kekurangan uang. Kini daftar Penutupan terakhir (Owner) menampilkan modal awal, kas keluar, dan sisa laci penutupan sebelumnya, dan **email audit harian** memuat: selisih uang laci per kasir, kas keluar tunai yang diisi (untuk diperiksa kewajarannya), dan modal awal yang berbeda dari sisa laci sebelumnya (wajar bila ada setoran). Selisih kas dihitung sebagai temuan.
- Email audit: hitungan transaksi tidak lagi menghitung retur sebagai transaksi.
- **Audit algoritma otomatis (`tests/t6.js`)**: operasi acak (penjualan dengan PPN mati/inklusif/eksklusif, diskon, tiga basis fee, retur parsial dan penuh, tutup kasir berulang) dibandingkan dengan hitungan independen di dalam tes: nilai transaksi, fee, stok, omzet/laba (dashboard = laporan = jumlah per produk), retur yang meniadakan transaksi asal sampai ke rupiah, rekap shift per metode bayar, penanda penutupan, laba bersih, margin dan harga rekomendasi (minimal dan memenuhi target). Dijalankan dengan 8 seed (3.400 pemeriksaan, nol gagal). Tes juga diuji dengan "mutasi" (bug sengaja disuntik ke salinan kode) dan terbukti mendeteksinya.
- Jika v1.8.0 sudah terpasang: ganti `Reports.gs`, `Kasir.gs`, `Backup.gs` dan unggah ulang `web/`; tidak perlu `setup()` lagi.

## Cara menerapkan (dari v1.7.0)
1. **Cadangkan dulu**: Google Drive, buat salinan spreadsheet "Duado Snack DB" secara manual.
2. **Apps Script**: ganti isi `Code.gs`, `Kasir.gs`, `Reports.gs`, `Master.gs`, `Import.gs`, `Backup.gs` (`Archive.gs`, `Production.gs`, `appsscript.json` tidak berubah).
3. Jalankan `setup()` sekali (aman diulang). Ia menambah kolom baru: `sales.ref_sale_id`, `sales.closing_id`, `channels.basis_fee`, `cash_closings.modal_awal/kas_keluar/tunai_diharapkan`, serta pengaturan `kategori_masuk_hpp` dan `kelipatan_harga`. Migrasi juga berjalan otomatis pada permintaan pertama.
4. **Deploy > Manage deployments > Edit > New version** (URL `/exec` tetap sama).
5. **Web**: unggah folder `web/` ke GitHub. `VERSION` di `sw.js` dan `js/config.js` sudah 1.8.1; perangkat kasir akan menampilkan banner "Versi baru tersedia", tekan **Muat ulang**.
6. Di aplikasi (Owner): **Menu > Pengaturan > HPP & Overhead**, isi **Kategori biaya yang sudah masuk HPP** (mis. `Listrik, Gas`), cek **Target margin**, lalu simpan. Di **Data Master > Channel**, pilih **Fee dihitung dari** sesuai kebijakan tiap channel (bawaan: Total bayar, sama seperti sebelumnya).

## Apa yang berubah
| Kode | Perbaikan |
|---|---|
| K1 | **Laba per produk kini sama dengan laba kotor ringkasan.** Diskon dan PPN dialokasikan ke setiap baris item (neto = bruto x omzet bersih transaksi / dasar sesudah diskon; sisa pembulatan di baris terakhir). Laporan Penjualan memuat kolom baru **Omzet bersih**, margin dihitung dari omzet bersih, dan Top Produk memakai dasar yang sama. Pada skenario uji dokumen: laba baris produk Rp55.495 (dulu Rp71.000), margin 58,1% (dulu 64%). Berlaku juga untuk data lama karena dihitung saat laporan dibuka, bukan disimpan. |
| K2 | **Basis fee per channel** (total / subtotal / omzet bersih tanpa PPN), diatur di Data Master > Channel. Impor Shopee menerima kolom `fee` aktual per pesanan (bila ada) yang menggantikan perkiraan. |
| K3 | Laporan **HPP dan margin** kini: margin dihitung dari harga bersih (tanpa PPN), ada kolom **HPP harga beli terakhir** (biaya resep dengan harga beli terakhir bahan, termasuk alokasi ongkir) dan **margin berdasarkan HPP terbaru**, serta **Harga rekomendasi** = (HPP + fee tetap) / (1 - fee% - target margin), memakai HPP yang lebih tinggi, ditambah PPN bila inklusif, dibulatkan ke atas ke kelipatan Pengaturan. Status memberi peringatan bila margin turun karena harga bahan naik. |
| K4 | Kategori biaya yang ditandai "sudah masuk HPP" **tidak dipotong lagi** di laba bersih (dashboard dan Laba Rugi; tampil sebagai baris Info). Dashboard memberi **peringatan bila ada produksi tetapi overhead Rp0**. Tombol **Hitung saran overhead** di Pengaturan = biaya bulan lalu (kategori bertanda) / unit yang diproduksi bulan lalu. |
| K5 | **Rekap tutup kasir berbasis penanda** (`closing_id`), bukan jam perangkat: transaksi dari HP berjam tertinggal tidak lagi hilang dan tidak terhitung dua kali. **Hitung buta**: kasir mengisi uang laci dulu, nominal baru tampil setelah tutup. Ditambah **modal awal laci** (diingat dari penutupan sebelumnya) dan **kas keluar tunai**. Rumus: tunai seharusnya = modal awal + tunai sistem (sudah dikurangi retur) - kas keluar. Transaksi tersangkut yang diselesaikan lewat Pemeriksaan data masuk rekap berikutnya. |
| K6 | **Retur / void**. Di Riwayat, tombol **Retur** pada transaksi selesai (parsial atau semua sisa, alasan wajib). Transaksi lama tidak diubah: retur dicatat sebagai transaksi baru bernilai **minus** (nomor `RT-yymmdd-xxx`, `ref_sale_id` = transaksi asal, tanggal hari retur), stok kembali lewat mutasi `retur`. Omzet, HPP, laporan, dan rekap shift ikut berkurang otomatis; periode yang sudah ditutup tidak berubah. Kasir butuh PIN Owner (sekali pakai, terikat ke retur itu); Owner langsung. Retur tidak dihitung sebagai transaksi, tidak bisa melebihi sisa, tidak bisa diretur lagi, dan kirim ulang tidak menggandakan. Sisa terakhir memakai sisa nilai sehingga transaksi asal + seluruh retur = tepat 0. |
| K7 | **Hapus dari antrean wajib meninggalkan jejak**: butuh internet, alasan wajib, lalu dicatat ke `audit_log` (`tolak_transaksi`: isi transaksi, total, metode, kasir, galat, alasan). Muncul di email audit harian. Server menolak pencatatan bila transaksi itu sebenarnya sudah masuk (arahkan ke Coba lagi). |
| K8 | **Server menerima penjualan yang sudah terjadi secara fisik** walau stok server kurang: transaksi tercatat dengan tanda `[STOK MINUS ...]`, kasir mendapat peringatan, dashboard menampilkan **Stok minus, perlu opname**, dan email audit harian ikut melaporkannya. Pemblokiran tetap berlaku di layar kasir (pengaturan Blokir penjualan jika stok kurang). Ledger stok tetap cocok (audit stok bersih). |
| K9 | **Perbandingan periode sepadan**: hari dibanding kemarin; minggu dibanding 7 hari sebelumnya; bulan = tanggal 1 s.d. N dibanding tanggal 1 s.d. N bulan lalu (dibatasi panjang bulan lalu). Rentang pembanding tampil di dashboard. |

## Keputusan desain yang perlu diketahui
- **Harga neto per baris tidak disimpan** di `sale_items`; dihitung saat laporan dibuka dari angka transaksi. Hasilnya identik dan otomatis berlaku untuk data lama tanpa migrasi.
- **Retur tidak mengubah transaksi asal** (tidak ada status batal). Alasannya: periode yang sudah ditutup dan sudah dilaporkan tetap utuh, dan semua laporan cukup menjumlahkan.
- **Retur mengembalikan stok sebagai barang layak jual.** Bila barang yang diretur rusak, lakukan opname untuk mengurangi stok lagi (mutasi tercatat).
- **Retur dikembalikan dengan metode bayar transaksi asal** dan memengaruhi rekap shift kasir yang memproses retur (kolom tunai berkurang bila asalnya tunai).
- **Hitung buta** berarti rekap nominal hanya tampil setelah penutupan; layar sebelum itu hanya menampilkan jumlah transaksi.
- **Batas hitung buta**: kasir masih bisa melihat total penjualannya sendiri di menu Riwayat, jadi hitung buta adalah kontrol perilaku, bukan penghalang teknis. Kontrol sebenarnya ada di sisi Owner (selisih, kas keluar, dan modal awal di daftar penutupan dan email audit).

## Yang belum dikerjakan (sengaja)
Tahap 3 dan 4 dokumen analisis (K10 piutang/utang tempo, K11 kedaluwarsa dan susut berkategori, K12 saran beli/produksi, K13 analitik produk, K14 harga grosir/promo, K15 pembulatan tunai dan estimasi PPh Final, K16 kebersihan data) belum dikerjakan. Dokumen menyatakan desainnya bergantung pada jawaban Owner (bagian 7: PPN, tempo, umur simpan, jumlah kasir/outlet, basis fee, status Wajib Pajak). Kirim jawabannya, maka saya kerjakan yang relevan.

## Pengujian
- `cd tests`, lalu `node t1.js`, `t2.js`, `t3.js`, `t4.js`, `fe.js`, `t5.js`, `fe2.js`, dan `node t6.js <seed>`. Hasil: t1 38, t2 24, t3 9, t4 70, fe 18, **t5 59 (baru: K1-K9 termasuk skenario angka dokumen dan kontrol kas)**, **fe2 18 (baru: UI tutup kasir buta, retur, hapus antrean)**, **t6 sekitar 420 per seed (audit acak)**; seluruhnya lolos.
- Tes `t1` dan `t2` disesuaikan karena perilaku memang berubah (ringkasan shift tidak lagi memuat nominal; skema sales kini 21 kolom).
- **Belum dijalankan di Apps Script asli dan belum memakai data riil Anda.** Uji dulu di salinan spreadsheet: buat penjualan, retur sebagian dan penuh, tutup kasir dua kali, lalu cek laporan Penjualan dan HPP. Nilai laporan lama akan berubah (lebih akurat) karena K1 dan K2.

---

# Duado POS v1.7.0: logo struk untuk printer thermal

## Cara menerapkan (dari v1.6.0)
1. **Apps Script**: ganti isi `Code.gs` saja (file lain tidak berubah). Jalankan `setup()` sekali (menambah pengaturan bawaan `logo_aktif` dan `logo_nama`; aman diulang). Lalu **Deploy > Manage deployments > Edit > New version**.
2. **Web**: unggah folder `web/` ke GitHub. `VERSION` di `sw.js` dan `js/config.js` sudah 1.7.0, jadi perangkat kasir akan menampilkan banner "Versi baru tersedia" lalu tekan **Muat ulang**.
3. Di aplikasi (Owner): **Menu > Pengaturan > Logo struk > Pilih gambar logo**.

## Cara memakai
- Pilih gambar (PNG, JPG, WebP; latar transparan menjadi putih). Pratinjau tampil sesuai lebar kertas (58 atau 80 mm) dan berubah langsung saat pengaturan digeser.
- **Logo berwarna**: aplikasi mendeteksinya dan menampilkan sakelar **Ubah ke hitam-putih (B&W)**. Aktif (bawaan): garis dan teks tegas, cocok untuk logo. Nonaktif: halftone (titik-titik) agar gradasi tetap terlihat. Logo yang sudah hitam-putih langsung dicetak tegas.
- **Ketebalan hitam**: geser ke kanan bila bagian terang (kuning, oranye) hilang; ke kiri bila terlalu pekat. **Balik hitam dan putih**: untuk logo putih atau transparan. **Ukuran logo**: persen dari lebar kertas (bawaan 60%).
- Tekan **Simpan logo** (logo pertama langsung aktif). Sakelar **Cetak logo di struk** dan **Cetak nama usaha di bawah logo** disimpan lewat tombol Simpan pengaturan seperti biasa. Matikan nama usaha bila logo sudah memuat nama.
- **Uji cetak logo** mencetak struk contoh. Logo ikut tercetak lewat RawBT (Android) maupun Bluetooth BLE langsung, dan tampil di atas pratinjau struk. Struk WhatsApp/Bagikan tetap teks.
- Kertas diganti (58 <-> 80 mm)? Pilih ulang logo agar ukurannya pas. Bila logo lebih lebar dari kertas, otomatis dikecilkan saat cetak.

## Detail teknis
- Logo disimpan sebagai bitmap 1-bit (maks. 576 x 256 titik, sekitar 18 KB) di pengaturan `logo_data`, dibagikan ke semua perangkat kasir. Hanya Owner yang bisa mengubahnya (`setting.logo`); server memeriksa format dan ukuran. Isi logo tidak masuk `audit_log` (hanya "logo 232x116").
- Dicetak dengan perintah raster ESC/POS `GS v 0`, dikirim per pita 64 baris. Logo 232 x 116 titik (bawaan) kira-kira 1 detik lewat BLE.
- Tes baru: `node t4.js` (70 pemeriksaan: validasi server, pengemasan bitmap, raster, deteksi warna, B&W vs halftone, ESC/POS, tampilan pengaturan). Seluruh suite: t1 38, t2 24, t3 9, fe 18, t4 70, semuanya lolos.

## Yang perlu diketahui
- **Belum diuji pada printer thermal fisik.** Alur gambar sudah diuji di Chromium sungguhan (deteksi warna, B&W/halftone, pratinjau, encode/decode, raster), tetapi hasil cetak bergantung pada printer. `GS v 0` didukung hampir semua printer ESC/POS 58/80 mm; bila struk jadi karakter acak, printer tidak mendukungnya: matikan **Cetak logo di struk** dan beri tahu saya merek/tipenya.
- Cetak pertama setelah logo diaktifkan: coba **Uji cetak logo** dulu, lalu atur **Ketebalan hitam** bila terlalu pucat atau pekat (printer thermal membuat titik sedikit melebar).
- Logo tidak menyimpan gambar asli; mengubah ukuran atau ketebalan berarti memilih gambarnya lagi.

---

# Duado POS v1.6.0: ringkasan perbaikan #16-#24 dan cara menerapkan

## Cara menerapkan (urut)
1. **Cadangkan dulu**: Google Drive, buat salinan spreadsheet "Duado Snack DB" secara manual.
2. **Apps Script**: ganti isi `Code.gs`, `Master.gs`, `Reports.gs`, `Production.gs` dengan versi baru; tambahkan file baru `Kasir.gs` dan `Backup.gs` (`Archive.gs`, `Import.gs` tidak berubah).
3. Jalankan `setup()` sekali (aman diulang, tidak menghapus data). Ia menambah kolom/tabel baru dan pengaturan bawaan. Setujui izin baru (kirim email, akses eksternal untuk ekspor xlsx).
4. Jalankan `installTriggers()` sekali: backup 02:00, audit harian 06:00, uji restore Minggu 04:00, arsip tgl 1.
5. **Deploy > Manage deployments > Edit > New version** (URL `/exec` tetap sama).
6. **Web**: unggah folder `web/` ke GitHub. Di komputer ber-internet jalankan sekali `sh tools/ambil-font.sh` (di dalam `web/`), commit folder `fonts/`. Setelah itu, setiap rilis naikkan `VERSION` di `sw.js` dan `js/config.js` (sekarang 1.6.0).
7. Di aplikasi: Menu > Pengaturan > isi **Email laporan** dan **Email cadangan terpisah**, cek **Batas diskon** dan metode bayar, lalu simpan.

## Apa yang berubah
| # | Perbaikan |
|---|---|
| 16 | Laporan/dashboard/audit tidak lagi memakai `lastRows_` (8.000/20.000 baris). Kini membaca kolom tanggal lalu hanya baris pada rentang yang diminta, tanpa batas jumlah. Teruji dengan 12.000 penjualan. Bila rentang laporan melewati batas arsip, muncul peringatan. |
| 17 | Kasir mengirim `client_ts`; server menyimpannya sebagai tanggal transaksi (sinkron dicatat di kolom baru `sync_at`). Waktu yang tidak masuk akal (>10 menit di masa depan atau >14 hari lalu) diganti waktu server dan ditandai di catatan. |
| 18 | Kasir mengirim `total_klien`. Bila beda dari hitungan server, transaksi ditolak masuk status "Perlu ditinjau"; Owner bisa menyetujui dengan PIN (tombol **Otorisasi Owner** di antrean). Dapat dimatikan di Pengaturan. Selisih tercatat di kolom `total_klien`. |
| 19 | Penulisan dua tahap: `proses` lalu `selesai`. Laporan hanya menghitung `selesai`. Transaksi tersangkut muncul di Menu > Pemeriksaan data dengan tombol **Selesaikan/Batalkan** (stok tidak pernah terpotong dua kali). `stockAudit_` kini memeriksa seluruh penjualan dan dikirim ke email tiap hari 06:00. |
| 20 | PIN 6-10 angka, menolak pola mudah (123456, 111111, 121212). Hash berlapis 1.000 putaran (PIN lama otomatis di-upgrade saat login). Penguncian tersimpan permanen dan bertingkat (15 menit, 1 jam, 6 jam, 24 jam), ada rem global, Owner bisa **Buka kunci**. Nonaktifkan/ganti PIN/ganti peran langsung mencabut sesi. Logout mencabut sesi di server. Hash tidak lagi bocor ke `audit_log`. Owner aktif terakhir tidak bisa dinonaktifkan. |
| 21 | Backup harian (30), mingguan (12), bulanan (12) + ekspor .xlsx mingguan (disimpan di Drive dan dikirim ke email cadangan). Setiap backup diverifikasi; gagal = email. `restoreDrill()` tiap minggu menguji restore pada salinan sementara. `restoreFromBackup()` untuk pemulihan nyata. Langkah akun Google khusus ada di bawah. |
| 22 | Batas diskon kasir (bawaan 10%, di atasnya butuh PIN Owner), whitelist metode bayar (server menolak metode di luar daftar), **Tutup kasir** (rekap shift, hitung uang laci, selisih tersimpan), dan penguncian ganti user: login pengguna lain ditolak selama antrean perangkat belum kosong. Owner boleh mengambil alih dan mengirim atas nama kasir asal. |
| 23 | Service worker cache-first murni, `cache: 'reload'` saat pasang, font Baloo 2 lokal (Google Fonts dihapus dari `index.html`), `updateViaCache: 'none'`. |
| 24 | Lihat bagian Supabase. |

## #21: akun Google khusus (langkah manual)
1. Buat akun Google baru khusus sistem (mis. `duado.sistem@gmail.com`), bukan akun pribadi.
2. Aktifkan **Verifikasi 2 Langkah**, utamakan kunci keamanan/passkey atau aplikasi autentikator (bukan SMS saja). Simpan kode cadangan di tempat fisik terpisah.
3. Pindahkan kepemilikan spreadsheet dan folder "Duado Backup" ke akun itu, jalankan ulang `setup()` dan `installTriggers()` dari akun itu, deploy ulang Web App dari akun itu.
4. Bagikan folder backup ke akun pribadi Owner (hanya lihat), dan isi **Email cadangan terpisah** dengan email Owner.
5. Jangan dipakai untuk email/YouTube/browsing sehari-hari.

## #24: perlu migrasi ke Supabase?
**Belum wajib; coba dulu optimasi ini (sudah diterapkan).** Lambatnya simpan resep/data bukan dari volume data, tetapi dari tiap simpan melakukan banyak panggilan Sheets lalu satu permintaan `bootstrap` penuh. Yang diperbaiki:
- Simpan data baru tidak lagi membaca sheet; edit hanya membaca kolom id lalu satu baris.
- Resep menimpa blok barisnya saja (dulu: hapus dan tulis ulang seluruh tabel `recipe_items`).
- Audit ditulis sekali per permintaan, versi data dibaca dari cache, sesi tidak ditulis ulang tiap permintaan.
- Setelah simpan master/resep, aplikasi memperbarui satu baris lokal tanpa memuat ulang semua data (dulu 2 permintaan berurutan, kini 1).
- Transaksi kasir tetap lokal-dulu: layar tidak menunggu server, jadi "sinkron lama" hanya terasa di latar belakang.

Batas yang tidak bisa dihilangkan di Apps Script: tiap permintaan Web App tetap ±1-3 detik (cold start + Sheets). Pertimbangkan Supabase bila: lebih dari 2-3 kasir bersamaan, banyak outlet, data >100 ribu baris penjualan, butuh transaksi database sungguhan (menggantikan "proses → selesai"), atau waktu simpan masih tidak nyaman setelah update ini.
Biaya (per pencarian Agustus 2026): paket Free menjeda proyek setelah 7 hari tanpa aktivitas dan tanpa backup harian, jadi tidak layak untuk kasir; Pro sekitar $25/bulan plus pemakaian, dengan backup harian 7 hari. Migrasi berarti menulis ulang seluruh backend dan memindahkan data, sekitar 1-2 minggu kerja. Cek ulang harga di supabase.com/pricing sebelum memutuskan.

## Yang perlu diketahui sebelum dipakai
- Diuji pada simulasi lokal (Sheets/Cache/Lock tiruan) dan DOM tiruan: 89 pemeriksaan lolos (`tests/`, jalankan `node t1.js`). **Belum dijalankan di Apps Script asli**, jadi coba dulu di jam sepi dan perhatikan email audit pertama.
- Font belum bisa saya unduh dari sini (tanpa internet): sebelum `ambil-font.sh` dijalankan, aplikasi memakai font cadangan.
- Perilaku baru yang mungkin terasa: kasir dibatasi diskon 10%; PIN baru minimal 6 angka (PIN lama 4-8 angka tetap bisa masuk, ada pengingat); transaksi dengan harga basi masuk "Perlu ditinjau".
- Perangkat dengan aplikasi lama (1.5.x) tetap bisa mengirim (tanpa `total_klien` dilewati pemeriksaannya) sampai mereka menekan "Muat ulang".
