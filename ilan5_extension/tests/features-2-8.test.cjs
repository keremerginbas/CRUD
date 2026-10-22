'use strict';
// 2.8.0 features: safety budget, separate window, health warnings, Telegram alerts, CRM, m² price, lists, export columns.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {IDBFactory} = require('fake-indexeddb');
const core = require('../core.js');
global.IlanCore = core;
const {createEngine, listingRef, JOB_KEY, STEP_ALARM} = require('../background.js');
const {createClient} = require('../telegram.js');
const Alerts = require('../alerts.js');

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const LAND = n => `https://www.hepsiemlak.com/ankara-bala-satilik/imarli-konut/0-${n}`;
function storageApi(initial = {}) {
  const state = clone(initial);
  return {state, local: {get: async key => typeof key === 'string' ? {[key]: clone(state[key])} : clone(state), set: async value => Object.assign(state, clone(value))}};
}
function database() {
  const context = vm.createContext({IlanCore: core, indexedDB: new IDBFactory(), module: {exports: {}}, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8'), context);
  return context.module.exports;
}
function record(id, extra = {}) {
  return core.normalizeRecord({url: `https://www.sahibinden.com/ilan/emlak-arsa-satilik-ornek-${id}/detay`, title: 'Arsa ' + id, price: 1000000, area: 1000,
    location: {city: 'Ankara', district: 'Gölbaşı'}, rawDetails: {'Arsa Tipi': 'İmarlı Konut'}, ...extra});
}

test('daily budget allows up to the limit, then waits until next local 00:05 and resets the next day', async () => {
  const storage = storageApi({[core.SAFETY_KEY]: {dailyLimit: 2}}), api = {storage};
  const now = new Date(2026, 9, 19, 14, 0).getTime();
  assert.equal((await core.takeDailySlot(api, now)).allowed, true);
  assert.equal((await core.takeDailySlot(api, now)).allowed, true);
  const denied = await core.takeDailySlot(api, now);
  assert.equal(denied.allowed, false);
  assert.equal(new Date(denied.resumeAt).getDate(), 20);
  assert.equal(new Date(denied.resumeAt).getHours(), 0);
  assert.equal(new Date(denied.resumeAt).getMinutes(), 5);
  assert.equal((await core.takeDailySlot(api, new Date(2026, 9, 20, 0, 6).getTime())).allowed, true);
  storage.state[core.SAFETY_KEY] = {dailyLimit: 0};
  for (let i = 0; i < 5; i++) assert.equal((await core.takeDailySlot(api, now)).allowed, true);
});

test('safety defaults: separate window on, 400 a day; invalid limits fall back', () => {
  assert.deepEqual(core.normalizeSafety(undefined), {separateWindow: true, skipKnown: true, reuseKnownPhone: true, dailyLimit: 400, phoneDailyLimit: 150});
  assert.deepEqual(core.normalizeSafety({separateWindow: false, dailyLimit: 0, skipKnown: false}), {separateWindow: false, skipKnown: false, reuseKnownPhone: true, dailyLimit: 0, phoneDailyLimit: 150});
  assert.equal(core.normalizeSafety({dailyLimit: -3}).dailyLimit, 400);
  assert.equal(core.normalizeSafety({dailyLimit: 'abc'}).dailyLimit, 400);
});

test('work tab opens in a minimized separate window and falls back to a background tab', async () => {
  const calls = [];
  const api = {storage: storageApi(), windows: {create: async opts => { calls.push(['window', opts]); return {id: 9, tabs: [{id: 91}]}; }},
    tabs: {create: async opts => { calls.push(['tab', opts]); return {id: 5}; }, query: async () => []}};
  assert.equal((await core.openWorkTab(api)).id, 91);
  assert.deepEqual(calls[0], ['window', {url: 'about:blank', state: 'minimized', focused: false}]);
  api.storage.state[core.SAFETY_KEY] = {separateWindow: false};
  assert.equal((await core.openWorkTab(api)).id, 5);
  api.storage.state[core.SAFETY_KEY] = {separateWindow: true};
  api.windows.create = async () => { throw Error('no windows'); };
  assert.equal((await core.openWorkTab(api)).id, 5);
  delete api.windows;
  assert.equal((await core.openWorkTab(api)).id, 5);
});

function engineHarness(storageInit, respond, options = {}) {
  let now = new Date(2026, 9, 19, 10, 0).getTime(), nextId = 1;
  const storage = storageApi(storageInit), tabs = new Map(), alarms = new Map(), saved = [];
  const api = {storage, runtime: {sendMessage: async () => {}},
    alarms: {create: async (name, config) => alarms.set(name, config), clear: async name => alarms.delete(name)},
    tabs: {get: async id => { if (!tabs.has(id)) throw Error('missing'); return clone(tabs.get(id)); },
      create: async args => { const tab = {id: nextId++, status: 'complete', ...args}; tabs.set(tab.id, tab); return clone(tab); },
      update: async (id, args) => { Object.assign(tabs.get(id), args, {status: 'loading'}); return clone(tabs.get(id)); },
      query: async () => [...tabs.values()], sendMessage: async (id, request) => respond(request)},
    scripting: {executeScript: async () => {}}};
  const db = {upsertMany: async values => { saved.push(...clone(values)); return {saved: values.length}; }};
  const engine = createEngine(api, core, db, {now: () => now, ...options});
  return {storage, tabs, saved, engine,
    job: () => clone(storage.state[JOB_KEY]),
    async loaded() { const job = storage.state[JOB_KEY]; const tab = tabs.get(job.workTabId); tab.status = 'complete'; await engine.onUpdated(tab.id, {status: 'complete'}, clone(tab)); },
    async step(ms = 5000) { now += ms; await engine.onAlarm({name: STEP_ALARM}); },
    get now() { return now; }};
}

test('crawler waits for the next day when the daily budget is used up, without opening another listing', async () => {
  const h = engineHarness({[core.SAFETY_KEY]: {dailyLimit: 1, separateWindow: false}},
    async request => ({ok: true, kind: 'detail', record: {url: request.expectedUrl, title: 'Arsa', price: 1000, rawDetails: {'Kategori': 'Arsa'}}}));
  await h.engine.handle({type: 'ILAN_START_LINKS', urls: [LAND(201), LAND(202)], category: 'all', delayMs: 4000});
  await h.loaded();
  assert.equal(h.job().detailIndex, 1);
  const navigatedTo = h.tabs.get(h.job().workTabId).url;
  await h.step();
  const job = h.job();
  assert.equal(job.status, 'running');
  assert.equal(job.current, null);
  assert.ok(job.waitingUntil);
  assert.match(job.message, /Günlük güvenli limit doldu \(1 ilan\)/);
  assert.equal(new Date(job.nextDueAt).getDate(), 20);
  assert.equal(h.tabs.get(job.workTabId).url, navigatedTo, 'no new navigation after the budget is spent');
});

test('five listings in a row without a price raise exactly one layout warning', async () => {
  const warnings = [];
  const h = engineHarness({[core.SAFETY_KEY]: {dailyLimit: 0, separateWindow: false}},
    async request => ({ok: true, kind: 'detail', record: {url: request.expectedUrl, title: 'Arsa', rawDetails: {}}}),
    {onHealthAlert: (field, message) => warnings.push({field, message})});
  const urls = [1, 2, 3, 4, 5, 6, 7].map(n => LAND(300 + n));
  await h.engine.handle({type: 'ILAN_START_LINKS', urls, category: 'all', delayMs: 4000, revealPhone: false});
  await h.loaded();
  for (let i = 0; i < 6; i++) { await h.step(); await h.loaded(); }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(warnings.map(w => w.field), ['price']);
  assert.match(warnings[0].message, /Art arda 5 ilanda fiyat okunamadı/);
  assert.ok(h.job().logs.some(log => log.message.startsWith('UYARI:')));
});

test('market stats flag listings well below the district median; seller counts find multi-listing phones', () => {
  const rows = [1, 2, 3, 4, 5].map(n => record(400 + n, {price: 1000000, phones: n < 4 ? ['0532 000 00 01'] : ['0532 000 00 0' + n]}));
  rows.push(record(406, {price: 600000, phones: ['0532 000 00 09']}));
  rows.push(record(407, {price: 900000, location: {city: 'Ankara', district: 'Polatlı'}}));
  const stats = core.marketStats(rows);
  assert.equal(stats.get(rows[5].id).opportunity, true);
  assert.equal(Math.round(stats.get(rows[5].id).ppa), 600);
  assert.equal(stats.get(rows[0].id).opportunity, false);
  assert.equal(stats.get(rows[6].id).ratio, null, 'too few listings in that district to compare');
  assert.equal(core.pricePerArea(record(408, {area: null})), null);
  const sellers = core.sellerCounts(rows);
  assert.equal(core.sellerListingCount(rows[0], sellers), 3);
  assert.equal(core.sellerListingCount(rows[4], sellers), 1);
});

test('CRM status survives a later crawl, and list relabel moves or removes only the label', async () => {
  const db = database();
  await db.upsertMany([record(501), record(502)], {origin: 'crawl', listId: 'list-a', baseline: true});
  await db.setCrm('sahibinden:501', {status: 'called', note: 'Pazartesi tekrar ara'});
  await db.upsertMany([record(501, {price: 900000})], {origin: 'crawl', listId: 'list-b', baseline: true});
  const saved = await db.get('sahibinden:501');
  assert.equal(saved.crm.status, 'called');
  assert.equal(saved.crm.note, 'Pazartesi tekrar ara');
  assert.deepEqual(saved.lists, ['list-a', 'list-b']);
  assert.equal((await db.relabelList('list-a', 'list-b')).changed, 2);
  assert.deepEqual((await db.get('sahibinden:501')).lists, ['list-b']);
  assert.deepEqual((await db.get('sahibinden:502')).lists, ['list-b']);
  await db.relabelList('list-b', '');
  assert.equal((await db.getAll()).length, 2, 'removing a list never deletes listings');
  assert.deepEqual((await db.get('sahibinden:502')).lists, []);
  assert.deepEqual(core.normalizeRecord({...record(503), 'Takip Durumu': 'İlgileniyor', 'Not': 'x'}).crm, {status: 'interested', note: 'x'});
  assert.equal(core.filterRecords([saved], {category: 'all', crm: 'called'}).length, 1);
  assert.equal(core.filterRecords([saved], {category: 'all', crm: 'none'}).length, 0);
  assert.equal(core.filterRecords([saved], {category: 'all', excludeList: 'list-b'}).length, 0);
});

test('crawl results expose newly written market events for notifications', async () => {
  const db = database();
  await db.upsertMany([record(601)], {origin: 'crawl', searchId: 's1', baseline: true});
  const result = await db.upsertMany([record(601, {price: 800000}), record(602)], {origin: 'crawl', searchId: 's1', runId: 'r2', baseline: false});
  assert.deepEqual([...result.events.map(e => e.type)].sort(), ['new', 'price_down']);
  assert.ok(!Object.keys(result).includes('events'), 'events are not part of the plain count summary');
});

function telegramHarness(state = {}, defaults = {}) {
  const storage = storageApi(state), sent = [];
  const api = {storage, alarms: {create: async () => {}, clear: async () => {}}, runtime: {sendMessage: async () => {}}};
  const client = createClient(api, {get: async () => null}, defaults, {now: () => Date.parse('2026-10-19T10:00:00Z'),
    fetch: async (url, options) => { const method = String(url).split('/').at(-1); sent.push(method); return {status: 200, json: async () => ({ok: true, result: {}})}; }});
  return {client, storage, sent};
}
const TOKEN = '123456789:TEST_TOKEN_NOT_REAL_abcdefghijklmnopqrstuvwxyz';

test('first start copies the token from config.private.js into storage so the file can be removed', async () => {
  const h = telegramHarness({}, {token: TOKEN, chatId: '-1001234567890'});
  await h.client.status();
  assert.equal(h.storage.state['ilan5.telegram.config.v1'].token, TOKEN);
  const empty = telegramHarness();
  await empty.client.status();
  assert.equal(empty.storage.state['ilan5.telegram.config.v1'], undefined);
});

test('alerts: price drops above the threshold and new tracked listings are queued once; no token = skipped', async () => {
  const h = telegramHarness({'ilan5.telegram.config.v1': {token: TOKEN, chatId: '-1001234567890'}});
  const alerts = Alerts.createAlerts(h.storage === undefined ? {} : {storage: h.storage}, () => h.client);
  const base = {listingId: '1', title: 'Arsa', url: 'https://www.sahibinden.com/ilan/emlak-arsa-1/detay', currency: 'TRY'};
  const events = [
    {...base, id: 'e1', type: 'price_down', oldPrice: 1000000, newPrice: 900000, percent: -10, searchIds: []},
    {...base, id: 'e2', type: 'price_down', oldPrice: 1000000, newPrice: 990000, percent: -1, searchIds: []},
    {...base, id: 'e3', type: 'new', newPrice: 500000, searchIds: ['s1']},
    {...base, id: 'e4', type: 'new', newPrice: 500000, searchIds: []},
    {...base, id: 'e5', type: 'price_up', oldPrice: 1, newPrice: 2, percent: 100, searchIds: []}];
  await alerts.marketEvents(events);
  await alerts.marketEvents(events);
  const outbox = h.storage.state['ilan5.telegram.outbox.v1'];
  assert.deepEqual(outbox.map(e => e.eventId), ['alert:e1', 'alert:e3']);
  assert.match(outbox[0].text, /FİYAT DÜŞTÜ \(%10\)/);
  assert.match(outbox[1].text, /YENİ İLAN/);
  await alerts.handle({type: 'ILAN_ALERTS_CONFIG', alerts: {priceDrop: false}});
  await alerts.marketEvents([{...events[0], id: 'e6'}]);
  assert.equal(h.storage.state['ilan5.telegram.outbox.v1'].length, 2);
  await alerts.health('price', 'Art arda 5 ilanda fiyat okunamadı.', {id: 'job-1', searchUrl: 'https://www.sahibinden.com/satilik-arsa'});
  assert.equal(h.storage.state['ilan5.telegram.outbox.v1'].at(-1).eventId, 'health:job-1:price');
  const noToken = telegramHarness();
  assert.equal((await noToken.client.enqueueAlert({eventId: 'x', text: 'y'})).status, 'skipped');
});

test('safety config round-trips through the background message handler', async () => {
  const storage = storageApi();
  const alerts = Alerts.createAlerts({storage}, () => null);
  let result = await alerts.handle({type: 'ILAN_SAFETY_CONFIG', safety: {dailyLimit: 150, separateWindow: false}});
  assert.equal(result.ok, true);
  assert.deepEqual(result.safety, {separateWindow: false, skipKnown: true, reuseKnownPhone: true, dailyLimit: 150, phoneDailyLimit: 150});
  result = await alerts.handle({type: 'ILAN_SAFETY_STATUS'});
  assert.equal(result.safety.dailyLimit, 150);
  assert.equal(result.todayCount, 0);
});

test('Excel/CSV rows include list names, m² price, follow-up status and note', () => {
  const context = vm.createContext({IlanCore: core, module: {exports: {}}, console, Blob, URL});
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'transfer.js'), 'utf8'), context);
  const rows = context.IlanTransfer.exportRows([{...record(701, {crm: {status: 'meeting', note: 'Cuma 14:00'}}), listNames: ['Ankara arsa']}]);
  const header = rows[0], row = rows[1], col = name => row[header.indexOf(name)];
  assert.equal(col('Listeler'), 'Ankara arsa');
  assert.equal(col('m² Fiyatı'), 1000);
  assert.equal(col('Takip Durumu'), 'Görüşülecek');
  assert.equal(col('Not'), 'Cuma 14:00');
  assert.equal(core.normalizeRecord(Object.fromEntries(header.map((h, i) => [h, row[i]]))).rawDetails['Listeler'], undefined, 'new columns are not re-imported as listing details');
});

