// Vapi araması başlatılamadıysa: adayı kısa süre sonra tekrar denenecek şekilde işaretle
const A = $('AYARLAR').first().json;
const F = A.ALAN;
const simdi = new Date();
const cmd = {};

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
      COMMENT: `⚠️ ${A.PROJE_ADI} yapay zeka araması başlatılamadı (deneme ${a.deneme}, hat ${a.hat}).\nHata: ${hata}\nSonraki deneme: ${trMetin(sonraki)}`,
    },
  });
});

if (!Object.keys(cmd).length) return [];
return [{ json: { cmd } }];
