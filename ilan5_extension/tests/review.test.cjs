'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {IDBFactory} = require('fake-indexeddb');
const core = require('../core.js');

function database() {
  const context = vm.createContext({IlanCore: core, indexedDB: new IDBFactory(), module: {exports: {}}, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8'), context);
  return context.module.exports;
}

function land(id = '0-1001', extras = {}) {
  return {
    url: `https://www.hepsiemlak.com/ankara-golbasi-satilik/imarli-konut/${id}`,
    title: 'Satılık müstakil imarlı parsel', price: '8.250.000 TL', area: '1.500 m²',
    location: {city: 'Ankara', district: 'Gölbaşı', neighborhood: 'Hacılar Mah.'},
    phones: ['0532 111 22 33'],
    rawDetails: {'Arsa Tipi': 'İmarlı Konut', 'Tapu Durumu': 'Müstakil Parsel', 'Ada/Parsel No': '10 / 20'},
    ...extras
  };
}

function car(id = '2001', extras = {}) {
  return {
    url: `https://www.sahibinden.com/ilan/vasita-otomobil-ornek-${id}/detay`,
    title: 'Sahibinden otomobil', price: '1.200.000 TL',
    description: 'Arsa takas olur. İmarlı konut arsası ile takasa uygundur.',
    location: {city: 'Ankara'}, phones: ['+90 532 111 22 33'],
    rawDetails: {Marka: 'Örnek', Model: 'Test', 'Yakıt Tipi': 'Benzin'},
    ...extras
  };
}

test('vehicle remains vehicle when description or title mentions land barter', () => {
  const r = core.normalizeRecord(car('2001', {title: 'Arsa takaslı otomobil'}), {targetCategory: 'arsa'});
  assert.equal(r.category, 'arac');
  assert.equal(r.archiveStatus, 'active');
  assert.equal(core.filterRecords([r], {category: 'arsa'}).length, 0);
  assert.equal(core.filterRecords([r], {category: 'arac'}).length, 1);
});

test('collection category and free text never classify unknown listing as land', () => {
  const r = core.normalizeRecord({title: 'Arsa fırsatı', description: 'Satılık arsa', price: '5.500.000'}, {targetCategory: 'arsa'});
  assert.equal(r.category, 'belirsiz');
  assert.equal(r.quality.status, 'review');
  assert.equal(core.filterRecords([r], {category: 'arsa'}).length, 0);
  assert.equal(core.filterRecords([r], {category: 'review'}).length, 1);
});

test('contradictory land fields and vehicle URL remain in review after repeated normalization', () => {
  const r = core.normalizeRecord(car('2002', {rawDetails: {'Arsa Tipi': 'İmarlı Konut'}}));
  const roundTrip = core.normalizeRecord(core.normalizeRecord(r));
  assert.equal(roundTrip.category, 'belirsiz');
  assert.equal(roundTrip.classification.status, 'conflict');
  assert.equal(roundTrip.archiveStatus, 'review');
  assert.equal(core.filterRecords([roundTrip], {category: 'arsa'}).length, 0);
  assert.equal(core.filterRecords([roundTrip], {category: 'arac'}).length, 0);
});

test('land URL with apartment title requires review and is excluded from land results', () => {
  const r = core.normalizeRecord(land('0-1002', {title: 'SATILIK SİTE DAİRESİ YÜKSEK BLOK SİTE İÇERİSİNDE'}));
  const roundTrip = core.normalizeRecord(r);
  assert.equal(roundTrip.classification.status, 'conflict');
  assert.equal(roundTrip.archiveStatus, 'review');
  assert.equal(core.filterRecords([roundTrip], {category: 'arsa'}).length, 0);
});

test('normalization keeps evidence stable instead of multiplying it each import', () => {
  const first = core.normalizeRecord(land());
  const second = core.normalizeRecord(first);
  const third = core.normalizeRecord(second);
  assert.deepEqual(second.classification, first.classification);
  assert.deepEqual(third.classification, first.classification);
  assert.deepEqual(third.rawDetails, first.rawDetails);
  assert.deepEqual(third.quality, first.quality);
  assert.equal(third.id, first.id);
});

test('imported conflicting evidence stays stable across all normalizations', () => {
  const first = core.normalizeRecord(land('0-1003', {category: 'arac', categoryEvidence: [{category: 'arac', source: 'breadcrumb', text: 'Vasıta > Otomobil'}]}));
  const second = core.normalizeRecord(first);
  assert.equal(first.classification.status, 'conflict');
  assert.equal(second.archiveStatus, 'review');
  assert.deepEqual(second.classification, first.classification);
});

test('mismatched source ID is visible review rather than safe land category', () => {
  const r = core.normalizeRecord(land('0-1004', {listingId: '0-9999'}));
  assert.equal(r.quality.status, 'review');
  assert.ok(r.quality.warnings.some(x => x.includes('İlan numarası')));
  assert.equal(core.filterRecords([r], {category: 'arsa'}).length, 0);
});

test('Python .durum.json wrapper imports named fields and public phone', () => {
  const r = core.normalizeRecord({
    record: {'URL': 'https://www.hepsiemlak.com/ankara-bala-satilik/konutticaret/0-44460632', 'İlan No': '0-44460632', 'İlan Başlığı': 'Sahibinden müstakil arsa', 'Fiyat (TL)': 8250000, 'Metrekare (m²)': 1500, 'İl': 'Ankara', 'İlçe': 'Bala', 'Mahalle': 'Beynam Mah.', 'Ad Soyad': 'Satıcı Test', 'Telefon': '0532 111 22 33'},
    fields: {'Arsa Tipi': 'Konut+Ticaret', 'Tapu Durumu': 'Müstakil Parsel', 'Ada/Parsel No': '100/2', 'İlgili Belediye': 'Bala'},
  });
  assert.equal(r.source, 'hepsiemlak');
  assert.equal(r.listingId, '0-44460632');
  assert.equal(r.category, 'arsa');
  assert.equal(r.price, 8250000);
  assert.equal(r.area, 1500);
  assert.equal(r.rawDetails['İlgili Belediye'], 'Bala');
  assert.deepEqual(r.phones, ['905321112233']);
});

test('legacy raw_details maps to canonical details and valid source is inferred from URL', () => {
  const r = core.normalizeRecord({url: 'https://www.sahibinden.com/ilan/vasita-otomobil-test-3001/detay', listing_id: '3001', title: 'Otomobil', price: '1.250.000 TL', source: 'hepsiemlak', raw_details: {Marka: 'Örnek', Model: 'Seri'}, collected_at: '2026-09-25T09:00:00Z'});
  assert.equal(r.source, 'sahibinden');
  assert.equal(r.category, 'arac');
  assert.equal(r.rawDetails.Marka, 'Örnek');
  assert.equal(r.capturedAt, '2026-09-25T09:00:00Z');
});

test('Turkish area and money parsing retain exact magnitude', () => {
  for (const [input, expected] of [['8.250.000,00 TL', 8250000], ['1.692,31 TL', 1692.31], ['1.500,00 m²', 1500], ['0,50', 0.5], [8250000, 8250000], ['', null], ['Belirtilmemiş', null]]) {
    assert.equal(core.parseNumber(input), expected, String(input));
  }
});

test('category + Turkish price range + currency + city filters exclude vehicles and foreign prices', () => {
  const data = [land('0-1100'), land('0-1101', {price: '4.900.000 TL'}), land('0-1102', {price: '8.250.000 USD', currency: 'USD'}), car('2100', {price: '8.250.000 TL'}), land('0-1103', {location: {city: 'İstanbul'}})].map(x => core.normalizeRecord(x));
  const result = core.filterRecords(data, {category: 'arsa', minPrice: '5.000.000', maxPrice: '9.000.000', currency: 'TRY', city: 'ANKARA'});
  assert.deepEqual(result.map(x => x.listingId), ['0-1100']);
});

test('manual category correction removes category review and persists on normalization', () => {
  const conflict = core.normalizeRecord(car('2200', {rawDetails: {'Arsa Tipi': 'İmarlı Konut'}}));
  const fixed = core.normalizeRecord({...conflict, manualCategory: 'arac', manualCategorizedAt: '2026-09-25T09:00:00Z'});
  assert.equal(fixed.classification.status, 'manual');
  assert.equal(fixed.archiveStatus, 'active');
  assert.equal(core.normalizeRecord(fixed).category, 'arac');
  assert.equal(core.filterRecords([fixed], {category: 'arsa'}).length, 0);
  assert.equal(core.filterRecords([fixed], {category: 'arac'}).length, 1);
  assert.ok(!fixed.quality.warnings.some(x => x.includes('Kategori kanıtları')));
});

test('source + listing ID prevents cross-provider collisions', async () => {
  const db = database();
  const id = '7777';
  await db.upsertMany([land('0-1200', {listingId: id}), car(id)]);
  const result = await db.getAll();
  assert.equal(result.length, 2);
  assert.ok(await db.get('hepsiemlak:' + id));
  assert.ok(await db.get('sahibinden:' + id));
});

test('same-batch duplicate ID imports once, last record wins', async () => {
  const db = database();
  const result = await db.upsertMany([land('0-1201', {price: 6000000}), land('0-1201', {price: 7500000})]);
  assert.equal(result.saved, 1);
  assert.equal(result.added, 1);
  assert.equal(result.updated, 0);
  assert.equal((await db.getAll()).length, 1);
  assert.equal((await db.get('hepsiemlak:0-1201')).price, 7500000);
});

test('DB import of canonical conflict cannot silently become verified land', async () => {
  const db = database();
  const conflict = core.normalizeRecord(land('0-1202', {category: 'arac'}));
  await db.upsertMany([conflict]);
  let r = await db.get(conflict.id);
  assert.equal(r.archiveStatus, 'review');
  assert.equal(core.filterRecords([r], {category: 'arsa'}).length, 0);
  await db.upsertMany([r]);
  r = await db.get(conflict.id);
  assert.equal(r.archiveStatus, 'review');
  assert.equal(r.classification.status, 'conflict');
});

test('DB manual category survives subsequent ordinary scrape upsert', async () => {
  const db = database();
  const raw = land('0-1203', {title: 'SATILIK SİTE DAİRESİ'});
  await db.upsertMany([raw]);
  const id = core.normalizeRecord(raw).id;
  await db.setCategory(id, 'konut');
  const before = await db.get(id);
  await db.upsertMany([{...raw, price: '9.000.000 TL'}]);
  const after = await db.get(id);
  assert.equal(after.category, 'konut');
  assert.equal(after.classification.status, 'manual');
  assert.equal(after.manualCategorizedAt, before.manualCategorizedAt);
  assert.equal(after.firstSeenAt, before.firstSeenAt);
  assert.equal(after.price, 9000000);
  assert.equal(after.history.length, 1);
  assert.equal(core.filterRecords([after], {category: 'arsa'}).length, 0);
});

test('deleted record stays deleted on fresh scrape and returns only on restore', async () => {
  const db = database();
  const raw = land('0-1204');
  await db.upsertMany([raw]);
  const id = core.normalizeRecord(raw).id;
  await db.setDeleted(id, true);
  await db.upsertMany([{...raw, price: '9.000.000 TL'}]);
  let r = await db.get(id);
  assert.ok(r.deletedAt);
  assert.equal(core.filterRecords([r], {category: 'arsa'}).length, 0);
  assert.equal(core.filterRecords([r], {category: 'trash'}).length, 1);
  await db.setDeleted(id, false);
  r = await db.get(id);
  assert.equal(r.deletedAt, null);
  assert.equal(core.filterRecords([r], {category: 'arsa'}).length, 1);
  assert.equal(core.filterRecords([r], {category: 'trash'}).length, 0);
});

test('DB rejects empty input record without writing a partial batch', async () => {
  const db = database();
  await assert.rejects(db.upsertMany([land('0-1205'), {}]), /başlığı|kaynağı/);
  assert.equal((await db.getAll()).length, 0);
});

test('phones preserve Turkish international format and reject price-sized numbers', () => {
  assert.deepEqual(core.phonesFrom(['0532 111 22 33', '+90 (532) 111 22 33', '0090 532 111 22 33', '8.250.000 TL']), ['905321112233']);
});
