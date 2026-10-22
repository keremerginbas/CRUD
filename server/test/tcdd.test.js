import assert from 'node:assert/strict';
import test from 'node:test';
import { findStations, matchStation, parseTcddResponse, createTcddProvider } from '../src/providers/tcdd.js';

const STATIONS = [
  { id: 1, name: 'ANKARA GAR' },
  { id: 2, name: 'İSTANBUL(PENDİK)' },
  { id: 3, name: 'İSTANBUL(SÖĞÜTLÜÇEŞME)' },
  { id: 4, name: 'ESKİŞEHİR' },
  { id: 5, name: 'KONYA' },
  ...Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, name: `DURAK ${i}` })),
];

const ms = (h, m) => Date.UTC(2026, 10, 1, h - 3, m);
const RESPONSE = {
  trainLegs: [
    {
      trainAvailabilities: [
        {
          trains: [
            {
              name: 'YHT 81004',
              type: 'YHT',
              segments: [{ departureTime: ms(6, 0), arrivalTime: ms(8, 0) }, { departureTime: ms(8, 5), arrivalTime: ms(10, 25) }],
              availableFareInfo: [{ cabinClasses: [{ availabilityCount: 0, minPrice: 900 }, { availabilityCount: 4, minPrice: 1400 }] }],
            },
          ],
        },
        {
          trains: [
            {
              name: 'YHT 81012',
              type: 'YHT',
              segments: [{ departureTime: ms(18, 30), arrivalTime: ms(22, 50) }],
              availableFareInfo: [{ cabinClasses: [{ availabilityCount: 0, minPrice: 780 }] }],
              minPrice: { priceAmount: 780 },
            },
          ],
        },
      ],
    },
  ],
};

test('istasyon listesini bulur ve şehir adını istasyona eşler', () => {
  assert.equal(findStations({ data: { stations: STATIONS } }).length, STATIONS.length);
  const aliases = { istanbul: 'İSTANBUL(SÖĞÜTLÜÇEŞME)' };
  assert.equal(matchStation('İstanbul', STATIONS, aliases).id, 3);
  assert.equal(matchStation('ankara', STATIONS).id, 1);
  assert.equal(matchStation('Pendik', STATIONS).id, 2);
  assert.equal(matchStation('Eskişehir', STATIONS).id, 4);
  assert.equal(matchStation('Van', STATIONS), null);
});

test('TCDD yanıtından sefer, aktarmalı varış, fiyat ve dolu durumunu çıkarır', () => {
  const trips = parseTcddResponse(RESPONSE, { from: 'Ankara', to: 'İstanbul', date: '2026-11-01', url: 'u' });
  assert.equal(trips.length, 2);
  const [morning, evening] = trips;
  assert.equal(morning.mode, 'train');
  assert.equal(morning.departure, '2026-11-01T06:00');
  assert.equal(morning.arrival, '2026-11-01T10:25');
  assert.equal(morning.durationMin, 265);
  assert.equal(morning.price, 1400, 'dolu sınıfın fiyatı değil, boş olanın fiyatı');
  assert.equal(morning.seatsAvailable, 4);
  assert.equal(morning.soldOut, false);
  assert.equal(morning.company, 'YHT YHT 81004');
  assert.equal(evening.soldOut, true);
  assert.equal(evening.price, 780);
});

test('sağlayıcı oturumu açar, istasyonları eşler ve doğru sorguyu gönderir', async () => {
  const bodies = [];
  let opened = 0;
  const provider = createTcddProvider(
    'tcdd',
    { name: 'TCDD', homeUrl: 'h', stationAliases: { istanbul: 'İSTANBUL(SÖĞÜTLÜÇEŞME)' } },
    {
      openSession: async () => {
        opened += 1;
        return { stations: STATIONS, at: Date.now(), query: async (body) => (bodies.push(body), RESPONSE) };
      },
    },
  );
  assert.deepEqual(await provider.search({ mode: 'bus', from: 'a', to: 'b', date: '2026-11-01' }), []);
  const trips = await provider.search({ mode: 'train', from: 'Ankara', to: 'İstanbul', date: '2026-11-01' });
  await provider.search({ mode: 'train', from: 'Ankara', to: 'Konya', date: '2026-11-01' });
  assert.equal(trips.length, 2);
  assert.equal(opened, 1, 'oturum yeniden kullanılır');
  assert.deepEqual(bodies[0].searchRoutes[0], {
    departureStationId: 1,
    departureStationName: 'ANKARA GAR',
    arrivalStationId: 3,
    arrivalStationName: 'İSTANBUL(SÖĞÜTLÜÇEŞME)',
    departureDate: '01-11-2026 00:00:00',
  });
  await assert.rejects(provider.search({ mode: 'train', from: 'Ankara', to: 'Van', date: '2026-11-01' }), /istasyonu bulunamadı/);
});
