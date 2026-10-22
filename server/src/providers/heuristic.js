// Sitelerin kendi arayüzlerinin çağırdığı JSON yanıtlarından bilet çıkarır.
// Sitelerin iç veri formatları belgelenmediği ve sık değiştiği için alan adlarını
// tahmin eden genel bir tarayıcı kullanılır: içinde kalkış zamanı ve fiyat olan her
// nesne bir sefer/uçuş adayı sayılır. Bir site için sonuç gelmezse
// `npm run probe` ile yakalanan JSON'a bakıp aşağıdaki anahtar listelerini genişletin.
import { epochToLocal, makeTrip } from '../trip.js';

const DEPARTURE_KEYS = /^(departure(date|time|datetime)?|departs?(at|on)?|kalkis(tarihi|zamani|saati)?|journeydeparture|starttime|departuretime|takeoff|local_departure|departure_time)$/i;
const ARRIVAL_KEYS = /^(arrival(date|time|datetime)?|arrives?(at|on)?|varis(tarihi|zamani|saati)?|journeyarrival|endtime|arrivaltime|landing|local_arrival|arrival_time)$/i;
const PRICE_KEYS = /^(price|totalprice|total|amount|fare|fiyat|toplamfiyat|internetprice|originalprice|minprice|cheapestprice)$/i;
// fiyat bir nesneyse ({ amount, currency } gibi) içindeki sayı bu anahtarlarda aranır
const PRICE_INNER_KEYS = /^(amount|value|raw|total|price|tl|try)$/i;
const COMPANY_KEYS = /^(company(name)?|partner(name)?|firma(adi)?|operator(name)?|airline(name)?|carrier(name)?|marketingcarrier(name)?|brand(name)?)$/i;
const SEAT_KEYS = /^(availableseats?|seatsavailable|emptyseats?|bos(koltuk|koltuksayisi)|remainingseats?|availableseatcount|seatcount|freeseats?|seats(left|remaining)?)$/i;
const SOLD_OUT_KEYS = /^(soldout|issoldout|isfull|full|dolu)$/i;
const AVAILABLE_KEYS = /^(isavailable|available|issellable|sellable|bookable)$/i;

const MAX_DEPTH = 14;

export function parseDateTime(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    // saniye ya da milisaniye epoch
    if (value > 1e12) return epochToLocal(value);
    if (value > 1e9) return epochToLocal(value * 1000);
    return null;
  }
  if (typeof value !== 'string') return null;

  const msDate = value.match(/\/Date\((\d+)/);
  if (msDate) return epochToLocal(Number(msDate[1]));

  // 2026-10-23T08:30:00+03:00 gibi saat dilimli değerleri Türkiye saatine çevir
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return epochToLocal(ms);
  }
  const iso = value.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (iso) return `${iso[1]}T${iso[2]}`;
  const tr = value.match(/(\d{2})[./](\d{2})[./](\d{4})[ T](\d{2}:\d{2})/);
  if (tr) return `${tr[3]}-${tr[2]}-${tr[1]}T${tr[4]}`;
  return null;
}

function parsePrice(value, depth = 0) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    // "1.234,56 TL" ya da "1234.56"
    const cleaned = value.replace(/[^\d.,]/g, '');
    if (!cleaned) return null;
    const normalized = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (value && typeof value === 'object' && depth < 3) {
    for (const [key, inner] of Object.entries(value)) {
      if (PRICE_INNER_KEYS.test(key) || PRICE_KEYS.test(key)) {
        const n = parsePrice(inner, depth + 1);
        if (n) return n;
      }
    }
  }
  return null;
}

function findValue(obj, keyPattern, parse, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return null;
  for (const [key, value] of Object.entries(obj)) {
    if (keyPattern.test(key)) {
      const parsed = parse(value);
      if (parsed !== null && parsed !== undefined) return parsed;
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const found = findValue(value, keyPattern, parse, depth + 1);
      if (found !== null && found !== undefined) return found;
    }
  }
  return null;
}

const asText = (v) => (typeof v === 'string' && v.trim() ? v.trim() : v && typeof v === 'object' ? findValue(v, /^(name|title|ad)$/i, asText) : null);
const asInt = (v) => (Number.isInteger(v) && v >= 0 ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const asBool = (v) => (typeof v === 'boolean' ? v : null);

// Kalkış zamanı nesnenin kendisinde ya da doğrudan bir alt nesnesinde
// ({ firma, journey: { departure } } gibi) olabilir; ikisinde de nesne sefer sayılır.
function ownDeparture(obj, nested = true) {
  for (const [key, value] of Object.entries(obj)) {
    if (DEPARTURE_KEYS.test(key)) {
      const parsed = parseDateTime(value);
      if (parsed) return parsed;
    }
  }
  if (!nested) return null;
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const parsed = ownDeparture(value, false);
      if (parsed) return parsed;
    }
  }
  return null;
}

export function extractTrips(json, { provider, providerName, mode, from, to, date, url }) {
  const trips = [];
  const seen = new Set();

  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    const departure = ownDeparture(node);
    const price = departure ? findValue(node, PRICE_KEYS, (v) => parsePrice(v)) : null;
    if (departure && price && (!date || departure.startsWith(date))) {
      const seats = findValue(node, SEAT_KEYS, asInt);
      const soldOutFlag = findValue(node, SOLD_OUT_KEYS, asBool);
      const availableFlag = findValue(node, AVAILABLE_KEYS, asBool);
      const trip = makeTrip({
        provider,
        providerName,
        mode,
        company: findValue(node, COMPANY_KEYS, asText),
        from,
        to,
        departure,
        arrival: findValue(node, ARRIVAL_KEYS, parseDateTime),
        price,
        seatsAvailable: seats,
        soldOut: soldOutFlag === true || availableFlag === false || seats === 0,
        url,
      });
      if (!seen.has(trip.id)) {
        seen.add(trip.id);
        trips.push(trip);
      }
      return; // bu nesne bir sefer; içindeki ara duraklar ayrı sefer sayılmasın
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };

  visit(json, 0);
  return trips;
}
