'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {IDBFactory} = require('/workspace/scratch/7830fb02ac8e/test_runtime/node_modules/fake-indexeddb');
const core = require('../core.js');
global.IlanCore = core;
global.XLSX = require('../vendor/xlsx.full.min.js');
const XLSX = global.XLSX;
const transfer = require('../transfer.js');

function land(id = '0-4100', extra = {}) {
  return core.normalizeRecord({
    url: `https://www.hepsiemlak.com/ankara-golbasi-satilik/imarli-konut/${id}`,
    title: 'Satılık imarlı müstakil arsa', price: '8.250.000,00 TL', area: '1.500,00 m²',
    sellerName: 'Satıcı Test', location: {city: 'Ankara', district: 'Gölbaşı', neighborhood: 'Hacılar Mah.'},
    phones: ['0532 111 22 33', '+90 (312) 222 33 44'], description: 'Örnek ilan açıklaması.',
    rawDetails: {'Arsa Tipi': 'İmarlı Konut', 'Tapu Durumu': 'Müstakil Parsel', 'Ada/Parsel No': '500 / 7', 'İlgili Belediye': 'Gölbaşı'},
    ...extra
  });
}

function car(id = '4200') {
  return core.normalizeRecord({url: `https://www.sahibinden.com/ilan/vasita-otomobil-ornek-${id}/detay`, title: 'Arsa takaslı otomobil', description: 'Arsa takas olur.', price: '800.000 TL', rawDetails: {Marka: 'Örnek', Model: 'Test'}});
}

function jsonFile(data, name = 'ankara_arsa_ilanlari.durum.json') {
  const str = JSON.stringify(data);
  return {name, size: Buffer.byteLength(str), text: async () => str};
}

function bytesFile(bytes, name = 'arsalar.xlsx') {
  const data = Buffer.from(bytes);
  return {name, size: data.length, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length)};
}

function workbookFile(wb, name = 'arsalar.xlsx') {
  return bytesFile(XLSX.write(wb, {type: 'buffer', bookType: 'xlsx'}), name);
}

function fileWithRows(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'İlanlar');
  return workbookFile(wb);
}

test('old Python .durum.json keyed rows and wrapper fields import without losing phones or parcel', async () => {
  const records = await transfer.importFile(jsonFile({
    rows: {'0-44460632': {
      record: {'URL': 'https://www.hepsiemlak.com/ankara-bala-satilik/konutticaret/0-44460632', 'İlan No': '0-44460632', 'İlan Başlığı': 'Sahibinden müstakil parsel', 'Fiyat (TL)': 8250000, 'Metrekare (m²)': 1500, 'İl': 'Ankara', 'İlçe': 'Bala', 'Ad Soyad': 'Test Satıcı'},
      fields: {'Arsa Tipi': 'Konut+Ticaret', 'Tapu Durumu': 'Müstakil Parsel', 'Ada/Parsel No': '100 / 2'},
      phones: ['0532 111 22 33']
    }}
  }));
  assert.equal(records.length, 1);
  assert.equal(records[0].category, 'arsa');
  assert.equal(records[0].source, 'hepsiemlak');
  assert.equal(records[0].price, 8250000);
  assert.equal(records[0].area, 1500);
  assert.deepEqual(records[0].phones, ['905321112233']);
  assert.equal(records[0].rawDetails['Ada/Parsel No'], '100 / 2');
});

test('actual SheetJS imports Turkish Excel headings and localized numeric strings', async () => {
  const records = await transfer.importFile(fileWithRows([{
    'İlan No': '0-4101', 'İlan Başlığı': 'İmarlı arsa', 'URL': 'https://www.hepsiemlak.com/ankara-golbasi-satilik/imarli-konut/0-4101',
    'Fiyat (TL)': '8.250.000,00', 'Metrekare (m²)': '1.500,00', 'Telefon': '0 (532) 111 22 33',
    'İl': 'Ankara', 'İlçe': 'Gölbaşı', 'Mahalle': 'Hacılar Mah.', 'Tapu Durumu': 'Müstakil Parsel', 'Arsa Tipi': 'İmarlı Konut', 'Ada/Parsel No': '500 / 7',
    'Son Güncelleme': '25/09/2026', 'İlan Durumu': 'Satılık', 'Metrekare Birim Fiyatı (TL)': 5500, 'İlgili Belediye': 'Gölbaşı'
  }]));
  assert.equal(records[0].category, 'arsa');
  assert.equal(records[0].price, 8250000);
  assert.equal(records[0].area, 1500);
  assert.deepEqual(records[0].phones, ['905321112233']);
  assert.equal(records[0].location.district, 'Gölbaşı');
  assert.equal(records[0].rawDetails['Son Güncelleme'], '25/09/2026');
  assert.equal(records[0].rawDetails['İlan Durumu'], 'Satılık');
  assert.equal(records[0].rawDetails['Metrekare Birim Fiyatı (TL)'], '5500');
  assert.equal(records[0].rawDetails['İlgili Belediye'], 'Gölbaşı');
});

