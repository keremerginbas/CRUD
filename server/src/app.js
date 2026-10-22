import { fileURLToPath } from 'node:url';
import express from 'express';
import { applyFilters } from './filters.js';
import { MODES } from './trip.js';
import { MIN_INTERVAL_MIN } from './watcher.js';

function list(value) {
  if (!value) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function publicWatch({ snapshot, ...watch }) {
  return watch;
}

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const LEAFLET_DIR = fileURLToPath(new URL('../node_modules/leaflet/dist/', import.meta.url));

export function createApp({ aggregator, watcher, store, assistant, router }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    // Expo web önizlemesi ve tarayıcıdan deneme için
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', (req, res) =>
    res.json({ ok: true, ai: Boolean(assistant?.enabled), demo: aggregator.providers.every((p) => p.demo) }),
  );

  // Asistan: serbest metinli isteği filtrelere çevirir, tüm sitelerde arar ve öneri yazar.
  // POST /api/ai/ask { text: "yarın akşam İstanbul Ankara 1000 TL altı otobüs" }
  app.post('/api/ai/ask', async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!assistant || !text) return res.status(400).json({ error: 'Ne aradığınızı yazın.' });
    try {
      const request = await assistant.parseRequest(text);
      if (!request.from || !request.to) {
        return res.status(422).json({ error: 'Nereden ve nereye gideceğinizi anlayamadım.', request });
      }
      const result = await aggregator.search({ ...request, providers: [] });
      const trips = applyFilters(result.trips, request.filters);
      const advice = await assistant.recommend(trips, text);
      res.json({ request, ...result, trips, advice });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /api/route?from=İstanbul&to=Ankara&mode=bus → mesafe, süre, otoyollar, harita çizgisi
  app.get('/api/route', async (req, res) => {
    if (!router) return res.status(404).json({ error: 'Güzergâh servisi kapalı.' });
    try {
      res.json(await router({ from: req.query.from, to: req.query.to, mode: req.query.mode }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Uygulamaya gömülen harita sayfası
  app.use('/vendor/leaflet', express.static(LEAFLET_DIR));
  app.get('/map', (req, res) => res.sendFile('map.html', { root: PUBLIC_DIR }));

  app.get('/api/providers', (req, res) => {
    res.json(aggregator.providers.map(({ id, name, modes, demo }) => ({ id, name, modes, demo })));
  });

  // GET /api/search?mode=bus&from=istanbul&to=ankara&date=2026-10-23&providers=obilet,enuygun
  // İsteğe bağlı filtre parametreleri: status, priceMin, priceMax, departAfter, departBefore,
  // minSeats, maxDurationMin, company, sort
  app.get('/api/search', async (req, res) => {
    const { mode, from, to, date, providers, ...filters } = req.query;
    try {
      const result = await aggregator.search({ mode, from, to, date, providers: list(providers) });
      res.json({ ...result, trips: applyFilters(result.trips, filters) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/watches', (req, res) => {
    res.json(store.listWatches().map(publicWatch));
  });

  app.post('/api/watches', async (req, res) => {
    const body = req.body ?? {};
    if (!MODES.includes(body.mode) || !body.from || !body.to || !/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '')) {
      return res.status(400).json({ error: 'mode, from, to ve date (YYYY-AA-GG) gerekli.' });
    }
    const watch = watcher.create(body);
    // İlk kontrol referans sonuçları kaydeder; değişiklikler sonraki kontrollerde bildirilir.
    await watcher.check(watch);
    res.status(201).json(publicWatch(store.getWatch(watch.id)));
  });

  app.patch('/api/watches/:id', (req, res) => {
    const allowed = ['name', 'filters', 'intervalMin', 'paused', 'notifyOn'];
    const patch = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => allowed.includes(k)));
    if (patch.intervalMin !== undefined) patch.intervalMin = Math.max(MIN_INTERVAL_MIN, Number(patch.intervalMin) || 5);
    const watch = store.updateWatch(req.params.id, patch);
    if (!watch) return res.status(404).json({ error: 'Alarm bulunamadı.' });
    res.json(publicWatch(watch));
  });

  app.delete('/api/watches/:id', (req, res) => {
    if (!store.removeWatch(req.params.id)) return res.status(404).json({ error: 'Alarm bulunamadı.' });
    res.sendStatus(204);
  });

  app.post('/api/watches/:id/check', async (req, res) => {
    const watch = store.getWatch(req.params.id);
    if (!watch) return res.status(404).json({ error: 'Alarm bulunamadı.' });
    const events = await watcher.check(watch);
    res.json({ events, watch: publicWatch(store.getWatch(watch.id)) });
  });

  // GET /api/events?since=2026-10-22T10:00:00.000Z&watchId=...&limit=50
  app.get('/api/events', (req, res) => {
    const { since, watchId, limit } = req.query;
    res.json(store.listEvents({ since, watchId, limit: Math.min(Number(limit) || 100, 500) }));
  });

  return app;
}
