// Outbound çağrı bitti (end-of-call-report): sonucu Bitrix'e işle
const A = $('AYARLAR').first().json;
const F = A.ALAN;
const m = $('Mesajı Çöz').first().json;
const r = $input.first().json;
const lead = r && r.result && r.result.ID ? r.result : null;
if (!lead) return [];

const simdi = new Date();
const y = m.yapi || {};
const id = String(lead.ID);
const sonucAlan = String(lead[F.SONUC] || '');
const kuyrukta = lead.STATUS_ID === A.STATU.YAPAY_ZEKA;
// Görüşme sırasında bir araç sonucu yazdıysa (randevu/geri arama/olumsuz) tekrar karar verme
const aracIsledi = !!m.callId && String(lead[F.CAGRI] || '') === m.callId && !/^ARANIYOR/.test(sonucAlan);
const ta = tekrarAraIsaretli(sonucAlan);
const deneme = parseInt(lead[F.DENEME], 10) || m.deneme || 0;
const limit = aramaLimiti(A, sonucAlan);

const cmd = {};
const alanlar = { [F.CAGRI]: m.callId || undefined };
const olaylar = [];
let baslik;
let mesaj; // müşteriye gidecek SMS/WhatsApp türü
const temel = { yon: 'outbound', leadId: id, telefon: m.telefon, ad: isimDuzelt([lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ')), callId: m.callId };

const olumsuzaTasi = (neden, aciklama) => {
  Object.assign(alanlar, { STATUS_ID: A.STATU.OLUMSUZ, [F.SONUC]: neden, [F.DENEME]: 0, [F.SONRAKI]: '', ASSIGNED_BY_ID: siradakiSorumlu(A, lead.ASSIGNED_BY_ID) || undefined });
  baslik = `OLUMSUZ — ${aciklama}`;
  olaylar.push(olay('olumsuz', { ...temel, sonuc: neden, detay: aciklama }));
};
const tekrarPlanla = (dk, sonuc, aciklama) => {
  const t = pencereyeTasi(dakikaEkle(simdi, dk), A.ARAMA_SAATLERI);
  Object.assign(alanlar, { [F.SONRAKI]: trIso(t), [F.SONUC]: sonuc });
  baslik = `${aciklama} (deneme ${deneme}/${limit}) — sonraki arama: ${trMetin(t)}`;
};

if (aracIsledi) {
  baslik = `sonuç görüşme sırasında kaydedildi (${sonucAlan})`;
} else if (!kuyrukta) {
  baslik = `rapor (lead ${lead.STATUS_ID} statüsünde, statüye dokunulmadı)`;
} else if (!m.ulasildi || y.sonuc === 'ulasilamadi') {
  if (deneme >= limit) olumsuzaTasi('ULASILAMADI', `${deneme} denemede ulaşılamadı`);
  else tekrarPlanla(Number(A.ULASILAMADI_TEKRAR_DK), ta ? 'ULASILAMADI_TA' : 'ULASILAMADI', '📵 Ulaşılamadı');
  if (deneme === 1) mesaj = 'tanitim'; // ilk aramada ulaşılamayana bir kez tanıtım SMS/WhatsApp'ı
} else if (y.sonuc === 'olumsuz') {
  const neden = ETIKET[y.olumsuz_nedeni] ? y.olumsuz_nedeni : 'diger';
  olumsuzaTasi(`OLUMSUZ:${neden}`, etiket(neden));
} else if (y.sonuc === 'bilgi_istiyor') {
  // Randevu istemedi ama bilgi istedi → satış temsilcisine devret
  const sorumlu = siradakiSorumlu(A, lead.ASSIGNED_BY_ID);
  Object.assign(cmd, bilgiKomutlari({ A, leadId: id, sorumlu, yon: 'outbound', telefon: m.telefon, ad: temel.ad, ozet: m.ozet, callId: m.callId, onEk: 'b_' }));
  baslik = '📞 BİLGİ İSTİYOR → satış temsilcisine devredildi, arama görevi açıldı';
  olaylar.push(olay('bilgi', { ...temel, detay: bilgiSatiri(y.ilgilendigi_daire, y.odeme_tercihi) }));
  mesaj = 'bilgi';
} else if (y.sonuc === 'randevu') {
  // Randevu konuşulmuş ama araç çağrılmamış/başarısız → satış ekibi saati teyit etsin
  const k = randevuKontrol(y, A, simdi);
  const p = randevuKomutlari({
    A,
    leadId: id,
    tarih: k.tarih || pencereyeTasi(dakikaEkle(simdi, 60), A.ARAMA_SAATLERI),
    arg: { ...y, ad_soyad: isimDuzelt([lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ')) },
    callId: m.callId,
    sorumlu: siradakiSorumlu(A, lead.ASSIGNED_BY_ID),
    yon: 'outbound',
    onEk: 'r_',
    telefon: m.telefon,
    teyitGerekli: true,
  });
  delete p.cmd.r_not; // rapor yorumu aşağıda zaten ekleniyor
  Object.assign(cmd, p.cmd);
  baslik = 'randevu konuşuldu, saat sisteme işlenemedi → TEYİT EDİLMELİ';
  olaylar.push(olay('randevu', { ...temel, teyit: true, randevu: k.tarih ? trIso(k.tarih) : undefined, tarih: k.tarih ? trMetin(k.tarih) : 'teyit edilecek' }));
} else if (deneme >= limit) {
  olumsuzaTasi('SONUCSUZ', `${deneme} görüşmede sonuç alınamadı`);
} else if (y.sonuc === 'tekrar_ara') {
  tekrarPlanla(Number(A.KARARSIZ_TEKRAR_DK), 'TEKRAR_ARA', '🔁 Müşteri daha sonra aranmak istedi');
  olaylar.push(olay('geri_arama', { ...temel, detay: 'görüşme sonu analizinden' }));
  mesaj = 'bilgi';
} else {
  tekrarPlanla(Number(A.KARARSIZ_TEKRAR_DK), ta ? 'KARARSIZ_TA' : 'KARARSIZ', '🤔 Görüşüldü, karar verilmedi');
  if (deneme <= 1) mesaj = 'bilgi';
}
if (aracIsledi && /^TEKRAR_ARA/.test(sonucAlan) && deneme <= 1) mesaj = 'bilgi';

if (!cmd.r_upd && !cmd.b_upd) {
  cmd.upd = bitrixKomut('crm.lead.update', { id, fields: alanlar, params: { REGISTER_SONET_EVENT: 'N' } });
}
cmd.rapor = bitrixKomut('crm.timeline.comment.add', {
  fields: { ENTITY_ID: id, ENTITY_TYPE: 'lead', COMMENT: raporYorumu({ A, m, yon: 'outbound', baslik }) },
});

olaylar.unshift(
  olay('cagri_sonu', {
    ...temel,
    sonuc: m.ulasildi && y.sonuc !== 'ulasilamadi' ? 'ulasildi' : 'ulasilamadi',
    deneme,
    sure: m.sure,
    maliyet: m.maliyet,
    detay: baslik,
    mesaj,
  })
);

return [{ json: { cmd, karar: baslik, olaylar } }];