test('exported XLSX reimports price, currency, phone list, raw details and category', async () => {
  const original = land('0-4102', {price: '175.000 USD', currency: 'USD'});
  const [imported] = await transfer.importFile(workbookFile(transfer.workbookFor([original])));
  for (const key of ['id', 'listingId', 'title', 'price', 'currency', 'area', 'sellerName', 'description', 'category', 'url']) {
    assert.equal(imported[key], original[key], key);
  }
  assert.deepEqual(imported.phones, original.phones);
  assert.deepEqual(imported.rawDetails, original.rawDetails);
  assert.deepEqual(imported.location, original.location);
});

test('filtered Arsa export contains only land, excludes cars, review and deleted records', () => {
  const records = [land('0-4103'), car(), land('0-4104', {title: 'SATILIK SİTE DAİRESİ'}), {...land('0-4105'), deletedAt: '2026-09-25T09:00:00Z'}];
  const filtered = core.filterRecords(records, {category: 'arsa'});
  const wb = transfer.workbookFor(filtered);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['İlanlar']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Kategori'], 'Arsa');
  assert.equal(rows[0]['İlan No'], '0-4103');
  assert.ok(!transfer.csvText(filtered).includes('otomobil'));
});

test('XLSX export writes malicious-looking values as strings without formulas', () => {
  const original = land('0-4106', {title: '=HYPERLINK("https://example.invalid","test")', sellerName: '+SUM(1,2)', description: '@SUM(1,2)', rawDetails: {'Arsa Tipi': 'İmarlı Konut', 'Tapu Durumu': 'Müstakil Parsel', 'Ada/Parsel No': '500/7', Test: '-1+2'}});
  const wb = transfer.workbookFor([original]);
  const serialized = XLSX.write(wb, {type: 'buffer', bookType: 'xlsx'});
  const parsed = XLSX.read(serialized, {type: 'buffer', cellFormula: true});
  for (const [addr, cell] of Object.entries(parsed.Sheets['İlanlar'])) {
    if (addr.startsWith('!')) continue;
    assert.equal(cell.f, undefined, `${addr} has executable formula`);
    if (typeof cell.v === 'string') assert.equal(cell.t, 's');
  }
  const rows = XLSX.utils.sheet_to_json(parsed.Sheets['İlanlar']);
  assert.equal(rows[0]['İlan Başlığı'], original.title);
  assert.equal(rows[0]['Ad Soyad'], '+SUM(1,2)');
});

test('CSV export neutralizes formula prefixes and escapes delimiters, quotes and line breaks', () => {
  const record = land('0-4107', {title: '=1+1', sellerName: '\t+SUM(1,2)', description: '"Arsa"; örnek\nikinci satır', rawDetails: {Test: '@SUM(1,2)'}});
  record.sellerName = '\t+SUM(1,2)'; // Exercise exporter safety even for unnormalized stored text.
  const csv = transfer.csvText([record]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'\t+SUM(1,2)"'));
  assert.ok(csv.includes('"\'@SUM(1,2)"'));
  assert.ok(csv.includes('"""Arsa""; örnek\nikinci satır"'));
  const wb = XLSX.read(Buffer.from(csv), {type: 'buffer', raw: true});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['İlan Başlığı'], "'=1+1");
  assert.equal(rows[0]['İlan Açıklaması'], record.description);
});

test('JSON archive round trip preserves manual correction and review evidence', async () => {
  const manual = core.normalizeRecord({...land('0-4108', {title: 'SATILIK SİTE DAİRESİ'}), manualCategory: 'konut'});
  const review = land('0-4109', {category: 'arac'});
  const records = await transfer.importFile(jsonFile({type: 'ilan5-backup', schemaVersion: 2, records: [manual, review]}, 'yedek.json'));
  assert.equal(records[0].category, 'konut');
  assert.equal(records[0].classification.status, 'manual');
  assert.equal(records[1].archiveStatus, 'review');
  assert.deepEqual(records[1].classification.evidence, review.classification.evidence);
});

test('import reports duplicates and invalid rows, keeping final duplicate', () => {
  const records = transfer.normalizeImported([land('0-4111', {price: 6000000}), null, {}, land('0-4111', {price: 7000000})]);
  assert.equal(records.length, 1);
  assert.equal(records[0].price, 7000000);
  assert.deepEqual(records.importSummary, {total: 4, valid: 1, invalid: 2, duplicates: 1, review: 0});
});

