// Arama saatleri dışında hiçbir şey yapma (boş çıktı = akış durur)
const A = $('AYARLAR').first().json;
const simdi = new Date();

if (!pencereIcinde(simdi, A.ARAMA_SAATLERI)) return [];

return [
  {
    json: {
      simdi: simdi.toISOString(),
      // Vapi'de son 15 dakikada açılmış ve bitmemiş çağrılar "meşgul hat" sayılır
      aktifCagriBaslangic: dakikaEkle(simdi, -15).toISOString(),
    },
  },
];