// Crawl harness whose archive lookup is backed by a plain Map.
function skipHarness(archived, listResponse, detailRecord) {
  let now = new Date(2026, 9, 19, 10, 0).getTime();
  const storage = storageApi({[core.SAFETY_KEY]: {dailyLimit: 0, separateWindow: false}}), tabs = new Map(), reads = [], seen = [], saved = [];
  const api = {storage, runtime: {sendMessage: async () => {}}, alarms: {create: async () => {}, clear: async () => {}},
    tabs: {get: async id => { if (!tabs.has(id)) throw Error('missing'); return clone(tabs.get(id)); },
      create: async args => { tabs.set(1, {id: 1, status: 'complete', ...args}); return clone(tabs.get(1)); },
      update: async (id, args) => { Object.assign(tabs.get(id), args, {status: 'loading'}); return clone(tabs.get(id)); }, query: async () => [],
      sendMessage: async (id, request) => { reads.push(request); return request.mode === 'list' ? listResponse : {ok: true, kind: 'detail', record: detailRecord(request.expectedUrl)}; }},
    scripting: {executeScript: async () => {}}};
  const db = {getMany: async ids => ids.map(id => clone(archived.get(id))), markSeen: async (ids, options) => { seen.push({ids, options}); return {seen: ids.length}; },
    upsertMany: async values => { saved.push(...clone(values)); return {saved: values.length}; }};
  const engine = createEngine(api, core, db, {now: () => now});
  return {engine, reads, seen, saved, job: () => clone(storage.state[JOB_KEY]),
    async loaded() { tabs.get(1).status = 'complete'; await engine.onUpdated(1, {status: 'complete'}, clone(tabs.get(1))); },
    async step() { now += 5000; await engine.onAlarm({name: STEP_ALARM}); },
    get now() { return now; }};
}
const sUrl = n => `https://www.sahibinden.com/ilan/emlak-arsa-satilik-ornek-${n}/detay`;
const DAY = 24 * 60 * 60 * 1000, T0 = new Date(2026, 9, 19, 10, 0).getTime();
const known = (n, extra = {}) => [`sahibinden:${n}`, {id: `sahibinden:${n}`, price: 1000000, currency: 'TRY', phones: ['90532000' + String(n).slice(-4)], sellerName: 'Satıcı', updatedAt: new Date(T0 - DAY).toISOString(), market: {searchIds: ['s1']}, ...extra}];

