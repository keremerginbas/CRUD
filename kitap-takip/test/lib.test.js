const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib.js');

const D = 86400000;
const now = new Date('2026-11-11T12:00:00').getTime();
const snap = (targetId, daysAgo, extra) => ({ targetId, ts: now - daysAgo * D, ...extra });

test('stok tükenip yenilenince iki olay üretir', () => {
  const ev = lib.deriveEvents([
    snap('a', 3, { status: 'in_stock' }),
    snap('a', 2, { status: 'out_of_stock' }),
    snap('a', 1, { status: 'in_stock' }),
  ]);
  assert.deepStrictEqual(ev.map((e) => [e.field, e.from, e.to]), [
    ['status', 'out_of_stock', 'in_stock'],
    ['status', 'in_stock', 'out_of_stock'],
  ]);
});

test('okunamayan taramalar sahte değişiklik üretmez', () => {
  const ev = lib.deriveEvents([
    snap('a', 3, { status: 'in_stock', price: 150 }),
    snap('a', 2, { status: 'blocked' }),
    snap('a', 1, { status: 'in_stock', price: 150 }),
  ]);
  assert.strictEqual(ev.length, 0);
});

test('fiyat, adet ve baskı değişiklikleri yakalanır; siteler karışmaz', () => {
  const ev = lib.deriveEvents([
    snap('a', 2, { status: 'in_stock', price: 150, stockQty: 8, edition: 1 }),
    snap('b', 2, { status: 'in_stock', price: 100 }),
    snap('a', 1, { status: 'in_stock', price: 127.5, stockQty: 3, edition: 2 }),
    snap('b', 1, { status: 'in_stock', price: 100 }),
  ]);
  assert.deepStrictEqual(ev.map((e) => `${e.targetId}:${e.field}`).sort(), ['a:edition', 'a:price', 'a:stockQty']);
});

test('gün şeridi boş günleri null bırakır ve okunabilir kaydı tercih eder', () => {
  const strip = lib.dayStrip([
    snap('a', 2, { status: 'in_stock' }),
    { targetId: 'a', ts: now - 3600000, status: 'out_of_stock' },
    { targetId: 'a', ts: now - 60000, status: 'blocked' },
  ], 'a', 4, now);
  assert.deepStrictEqual(strip.map((d) => d.snapshot && d.snapshot.status), [null, 'in_stock', null, 'out_of_stock']);
});

test('CSV başlık ve Türkçe durum etiketi içerir', () => {
  const csv = lib.toCsv([snap('a', 1, { status: 'out_of_stock', price: 150, note: 'a, b' })], [{ id: 'a', name: 'Site A' }]);
  const [head, row] = csv.replace('﻿', '').split('\n');
  assert.ok(head.startsWith('ts,site,status'));
  assert.ok(row.includes('Site A,Tükendi'));
  assert.ok(row.includes('"a, b"'));
});
