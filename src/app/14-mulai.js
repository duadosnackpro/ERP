/* ---------- Mulai ---------- */
let swReg = null;
function updBanner() { const b = $('#upd'); b.hidden = false; b.innerHTML = 'Versi baru tersedia <button data-act="reload">Muat ulang</button>'; }
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller; let rl = false;
  navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).then(reg => {
    swReg = reg; if (reg.waiting && had) updBanner();
    reg.addEventListener('updatefound', () => { const nw = reg.installing; if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) updBanner(); }); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !rl) { rl = true; location.reload(); } });
}
ACT.reload = () => { if (swReg && swReg.waiting) swReg.waiting.postMessage({type: 'SKIP_WAITING'}); else location.reload(); };
window.addEventListener('online', () => { badge(); flush(); checkUpdates(true); });
window.addEventListener('offline', badge);
document.addEventListener('visibilitychange', () => { if (document.hidden) Store.flush(); if (!document.hidden) { checkUpdates(); flush(); if (swReg) swReg.update().catch(() => {}); } });
async function start() {
  await Store.init();
  S.token = LS.get('token', null); S.data = LS.get('data', null); S.queue = LS.get('queue', []); S.ch = LS.get('ch', null); S.cart = LS.get('cart', []); S.metode = LS.get('metode', 'tunai'); S.lastSync = LS.get('lastsync', 0) || null; S.hideOut = !!LS.get('hideOut', false);
  if (S.token && S.data) { S.tab = own() ? 'dash' : 'kasir'; render(); checkUpdates(true); flush(); } else renderLogin();
}
window.addEventListener('pagehide', () => Store.flush());
if (window.MutationObserver) new MutationObserver(() => { cancelAnimationFrame(S.fr); S.fr = requestAnimationFrame(initFades); }).observe(document.getElementById('app'), {childList: true, subtree: true});
if (window.matchMedia) { const mq = matchMedia('(min-width: 900px)'); (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => { if (S.token && S.data && $('#sheet').hidden && !S.dirty) render(); }); }
Object.assign(APP.views, {tutup: vTutup, kasir: vKasir, riwayat: vRiwayat, stok: vStok, menu: vMenu, master: vMaster, users: vUsers, settings: vSettings, diag: vDiag});
Object.assign(APP, {S: S, api: api, $: $, rp: rp, num: num, esc: esc, LS: LS, T: T, sheet: sheet, closeSheet: closeSheet, toast: toast, busy: busy, busyLabel: busyLabel, skel: skel, ACT: ACT,
  render: render, loadData: loadData, patchRecipe: patchRecipe, patchMaster: patchMaster, checkUpdates: checkUpdates, verSync: verSync, dverKey: dverKey, vload: vload, dnum: dnum, qf: qf, r6: r6, flush: flush, Store: Store, isWide: isWide, skuLevel: skuLevel, wrapChips: wrapChips, isAddon: isAddon, emptyState: emptyState, idDate: idDate, idRange: idRange, addDays: addDays, lvText: lvText, vById: vById, pById: pById, vName: vName, vSub: vSub, chName: chName, fmtDT: fmtDT, today: today, own: own, start: start});
})();
