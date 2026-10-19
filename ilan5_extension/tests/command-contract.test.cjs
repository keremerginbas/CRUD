'use strict';
// Smoke-test the actual archive runtime wrapper against registered MV3 handlers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {IDBFactory} = require('fake-indexeddb');
const root = path.resolve(__dirname, '..');
const TEST_TOKEN = '123456789:TEST_TOKEN_NOT_REAL_abcdefghijklmnopqrstuvwxyz';
const TEST_CHAT = '-1001234567890';
const TEST_BOT = 'ilan5_test_bot';
const archiveSource = fs.readFileSync(path.join(root, 'archive.js'), 'utf8');
const wrapper = archiveSource.split('\n').find(line => line.includes('async function runtime(type,'));
assert.ok(wrapper, 'actual archive runtime wrapper exists');
const startCollectionSource = archiveSource.split('\n').find(line => line.includes('async function startCollection()'));
assert.ok(startCollectionSource, 'actual archive startCollection handler exists');
const listeners = [], storage = {}, tabs = new Map();
const telegramCalls = [], accessLevels = [], warnings = [];
let nextTab = 1;
const noEvent = {addListener() {}};
let sender = {id: 'test-extension', url: 'chrome-extension://test-extension/archive.html'};
const api = {
  runtime: {
    id: 'test-extension', getURL: suffix => 'chrome-extension://test-extension/' + suffix,
    onMessage: {addListener(listener) { listeners.push(listener); }},
    onStartup: noEvent, onInstalled: noEvent,
    async sendMessage(message) {
      if (['ILAN_JOB_UPDATED','ILAN_MONITOR_UPDATED'].includes(message.type)) return;
      return new Promise(resolve => {
        const listener = listeners[0];
        assert.ok(listener, 'MV3 handler registered');
        const result = listener(message, sender, resolve);
        if (result === false) queueMicrotask(() => resolve(undefined));
      });
    }
  },
  storage: {local: {
    get: async key => ({[key]: structuredClone(storage[key])}),
    set: async data => Object.assign(storage, structuredClone(data)),
    setAccessLevel: async value => accessLevels.push(value.accessLevel)
  }},
  alarms: {create: async () => {}, clear: async () => {}, onAlarm: noEvent},
  tabs: {
    onUpdated: noEvent, onRemoved: noEvent,
    create: async args => { const tab = {id: nextTab++, ...args, status: 'complete'}; tabs.set(tab.id, tab); return tab; },
    get: async id => { const tab = tabs.get(id); if (!tab) throw Error('no tab'); return tab; },
    update: async (id, args) => Object.assign(tabs.get(id), args, {status: 'loading'}),
    query: async () => [...tabs.values()]
  }
};
const fakeFetch = async (url, options) => {
  // Record only method + body; never print or preserve credential-bearing URLs.
  const method = String(url).split('/').at(-1), body = JSON.parse(options.body);
  telegramCalls.push({method, body});
  let result;
  if (method === 'getMe') result = {id: 123456789, is_bot: true, username: TEST_BOT};
  else if (method === 'getChat') result = {id: Number(TEST_CHAT), type: 'supergroup', title: 'Synthetic Test Group'};
  else if (method === 'getChatMember') result = {status: 'administrator', user: {id: 123456789, is_bot: true}};
  else if (method === 'sendMessage') result = {message_id: 1, chat: {id: Number(TEST_CHAT)}};
  else throw Error('Unexpected synthetic Telegram method');
  return {ok: true, status: 200, json: async () => ({ok: true, result})};
};
const context = vm.createContext({console: {...console, warn: (...args) => warnings.push(args)}, URL, Date, Intl, AbortSignal, chrome: api, structuredClone, indexedDB: new IDBFactory(), fetch: fakeFetch});
context.importScripts = (...files) => files.forEach(file => {
  if (file === 'config.private.js') {
    context.IlanPrivateConfig = {telegram: {token: TEST_TOKEN, chatId: TEST_CHAT, expectedBotUsername: TEST_BOT}};
    return; // Never read actual private config in tests.
  }
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
});
vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context, {filename: 'background.js'});
vm.runInContext(wrapper + '\nglobalThis.testRuntime = runtime;', context);
context.uiInputs = {
  maxListings: {value: '0'}, delaySeconds: {value: '4'}, trackSearchInterval: {value: '60'},
  directUrls: {value: '\nhttps://www.sahibinden.com/ilan/emlak-arsa-satilik-test-777001/detay\nhttps://www.sahibinden.com/ilan/emlak-arsa-satilik-test-777002/detay\nhttps://www.sahibinden.com/ilan/emlak-arsa-satilik-test-777001/detay?utm_source=duplicate\n'},
  collectCategory: {value: 'all'}, revealPhone: {checked: true}
};
vm.runInContext(`
  const state = {collectMode: 'links', busy: false};
  const $ = id => globalThis.uiInputs[id];
  const toast = message => {throw Error(message);};
  const chooseList = async () => ({listId: 'list-test'});
  const showList = () => {};
  async function jobAction(type, config) {
    globalThis.uiSent = {type, ...config};
    globalThis.uiResult = await runtime(type, config);
  }
  ${startCollectionSource}
  globalThis.testStartCollection = startCollection;
`, context);
(async () => {
  const formPayload = {searchUrl: 'http://www.hepsiemlak.com/ankara-satilik-sahibinden?p31=5000000', category: 'arsa', maxListings: 0, maxPages: 0, delayMs: 4000, revealPhone: true};
  let result = await context.testRuntime('ILAN_START', formPayload);
  assert.equal(result.ok, true); assert.equal(result.job.status, 'running');
  assert.equal(result.job.searchUrl, 'https://www.hepsiemlak.com/ankara-satilik-sahibinden?p31=5000000');
  assert.equal(result.job.category, 'arsa'); assert.equal(result.job.maxListings, 0);
  result = await context.testRuntime('ILAN_PAUSE'); assert.equal(result.job.status, 'paused');
  result = await context.testRuntime('ILAN_RESUME'); assert.equal(result.job.status, 'running');
  result = await context.testRuntime('ILAN_STOP'); assert.equal(result.job.status, 'stopped');
  result = await context.testRuntime('ILAN_RESUME'); assert.equal(result.job.status, 'running');
  result = await context.testRuntime('ILAN_STATUS'); assert.equal(result.job.counts.discovered, 0);
  await context.testRuntime('ILAN_STOP');
  for (const category of ['all','arsa','arac','konut','isyeri','diger']) {
    const started = await context.testRuntime('ILAN_START', {...formPayload, category});
    assert.equal(started.job.category, category);
    await context.testRuntime('ILAN_STOP');
  }
  await assert.rejects(context.testRuntime('ILAN_START', {...formPayload, category: 'belirsiz'}), /kategorisini/);
  assert.ok(accessLevels.includes('TRUSTED_CONTEXTS'));

  await context.testStartCollection();
  assert.equal(context.uiSent.type, 'ILAN_START_LINKS');
  assert.equal(context.uiSent.listId, 'list-test'); assert.equal(context.uiResult.job.listId, 'list-test');
  assert.equal(context.uiSent.urls.length, 3); assert.equal(context.uiSent.category, 'all');
  assert.equal(context.uiSent.delayMs, 4000); assert.equal(context.uiSent.revealPhone, true);
  assert.equal(context.uiResult.job.mode, 'links'); assert.equal(context.uiResult.job.counts.discovered, 2);
  assert.equal(context.uiResult.job.listingQueue.length, 2); assert.equal(context.uiResult.job.phase, 'details');
  assert.equal(context.uiResult.job.searchUrl, ''); assert.equal(context.uiResult.job.baseline, true);
  await context.testRuntime('ILAN_STOP');

  result = await context.testRuntime('ILAN_SEARCH_STATUS');
  assert.equal(result.searches.length, 0);
  result = await context.testRuntime('ILAN_SEARCH_SAVE', {searchUrl: formPayload.searchUrl, name: 'Synthetic Ankara Search', category: 'arsa', intervalMinutes: 60, enabled: false, delayMs: 4000});
  assert.equal(result.searches.length, 1);
  const savedSearchId = result.search.id;
  assert.equal((await context.testRuntime('ILAN_SEARCH_TOGGLE', {id: savedSearchId, enabled: true})).search.enabled, true);
  result = await context.testRuntime('ILAN_SEARCH_RUN', {id: savedSearchId, maxListings: 50, maxPages: 5});
  assert.equal(result.search.activeJobId != null, true);
  const savedJob = (await context.testRuntime('ILAN_STATUS')).job;
  assert.equal(savedJob.searchId, savedSearchId); assert.equal(savedJob.baseline, true);
  assert.equal(savedJob.maxListings, 50); assert.equal(savedJob.maxPages, 5);
  await context.testRuntime('ILAN_STOP');
  result = await context.testRuntime('ILAN_SEARCH_STATUS');
  assert.equal(result.searches[0].lastStatus, 'stopped'); assert.equal(result.searches[0].hasBaseline, false);
  await context.testRuntime('ILAN_SEARCH_TOGGLE', {id: savedSearchId, enabled: false});
  assert.equal((await context.testRuntime('ILAN_SEARCH_REMOVE', {id: savedSearchId})).searches.length, 0);

  result = await context.testRuntime('ILAN_MONITOR_STATUS');
  assert.equal(result.monitor.counts.tracked, 0);
  assert.equal((await context.testRuntime('ILAN_MONITOR_CONFIG', {enabled: true, intervalMinutes: 360, confirmationMinutes: 15})).ok, true);
  assert.equal((await context.testRuntime('ILAN_MONITOR_RUN')).monitor.counts.tracked, 0);
  assert.equal((await context.testRuntime('ILAN_MONITOR_PAUSE')).monitor.status, 'paused');
  assert.equal((await context.testRuntime('ILAN_MONITOR_RESUME')).ok, true);

  const tracked = context.IlanCore.normalizeRecord({url: 'https://www.sahibinden.com/ilan/emlak-arsa-satilik-test-777003/detay', title: 'Synthetic monitored listing', price: 6000000});
  await context.IlanDB.upsertMany([tracked]);
  assert.equal((await context.testRuntime('ILAN_MONITOR_RUN')).monitor.status, 'running');
  // 2.6.2+: a crawl may start while link monitoring runs; the monitor yields to the crawler instead of blocking it.
  const overlapping = await context.testRuntime('ILAN_START_LINKS', {urls: context.uiSent.urls, category: 'all'});
  assert.equal(overlapping.job.status, 'running');
  await context.testRuntime('ILAN_STOP');
  await context.testRuntime('ILAN_MONITOR_PAUSE');
  await context.IlanDB.setDeleted(tracked.id, true);

  result = await context.testRuntime('ILAN_TELEGRAM_STATUS');
  assert.ok(!JSON.stringify(result).includes(TEST_TOKEN));
  result = await context.testRuntime('ILAN_TELEGRAM_CONFIG', {token: TEST_TOKEN, chatId: TEST_CHAT});
  assert.ok(!JSON.stringify(result).includes(TEST_TOKEN));
  assert.equal((await context.testRuntime('ILAN_TELEGRAM_VERIFY')).telegram.verified, true);
  assert.equal((await context.testRuntime('ILAN_TELEGRAM_TEST')).telegram.counts.sent, 1);
  assert.equal((await context.testRuntime('ILAN_TELEGRAM_RETRY')).ok, true);
  assert.equal(telegramCalls.filter(call => call.method === 'sendMessage').length, 1);
  assert.equal(String(telegramCalls.find(call => call.method === 'sendMessage').body.chat_id), TEST_CHAT);

  sender = {id: 'test-extension', url: 'chrome-extension://test-extension/popup.html'};
  assert.equal((await context.testRuntime('ILAN_STATUS')).ok, true);
  assert.equal((await context.testRuntime('ILAN_MONITOR_STATUS')).ok, true);
  assert.equal((await context.testRuntime('ILAN_TELEGRAM_STATUS')).ok, true);
  assert.equal((await context.testRuntime('ILAN_SEARCH_STATUS')).ok, true);
  sender = {id: 'test-extension', url: 'https://www.hepsiemlak.com/ankara-satilik'};
  await assert.rejects(context.testRuntime('ILAN_STOP'), /Geçersiz gönderen/);
  const callCount = telegramCalls.length;
  for (const command of ['ILAN_START_LINKS','ILAN_MONITOR_STATUS','ILAN_MONITOR_CONFIG','ILAN_MONITOR_RUN','ILAN_MONITOR_PAUSE','ILAN_MONITOR_RESUME','ILAN_TELEGRAM_STATUS','ILAN_TELEGRAM_CONFIG','ILAN_TELEGRAM_VERIFY','ILAN_TELEGRAM_TEST','ILAN_TELEGRAM_RETRY','ILAN_SEARCH_STATUS','ILAN_SEARCH_SAVE','ILAN_SEARCH_RUN','ILAN_SEARCH_TOGGLE','ILAN_SEARCH_REMOVE']) {
    await assert.rejects(context.testRuntime(command), /Geçersiz gönderen/);
  }
  assert.equal(telegramCalls.length, callCount);
  sender = {id: 'another-extension', url: 'chrome-extension://test-extension/archive.html'};
  await assert.rejects(context.testRuntime('ILAN_STATUS'), /Geçersiz gönderen/);
  await assert.rejects(context.testRuntime('ILAN_MONITOR_STATUS'), /Geçersiz gönderen/);
  await assert.rejects(context.testRuntime('ILAN_TELEGRAM_STATUS'), /Geçersiz gönderen/);
  await assert.rejects(context.testRuntime('ILAN_SEARCH_STATUS'), /Geçersiz gönderen/);
  await assert.rejects(context.testRuntime('ILAN_START_LINKS', {urls: context.uiSent.urls}), /Geçersiz gönderen/);
  assert.equal(warnings.length, 0, 'MV3 startup/recovery must complete without background warnings');
  console.log('Actual archive commands + multiline links UI + monitor busy gate + all categories + saved searches + monitor/Telegram + trusted storage/auth smoke passed (synthetic Telegram only).');
})().catch(error => { console.error(error); process.exitCode = 1; });
