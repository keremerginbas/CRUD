// Outbound görüşme sırasında çağrılan araçlar (randevu / satışa aktar / geri arama / olumsuz)
const A = $('AYARLAR').first().json;
const F = A.ALAN;
const m = $('Mesajı Çöz').first().json;
const r = $input.first().json;
const lead = r && r.result && r.result.ID ? r.result : null;
const simdi = new Date();

const cmd = {};
const sonuclar = [];
const kritik = {}; // toolCallId → başarısı kontrol edilecek batch komutu
const olaylar = []; // _tc: hangi araç çağrısına ait (kayıt başarısızsa gönderilmez)

m.toolCalls.forEach((tc, i) => {
  const onEk = `t${i}_`;
  const sonuc = (metin) => sonuclar.push({ toolCallId: tc.id, result: metin });

  if (!lead) {
    return sonuc('Müşteri kaydı sistemde bulunamadı. Müşteriye talebini not aldığını ve danışmanımızın kendisini arayacağını söyle.');
  }
  const id = String(lead.ID);

  if (tc.ad === 'randevu_olustur') {
    const k = randevuKontrol(tc.arg, A, simdi);
    const arg = { ...tc.arg, ad_soyad: tc.arg.ad_soyad || isimDuzelt([lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ')) };
    const p = randevuKomutlari({
      A,
      leadId: id,
      tarih: k.tarih,
      arg,
      callId: m.callId,
      sorumlu: siradakiSorumlu(A, lead.ASSIGNED_BY_ID),
      yon: 'outbound',
      onEk,
      telefon: m.telefon,
    });
    Object.assign(cmd, p.cmd);
    kritik[tc.id] = p.anaKomut;
    olaylar.push(olay('randevu', { _tc: tc.id, yon: 'outbound', leadId: id, telefon: m.telefon, ad: arg.ad_soyad, detay: bilgiSatiri(arg.ilgilendigi_daire, arg.odeme_tercihi), callId: m.callId, ...randevuOlayi(k.tarih) }));
    return sonuc(randevuYaniti(k.tarih));
  }

  if (tc.ad === 'geri_arama_planla') {
    const t = trTarihSaatCoz(tc.arg.tarih, tc.arg.saat);
    if (!t) return sonuc('Tarih veya saat anlaşılamadı. tarih YYYY-AA-GG, saat SS:DD formatında olmalı. Müşteriyle netleştirip aracı tekrar çağır.');
    if (t.getTime() < simdi.getTime() + 5 * 60000) return sonuc('Bu saat geçmişte. Müşteriye ileri bir zaman sor.');
    if (t.getTime() > simdi.getTime() + 14 * 86400000) return sonuc('Geri arama en fazla 14 gün sonrasına planlanabiliyor. Daha yakın bir zaman sor.');
    const hedef = pencereyeTasi(t, A.ARAMA_SAATLERI);
    cmd[`${onEk}upd`] = bitrixKomut('crm.lead.update', {
      id,
      fields: { STATUS_ID: A.STATU.TEKRAR_ARANACAK || undefined, [F.SONRAKI]: trIso(hedef), [F.SONUC]: 'TEKRAR_ARA', [F.CAGRI]: m.callId || undefined },
      params: { REGISTER_SONET_EVENT: 'N' },
    });
    cmd[`${onEk}not`] = bitrixKomut('crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: id,
        ENTITY_TYPE: 'lead',
        COMMENT: `🔁 ${A.PROJE_ADI} yapay zeka: müşteri tekrar aranmak istedi → ${trMetin(hedef)}${tc.arg.not ? `\nNot: ${kisalt(tc.arg.not, 500)}` : ''}`,
      },
    });
    kritik[tc.id] = `${onEk}upd`;
    olaylar.push(olay('geri_arama', { _tc: tc.id, yon: 'outbound', leadId: id, telefon: m.telefon, detay: trMetin(hedef), callId: m.callId }));
    return sonuc(
      hedef.getTime() === t.getTime()
        ? `Geri arama kaydedildi: ${trMetin(hedef)}. Müşteriye o saatte arayacağımızı söyle ve kibarca görüşmeyi kapat.`
        : `Arama saatlerimiz ${pencereMetni(A.ARAMA_SAATLERI)} olduğu için geri arama ${trMetin(hedef)} olarak kaydedildi. Müşteriye bunu söyle ve kibarca görüşmeyi kapat.`
    );
  }

  if (tc.ad === 'satisa_aktar') {
    const ad = isimDuzelt(tc.arg.ad_soyad || [lead.NAME, lead.LAST_NAME].filter(Boolean).join(' '));
    const p = bilgiKomutlari({
      A,
      leadId: id,
      sorumlu: siradakiSorumlu(A, lead.ASSIGNED_BY_ID),
      yon: 'outbound',
      telefon: m.telefon,
      ad,
      ozet: bilgiSatiri(tc.arg.ilgilendigi_daire, tc.arg.not),
      callId: m.callId,
      onEk,
    });
    Object.assign(cmd, p);
    kritik[tc.id] = `${onEk}upd`;
    olaylar.push(olay('bilgi', { _tc: tc.id, yon: 'outbound', leadId: id, telefon: m.telefon, ad, detay: bilgiSatiri(tc.arg.ilgilendigi_daire, tc.arg.not), callId: m.callId, mesaj: 'bilgi' }));
    return sonuc('Kaydedildi; müşteri satış ekibine aktarıldı. Müşteriye satış temsilcimizin en kısa sürede arayıp detayları aktaracağını söyle, teşekkür et ve görüşmeyi kapat.');
  }

  if (tc.ad === 'olumsuz_kaydet') {
    const neden = ETIKET[tc.arg.neden] ? tc.arg.neden : 'diger';
    cmd[`${onEk}upd`] = bitrixKomut('crm.lead.update', {
      id,
      fields: {
        STATUS_ID: A.STATU.OLUMSUZ,
        [F.SONUC]: `OLUMSUZ:${neden}`,
        [F.DENEME]: 0,
        [F.SONRAKI]: '',
        [F.CAGRI]: m.callId || undefined,
        ASSIGNED_BY_ID: siradakiSorumlu(A, lead.ASSIGNED_BY_ID) || undefined,
      },
    });
    cmd[`${onEk}not`] = bitrixKomut('crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: id,
        ENTITY_TYPE: 'lead',
        COMMENT: `❌ ${A.PROJE_ADI} yapay zeka: OLUMSUZ — ${etiket(neden)}${tc.arg.aciklama ? `\nAçıklama: ${kisalt(tc.arg.aciklama, 500)}` : ''}`,
      },
    });
    kritik[tc.id] = `${onEk}upd`;
    olaylar.push(olay('olumsuz', { _tc: tc.id, yon: 'outbound', leadId: id, telefon: m.telefon, sonuc: neden, detay: etiket(neden), callId: m.callId }));
    return sonuc(
      neden === 'aranmak_istemiyor'
        ? 'Kaydedildi; bu numara bir daha aranmayacak. Rahatsızlık için özür dile, teşekkür et ve görüşmeyi kapat.'
        : 'Kaydedildi. Müşteriye vakit ayırdığı için teşekkür et ve görüşmeyi kibarca kapat.'
    );
  }

  return sonuc(`Bilinmeyen araç: ${tc.ad}`);
});

return [{ json: { cmd, sonuclar, kritik, olaylar, kayitVar: Object.keys(cmd).length > 0 } }];
