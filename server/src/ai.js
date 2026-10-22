// Yapay zekâ asistanı:
//  - parseRequest: "yarın akşam 18-23 arası İstanbul Ankara 1000 TL altı otobüs" gibi bir cümleyi
//    arama + filtre ayarlarına çevirir.
//  - recommend: bulunan biletlerden en uygun olanları kısa bir Türkçe özetle önerir.
// OPENAI_API_KEY tanımlı değilse veya OpenAI'ye ulaşılamazsa kural tabanlı yedek kullanılır.
import { slugify, todayLocal } from './trip.js';

const OPENAI_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

const PARSE_PROMPT = `Kullanıcının Türkçe bilet isteğini JSON'a çevir. Sadece JSON döndür:
{"mode":"bus"|"flight","from":string,"to":string,"date":"YYYY-MM-DD",
 "filters":{"priceMax":number|null,"priceMin":number|null,"departAfter":"HH:mm"|null,"departBefore":"HH:mm"|null,
 "minSeats":number|null,"status":"all"|"available"|"soldout","company":string|null,"maxDurationMin":number|null,
 "sort":"price"|"departure"|"duration"},
 "watch":boolean}
Kurallar: uçak isteğinde from/to için havalimanı IATA kodu kullan (İstanbul=IST, Sabiha=SAW, Ankara=ESB, İzmir=ADB, Antalya=AYT).
Otobüste şehir adını yaz. "en ucuz" → sort=price. "boşalırsa haber ver/takip et/alarm" → watch=true.
"sabah"=06:00-12:00, "öğle"=12:00-17:00, "akşam"=17:00-23:59, "gece"=00:00-06:00. Bugünün tarihi: {TODAY}.`;

const RECOMMEND_PROMPT = `Sen bir bilet asistanısın. Verilen bilet listesinden kullanıcıya en uygun 3 seçeneği öner.
Fiyat, kalkış saati, süre ve boş koltuk durumunu dikkate al. Dolu biletleri önerme ama dolu olup boşalabilecek
iyi seçenekler varsa alarm kurmayı öner. Kısa, maddeli ve Türkçe yaz; uydurma bilgi verme.`;

