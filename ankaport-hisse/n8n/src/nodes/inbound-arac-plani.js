// Inbound görüşme sırasında randevu_olustur: mevcut lead'i güncelle ya da yeni lead aç.
const A = $('AYARLAR').first().json;
const m = $('Mesajı Çöz').first().json;
const r = $input.first().json;
const bulunan = (Array.isArray(r.result) ? r.result : []).sort((a, b) => Number(b.ID) - Number(a.ID))[0] || null;
const simdi = new Date();

const cmd = {};
const sonuclar = [];
const kritik = {};
const olaylar = [];

m.toolCalls.forEach((tc, i) => {
  const onEk = `t${i}_`;
  const sonuc = (metin) => sonuclar.push({ toolCallId: tc.id, result: metin });
  if (tc.ad !== 'randevu_olustur') return sonuc(`Bilinmeyen araç: ${tc.ad}`);

  const k = randevuKontrol(tc.arg, A, simdi);
  const telefon = m.telefon || telefonNormalize(tc.arg.iletisim_telefonu);
  if (!bulunan && !telefon) return sonuc('Arayan numara görünmüyor. Müşteriden telefon numarasını iste ve aracı iletisim_telefonu ile tekrar çağır.');

  const ad = isimDuzelt(tc.arg.ad_soyad || (bulunan ? [bulunan.NAME, bulunan.LAST_NAME].filter(Boolean).join(' ') : ''));
  const sorumlu = bulunan ? bulunan.ASSIGNED_BY_ID || undefined : A.VARSAYILAN_SORUMLU_ID || undefined;

  let leadRef;
  let anaKomut;
  if (bulunan) {
    leadRef = String(bulunan.ID);
    anaKomut = `${onEk}upd`;
    cmd[anaKomut] = bitrixKomut('crm.lead.update', { id: leadRef, fields: { STATUS_ID: A.STATU.RANDEVU, ASSIGNED_BY_ID: sorumlu } });
  } else {
    anaKomut = `${onEk}yeni`;
    cmd[anaKomut] = bitrixKomut('crm.lead.add', {
      fields: {
        TITLE: kisalt(`${A.PROJE_ADI} | Inbound | ${ad || telefon}`, 250),
        ...adSoyadBol(ad),
        PHONE: [{ VALUE: telefon, VALUE_TYPE: 'MOBILE' }],
        SOURCE_ID: A.INBOUND_KAYNAK_ID,
        SOURCE_DESCRIPTION: 'Yapay zeka inbound çağrı (Vapi) — Ankaport Hisse',
        STATUS_ID: A.STATU.RANDEVU,
        ASSIGNED_BY_ID: sorumlu,
        OPENED: 'Y',
      },
      params: { REGISTER_SONET_EVENT: 'Y' },
    });
    leadRef = `$result[${anaKomut}]`;
  }

  const detay = [
    `${A.PROJE_ADI} — yapay zeka inbound görüşmesinde randevu ${k.tarih ? 'oluşturuldu' : 'oluşturuldu (GÜN/SAAT BELİRLENMEDİ)'}.`,
    k.tarih ? `Randevu: ${trMetin(k.tarih)}` : 'Randevu: gün ve saat belirlenmedi — müşteriyi arayıp birlikte belirleyin.',
    tc.arg.ilgilendigi_hisse ? `İlgilendiği hisse: ${tc.arg.ilgilendigi_hisse}` : '',
    ad ? `Müşteri: ${ad}` : '',
    telefon ? `Telefon: ${telefon}` : '',
    tc.arg.not ? `Not: ${kisalt(tc.arg.not, 500)}` : '',
    m.callId ? `Vapi Call ID: ${m.callId}` : '',
  ].filter(Boolean);
  cmd[`${onEk}not`] = bitrixKomut('crm.timeline.comment.add', { fields: { ENTITY_ID: leadRef, ENTITY_TYPE: 'lead', COMMENT: `📅 ${detay.join('\n')}` } });
  if (sorumlu) {
    cmd[`${onEk}todo`] = bitrixKomut('crm.activity.todo.add', {
      ownerTypeId: 1,
      ownerId: leadRef,
      deadline: trIso(k.tarih || pencereyeTasi(dakikaEkle(simdi, 15), A.ARAMA_SAATLERI)),
      title: kisalt(`${A.PROJE_ADI} ${k.tarih ? 'randevu' : 'randevu — GÜN/SAAT BELİRLEYİN'} — ${ad || telefon || ''}`, 250),
      description: detay.join('\n'),
      responsibleId: sorumlu,
      pingOffsets: k.tarih ? [1440, 60] : [0],
    });
  }
  kritik[tc.id] = anaKomut;
  olaylar.push({ tur: 'randevu', leadId: leadRef, ad, telefon, sorumlu, tarih: k.tarih ? trMetin(k.tarih) : null, callId: m.callId });

  return sonuc(
    k.tarih
      ? `Randevu kaydedildi: ${trMetin(k.tarih)}. Müşteriye "Randevunuz oluşturuldu" de, danışmanımızın arayıp detayları paylaşacağını söyle, teşekkür et ve görüşmeyi kapat.`
      : 'Randevu kaydedildi. Müşteriye "Randevunuz oluşturuldu, danışmanımız sizi arayıp gün ve saati birlikte belirleyecek." de, teşekkür et ve görüşmeyi kapat. Gün veya saat SORMA.'
  );
});

return [{ json: { cmd, sonuclar, kritik, olaylar, kayitVar: Object.keys(cmd).length > 0 } }];
