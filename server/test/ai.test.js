import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistant, parseRequestRules } from '../src/ai.js';
import { makeTrip } from '../src/trip.js';

const NOW = Date.UTC(2026, 9, 22, 9, 0); // 22 Ekim 2026, 12:00 TR

test('kural tabanlı ayrıştırıcı otobüs isteğini anlar', () => {
  const r = parseRequestRules("Yarın akşam 18-23 arası İstanbul'dan Ankara'ya 1000 TL altı en ucuz otobüs, dolu olan boşalırsa haber ver", NOW);
  assert.equal(r.mode, 'bus');
  assert.equal(r.from, 'İstanbul');
  assert.equal(r.to, 'Ankara');
  assert.equal(r.date, '2026-10-23');
  assert.equal(r.filters.departAfter, '18:00');
  assert.equal(r.filters.departBefore, '23:00');
  assert.equal(r.filters.priceMax, 1000);
  assert.equal(r.filters.sort, 'price');
  assert.equal(r.watch, true);
});

test('kural tabanlı ayrıştırıcı uçuş ve tarih adını anlar', () => {
  const r = parseRequestRules('5 kasım sabah İzmir Antalya uçak bileti 2 kişi', NOW);
  assert.equal(r.mode, 'flight');
  assert.equal(r.from, 'ADB');
  assert.equal(r.to, 'AYT');
  assert.equal(r.date, '2026-11-05');
  assert.deepEqual([r.filters.departAfter, r.filters.departBefore], ['06:00', '12:00']);
  assert.equal(r.filters.minSeats, 2);
  assert.equal(r.watch, false);
});

test('anahtar yoksa yedek kullanılır, varsa OpenAI yanıtı işlenir', async () => {
  const offline = createAssistant({ apiKey: '', now: () => NOW });
  assert.equal((await offline.parseRequest('yarın İstanbul Ankara otobüs')).source, 'rules');

  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    const content = JSON.stringify({ mode: 'flight', from: 'IST', to: 'ESB', date: '2026-10-30', filters: { priceMax: 2000, departAfter: null, sort: 'price' }, watch: true });
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  const ai = createAssistant({ apiKey: 'test-key', model: 'm', fetchImpl: fakeFetch, now: () => NOW });
  const r = await ai.parseRequest('30 ekim istanbul ankara uçak 2000 altı');
  assert.equal(r.source, 'ai');
  assert.deepEqual(r.filters, { status: 'all', sort: 'price', priceMax: 2000 });
  assert.equal(r.watch, true);
  assert.equal(calls[0].auth, 'Bearer test-key');
  assert.equal(calls[0].body.response_format.type, 'json_object');
});

test('OpenAI hata verirse öneri kural tabanlı yapılır', async () => {
  const ai = createAssistant({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'kota' }) });
  const trips = [
    makeTrip({ provider: 'obilet', providerName: 'obilet', mode: 'bus', company: 'Metro', from: 'A', to: 'B', departure: '2026-11-01T10:00', price: 900, seatsAvailable: 3 }),
    makeTrip({ provider: 'enuygun', providerName: 'Enuygun', mode: 'bus', company: 'Varan', from: 'A', to: 'B', departure: '2026-11-01T11:00', price: 700, seatsAvailable: 0 }),
  ];
  const r = await ai.recommend(trips);
  assert.equal(r.source, 'rules');
  assert.match(r.text, /En ucuz: 10:00 Metro \(obilet\) – 900 TRY/);
  assert.match(r.text, /1 sefer dolu/);
});

test('kural tabanlı ayrıştırıcı YHT isteğini tren olarak anlar', () => {
  const r = parseRequestRules('Yarın sabah Ankara İstanbul YHT bileti, dolu olan boşalırsa haber ver', NOW);
  assert.equal(r.mode, 'train');
  assert.equal(r.from, 'Ankara');
  assert.equal(r.to, 'İstanbul');
  assert.equal(r.watch, true);
});
