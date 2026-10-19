'use strict';

// Opt-in real Chrome extension test. No requests reach a listing site or Telegram.
// ILAN_BROWSER_TEST=1 CHROME_PATH=/path/to/chrome node --test tests/browser-navigation.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const enabled = process.env.ILAN_BROWSER_TEST === '1';
const listing = n => `https://www.sahibinden.com/ilan/emlak-arsa-satilik-test-${1800000000 + n}/detay`;
const search = scenario => `https://www.sahibinden.com/satilik-arsa/ankara?fixture=${scenario}&price_min=5000000&owner=1`;
const shell = body => `<!doctype html><html lang="tr"><head><meta charset="UTF-8"><title>Yerel test</title><style>body{font-family:Arial;margin:24px}td{padding:8px}button,select{padding:6px}</style></head><body>${body}</body></html>`;

function results({page = 1, size = 2, total = 6, repeated = false, hydrated = false, select = true}) {
  const offset = repeated ? 0 : (page - 1) * size;
  const count = Math.min(size, total - offset);
  const rows = Array.from({length: count}, (_, i) => `<tr class="searchResultsItem"><td><a href="${listing(offset + i + 1)}">Test arsa ${offset + i + 1}</a></td></tr>`).join('');
  const last = Math.ceil(total / size);
  const body = `<div class="result-text"><strong>${total} ilan bulundu</strong></div>
    ${select ? `<select name="pagingSize"><option selected value="${size}">${size}</option></select>` : ''}
    <table id="searchResultsTable"><tbody>${hydrated ? '' : rows}</tbody></table>
    <div class="pageNaviButtons">${Array.from({length: last}, (_, i) => `<button ${i + 1 === page ? 'aria-current="page"' : ''}>${i + 1}</button>`).join('')}
      <button ${page === last ? 'disabled' : ''} aria-label="Sonraki sayfa">Sonraki</button></div>`;
  return shell(body + (hydrated ? `<script>setTimeout(()=>document.querySelector('tbody').innerHTML=${JSON.stringify(rows)},900)</script>` : ''));
}

function detail(n) {
  return shell(`<div class="classifiedDetailTitle"><h1>Test arsa ${n}</h1></div>
    <div class="classifiedInfo"><h3>5.500.000 TL</h3><h2><a>Ankara</a><a>Golbasi</a><a>Test Mah.</a></h2>
    <ul class="classifiedInfoList"><li><strong>İlan No</strong><span>${1800000000 + n}</span></li>
      <li><strong>Emlak Tipi</strong><span>Satılık Arsa</span></li><li><strong>m²</strong><span>500</span></li></ul></div>
    <div class="classifiedUserBox"><h3>Test Satıcı</h3></div>
    <div id="classifiedDescription">Bu yalnızca yerel otomasyon testi için üretilmiş örnek açıklamadır.</div>`);
}

