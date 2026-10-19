'use strict';
const assert = require('node:assert/strict');
const M = require('../monitoring.js');
const URL1 = 'https://www.sahibinden.com/ilan/emlak-arsa-satilik-ornek-1234567890/detay';
const URL2 = 'https://www.sahibinden.com/ilan/vasita-otomobil-ornek-2234567890/detay';
const ID1 = 'sahibinden:1234567890';
const BASE = {id: ID1, url: URL1, source: 'sahibinden', listingId: '1234567890', title: 'Test arsa', category: 'arsa', phones: ['905551112233'], monitoring: {}};
const clone = x => structuredClone(x);
function harness(initial = [BASE]) {
  let now = 1700000000000, busy = false, patchFailure = false, queueFailure = false, sendStatus = 'queued';
  const rows = new Map(initial.map(row => [row.id, clone(row)])), storage = {}, tabs = new Map(), alarms = new Map(), outbox = new Map(), queued = [], reads = [];
  let nextId = 1, response = async request => ({ok: true, kind: 'status', status: 'removed', url: request.expectedUrl, listingId: M.detail(request.expectedUrl).listingId, evidence: 'Bu ilan yayından kaldırılmıştır.'});
  const api = {
    storage: {local: {get: async key => ({[key]: clone(storage[key])}), set: async x => Object.assign(storage, clone(x))}},
    runtime: {sendMessage: async () => {}},
    alarms: {create: async (name, config) => alarms.set(name, clone(config)), clear: async name => alarms.delete(name)},
    tabs: {
      get: async id => { if (!tabs.has(id)) throw Error('closed'); return clone(tabs.get(id)); },
      create: async args => { const tab = {id: nextId++, ...args, status: 'complete'}; tabs.set(tab.id, tab); return clone(tab); },
      update: async (id, args) => { Object.assign(tabs.get(id), args, {status: 'loading'}); return clone(tabs.get(id)); },
      sendMessage: async (id, req) => { reads.push(clone(req)); return response(req); }
    },
    scripting: {executeScript: async () => {}}
  };
  const db = {
    getAll: async () => [...rows.values()].map(clone),
    get: async id => clone(rows.get(id)),
    patchMonitoring: async (id, patch) => { if (patchFailure) throw Error('DB write rejected'); const row = rows.get(id); if (!row) throw Error('missing'); row.monitoring = {...row.monitoring, ...clone(patch)}; return clone(row); }
  };
  const telegram = {enqueueRemoval: async (record, eventId) => {
    queued.push(eventId);
    assert.equal(rows.get(record.id).monitoring.removalEventId, eventId, 'event committed before enqueue');
    assert.equal(rows.get(record.id).monitoring.status, 'removed');
    if (queueFailure) throw Error('queue failed');
    const duplicate = outbox.has(eventId); if (!duplicate) outbox.set(eventId, {eventId, status: sendStatus});
    return {...outbox.get(eventId), duplicate};
  }};
  let engine = M.createEngine(api, {}, db, telegram, {now: () => now, isCrawlerBusy: async () => busy});
  return {
    rows, storage, tabs, alarms, outbox, queued, reads,
    get engine() { return engine; }, get now() { return now; },
    state: () => clone(storage[M.KEY]), row: (id = ID1) => clone(rows.get(id)),
    advance: milliseconds => { now += milliseconds; }, busy: x => { busy = x; }, failDb: x => { patchFailure = x; }, failQueue: x => { queueFailure = x; },
    respond: fn => { response = fn; }, sent: () => { sendStatus = 'sent'; },
    async run() { return engine.handle({type: 'ILAN_MONITOR_RUN'}); },
    async loaded() { const state = storage[M.KEY], tab = tabs.get(state.workTabId); assert.ok(tab); tab.status = 'complete'; await engine.onUpdated(tab.id, {status: 'complete'}, clone(tab)); },
    async step(ms = 16000) { now += ms; await engine.onAlarm({name: M.STEP}); },
    async scan(status = 'removed') {
      response = async request => ({ok: true, kind: 'status', status, url: request.expectedUrl, listingId: M.detail(request.expectedUrl).listingId, evidence: status === 'removed' ? 'Bu ilan yayından kaldırılmıştır.' : 'İlan No: ' + M.detail(request.expectedUrl).listingId});
      await this.run(); if (!this.state().current) await this.step(); await this.loaded(); await this.step();
    },
    async restart() { engine = M.createEngine(api, {}, db, telegram, {now: () => now, isCrawlerBusy: async () => busy}); await engine.recover(); }
  };
}
let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log('PASS ' + name); }
(async () => {
  await test('only valid nondeleted archived Sahibinden details are eligible', () => {
    assert.equal(M.eligible(BASE), true);
    for (const edit of [{source: 'hepsiemlak'}, {url: 'https://www.sahibinden.com/satilik-arsa'}, {url: URL1.replace('sahibinden.com', 'sahibinden.com.evil.invalid')}, {deletedAt: '2026-01-01'}, {listingId: 'other'}]) assert.equal(M.eligible({...BASE, ...edit}), false);
  });
  await test('two explicit observations need the full confirmation interval', async () => {
    const h = harness(); await h.scan();
    assert.equal(h.row().monitoring.status, 'suspected'); assert.equal(h.queued.length, 0);
    h.advance(5 * 60000); await h.scan();
    assert.equal(h.row().monitoring.missingCount, 1); assert.equal(h.queued.length, 0);
    h.advance(10 * 60000); await h.scan();
    assert.equal(h.row().monitoring.status, 'removed'); assert.equal(h.row().monitoring.missingCount, 2); assert.equal(h.outbox.size, 1);
    assert.equal(h.row().title, BASE.title); assert.deepEqual(h.row().phones, BASE.phones);
  });
  await test('restart reconciles the same event id; sent restored records never replay', async () => {
    const h = harness(); await h.scan(); h.advance(16 * 60000); await h.scan();
    const event = h.row().monitoring.removalEventId;
    await h.restart(); assert.equal(h.outbox.size, 1); assert.equal(h.row().monitoring.removalEventId, event);
    const restored = harness([{...h.row(), monitoring: {...h.row().monitoring, notificationStatus: 'sent', notifiedAt: new Date(h.now).toISOString()}}]);
    await restored.restart(); assert.equal(restored.queued.length, 0);
  });
  await test('active clears the old removal episode and permits exactly one new event', async () => {
    const h = harness(); await h.scan(); h.advance(16 * 60000); await h.scan();
    const first = h.row().monitoring.removalEventId;
    await h.scan('active'); assert.equal(h.row().monitoring.removalEventId, null); assert.equal(h.row().monitoring.missingCount, 0);
    await h.scan(); h.advance(16 * 60000); await h.scan();
    assert.equal(h.outbox.size, 2); assert.notEqual(h.row().monitoring.removalEventId, first);
  });
  await test('unknown interrupts suspicion and never creates a removal or notification', async () => {
    const h = harness(); await h.scan(); h.advance(16 * 60000); await h.scan('unknown');
    assert.equal(h.row().monitoring.status, 'unknown'); assert.equal(h.row().monitoring.missingCount, 0);
    await h.scan(); assert.equal(h.row().monitoring.status, 'suspected'); assert.equal(h.queued.length, 0);
  });
  await test('temporary unknown preserves already confirmed removal without new event', async () => {
    const h = harness(); await h.scan(); h.advance(16 * 60000); await h.scan();
    const before = h.row().monitoring, count = h.queued.length;
    await h.scan('unknown');
    assert.equal(h.row().monitoring.status, 'removed'); assert.equal(h.row().monitoring.lastCheckStatus, 'unknown');
    assert.equal(h.row().monitoring.removalEventId, before.removalEventId); assert.equal(h.queued.length, count);
  });
  await test('captcha pauses with no repeated reads until explicit resume', async () => {
    const h = harness();
    h.respond(async () => ({ok: false, kind: 'blocked', error: 'CAPTCHA'}));
    await h.run(); await h.loaded();
    assert.equal(h.state().phase, 'blocked'); assert.equal(h.row().monitoring.status, 'blocked');
    const reads = h.reads.length; await h.restart(); await h.step(16 * 60000);
    assert.equal(h.reads.length, reads); assert.equal(h.queued.length, 0);
  });
  await test('mismatched id/url and anonymous redirect cannot confirm removal', () => {
    const expected = M.detail(URL1), response = {ok: true, kind: 'status', status: 'removed', url: URL1, listingId: '1234567890', evidence: 'İlan kaldırıldı'};
    assert.throws(() => M.validateObservation({...response, listingId: '999'}, expected));
    assert.throws(() => M.validateObservation({...response, url: URL2}, expected));
    assert.throws(() => M.validateObservation({...response, url: 'https://www.sahibinden.com/hata'}, expected));
    const identified = M.validateObservation({...response, url: 'https://www.sahibinden.com/hata', evidence: 'İlan No: 1234567890 yayından kaldırılmıştır'}, expected);
    assert.equal(identified.status, 'removed');
  });
  await test('storage failure cannot enqueue an alert and leaves task paused', async () => {
    const h = harness(); await h.scan(); h.advance(16 * 60000); h.failDb(true);
    await h.run(); await h.loaded();
    assert.equal(h.state().phase, 'paused'); assert.equal(h.queued.length, 0); assert.equal(h.row().monitoring.status, 'suspected');
  });
  await test('queue failure survives restart with the durable event id', async () => {
    const h = harness(); await h.scan(); h.advance(16 * 60000); h.failQueue(true); await h.scan();
    const event = h.row().monitoring.removalEventId;
    assert.equal(h.row().monitoring.notificationStatus, 'queue_error'); h.failQueue(false); await h.restart();
    assert.equal(h.outbox.size, 1); assert.ok(h.outbox.has(event)); assert.equal(h.row().monitoring.notificationStatus, 'queued');
  });
  await test('pause epoch prevents an in-flight status response from being saved', async () => {
    const h = harness(); let complete, enter;
    const entered = new Promise(resolve => { enter = resolve; });
    h.respond(async request => { enter(); return new Promise(resolve => { complete = () => resolve({ok: true, kind: 'status', status: 'removed', url: request.expectedUrl, listingId: '1234567890', evidence: 'İlan kaldırıldı'}); }); });
    await h.run(); const loading = h.loaded(); await entered;
    const pausing = h.engine.handle({type: 'ILAN_MONITOR_PAUSE'}); complete(); await loading; await pausing;
    assert.equal(h.row().monitoring.status, undefined); assert.equal(h.state().phase, 'paused'); assert.equal(h.queued.length, 0);
  });
  await test('monitor waits for crawler and respects 15 second navigation pacing', async () => {
    const h = harness([BASE, {...BASE, id: 'sahibinden:2234567890', url: URL2, listingId: '2234567890'}]);
    h.busy(true); await h.run(); assert.equal(h.tabs.size, 0); assert.equal(h.state().phase, 'waiting_crawler');
    h.busy(false); await h.step(31000); await h.loaded();
    const first = h.state().lastNavigationAt; await h.step(1000); assert.equal(h.state().lastNavigationAt, first);
    await h.step(15000); assert.notEqual(h.state().lastNavigationAt, first); assert.equal(h.tabs.size, 1);
  });
  await test('confirmation config cannot be shortened below ten minutes', async () => {
    const h = harness(); const result = await h.engine.handle({type: 'ILAN_MONITOR_CONFIG', confirmationMinutes: 9});
    assert.equal(result.ok, false);
  });
  console.log(`${passed} monitor tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
