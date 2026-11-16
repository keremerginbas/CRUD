'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sites = require('../sites.js');
const core = require('../core.js');
const B = require('../bitrix.js');

const arsa = core.normalizeRecord({url: 'https://www.sahibinden.com/ilan/emlak-arsa-satilik-golbasi-1234567890/detay', title: 'Gölbaşı imarlı arsa', price: 6250000, area: 1250,
  location: {city: 'Ankara', district: 'Gölbaşı', neighborhood: 'İncek Mah.'}, phones: ['0532 111 22 33', '0533 444 55 66'], sellerName: 'Ali Veli Yılmaz',
  rawDetails: {'Ada/Parsel No': '120 / 5', 'Tapu Durumu': 'Müstakil Parsel', 'Kaks (Emsal)': '0,30', 'İlan Tarihi': '10 Kasım 2026'}, description: 'Yola cepheli.'});

test('arsa row uses the XRE Arsa sheet columns', () => {
  const row = B.rowFor('arsa', arsa, 0);
  assert.equal(row['AD SOYAD'], 'Ali Veli Yılmaz'); assert.equal(row['TELEFON'], '905321112233');
  assert.equal(row['ŞEHİR'], 'Ankara'); assert.equal(row['İLÇE'], 'Gölbaşı'); assert.equal(row['MAHALLE'], 'İncek Mah.');
  assert.equal(row['ADA NO'], '120'); assert.equal(row['PARSEL NO'], '5'); assert.equal(row['M2'], '1250'); assert.equal(row['M2 FİYATI'], '5000');
  assert.equal(row['KAKS EMSAL'], '0,30'); assert.equal(row['TAPU DURUMU'], 'Müstakil Parsel'); assert.equal(row['İLAN NO'], '1234567890'); assert.equal(row['FİYAT'], '6250000');
  assert.match(row['AÇIKLAMA'], /^Sahibinden ilanı: https:\/\/www\.sahibinden\.com\/ilan\//); assert.match(row['AÇIKLAMA'], /Diğer telefonlar: 905334445566/); assert.match(row['AÇIKLAMA'], /Yola cepheli\.$/);
  assert.equal(row.row_number, 2);
});
test('barter row uses the XRE Barter sheet columns and keeps the source link', () => {
  const row = B.rowFor('barter', arsa, 3);
  assert.equal(row['İlan No'], '1234567890'); assert.equal(row['İsim'], 'Ali Veli Yılmaz'); assert.equal(row['Telefon Numarası'], '905321112233');
  assert.equal(row['RESMİ İLAN LİNKİ'], arsa.url); assert.equal(row['Kaynak'], 'Sahibinden'); assert.equal(row['m²'], '1250'); assert.equal(row.row_number, 5);
});
test('webhook address: https or this computer only, never the Bitrix address', () => {
  assert.equal(B.webhookUrl('https://n8n.example.com/webhook/ilan5-arsa-x'), 'https://n8n.example.com/webhook/ilan5-arsa-x');
  assert.equal(B.webhookUrl('http://localhost:5678/webhook/x'), 'http://localhost:5678/webhook/x');
  assert.throws(() => B.webhookUrl('http://n8n.example.com/webhook/x'), /https/);
  assert.throws(() => B.webhookUrl('https://xre.bitrix24.com.tr/rest/1/abc/crm.deal.add.json'), /Bitrix adresi değil/);
  assert.equal(B.originPattern('https://n8n.example.com:8443/webhook/x'), 'https://n8n.example.com/*');
  assert.deepEqual(B.normalizeConfig({targets: {arsa: {url: 'javascript:alert(1)'}, barter: {url: 'https://a.example/webhook/b'}}}).targets, {arsa: {url: ''}, barter: {url: 'https://a.example/webhook/b'}, auto: {url: ''}});
});
test('send: chunks of five, results matched by listing number, failures reported per listing', async () => {
  const records = Array.from({length: 7}, (_, i) => ({...arsa, id: 'sahibinden:' + (100 + i), listingId: String(100 + i)}));
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (body.rows[0]['İLAN NO'] === '105') return {ok: false, status: 500, text: async () => 'boom'};
    const answers = body.rows.map(r => r['İLAN NO'] === '101' ? {'İlan No': '101', Durum: 'Zaten Var (Atlandı)', 'Deal ID': '777'} : {'İlan No': r['İLAN NO'], Durum: 'Eklendi ✅', 'Deal ID': '9' + r['İLAN NO']});
    return {ok: true, status: 200, text: async () => JSON.stringify(answers.reverse())};
  };
  const progress = [];
  const results = await B.send(fetchFn, 'https://n8n.example.com/webhook/a', 'arsa', records, {onProgress: (d, t) => progress.push(d + '/' + t)});
  assert.equal(calls.length, 2); assert.equal(calls[0].rows.length, 5); assert.equal(calls[0].target, 'arsa');
  assert.deepEqual(progress, ['5/7', '7/7']);
  assert.deepEqual(results[0], {id: 'sahibinden:100', listingId: '100', status: 'added', dealId: '9100', message: ''});
  assert.equal(results[1].status, 'duplicate'); assert.equal(results[1].dealId, '777');
  assert.equal(results[5].status, 'error'); assert.match(results[5].message, /n8n 500/);
});
test('ping expects the flow test answer, a missing address is a clear error', async () => {
  assert.equal(await B.ping(async () => ({ok: true, text: async () => '{"ok":true}'}), 'https://n8n.example.com/webhook/a', 'arsa'), true);
  await assert.rejects(B.ping(async () => ({ok: true, text: async () => '{"message":"Workflow was started"}'}), 'https://n8n.example.com/webhook/a', 'arsa'), /İlan5 akışı değil/);
  await assert.rejects(B.send(async () => ({}), '', 'arsa', [arsa]), /adresi girilmemiş/);
});
test('bitrix transfers survive normalisation; malformed entries are dropped', () => {
  const r = core.normalizeRecord({...arsa, bitrix: {arsa: {dealId: '12345', status: 'added', at: '2026-11-16T10:00:00Z'}, 'bad key!': {dealId: '1'}, barter: {dealId: ''}}});
  assert.deepEqual(Object.keys(r.bitrix), ['arsa']); assert.equal(r.bitrix.arsa.dealId, '12345');
});
test('database: setBitrix marks the record and a later crawl keeps the mark', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), {IDBFactory} = require('fake-indexeddb');
  const context = vm.createContext({IlanCore: core, indexedDB: new IDBFactory(), module: {exports: {}}, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8'), context);
  const db = context.module.exports;
  await db.upsertMany([arsa]);
  await db.setBitrix(arsa.id, 'arsa', {dealId: '55501', status: 'added'});
  await db.upsertMany([{...arsa, price: 6000000}], {origin: 'crawl', searchId: 's1'});
  const saved = await db.get(arsa.id);
  assert.equal(saved.bitrix.arsa.dealId, '55501'); assert.equal(saved.price, 6000000);
});
test('auto row uses the XRE Auto sheet headers (AD SOYAD, TELEFON, MARKA …) with every phone', () => {
  const car = core.normalizeRecord({url: 'https://www.arabam.com/ilan/sahibinden-satilik-renault-clio/temiz/44985286', title: 'Temiz Clio', price: 850000, phones: ['0530 850 11 22', '0532 111 22 33'],
    sellerName: 'Mehmet Kaya', location: {city: 'İzmir', district: 'Bornova'}, rawDetails: {Marka: 'Renault', Seri: 'Clio', Model: '1.5 dCi', Yıl: '2018', Kilometre: '120.000 km', 'Vites Tipi': 'Manuel'}});
  const row = B.rowFor('auto', car, 0);
  assert.equal(row['AD SOYAD'], 'Mehmet Kaya'); assert.equal(row['TELEFON'], '905308501122, 905321112233'); assert.equal(row['ŞEHİR'], 'İzmir');
  assert.equal(row['MARKA'], 'Renault'); assert.equal(row['SERİ'], 'Clio'); assert.equal(row['YIL'], '2018'); assert.equal(row['KM'], '120.000 km');
  assert.equal(row['İLAN NO'], '44985286'); assert.equal(row['İLAN LİNKİ'], car.url); assert.match(row['AÇIKLAMA'], /Vites: Manuel/);
});
