// Outbound çağrı bitti (end-of-call-report): sonucu Bitrix'e işler.
// Statü akışı: ARANACAK → (açmadı → tekrar ARANACAK / tükendi|DNC|olumsuz|yanlış kişi → AI_GORUSTU)
//                      → (ilgileniyor/randevu → İLGİLENİYOR, video istediyse ayrıca WhatsApp gönderimi tetiklenir)
const A = $('AYARLAR').first().json;
const F = A.ALAN;
const m = $('Mesajı Çöz').first().json;
const r = $input.first().json;
const lead = r && r.result && r.result.ID ? r.result : null;
if (!lead) return [];

const id = String(lead.ID);
const simdi = new Date();
const y = m.yapi || {};
const deneme = parseInt(lead[F.DENEME], 10) || 0;
const sonuc = String(y.arama_sonucu || '').toLowerCase();
const ilgiSicak = ['kararsiz', 'sicak', 'cok_sicak'].includes(String(y.ilgi_seviyesi || '').toLowerCase());
const ilgileniyor = sonuc === 'randevu' || sonuc === 'dusunuyor' || ilgiSicak;

const cmd = {};
const alanlar = { [F.CAGRI]: m.callId || undefined };
let baslik;
let whatsappGonder = false;

const kapat = (statu, sonucKodu, metin) => {
  Object.assign(alanlar, { STATUS_ID: statu, [F.SONUC]: sonucKodu, [F.SONRAKI]: '' });
  baslik = metin;
};

if (m.hatHatasi) {
  const t = pencereyeTasi(dakikaEkle(simdi, Number(A.HATA_TEKRAR_DK)), A.ARAMA_SAATLERI);
  Object.assign(alanlar, { [F.SONRAKI]: trIso(t), [F.SONUC]: 'HAT_HATASI', [F.DENEME]: Math.max(0, deneme - 1) });
  baslik = `⚠️ Hat hatası (${m.endedReason}) — deneme sayılmadı, sonraki arama: ${trMetin(t)}`;
} else if (y.dnc_talebi === true) {
  kapat(A.STATU.AI_GORUSTU, 'DNC', '🚫 Aday bir daha aranmak istemedi (DNC) — bir daha aranmayacak.');
} else if (sonuc === 'yanlis_kisi') {
  kapat(A.STATU.AI_GORUSTU, 'YANLIS_KISI', '☎ Yanlış kişi/numara.');
} else if (sonuc === 'olumsuz') {
  kapat(A.STATU.AI_GORUSTU, 'OLUMSUZ', '❌ İlgilenmiyor.');
} else if (!m.ulasildi || sonuc === 'ulasilamadi') {
  if (deneme >= Number(A.MAX_DENEME)) {
    kapat(A.STATU.AI_GORUSTU, 'ULASILAMADI_TUKENDI', `📵 ${deneme} aramada ulaşılamadı, deneme hakkı tükendi.`);
  } else {
    const dk = [].concat(A.ULASILAMADI_TEKRAR_DK).map(Number).filter((x) => x > 0);
    const bekleme = dk[Math.min(deneme - 1, dk.length - 1)] || 240;
    const t = pencereyeTasi(dakikaEkle(simdi, bekleme), A.ARAMA_SAATLERI);
    Object.assign(alanlar, { [F.SONRAKI]: trIso(t), [F.SONUC]: 'ULASILAMADI' });
    baslik = `📵 Ulaşılamadı (deneme ${deneme}/${A.MAX_DENEME}) — sonraki arama: ${trMetin(t)}`;
  }
} else if (sonuc === 'geri_aranacak') {
  const t = bitrixTarih(y.aranacak_saat);
  const hedef = t && t.getTime() > simdi.getTime() ? pencereyeTasi(t, A.ARAMA_SAATLERI) : pencereyeTasi(dakikaEkle(simdi, 240), A.ARAMA_SAATLERI);
  Object.assign(alanlar, { [F.SONRAKI]: trIso(hedef), [F.SONUC]: 'GERI_ARANACAK' });
  baslik = `🔁 Aday tekrar aranmak istedi — ${trMetin(hedef)}`;
} else if (ilgileniyor) {
  Object.assign(alanlar, { STATUS_ID: A.STATU.ILGILENIYOR, [F.SONUC]: sonuc === 'randevu' ? 'RANDEVU' : 'ILGILENIYOR', [F.SONRAKI]: '' });
  baslik = sonuc === 'randevu' ? '📅 Randevu — franchise sunum görüşmesi istedi.' : '🙂 İlgileniyor.';
  if (y.link_istegi === true) whatsappGonder = true;
} else {
  kapat(A.STATU.AI_GORUSTU, 'GORUSTU', '🤔 Görüştü, net ilgi/olumsuz belirtmedi.');
}

const detay = [
  `☎ ${A.PROJE_ADI} yapay zeka araması — ${baslik}`,
  `Süre: ${sureMetni(m.sure)} | Bitiş: ${m.endedReason || '-'}`,
  y.xre_bilgi_durumu ? `XRE biliyor mu: ${y.xre_bilgi_durumu}` : '',
  y.ofis_durumu ? `Ofis durumu: ${y.ofis_durumu}` : '',
  y.bolge ? `Bölge: ${y.bolge}` : '',
  y.ilgi_seviyesi ? `İlgi seviyesi: ${y.ilgi_seviyesi}` : '',
  y.call_summary ? `Özet: ${kisalt(y.call_summary, 1200)}` : '',
  m.kayit ? `Ses kaydı: ${m.kayit}` : '',
  m.callId ? `Vapi Call ID: ${m.callId}` : '',
].filter(Boolean);

const cmdFields = Object.fromEntries(Object.entries(alanlar).filter(([, v]) => v !== undefined));
cmd.upd = bitrixKomut('crm.lead.update', { id, fields: cmdFields, params: { REGISTER_SONET_EVENT: 'N' } });
cmd.rapor = bitrixKomut('crm.timeline.comment.add', { fields: { ENTITY_ID: id, ENTITY_TYPE: 'lead', COMMENT: detay.join('\n') } });

return [
  {
    json: {
      cmd,
      leadId: id,
      ad: isimDuzelt([lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ')) || y.extracted_name || '',
      telefon: m.telefon,
      whatsappGonder,
      karar: baslik,
    },
  },
];
