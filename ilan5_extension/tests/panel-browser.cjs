'use strict';
// Local UI fixture only. No listing site or Telegram requests are made.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.env.QA_OUTPUT || path.join(root, 'test-artifacts');

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {}), args: ['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'panel.test') return route.abort();
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png'};
      return route.fulfill({contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file)});
    });
    await context.addInitScript(() => {
      const storageListeners = [];
      const job = {id: 'fixture-job', status: 'running', phase: 'details', message: 'Sayfa 2: ilan detayları işleniyor.',
        counts: {discovered: 100, processed: 63, saved: 61, review: 2, errors: 0, skipped: 0},
        listingQueue: Array.from({length: 100}, (_, i) => ({id: String(i)})), detailIndex: 63,
        pageProgress: {currentPage: 2, totalPages: 5, pageFound: 50, pageProcessed: 13, totalProcessed: 63, totalExpected: 250, stage: 'details'},
        paginationStrategy: 'numbered-link', logs: [], currentUrl: 'https://www.sahibinden.com/ilan/fixture-1000000063/detay'};
      window.testJob = job;
      window.testMessages = [];
      window.publishTestJob = patch => {
        Object.assign(job, patch);
        storageListeners.forEach(listener => listener({'ilan5.job.v2': {newValue: structuredClone(job)}}, 'local'));
      };
      window.chrome = {runtime: {id: 'fixture', getURL: suffix => 'https://panel.test/' + suffix,
        onMessage: {addListener() {}}, async sendMessage(message) {
          window.testMessages.push(message);
          if (message.type === 'ILAN_SEARCH_STATUS') return {ok: true, searches: []};
          if (message.type === 'ILAN_MESSAGE_STATUS') return {ok: true, templates: [], queue: []};
          if (message.type === 'ILAN_MONITOR_STATUS') return {ok: true, monitor: {config: {enabled: false}, status: 'idle'}};
          if (message.type === 'ILAN_TELEGRAM_STATUS') return {ok: true, telegram: {configured: false, counts: {}}};
          const statuses = {ILAN_PAUSE: 'paused', ILAN_RESUME: 'running', ILAN_STOP: 'stopped'};
          if (statuses[message.type]) window.publishTestJob({status: statuses[message.type]});
          return {ok: true, job: structuredClone(job)};
        }}, storage: {local: {async get() {return {'ilan5.job.v2': structuredClone(job)};}, async set() {}},
        onChanged: {addListener(listener) {storageListeners.push(listener);}}}};
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://panel.test/archive.html', {waitUntil: 'load'});
    await page.locator('#pageProgressTitle').waitFor({state: 'visible'});
    assert.match(await page.locator('#pageProgressTitle').innerText(), /2.*5/);
    await page.locator('#searchUrl').fill('https://www.sahibinden.com/satilik-arsa/ankara');
    await page.waitForTimeout(100);
    assert.match(await page.locator('#collectionReady').innerText(), /hazır/i);
    assert.equal(await page.locator('#startBtn').isDisabled(), true, 'active run cannot be replaced');
    await page.screenshot({path: path.join(output, 'panel-desktop.png')});
    await page.locator('#jobPanel').scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(output, 'panel-progress.png')});
    await page.locator('#pauseBtn').click();
    assert.equal(await page.locator('#resumeBtn').isEnabled(), true);
    await page.locator('#resumeBtn').click();
    assert.equal(await page.locator('#pauseBtn').isEnabled(), true);
    await page.locator('#stopBtn').click();
    await page.locator('#searchUrl').fill('https://notsahibinden.com/satilik-arsa');
    assert.equal(await page.locator('#startBtn').isDisabled(), true, 'lookalike host blocked');
    await page.locator('#searchUrl').fill('https://www.sahibinden.com/satilik-arsa/ankara');
    assert.equal(await page.locator('#startBtn').isEnabled(), true);
    await page.locator('#modeLinksBtn').click();
    await page.locator('#directUrls').fill('https://www.sahibinden.com/ilan/emlak-arsa-ornek-1000000001/detay');
    assert.equal(await page.locator('#startBtn').isEnabled(), true);
    await page.locator('#modeSearchBtn').click();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({width, height: 900});
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(150);
      const size = await page.evaluate(() => ({width: innerWidth, scrollWidth: document.documentElement.scrollWidth}));
      assert.ok(size.scrollWidth <= size.width + 1, `no page overflow at ${width}: ${JSON.stringify(size)}`);
      if (width === 390) await page.screenshot({path: path.join(output, 'panel-mobile.png')});
    }
    assert.deepEqual(errors, [], 'no uncaught UI errors');
    console.log('PASS panel browser: URL validation, pause/resume/stop, page progress, desktop/tablet/mobile overflow, screenshots');
    await context.close();
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
