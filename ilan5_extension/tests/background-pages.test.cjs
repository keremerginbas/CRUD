'use strict';
const assert = require('node:assert/strict');
const B = require('../background.js');
const SEARCH = 'https://www.sahibinden.com/satilik-arsa/ankara?pagingSize=50&price_min=5000000&owner=1';
const listing = number => `https://www.sahibinden.com/ilan/emlak-arsa-satilik-ornek-${1000000000 + number}/detay`;
const ref = number => B.listingRef(listing(number));
const copy = x => structuredClone(x);
function fixture(initial = null, options = {}) {
  let now = 20000000, nextTab = 1, navigationFailures = 0;
  const storage = {[B.JOB_KEY]: copy(initial)}, tabs = new Map(), navigations = [], calls = [], saved = new Map();
  const alarms = new Map();
  let response = async request => ({ok: true, kind: 'detail', record: {url: request.expectedUrl}});
  const api = {
    storage: {local: {get: async key => ({[key]: copy(storage[key])}), set: async data => Object.assign(storage, copy(data))}},
    runtime: {sendMessage: async () => {}}, alarms: {create: async (name, value) => alarms.set(name, value), clear: async name => alarms.delete(name)}, scripting: {executeScript: async () => {}},
    tabs: {
      create: async args => { const tab = {id: nextTab++, ...args, status: 'complete'}; tabs.set(tab.id, tab); return copy(tab); },
      get: async id => { if (!tabs.has(id)) throw Error('missing'); return copy(tabs.get(id)); },
      update: async (id, args) => { if (navigationFailures > 0) { navigationFailures--; throw Error('temporary navigation failure'); } Object.assign(tabs.get(id), args, {status: 'loading'}); navigations.push(args.url); return copy(tabs.get(id)); },
      sendMessage: async (id, request) => response(request), query: async () => []
    }
  };
  const db = {upsertMany: async (rows, context) => { calls.push({rows: copy(rows), context: copy(context)}); rows.forEach(row => saved.set(row.id, copy(row))); return {saved: rows.length, newListings: context?.baseline ? 0 : rows.length, priceIncreases: 0, priceDecreases: 0}; }};
  const core = {normalizeRecord: raw => ({...raw, id: B.listingRef(raw.url).id, classification: {category: 'arsa', status: 'verified'}})};
  let engine = B.createEngine(api, core, db, {...options, now: () => now});
  return {
    storage, tabs, navigations, calls, saved, alarms, get engine() { return engine; }, state: () => copy(storage[B.JOB_KEY]),
    failNavigations: count => { navigationFailures = count; }, advance: ms => { now += ms; },
    respond: fn => { response = fn; },
    async start(extra = {}) { return engine.handle({type: 'ILAN_START', searchUrl: SEARCH, category: 'arsa', delayMs: 4000, searchId: 'search-ankara', baseline: false, ...extra}); },
    async load() { const current = storage[B.JOB_KEY]; const tab = tabs.get(current.workTabId); tab.status = 'complete'; await engine.onUpdated(tab.id, {status: 'complete'}, copy(tab)); },
    async step() { now += 5000; await engine.onAlarm({name: B.STEP_ALARM}); },
    async finish(max = 2000) { for (let i = 0; i < max && storage[B.JOB_KEY]?.status === 'running'; i++) { if (storage[B.JOB_KEY].current && (storage[B.JOB_KEY].nextDueAt || 0) <= now) await this.load(); else await this.step(); } assert.notEqual(storage[B.JOB_KEY]?.status, 'running', 'bounded test completed'); },
    async restart() { engine = B.createEngine(api, core, db, {...options, now: () => now}); await engine.recover(); }
  };
}
function paginated(pageCount, pageSize, options = {}) {
  return async request => {
    if (request.mode === 'detail') return {ok: true, kind: 'detail', record: {url: request.expectedUrl, title: 'Arsa'}};
    const offset = Number(new URL(request.expectedUrl).searchParams.get('pagingOffset') || 0), page = offset / pageSize + 1;
    const links = Array.from({length: pageSize}, (_, i) => listing(offset + i + 1));
    return {ok: true, kind: 'list', links, nextUrl: page < pageCount ? `?pagingOffset=${offset + pageSize}` : null,
      pagination: {currentPage: page, lastPage: pageCount, pageSize, expectedTotal: options.total ?? pageCount * pageSize, complete: page === pageCount}};
  };
}
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
(async () => {
  await test('five pages of fifty details finish in strict list/detail page order', async () => {
    const f = fixture(); f.respond(paginated(5, 50)); await f.start(); await f.finish();
    assert.equal(f.state().status, 'completed'); assert.equal(f.saved.size, 250); assert.equal(f.navigations.length, 255);
    for (let page = 0; page < 5; page++) {
      const pageUrl = new URL(f.navigations[page * 51]);
      assert.equal(pageUrl.pathname, '/satilik-arsa/ankara');
      assert.equal(pageUrl.searchParams.get('pagingSize'), '50'); assert.equal(pageUrl.searchParams.get('price_min'), '5000000');
      assert.deepEqual(f.navigations.slice(page * 51 + 1, (page + 1) * 51), Array.from({length: 50}, (_, i) => listing(page * 50 + i + 1)));
    }
    assert.deepEqual(f.state().pageProgress, {currentPage: 5, totalPages: 5, pageFound: 50, pageProcessed: 50, totalProcessed: 250, totalExpected: 250, stage: 'done'});
    assert.equal(f.state().counts.newListings, 250);
    assert.equal(f.calls[0].context.origin, 'crawl'); assert.equal(f.calls[0].context.searchId, 'search-ankara');
    assert.equal(f.calls[0].context.runId, f.state().id); assert.equal(f.calls[0].context.baseline, false); assert.ok(f.calls[0].context.observedAt);
  });
  await test('resume in the middle of a page preserves detail cursor before next list', async () => {
    const f = fixture(); f.respond(paginated(2, 3)); await f.start(); await f.load();
    await f.step(); await f.load(); // first detail saved
    await f.engine.handle({type: 'ILAN_PAUSE'}); await f.restart();
    assert.equal(f.state().pageProgress.pageProcessed, 1); assert.equal(f.navigations.length, 2);
    await f.engine.handle({type: 'ILAN_RESUME'}); await f.finish();
    assert.equal(f.state().counts.processed, 6);
    assert.deepEqual(f.navigations.slice(0, 4), [SEARCH, listing(1), listing(2), listing(3)]);
    assert.equal(f.calls.filter(call => call.rows[0].url === listing(1)).length, 1);
  });
  await test('duplicate page content stops incomplete without repeated detail saves', async () => {
    const f = fixture();
    f.respond(async request => request.mode === 'detail' ? {ok: true, kind: 'detail', record: {url: request.expectedUrl}} :
      {ok: true, kind: 'list', links: [listing(1), listing(2)], nextUrl: request.expectedUrl.includes('pagingOffset=') ? '?pagingOffset=100' : '?pagingOffset=50', pagination: {complete: false, expectedTotal: 4}});
    await f.start(); await f.finish();
    assert.equal(f.state().status, 'incomplete'); assert.equal(f.calls.length, 2); assert.equal(f.navigations.length, 4);
    assert.equal(f.state().pageProgress.pageProcessed, 2);
  });
  await test('duplicate listing across distinct pages is visited only once', async () => {
    const f = fixture();
    f.respond(async request => {
      if (request.mode === 'detail') return {ok: true, kind: 'detail', record: {url: request.expectedUrl}};
      const second = request.expectedUrl.includes('pagingOffset=');
      return {ok: true, kind: 'list', links: second ? [listing(2), listing(3)] : [listing(1), listing(2)], nextUrl: second ? null : '?pagingOffset=50', pagination: {complete: second, expectedTotal: 3}};
    });
    await f.start(); await f.finish();
    assert.equal(f.state().status, 'completed'); assert.equal(f.calls.length, 3); assert.equal(f.state().pageProgress.pageProcessed, 2);
  });
  await test('changed page size or filter stops only after current page details finish', async () => {
    for (const invalid of ['?pagingOffset=50&pagingSize=20', '?pagingOffset=50&price_min=0', 'https://evil.invalid/page2']) {
      const f = fixture(); f.respond(async request => request.mode === 'detail' ? {ok: true, kind: 'detail', record: {url: request.expectedUrl}} : {ok: true, kind: 'list', links: [listing(1), listing(2)], nextUrl: invalid, pagination: {complete: false}});
      await f.start(); await f.finish();
      assert.equal(f.state().status, 'incomplete'); assert.equal(f.calls.length, 2); assert.deepEqual(f.navigations, [SEARCH, listing(1), listing(2)]);
    }
    assert.equal(new URL(B.nextPageUrl('?pagingOffset=50', SEARCH, SEARCH)).searchParams.get('pagingSize'), '50');
  });
  await test('limits retain current-page work and report a partial result', async () => {
    for (const limit of [{maxPages: 1}, {maxListings: 2}]) {
      const f = fixture(); f.respond(paginated(2, 3)); await f.start(limit); await f.finish();
      assert.equal(f.state().status, 'incomplete'); assert.equal(f.state().limited, true);
      assert.equal(f.calls.length, limit.maxListings || 3); assert.equal(f.navigations.filter(url => url.includes('/satilik-arsa/')).length, 1);
    }
  });
  await test('terminal visible-total mismatch stays incomplete even with a last-page marker', async () => {
    const f = fixture(); f.respond(paginated(1, 3, {total: 4})); await f.start(); await f.finish();
    assert.equal(f.state().status, 'incomplete'); assert.equal(f.state().listIncomplete, true); assert.equal(f.state().listComplete, false); assert.equal(f.calls.length, 3);
  });
  await test('paused legacy collected backlog migrates without losing links or processed cursor', async () => {
    const initial = fixture(); initial.respond(paginated(1, 3)); await initial.start(); await initial.load();
    const old = initial.state(); delete old.traversalVersion; delete old.pageProgress;
    old.status = 'paused'; old.phase = 'collect'; old.pages = 2; old.visitedPages = [B.pageKey(SEARCH), B.pageKey(B.nextPageUrl('?pagingOffset=50', SEARCH, SEARCH))];
    old.listingQueue = [ref(1), ref(2), ref(3)]; old.detailIndex = 1; old.counts.processed = 1;
    old.nextListUrl = B.nextPageUrl('?pagingOffset=100', SEARCH, SEARCH); old.current = null; old.workTabId = null; old.listComplete = false; old.expectedTotal = 4;
    const f = fixture(old);
    f.respond(async request => request.mode === 'detail' ? {ok: true, kind: 'detail', record: {url: request.expectedUrl}} : {ok: true, kind: 'list', links: [listing(4)], nextUrl: null, pagination: {currentPage: 3, expectedTotal: 4, complete: true}});
    await f.restart(); assert.equal(f.state().traversalVersion, 3); assert.equal(f.state().phase, 'details');
    await f.engine.handle({type: 'ILAN_RESUME'}); await f.finish();
    assert.deepEqual(f.navigations, [listing(2), listing(3), old.nextListUrl, listing(4)]);
    assert.equal(f.state().counts.processed, 4); assert.equal(f.state().status, 'completed');
  });
  await test('direct newline links deduplicate and never navigate to a search page', async () => {
    const f = fixture();
    const result = await f.engine.handle({type: 'ILAN_START_LINKS', urls: `\n${listing(1)}\n${listing(2)}\n${listing(1)}?utm_source=duplicate\n`, category: 'all', delayMs: 4000, revealPhone: true});
    assert.equal(result.ok, true); assert.equal(result.job.counts.discovered, 2); assert.equal(result.job.baseline, true); assert.equal(result.job.searchId, '');
    await f.finish();
    assert.deepEqual(f.navigations, [listing(1), listing(2)]); assert.equal(f.state().status, 'completed'); assert.equal(f.state().listComplete, true);
    assert.deepEqual(f.state().pageProgress, {currentPage: 1, totalPages: 1, pageFound: 2, pageProcessed: 2, totalProcessed: 2, totalExpected: 2, stage: 'done'});
    assert.equal(f.calls[0].context.baseline, true);
  });
  await test('direct-link validation is atomic and preserves an earlier completed job', async () => {
    const f = fixture(); await f.engine.handle({type: 'ILAN_START_LINKS', urls: [listing(1)], category: 'arsa'}); await f.finish();
    const original = f.state(), navigationCount = f.navigations.length;
    for (const urls of [[listing(2), 'https://evil.invalid/ilan/999/detay'], [listing(2), SEARCH], [listing(2), 123], `${listing(2)} ${listing(3)}`, []]) {
      const result = await f.engine.handle({type: 'ILAN_START_LINKS', urls, category: 'arsa'});
      assert.equal(result.ok, false); assert.deepEqual(f.state(), original); assert.equal(f.navigations.length, navigationCount);
    }
  });
  await test('mixed-provider direct batches require separate jobs without partial saves', async () => {
    const f = fixture();
    const result = await f.engine.handle({type: 'ILAN_START_LINKS', urls: [listing(1), 'https://www.hepsiemlak.com/ankara-bala-satilik/imarli-konut/0-123'], category: 'all'});
    assert.equal(result.ok, false); assert.match(result.error, /ayrı işler/); assert.equal(f.navigations.length, 0); assert.equal(f.saved.size, 0);
  });
  await test('direct-link partial queue resumes after service worker restart', async () => {
    const f = fixture(); await f.engine.handle({type: 'ILAN_START_LINKS', urls: [listing(1), listing(2), listing(3)], category: 'arsa'});
    await f.load(); await f.engine.handle({type: 'ILAN_PAUSE'}); await f.restart();
    assert.equal(f.state().pageProgress.pageProcessed, 1);
    await f.engine.handle({type: 'ILAN_RESUME'}); await f.finish();
    assert.deepEqual(f.navigations, [listing(1), listing(2), listing(3)]); assert.equal(f.calls.length, 3);
  });
  await test('navigation failure retries the intended next page, never accepts the old detail as a list', async () => {
    const f = fixture(); f.respond(paginated(2, 1)); await f.start(); await f.load(); await f.step(); await f.load();
    f.failNavigations(2);
    await f.step();
    assert.equal(f.state().status, 'running'); assert.equal(f.state().current.needsNavigation, true);
    await f.load(); // An old tab completion event must not read the previous detail.
    assert.equal(f.state().pages, 1);
    await f.step();
    assert.equal(f.state().status, 'paused'); assert.equal(f.state().pages, 1); assert.equal(f.state().phase, 'collect');
    await f.restart(); await f.engine.handle({type: 'ILAN_RESUME'}); await f.finish();
    assert.equal(f.state().status, 'completed'); assert.equal(f.calls.length, 2); assert.equal(f.state().pages, 2);
    assert.equal(new URL(f.navigations[2]).searchParams.get('pagingOffset'), '1');
  });
  await test('service worker loss after the last detail retains the pending next page', async () => {
    const f = fixture(); f.respond(paginated(5, 50)); await f.start();
    for (let page = 0; page < 5; page++) {
      await f.load();
      for (let index = 0; index < 50; index++) { await f.step(); await f.load(); }
      assert.equal(f.state().pageProgress.pageProcessed, 50);
      await f.restart();
      assert.equal(f.state().current, null);
      await f.step();
    }
    assert.equal(f.state().status, 'completed'); assert.equal(f.saved.size, 250); assert.equal(f.calls.length, 250);
    assert.equal(f.navigations.length, 255); assert.equal(f.alarms.size, 0);
  });
  await test('hydrating result page is reread before any partial queue is accepted', async () => {
    const f = fixture(); let listReads = 0;
    f.respond(async request => {
      if (request.mode === 'detail') return {ok: true, kind: 'detail', record: {url: request.expectedUrl}};
      listReads++;
      return {ok: true, kind: 'list', links: listReads === 1 ? [listing(1)] : [listing(1), listing(2)],
        pagination: {currentPage: 1, pageSize: 2, expectedTotal: 2, complete: true}};
    });
    await f.start(); await f.load();
    assert.equal(f.state().counts.discovered, 0); assert.equal(f.state().current.paginationRetried, true);
    await f.load(); assert.equal(listReads, 1, 'late onUpdated cannot bypass paced retry');
    await f.finish();
    assert.equal(listReads, 2); assert.equal(f.state().status, 'completed'); assert.equal(f.saved.size, 2);
  });
  await test('uncertain terminal page stays partial after the bounded retry', async () => {
    const f = fixture(); let reads = 0;
    f.respond(async request => {
      if (request.mode === 'detail') return {ok: true, kind: 'detail', record: {url: request.expectedUrl}};
      reads++; return {ok: true, kind: 'list', links: [listing(1)], pagination: {complete: false, reason: 'Sonraki sayfa doğrulanamadı.'}};
    });
    await f.start(); await f.finish();
    assert.equal(reads, 2); assert.equal(f.state().status, 'incomplete'); assert.equal(f.state().listComplete, false);
    assert.equal(f.saved.size, 1); assert.match(f.state().message, /kısmi/); assert.match(f.state().stopReason, /doğrulanamadı/);
  });
  await test('mismatched list remains resumable with its pending address', async () => {
    const f = fixture(); f.respond(async () => ({ok: false, kind: 'mismatch', error: 'Arama filtresi uyuşmuyor.'}));
    await f.start(); await f.load();
    assert.equal(f.state().status, 'paused'); assert.equal(f.state().current.url, SEARCH); assert.equal(f.state().current.needsNavigation, true);
    assert.equal(f.state().completedAt, null);
    f.respond(paginated(1, 1)); await f.engine.handle({type: 'ILAN_RESUME'}); await f.finish();
    assert.equal(f.state().status, 'completed'); assert.equal(f.saved.size, 1);
  });
  await test('late extraction from a tab that navigated away cannot be saved', async () => {
    const f = fixture(); await f.engine.handle({type: 'ILAN_START_LINKS', urls: [listing(1)], category: 'arsa'});
    let entered, release;
    const reading = new Promise(resolve => { entered = resolve; });
    f.respond(async request => { entered(); await new Promise(resolve => { release = resolve; }); return {ok: true, kind: 'detail', record: {url: request.expectedUrl}}; });
    const load = f.load(); await reading;
    f.tabs.get(f.state().workTabId).url = listing(2); release(); await load;
    assert.equal(f.state().status, 'running'); assert.equal(f.calls.length, 0); assert.equal(f.state().detailIndex, 0);
    assert.equal(f.state().current.needsNavigation, true);
    f.respond(async request => ({ok: true, kind: 'detail', record: {url: request.expectedUrl}}));
    await f.step(); assert.equal(f.navigations.at(-1), listing(1));
    await f.load(); await f.finish();
    assert.equal(f.calls.length, 1); assert.equal(f.saved.has(ref(1).id), true);
  });
  await test('a loading tab after extraction waits and rereads without discarding the listing', async () => {
    const f = fixture(); await f.engine.handle({type: 'ILAN_START_LINKS', urls: [listing(1)], category: 'arsa'});
    let first = true;
    f.respond(async request => {
      if (first) { first = false; f.tabs.get(f.state().workTabId).status = 'loading'; }
      return {ok: true, kind: 'detail', record: {url: request.expectedUrl}};
    });
    await f.load();
    assert.equal(f.state().status, 'running'); assert.equal(f.state().detailIndex, 0); assert.equal(f.calls.length, 0);
    f.tabs.get(f.state().workTabId).status = 'complete'; await f.step(); await f.finish();
    assert.equal(f.state().status, 'completed'); assert.equal(f.calls.length, 1);
  });
  await test('Sahibinden offset and page-number redirects identify the same result page', async () => {
    assert.equal(B.sameNavigationTarget(`${SEARCH}&page=2`, B.nextPageUrl('?pagingOffset=50', SEARCH, SEARCH), 'list'), true);
    assert.equal(B.sameNavigationTarget(`${SEARCH}&page=3`, B.nextPageUrl('?pagingOffset=50', SEARCH, SEARCH), 'list'), false);
  });
  await test('live wake timer respects delay while a durable alarm remains armed', async () => {
    let timerId = 0;
    const pending = new Map();
    const timers = {setTimeout: (fn, ms) => { pending.set(++timerId, {fn, ms}); return timerId; }, clearTimeout: id => pending.delete(id)};
    const f = fixture(null, {timers}); f.respond(paginated(2, 1)); await f.start(); await f.load();
    assert.equal(pending.size, 1); assert.equal(f.alarms.has(B.STEP_ALARM), true); assert.equal(f.alarms.has(B.WATCH_ALARM), true);
    const timer = [...pending.values()][0]; assert.equal(timer.ms, 4000);
    f.advance(timer.ms); pending.clear(); timer.fn(); await f.engine.handle({type: 'ILAN_STATUS'});
    assert.equal(f.state().current.url, listing(1));
    await f.load(); assert.equal(pending.size, 1);
    await f.engine.handle({type: 'ILAN_PAUSE'});
    assert.equal(pending.size, 0); assert.equal(f.alarms.size, 0);
  });
  console.log(`${count} page traversal tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
