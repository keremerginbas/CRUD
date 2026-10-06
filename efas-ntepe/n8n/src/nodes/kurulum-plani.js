// Bitrix'te gerekli lead alanlarını oluşturur (varsa hata verir, sorun değil) ve statüleri listeler
const A = $('AYARLAR').first().json;
const F = A.ALAN;

const TANIMLAR = [
  { kod: F.DENEME, tip: 'integer', etiket: 'EFAS AI Arama Denemesi' },
  { kod: F.SONRAKI, tip: 'datetime', etiket: 'EFAS AI Sonraki Arama' },
  { kod: F.SONUC, tip: 'string', etiket: 'EFAS AI Son Sonuç' },
  { kod: F.CAGRI, tip: 'string', etiket: 'EFAS AI Vapi Call ID' },
  { kod: F.RANDEVU, tip: 'datetime', etiket: 'EFAS AI Randevu Tarihi' },
];

const cmd = {
  mevcut: bitrixKomut('crm.lead.userfield.list', { order: { ID: 'ASC' } }),
  statuler: bitrixKomut('crm.status.list', { filter: { ENTITY_ID: 'STATUS' } }),
};
TANIMLAR.forEach((t, i) => {
  cmd[`ekle_${i}`] = bitrixKomut('crm.lead.userfield.add', {
    fields: {
      FIELD_NAME: t.kod.replace(/^UF_CRM_/, ''),
      USER_TYPE_ID: t.tip,
      XML_ID: t.kod,
      LABEL: t.etiket,
      EDIT_FORM_LABEL: t.etiket,
      LIST_COLUMN_LABEL: t.etiket,
      LIST_FILTER_LABEL: t.etiket,
      MANDATORY: 'N',
      SHOW_FILTER: 'Y',
      SHOW_IN_LIST: 'Y',
      EDIT_IN_LIST: 'Y',
    },
  });
});

return [{ json: { cmd, tanimlar: TANIMLAR } }];