test('known, unchanged listings on a search page are skipped; changed, stale or new ones are opened', async () => {
  const archived = new Map([known(900001), known(900002), known(900003, {updatedAt: new Date(T0 - 9 * DAY).toISOString()}), known(900004, {market: {searchIds: ['other']}})]);
  const rows = [[900001, 1000000], [900002, 900000], [900003, 1000000], [900004, 1000000], [900005, 1]].map(([n, price]) => ({url: sUrl(n), price, currency: 'TRY'}));
  const h = skipHarness(archived, {ok: true, kind: 'list', links: rows.map(r => r.url), rows, nextUrl: null, pagination: {complete: true, expectedTotal: 5}},
    url => ({url, title: 'Arsa', price: 900000, rawDetails: {}}));
  await h.engine.handle({type: 'ILAN_START', searchUrl: 'https://www.sahibinden.com/satilik-arsa/ankara', category: 'all', delayMs: 4000, searchId: 's1', listId: 'list-x'});
  await h.loaded();
  const job = h.job();
  assert.deepEqual(job.unchangedIds, ['sahibinden:900001'], 'only the fresh, same-price, same-search listing is skipped');
  assert.deepEqual(job.listingQueue.map(ref => ref.listingId), ['900002', '900003', '900004', '900005']);
  assert.equal(job.counts.discovered, 5, 'skipped listings still count toward the page total');
  assert.equal(job.counts.unchanged, 1);
  assert.equal(h.seen.length, 1);
  assert.deepEqual([...h.seen[0].ids], ['sahibinden:900001']);
  assert.equal(h.seen[0].options.searchId, 's1');
  assert.equal(h.seen[0].options.listId, 'list-x');
  assert.deepEqual(job.listingQueue[0].knownPhones, ['905320000002']);
  assert.equal(job.listingQueue[3].knownPhones, undefined);
  // The first detail (900002) already has a stored phone: the button is not pressed, the number is kept.
  await h.step(); await h.loaded();
  const detailRead = h.reads.find(r => r.mode === 'detail');
  assert.equal(detailRead.revealPhone, false);
  assert.deepEqual(h.saved[0].phones, ['905320000002']);
  // A listing without a stored phone (900005) still gets the button.
  for (let i = 0; i < 3; i++) { await h.step(); await h.loaded(); }
  assert.equal(h.reads.filter(r => r.mode === 'detail').at(-1).revealPhone, true);
  await h.step();
  assert.equal(h.job().status, 'completed');
});

