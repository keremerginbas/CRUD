// Inbound görüşme sırasında randevu_olustur: mevcut EFAS lead'ini güncelle ya da yeni lead aç
const A = $('AYARLAR').first().json;
const m = $('Mesajı Çöz').first().json;
const r = $input.first().json;
const lead = efasLeadSec(r && Array.isArray(r.result) ? r.result : [], A);
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
  if (!lead && !telefon) {
    return sonuc('Arayan numara görünmüyor. Müşteriden telefon numarasını iste ve aracı iletisim_telefonu ile tekrar çağır.');
  }
  const adSoyad = isimDuzelt(tc.arg.ad_soyad || (lead ? [lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ') : ''));

  let sorumlu;
  let yeniLead = null;
  if (lead) {
    sorumlu = siradakiSorumlu(A, lead.ASSIGNED_BY_ID);
  } else {
    sorumlu = siradakiSorumlu(A);
    yeniLead = {
      TITLE: kisalt(`${A.PROJE_ADI} | Inbound Yapay Zeka | ${adSoyad || telefon}`, 250),
      ...adSoyadBol(adSoyad),
      PHONE: [{ VALUE: telefon, VALUE_TYPE: 'MOBILE' }],
      SOURCE_ID: A.INBOUND_KAYNAK_ID,
      SOURCE_DESCRIPTION: 'Yapay zeka inbound çağrı (Vapi)',
      OPENED: 'Y',
    };
  }

  const p = randevuKomutlari({
    A,
    leadId: lead ? String(lead.ID) : null,
    yeniLead,
    tarih: k.tarih,
    arg: { ...tc.arg, ad_soyad: adSoyad },
    callId: m.callId,
    sorumlu,
    yon: 'inbound',
    onEk,
    telefon,
  });
  Object.assign(cmd, p.cmd);
  kritik[tc.id] = p.anaKomut;
  olaylar.push(olay('randevu', { _tc: tc.id, yon: 'inbound', leadId: lead ? String(lead.ID) : '', telefon, ad: adSoyad, detay: bilgiSatiri(tc.arg.ilgilendigi_daire, tc.arg.odeme_tercihi), callId: m.callId, ...randevuOlayi(k.tarih) }));
  return sonuc(randevuYaniti(k.tarih));
});

return [{ json: { cmd, sonuclar, kritik, olaylar, kayitVar: Object.keys(cmd).length > 0 } }];
