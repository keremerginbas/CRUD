// Vapi araması başlatılamadıysa: lead'i kısa süre sonra tekrar denenecek şekilde işaretle
const A = $('AYARLAR').first().json;
const F = A.ALAN;
const simdi = new Date();
const cmd = {};
const olaylar = [];

$input.all().forEach((item, i) => {
  const a = $('Aramaları Ayır').itemMatching(i).json;
  const e = item.json.error;
  const hata = kisalt(typeof e === 'string' ? e : (e && (e.description || e.message)) || JSON.stringify(item.json), 400);
  const sonraki = pencereyeTasi(dakikaEkle(simdi, Number(A.HATA_TEKRAR_DK)), A.ARAMA_SAATLERI);

  cmd[`hata_${a.leadId}`] = bitrixKomut('crm.lead.update', {
    id: a.leadId,
    fields: { [F.SONRAKI]: trIso(sonraki), [F.SONUC]: 'HATA' },
    params: { REGISTER_SONET_EVENT: 'N' },
  });
  cmd[`not_${a.leadId}`] = bitrixKomut('crm.timeline.comment.add', {
    fields: {
      ENTITY_ID: a.leadId,
      ENTITY_TYPE: 'lead',
      COMMENT: `⚠️ ${A.PROJE_ADI} yapay zeka araması başlatılamadı (deneme ${a.deneme}/${a.limit}, hat ${a.hat}).\nHata: ${hata}\nSonraki deneme: ${trMetin(sonraki)}`,
    },
  });
  olaylar.push(olay('arama_hatasi', { yon: 'outbound', leadId: a.leadId, telefon: a.telefon, ad: a.ad, deneme: a.deneme, detay: hata }));
});

if (!Object.keys(cmd).length) return [];
return [{ json: { cmd, olaylar } }];