async function waitForJob(worker, predicate, timeout = 100000) {
  const stop = Date.now() + timeout;
  let job;
  while (Date.now() < stop) {
    job = await worker.evaluate(async () => (await chrome.storage.local.get('ilan5.job.v2'))['ilan5.job.v2']);
    if (predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Job timeout: ' + JSON.stringify({status: job?.status, current: job?.current, message: job?.message, counts: job?.counts}));
}

test('real extension: rendered paging, hydration, detail persistence, and repeated-page guard', {skip: !enabled, timeout: 210000}, async () => {
  const {chromium} = require('playwright');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ilan5-browser-test-'));
  const extension = path.join(temporary, 'extension');
  await fs.cp(path.resolve(__dirname, '..'), extension, {recursive: true, filter: source => !['tests', 'config.private.js'].includes(path.basename(source))});
  await fs.writeFile(path.join(extension, 'config.private.js'), 'globalThis.IlanPrivateConfig = {telegram: {token: "", chatId: "-1000000000"}};\n');
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
      headless: true, executablePath: process.env.CHROME_PATH || undefined,
      args: ['--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking'],
      viewport: {width: 1280, height: 900}
    });
    const navigations = [];
    const unexpected = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname !== 'www.sahibinden.com') {
        unexpected.push(url.hostname);
        return route.abort();
      }
      if (!request.isNavigationRequest()) return route.fulfill({status: 204, body: ''});
      navigations.push(url.href);
      let html;
      if (url.pathname.includes('/ilan/')) {
        const n = Number(url.pathname.match(/-(\d+)\/detay/)[1]) - 1800000000;
        html = detail(n);
      } else {
        const scenario = url.searchParams.get('fixture');
        const size = scenario === 'fifty' ? 50 : 2;
        const page = Math.floor(Number(url.searchParams.get('pagingOffset') || 0) / size) + 1;
        html = results({page, size, total: scenario === 'fifty' ? 103 : 6, select: scenario !== 'fifty', hydrated: scenario === 'automatic' && page === 2, repeated: scenario === 'repeat' && page > 1});
      }
      await route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: html});
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/popup.html`);
    const start = async scenario => {
      const response = await panel.evaluate(message => chrome.runtime.sendMessage(message), {
        type: 'ILAN_START', searchUrl: search(scenario), category: 'arsa', delayMs: 3000, maxPages: 0, maxListings: 0, revealPhone: false
      });
      assert.equal(response.ok, true, JSON.stringify(response));
      return waitForJob(worker, job => job && job.status !== 'running');
    };

    // Uses the packaged service worker, Chrome alarms/tabs, isolated content script,
    // real DOM extractor, Core normalization and IndexedDB, without mocked nextUrl.
    const completed = await start('automatic');
    assert.equal(completed.status, 'completed', JSON.stringify(completed.logs));
    assert.equal(completed.pages, 3);
    assert.equal(completed.counts.processed, 6);
    assert.equal(completed.counts.saved, 6);
    assert.equal(completed.pageProgress.currentPage, 3);
    assert.equal(completed.pageProgress.totalPages, 3);
    assert.deepEqual(navigations, [search('automatic'), listing(1), listing(2),
      completed.visitedPages.find(url => url.includes('pagingOffset=2')), listing(3), listing(4),
      completed.visitedPages.find(url => url.includes('pagingOffset=4')), listing(5), listing(6)].map(url => {
        const parsed = new URL(url); parsed.searchParams.sort(); return parsed.href;
      }).map((url, i) => i % 3 === 0 ? new URL(url).href : url).map((url, i) => i % 3 === 0 ? url : url), 'Strict list -> that page details -> next list order');
    const records = await worker.evaluate(() => IlanDB.getAll());
    assert.equal(records.length, 6);
    assert.ok(records.every(row => row.category === 'arsa' && row.price === 5500000 && row.title.startsWith('Test arsa')));
    console.log('REAL CHROME PASS: 3 list pages + 6 detail pages, delayed page2 rows, real IndexedDB');

    const beforeRepeat = navigations.length;
    const repeated = await start('repeat');
    assert.equal(repeated.status, 'incomplete');
    assert.equal(repeated.pages, 2);
    assert.equal(repeated.counts.processed, 2);
    assert.equal(navigations.length - beforeRepeat, 4);
    assert.ok(repeated.logs.some(row => /tekrar/.test(row.message)));
    console.log('REAL CHROME PASS: repeated page2 content stops incomplete with no duplicate detail visits');

    // The 50-row layout has no URL page size and no selector. The page size must
    // be inferred from actual visible result rows, not silently assumed to be20.
    const fifty = await context.newPage();
    await fifty.goto(search('fifty'));
    const result = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(item => item.url === url);
      return chrome.tabs.sendMessage(tab.id, {type: 'ILAN_EXTRACT', mode: 'list', expectedUrl: url});
    }, search('fifty'));
    assert.equal(result.ok, true);
    assert.equal(result.links.length, 50);
    assert.equal(result.pagination.expectedTotal, 103);
    assert.equal(result.pagination.pageSize, 50);
    assert.equal(result.pagination.lastPage, 3);
    assert.equal(new URL(result.nextUrl).searchParams.get('pagingOffset'), '50');
    assert.equal(new URL(result.nextUrl).searchParams.get('price_min'), '5000000');
    console.log('REAL CHROME PASS: 50 visible rows, summary outside table, href-less pager produces offset50');
    assert.deepEqual(unexpected, [], 'No listing-site data or Telegram request should escape the fixture');
  } finally {
    await context?.close();
    await fs.rm(temporary, {recursive: true, force: true});
  }
});
