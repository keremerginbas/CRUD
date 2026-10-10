// Rapor için Bitrix sayımları: huni (funnel) — her statüdeki toplam adet
const A = $('AYARLAR').first().json;
const say = (filtre) => bitrixKomut('crm.lead.list', { filter: filtre, select: ['ID'] });
const cmd = {};
for (const [ad, kod] of Object.entries(A.STATU)) cmd[ad] = say({ STATUS_ID: kod });
return [{ json: { cmd } }];