test('XLSX import chooses İlanlar sheet even when summary sheet is first', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Alan','Değer'],['Kayıt',1]]), 'Özet');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(transfer.exportRows([land('0-4112')])), 'İlanlar');
  const records = await transfer.importFile(workbookFile(wb));
  assert.equal(records.length, 1);
  assert.equal(records[0].listingId, '0-4112');
});

test('empty exports and invalid or oversized imports fail clearly', async () => {
  assert.throws(() => transfer.workbookFor([]), /kayıt yok/);
  assert.throws(() => transfer.csvText([]), /kayıt yok/);
  await assert.rejects(transfer.importFile({name: 'huge.json', size: 51 * 1024 * 1024}), /50 MB/);
  await assert.rejects(transfer.importFile({name: 'unknown.exe', size: 4}), /JSON, XLSX veya CSV/);
  await assert.rejects(transfer.importFile({name: 'bad.json', size: 4, text: async () => '{bad'}), /JSON dosyası okunamadı/);
});

test('JSON market backup preserves memberships and normalizes events through export, import and DB dedup', async () => {
  const original = land('0-4150', {market: {searchIds: ['search-one', 'search-one', 'search-two'], firstObservedAt: '2026-09-25T08:00:00Z', lastSeenAt: '2026-09-25T09:00:00Z'}});
  const event = {id: 'price-up-export-event', type: 'price_up', recordId: original.id, listingId: original.listingId, title: original.title, url: original.url, category: original.category, source: original.source, searchIds: ['search-one', 'search-one'], at: '2026-09-25T09:00:00Z', oldPrice: 5000000, newPrice: 5500000, currency: 'TRY', delta: 999, percent: 999, token: 'MUST_NOT_LEAK'};
  const blobs = [];
  const context = vm.createContext({IlanCore: core, Blob, URL: {createObjectURL: blob => {blobs.push(blob); return 'blob:test';}, revokeObjectURL(){}}, document: {createElement: () => ({click(){},remove(){}}), body: {append(){}}}, setTimeout: () => 0, module: {exports: {}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'transfer.js'), 'utf8'), context);
  context.module.exports.exportBackup([original], {events: [event, event]});
  const text = await blobs[0].text();
  assert.ok(!text.includes('MUST_NOT_LEAK'));
  const payload = JSON.parse(text);
  assert.equal(payload.events[0].delta, 500000); assert.equal(payload.events[0].percent, 10);
  const imported = await transfer.importFile({name: 'market-backup.json', size: Buffer.byteLength(text), text: async () => text});
  assert.deepEqual(imported[0].market, original.market);
  assert.equal(imported.marketEvents.length, 2);
  assert.deepEqual(imported.marketEvents[0].searchIds, ['search-one']);
  assert.equal(imported.marketEvents[0].delta, 500000);

  const dbContext = vm.createContext({IlanCore: core, indexedDB: new IDBFactory(), module: {exports: {}}, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8'), dbContext);
  const db = dbContext.module.exports;
  await db.upsertMany(imported);
  assert.equal((await db.getEvents({limit: 0})).length, 0, 'record import alone does not create live market events');
  const restored = await db.importEvents(imported.marketEvents);
  assert.equal(restored.saved, 1); assert.equal(restored.added, 1);
  const repeated = await db.importEvents(imported.marketEvents);
  assert.equal(repeated.added, 0); assert.equal(repeated.existing, 1);
  const saved = await db.get(original.id);
  assert.deepEqual(saved.market, original.market);
  const events = await db.getEvents({limit: 0});
  assert.equal(events.length, 1); assert.equal(events[0].id, event.id); assert.equal(events[0].delta, 500000);
});

test('JSON market import rejects invalid event structure, type, time and contradictory price direction', async () => {
  const r = land('0-4151');
  const valid = {id: 'valid-event', type: 'price_up', recordId: r.id, at: '2026-09-25T09:00:00Z', oldPrice: 5000000, newPrice: 5500000};
  await assert.rejects(transfer.importFile(jsonFile({records: [r], events: {id: 'not-an-array'}})), /hareket geçmişi bir liste/);
  for (const bad of [{...valid, type: 'arbitrary'}, {...valid, at: 'not-a-date'}, {...valid, recordId: ''}, {...valid, newPrice: 4500000}]) {
    await assert.rejects(transfer.importFile(jsonFile({records: [r], events: [bad]})), /geçersiz ilan hareketi/);
  }
});
