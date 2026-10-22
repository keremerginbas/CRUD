// Şehir / havalimanı / istasyon adını koordinata çevirir. Önce yerleşik tablo,
// bulunamazsa OpenStreetMap Nominatim kullanılır (ücretsiz, anahtar gerekmez; sonuçlar önbelleklenir).
import { slugify } from './trip.js';

const PLACES = {
  istanbul: [41.0082, 28.9784],
  ankara: [39.9334, 32.8597],
  izmir: [38.4237, 27.1428],
  antalya: [36.8969, 30.7133],
  bursa: [40.1885, 29.061],
  eskisehir: [39.7767, 30.5206],
  konya: [37.8746, 32.4932],
  adana: [37.0, 35.3213],
  kayseri: [38.7205, 35.4826],
  samsun: [41.2867, 36.33],
  trabzon: [41.0027, 39.7168],
  gaziantep: [37.0662, 37.3833],
  sivas: [39.7477, 37.0179],
  karaman: [37.1759, 33.2287],
  izmit: [40.7654, 29.9408],
  kocaeli: [40.7654, 29.9408],
  sakarya: [40.7569, 30.3781],
  bilecik: [40.1426, 29.9793],
  polatli: [39.5842, 32.1474],
  // havalimanları (IATA)
  ist: [41.2753, 28.7519],
  saw: [40.8986, 29.3092],
  esb: [40.1281, 32.9951],
  adb: [38.2924, 27.157],
  ayt: [36.8987, 30.8005],
  tzx: [40.9951, 39.7897],
  ada: [36.9822, 35.2804],
  bjv: [37.2506, 27.6643],
  dlm: [36.7131, 28.7925],
  asr: [38.7704, 35.4954],
  gzt: [36.9472, 37.4787],
};

export function createGeocoder({ fetchImpl = fetch, baseUrl = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org' } = {}) {
  const cache = new Map();

  return async function geocode(name) {
    const key = slugify(name);
    if (PLACES[key]) return { name, lat: PLACES[key][0], lon: PLACES[key][1] };
    // "İstanbul (Söğütlüçeşme)" gibi istasyon adlarında ilk kelimeye bak
    const first = key.split('-')[0];
    if (cache.has(key)) return cache.get(key);

    const url = `${baseUrl}/search?format=json&limit=1&countrycodes=tr&accept-language=tr&q=${encodeURIComponent(name)}`;
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': 'BiletRadar/0.1 (kisisel kullanim)' } });
      const [hit] = res.ok ? await res.json() : [];
      if (hit) {
        const place = { name, lat: Number(hit.lat), lon: Number(hit.lon) };
        cache.set(key, place);
        return place;
      }
    } catch {
      // ağ yoksa yerleşik tabloya düş
    }
    if (PLACES[first]) return { name, lat: PLACES[first][0], lon: PLACES[first][1] };
    throw new Error(`"${name}" konumu bulunamadı.`);
  };
}

export function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
