// Demo sağlayıcılar: gerçek siteye bağlanmadan uygulamayı uçtan uca denemek için.
// Aynı arama için hep aynı seferleri üretir; koltuk sayıları birkaç dakikada bir değişir,
// böylece "doldu" / "boşaldı" alarmları demo modunda da tetiklenir.
import { makeTrip } from '../trip.js';

const BUS_COMPANIES = ['Metro Turizm', 'Kamil Koç', 'Pamukkale', 'Varan', 'Nilüfer', 'Süha Turizm', 'Has Turizm'];
const AIRLINES = ['THY', 'Pegasus', 'AJet', 'SunExpress'];

function hash(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function addMinutes(date, hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const base = Date.UTC(...date.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))), h, m);
  return new Date(base + minutes * 60000).toISOString().slice(0, 16);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function createMockProvider({ id, name, modes, slotMinutes = 3, now = () => Date.now() }) {
  return {
    id,
    name: `${name} (demo)`,
    modes,
    demo: true,
    async search({ mode, from, to, date }) {
      const random = rng(hash(`${id}|${mode}|${from}|${to}|${date}`));
      const isBus = mode === 'bus';
      const count = 5 + Math.floor(random() * 5);
      const slot = Math.floor(now() / (slotMinutes * 60000));
      const trips = [];

      for (let i = 0; i < count; i += 1) {
        const hour = Math.floor(random() * 24);
        const minute = Math.floor(random() * 4) * 15;
        const time = `${pad(hour)}:${pad(minute)}`;
        const duration = isBus ? 240 + Math.floor(random() * 360) : 55 + Math.floor(random() * 60);
        const company = (isBus ? BUS_COMPANIES : AIRLINES)[Math.floor(random() * (isBus ? BUS_COMPANIES : AIRLINES).length)];
        const basePrice = isBus ? 500 + random() * 900 : 900 + random() * 2600;

        // Her zaman diliminde koltuk sayısı ve fiyat biraz oynar.
        const live = rng(hash(`${id}|${date}|${i}|${slot}`));
        const capacity = isBus ? 46 : 9;
        const seats = live() < 0.3 ? 0 : Math.floor(live() * (capacity + 1));
        const price = Math.round(basePrice * (0.9 + live() * 0.2));

        trips.push(
          makeTrip({
            provider: id,
            providerName: name,
            mode,
            company,
            from,
            to,
            departure: `${date}T${time}`,
            arrival: addMinutes(date, time, duration),
            durationMin: duration,
            price,
            seatsAvailable: seats,
            soldOut: seats === 0,
            url: null,
          }),
        );
      }
      return trips;
    },
  };
}