test('links mode never skips but still reuses the stored phone', async () => {
  const archived = new Map([known(920001)]);
  const rows = [{url: sUrl(920001), price: 1000000, currency: 'TRY'}];
  const h = skipHarness(archived, {ok: true, kind: 'list', links: [sUrl(920001)], rows, nextUrl: null, pagination: {complete: true}}, url => ({url, title: 'A', price: 1000000}));
  await h.engine.handle({type: 'ILAN_START_LINKS', urls: [sUrl(920001)], category: 'all', delayMs: 4000});
  assert.equal(h.job().listingQueue.length, 1);
  assert.deepEqual(h.job().listingQueue[0].knownPhones, ['905320000001'], 'links mode still reuses the stored phone');
});

test('a page whose listings are all known and unchanged does not stop pagination as a repeated page', async () => {
  const archived = new Map([known(910001), known(910002)]);
  const rows = [910001, 910002].map(n => ({url: sUrl(n), price: 1000000, currency: 'TRY'}));
  const h = skipHarness(archived, {ok: true, kind: 'list', links: rows.map(r => r.url), rows, nextUrl: '?pagingOffset=50&pagingSize=50', pagination: {complete: false}}, url => ({url}));
  await h.engine.handle({type: 'ILAN_START', searchUrl: 'https://www.sahibinden.com/satilik-arsa/ankara', category: 'all', delayMs: 4000, searchId: 's1'});
  await h.loaded();
  const job = h.job();
  assert.ok(job.pendingNextListUrl, 'next page is still queued');
  assert.equal(job.listIncomplete, false);
  assert.equal(job.counts.unchanged, 2);
});

