// Arayan numara Bitrix'te bulunamadıysa yeni lead açma planı (bulunduysa yapılacak bir şey yok)
const A = $('AYARLAR').first().json;
const m = $('Mesajı Çöz').first().json;
const liste = Array.isArray($input.first().json.result) ? $input.first().json.result : [];
const bulunan = liste[0] || null;

if (bulunan) return [{ json: { cmd: {}, bulunan: true } }];

const y = m.yapi || {};
const ad = isimDuzelt(y.extracted_name || '');
const sorumlu = A.INBOUND_VARSAYILAN_SORUMLU_ID || A.FRANCHISE_ASISTAN_SORUMLU_ID || undefined;

const cmd = {
  yeni: bitrixKomut('crm.lead.add', {
    fields: {
      TITLE: kisalt(`${A.PROJE_ADI} | Inbound | ${ad || m.telefon}`, 250),
      ...adSoyadBol(ad),
      PHONE: [{ VALUE: m.telefon, VALUE_TYPE: 'MOBILE' }],
      SOURCE_ID: A.INBOUND_KAYNAK_ID,
      SOURCE_DESCRIPTION: `Yapay zeka inbound çağrı (Vapi) — ${A.PROJE_ADI}`,
      STATUS_ID: A.STATU.ARANACAK,
      ASSIGNED_BY_ID: sorumlu,
      OPENED: 'Y',
    },
    params: { REGISTER_SONET_EVENT: 'Y' },
  }),
};

return [{ json: { cmd, bulunan: false, ad, sorumlu } }];
