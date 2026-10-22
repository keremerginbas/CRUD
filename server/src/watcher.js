// Alarm (takip) motoru: kayıtlı aramaları belirli aralıklarla tekrar çalıştırır ve
// bir önceki sonuçla karşılaştırır. Dolu bir sefer boşalınca, boş bir sefer dolunca,
// koltuk açılınca, fiyat düşünce veya yeni sefer eklenince olay üretir.
import { randomUUID } from 'node:crypto';
import { matchesFilters } from './filters.js';
import { todayLocal } from './trip.js';

export const MIN_INTERVAL_MIN = 2;

const TYPE_TITLES = {
  freed: 'Bilet boşaldı',
  seats_up: 'Koltuk açıldı',
  soldout: 'Sefer doldu',
  price_drop: 'Fiyat düştü',
  new: 'Yeni sefer',
};

function describe(trip) {
  const time = trip.departure.slice(11, 16);
  const price = trip.price !== null ? ` · ${Math.round(trip.price)} ${trip.currency}` : '';
  return `${trip.from} → ${trip.to} ${trip.departure.slice(0, 10)} ${time} · ${trip.company} (${trip.providerName})${price}`;
}

export function snapshotOf(trips) {
  return Object.fromEntries(trips.map((t) => [t.id, { soldOut: t.soldOut, seatsAvailable: t.seatsAvailable, price: t.price }]));
}

// prev: önceki snapshot (ilk kontrolde null), trips: güncel sonuçlar
export function diffTrips(prev, trips, filters, { notifyOn } = {}) {
  if (!prev) return [];
  const changes = [];
  for (const trip of trips) {
    if (!matchesFilters(trip, filters, { ignoreStatus: true })) continue;
    const before = prev[trip.id];
    let type = null;
    if (!before) {
      if (!trip.soldOut) type = 'new';
    } else if (before.soldOut && !trip.soldOut) {
      type = 'freed';
    } else if (!before.soldOut && trip.soldOut) {
      type = 'soldout';
    } else if (!trip.soldOut && before.seatsAvailable !== null && trip.seatsAvailable !== null && trip.seatsAvailable > before.seatsAvailable) {
      type = 'seats_up';
    } else if (!trip.soldOut && before.price !== null && trip.price !== null && trip.price < before.price) {
      type = 'price_drop';
    }
    if (!type || (notifyOn && !notifyOn.includes(type))) continue;
    // "boşaldı/koltuk açıldı" olayları kullanıcının koltuk alt sınırına da uymalı
    if (type !== 'soldout' && !matchesFilters(trip, { ...filters, status: 'available' })) continue;
    changes.push({ type, trip, before: before ?? null });
  }
  return changes;
}

export function createWatcher({ store, aggregator, notify = async () => {}, now = () => Date.now(), tickMs = 30_000 }) {
  let timer = null;
  const running = new Set();

  async function check(watch) {
    if (running.has(watch.id)) return [];
    running.add(watch.id);
    try {
      const { trips, errors } = await aggregator.search(watch);
      const changes = diffTrips(watch.snapshot, trips, watch.filters, { notifyOn: watch.notifyOn });
      const at = new Date(now()).toISOString();
      const events = changes.map(({ type, trip, before }) => ({
        id: randomUUID(),
        watchId: watch.id,
        watchName: watch.name,
        type,
        title: `${TYPE_TITLES[type]}: ${watch.name}`,
        message:
          type === 'price_drop'
            ? `${describe(trip)} (önce ${Math.round(before.price)})`
            : type === 'seats_up' || type === 'freed'
              ? `${describe(trip)} · ${trip.seatsAvailable ?? '?'} boş koltuk`
              : describe(trip),
        trip,
        at,
      }));

      // Bir sağlayıcı hata verdiyse onun eski verisini sakla; aksi halde bir sonraki
      // başarılı kontrolde tüm seferleri "yeni" sanırız.
      const failed = new Set(errors.map((e) => e.provider));
      const kept = Object.fromEntries(Object.entries(watch.snapshot ?? {}).filter(([id]) => failed.has(id.split('|')[0])));
      store.updateWatch(watch.id, {
        snapshot: { ...kept, ...snapshotOf(trips) },
        lastCheckedAt: at,
        lastError: errors.length ? errors.map((e) => `${e.provider}: ${e.message}`).join('; ') : null,
        lastCount: trips.length,
      });
      store.addEvents(events);
      await Promise.all(events.map((e) => notify(e)));
      return events;
    } catch (err) {
      store.updateWatch(watch.id, { lastCheckedAt: new Date(now()).toISOString(), lastError: err.message });
      return [];
    } finally {
      running.delete(watch.id);
    }
  }

  async function tick() {
    const due = store.listWatches().filter((w) => {
      if (w.paused) return false;
      if (w.date < todayLocal(now())) return false; // tarihi geçmiş
      const last = w.lastCheckedAt ? Date.parse(w.lastCheckedAt) : 0;
      return now() - last >= w.intervalMin * 60_000;
    });
    // Siteleri yormamak için alarmları sırayla kontrol et
    for (const watch of due) await check(watch);
  }

  return {
    check,
    tick,
    create(input) {
      const watch = {
        id: randomUUID(),
        name: input.name || `${input.from} → ${input.to} ${input.date}`,
        mode: input.mode,
        from: input.from,
        to: input.to,
        date: input.date,
        providers: input.providers ?? [],
        filters: input.filters ?? {},
        notifyOn: input.notifyOn ?? null,
        intervalMin: Math.max(MIN_INTERVAL_MIN, Number(input.intervalMin) || 5),
        paused: false,
        createdAt: new Date(now()).toISOString(),
        lastCheckedAt: null,
        lastError: null,
        lastCount: null,
        snapshot: null,
      };
      return store.addWatch(watch);
    },
    start() {
      if (timer) return;
      timer = setInterval(() => tick().catch((err) => console.error('alarm kontrolü:', err)), tickMs);
      tick().catch((err) => console.error('alarm kontrolü:', err));
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
