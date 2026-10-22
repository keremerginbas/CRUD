'use strict';
// End-to-end check of the built React panel (ilan5_extension/panel) with a fake chrome API.
// No listing site or Telegram request is made. Run after `npm run build`: npm run test:e2e
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../../ilan5_extension');
const out = process.env.QA_OUTPUT || path.join(__dirname, 'artifacts');

function mockChrome() {
  const store = {'ilan5.backup.v1': {auto: false}, 'ilan5.lists': [{id: 'list-old', name: 'Ankara Ekim', createdAt: '2026-10-01T00:00:00Z'}],
    'ilan5.job.v2': {id: 'j', status: 'running', source: 'arabam', updatedAt: new Date().toISOString(), message: 'Sayfa 2: ilan 14/50 açılıyor.', counts: {discovered: 100, processed: 63, saved: 40, unchanged: 18}, listingQueue: Array(100).fill(0), detailIndex: 63,
      pageProgress: {currentPage: 2, totalPages: 5, pageFound: 50, pageProcessed: 13, totalProcessed: 63, totalExpected: 250, stage: 'details'}, logs: [{at: new Date().toISOString(), message: 'İlan 44985286: kaydedildi.'}]}};
  const listeners = [];
  let safety = {separateWindow: true, dailyLimit: 400, phoneDailyLimit: 150, skipKnown: true, reuseKnownPhone: true};
  let alerts = {priceDrop: true, minDropPercent: 5, newListing: true, health: true, summary: true, summaryTime: '08:30'};
  const searches = [{id: 's1', name: 'Ankara arsa', searchUrl: 'https://www.emlakjet.com/satilik-arsa/ankara', category: 'arsa', enabled: true, intervalMinutes: 60, lastStatus: 'completed', lastRunAt: new Date().toISOString(), listId: 'list-old', hasBaseline: true}];
  window.sent = [];
  window.store = store;
  window.chrome = {
    runtime: {id: 'test', getURL: s => s, getManifest: () => ({version: '3.1.0'}), onMessage: {addListener() {}},
      async sendMessage(m) {
        window.sent.push(m);
        if (m.type === 'ILAN_SAFETY_CONFIG') safety = {...safety, ...m.safety};
        if (m.type === 'ILAN_ALERTS_CONFIG') alerts = {...alerts, ...m.alerts};
        if (/^ILAN_(SAFETY|ALERTS)_/.test(m.type)) return {ok: true, safety, alerts, todayCount: 57, todaySites: {arabam: {pages: 42, phones: 131}, emlakjet: {pages: 15, phones: 9}}};
        if (m.type.startsWith('ILAN_SEARCH_')) return {ok: true, searches, search: {id: 's1'}, job: null};
        if (m.type === 'ILAN_MESSAGE_STATUS') return {ok: true, templates: [{id: 'default-arsa', name: 'Arsa', body: 'Merhaba {ad_soyad}'}], queue: [{id: 'q1', status: 'queued', title: 'Arsa', listingId: '1', sellerName: 'Ali', message: 'Merhaba Ali'}]};
        if (m.type === 'ILAN_MONITOR_STATUS') return {ok: true, monitor: {enabled: true, status: 'idle', intervalMinutes: 360, confirmationMinutes: 15}};
        if (m.type === 'ILAN_TELEGRAM_STATUS') return {ok: true, telegram: {configured: true, verified: true, chatId: '-100', chatTitle: 'DÜŞEN İLAN', counts: {sent: 12}}};
        return {ok: true, job: null};
      }},
    storage: {local: {async get(k) { return Array.isArray(k) ? Object.fromEntries(k.map(x => [x, store[x]])) : {[k]: store[k]}; }, async set(o) { Object.assign(store, o); }},
      onChanged: {addListener(l) { listeners.push(l); }}},
  };
}

