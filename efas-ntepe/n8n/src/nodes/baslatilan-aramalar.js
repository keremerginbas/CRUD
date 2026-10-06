// Başlayan aramaların Vapi call ID'sini lead'e yazar ve Olay Merkezi için olay üretir
const F = $('AYARLAR').first().json.ALAN;
const cmd = {};
const olaylar = [];

$input.all().forEach((item, i) => {
  const a = $('Aramaları Ayır').itemMatching(i).json;
  if (!item.json.id) return;
  cmd[`cagri_${a.leadId}`] = bitrixKomut('crm.lead.update', {
    id: a.leadId,
    fields: { [F.CAGRI]: item.json.id },
    params: { REGISTER_SONET_EVENT: 'N' },
  });
  olaylar.push(olay('arama', { yon: 'outbound', leadId: a.leadId, telefon: a.telefon, ad: a.ad, deneme: a.deneme, callId: item.json.id, detay: `hat ${a.hat}` }));
});

if (!Object.keys(cmd).length) return [];
return [{ json: { cmd, olaylar } }];
