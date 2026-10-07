// Vapi güncellemesi: iki EFAS asistanının sistem promptu ve açılışı, outbound'a "satisa_aktar" aracı,
// outbound Structured Output'una "bilgi_istiyor" sonucu. PROMPT_OUT / PROMPT_IN / SONUC_ACIKLAMA
// yer tutucularını vapi-guncelleme.mjs doldurur.
const ACILIS =
  "Merhabalar, ben İksre Project'ten Selin. Ankara Yeni Yaşamkent bölgesinde bulunan, üç milyon yüz elli bin liradan başlayan fiyatlarla Efas En Tepe'de bir artı bir daire sahibi olmak ister misiniz?";
const PROMPT_OUT = __PROMPT_OUT__;
const PROMPT_IN = __PROMPT_IN__;
const SONUC_ACIKLAMA = __SONUC_ACIKLAMA__;

const out = $('Vapi: Outbound Asistan').first().json;
const inn = $('Vapi: Inbound Asistan').first().json;
const k = $('Araç Kontrol').first().json;
const aracId = k.var ? k.id : $('Vapi: Araç Oluştur').first().json.id;
if (!aracId) throw new Error('satisa_aktar aracı oluşturulamadı; "Vapi: Araç Oluştur" çıktısına bakın.');

const so = $('Vapi: Structured Outputs')
  .all()
  .flatMap((i) => (Array.isArray(i.json.results) ? i.json.results : [i.json]))
  .filter((x) => x && x.id);
const soOut = so.find((x) => (out.artifactPlan?.structuredOutputIds || []).includes(x.id)) || so.find((x) => x.name === 'efas_ntepe_sonuc');
if (!soOut) throw new Error('Outbound asistanına bağlı efas_ntepe_sonuc bulunamadı.');

const sistem = (a, metin) => ({
  ...a.model,
  messages: [{ role: 'system', content: metin }, ...(a.model.messages || []).filter((x) => x.role !== 'system')],
});

// Structured Output: sadece "sonuc" alanının açıklamasını (ve varsa enum'unu) güncelle
const sema = JSON.parse(JSON.stringify(soOut.schema));
sema.properties.sonuc.description = SONUC_ACIKLAMA;
if (Array.isArray(sema.properties.sonuc.enum) && !sema.properties.sonuc.enum.includes('bilgi_istiyor')) {
  sema.properties.sonuc.enum.splice(1, 0, 'bilgi_istiyor');
}

const outGovde = {
  firstMessage: ACILIS,
  model: { ...sistem(out, PROMPT_OUT), toolIds: [...new Set([...(out.model.toolIds || []), aracId])] },
};
const inGovde = { firstMessage: ACILIS, model: sistem(inn, PROMPT_IN) };

const kontrol = (m) => ({ tarih: m.includes('{{"now"'), tekrarYok: m.includes('SADECE BİR KEZ'), yatirimSorusuYok: m.includes('SORMA') });

return [
  { json: { yol: 'assistant', id: out.id, ad: 'outbound', govde: outGovde, kontrol: { ...kontrol(PROMPT_OUT), musteriAdi: PROMPT_OUT.includes('{{musteri_adi}}'), satisaAktar: outGovde.model.toolIds.includes(aracId) } } },
  { json: { yol: 'assistant', id: inn.id, ad: 'inbound', govde: inGovde, kontrol: kontrol(PROMPT_IN) } },
  { json: { yol: 'structured-output', id: soOut.id, ad: soOut.name, govde: { name: soOut.name, schema: sema }, kontrol: { bilgiIstiyor: sema.properties.sonuc.description.includes('bilgi_istiyor') } } },
];
