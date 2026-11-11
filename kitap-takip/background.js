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
    settings: { intervalHours: 12, ...(s.settings || {}) },
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

async function scanTarget(target, book) {
  let tab;
  let data;
  let url = target.url;
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
  } catch (e) {
    data = { status: 'error', note: String(e && e.message ? e.message : e).slice(0, 200) };
  }
  if (!data) data = { status: 'error', note: 'Sayfa okunamadı.' };
  // Doğrulama isteyen sekme açık kalır ki kullanıcı tamamlayabilsin.
  if (tab && data.status !== 'blocked') await chrome.tabs.remove(tab.id).catch(() => {});
  const { diag, hasIsbn, ...fields } = data;
  return { snapshot: { ...fields, ts: Date.now(), targetId: target.id, url }, diag };
}

// Taramanın getirdiği değişiklikleri, Telegram bağlıysa tek mesaj olarak gönderir.
async function notify(targets, book, events, blocked) {
  const { telegram } = await chrome.storage.local.get('telegram');
  if (!telegram || !telegram.token || !telegram.chatId) return;
  const picked = KitapTakipTelegram.pickBlockedNotices(blocked, telegram.notified || {}, KitapTakipLib.dayKey(Date.now()));
  const text = KitapTakipTelegram.buildScanMessage({ book, targets, events, blocked: picked.ids });
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
async function scan(onlyId) {
  if (running) return;
  running = true;
  try {
    const { targets, book } = await getState();
    const list = onlyId ? targets.filter((t) => t.id === onlyId) : targets;
    const events = [];
    const blocked = [];
    for (const t of list) {
      await chrome.storage.local.set({ scanState: { running: true, current: t.name, startedAt: Date.now() } });
      const { snapshot, diag } = await scanTarget(t, book);
      const { snapshots } = await getState();
      snapshots.push(snapshot);
      events.push(...KitapTakipLib.newEvents(snapshots, snapshot));
      if (snapshot.status === 'blocked') blocked.push(t.id);
      // Tanı kaydı: her site için yalnızca son taramanınki saklanır.
      const store = (await chrome.storage.local.get('diag')).diag || {};
      store[t.id] = { ts: snapshot.ts, status: snapshot.status, ...(diag || { url: snapshot.url, note: snapshot.note }) };
      await chrome.storage.local.set({ snapshots, diag: store });
    }
    await notify(targets, book, events, blocked).catch(() => {}); // bildirim hatası taramayı bozmasın
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
  if (msg.type === 'scan') { scan(msg.targetId); reply({ ok: true }); }
  if (msg.type === 'reschedule') { schedule().then(() => reply({ ok: true })); return true; }
});
