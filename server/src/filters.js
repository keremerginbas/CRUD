// Arama sonuçlarını kullanıcının isteğine göre filtreler ve sıralar.
// Aynı mantık mobile/src/filters.js içinde de var; birini değiştirirseniz diğerini de güncelleyin.
//
// filters = {
//   providers: ['obilet', ...]    boş/yoksa hepsi
//   status: 'all' | 'available' | 'soldout'
//   priceMin, priceMax            TL
//   departAfter, departBefore     'HH:mm'
//   minSeats                      en az boş koltuk
//   maxDurationMin                en uzun yolculuk süresi (dk)
//   company                       firma/havayolu adında geçen metin
//   sort: 'price' | 'departure' | 'duration' | 'seats'
// }

export const DEFAULT_FILTERS = {
  providers: [],
  status: 'all',
  priceMin: null,
  priceMax: null,
  departAfter: null,
  departBefore: null,
  minSeats: null,
  maxDurationMin: null,
  company: '',
  sort: 'departure',
};

function isSet(value) {
  return value !== null && value !== undefined && value !== '';
}

function lower(text) {
  return String(text ?? '').toLocaleLowerCase('tr-TR');
}

export function matchesFilters(trip, filters = {}, { ignoreStatus = false } = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  if (f.providers?.length && !f.providers.includes(trip.provider)) return false;

  if (!ignoreStatus) {
    if (f.status === 'available' && trip.soldOut) return false;
    if (f.status === 'soldout' && !trip.soldOut) return false;
    if (isSet(f.minSeats) && !trip.soldOut && trip.seatsAvailable !== null && trip.seatsAvailable < Number(f.minSeats)) {
      return false;
    }
  }

  if (isSet(f.priceMin) && trip.price !== null && trip.price < Number(f.priceMin)) return false;
  if (isSet(f.priceMax) && trip.price !== null && trip.price > Number(f.priceMax)) return false;

  const time = trip.departure?.slice(11, 16);
  if (time) {
    if (isSet(f.departAfter) && time < f.departAfter) return false;
    if (isSet(f.departBefore) && time > f.departBefore) return false;
  }

  if (isSet(f.maxDurationMin) && trip.durationMin !== null && trip.durationMin > Number(f.maxDurationMin)) return false;
  if (isSet(f.company) && !lower(trip.company).includes(lower(f.company))) return false;
  return true;
}

const SORTERS = {
  price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  departure: (a, b) => String(a.departure).localeCompare(String(b.departure)),
  duration: (a, b) => (a.durationMin ?? Infinity) - (b.durationMin ?? Infinity),
  seats: (a, b) => (b.seatsAvailable ?? -1) - (a.seatsAvailable ?? -1),
};

export function applyFilters(trips, filters = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const sorter = SORTERS[f.sort] ?? SORTERS.departure;
  return trips.filter((t) => matchesFilters(t, f)).sort((a, b) => sorter(a, b) || SORTERS.departure(a, b));
}
