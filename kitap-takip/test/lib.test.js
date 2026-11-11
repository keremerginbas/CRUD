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

test('satış işaretleri: stoktan düşen, giren, tükenme, sıralama sıçraması ve satış sayacı', () => {
  const since = now - 30 * D;
  const sig = lib.salesSignals([
    snap('a', 40, { status: 'in_stock', stockQty: 9 }), // pencere dışı: yalnızca başlangıç değeri
    snap('a', 6, { status: 'in_stock', stockQty: 5, rank: 90000, soldCount: 10, reviewCount: 2 }),
    snap('a', 5, { status: 'in_stock', stockQty: 3, rank: 40000, soldCount: 12, reviewCount: 2 }),
    snap('a', 4, { status: 'blocked' }),
    snap('a', 3, { status: 'out_of_stock', stockQty: 0, rank: 52000, soldCount: 15, reviewCount: 3 }),
    snap('a', 2, { status: 'in_stock', stockQty: 10, rank: 60000, soldCount: 15, reviewCount: 3 }),
    snap('b', 2, { status: 'in_stock', stockQty: 1 }),
  ], 'a', since);
  assert.strictEqual(sig.stockDrop, 4 + 2 + 3); // 9→5, 5→3, 3→0
  assert.strictEqual(sig.stockRise, 10);
  assert.strictEqual(sig.soldOut, 1);
  assert.strictEqual(sig.restocked, 1);
  assert.strictEqual(sig.rankJumps, 1);
  assert.strictEqual(sig.soldGain, 5);
  assert.strictEqual(sig.soldCount, 15);
  assert.strictEqual(sig.reviewGain, 1);
  assert.strictEqual(sig.hasRealStock, true);
});

test('yer tutucu stok değerleri satış işareti üretmez', () => {
  const sig = lib.salesSignals([
    snap('a', 3, { status: 'on_order', stockQty: 100, stockQtyPlaceholder: true }),
    snap('a', 2, { status: 'on_order', stockQty: 999999, stockQtyPlaceholder: true }),
  ], 'a', now - 30 * D);
  assert.strictEqual(sig.hasRealStock, false);
  assert.strictEqual(sig.stockDrop, 0);
  assert.strictEqual(lib.deriveEvents([
    snap('a', 3, { status: 'on_order', stockQty: 100, stockQtyPlaceholder: true }),
    snap('a', 2, { status: 'on_order', stockQty: 999999, stockQtyPlaceholder: true }),
  ]).length, 0);
});

test('sıralamadaki küçük oynamalar olay üretmez, belirgin yükseliş üretir', () => {
  const ev = lib.deriveEvents([
    snap('a', 4, { status: 'in_stock', rank: 60000 }),
    snap('a', 3, { status: 'in_stock', rank: 61500 }),
    snap('a', 2, { status: 'in_stock', rank: 58000 }),
    snap('a', 1, { status: 'in_stock', rank: 30000 }),
  ]);
  assert.deepStrictEqual(ev.map((e) => [e.field, e.from, e.to]), [['rank', 58000, 30000]]);
});

// --- Bir taramanın ürettiği yeni olaylar (bildirim için) ---

test('yeni olaylar yalnızca son okumanın getirdiği değişikliklerdir', () => {
  const last = snap('a', 0, { status: 'out_of_stock', stockQty: 0 });
  const ev = lib.newEvents([
    snap('a', 3, { status: 'in_stock', stockQty: 5 }),
    snap('a', 2, { status: 'in_stock', stockQty: 2 }), // eski değişiklik: yeniden bildirilmemeli
    snap('b', 1, { status: 'in_stock', price: 100 }),
    last,
    snap('b', 0, { status: 'in_stock', price: 90 }), // başka sitenin değişikliği
  ], last);
  assert.deepStrictEqual(ev.map((e) => [e.targetId, e.field, e.from, e.to]).sort(), [['a', 'status', 'in_stock', 'out_of_stock'], ['a', 'stockQty', 2, 0]]);
});

test('okunamayan son tarama yeni olay üretmez', () => {
  const last = snap('a', 0, { status: 'blocked' });
  assert.deepStrictEqual(lib.newEvents([snap('a', 1, { status: 'in_stock', price: 100 }), last], last), []);
});

test('olay açıklamaları: yeni baskı ve yeniden stok', () => {
  assert.strictEqual(lib.describeEvent({ field: 'edition', from: 1, to: 2 }), '2. baskı göründü (önceki: 1. baskı)');
  assert.strictEqual(lib.describeEvent({ field: 'status', from: 'out_of_stock', to: 'in_stock' }), 'Yeniden stokta (önceki durum: Tükendi)');
  assert.strictEqual(lib.describeEvent({ field: 'price', from: 105, to: 97.5 }), 'Fiyat: 105 → 97,5');
});
