// Huni (funnel) raporu — her statüdeki aday sayısı
const A = $('AYARLAR').first().json;
const sayim = (($('Bitrix: Statü Sayıları').first().json || {}).result || {}).result_total || {};
const adet = (k) => Number(sayim[k]) || 0;
const sayi = (n) => Number(n || 0).toLocaleString('tr-TR');
const simdi = new Date();

const SIRA = [
  ['ARANACAK', '📋 Aranacak'],
  ['AI_GORUSTU', '☎ AI Görüştü (ilgisiz/ulaşılamadı/DNC)'],
  ['ILGILENIYOR', '🙂 İlgileniyor'],
  ['VIDEO_GONDERILDI', '✉ Video Gönderildi'],
  ['ASISTAN_ARAYACAK', '👩‍💼 Asistan Arayacak'],
  ['SUNUM_YAPILDI', '🖥 Sunum Yapıldı'],
  ['ERDAL_ONAYI', '✅ Erdal Bey Onayı'],
  ['SOZLESME', '📝 Sözleşme'],
  ['FRANCHISE_ACILIS', '🏢 Franchise Açılış'],
];

const metin = [
  `<b>📊 ${A.PROJE_ADI} — Huni Raporu</b>`,
  trMetin(simdi),
  '',
  ...SIRA.map(([k, etiket]) => `${etiket}: <b>${sayi(adet(k))}</b>`),
];

return [{ json: { metin: metin.join('\n') } }];