async function seed(page) {
  await page.evaluate(async () => {
    const C = window.IlanCore, day = 86400000, now = Date.now();
    const sites = [
      ['sahibinden', n => `https://www.sahibinden.com/ilan/emlak-arsa-satilik-ornek-${n}/detay`],
      ['hepsiemlak', n => `https://www.hepsiemlak.com/ankara-golbasi-satilik/tarla/0-${n}`],
      ['emlakjet', n => `https://www.emlakjet.com/ilan/arsa-${n}`],
      ['arabam', n => `https://www.arabam.com/ilan/sahibinden-satilik-x/x/${n}`]];
    const districts = [['Ankara', 'Gölbaşı'], ['Ankara', 'Mamak'], ['İstanbul', 'Silivri'], ['İzmir', 'Urla']];
    const crm = ['', '', '', 'meeting', 'interested', 'called', ''];
    const rows = [];
    for (let i = 0; i < 60; i++) {
      const [source, url] = sites[i % 4], [city, district] = districts[i % 4], n = 5000000 + i, car = source === 'arabam';
      const area = car ? null : 500 + (i % 7) * 100, cheap = i % 9 === 0 && !car;
      rows.push(C.normalizeRecord({url: url(n), title: car ? `Fiat Egea ${2015 + (i % 8)} model temiz araç` : `${district} imarlı köşe parsel ${i}`, price: car ? 600000 + i * 9000 : Math.round(area * (cheap ? 2200 : 4000 + (i % 5) * 150)),
        area, location: {city, district, neighborhood: 'Merkez Mah.'}, sellerName: ['Ali Yılmaz', 'Ayşe Demir', 'Mehmet Kaya', 'Zeynep Ak'][i % 4], phones: i % 6 === 0 ? [] : [`0532 ${String(100 + (i % 20)).padStart(3, '0')} 11 ${String(10 + (i % 50)).padStart(2, '0')}`],
        rawDetails: car ? {'Marka': 'Fiat', 'Yıl': String(2015 + (i % 8)), 'Kilometre': '120.000 KM', 'Yakıt tipi': 'Dizel'} : {'Arsa Tipi': 'İmarlı Konut', 'Tapu Durumu': 'Müstakil Parsel', 'Ada/Parsel No': `${100 + i}/5`},
        description: 'Örnek açıklama.', firstSeenAt: new Date(now - (i % 12) * day).toISOString(), capturedAt: new Date(now - (i % 12) * day).toISOString(),
        crm: {status: crm[i % 7], note: crm[i % 7] === 'meeting' ? 'Cuma 14:00 yerinde görüşme' : ''}, lists: i < 10 ? ['list-old'] : [],
        history: i === 1 ? [{at: new Date(now - 9 * day).toISOString(), price: 3600000, currency: 'TRY'}, {at: new Date(now - 4 * day).toISOString(), price: 3300000, currency: 'TRY'}] : []}));
    }
    await window.IlanDB.upsertMany(rows);
    await window.IlanDB.importEvents([1, 5, 9].map((i, k) => ({id: 'e' + i, type: 'price_down', recordId: rows[i].id, listingId: rows[i].listingId, title: rows[i].title, url: rows[i].url, category: rows[i].category, source: rows[i].source, searchIds: ['s1'], at: new Date(now - k * day).toISOString(), oldPrice: rows[i].price + 300000, newPrice: rows[i].price, currency: 'TRY'})));
  });
}

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'panel.test') return route.abort();
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png'};
    return route.fulfill({contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file)});
  });
  await context.addInitScript(mockChrome);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('https://panel.test/panel/index.html');
  await page.waitForSelector('[data-kpi]');
  await seed(page);
  await page.reload();
  await page.waitForSelector('[data-testid="deal-flow"]');
  await page.waitForTimeout(1200);

  // Dashboard (command center)
  assert.equal(await page.locator('[data-kpi]').count(), 4);
  assert.match(await page.locator('[data-kpi="Büyüme fırsatları"]').innerText(), /İlan5 içgörüsü/);
  assert.ok(await page.locator('[data-testid="pulse-chart"] .recharts-bar-rectangle').count() >= 7, 'growth pulse bars');
  assert.ok(await page.locator('[data-testid="deal-flow"] button').count() >= 3, 'deal flow rows');
  assert.ok(await page.locator('[data-testid="priorities"] li').count() >= 2, 'priority actions');
  assert.match(await page.locator('[data-testid="priorities"]').innerText(), /Görüşülecek|Fiyat %/);
  assert.match(await page.locator('[role="img"][aria-label^="Veri skoru"]').getAttribute('aria-label'), /Veri skoru \d+ \/ 100/);
  assert.match(await page.locator('[data-testid="bell"]').getAttribute('aria-label'), /Öncelikli işler: \d+/);
  assert.equal(await page.locator('[data-testid="version"]').innerText(), 'Sürüm 3.1.0');
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'dark by default');
  await page.screenshot({path: path.join(out, 'dashboard-dark.png'), fullPage: true});

  // KPI → listings filtered to opportunities
  await page.locator('[data-kpi="Büyüme fırsatları"]').click();
  await page.waitForSelector('[data-testid="records-table"]');
  const oppRows = await page.locator('[data-record]').count();
  assert.ok(oppRows > 0);
  assert.equal(await page.locator('[data-record]').filter({hasText: 'Fırsat −%'}).count(), oppRows, 'every row is an opportunity');
  await page.getByRole('button', {name: 'Filtreleri temizle'}).click();

  // Listings: sorting, selection, bulk add to list, CSV export
  await page.locator('[data-category="all"]').click();
  await page.getByRole('button', {name: 'Fiyat sütununa göre sırala'}).click();
  const prices = await page.locator('[data-record] td:nth-child(3) span.font-semibold').allInnerTexts();
  const nums = prices.map(t => Number(t.replace(/[^\d]/g, ''))).filter(Boolean);
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b), 'ascending by price');
  await page.locator('[data-record]').nth(0).getByRole('checkbox').click();
  await page.locator('[data-record]').nth(1).getByRole('checkbox').click();
  await page.waitForSelector('[data-testid="bulk-bar"]');
  assert.match(await page.locator('[data-testid="bulk-bar"]').innerText(), /2 ilan seçildi/);
  await page.getByRole('button', {name: 'Listeye ekle'}).click();
  await page.locator('[data-testid="bulk-new-list"]').click();
  await page.waitForTimeout(500);
  const lists = await page.evaluate(() => window.store['ilan5.lists']);
  assert.equal(lists.length, 2);
  await page.screenshot({path: path.join(out, 'listings-dark.png')});
  const download = page.waitForEvent('download');
  await page.locator('[data-testid="export-menu"]').click();
  await page.locator('[data-testid="export-csv"]').click();
  const csv = fs.readFileSync(await (await download).path(), 'utf8');
  assert.match(csv, /"Listeler";"m² Fiyatı";"Takip Durumu";"Not"/);

  // Detail sheet: price history and CRM
  await page.locator('[data-testid="filter-query"]').fill('köşe parsel 1');
  await page.waitForTimeout(300);
  if (process.env.DEBUG_E2E) console.log(await page.locator('[data-testid="records-table"]').innerText().catch(() => 'NO TABLE'), await page.locator('[data-testid="filter-summary"]').innerText().catch(() => ''));
  await page.getByRole('button', {name: 'Mamak imarlı köşe parsel 1', exact: true}).click();
  await page.waitForSelector('[data-testid="detail-sheet"]');
  await page.waitForSelector('[data-testid="price-history"] .recharts-line');
  await page.locator('[data-testid="crm-status"]').selectOption('meeting');
  await page.locator('[data-testid="crm-note"]').fill('Pazartesi arayacağım');
  await page.locator('[data-testid="crm-save"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({path: path.join(out, 'detail-dark.png')});
  await page.keyboard.press('Escape');

  // Collect: arabam link switches category; start asks for the list
  await page.getByRole('button', {name: 'Veri çek'}).first().click();
  await page.waitForSelector('[data-testid="job-panel"]');
  await page.locator('[data-testid="search-url"]').fill('https://www.arabam.com/ikinci-el/otomobil-sahibinden');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-testid="collect-category"]').inputValue(), 'arac');
  assert.match(await page.locator('[data-testid="collect-ready"]').innerText(), /arabam\.com · Tarama hazır/);
  await page.screenshot({path: path.join(out, 'collect-dark.png'), fullPage: true});

  // Saved searches: "Şimdi tara" asks where to save
  await page.getByRole('button', {name: 'Kayıtlı aramalar'}).click();
  await page.locator('[data-testid="search-run"]').click();
  await page.waitForSelector('[data-testid="list-choice"]');
  await page.locator('[data-testid="list-choice-ok"]').click();
  await page.waitForTimeout(300);
  assert.equal((await page.evaluate(() => window.sent.find(m => m.type === 'ILAN_SEARCH_RUN'))).listId, 'list-old');

  // Settings: phone limit is saved through the worker
  await page.getByRole('button', {name: 'Ayarlar ve yedek'}).click();
  await page.locator('[data-testid="safety-phone"]').fill('90');
  await page.locator('[data-testid="safety-phone"]').press('Enter');
  await page.waitForTimeout(200);
  assert.equal((await page.evaluate(() => window.sent.filter(m => m.type === 'ILAN_SAFETY_CONFIG').at(-1))).safety.phoneDailyLimit, 90);

  // Other views render
  for (const name of ['İlan hareketleri', 'Mesaj kampanyası', 'Takip ve Telegram']) {
    await page.getByRole('button', {name}).click();
    await page.waitForTimeout(250);
  }
  assert.ok(await page.locator('text=Telegram grup bildirimleri').count());

  // Light theme and responsive layout
  await page.getByRole('button', {name: 'Genel bakış'}).click();
  await page.getByRole('button', {name: 'Açık temaya geç'}).click();
  await page.waitForTimeout(400);
  await page.screenshot({path: path.join(out, 'dashboard-light.png'), fullPage: true});
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({width, height: 900});
    await page.waitForTimeout(250);
    const size = await page.evaluate(() => ({w: innerWidth, s: document.documentElement.scrollWidth}));
    assert.ok(size.s <= size.w + 1, `no horizontal overflow at ${width}px: ${JSON.stringify(size)}`);
  }
  await page.screenshot({path: path.join(out, 'dashboard-mobile.png')});
  assert.deepEqual(errors, []);
  console.log('Panel e2e OK');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
