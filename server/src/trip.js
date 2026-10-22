// Normalize edilmiş bilet (sefer/uçuş) yapısı. Tüm sağlayıcılar bu şekle dönüştürülür:
// {
//   id, provider, providerName, mode: 'bus' | 'flight',
//   company, from, to,
//   departure: 'YYYY-MM-DDTHH:mm' (Türkiye yerel saati), arrival, durationMin,
//   price, currency, seatsAvailable: number | null, soldOut: boolean, url
// }

export const MODES = ['bus', 'flight'];

const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

export function slugify(text) {
  return String(text ?? '')
    .trim()
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/[çğıiöşüâîû]/g, (ch) => TR_MAP[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function tripId({ provider, company, from, to, departure }) {
  return [provider, slugify(company), slugify(from), slugify(to), departure].join('|');
}

export function minutesBetween(departure, arrival) {
  if (!departure || !arrival) return null;
  const d = Date.parse(`${departure}:00Z`);
  const a = Date.parse(`${arrival}:00Z`);
  if (Number.isNaN(d) || Number.isNaN(a)) return null;
  return Math.round((a - d) / 60000);
}

export function makeTrip(fields) {
  const trip = {
    provider: fields.provider,
    providerName: fields.providerName ?? fields.provider,
    mode: fields.mode,
    company: fields.company || 'Bilinmiyor',
    from: fields.from,
    to: fields.to,
    departure: fields.departure,
    arrival: fields.arrival ?? null,
    durationMin: fields.durationMin ?? minutesBetween(fields.departure, fields.arrival),
    price: typeof fields.price === 'number' && Number.isFinite(fields.price) ? fields.price : null,
    currency: fields.currency || 'TRY',
    seatsAvailable: Number.isFinite(fields.seatsAvailable) ? fields.seatsAvailable : null,
    soldOut: Boolean(fields.soldOut) || fields.seatsAvailable === 0,
    url: fields.url ?? null,
  };
  trip.id = fields.id ?? tripId(trip);
  return trip;
}

// Türkiye 2016'dan beri sabit UTC+3 kullanır.
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

export function epochToLocal(ms) {
  return new Date(ms + TR_OFFSET_MS).toISOString().slice(0, 16);
}

export function todayLocal(now = Date.now()) {
  return epochToLocal(now).slice(0, 10);
}
