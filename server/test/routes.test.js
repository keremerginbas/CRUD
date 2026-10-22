import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeocoder } from '../src/geo.js';
import { createRouter, extractHighways, mapLinks } from '../src/routes.js';

const offline = async () => {
  throw new Error('ağ yok');
};

test('OSRM adımlarından otoyol ve devlet yollarını sırayla çıkarır', () => {
  const steps = [
    { name: 'Çevre Yolu', ref: 'D 100', distance: 12000 },
    { name: 'Anadolu Otoyolu', ref: 'O-4;E 80', distance: 300000 },
    { name: 'Ara sokak', ref: '', distance: 800 },
    { name: 'Kuzey Marmara Otoyolu', ref: '', distance: 40000 },
    { name: '', ref: 'D-100', distance: 1000 },
  ];
  const roads = extractHighways(steps);
  assert.deepEqual(
    roads.map((r) => [r.ref, r.type, r.km]),
    [
      ['D-100', 'Devlet yolu', 13],
      ['O-4', 'Otoyol (ücretli)', 300],
      ['E-80', 'Avrupa yolu', 300],
      ['Kuzey Marmara Otoyolu', 'Otoyol (ücretli)', 40],
    ],
  );
  assert.equal(roads[1].name, 'Anadolu Otoyolu');
});

test('Google Maps ve Yandex Maps bağlantıları', () => {
  const links = mapLinks({ lat: 41, lon: 29 }, { lat: 39.9, lon: 32.8 }, 'bus');
  assert.equal(links.google, 'https://www.google.com/maps/dir/?api=1&origin=41%2C29&destination=39.9%2C32.8&travelmode=driving');
  assert.equal(links.yandex, 'https://yandex.com.tr/harita/?rtext=41,29~39.9,32.8&rtt=auto');
  assert.match(mapLinks({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, 'train').yandex, /rtt=mt$/);
});

test('karayolu rotası OSRM yanıtından mesafe, süre ve otoyolları döndürür', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({
        routes: [
          {
            distance: 452300,
            duration: 16200,
            geometry: { coordinates: [[28.97, 41.0], [30.5, 40.7], [32.85, 39.93]] },
            legs: [{ steps: [{ name: 'Anadolu Otoyolu', ref: 'O-4', distance: 350000 }] }],
          },
        ],
      }),
    };
  };
  const route = await createRouter({ fetchImpl, osrmUrl: 'http://osrm' })({ from: 'İstanbul', to: 'Ankara', mode: 'bus' });
  assert.match(calls[0], /^http:\/\/osrm\/route\/v1\/driving\/28.9784,41.0082;32.8597,39.9334\?/);
  assert.equal(route.distanceKm, 452);
  assert.equal(route.driveMin, 270);
  assert.equal(route.straight, false);
  assert.deepEqual(route.geometry[0], [41.0, 28.97]);
  assert.equal(route.highways[0].ref, 'O-4');
});

test('servis yoksa veya uçuşta kuş uçuşu düz çizgiye düşer', async () => {
  const router = createRouter({ fetchImpl: offline });
  const bus = await router({ from: 'İstanbul', to: 'Ankara', mode: 'bus' });
  assert.equal(bus.straight, true);
  assert.equal(bus.driveMin, null);
  assert.ok(bus.distanceKm > 340 && bus.distanceKm < 360, String(bus.distanceKm));
  const flight = await router({ from: 'IST', to: 'ESB', mode: 'flight' });
  assert.equal(flight.geometry.length, 2);
});

test('yerleşik tabloda olmayan yer için Nominatim kullanılır, hatada anlaşılır mesaj verilir', async () => {
  const geocode = createGeocoder({ fetchImpl: async () => ({ ok: true, json: async () => [{ lat: '40.65', lon: '35.83' }] }) });
  assert.deepEqual(await geocode('Amasya'), { name: 'Amasya', lat: 40.65, lon: 35.83 });
  await assert.rejects(createGeocoder({ fetchImpl: offline })('Bilinmeyenköy'), /konumu bulunamadı/);
  assert.equal((await createGeocoder({ fetchImpl: offline })('İstanbul (Söğütlüçeşme)')).lat, 41.0082);
});
