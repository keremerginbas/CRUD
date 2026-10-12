// Bulunan/yeni oluşturulan lead'i crm.lead.get ile aynı şekle getirir (Outbound Rapor Planı bunu bekliyor)
const A = $('AYARLAR').first().json;
const plan = $('Inbound Lead Planı').first().json;
const m = $('Mesajı Çöz').first().json;

let lead;
if (plan.bulunan) {
  const liste = Array.isArray($('Bitrix: Telefonla Lead Detayı').first().json.result) ? $('Bitrix: Telefonla Lead Detayı').first().json.result : [];
  lead = liste[0];
} else {
  const yanit = $input.first().json;
  const id = batchSonuclari(yanit).yeni;
  lead = {
    ID: String(id),
    STATUS_ID: A.STATU.ARANACAK,
    NAME: plan.ad || '',
    LAST_NAME: '',
    PHONE: [{ VALUE: m.telefon, VALUE_TYPE: 'MOBILE' }],
    EMAIL: [],
    ASSIGNED_BY_ID: plan.sorumlu || '',
    [A.ALAN.DENEME]: 0,
  };
}

return [{ json: { result: lead } }];
