// Tüm sağlayıcılarda paralel arama yapar, sonuçları birleştirir ve kısa süre önbellekler.
// Önbellek aynı aramanın sitelere tekrar tekrar gitmesini engeller (hem hız hem nezaket).
import { MODES } from './trip.js';

export function createAggregator(providers, { cacheTtlMs = 60_000, timeoutMs = 60_000, now = () => Date.now() } = {}) {
  const cache = new Map();
  const inflight = new Map();

  async function searchProvider(provider, query) {
    const key = `${provider.id}|${query.mode}|${query.from}|${query.to}|${query.date}`.toLowerCase();
    const cached = cache.get(key);
    if (cached && now() - cached.at < cacheTtlMs) return cached.trips;
    if (inflight.has(key)) return inflight.get(key);

    let timer;
    const promise = Promise.race([
      provider.search(query),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('zaman aşımı')), timeoutMs);
      }),
    ])
      .then((trips) => {
        cache.set(key, { at: now(), trips });
        return trips;
      })
      .finally(() => {
        clearTimeout(timer);
        inflight.delete(key);
      });
    inflight.set(key, promise);
    return promise;
  }

  return {
    providers,
    async search({ mode, from, to, date, providers: only = [] }) {
      if (!MODES.includes(mode)) throw new Error(`Geçersiz tür: ${mode}`);
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
        throw new Error('Nereden, nereye ve tarih (YYYY-AA-GG) gerekli.');
      }
      const selected = providers.filter((p) => p.modes.includes(mode) && (!only.length || only.includes(p.id)));
      const results = await Promise.allSettled(selected.map((p) => searchProvider(p, { mode, from, to, date })));

      const trips = [];
      const errors = [];
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') trips.push(...result.value);
        else errors.push({ provider: selected[i].id, message: result.reason?.message ?? String(result.reason) });
      });
      return { trips, errors, fetchedAt: new Date(now()).toISOString() };
    },
  };
}
