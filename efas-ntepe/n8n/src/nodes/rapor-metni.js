// Bugünün olaylarından Telegram raporu üretir
const A = $('AYARLAR').first().json;
if (!A.TELEGRAM.AKTIF) return [];

const satirlar = $('Tablo: Bugünün Olayları')
  .all()
  .map((i) => i.json)
  .filter((r) => r && r.tur);
const sayim = (($('Bitrix: Statü Sayıları').first().json || {}).result || {}).result_total || {};
const adet = (k) => Number(sayim[k]) || 0;
const kuyrukToplam = ['YAPAY_ZEKA', 'ARADI', 'TEKRAR_ARANACAK', 'ACMAYANLAR'].reduce((t, k) => t + adet(k), 0);
const simdi = new Date();
const p = trParcalar(simdi);

const html = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sayi = (n) => Number(n || 0).toLocaleString('tr-TR');
const say = (f) => satirlar.filter(f).length;

const arama = say((r) => r.tur === 'arama');
const aramaHata = say((r) => r.tur === 'arama_hatasi');
const arananKisi = new Set(satirlar.filter((r) => r.tur === 'arama').map((r) => r.lead_id || r.telefon)).size;
const outSon = satirlar.filter((r) => r.tur === 'cagri_sonu' && r.yon === 'outbound');
const ulasilan = outSon.filter((r) => r.sonuc === 'ulasildi').length;
const ulasilamayan = outSon.length - ulasilan;
const inbound = say((r) => r.tur === 'cagri_sonu' && r.yon === 'inbound');
const randevular = satirlar.filter((r) => r.tur === 'randevu');
const teyit = randevular.filter((r) => r.sonuc === 'teyit').length;
const talep = randevular.filter((r) => r.sonuc === 'talep').length;
const rOut = randevular.filter((r) => r.yon === 'outbound').length;
const olumsuz = say((r) => r.tur === 'olumsuz');
const geriArama = say((r) => r.tur === 'geri_arama');
const bilgi = say((r) => r.tur === 'bilgi');
const smsOk = say((r) => r.tur === 'sms' && r.sonuc === 'ok');
const smsHata = say((r) => r.tur === 'sms' && r.sonuc !== 'ok');
const waOk = say((r) => r.tur === 'whatsapp' && r.sonuc === 'ok');
const waHata = say((r) => r.tur === 'whatsapp' && r.sonuc !== 'ok');
const epOk = say((r) => r.tur === 'eposta' && r.sonuc === 'ok');
const epHata = say((r) => r.tur === 'eposta' && r.sonuc !== 'ok');
const sureDk = Math.round(satirlar.filter((r) => r.tur === 'cagri_sonu').reduce((t, r) => t + (Number(r.sure_sn) || 0), 0) / 60);
const maliyet = satirlar.filter((r) => r.tur === 'cagri_sonu').reduce((t, r) => t + (Number(r.maliyet) || 0), 0);
const oran = outSon.length ? Math.round((100 * ulasilan) / outSon.length) : 0;

const metin = [
  `<b>📊 ${html(A.PROJE_ADI)} — Yapay Zeka ${p.saat < 17 ? 'Ara Rapor' : 'Gün Sonu Raporu'}</b>`,
  `${trMetin(simdi)} itibarıyla`,
  '',
  `📞 Arama: <b>${sayi(arama)}</b> · aranan kişi ${sayi(arananKisi)}${aramaHata ? ` (başlatılamayan ${sayi(aramaHata)})` : ''}`,
  `✅ Ulaşılan: ${sayi(ulasilan)} · 📵 Ulaşılamayan: ${sayi(ulasilamayan)} · Ulaşma %${oran}`,
  `📥 Gelen arama (inbound): ${sayi(inbound)}`,
  `📅 Randevu: <b>${sayi(randevular.length)}</b> (outbound ${sayi(rOut)} · inbound ${sayi(randevular.length - rOut)}${teyit ? ` · teyit bekleyen ${sayi(teyit)}` : ''}${talep ? ` · saati belirlenecek ${sayi(talep)}` : ''})`,
  `📞 Bilgi isteyen (satışa devredilen): ${sayi(bilgi)}`,
  `🔁 Geri arama sözü: ${sayi(geriArama)} · ❌ Olumsuz: ${sayi(olumsuz)}`,
  `💬 SMS: ${sayi(smsOk)}${smsHata ? ` (hata ${sayi(smsHata)})` : ''} · WhatsApp: ${sayi(waOk)}${waHata ? ` (hata ${sayi(waHata)})` : ''} · E-posta: ${sayi(epOk)}${epHata ? ` (hata ${sayi(epHata)})` : ''}`,
  `⏱ Konuşma: ${sayi(sureDk)} dk · 💰 Vapi: $${maliyet.toFixed(2)}`,
  '',
  `📈 Bugüne kadar aranan kişi (toplam): <b>${sayi(adet('toplamAranan'))}</b>`,
  `📋 Kuyrukta bekleyen lead: ${sayi(kuyrukToplam)}`,
  `   hiç aranmamış ${sayi(adet('YAPAY_ZEKA'))} · aradı ${sayi(adet('ARADI'))} · tekrar aranacak ${sayi(adet('TEKRAR_ARANACAK'))} · açmayanlar ${sayi(adet('ACMAYANLAR'))}`,
];

if (randevular.length) {
  metin.push('', '<b>Bugünün randevuları</b>');
  for (const r of randevular.slice(0, 25)) {
    metin.push(`• ${html(r.ad || r.telefon || '-')} — ${r.sonuc === 'talep' ? 'gün/saat belirlenecek' : html((r.detay || '').split(' | ')[0])}${r.sonuc === 'teyit' ? ' ⚠️' : ''}`);
  }
  if (randevular.length > 25) metin.push(`… ve ${randevular.length - 25} randevu daha`);
}

return [{ json: { metin: metin.join('\n') } }];
