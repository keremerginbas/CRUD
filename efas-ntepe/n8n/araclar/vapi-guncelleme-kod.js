// Vapi güncellemesi: iki EFAS asistanının sistem promptu ve açılışı, outbound'a "satisa_aktar" aracı,
// randevu_olustur araçları saatsiz, Structured Output'larda "bilgi_istiyor" ve saatsiz randevu.
// __...__ yer tutucularını vapi-guncelleme.mjs doldurur.
const ACILIS =
  "Merhabalar, ben İksre Project'ten Selin. Ankara Yeni Yaşamkent bölgesinde bulunan, üç milyon yüz elli bin liradan başlayan fiyatlarla Efas En Tepe'de bir artı bir daire sahibi olmak ister misiniz?";
const PROMPT_OUT = __PROMPT_OUT__;
const PROMPT_IN = __PROMPT_IN__;
const SONUC_ACIKLAMA = __SONUC_ACIKLAMA__;
const SONUC_ACIKLAMA_IN = __SONUC_ACIKLAMA_IN__;
const RANDEVU_OUT = __RANDEVU_OUT__;
const RANDEVU_IN = __RANDEVU_IN__;

const out = $('Vapi: Outbound Asistan').first().json;
const inn = $('Vapi: Inbound Asistan').first().json;
const k = $('Araç Kontrol').first().json;
const aracId = k.var ? k.id : $('Vapi: Araç Oluştur').first().json.id;
if (!aracId) throw new Error('satisa_aktar aracı oluşturulamadı; "Vapi: Araç Oluştur" çıktısına bakın.');

const so = $('Vapi: Structured Outputs')
  .all()
  .flatMap((i) => (Array.isArray(i.json.results) ? i.json.results : [i.json]))
  .filter((x) => x && x.id);
const bagliSo = (a, ad) => {
  const x = so.find((o) => (a.artifactPlan?.structuredOutputIds || []).includes(o.id)) || so.find((o) => o.name === ad);
  if (!x) throw new Error(`Asistana bağlı ${ad} bulunamadı.`);
  return x;
};
const soOut = bagliSo(out, 'efas_ntepe_sonuc');
const soIn = bagliSo(inn, 'efas_ntepe_inbound_sonuc');

// Asistanın kendi araçları arasından randevu_olustur (başka projelerin aynı adlı araçlarına dokunulmaz)
const araclar = $('Vapi: Araçlar').all().map((i) => i.json);
const randevuAraci = (a) => {
  const t = araclar.find((x) => (a.model.toolIds || []).includes(x.id) && x.function && x.function.name === 'randevu_olustur');
  if (!t) throw new Error(`${a.name} asistanında randevu_olustur aracı bulunamadı.`);
  return t;
};

const sistem = (a, metin) => ({
  ...a.model,
  messages: [{ role: 'system', content: metin }, ...(a.model.messages || []).filter((x) => x.role !== 'system')],
});

// Structured Output: sadece "sonuc" alanının açıklamasını (ve varsa enum'unu) güncelle
const semaGuncelle = (o, aciklama, yeniDeger) => {
  const sema = JSON.parse(JSON.stringify(o.schema));
  sema.properties.sonuc.description = aciklama;
  if (yeniDeger && Array.isArray(sema.properties.sonuc.enum) && !sema.properties.sonuc.enum.includes(yeniDeger)) sema.properties.sonuc.enum.splice(1, 0, yeniDeger);
  return sema;
};
const sema = semaGuncelle(soOut, SONUC_ACIKLAMA, 'bilgi_istiyor');
const semaIn = semaGuncelle(soIn, SONUC_ACIKLAMA_IN);
const raOut = randevuAraci(out);
const raIn = randevuAraci(inn);

// Konuşma zamanlaması ve gürültü engelleme (panelde sıfırlanmış olsa bile düzeltilir); ses dili Türkçe
const konusma = (a) => ({
  voice: { ...a.voice, language: 'tr' },
  startSpeakingPlan: { waitSeconds: 0.3, transcriptionEndpointingPlan: { onPunctuationSeconds: 0.1, onNoPunctuationSeconds: 0.8, onNumberSeconds: 0.6 } },
  stopSpeakingPlan: { numWords: 1, voiceSeconds: 0.3, backoffSeconds: 1 },
  backgroundSpeechDenoisingPlan: { smartDenoisingPlan: { enabled: true } },
  backgroundSound: 'off',
});
const outGovde = {
  firstMessage: ACILIS,
  model: { ...sistem(out, PROMPT_OUT), toolIds: [...new Set([...(out.model.toolIds || []), aracId])] },
  ...konusma(out),
};
const inGovde = { firstMessage: ACILIS, model: sistem(inn, PROMPT_IN), ...konusma(inn) };

const kontrol = (m) => ({ tarih: m.includes('{{"now"'), tekrarYok: m.includes('SADECE BİR KEZ'), yatirimSorusuYok: m.includes('SORMA'), acilisDogru: ACILIS.startsWith("Merhabalar, ben İksre Project'ten Selin") });

return [
  { json: { yol: 'assistant', id: out.id, ad: 'outbound', govde: outGovde, kontrol: { ...kontrol(PROMPT_OUT), musteriAdi: PROMPT_OUT.includes('{{musteri_adi}}'), satisaAktar: outGovde.model.toolIds.includes(aracId) } } },
  { json: { yol: 'assistant', id: inn.id, ad: 'inbound', govde: inGovde, kontrol: kontrol(PROMPT_IN) } },
  { json: { yol: 'structured-output', id: soOut.id, ad: soOut.name, govde: { name: soOut.name, schema: sema }, kontrol: { bilgiIstiyor: sema.properties.sonuc.description.includes('bilgi_istiyor') } } },
  { json: { yol: 'structured-output', id: soIn.id, ad: soIn.name, govde: { name: soIn.name, schema: semaIn }, kontrol: { saatsizRandevu: semaIn.properties.sonuc.description.includes('gün ve saat gerekmez') } } },
  { json: { yol: 'tool', id: raOut.id, ad: 'randevu_olustur (outbound)', govde: { function: RANDEVU_OUT }, kontrol: { saatSorulmaz: !RANDEVU_OUT.parameters.properties.randevu_saati } } },
  { json: { yol: 'tool', id: raIn.id, ad: 'randevu_olustur (inbound)', govde: { function: RANDEVU_IN }, kontrol: { saatSorulmaz: !RANDEVU_IN.parameters.properties.randevu_saati } } },
];
