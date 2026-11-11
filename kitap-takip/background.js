// Arka plan: zamanlanmış tarama. Her sayfayı kullanıcının kendi tarayıcısında
// arka plan sekmesinde açar, veriyi okur, kaydeder ve sekmeyi kapatır.
importScripts('targets.js', 'lib.js', 'telegram.js');

const ALARM = 'kitap-takip-tarama';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getState() {
  const s = await chrome.storage.local.get(['targets', 'snapshots', 'settings', 'book']);
  return {
    targets: s.targets || DEFAULT_TARGETS,
    snapshots: s.snapshots || [],
    settings: { intervalHours: 12, cartProbe: false, ...(s.settings || {}) },
    book: s.book || DEFAULT_BOOK,
  };
}

async function schedule() {
  const { settings } = await getState();
  await chrome.alarms.clear(ALARM);
  chrome.alarms.create(ALARM, { delayInMinutes: settings.intervalHours * 60, periodInMinutes: settings.intervalHours * 60 });
}

// Sekme yüklenene kadar bekler. Her saniye bir API çağrısı yapmak arka plan
// işçisinin uykuya geçmesini de önler.
async function waitLoaded(tabId, maxMs) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === 'complete') return true;
    await sleep(1000);
  }
  return false;
}

async function settle(tabId, ms) {
  for (let t = 0; t < ms; t += 1000) { await chrome.tabs.get(tabId).catch(() => null); await sleep(1000); }
}

// Okuyucu sayfanın kendi bağlamında (MAIN) çalışır; sitenin gömdüğü ürün verisini ancak oradan görebilir.
async function readTab(tabId, isbn) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['extractor.js'], world: 'MAIN' });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: (i) => globalThis.__kitapTakipExtract(i), args: [isbn] });
  return res && res.result;
}

async function loadAndRead(tabId, isbn) {
  await waitLoaded(tabId, 40000);
  await settle(tabId, 4000);
  let data = await readTab(tabId, isbn);
  if (data && data.status === 'blocked') {
    // Çoğu doğrulama gerçek tarayıcıda birkaç saniyede kendiliğinden geçer.
    await settle(tabId, 12000);
    await waitLoaded(tabId, 20000);
    data = await readTab(tabId, isbn);
  }
  return data;
}

// Adres bir arama sayfasıysa kitabın kendi sayfasını bulup oraya geçer.
const SEARCH_URL_RE = /([?&](q|query|k|filter_name|search|keyword)=|\/(arama|search|ara|sr)(\/|\?|$))/i;
async function followSearch(tabId, book) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: (i, t) => globalThis.__kitapTakipFindProduct(i, t), args: [book.isbn, book.title],
  });
  const link = res && res.result;
  if (!link) return null;
  await chrome.tabs.update(tabId, { url: link });
  await settle(tabId, 1500);
  const data = await loadAndRead(tabId, book.isbn);
  return data ? { link, data } : null;
}

// --- Sepet sınırıyla stok ölçümü ---
// Kitabı sepete ekler, adedi site izin vermeyene kadar yükseltir, sonucu okur ve kitabı sepetten
// çıkarır. Sayfa tarafındaki adımlar cartprobe.js içindedir; satın alma düğmelerine basılmaz.
const CART_BIG = 999; // adet kutusuna yazılan sayı
const CART_MAX_STEPS = 40; // artı düğmesine en fazla basış

async function cartCall(tabId, fn, args = []) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['cartprobe.js'], world: 'MAIN' });
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: (f, a) => globalThis.__kitapTakipCart[f](...a), args: [fn, args] });
    return (res && res.result) || {};
  } catch (e) {
    return {}; // sayfa o an yenileniyor olabilir; çağıran yeniden dener
  }
}

async function openAndWait(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await settle(tabId, 1000);
  await waitLoaded(tabId, 30000);
  await settle(tabId, 2000);
}

// Koşul sağlanana kadar sepeti yeniden okur.
async function lookUntil(tabId, look, done, maxMs) {
  let state = await look();
  for (let waited = 0; !done(state) && waited < maxMs; waited += 1000) {
    await settle(tabId, 1000);
    state = await look();
  }
  return state;
}

// Kitabı sepetten çıkarır ve sepeti yeniden açıp gittiğini doğrular.
// isOurs: okunan durumun, ölçümün kendi eklediği satırı gösterdiğini doğrular; değilse dokunulmaz.
async function emptyCartLine(tabId, cartUrl, look, book, ids, linesBefore) {
  const isOurs = (x) => x.page === 'cart' && x.found && x.groups === linesBefore + 1;
  let s = await look();
  if (s.page !== 'cart') { await openAndWait(tabId, cartUrl); s = await look(); }
  let mode = 'delete';
  let stuck = 0;
  for (let i = 0; i < 60 && isOurs(s); i++) {
    const before = s.qty;
    const step = await cartCall(tabId, 'remove', [book.title, ids, mode]);
    if (!step.acted || step.acted === 'none') break;
    await settle(tabId, 1000);
    await cartCall(tabId, 'confirm');
    await settle(tabId, 1000);
    await waitLoaded(tabId, 20000);
    s = await look();
    if (isOurs(s) && s.qty === before) {
      stuck++;
      // Silme düğmesi işe yaramadıysa adedi eksi düğmesiyle azaltmayı dene.
      if (mode === 'delete' && stuck >= 2) { mode = 'minus'; stuck = 0; } else if (stuck >= 3) break;
    } else stuck = 0;
  }
  await openAndWait(tabId, cartUrl);
  s = await lookUntil(tabId, look, (x) => !!x.page, 6000);
  return s.page === 'cart' && s.groups === linesBefore;
}

