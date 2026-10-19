'use strict';
const assert = require('node:assert/strict');
const {createEngine, siteUrl, listingRef, nextPageUrl, categoryGate, JOB_KEY, STEP_ALARM} = require('../background.js');

const SEARCH = 'https://www.hepsiemlak.com/ankara-satilik-sahibinden?subCategories=imarli-konut&p31=5000000&p33=1';
const LAND = 'https://www.hepsiemlak.com/ankara-bala-satilik/imarli-konut/0-101';
const CAR = 'https://www.hepsiemlak.com/ankara-bala-satilik/imarli-konut/0-102';
const UNKNOWN = 'https://www.hepsiemlak.com/ankara-bala-satilik/imarli-konut/0-103';
const clone = value => JSON.parse(JSON.stringify(value));

function harness(existing = {}) {
  let now = 100000;
  let nextId = 1;
  const storage = clone(existing), tabs = new Map(), alarms = new Map(), records = new Map(), reads = [];
  let responder = async request => ({ok: true, kind: request.mode, links: [], pagination: {complete: true}});
  const api = {
    storage: {local: {get: async key => ({[key]: clone(storage[key] || null)}), set: async value => Object.assign(storage, clone(value))}},
    runtime: {sendMessage: async () => {}},
    alarms: {create: async (name, config) => alarms.set(name, config), clear: async name => alarms.delete(name)},
    tabs: {
      get: async id => { if (!tabs.has(id)) throw Error('missing'); return clone(tabs.get(id)); },
      create: async args => { const tab = {id: nextId++, status: 'complete', ...args}; tabs.set(tab.id, tab); return clone(tab); },
      update: async (id, args) => { const tab = tabs.get(id); if (!tab) throw Error('missing'); Object.assign(tab, args, {status: 'loading'}); return clone(tab); },
      query: async query => [...tabs.values()].filter(tab => !query.active || tab.active),
      sendMessage: async (id, request) => { reads.push({id, ...request}); return responder(request, tabs.get(id)); }
    },
    scripting: {executeScript: async () => {}}
  };
  const core = {normalizeRecord(raw) {
    const ref = listingRef(raw.url);
    return {id: ref.id, ...raw, classification: raw.classification || {category: 'belirsiz', status: 'unknown'}, quality: {status: 'complete'}};
  }};
  const db = {upsertMany: async values => { values.forEach(value => records.set(value.id, clone(value))); return {saved: values.length}; }};
  let engine = createEngine(api, core, db, {now: () => now});
  return {
    storage, tabs, alarms, records, reads,
    get engine() { return engine; },
    respond(fn) { responder = fn; },
    async start(extra = {}) { return engine.handle({type: 'ILAN_START', searchUrl: SEARCH, category: 'arsa', delayMs: 4000, ...extra}); },
    async loaded() { const job = storage[JOB_KEY]; const tab = tabs.get(job.workTabId); tab.status = 'complete'; await engine.onUpdated(tab.id, {status: 'complete'}, clone(tab)); },
    async step() { now += 5000; await engine.onAlarm({name: STEP_ALARM}); },
    async restart() { engine = createEngine(api, core, db, {now: () => now}); await engine.recover(); },
    state() { return clone(storage[JOB_KEY]); }
  };
}

