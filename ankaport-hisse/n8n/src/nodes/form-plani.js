// Bitrix: lead "ankaport reklam" statüsüne düştüğünde (otomasyon kuralı webhook'u tetikler).
// Lead'i çek, telefonu doğrula, Vapi araması + SMS + e-posta + Telegram "form doldu" bildirimini hazırla.
const A = $('AYARLAR').first().json;
const body = $('Form Webhook').first().json.body || {};
const query = $('Form Webhook').first().json.query || {};
const leadId = (body['document_id[2]'] || body['data[FIELDS][ID]'] || query.id || body.id || '')
  .toString()
  .replace('LEAD_', '');

const r = $input.first().json;
const lead = r && r.result && r.result.ID ? r.result : null;
if (!lead) return [{ json: { hata: `Lead bulunamadı: ${leadId}`, aramaYapilsin: false } }];

const telefon = leadTelefonu(lead);
const ad = isimDuzelt([lead.NAME, lead.LAST_NAME].filter(Boolean).join(' '));
const eposta = leadEpostasi(lead);
const simdi = new Date();

if (!telefon) {
  return [
    {
      json: {
        aramaYapilsin: false,
        leadId: String(lead.ID),
        ad,
        cmd: {
          not: bitrixKomut('crm.timeline.comment.add', {
            fields: { ENTITY_ID: lead.ID, ENTITY_TYPE: 'lead', COMMENT: `⚠️ ${A.PROJE_ADI} yapay zeka: lead'de geçerli bir telefon numarası yok, arama yapılamadı.` },
          }),
        },
      },
    },
  ];
}

const aramaZamani = pencereyeTasi(simdi, A.ARAMA_SAATLERI);
const hemenAra = aramaZamani.getTime() <= simdi.getTime() + 60000;

return [
  {
    json: {
      aramaYapilsin: true,
      hemenAra,
      leadId: String(lead.ID),
      ad,
      telefon,
      eposta,
      sorumluId: String(lead.ASSIGNED_BY_ID || ''),
      formTarihi: trMetin(bitrixTarih(lead.DATE_CREATE) || simdi),
      vapiBody: {
        assistantId: '__ASISTAN_ID__', // build.mjs/vapi-guncelleme ile asistan ID'si çözülür
        phoneNumberId: '__NUMARA_ID__',
        customer: { number: telefon, name: ad || undefined },
        name: kisalt(`Ankaport Hisse #${lead.ID} ${ad || telefon}`, 40),
        assistantOverrides: {
          variableValues: { lead_id: String(lead.ID), musteri_adi: ad },
        },
        metadata: { lead_id: String(lead.ID) },
        schedulePlan: hemenAra ? undefined : { earliestAt: trIso(aramaZamani) },
      },
      smsGovde: A.SMS.AKTIF
        ? smsXml({ kullanici: A.SMS.KULLANICI, sifre: A.SMS.SIFRE, baslik: A.SMS.BASLIK, mesaj: A.SMS.METIN, numaralar: smsNumarasi(telefon) })
        : null,
      epostaVarMi: !!(A.EPOSTA.AKTIF && eposta),
    },
  },
];
