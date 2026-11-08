'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {IDBFactory} = require('fake-indexeddb');
const core = require('../core.js');
const URL1 = 'https://www.sahibinden.com/ilan/emlak-arsa-satilik-ornek-1234567890/detay';
function database() {
  const context = vm.createContext({IlanCore: core, indexedDB: new IDBFactory(), module: {exports: {}}, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8'), context);
  return context.module.exports;
}
const full = {url: URL1, title: 'Satılık arsa', price: 5000000, currency: 'TRY', phones: ['05321234567'], sellerName: 'Ali Veli', description: 'Uzun açıklama', location: {city: 'Ankara', district: 'Gölbaşı'}, rawDetails: {'Tapu Durumu': 'Müstakil'}, detailStatus: 'full'};
const row = {url: URL1, title: 'Satılık arsa (güncel)', price: 4500000, currency: 'TRY', location: {city: 'Ankara', district: 'Gölbaşı', neighborhood: 'İncek'}, detailStatus: 'list'};

test('normalizeRecord keeps detailStatus (list/full) and listedAt', () => {
  assert.equal(core.normalizeRecord(row).detailStatus, 'list');
  assert.equal(core.normalizeRecord(full).detailStatus, 'full');
  assert.equal(core.normalizeRecord({url: URL1, title: 'x'}).detailStatus, 'full', 'old records count as full');
  assert.equal(core.normalizeRecord({...row, listedAt: '2026-11-08'}).listedAt, '2026-11-08');
});

test('a list row refreshes price of a detailed record and keeps phones, seller and description', async () => {
  const db = database();
  await db.upsertMany([full], {origin: 'crawl', searchId: 's1', baseline: true});
  const result = await db.upsertMany([row], {origin: 'crawl', partial: true, searchId: 's1', runId: 'r2'});
  assert.equal(result.priceDecreases, 1);
  const saved = await db.get(core.normalizeRecord(full).id);
  assert.equal(saved.price, 4500000); assert.equal(saved.title, 'Satılık arsa (güncel)');
  assert.deepEqual([...saved.phones], ['905321234567']); assert.equal(saved.sellerName, 'Ali Veli'); assert.equal(saved.description, 'Uzun açıklama');
  assert.equal(saved.detailStatus, 'full'); assert.equal(saved.location.neighborhood, 'İncek'); assert.equal(saved.rawDetails['Tapu Durumu'], 'Müstakil');
  assert.equal(saved.history.at(-1).price, 5000000);
});

test('a detail visit upgrades a list-only record to full', async () => {
  const db = database();
  const first = await db.upsertMany([row], {origin: 'crawl', partial: true, searchId: 's1', runId: 'r1'});
  assert.equal(first.newListings, 1);
  await db.upsertMany([full], {origin: 'crawl', searchId: 's1', runId: 'r2'});
  const saved = await db.get(core.normalizeRecord(full).id);
  assert.equal(saved.detailStatus, 'full'); assert.deepEqual([...saved.phones], ['905321234567']);
});

test('unchanged list row writes no history entry', async () => {
  const db = database();
  await db.upsertMany([row], {origin: 'crawl', partial: true, searchId: 's1', runId: 'r1'});
  await db.upsertMany([row], {origin: 'crawl', partial: true, searchId: 's1', runId: 'r2'});
  const saved = await db.get(core.normalizeRecord(row).id);
  assert.equal((saved.history || []).length, 0); assert.equal(saved.detailStatus, 'list');
});