async function probeCart(tabId, target, book) {
  const cartUrl = CART_URLS[new URL(target.url).hostname];
  const ids = [book.isbn, ...KitapTakipLib.urlIds(target.url)];
  const look = () => cartCall(tabId, 'inspect', [book.title, ids]);

  // 1) Kitap zaten sepetteyse kullanıcının sepetine dokunma.
  await openAndWait(tabId, cartUrl);
  let s = await lookUntil(tabId, look, (x) => !!x.page, 6000);
  if (s.page !== 'cart') return { ok: false, reason: s.page || 'error' };
  if (s.found) return { ok: false, reason: 'already_in_cart' };
  // Sepette ölçümden önce kaç satır vardı: yalnızca sonradan eklenen tek satıra dokunulur.
  const linesBefore = s.groups || 0;
  const isOurs = (x) => x.page === 'cart' && x.found && x.groups === linesBefore + 1;

  // 2) Ürün sayfasından sepete ekle.
  await openAndWait(tabId, target.url);
  const added = await cartCall(tabId, 'addToCart');
  if (!added.ok) return { ok: false, reason: 'no_add_button' };
  await settle(tabId, 3000);
  await waitLoaded(tabId, 20000);

  // 3) Sepette kitabın (yeni eklenen) satırını bul.
  await openAndWait(tabId, cartUrl);
  s = await lookUntil(tabId, look, isOurs, 8000);
  if (!isOurs(s)) {
    // Satır kesin olarak ayırt edilemedi: sepette hiçbir şeye dokunma. Satır sayısı değişmediyse
    // kitap eklenmemiştir; değiştiyse sepette kalmış olabilir ve kullanıcı uyarılır.
    const unchanged = s.page === 'cart' && s.groups === linesBefore;
    const diag = await cartCall(tabId, 'diag');
    return { ok: false, reason: s.page === 'cart' ? 'not_in_cart' : s.page || 'error', diag, ...(unchanged ? {} : { cleaned: false }) };
  }

  let result = { ok: false, reason: 'error' };
  try {
    // 4) Adedi, site izin vermeyene kadar yükselt.
    const notes = [...(s.messages || [])];
    let capped = false;
    for (let i = 0; ; i++) {
      if (i >= CART_MAX_STEPS) { capped = true; break; }
      const before = s.qty;
      const step = await cartCall(tabId, 'raise', [book.title, ids, CART_BIG]);
      if (!step.acted || step.acted === 'none') break;
      await settle(tabId, 1000);
      await waitLoaded(tabId, 20000);
      const changed = (x) => isOurs(x) && (step.acted === 'select-open' ? x.control === 'input' : x.qty !== before);
      const next = await lookUntil(tabId, look, changed, step.acted === 'click' ? 2000 : 6000);
      if (!isOurs(next)) break;
      notes.push(...(next.messages || []));
      s = next;
      if (step.acted === 'select-open') continue; // adet kutusu açıldı; sıradaki adım sayıyı yazar
      if (step.acted === 'click' && s.qty > before && !s.plusDisabled) continue;
      break;
    }
    if (s.qty != null && s.qty >= CART_BIG) capped = true;
    result = { ok: true, limit: s.qty, capped, note: notes.find(Boolean) || null };
  } catch (e) {
    result = { ok: false, reason: 'error' };
  }
  // 5) Ölçüm yarıda kalsa bile kitabı sepetten çıkar.
  const cleaned = await emptyCartLine(tabId, cartUrl, look, book, ids, linesBefore).catch(() => false);
  return { ...result, cleaned };
}

