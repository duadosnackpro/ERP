// Uji hash PIN backend (v1.9.7): memuat kode ASLI dari Code.gs (blok hash PIN) ke sandbox dengan Utilities/PropertiesService tiruan berbasis crypto Node.
// Jalankan: node tests/be_pin.js
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const src = fs.readFileSync(process.env.GS_SRC || path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const a = src.indexOf('const PIN_ROUNDS'), b = src.indexOf('function pinProblem_(');
if (a < 0 || b < 0) throw new Error('penanda blok hash tidak ditemukan di Code.gs');
const code = src.slice(a, b);

const sg = buf => Array.from(buf, x => (x << 24) >> 24), us = arr => Buffer.from(arr.map(x => x & 255));
const toBuf = x => typeof x === 'string' ? Buffer.from(x, 'utf8') : us(x);
function mk(props) {
  const store = Object.assign({}, props || {}); let uuid = 0;
  const ctx = {
    Utilities: {
      DigestAlgorithm: {SHA_256: 'sha256'},
      computeDigest: (_, v) => sg(crypto.createHash('sha256').update(toBuf(v)).digest()),
      computeHmacSha256Signature: (v, k) => sg(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
      newBlob: s => ({getBytes: () => sg(Buffer.from(s, 'utf8'))}),
      base64Encode: v => (typeof v === 'string' ? Buffer.from(v) : us(v)).toString('base64'),
      getUuid: () => crypto.randomUUID() + (uuid++ ? '' : ''),
    },
    PropertiesService: {getScriptProperties: () => ({getProperty: k => k in store ? store[k] : null, setProperty: (k, v) => { store[k] = String(v); }})},
  };
  vm.createContext(ctx); vm.runInContext(code + '\nthis.X = {hashV3_, hashV2_, hash_, hashNew_, pinOk_, pepper_, needsRehash_, pbkdf2_, pinRounds_, bytes_};', ctx);
  return {X: ctx.X, store};
}

let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('GAGAL: ' + m); } };

// 1. PBKDF2 sama persis dengan implementasi referensi Node (pbkdf2Sync)
{
  const {X} = mk(), pw = [1, -2, 3, 120, -128, 127], salt = X.bytes_('garam-uji');
  for (const r of [1, 2, 1000, 2000]) {
    const mine = us(X.pbkdf2_(pw, salt, r)).toString('hex'), ref = crypto.pbkdf2Sync(us(pw), us(salt), r, 32, 'sha256').toString('hex');
    ok(mine === ref, 'PBKDF2 putaran ' + r + ' harus sama dengan crypto.pbkdf2Sync');
  }
}
// 2. Hash baru: format, verifikasi benar/salah, pepper dibuat sekali dan dipakai ulang
{
  const {X, store} = mk(), salt = 'u-1';
  ok(!('PIN_PEPPER' in store), 'pepper belum ada di awal');
  const h = X.hashNew_('481516', salt);
  ok(/^v3\$2000\$[A-Za-z0-9+/=]+$/.test(h), 'format v3$2000$... (dapat: ' + h + ')');
  ok(store.PIN_PEPPER && store.PIN_PEPPER.length >= 96, 'pepper dibuat otomatis, panjang >= 96 karakter');
  const p1 = store.PIN_PEPPER; X.hashNew_('000111', 'x'); ok(store.PIN_PEPPER === p1, 'pepper tidak berubah pada pemanggilan berikutnya');
  ok(X.pinOk_('481516', {salt, hash_pin: h}) === true, 'PIN benar lolos');
  ok(X.pinOk_('481517', {salt, hash_pin: h}) === false, 'PIN salah ditolak');
  ok(X.pinOk_('481516', {salt: 'u-2', hash_pin: h}) === false, 'salt lain ditolak');
  ok(X.needsRehash_(h) === false, 'hash v3 dengan putaran terkini tidak perlu ditingkatkan');
  // inti perlindungan: tanpa pepper, isi spreadsheet saja tidak bisa dipakai menebak/memverifikasi PIN
  const {X: Y} = mk(); // "penyerang": kode sama, salt+hash sama, pepper berbeda/tidak punya
  ok(Y.pinOk_('481516', {salt, hash_pin: h}) === false, 'tanpa pepper yang sama, PIN benar pun tidak terverifikasi (hash bocor tidak cukup)');
  // hash v3 tidak sama bila pepper beda
  const {X: Z} = mk({PIN_PEPPER: 'lain'.repeat(30)}); ok(Z.hashNew_('481516', salt) !== h, 'pepper berbeda menghasilkan hash berbeda');
}
// 3. Format lama tetap dikenali dan diminta ditingkatkan
{
  const {X} = mk(), salt = 'u-9', pin = '246802';
  const legacy = X.hash_(pin, salt), v2 = X.hashV2_(pin, salt, 1000);
  ok(X.pinOk_(pin, {salt, hash_pin: legacy}) && !X.pinOk_('246803', {salt, hash_pin: legacy}), 'format lama (SHA-256 polos) masih terverifikasi');
  ok(X.pinOk_(pin, {salt, hash_pin: v2}) && !X.pinOk_('246803', {salt, hash_pin: v2}), 'format v2 masih terverifikasi');
  ok(X.needsRehash_(legacy) && X.needsRehash_(v2), 'format lama dan v2 ditandai perlu ditingkatkan');
  ok(X.needsRehash_('') && X.needsRehash_(undefined), 'hash kosong ditandai perlu ditingkatkan');
}
// 4. Putaran bisa diatur lewat Script Property, dengan batas aman
{
  ok(mk({PIN_ROUNDS: '5000'}).X.pinRounds_() === 5000, 'PIN_ROUNDS=5000 dipakai');
  ok(mk({PIN_ROUNDS: '5'}).X.pinRounds_() === 2000, 'nilai terlalu kecil diabaikan (kembali ke bawaan)');
  ok(mk({PIN_ROUNDS: 'abc'}).X.pinRounds_() === 2000, 'nilai bukan angka diabaikan');
  const {X} = mk({PIN_ROUNDS: '3000'}), h = X.hashNew_('135790', 's'); ok(/^v3\$3000\$/.test(h), 'hash baru memakai putaran dari properti');
  const {X: X2, store} = mk({PIN_ROUNDS: '2000', PIN_PEPPER: store0()}); function store0() { return 'p'.repeat(100); }
  const old = X2.hashV3_('135790', 's', 1000, store.PIN_PEPPER); ok(X2.needsRehash_(old) && X2.pinOk_('135790', {salt: 's', hash_pin: old}), 'v3 berputaran lebih rendah dari target: tetap sah, ditingkatkan saat login');
}
console.log(fail ? 'GAGAL: ' + fail + ' dari ' + (pass + fail) : 'Semua lulus (' + pass + ' pemeriksaan)'); process.exit(fail ? 1 : 0);
