import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFilters, matchesFilters } from '../src/filters.js';
import { makeTrip } from '../src/trip.js';

const trip = (over) =>
  makeTrip({ provider: 'obilet', mode: 'bus', company: 'Kamil Koç', from: 'İstanbul', to: 'Ankara', departure: '2026-11-01T08:30', arrival: '2026-11-01T14:00', price: 800, seatsAvailable: 10, ...over });

test('durum filtresi dolu ve müsait seferleri ayırır', () => {
  const full = trip({ seatsAvailable: 0 });
  const open = trip({ departure: '2026-11-01T09:00' });
  assert.equal(full.soldOut, true);
  assert.deepEqual(applyFilters([full, open], { status: 'available' }), [open]);
  assert.deepEqual(applyFilters([full, open], { status: 'soldout' }), [full]);
  assert.equal(applyFilters([full, open], { status: 'all' }).length, 2);
});

test('fiyat, saat, süre, firma, koltuk ve site filtreleri', () => {
  const t = trip();
  assert.equal(matchesFilters(t, { priceMax: 700 }), false);
  assert.equal(matchesFilters(t, { priceMin: 700, priceMax: 900 }), true);
  assert.equal(matchesFilters(t, { departAfter: '09:00' }), false);
  assert.equal(matchesFilters(t, { departBefore: '08:30' }), true);
  assert.equal(matchesFilters(t, { maxDurationMin: 300 }), false);
  assert.equal(matchesFilters(t, { company: 'KAMİL' }), true);
  assert.equal(matchesFilters(t, { company: 'varan' }), false);
  assert.equal(matchesFilters(t, { minSeats: 11 }), false);
  assert.equal(matchesFilters(t, { providers: ['enuygun'] }), false);
});

test('sıralama fiyata göre çalışır', () => {
  const a = trip({ price: 900 });
  const b = trip({ price: 500, departure: '2026-11-01T22:00' });
  assert.deepEqual(applyFilters([a, b], { sort: 'price' }).map((t) => t.price), [500, 900]);
  assert.deepEqual(applyFilters([b, a], { sort: 'departure' }).map((t) => t.price), [900, 500]);
});
