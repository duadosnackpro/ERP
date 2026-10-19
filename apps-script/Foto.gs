/* ===== Foto produk (v1.9.1) =====
   HP mengompres foto (target 480 px, WebP, ±30 KB) lalu mengirimnya base64 lewat aksi produk.foto. File disimpan di folder Drive "Duado Foto"
   (dibagikan "siapa pun dengan tautan" agar tampil di kasir tanpa login); products.foto_url menyimpan alamatnya. Setiap unggahan membuat file BARU
   (alamat berubah), file lama dibuang ke tempat sampah: alamat tidak pernah berubah isinya, sehingga cache offline di perangkat aman. */
const FOTO_MAX_BYTES_ = 120 * 1024; // klien menargetkan ±30 KB; batas server longgar tetapi menolak foto mentah
const fotoUrl_ = id => 'https://lh3.googleusercontent.com/d/' + id + '=w480';
const fotoId_ = url => { const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(String(url || '')); return m ? m[1] : ''; };
function fotoFolder_() {
  const pr = PropertiesService.getScriptProperties(), id = pr.getProperty('FOTO_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* folder terhapus: buat ulang */ } }
  const it = DriveApp.getFoldersByName('Duado Foto'), f = it.hasNext() ? it.next() : DriveApp.createFolder('Duado Foto');
  pr.setProperty('FOTO_FOLDER', f.getId()); return f;
}
function fotoMime_(b) { // cek tanda file asli (bukan sekadar klaim klien); byte Apps Script bertanda, jadi & 255
  const x = i => b[i] & 255;
  if (b.length > 12 && x(0) === 0x52 && x(1) === 0x49 && x(2) === 0x46 && x(3) === 0x46 && x(8) === 0x57 && x(9) === 0x45 && x(10) === 0x42 && x(11) === 0x50) return 'image/webp';
  if (b.length > 3 && x(0) === 0xFF && x(1) === 0xD8 && x(2) === 0xFF) return 'image/jpeg';
  return '';
}
function setFoto_(p, uid) { // data kosong = hapus foto
  const pid = String(p.product_id || ''), d = String(p.data == null ? '' : p.data);
  if (!tbl_('products').some(x => x.id === pid && active_(x))) throw new Error('Produk tidak ditemukan.');
  let bytes = null, mime = '';
  if (d !== '') {
    if (d.length > Math.ceil(FOTO_MAX_BYTES_ / 3) * 4 + 8 || !/^[A-Za-z0-9+\/]+={0,2}$/.test(d)) throw new Error('Foto tidak valid atau terlalu besar (maks. ±120 KB setelah dikompres).');
    bytes = Utilities.base64Decode(d);
    if (bytes.length > FOTO_MAX_BYTES_) throw new Error('Foto terlalu besar (maks. ±120 KB setelah dikompres).');
    mime = fotoMime_(bytes); if (!mime) throw new Error('Format foto harus WebP atau JPEG.');
  }
  let file = null, url = '';
  if (bytes) { // pembuatan file Drive (lambat) dilakukan DI LUAR kunci agar kasir lain tidak menunggu
    file = fotoFolder_().createFile(Utilities.newBlob(bytes, mime, 'p_' + pid + '_' + Date.now() + (mime === 'image/webp' ? '.webp' : '.jpg')));
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (e) { file.setTrashed(true); throw new Error('Drive tidak mengizinkan berbagi tautan (kebijakan akun). Foto tidak disimpan.'); }
    url = fotoUrl_(file.getId());
  }
  let oldId = '';
  try {
    withLock_(() => {
      const cur = readAll_('products').find(x => x.id === pid && active_(x)); if (!cur) throw new Error('Produk tidak ditemukan.');
      oldId = fotoId_(cur.foto_url); saveRaw_('products', {id: pid, foto_url: url}, uid);
    });
  } catch (e) { if (file) { try { file.setTrashed(true); } catch (e2) {} } throw e; }
  if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { console.warn('Foto lama tidak bisa dibuang: ' + e.message); } }
  return {id: pid, foto_url: url};
}
