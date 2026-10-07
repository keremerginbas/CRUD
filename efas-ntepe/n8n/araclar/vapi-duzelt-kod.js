// Vapi asistanlarını düzeltir: tarih/müşteri adı satırları, açılış cümlesi, sunucu zaman aşımı,
// sunucu mesajları, konuşma zamanlaması ve EFAS Structured Output bağlantısı.
const ACILIS =
  "Merhabalar, ben İksre Project'ten Selin. Ankara Yeni Yaşamkent bölgesinde bulunan, üç milyon yüz elli bin liradan başlayan fiyatlarla Efas En Tepe'de bir artı bir daire sahibi olmak ister misiniz?";
const TARIH = '{{"now" | date: "%Y-%m-%d %A %H:%M", "Europe/Istanbul"}}';

const out = $('Vapi: Outbound Asistan').first().json;
const inn = $('Vapi: Inbound Asistan').first().json;

// Structured Output listesi (dizi ya da { results: [...] } gelebilir)
const so = $('Vapi: Structured Outputs')
  .all()
  .flatMap((i) => (Array.isArray(i.json.results) ? i.json.results : [i.json]))
  .filter((x) => x && x.id);
const soBul = (ad) => {
  const s = so.find((x) => String(x.name || '').trim().toLowerCase() === ad);
  if (!s) throw new Error(`Vapi'de "${ad}" adlı Structured Output bulunamadı. Mevcutlar: ${so.map((x) => x.name).join(', ')}`);
  return s.id;
};

const promptDuzelt = (metin, outbound) => {
  let m = String(metin || '');
  if (!m.includes('{{"now"')) m = m.replace(/Şu an:\s*\(İstanbul saati\)/, `Şu an: ${TARIH} (İstanbul saati)`);
  if (outbound && !m.includes('{{musteri_adi}}')) m = m.replace(/Müşterinin CRM'deki adı:[ \t]*(?=\n|$)/, "Müşterinin CRM'deki adı: {{musteri_adi}}");
  return m;
};

const govde = (a, outbound, soId, url) => ({
  firstMessage: ACILIS,
  model: {
    ...a.model,
    messages: (a.model.messages || []).map((x) => (x.role === 'system' ? { ...x, content: promptDuzelt(x.content, outbound) } : x)),
  },
  server: { url: (a.server && a.server.url) || url, timeoutSeconds: 20 },
  serverMessages: ['end-of-call-report'],
  startSpeakingPlan: {
    waitSeconds: 0.3,
    transcriptionEndpointingPlan: { onPunctuationSeconds: 0.1, onNoPunctuationSeconds: 0.8, onNumberSeconds: 0.6 },
  },
  stopSpeakingPlan: { numWords: 0, voiceSeconds: 0.2, backoffSeconds: 1 },
  artifactPlan: { ...(a.artifactPlan || {}), structuredOutputIds: [soId] },
});

const kontrol = (g) => ({
  tarih: g.model.messages.some((x) => x.content.includes('{{"now"')),
  musteriAdi: g.model.messages.some((x) => x.content.includes('{{musteri_adi}}')),
});

const gOut = govde(out, true, soBul('efas_ntepe_sonuc'), 'https://xre111.shop/webhook/efas-ntepe-outbound');
const gIn = govde(inn, false, soBul('efas_ntepe_inbound_sonuc'), 'https://xre111.shop/webhook/efas-ntepe-inbound');

return [
  { json: { asistan: 'outbound', id: out.id, govde: gOut, kontrol: kontrol(gOut) } },
  { json: { asistan: 'inbound', id: inn.id, govde: gIn, kontrol: kontrol(gIn) } },
];
