// Başlayan aramaların Vapi call ID'sini lead'e yazar
const F = $('AYARLAR').first().json.ALAN;
const cmd = {};

$input.all().forEach((item, i) => {
  const a = $('Aramaları Ayır').itemMatching(i).json;
  if (!item.json.id) return;
  cmd[`cagri_${a.leadId}`] = bitrixKomut('crm.lead.update', {
    id: a.leadId,
    fields: { [F.CAGRI]: item.json.id },
    params: { REGISTER_SONET_EVENT: 'N' },
  });
});

if (!Object.keys(cmd).length) return [];
return [{ json: { cmd } }];
