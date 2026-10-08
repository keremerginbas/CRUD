// Inbound çağrı bitti: lead'i bul/aç, sonucu ve satış ekibi görevini Bitrix'e işle
const A = $('AYARLAR').first().json;
const F = A.ALAN;
const m = $('Mesajı Çöz').first().json;
if (!m.ulasildi) return []; // arayan hiç konuşmadan kapattı

const r = $input.first().json;
const lead = efasLeadSec(r && Array.isArray(r.result) ? r.result : [], A);
const simdi = new Date();
const y = m.yapi || {};
const telefon = m.telefon;
const adSoyad = isimDuzelt(y.musteri_adi || (lead ? [lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ') : ''));
const aracIsledi = !!lead && !!m.callId && String(lead[F.CAGRI] || '') === m.callId && /^RANDEVU/.test(String(lead[F.SONUC] || ''));

const cmd = {};
const olaylar = [];
let leadRef = lead ? String(lead.ID) : null;
let baslik;
let mesaj;
const temel = { yon: 'inbound', leadId: leadRef || '', telefon: telefon || '', ad: adSoyad, callId: m.callId };

const yeniLeadAlanlari = (statu, sonuc, sorumlu) => ({
  TITLE: kisalt(`${A.PROJE_ADI} | Inbound Yapay Zeka | ${adSoyad || telefon || 'Numara gizli'}`, 250),
  ...adSoyadBol(adSoyad),
  PHONE: telefon ? [{ VALUE: telefon, VALUE_TYPE: 'MOBILE' }] : undefined,
  STATUS_ID: statu,
  SOURCE_ID: A.INBOUND_KAYNAK_ID,
  SOURCE_DESCRIPTION: 'Yapay zeka inbound çağrı (Vapi)',
  OPENED: 'Y',
  ASSIGNED_BY_ID: sorumlu || undefined,
  [F.SONUC]: sonuc,
  [F.CAGRI]: m.callId || undefined,
});
const takipGorevi = (ref, sorumlu) => {
  const t = pencereyeTasi(dakikaEkle(simdi, 60), A.ARAMA_SAATLERI);
  cmd.takip = bitrixKomut('crm.activity.todo.add', {
    ownerTypeId: 1,
    ownerId: ref,
    deadline: trIso(t),
    title: kisalt(`${A.PROJE_ADI} inbound — müşteriye dönüş yapın (${adSoyad || telefon || ''})`, 250),
    description: [
      `Müşteri ${A.PROJE_ADI} hattını aradı, yapay zeka ile görüştü; randevu oluşmadı.`,
      telefon ? `Telefon: ${telefon}` : '',
      y.geri_arama_zamani ? `İstediği geri arama zamanı: ${y.geri_arama_zamani}` : '',
      m.ozet ? `Özet: ${kisalt(m.ozet, 1000)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    responsibleId: sorumlu || undefined,
  });
};

if (aracIsledi) {
  baslik = 'randevu görüşme sırasında oluşturuldu';
} else if (y.sonuc === 'randevu') {
  // Randevu konuşulmuş ama araç çağrılmamış/başarısız → teyit görevi
  const k = randevuKontrol(y, A, simdi);
  const sorumlu = siradakiSorumlu(A, lead ? lead.ASSIGNED_BY_ID : '');
  const p = randevuKomutlari({
    A,
    leadId: leadRef,
    yeniLead: lead ? null : yeniLeadAlanlari(A.STATU.RANDEVU, 'RANDEVU_TEYIT', sorumlu),
    tarih: k.tarih,
    arg: { ...y, ad_soyad: adSoyad },
    callId: m.callId,
    sorumlu,
    yon: 'inbound',
    onEk: 'r_',
    telefon,
    teyitGerekli: true,
  });
  delete p.cmd.r_not;
  Object.assign(cmd, p.cmd);
  leadRef = p.ref;
  baslik = k.tarih ? 'randevu konuşuldu, araç çağrılmadı → SAAT TEYİT EDİLMELİ' : 'randevu istedi → gün/saat satış temsilcisince belirlenecek';
  olaylar.push(olay('randevu', { ...temel, ...randevuOlayi(k.tarih), teyit: !!k.tarih, mesaj: k.tarih ? undefined : 'randevu_talep' }));
} else if (y.sonuc === 'olumsuz' || y.sonuc === 'yanlis_arama') {
  if (!lead) return []; // tanımadığımız biri yanlış aradıysa kayıt açma
  baslik = y.sonuc === 'yanlis_arama' ? 'yanlış arama' : `olumsuz — ${etiket(y.olumsuz_nedeni)}`;
  if (kuyrukStatuleri(A).includes(lead.STATUS_ID)) {
    const neden = ETIKET[y.olumsuz_nedeni] ? y.olumsuz_nedeni : 'diger';
    cmd.upd = bitrixKomut('crm.lead.update', {
      id: leadRef,
      fields: {
        STATUS_ID: A.STATU.OLUMSUZ,
        [F.SONUC]: `OLUMSUZ:${neden}`,
        [F.DENEME]: 0,
        [F.SONRAKI]: '',
        [F.CAGRI]: m.callId || undefined,
        ASSIGNED_BY_ID: siradakiSorumlu(A, lead.ASSIGNED_BY_ID) || undefined,
      },
    });
    baslik += ' → lead OLUMSUZ statüsüne taşındı';
    olaylar.push(olay('olumsuz', { ...temel, sonuc: `OLUMSUZ:${neden}`, detay: etiket(neden) }));
  }
} else {
  // Bilgi aldı / sonra aranmak istiyor / diğer → satış ekibi dönüş yapsın
  mesaj = 'bilgi';
  const satisa = y.sonuc !== 'diger'; // satış dışı konu (mevcut müşteri, şikâyet) satış sırasına girmez
  if (lead && satisa && [...kuyrukStatuleri(A), A.STATU.OLUMSUZ].includes(lead.STATUS_ID)) {
    // Arama kuyruğundaki / olumsuzdaki lead bilgi istiyor → satış temsilcisine devret
    Object.assign(cmd, bilgiKomutlari({ A, leadId: leadRef, sorumlu: siradakiSorumlu(A, lead.ASSIGNED_BY_ID), yon: 'inbound', telefon, ad: adSoyad, ozet: m.ozet, callId: m.callId, onEk: 'b_' }));
    baslik = '📞 BİLGİ İSTİYOR → satış temsilcisine devredildi, arama görevi açıldı';
    olaylar.push(olay('bilgi', { ...temel, detay: bilgiSatiri(y.ilgilendigi_daire) }));
  } else if (lead) {
    takipGorevi(leadRef, lead.ASSIGNED_BY_ID);
    baslik = 'randevu oluşmadı — sorumluya dönüş görevi açıldı';
  } else {
    const sorumlu = siradakiSorumlu(A);
    cmd.yeni = bitrixKomut('crm.lead.add', {
      fields: yeniLeadAlanlari(A.STATU.INBOUND_YENI, 'INBOUND_BILGI', sorumlu),
      params: { REGISTER_SONET_EVENT: 'Y' },
    });
    leadRef = '$result[yeni]';
    takipGorevi(leadRef, sorumlu);
    baslik = 'yeni arayan — lead açıldı, sorumluya dönüş görevi verildi';
    if (satisa) olaylar.push(olay('bilgi', { ...temel, detay: bilgiSatiri(y.ilgilendigi_daire) }));
  }
}

cmd.rapor = bitrixKomut('crm.timeline.comment.add', {
  fields: { ENTITY_ID: leadRef, ENTITY_TYPE: 'lead', COMMENT: raporYorumu({ A, m, yon: 'inbound', baslik }) },
});

olaylar.unshift(olay('cagri_sonu', { ...temel, sonuc: y.sonuc || 'diger', sure: m.sure, maliyet: m.maliyet, detay: baslik, mesaj }));

// Ses kaydı ayrı bir yorumda dosya olarak eklenir (Ses Kaydı Hazırla → İndir → Bitrix)
const ses = m.kayit && leadRef
  ? { leadRef: String(leadRef), url: m.kayit, dosyaAdi: `efas-inbound-${trIso(simdi).slice(0, 16).replace(/[^0-9]/g, '')}`, baslik: `🎧 Görüşme ses kaydı (gelen arama, ${sureMetni(m.sure)})` }
  : null;

return [{ json: { cmd, karar: baslik, olaylar, ses } }];
