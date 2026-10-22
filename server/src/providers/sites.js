// obilet, enuygun, ucuzabilet ve skyscanner için gerçek site adaptörleri.
// Adresler config/sites.json'dan gelir; sonuçlar sayfanın JSON yanıtlarından çıkarılır.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slugify } from '../trip.js';
import { captureJson } from './browser.js';
import { extractTrips } from './heuristic.js';

const CONFIG_PATH = fileURLToPath(new URL('../../config/sites.json', import.meta.url));

export function loadSiteConfig(path = CONFIG_PATH) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  delete config._aciklama;
  return config;
}

export function resolvePlace(input, { cities = {}, cityFormat = 'slug' } = {}) {
  const key = slugify(input);
  if (cities[key] !== undefined) return String(cities[key]);
  if (cityFormat === 'id') {
    throw new Error(`"${input}" için şehir kodu tanımlı değil (config/sites.json → cities).`);
  }
  if (cityFormat === 'IATA') return String(input).trim().toUpperCase();
  if (cityFormat === 'iata') return String(input).trim().toLowerCase();
  return key;
}

export function buildUrl(template, { from, to, date }) {
  const [y, m, d] = date.split('-');
  return template
    .replaceAll('{from}', encodeURIComponent(from))
    .replaceAll('{to}', encodeURIComponent(to))
    .replaceAll('{date}', date)
    .replaceAll('{dateTR}', `${d}.${m}.${y}`)
    .replaceAll('{dateYYMMDD}', `${y.slice(2)}${m}${d}`);
}

export function createSiteProvider(id, site, { capture = captureJson } = {}) {
  return {
    id,
    name: site.name,
    modes: Object.keys(site.modes),
    demo: false,
    async search({ mode, from, to, date }) {
      const modeConfig = site.modes[mode];
      if (!modeConfig) return [];
      const url = buildUrl(modeConfig.url, {
        from: resolvePlace(from, modeConfig),
        to: resolvePlace(to, modeConfig),
        date,
      });
      const { responses, title } = await capture(url);
      const trips = responses.flatMap((r) =>
        extractTrips(r.body, { provider: id, providerName: site.name, mode, from, to, date, url }),
      );
      if (!trips.length && /captcha|robot|access denied|blocked|just a moment/i.test(title)) {
        throw new Error(`${site.name} bot korumasına takıldı ("${title}").`);
      }
      return dedupe(trips);
    },
  };
}

function dedupe(trips) {
  const byId = new Map();
  for (const trip of trips) {
    const prev = byId.get(trip.id);
    // Aynı sefer birden çok yanıtta gelirse en ucuz fiyatlı olanı tut
    if (!prev || (trip.price ?? Infinity) < (prev.price ?? Infinity)) byId.set(trip.id, trip);
  }
  return [...byId.values()];
}
