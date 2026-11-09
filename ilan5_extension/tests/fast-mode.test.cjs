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
  const core = {normalizeRecord: raw => ({...raw, id: B.listingRef(raw.url).id, classification: {category: 'arsa', status: 'verified'}}), ...(options.core || {})};
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
function fastPages(pageCount, pageSize, rowFor = (n) => ({title: 'Arsa ' + n, price: 1000000 + n, currency: 'TRY'})) {
  return async request => {
    if (request.mode === 'detail') return {ok: true, kind: 'detail', record: {url: request.expectedUrl, title: 'Detay'}};
    const offset = Number(new URL(request.expectedUrl).searchParams.get('pagingOffset') || 0), page = offset / pageSize + 1;
    const numbers = Array.from({length: pageSize}, (_, i) => offset + i + 1);
    return {ok: true, kind: 'list', links: numbers.map(listing), rows: numbers.map(n => { const row = rowFor(n); return row ? {url: listing(n), ...row} : null; }).filter(Boolean),
      nextUrl: page < pageCount ? `?pagingOffset=${offset + pageSize}` : null,
      pagination: {currentPage: page, lastPage: pageCount, pageSize, expectedTotal: pageCount * pageSize, complete: page === pageCount}};
  };
}
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
(async () => {
  await test('fast mode saves list rows without opening detail pages', async () => {
    const f = fixture(); f.respond(fastPages(4, 50)); await f.start({mode: 'fast'}); await f.finish();
    const job = f.state();
    assert.equal(job.status, 'completed'); assert.equal(job.mode, 'fast');
    assert.equal(f.navigations.length, 4, 'only list pages are visited');
    assert.equal(f.saved.size, 200); assert.equal(job.counts.listed, 200); assert.equal(job.counts.saved, 200);
    assert.equal(f.calls.length, 4, 'one batch write per list page');
    assert.equal(f.calls[0].context.partial, true); assert.equal(f.calls[0].context.origin, 'crawl');
    assert.equal(f.calls[0].rows[0].detailStatus, 'list'); assert.equal(f.calls[0].rows[0].price, 1000001);
  });
  await test('fast mode opens details only for rows without readable data', async () => {
    const f = fixture(); f.respond(fastPages(1, 10, n => n % 5 === 0 ? null : {title: 'Arsa ' + n}));
    await f.start({mode: 'fast'}); await f.finish();
    assert.equal(f.state().status, 'completed');
    assert.deepEqual(f.navigations.slice(1), [listing(5), listing(10)]);
    assert.equal(f.saved.size, 10); assert.equal(f.saved.get(ref(5).id).detailStatus, 'full');
  });
  await test('fast mode respects maximum listings', async () => {
    const f = fixture(); f.respond(fastPages(3, 50)); await f.start({mode: 'fast', maxListings: 70}); await f.finish();
    assert.equal(f.saved.size, 70); assert.ok(f.navigations.length <= 2);
  });
  await test('fast mode adds the site page-size parameter (arabam take=50)', async () => {
    const f = fixture(); f.respond(async () => ({ok: true, kind: 'list', links: [], rows: [], pagination: {complete: true}}));
    await f.start({mode: 'fast', searchUrl: 'https://www.arabam.com/ikinci-el/otomobil/renault'});
    assert.equal(new URL(f.navigations[0] || f.state().searchUrl).searchParams.get('take'), '50');
    const g = fixture(); g.respond(async () => ({ok: true, kind: 'list', links: [], rows: [], pagination: {complete: true}}));
    await g.start({searchUrl: 'https://www.arabam.com/ikinci-el/otomobil/renault'});
    assert.equal(new URL(g.state().searchUrl).searchParams.get('take'), null, 'full mode leaves the address alone');
  });
  await test('full mode still opens every detail even when rows are present', async () => {
    const f = fixture(); f.respond(fastPages(1, 5)); await f.start(); await f.finish();
    assert.equal(f.navigations.length, 6); assert.equal(f.state().counts.listed || 0, 0);
  });
  await test('list-page budget pauses the crawl until the next morning', async () => {
    let slots = 0;
    const f = fixture(null, {core: {takeListSlot: async () => (++slots <= 2 ? {allowed: true} : {allowed: false, limit: 2, resumeAt: 99999999999})}});
    f.respond(fastPages(5, 10)); await f.start({mode: 'fast'});
    for (let i = 0; i < 20; i++) { if (f.state().current && (f.state().nextDueAt || 0) <= 99999999) await f.load(); else await f.step(); }
    assert.equal(f.navigations.length, 2); assert.equal(f.state().status, 'running'); assert.equal(f.state().nextDueAt, 99999999999);
    assert.match(f.state().message, /liste sayfası limiti/);
  });
  await test('fast mode opens details (phone) for new listings within today phone budget', async () => {
    const real = require('../core.js');
    const f = fixture(null, {core: {DAILY_KEY: real.DAILY_KEY, dayKey: real.dayKey, safetySettings: async () => ({phoneDailyLimit: 3, dailyLimit: 400})}});
    f.respond(fastPages(2, 10)); await f.start({mode: 'fast'}); await f.finish();
    assert.equal(f.state().status, 'completed');
    assert.deepEqual(f.navigations.filter(u => u.includes('/ilan/')), [listing(1), listing(2), listing(3)]);
    assert.equal(f.saved.size, 20); assert.equal(f.saved.get(ref(2).id).detailStatus, 'full'); assert.equal(f.saved.get(ref(4).id).detailStatus, 'list');
    const g = fixture(null, {core: {DAILY_KEY: real.DAILY_KEY, dayKey: real.dayKey, safetySettings: async () => ({phoneDailyLimit: 3, dailyLimit: 400})}});
    g.respond(fastPages(1, 10)); await g.start({mode: 'fast', revealPhone: false}); await g.finish();
    assert.equal(g.navigations.length, 1, 'no phone wanted: list only');
  });
  await test('core list budget counts per site and stops at the limit', async () => {
    const core = require('../core.js'); const store = {[core.SAFETY_KEY]: {listDailyLimit: 2}};
    const api = {storage: {local: {get: async key => ({[key]: structuredClone(store[key])}), set: async data => Object.assign(store, structuredClone(data))}}};
    const now = new Date(2026, 10, 8, 10).getTime();
    assert.equal((await core.takeListSlot(api, now, 'arabam')).allowed, true);
    assert.equal((await core.takeListSlot(api, now, 'arabam')).allowed, true);
    const third = await core.takeListSlot(api, now, 'arabam'); assert.equal(third.allowed, false); assert.ok(third.resumeAt > now);
    assert.equal((await core.takeListSlot(api, now, 'emlakjet')).allowed, true, 'other sites have their own budget');
    assert.equal((await core.takePhoneSlot(api, now, 'arabam')).allowed, true);
    assert.equal(store[core.DAILY_KEY].sites.arabam.lists, 2, 'phone slot keeps list count');
  });
  console.log(`${count} hızlı mod senaryosu geçti.`);
})().catch(error => { console.error(error); process.exit(1); });