test('message queue: one message per seller, even within one batch, across phone order and after the queue is cleared', async () => {
  const db = database();
  const listing = (n, phones, seller = 'Satıcı ' + n) => record(n, {phones, sellerName: seller});
  await db.upsertMany([
    listing(950001, ['0532 111 11 11']),
    listing(950002, ['0533 222 22 22', '0532 111 11 11'], 'Aynı kişi, farklı sıra'),
    listing(950003, ['0544 333 33 33']),
    listing(950004, [], 'İsimli Satıcı'), listing(950005, [], 'isimli satıcı'),
    listing(950006, ['0555 444 44 44'])]);
  let result = await db.createMessageQueue({category: 'arsa'});
  assert.deepEqual([...result.items.map(i => i.listingId)].sort(), ['950001', '950003', '950004', '950006']);
  assert.equal(result.skippedContacted, 2);
  // Mark one as sent, then clear the queue: the seller is still remembered.
  const sent = result.items.find(i => i.listingId === '950001');
  await db.updateMessageItem(sent.id, {status: 'sent'});
  assert.ok((await db.get('sahibinden:950001')).messagedAt);
  await db.clearMessageQueue();
  await db.upsertMany([listing(950007, ['+90 532 111 11 11'])]);
  await db.upsertMany([listing(950001, ['0532 111 11 11'])], {origin: 'crawl'});
  assert.ok((await db.get('sahibinden:950001')).messagedAt, 'a new crawl keeps the sent mark');
  result = await db.createMessageQueue({category: 'arsa'});
  const ids = [...result.items.map(i => i.listingId)].sort();
  assert.ok(!ids.includes('950001') && !ids.includes('950002') && !ids.includes('950007'), 'messaged seller is never queued again: ' + ids);
  assert.ok(ids.includes('950003'), 'unsent sellers can be queued again after the queue was cleared');
  // The option still allows deliberately queuing other listings of a contacted seller (never the messaged listing itself).
  await db.clearMessageQueue();
  result = await db.createMessageQueue({category: 'arsa', skipSameSeller: false});
  assert.ok(!result.items.some(i => i.listingId === '950001'));
  assert.ok(result.items.some(i => i.listingId === '950007'));
});

