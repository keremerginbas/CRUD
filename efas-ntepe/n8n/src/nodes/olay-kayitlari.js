// Gelen olayları "efas_ntepe_olaylar" tablosuna yazılacak satırlara çevirir
const body = $('Olay Webhook').first().json.body || {};
const olaylar = Array.isArray(body.olaylar) ? body.olaylar : [];

return olaylar.map((o) => {
  const z = new Date(o.zaman || Date.now());
  return {
    json: {
      gun: trGun(isNaN(z.getTime()) ? new Date() : z),
      tur: String(o.tur || ''),
      yon: String(o.yon || ''),
      lead_id: String(o.leadId || ''),
      telefon: String(o.telefon || ''),
      ad: kisalt(o.ad, 120),
      sonuc: String(o.sonuc || (o.tur === 'randevu' ? (o.talep ? 'talep' : o.teyit ? 'teyit' : 'kesin') : '')),
      detay: kisalt([o.tarih, o.detay].filter(Boolean).join(' | '), 500),
      sure_sn: Number(o.sure) || 0,
      maliyet: Number(o.maliyet) || 0,
    },
  };
});