async function test(name, fn) { await fn(); console.log('PASS ' + name); }
(async () => {
  await test('next-page links retain filters and cannot widen the original search', () => {
    const next = new URL(nextPageUrl('?page=2', SEARCH, SEARCH));
    assert.equal(next.searchParams.get('page'), '2');
    assert.equal(next.searchParams.get('p31'), '5000000');
    assert.equal(next.searchParams.get('subCategories'), 'imarli-konut');
    assert.throws(() => nextPageUrl('?page=2&p31=1', SEARCH, SEARCH), /filtresini/);
    assert.throws(() => nextPageUrl('/otomobil?page=2', SEARCH, SEARCH), /kapsamından/);
    assert.throws(() => nextPageUrl('https://evil.invalid/', SEARCH, SEARCH), /destekler/);
  });
  await test('listing identifiers deduplicate tracking URLs and reject nonlisting domains', () => {
    assert.equal(listingRef(LAND + '?utm_source=x').id, listingRef(LAND).id);
    assert.equal(listingRef('https://www.sahibinden.com/ilan/emlak-arsa-satilik-ornek-1234567890/detay').id, 'sahibinden:1234567890');
    assert.throws(() => listingRef('https://www.hepsiemlak.com.evil.invalid/0-101'));
    assert.throws(() => listingRef('https://user:pass@www.hepsiemlak.com/0-101'));
    assert.equal(siteUrl('http://hepsiemlak.com/ankara-satilik?x=1').url.href, 'https://www.hepsiemlak.com/ankara-satilik?x=1');
    assert.equal(siteUrl('http://sahibinden.com/satilik-arsa').url.protocol, 'https:');
  });
  await test('unknown and conflicting categories cannot enter the land archive', () => {
    for (const status of ['unknown', 'conflict']) {
      const record = {classification: {category: 'arsa', status}};
      assert.equal(categoryGate(record, 'arsa'), 'review');
      assert.equal(record.archiveStatus, 'review');
    }
    assert.equal(categoryGate({classification: {category: 'arac', status: 'verified'}}, 'arsa'), 'skip');
  });
  await test('multi-page queue is durable, deduplicated, and category filtered', async () => {
    const h = harness();
    h.respond(async request => {
      if (request.mode === 'list' && !request.expectedUrl.includes('page=2')) return {ok: true, kind: 'list', links: [LAND, LAND + '?utm_source=duplicate', CAR], nextUrl: '?page=2', pagination: {expectedTotal: 3, complete: false}};
      if (request.mode === 'list') return {ok: true, kind: 'list', links: [LAND, UNKNOWN], nextUrl: null, pagination: {expectedTotal: 3, complete: true}};
      const category = request.expectedUrl === CAR ? 'arac' : request.expectedUrl === UNKNOWN ? 'belirsiz' : 'arsa';
      return {ok: true, kind: 'detail', record: {url: request.expectedUrl, classification: {category, status: category === 'belirsiz' ? 'unknown' : 'verified'}}};
    });
    assert.equal((await h.start()).ok, true);
    await h.loaded();
    assert.equal(h.state().counts.discovered, 2);
    assert.ok(h.state().nextListUrl.includes('p31=5000000'));
    await h.restart(); // Still before the paced alarm: cannot navigate early.
    assert.equal(h.state().current, null);
    await h.step(); await h.loaded();
    assert.equal(h.state().phase, 'details');
    for (let i = 0; i < 3; i++) { await h.step(); await h.loaded(); }
    await h.step();
    assert.equal(h.state().status, 'completed');
    assert.deepEqual(h.state().counts, {discovered: 3, processed: 3, saved: 1, skipped: 1, review: 1, errors: 0, newListings: 0, priceIncreases: 0, priceDecreases: 0});
    assert.equal(h.records.size, 2);
    assert.equal(h.records.get(listingRef(UNKNOWN).id).archiveStatus, 'review');
    assert.equal(h.tabs.size, 1);
  });
  await test('blocked page survives restart and makes no calls until explicit resume', async () => {
    const h = harness();
    h.respond(async () => ({ok: false, kind: 'blocked', error: 'Doğrulama gerekli.'}));
    await h.start(); await h.loaded();
    assert.equal(h.state().status, 'blocked');
    const reads = h.reads.length;
    await h.restart(); await h.step();
    assert.equal(h.reads.length, reads);
    h.respond(async () => ({ok: true, kind: 'list', links: [], pagination: {complete: true}}));
    assert.equal((await h.engine.handle({type: 'ILAN_RESUME'})).ok, true);
    assert.equal(h.reads.length, reads + 1);
    await h.step();
    assert.equal(h.state().status, 'completed');
  });
  await test('pause while extraction is in flight prevents a late archive save', async () => {
    const h = harness();
    h.respond(async () => ({ok: true, kind: 'list', links: [LAND], pagination: {complete: true}}));
    await h.start(); await h.loaded(); await h.step();
    let resolveDetail, entered;
    const entry = new Promise(resolve => { entered = resolve; });
    h.respond(async request => { entered(); return new Promise(resolve => { resolveDetail = () => resolve({ok: true, kind: 'detail', record: {url: request.expectedUrl, classification: {category: 'arsa', status: 'verified'}}}); }); });
    const loading = h.loaded();
    await entry;
    const pausing = h.engine.handle({type: 'ILAN_PAUSE'});
    resolveDetail();
    await loading; await pausing;
    assert.equal(h.records.size, 0);
    assert.equal(h.state().detailIndex, 0);
    assert.equal(h.state().status, 'paused');
    assert.equal(h.state().current.stage, 'ready');
  });
  await test('missing work tab pauses and explicit resume recreates one tab', async () => {
    const h = harness();
    await h.start();
    const id = h.state().workTabId;
    h.tabs.delete(id);
    await h.engine.onRemoved(id);
    assert.equal(h.state().status, 'paused');
    assert.equal((await h.engine.handle({type: 'ILAN_RESUME'})).ok, true);
    await h.step(); // A quick resume still respects the last navigation delay.
    assert.equal(h.tabs.size, 1);
    assert.equal(h.state().current.kind, 'list');
  });
  await test('repeated pagination reports incomplete rather than false completion', async () => {
    const h = harness();
    h.respond(async () => ({ok: true, kind: 'list', links: [], nextUrl: SEARCH, pagination: {complete: false}}));
    await h.start(); await h.loaded(); await h.step();
    assert.equal(h.state().status, 'incomplete');
  });
  await test('one-off capture uses selected category gate without navigating tabs', async () => {
    const h = harness();
    h.tabs.set(7, {id: 7, url: CAR, status: 'complete'});
    h.respond(async request => ({ok: true, kind: 'detail', record: {url: request.expectedUrl, classification: {category: 'arac', status: 'verified'}}}));
    const result = await h.engine.handle({type: 'ILAN_CAPTURE_TAB', tabId: 7, category: 'arsa'});
    assert.equal(result.ok, true); assert.equal(result.skipped, true);
    assert.equal(h.records.size, 0); assert.equal(h.tabs.get(7).url, CAR);
  });
  await test('archive capture chooses most recently accessed detail, never a search tab', async () => {
    const h = harness();
    h.tabs.set(1, {id: 1, url: 'chrome-extension://test/archive.html', active: true, status: 'complete', lastAccessed: 9999});
    h.tabs.set(2, {id: 2, url: LAND, status: 'complete', lastAccessed: 100});
    h.tabs.set(3, {id: 3, url: CAR, status: 'complete', lastAccessed: 200});
    h.tabs.set(4, {id: 4, url: SEARCH, status: 'complete', lastAccessed: 300});
    h.respond(async request => ({ok: true, kind: 'detail', record: {url: request.expectedUrl, classification: {category: 'arac', status: 'verified'}}}));
    const result = await h.engine.handle({type: 'ILAN_CAPTURE_TAB', category: 'arac'});
    assert.equal(result.ok, true);
    assert.equal(h.reads[0].id, 3);
    h.tabs.get(2).lastAccessed = 200;
    const ambiguous = await h.engine.handle({type: 'ILAN_CAPTURE_TAB', category: 'arac'});
    assert.equal(ambiguous.ok, false);
    assert.match(ambiguous.error, /belirlenemedi/);
  });
  await test('stale completion event cannot read the previous about:blank page', async () => {
    const h = harness();
    await h.start();
    const tabId = h.state().workTabId;
    await h.engine.onUpdated(tabId, {status: 'complete'}, {id: tabId, status: 'complete', url: 'about:blank'});
    assert.equal(h.reads.length, 0);
    assert.equal(h.state().status, 'running');
  });
  console.log('11 background tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