test('daily summary counts the last 24 hours and is sent once a day, with catch-up after Chrome was closed', async () => {
  const db = database();
  const now = new Date(2026, 9, 19, 9, 0).getTime();
  await db.upsertMany([record(960001, {price: 1000000}), record(960002), record(960003), record(960004), record(960005), record(960006, {price: 500000, crm: {status: 'meeting'}})],
    {origin: 'crawl', searchId: 's1', baseline: true, observedAt: new Date(now - 30 * 60 * 60 * 1000).toISOString()});
  await db.upsertMany([record(960001, {price: 800000}), record(960007)], {origin: 'crawl', searchId: 's1', runId: 'r', observedAt: new Date(now - 60 * 60 * 1000).toISOString()});
  const tg = telegramHarness({'ilan5.telegram.config.v1': {token: TOKEN, chatId: '-1001234567890'}});
  const alarms = new Map();
  const api = {storage: tg.storage, alarms: {create: async (n, o) => alarms.set(n, o), clear: async n => alarms.delete(n), get: async n => alarms.get(n)}};
  const alerts = Alerts.createAlerts(api, () => tg.client, {getDb: () => db, now: () => now});
  const summary = await alerts.buildSummary();
  assert.equal(summary.newListings, 1);
  assert.equal(summary.priceDrops, 1);
  assert.equal(summary.meetings, 1);
  assert.equal(summary.opportunities, 2, "the 800k drop is exactly 20% below the district median, plus the 500k listing");
  assert.equal(summary.total, 7);
  assert.match(Alerts.summaryText(summary), /GÜNLÜK ÖZET[\s\S]*Yeni ilan: 1[\s\S]*Fiyatı düşen: 1[\s\S]*En büyük düşüşler/);
  // First start only arms the alarm.
  await alerts.scheduleSummary();
  assert.ok(alarms.has(Alerts.SUMMARY_ALARM));
  assert.equal(tg.storage.state['ilan5.telegram.outbox.v1'], undefined);
  // Next day after 08:30 with no summary sent yet (Chrome was closed): catch up once.
  const later = Alerts.createAlerts(api, () => tg.client, {getDb: () => db, now: () => now + 24 * 60 * 60 * 1000});
  await later.scheduleSummary();
  await later.scheduleSummary();
  await later.onAlarm({name: Alerts.SUMMARY_ALARM});
  const outbox = tg.storage.state['ilan5.telegram.outbox.v1'];
  assert.equal(outbox.filter(e => e.eventId.startsWith('summary:')).length, 1);
  assert.equal(Alerts.nextSummaryAt('08:30', new Date(2026, 9, 19, 9, 0).getTime()), new Date(2026, 9, 20, 8, 30).getTime());
  assert.equal(Alerts.normalize({summaryTime: '25:99'}).summaryTime, '08:30');
});

