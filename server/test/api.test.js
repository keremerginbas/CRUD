import assert from 'node:assert/strict';
import test from 'node:test';
import { createAggregator } from '../src/aggregator.js';
import { createApp } from '../src/app.js';
import { createProviders } from '../src/providers/index.js';
import { createStore } from '../src/store.js';
import { createWatcher } from '../src/watcher.js';

test('demo modunda arama, filtre ve alarm uç noktaları', async (t) => {
  const aggregator = createAggregator(createProviders('demo'));
  const store = createStore(null);
  const watcher = createWatcher({ store, aggregator });
  const server = createApp({ aggregator, watcher, store }).listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const providers = await (await fetch(`${base}/providers`)).json();
  assert.deepEqual(providers.map((p) => p.id), ['obilet', 'enuygun', 'ucuzabilet', 'skyscanner']);

  const bus = await (await fetch(`${base}/search?mode=bus&from=İstanbul&to=Ankara&date=2026-11-01`)).json();
  assert.deepEqual([...new Set(bus.trips.map((t) => t.provider))].sort(), ['enuygun', 'obilet']);

  const flight = await (await fetch(`${base}/search?mode=flight&from=IST&to=ESB&date=2026-11-01&status=available&sort=price`)).json();
  assert.ok(flight.trips.length > 0);
  assert.ok(flight.trips.every((t) => !t.soldOut));
  assert.deepEqual(flight.trips.map((t) => t.price), [...flight.trips.map((t) => t.price)].sort((a, b) => a - b));

  const bad = await fetch(`${base}/search?mode=bus&from=a&to=b&date=yarın`);
  assert.equal(bad.status, 400);

  const created = await fetch(`${base}/watches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'bus', from: 'İstanbul', to: 'Ankara', date: '2026-11-01', filters: { priceMax: 1200 } }),
  });
  assert.equal(created.status, 201);
  const watch = await created.json();
  assert.equal(watch.snapshot, undefined);
  assert.ok(watch.lastCheckedAt);
  assert.equal((await (await fetch(`${base}/watches`)).json()).length, 1);
  assert.equal((await fetch(`${base}/watches/${watch.id}`, { method: 'DELETE' })).status, 204);
});

test('asistan uç noktası cümleden arama yapar ve öneri döndürür', async (t) => {
  const { createAssistant } = await import('../src/ai.js');
  const aggregator = createAggregator(createProviders('demo'));
  const store = createStore(null);
  const assistant = createAssistant({ apiKey: '' });
  const server = createApp({ aggregator, watcher: createWatcher({ store, aggregator }), store, assistant }).listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const health = await (await fetch(`${base}/health`)).json();
  assert.deepEqual(health, { ok: true, ai: false, demo: true });

  const res = await fetch(`${base}/ai/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: "Yarın İstanbul'dan Ankara'ya akşam en ucuz otobüs, boşalırsa haber ver" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.request.from, 'İstanbul');
  assert.equal(body.request.watch, true);
  assert.ok(body.trips.every((trip) => trip.departure.slice(11, 16) >= '17:00'));
  assert.deepEqual(body.trips.map((trip) => trip.price), [...body.trips.map((trip) => trip.price)].sort((a, b) => a - b));
  assert.ok(body.advice.text.length > 0);
});
