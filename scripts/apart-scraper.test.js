// Çalıştırma: node --test scripts/apart-scraper.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseElements, toCsv, buildQuery } = require('./apart-scraper');

const fixture = [
  { type: 'node', id: 1, tags: { tourism: 'apartment', name: 'Deniz Apart', phone: '+90 242 111 22 33;+90 532 000 00 00' } },
  { type: 'area', id: 3600000001, tags: { boundary: 'administrative', admin_level: '4', name: 'Antalya' } },
  { type: 'area', id: 3600000002, tags: { boundary: 'administrative', admin_level: '6', name: 'Alanya' } },
  { type: 'area', id: 3600000003, tags: { boundary: 'administrative', admin_level: '10', name: 'Kleopatra Mahallesi' } },
  { type: 'way', id: 2, center: { lat: 0, lon: 0 }, tags: { tourism: 'hotel', name: 'Güneş Apart Otel', 'contact:phone': '0252 444 55 66', 'addr:suburb': 'Bitez' } },
  { type: 'area', id: 3600000004, tags: { boundary: 'administrative', admin_level: '4', name: 'Muğla İli' } },
  { type: 'area', id: 3600000005, tags: { boundary: 'administrative', admin_level: '6', name: 'Bodrum' } },
  { type: 'node', id: 3, tags: { tourism: 'apartment', name: 'Ada Apart' } },
];

test('kayıtları il/ilçe/mahalle ile ayrıştırır', () => {
  const rows = parseElements(fixture);
  assert.strictEqual(rows.length, 3);
  const deniz = rows.find((r) => r.ad === 'Deniz Apart');
  assert.deepStrictEqual(deniz, {
    ad: 'Deniz Apart',
    telefon: '+90 242 111 22 33 / +90 532 000 00 00',
    il: 'Antalya',
    ilce: 'Alanya',
    mahalle: 'Kleopatra Mahallesi',
  });
  const gunes = rows.find((r) => r.ad === 'Güneş Apart Otel');
  assert.strictEqual(gunes.il, 'Muğla');
  assert.strictEqual(gunes.ilce, 'Bodrum');
  assert.strictEqual(gunes.mahalle, 'Bitez');
  assert.strictEqual(gunes.telefon, '0252 444 55 66');
  const ada = rows.find((r) => r.ad === 'Ada Apart');
  assert.strictEqual(ada.telefon, '');
});

test('CSV başlığı ve kaçış', () => {
  const csv = toCsv([{ ad: 'A, "B" Apart', telefon: '1', il: 'X', ilce: 'Y', mahalle: 'Z' }]);
  assert.ok(csv.startsWith('﻿Apart Adı,Telefon,İl,İlçe,Mahalle'));
  assert.ok(csv.includes('"A, ""B"" Apart",1,X,Y,Z'));
});

test('il filtresi sorguya eklenir', () => {
  assert.match(buildQuery({ il: 'Antalya' }), /"name"="Antalya"/);
  assert.match(buildQuery({ il: null }), /ISO3166-1/);
});