test('multi-site: listing addresses, look-alike hosts and categories for arabam.com and Emlakjet', () => {
  const {siteUrl} = require('../background.js');
  const arabam = listingRef('https://arabam.com/ilan/sahibinden-satilik-fiat-egea/sahibinden-fiat-egea-2022-model/44985286?utm_source=x');
  assert.deepEqual({...arabam}, {id: 'arabam:44985286', listingId: '44985286', url: 'https://www.arabam.com/ilan/sahibinden-satilik-fiat-egea/sahibinden-fiat-egea-2022-model/44985286', source: 'arabam'});
  assert.equal(listingRef('https://www.emlakjet.com/ilan/2-kat-konut-imarli-kose-parsel-19990109').id, 'emlakjet:19990109');
  assert.equal(listingRef('https://www.hepsiemlak.com/ankara-golbasi-bezirhane-satilik/tarla/0-47475589').id, 'hepsiemlak:0-47475589');
  assert.equal(siteUrl('http://emlakjet.com/satilik-arsa/ankara').source, 'emlakjet');
  for (const bad of ['https://www.arabam.com.evil.invalid/ilan/a/b/44985286', 'https://notarabam.com/ilan/a/b/44985286', 'https://emlakjet.co/ilan/x-19990109'])
    assert.throws(() => listingRef(bad), /destekler/);
  assert.throws(() => listingRef('https://www.arabam.com/ikinci-el/otomobil-sahibinden'), /detay/);
  assert.equal(core.normalizeRecord({url: 'https://www.arabam.com/ilan/a/b/44985286', title: 'Fiat Egea', price: 810000}).category, 'arac');
  const land = core.normalizeRecord({url: 'https://www.emlakjet.com/ilan/arsa-19990109', title: 'Arsa', price: 1}, {sourceSearchUrl: 'https://www.emlakjet.com/satilik-arsa/ankara'});
  assert.equal(land.category, 'arsa');
  assert.equal(land.source, 'emlakjet');
  assert.equal(core.normalizeRecord({url: 'https://www.emlakjet.com/ilan/arsa-19990110', title: 'Arsa', price: 1}).classification.status, 'unknown', 'without a category hint Emlakjet goes to review');
  const {searchUrl} = require('../searches.js');
  assert.equal(searchUrl('https://arabam.com/ikinci-el/otomobil-sahibinden?page=2'), 'https://www.arabam.com/ikinci-el/otomobil-sahibinden');
  assert.throws(() => searchUrl('https://www.arabam.com/ilan/a/b/44985286'), /Tek ilan/);
});

