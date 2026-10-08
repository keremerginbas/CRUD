// Rapor için Bitrix sayımları: statü başına lead sayısı + bugüne kadar en az bir kez aranan lead sayısı
const A = $('AYARLAR').first().json;
const S = A.STATU;
const say = (filtre) => bitrixKomut('crm.lead.list', { filter: filtre, select: ['ID'] });
const cmd = { toplamAranan: say({ [`!${A.ALAN.CAGRI}`]: '' }) };
for (const k of ['YAPAY_ZEKA', 'ARADI', 'TEKRAR_ARANACAK', 'ACMAYANLAR']) if (S[k]) cmd[k] = say({ STATUS_ID: S[k] });

// Satış danışmanlarına düşen yapay zeka lead'leri: bugün (statüsü bugün değişen) randevu / bilgi / olumsuz + toplam
const p = trParcalar(new Date());
const bugun = `${p.yil}-${pad2(p.ay)}-${pad2(p.gun)}T00:00:00+03:00`;
const ai = { [`!${A.ALAN.CAGRI}`]: '' };
cmd.bugunAranan = say({ ...ai, '>=DATE_MODIFY': bugun });
const danismanlar = (Array.isArray(A.SATIS_SORUMLU_IDLERI) ? A.SATIS_SORUMLU_IDLERI : []).map(String).filter(Boolean).slice(0, 10);
for (const id of danismanlar) {
  for (const [k, st] of [['r', S.RANDEVU], ['b', S.BILGI], ['o', S.OLUMSUZ]]) {
    if (st) cmd[`d${id}_${k}`] = say({ ...ai, ASSIGNED_BY_ID: id, STATUS_ID: st, '>=DATE_MODIFY': bugun });
  }
  cmd[`d${id}_t`] = say({ ...ai, ASSIGNED_BY_ID: id, STATUS_ID: [S.RANDEVU, S.BILGI, S.OLUMSUZ].filter(Boolean) });
}
return [{ json: { cmd } }];
