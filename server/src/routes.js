// Güzergâh: mesafe, arabayla süre, geçilen otoyol/devlet yolları ve harita çizgisi.
// Karayolu için ücretsiz OSRM yönlendirme servisi kullanılır (OSRM_URL ile değiştirilebilir).
// Uçak ve trende düz çizgi ve kuş uçuşu mesafe gösterilir.
import { createGeocoder, haversineKm } from './geo.js';

const ROAD_TYPES = [
  [/^O\s*-?\s*\d+/i, 'Otoyol (ücretli)'],
  [/^D\s*-?\s*\d+/i, 'Devlet yolu'],
  [/^E\s*-?\s*\d+/i, 'Avrupa yolu'],
];

function normalizeRef(ref) {
  return ref.trim().replace(/^([ODE])\s*-?\s*(\d+)/i, (_, l, n) => `${l.toUpperCase()}-${n}`);
}

// OSRM adımlarından yol listesi: [{ ref, name, type, km }], ilk görüldüğü sıraya göre
export function extractHighways(steps, { minKm = 3 } = {}) {
  const roads = new Map();
  for (const step of steps) {
    const km = (step.distance ?? 0) / 1000;
    const refs = String(step.ref ?? '').split(';').map((r) => r.trim()).filter(Boolean);
    const named = !refs.length && /otoyol|otoban|çevre yolu|cevre yolu/i.test(step.name ?? '') ? [step.name] : [];
    for (const raw of [...refs, ...named]) {
      const ref = refs.length ? normalizeRef(raw) : raw;
      const road = roads.get(ref) ?? { ref, name: refs.length ? step.name || null : null, km: 0 };
      road.km += km;
      if (!road.name && step.name && refs.length) road.name = step.name;
      roads.set(ref, road);
    }
  }
  return [...roads.values()]
    .filter((r) => r.km >= minKm)
    .map((r) => ({
      ...r,
      km: Math.round(r.km),
      type: ROAD_TYPES.find(([re]) => re.test(r.ref))?.[1] ?? (/otoyol|otoban/i.test(r.ref) ? 'Otoyol (ücretli)' : 'Yol'),
    }));
}

export function mapLinks(from, to, mode) {
  const travel = mode === 'bus' ? 'driving' : 'transit';
  return {
    google: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${from.lat},${from.lon}`)}&destination=${encodeURIComponent(`${to.lat},${to.lon}`)}&travelmode=${travel}`,
    yandex: `https://yandex.com.tr/harita/?rtext=${from.lat},${from.lon}~${to.lat},${to.lon}&rtt=${mode === 'bus' ? 'auto' : 'mt'}`,
  };
}

export function createRouter({ fetchImpl = fetch, osrmUrl = process.env.OSRM_URL || 'https://router.project-osrm.org', geocode = createGeocoder({ fetchImpl }) } = {}) {
  const cache = new Map();

  return async function getRoute({ from, to, mode = 'bus' }) {
    if (!from || !to) throw new Error('Nereden ve nereye gerekli.');
    const key = `${mode}|${from}|${to}`.toLowerCase();
    if (cache.has(key)) return cache.get(key);

    const [a, b] = await Promise.all([geocode(from), geocode(to)]);
    const straightKm = Math.round(haversineKm(a, b));
    let route = {
      from: a,
      to: b,
      mode,
      distanceKm: straightKm,
      driveMin: null,
      highways: [],
      geometry: [
        [a.lat, a.lon],
        [b.lat, b.lon],
      ],
      straight: true,
      links: mapLinks(a, b, mode),
    };

    if (mode === 'bus') {
      try {
        const url = `${osrmUrl}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=simplified&geometries=geojson&steps=true`;
        const res = await fetchImpl(url, { headers: { 'User-Agent': 'BiletRadar/0.1 (kisisel kullanim)' } });
        const data = res.ok ? await res.json() : null;
        const best = data?.routes?.[0];
        if (best) {
          route = {
            ...route,
            distanceKm: Math.round(best.distance / 1000),
            driveMin: Math.round(best.duration / 60),
            highways: extractHighways(best.legs.flatMap((l) => l.steps ?? [])),
            geometry: best.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
            straight: false,
          };
        }
      } catch {
        // yönlendirme servisine ulaşılamazsa düz çizgiyle devam
      }
    }
    cache.set(key, route);
    return route;
  };
}