test('phone-button budget is per site; when spent, listings are still read without pressing the button', async () => {
  const storage = storageApi({[core.SAFETY_KEY]: {phoneDailyLimit: 2}}), api = {storage}, now = new Date(2026, 9, 22, 10).getTime();
  assert.equal((await core.takePhoneSlot(api, now, 'arabam')).allowed, true);
  assert.equal((await core.takePhoneSlot(api, now, 'arabam')).allowed, true);
  assert.equal((await core.takePhoneSlot(api, now, 'arabam')).allowed, false);
  assert.equal((await core.takePhoneSlot(api, now, 'emlakjet')).allowed, true, 'another site has its own budget');
  assert.equal((await core.takeDailySlot(api, now, 'arabam')).allowed, true);
  const daily = storage.state[core.DAILY_KEY];
  assert.deepEqual(daily.sites.arabam, {pages: 1, phones: 2});
  assert.equal((await core.takePhoneSlot(api, new Date(2026, 9, 23, 9).getTime(), 'arabam')).allowed, true, 'resets the next day');

  const urls = [1, 2, 3].map(n => `https://www.arabam.com/ilan/sahibinden-satilik-x/x/${4600000 + n}`);
  const engineStorage = storageApi({[core.SAFETY_KEY]: {phoneDailyLimit: 1, dailyLimit: 0, separateWindow: false}});
  const reads = [], tabs = new Map();
  let t = now;
  const engine = createEngine({storage: engineStorage, runtime: {sendMessage: async () => {}}, alarms: {create: async () => {}, clear: async () => {}},
    tabs: {get: async id => clone(tabs.get(id)), create: async args => { tabs.set(1, {id: 1, status: 'complete', ...args}); return clone(tabs.get(1)); },
      update: async (id, args) => { Object.assign(tabs.get(id), args, {status: 'loading'}); return clone(tabs.get(id)); }, query: async () => [],
      sendMessage: async (id, request) => { reads.push(request); return {ok: true, kind: 'detail', record: {url: request.expectedUrl, title: 'Araç', price: 1000}}; }},
    scripting: {executeScript: async () => {}}}, core, {upsertMany: async () => ({})}, {now: () => t});
  await engine.handle({type: 'ILAN_START_LINKS', urls, category: 'all', delayMs: 4000, revealPhone: true});
  const loaded = async () => { tabs.get(1).status = 'complete'; await engine.onUpdated(1, {status: 'complete'}, clone(tabs.get(1))); };
  await loaded();
  for (let i = 0; i < 2; i++) { t += 5000; await engine.onAlarm({name: STEP_ALARM}); await loaded(); }
  assert.deepEqual(reads.map(r => r.revealPhone), [true, false, false]);
  const job = clone(engineStorage.state[JOB_KEY]);
  assert.equal(job.counts.processed, 3, 'all listings still processed');
  assert.ok(job.logs.some(l => /Telefonu Göster” limiti doldu \(1\)/.test(l.message)));
});
