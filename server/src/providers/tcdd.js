// TCDD Taşımacılık (YHT ve anahat trenleri) adaptörü.
// ebilet.tcddtasimacilik.gov.tr tek sayfalık bir uygulama; arama adresi yok ve API'si sitenin
// kendi oturum başlıklarıyla çalışıyor. Bu yüzden:
//   1. Site başsız tarayıcıda açılır; sitenin API'ye gönderdiği başlıklar (Authorization vb.)
//      ve yüklediği istasyon listesi yakalanır.
//   2. Sefer sorgusu aynı sayfanın içinden, aynı başlıklarla yapılır.
// Oturum 20 dakika saklanır; böylece her aramada site yeniden açılmaz.
import { epochToLocal, makeTrip, slugify } from '../trip.js';
import { extractTrips, parseDateTime } from './heuristic.js';

const SESSION_TTL_MS = 20 * 60_000;

function toDateTime(value) {
  return typeof value === 'number' ? epochToLocal(value) : parseDateTime(value);
}

// İstasyon listesine benzeyen JSON: id ve ad içeren nesnelerden oluşan uzun bir dizi
export function findStations(json) {
  let best = [];
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
      const stations = node.filter((s) => s && typeof s === 'object' && s.id !== undefined && typeof (s.name ?? s.stationName) === 'string');
      if (stations.length > best.length && stations.length >= 10) best = stations.map((s) => ({ id: s.id, name: s.name ?? s.stationName }));
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    Object.values(node).forEach((n) => visit(n, depth + 1));
  };
  visit(json, 0);
  return best;
}

export function matchStation(input, stations, aliases = {}) {
  const key = slugify(input);
  const alias = aliases[key];
  const norm = (s) => slugify(s.name);
  if (alias) {
    const hit = stations.find((s) => norm(s) === slugify(alias));
    if (hit) return hit;
  }
  return (
    stations.find((s) => norm(s) === key) ??
    stations.find((s) => norm(s).startsWith(`${key}-gar`) || norm(s).startsWith(`${key}-yht`)) ??
    stations.find((s) => norm(s).startsWith(key)) ??
    stations.find((s) => norm(s).includes(key)) ??
    null
  );
}

function cheapestFare(train) {
  // fiyat ve boş koltuk; ekonomi/business gibi vagon sınıflarının en ucuzu ve toplam koltuk
  let price = null;
  let seats = 0;
  let seatInfo = false;
  const classes = (train.availableFareInfo ?? []).flatMap((f) => f.cabinClasses ?? []);
  for (const c of classes) {
    const count = c.availabilityCount ?? c.availableSeatCount;
    if (Number.isFinite(count)) {
      seatInfo = true;
      seats += count;
    }
    const p = c.minPrice ?? c.price?.priceAmount ?? c.price;
    if (Number.isFinite(p) && (!Number.isFinite(count) || count > 0) && (price === null || p < price)) price = p;
  }
  if (price === null) {
    const p = train.minPrice?.priceAmount ?? train.minPrice;
    if (Number.isFinite(p)) price = p;
  }
  return { price, seats: seatInfo ? seats : null };
}

// TCDD sefer yanıtı → bilet listesi. Beklenen yapı bulunamazsa genel çıkarıcıya düşer.
export function parseTcddResponse(json, { provider = 'tcdd', providerName = 'TCDD', from, to, date, url }) {
  const trains = (json?.trainLegs ?? []).flatMap((leg) => (leg.trainAvailabilities ?? []).flatMap((a) => a.trains ?? []));
  if (!trains.length) return extractTrips(json, { provider, providerName, mode: 'train', from, to, date, url });

  return trains
    .map((train) => {
      const segments = train.segments ?? [];
      const first = segments[0] ?? {};
      const last = segments[segments.length - 1] ?? {};
      const departure = toDateTime(first.departureTime ?? train.departureTime);
      if (!departure) return null;
      const { price, seats } = cheapestFare(train);
      return makeTrip({
        provider,
        providerName,
        mode: 'train',
        company: [train.type === 'YHT' || /yht/i.test(train.name ?? '') ? 'YHT' : null, train.commercialName || train.name].filter(Boolean).join(' ') || 'TCDD',
        from,
        to,
        departure,
        arrival: toDateTime(last.arrivalTime ?? train.arrivalTime),
        price,
        seatsAvailable: seats,
        soldOut: seats === 0,
        url,
      });
    })
    .filter((t) => t && (!date || t.departure.startsWith(date)));
}

function tcddDate(date) {
  const [y, m, d] = date.split('-');
  return `${d}-${m}-${y} 00:00:00`;
}

// Gerçek tarayıcı oturumu: başlıkları ve istasyonları yakalar, sorguyu sayfa içinden yapar.
async function openBrowserSession(site) {
  const { getBrowser } = await import('./browser.js');
  const browser = await getBrowser();
  const context = await browser.newContext({ locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  const page = await context.newPage();
  const apiHost = new URL(site.apiUrl).host;
  let headers = null;
  let stations = [];

  page.on('request', (req) => {
    if (new URL(req.url()).host === apiHost && !headers) {
      const h = req.headers();
      if (h.authorization) headers = Object.fromEntries(Object.entries(h).filter(([k]) => !k.startsWith('sec-') && !['host', 'content-length', 'cookie', 'origin', 'referer', 'user-agent'].includes(k)));
    }
  });
  page.on('response', async (res) => {
    if (new URL(res.url()).host !== apiHost) return;
    try {
      const found = findStations(await res.json());
      if (found.length > stations.length) stations = found;
    } catch {}
  });

  await page.goto(site.homeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 20 && (!headers || !stations.length); i += 1) await page.waitForTimeout(500);
  if (!headers) throw new Error('TCDD oturum başlıkları alınamadı (site yapısı değişmiş olabilir).');
  if (!stations.length) throw new Error('TCDD istasyon listesi alınamadı.');

  return {
    stations,
    at: Date.now(),
    async query(body) {
      return page.evaluate(
        async ({ url, headers, body }) => {
          const res = await fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
          if (!res.ok) throw new Error(`TCDD yanıtı ${res.status}`);
          return res.json();
        },
        { url: site.apiUrl, headers, body },
      );
    },
    close: () => context.close().catch(() => {}),
  };
}

export function createTcddProvider(id, site, { openSession = openBrowserSession, now = () => Date.now() } = {}) {
  let sessionPromise = null;

  async function session() {
    const current = sessionPromise && (await sessionPromise.catch(() => null));
    if (current && now() - current.at < SESSION_TTL_MS) return current;
    current?.close?.();
    sessionPromise = openSession(site);
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
    return sessionPromise;
  }

  return {
    id,
    name: site.name,
    modes: ['train'],
    demo: false,
    async search({ mode, from, to, date }) {
      if (mode !== 'train') return [];
      const s = await session();
      const dep = matchStation(from, s.stations, site.stationAliases);
      const arr = matchStation(to, s.stations, site.stationAliases);
      if (!dep) throw new Error(`"${from}" için TCDD istasyonu bulunamadı.`);
      if (!arr) throw new Error(`"${to}" için TCDD istasyonu bulunamadı.`);

      const json = await s.query({
        searchRoutes: [
          { departureStationId: dep.id, departureStationName: dep.name, arrivalStationId: arr.id, arrivalStationName: arr.name, departureDate: tcddDate(date) },
        ],
        passengerTypeCounts: [{ id: 0, count: 1 }],
        searchReservation: false,
      });
      return parseTcddResponse(json, { provider: id, providerName: site.name, from, to, date, url: site.homeUrl });
    },
  };
}