async function scanTarget(target, book, opts = {}) {
  let tab;
  let data;
  let url = target.url;
  let keepOpen = false;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    data = await loadAndRead(tab.id, book.isbn);
    if (data && data.status !== 'blocked' && !target.resolved && SEARCH_URL_RE.test(url)) {
      const first = data;
      const found = await followSearch(tab.id, book);
      if (found && found.data.status === 'blocked') {
        data = found.data;
      } else if (found && found.data.hasIsbn) {
        // Ürün sayfası bulundu ve ISBN'i içeriyor: bundan sonra doğrudan orası taranır.
        data = found.data;
        url = found.link;
        const { targets } = await getState();
        await chrome.storage.local.set({ targets: targets.map((t) => (t.id === target.id ? { ...t, url, resolved: true } : t)) });
      } else if (!KitapTakipLib.normTitle(first.title).includes(KitapTakipLib.normTitle(book.title))) {
        // Adres zaten ürün sayfası değilse (başlığı kitabın adı değilse) kitap bu sitede yok demektir.
        data = { status: 'not_listed', note: 'Bu sitede ISBN ile arandı, kitap bulunamadı.' };
      }
    }
    // Sepet sınırıyla stok ölçümü: yalnızca açıkça açıldıysa, bilinen sitelerde ve günde bir kez.
    if (data && CART_URLS[new URL(url).hostname] && ['in_stock', 'on_order'].includes(data.status)) {
      const { snapshots, settings } = await getState();
      if (settings.cartProbe && (opts.forceCart || KitapTakipLib.cartProbeDue(snapshots, target.id, Date.now()))) {
        const { diag: cartDiag, ...res } = await probeCart(tab.id, { ...target, url }, book).catch(() => ({ ok: false, reason: 'error' }));
        data = KitapTakipLib.applyCartResult(data, res, Date.now());
        if (cartDiag) data.diag = { ...(data.diag || {}), cart: cartDiag };
        keepOpen = res.cleaned === false; // kitap sepette kaldıysa kullanıcı görebilsin
      } else if (settings.cartProbe) {
        data = KitapTakipLib.carryCartLimit(data, snapshots, target.id, Date.now());
      }
    }
  } catch (e) {
    data = { status: 'error', note: String(e && e.message ? e.message : e).slice(0, 200) };
  }
  if (!data) data = { status: 'error', note: 'Sayfa okunamadı.' };
  // Doğrulama isteyen sekme açık kalır ki kullanıcı tamamlayabilsin.
  if (tab && data.status !== 'blocked' && !keepOpen) await chrome.tabs.remove(tab.id).catch(() => {});
  const { diag, hasIsbn, ...fields } = data;
  return { snapshot: { ...fields, ts: Date.now(), targetId: target.id, url }, diag };
}

// Taramanın getirdiği değişiklikleri, Telegram bağlıysa tek mesaj olarak gönderir.
async function notify(targets, book, events, blocked, warnings) {
  const { telegram } = await chrome.storage.local.get('telegram');
  if (!telegram || !telegram.token || !telegram.chatId) return;
  const picked = KitapTakipTelegram.pickBlockedNotices(blocked, telegram.notified || {}, KitapTakipLib.dayKey(Date.now()));
  const text = KitapTakipTelegram.buildScanMessage({ book, targets, events, blocked: picked.ids, warnings });
  if (!text) return;
  const res = await KitapTakipTelegram.sendMessage(telegram.token, telegram.chatId, text);
  const current = (await chrome.storage.local.get('telegram')).telegram;
  if (!current) return; // gönderim sırasında bağlantı kaldırılmış
  await chrome.storage.local.set({
    telegram: res.ok
      ? { ...current, notified: picked.notified, lastError: null, lastSentAt: Date.now() }
      : { ...current, lastError: { ts: Date.now(), message: res.message } },
  });
}

let running = false;
// opts.onlyId: tek site; opts.cartOnly: yalnızca sepet ölçümü yapılabilen siteler;
// opts.forceCart: bugün ölçülmüş olsa da yeniden ölç.
async function scan(opts = {}) {
  if (running) return;
  running = true;
  try {
    const { targets, book } = await getState();
    const canProbe = (t) => { try { return !!CART_URLS[new URL(t.url).hostname]; } catch (e) { return false; } };
    const list = targets.filter((t) => (!opts.onlyId || t.id === opts.onlyId) && (!opts.cartOnly || canProbe(t)));
    const events = [];
    const blocked = [];
    const warnings = [];
    for (const t of list) {
      await chrome.storage.local.set({ scanState: { running: true, current: t.name, startedAt: Date.now() } });
      const { snapshot, diag } = await scanTarget(t, book, opts);
      const { snapshots } = await getState();
      snapshots.push(snapshot);
      events.push(...KitapTakipLib.newEvents(snapshots, snapshot));
      if (snapshot.status === 'blocked') blocked.push(t.id);
      if (snapshot.cartWarning) warnings.push(`${t.name}: ${snapshot.cartWarning}`);
      // Tanı kaydı: her site için yalnızca son taramanınki saklanır.
      const store = (await chrome.storage.local.get('diag')).diag || {};
      store[t.id] = { ts: snapshot.ts, status: snapshot.status, ...(diag || { url: snapshot.url, note: snapshot.note }) };
      await chrome.storage.local.set({ snapshots, diag: store });
    }
    await notify(targets, book, events, blocked, warnings).catch(() => {}); // bildirim hatası taramayı bozmasın
  } finally {
    running = false;
    await chrome.storage.local.set({ scanState: { running: false, finishedAt: Date.now() } });
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.storage.local.set({ scanState: { running: false } });
  await schedule();
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.set({ scanState: { running: false } });
  if (!(await chrome.alarms.get(ALARM))) await schedule();
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) scan(); });
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'scan') { scan({ onlyId: msg.targetId, cartOnly: !!msg.cartOnly, forceCart: !!msg.forceCart }); reply({ ok: true }); }
  if (msg.type === 'reschedule') { schedule().then(() => reply({ ok: true })); return true; }
});
