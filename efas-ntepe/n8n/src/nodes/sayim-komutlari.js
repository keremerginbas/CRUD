// Rapor için Bitrix sayımları: statü başına lead sayısı + bugüne kadar en az bir kez aranan lead sayısı
const A = $('AYARLAR').first().json;
const S = A.STATU;
const say = (filtre) => bitrixKomut('crm.lead.list', { filter: filtre, select: ['ID'] });
const cmd = { toplamAranan: say({ [`!${A.ALAN.CAGRI}`]: '' }) };
for (const k of ['YAPAY_ZEKA', 'ARADI', 'TEKRAR_ARANACAK', 'ACMAYANLAR']) if (S[k]) cmd[k] = say({ STATUS_ID: S[k] });
return [{ json: { cmd } }];
