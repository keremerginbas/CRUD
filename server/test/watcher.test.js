import assert from 'node:assert/strict';
import test from 'node:test';
import { createAggregator } from '../src/aggregator.js';
import { createStore } from '../src/store.js';
import { makeTrip } from '../src/trip.js';
import { createWatcher, diffTrips, snapshotOf } from '../src/watcher.js';

const trip = (over) =>
  makeTrip({ provider: 'obilet', providerName: 'obilet', mode: 'bus', company: 'Metro', from: 'İstanbul', to: 'Ankara', departure: '2026-11-01T08:30', price: 800, seatsAvailable: 5, ...over });

test('dolu → boş, boş → dolu, koltuk artışı, fiyat düşüşü ve yeni sefer olayları', () => {
  const freed = trip({ departure: '2026-11-01T01:00', seatsAvailable: 0 });
  const filling = trip({ departure: '2026-11-01T02:00', seatsAvailable: 3 });
  const seats = trip({ departure: '2026-11-01T03:00', seatsAvailable: 2 });
  const cheaper = trip({ departure: '2026-11-01T04:00', price: 1000 });
  const prev = snapshotOf([freed, filling, seats, cheaper]);

  const now = [
    trip({ departure: '2026-11-01T01:00', seatsAvailable: 2 }),
    trip({ departure: '2026-11-01T02:00', seatsAvailable: 0 }),
    trip({ departure: '2026-11-01T03:00', seatsAvailable: 6 }),
    trip({ departure: '2026-11-01T04:00', price: 900 }),
    trip({ departure: '2026-11-01T05:00' }),
  ];
  assert.deepEqual(diffTrips(prev, now, {}).map((c) => c.type), ['freed', 'soldout', 'seats_up', 'price_drop', 'new']);
  assert.deepEqual(diffTrips(null, now, {}), [], 'ilk kontrol sadece referans alır');
  assert.deepEqual(diffTrips(prev, now, { departAfter: '03:00' }).map((c) => c.type), ['seats_up', 'price_drop', 'new']);
  assert.deepEqual(diffTrips(prev, now, {}, { notifyOn: ['freed'] }).map((c) => c.type), ['freed']);
  assert.deepEqual(diffTrips(prev, now, { minSeats: 3 }).map((c) => c.type), ['soldout', 'seats_up', 'price_drop', 'new']);
});

test('alarm motoru değişiklikte olay kaydeder ve bildirim gönderir', async () => {
  let seats = 0;
  const provider = { id: 'obilet', name: 'obilet', modes: ['bus'], search: async () => [trip({ seatsAvailable: seats })] };
  const store = createStore(null);
  const sent = [];
  const watcher = createWatcher({
    store,
    aggregator: createAggregator([provider], { cacheTtlMs: 0 }),
    notify: async (e) => sent.push(e),
  });
  const watch = watcher.create({ mode: 'bus', from: 'İstanbul', to: 'Ankara', date: '2026-11-01' });
  assert.deepEqual(await watcher.check(watch), []);

  seats = 3;
  const events = await watcher.check(store.getWatch(watch.id));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'freed');
  assert.match(events[0].message, /3 boş koltuk/);
  assert.equal(sent.length, 1);
  assert.equal(store.listEvents().length, 1);
});

test('hata veren sağlayıcının eski verisi korunur, seferler "yeni" sanılmaz', async () => {
  let fail = false;
  const provider = {
    id: 'obilet',
    name: 'obilet',
    modes: ['bus'],
    search: async () => {
      if (fail) throw new Error('engellendi');
      return [trip({})];
    },
  };
  const store = createStore(null);
  const watcher = createWatcher({ store, aggregator: createAggregator([provider], { cacheTtlMs: 0 }) });
  const watch = watcher.create({ mode: 'bus', from: 'İstanbul', to: 'Ankara', date: '2026-11-01' });
  await watcher.check(watch);
  fail = true;
  await watcher.check(store.getWatch(watch.id));
  assert.match(store.getWatch(watch.id).lastError, /engellendi/);
  fail = false;
  assert.deepEqual(await watcher.check(store.getWatch(watch.id)), []);
});
