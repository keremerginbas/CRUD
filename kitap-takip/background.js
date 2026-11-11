// Arka plan: zamanlanmış tarama. Her sayfayı kullanıcının kendi tarayıcısında
// arka plan sekmesinde açar, veriyi okur, kaydeder ve sekmeyi kapatır.
importScripts('targets.js');

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

async function readTab(tabId, isbn) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['extractor.js'] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: (i) => globalThis.__kitapTakipExtract(i), args: [isbn] });
  return res && res.result;
}

async function scanTarget(target, isbn) {
  let tab;
  let data;
  try {
    tab = await chrome.tabs.create({ url: target.url, active: false });
    await waitLoaded(tab.id, 40000);
    await settle(tab.id, 4000);
    data = await readTab(tab.id, isbn);
    if (data && data.status === 'blocked') {
      // Çoğu doğrulama gerçek tarayıcıda birkaç saniyede kendiliğinden geçer.
      await settle(tab.id, 12000);
      await waitLoaded(tab.id, 20000);
      data = await readTab(tab.id, isbn);
    }
  } catch (e) {
    data = { status: 'error', note: String(e && e.message ? e.message : e).slice(0, 200) };
  }
  if (!data) data = { status: 'error', note: 'Sayfa okunamadı.' };
  // Doğrulama isteyen sekme açık kalır ki kullanıcı tamamlayabilsin.
  if (tab && data.status !== 'blocked') await chrome.tabs.remove(tab.id).catch(() => {});
  return { ...data, ts: Date.now(), targetId: target.id, url: target.url };
}

let running = false;
async function scan(onlyId) {
  if (running) return;
  running = true;
  try {
    const { targets, book } = await getState();
    const list = onlyId ? targets.filter((t) => t.id === onlyId) : targets;
    for (const t of list) {
      await chrome.storage.local.set({ scanState: { running: true, current: t.name, startedAt: Date.now() } });
      const snap = await scanTarget(t, t.isbn || book.isbn);
      const { snapshots } = await getState();
      snapshots.push(snap);
      await chrome.storage.local.set({ snapshots });
    }
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
