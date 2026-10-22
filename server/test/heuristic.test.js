import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTrips, parseDateTime } from '../src/providers/heuristic.js';
import { buildUrl, resolvePlace } from '../src/providers/sites.js';

const ctx = { provider: 'x', providerName: 'X', mode: 'bus', from: 'İstanbul', to: 'Ankara', date: '2026-11-01', url: 'u' };

test('farklı tarih biçimlerini Türkiye saatine çevirir', () => {
  assert.equal(parseDateTime('2026-11-01T08:30:00'), '2026-11-01T08:30');
  assert.equal(parseDateTime('2026-11-01T05:30:00Z'), '2026-11-01T08:30');
  assert.equal(parseDateTime('01.11.2026 08:30'), '2026-11-01T08:30');
  assert.equal(parseDateTime(`/Date(${Date.UTC(2026, 10, 1, 5, 30)})/`), '2026-11-01T08:30');
  assert.equal(parseDateTime('merhaba'), null);
});

test('iç içe JSON yanıtlarından seferleri, dolu durumunu ve fiyatı çıkarır', () => {
  const json = {
    data: {
      journeys: [
        { partnerName: 'Metro', journey: { departure: '2026-11-01T10:00:00', arrival: '2026-11-01T16:00:00', internetPrice: '1.250,50 TL' }, availableSeats: 4 },
        { partnerName: 'Varan', journey: { departure: '2026-11-01T23:00:00' }, price: { amount: 900 }, availableSeats: 0 },
        { company: 'Pamukkale', departureTime: '2026-11-01T12:00:00', price: 700, isAvailable: false },
        { company: 'Başka gün', departureTime: '2026-11-02T12:00:00', price: 700 },
      ],
    },
  };
  const trips = extractTrips(json, ctx);
  assert.equal(trips.length, 3);
  const [metro, varan, pamukkale] = trips;
  assert.equal(metro.company, 'Metro');
  assert.equal(metro.price, 1250.5);
  assert.equal(metro.durationMin, 360);
  assert.equal(metro.seatsAvailable, 4);
  assert.equal(metro.soldOut, false);
  assert.equal(varan.price, 900);
  assert.equal(varan.soldOut, true);
  assert.equal(pamukkale.soldOut, true);
});

test('adres şablonlarını ve şehir kodlarını doldurur', () => {
  assert.equal(resolvePlace('IST', { cityFormat: 'iata' }), 'ist');
  assert.equal(resolvePlace('İstanbul', { cityFormat: 'slug' }), 'istanbul');
  assert.equal(resolvePlace('İstanbul', { cityFormat: 'id', cities: { istanbul: 349 } }), '349');
  assert.throws(() => resolvePlace('Ankara', { cityFormat: 'id', cities: {} }));
  assert.equal(
    buildUrl('https://x/{from}/{to}/{dateYYMMDD}?d={dateTR}&i={date}', { from: 'ist', to: 'esb', date: '2026-11-05' }),
    'https://x/ist/esb/261105?d=05.11.2026&i=2026-11-05',
  );
});