async function chat({ apiKey, model, messages, json, fetchImpl }) {
  const res = await fetchImpl(`${OPENAI_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI hatası ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// --- Kural tabanlı yedek ayrıştırıcı ---------------------------------------

const AIRPORTS = { istanbul: 'IST', sabiha: 'SAW', ankara: 'ESB', izmir: 'ADB', antalya: 'AYT', trabzon: 'TZX', adana: 'ADA', bodrum: 'BJV', dalaman: 'DLM', kayseri: 'ASR', gaziantep: 'GZT', diyarbakir: 'DIY', samsun: 'SZF', erzurum: 'ERZ', van: 'VAN' };
const MONTHS = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
const STOP_WORDS = new Set([
  ...MONTHS, 'bugun', 'yarin', 'obur', 'gun', 'sabah', 'ogle', 'aksam', 'gece', 'en', 'ucuz', 'uygun', 'otobus', 'ucak', 'ucus',
  'bilet', 'bileti', 'biletleri', 'dolu', 'olan', 'bos', 'musait', 'haber', 'ver', 'bildir', 'takip', 'alarm', 'kisi', 'koltuk',
  'yolcu', 'arasi', 'alti', 'ustu', 'lira', 'saat', 'saatleri', 'ile', 'icin', 'bana', 'bul', 'ara', 'olsun', 'fazla', 'bosalirsa',
  'bosalinca', 'tarihinde', 'gidis', 'sefer', 'seferi', 'havalimani',
]);
const PARTS = { sabah: ['06:00', '12:00'], ogle: ['12:00', '17:00'], aksam: ['17:00', '23:59'], gece: ['00:00', '06:00'] };

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function titleCase(word) {
  return word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1);
}

export function parseRequestRules(text, now = Date.now()) {
  const raw = String(text);
  const s = slugify(raw).replace(/-/g, ' ');
  const today = todayLocal(now);
  const mode = /\b(ucak|ucus|flight|havalimani)\b/.test(s) ? 'flight' : 'bus';
  const filters = { status: 'all', sort: /ucuz/.test(s) ? 'price' : 'departure' };

  // Tarih
  let date = today;
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  const tr = raw.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b/);
  const named = s.match(new RegExp(`\\b(\\d{1,2}) (${MONTHS.join('|')})\\b`));
  if (iso) date = iso[1];
  else if (named) {
    const year = Number(today.slice(0, 4));
    date = `${year}-${String(MONTHS.indexOf(named[2]) + 1).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
    if (date < today) date = `${year + 1}${date.slice(4)}`;
  } else if (tr && !/\d\s*(tl|lira)/.test(raw.slice(tr.index, tr.index + 12).toLowerCase())) {
    date = `${tr[3] ?? today.slice(0, 4)}-${tr[2].padStart(2, '0')}-${tr[1].padStart(2, '0')}`;
  } else if (/\bobur gun\b/.test(s)) date = addDays(today, 2);
  else if (/\byarin\b/.test(s)) date = addDays(today, 1);

  // Saat aralığı: "18-23 arası", "18:00 ile 22:30 arası", ya da sabah/akşam
  const range = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:-|ile|ve)\s*(\d{1,2})(?::(\d{2}))?\s*(?:arası|arasi|saatleri)/i);
  if (range) {
    filters.departAfter = `${range[1].padStart(2, '0')}:${range[2] ?? '00'}`;
    filters.departBefore = `${range[3].padStart(2, '0')}:${range[4] ?? '00'}`;
  } else {
    const part = Object.keys(PARTS).find((p) => new RegExp(`\\b${p}`).test(s));
    if (part) [filters.departAfter, filters.departBefore] = PARTS[part];
  }

  // Fiyat: "1000 TL altı", "en fazla 1.500 lira"
  const price = raw.match(/(\d[\d.]*)\s*(?:tl|lira|₺)/i);
  if (price) {
    const value = Number(price[1].replace(/\./g, ''));
    if (/(üstü|ustu|fazla olsun|en az)/i.test(raw.slice(price.index, price.index + 30)) && !/en fazla/i.test(raw)) filters.priceMin = value;
    else filters.priceMax = value;
  }

  const seats = s.match(/(\d+) (kisi|koltuk|yolcu)/);
  if (seats) filters.minSeats = Number(seats[1]);
  if (/\b(bos|musait)\b/.test(s) && !/bosalirsa|bosalinca/.test(s)) filters.status = 'available';

  // Güzergâh: "İstanbul'dan Ankara'ya", "İstanbul Ankara", "İstanbul - Ankara"
  const words = raw
    .replace(/['’][a-zçğıöşü]+/gi, ' ')
    .split(/[\s,\-→>]+/)
    .filter((w) => /^[A-Za-zÇĞİÖŞÜçğıöşü]{3,}$/.test(w) && !STOP_WORDS.has(slugify(w)));
  const places = words.filter((w) => /^[A-ZÇĞİÖŞÜ]/.test(w) || AIRPORTS[slugify(w)]);
  let [from, to] = places;
  from = from ? titleCase(from) : '';
  to = to ? titleCase(to) : '';
  if (mode === 'flight') {
    from = AIRPORTS[slugify(from)] ?? from.toUpperCase();
    to = AIRPORTS[slugify(to)] ?? to.toUpperCase();
  }

  return { mode, from, to, date, filters, watch: /(bosalirsa|bosalinca|haber ver|bildir|takip|alarm)/.test(s) };
}

function recommendRules(trips) {
  const open = trips.filter((t) => !t.soldOut && t.price !== null).sort((a, b) => a.price - b.price);
  const soldOut = trips.filter((t) => t.soldOut).length;
  if (!open.length) {
    return soldOut
      ? `Uygun bilet yok, ${soldOut} sefer dolu. Alarm kurarsanız biri boşalınca haber veririm.`
      : 'Bu kriterlere uyan bilet bulunamadı. Filtreleri genişletmeyi deneyin.';
  }
  const fastest = [...open].sort((a, b) => (a.durationMin ?? Infinity) - (b.durationMin ?? Infinity))[0];
  const line = (t) => `${t.departure.slice(11, 16)} ${t.company} (${t.providerName}) – ${Math.round(t.price)} ${t.currency}`;
  const lines = [`• En ucuz: ${line(open[0])}`];
  if (fastest && fastest !== open[0] && fastest.durationMin) lines.push(`• En kısa süren: ${line(fastest)}, ${Math.round(fastest.durationMin / 60 * 10) / 10} saat`);
  if (open[1]) lines.push(`• Alternatif: ${line(open[1])}`);
  if (soldOut) lines.push(`• ${soldOut} sefer dolu. Alarm kurarsanız boşalınca bildiririm.`);
  return lines.join('\n');
}

// --- Dışa açılan arayüz ------------------------------------------------------

export function createAssistant({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-4o-mini', fetchImpl = fetch, now = () => Date.now() } = {}) {
  const enabled = Boolean(apiKey);

  return {
    enabled,
    async parseRequest(text) {
      const fallback = parseRequestRules(text, now());
      if (!enabled) return { ...fallback, source: 'rules' };
      try {
        const content = await chat({
          apiKey,
          model,
          fetchImpl,
          json: true,
          messages: [
            { role: 'system', content: PARSE_PROMPT.replace('{TODAY}', todayLocal(now())) },
            { role: 'user', content: String(text) },
          ],
        });
        const parsed = JSON.parse(content);
        const filters = Object.fromEntries(Object.entries(parsed.filters ?? {}).filter(([, v]) => v !== null && v !== ''));
        return {
          mode: parsed.mode === 'flight' ? 'flight' : 'bus',
          from: parsed.from || fallback.from,
          to: parsed.to || fallback.to,
          date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date ?? '') ? parsed.date : fallback.date,
          filters: { status: 'all', sort: 'departure', ...filters },
          watch: Boolean(parsed.watch),
          source: 'ai',
        };
      } catch (err) {
        console.warn('Yapay zekâ ayrıştırması başarısız, kural tabanlı yedek kullanılıyor:', err.message);
        return { ...fallback, source: 'rules' };
      }
    },

    async recommend(trips, request = '') {
      if (!enabled || !trips.length) return { text: recommendRules(trips), source: 'rules' };
      const compact = trips.slice(0, 40).map((t) => ({
        site: t.providerName,
        firma: t.company,
        kalkis: t.departure,
        varis: t.arrival,
        sureDk: t.durationMin,
        fiyat: t.price,
        bosKoltuk: t.seatsAvailable,
        dolu: t.soldOut,
      }));
      try {
        const text = await chat({
          apiKey,
          model,
          fetchImpl,
          messages: [
            { role: 'system', content: RECOMMEND_PROMPT },
            { role: 'user', content: `İstek: ${request || '(belirtilmedi)'}\nBiletler: ${JSON.stringify(compact)}` },
          ],
        });
        return { text: text.trim(), source: 'ai' };
      } catch (err) {
        console.warn('Yapay zekâ önerisi başarısız:', err.message);
        return { text: recommendRules(trips), source: 'rules' };
      }
    },
  };
}
