// Outbound görüşme sırasında çağrılan tek araç: randevu_olustur.
// Mevcut sorumlu kişi KORUNUR (round-robin yok) — EFAS'tan farklı olarak burada lead'in
// zaten atanmış olduğu kişiyle randevu oluşturuluyor.
const A = $('AYARLAR').first().json;
const m = $('Mesajı Çöz').first().json;
const r = $input.first().json;
const lead = r && r.result && r.result.ID ? r.result : null;
const simdi = new Date();

const cmd = {};
const sonuclar = [];
const kritik = {};
const olaylar = [];

m.toolCalls.forEach((tc, i) => {
  const onEk = `t${i}_`;
  const sonuc = (metin) => sonuclar.push({ toolCallId: tc.id, result: metin });
  if (!lead) return sonuc('Müşteri kaydı sistemde bulunamadı. Müşteriye talebini not aldığını söyle.');
  if (tc.ad !== 'randevu_olustur') return sonuc(`Bilinmeyen araç: ${tc.ad}`);

  const id = String(lead.ID);
  const k = randevuKontrol(tc.arg, A, simdi);
  const ad = isimDuzelt(tc.arg.ad_soyad || [lead.NAME, lead.LAST_NAME].filter(Boolean).join(' '));
  const sorumlu = lead.ASSIGNED_BY_ID || undefined; // mevcut sorumlu korunur

  const detay = [
    `${A.PROJE_ADI} — yapay zeka outbound görüşmesinde randevu ${k.tarih ? 'oluşturuldu' : 'oluşturuldu (GÜN/SAAT BELİRLENMEDİ)'}.`,
    k.tarih ? `Randevu: ${trMetin(k.tarih)}` : 'Randevu: gün ve saat belirlenmedi — müşteriyi arayıp birlikte belirleyin.',
    tc.arg.ilgilendigi_hisse ? `İlgilendiği hisse: ${tc.arg.ilgilendigi_hisse}` : '',
    ad ? `Müşteri: ${ad}` : '',
    m.telefon ? `Telefon: ${m.telefon}` : '',
    tc.arg.not ? `Not: ${kisalt(tc.arg.not, 500)}` : '',
    m.callId ? `Vapi Call ID: ${m.callId}` : '',
  ].filter(Boolean);

  cmd[`${onEk}upd`] = bitrixKomut('crm.lead.update', {
    id,
    fields: { STATUS_ID: A.STATU.RANDEVU, ASSIGNED_BY_ID: sorumlu },
  });
  cmd[`${onEk}not`] = bitrixKomut('crm.timeline.comment.add', {
    fields: { ENTITY_ID: id, ENTITY_TYPE: 'lead', COMMENT: `📅 ${detay.join('\n')}` },
  });
  if (sorumlu) {
    cmd[`${onEk}todo`] = bitrixKomut('crm.activity.todo.add', {
      ownerTypeId: 1,
      ownerId: id,
      deadline: trIso(k.tarih || pencereyeTasi(dakikaEkle(simdi, 15), A.ARAMA_SAATLERI)),
      title: kisalt(`${A.PROJE_ADI} ${k.tarih ? 'randevu' : 'randevu — GÜN/SAAT BELİRLEYİN'} — ${ad || m.telefon || ''}`, 250),
      description: detay.join('\n'),
      responsibleId: sorumlu,
      pingOffsets: k.tarih ? [1440, 60] : [0],
    });
  }
  kritik[tc.id] = `${onEk}upd`;
  olaylar.push({ tur: 'randevu', leadId: id, ad, telefon: m.telefon, sorumlu, tarih: k.tarih ? trMetin(k.tarih) : null, callId: m.callId });

  return sonuc(
    k.tarih
      ? `Randevu kaydedildi: ${trMetin(k.tarih)}. Müşteriye "Randevunuz oluşturuldu" de, danışmanımızın arayıp detayları paylaşacağını söyle, teşekkür et ve görüşmeyi kapat.`
      : 'Randevu kaydedildi. Müşteriye "Randevunuz oluşturuldu, danışmanımız sizi arayıp gün ve saati birlikte belirleyecek." de, teşekkür et ve görüşmeyi kapat. Gün veya saat SORMA.'
  );
});

return [{ json: { cmd, sonuclar, kritik, olaylar, kayitVar: Object.keys(cmd).length > 0 } }];
