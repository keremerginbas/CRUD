// Outbound çağrı bitti (end-of-call-report): sonucu Bitrix'e işle.
// Randevu oluşmadıysa lead "ankaport reklam" statüsünde kalır (tekrar aranmaz, satışçı kendisi arar).
const A = $('AYARLAR').first().json;
const m = $('Mesajı Çöz').first().json;
const r = $input.first().json;
const lead = r && r.result && r.result.ID ? r.result : null;
if (!lead) return [];

const id = String(lead.ID);
const sonucAlan = lead.STATUS_ID === A.STATU.RANDEVU ? String(lead.STATUS_ID) : '';
// Görüşme sırasında randevu_olustur aracı zaten işlediyse (lead RANDEVU'ya taşındıysa) tekrar karar verme
const aracIsledi = !!m.callId && lead.STATUS_ID === A.STATU.RANDEVU;

const y = m.yapi || {};
const cmd = {};
let durumMetni;
let ozetMetni = m.ozet || y.ozet || '';

if (aracIsledi) {
  durumMetni = 'Randevu Oluşturuldu ✅';
} else if (m.hatHatasi) {
  durumMetni = `Aranamadı (hat hatası: ${m.endedReason})`;
} else if (!m.ulasildi) {
  durumMetni = 'Açmadı / Yanıtsız 📵';
} else if (String(y.sonuc || '').toLowerCase() === 'ilgilenmiyor') {
  durumMetni = 'Görüştü, İlgilenmiyor ❌';
} else {
  durumMetni = 'Görüştü, Randevu Alınamadı';
}

cmd.rapor = bitrixKomut('crm.timeline.comment.add', {
  fields: {
    ENTITY_ID: id,
    ENTITY_TYPE: 'lead',
    COMMENT: [
      `☎ ${A.PROJE_ADI} yapay zeka outbound görüşmesi — ${durumMetni}`,
      `Süre: ${sureMetni(m.sure)} | Bitiş: ${m.endedReason || '-'}`,
      ozetMetni ? `Özet: ${kisalt(ozetMetni, 1500)}` : '',
      m.kayit ? `Ses kaydı: ${m.kayit}` : '',
      m.callId ? `Vapi Call ID: ${m.callId}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  },
});

return [
  {
    json: {
      cmd,
      leadId: id,
      ad: isimDuzelt([lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ')),
      telefon: m.telefon,
      sorumluId: String(lead.ASSIGNED_BY_ID || ''),
      formTarihi: trMetin(bitrixTarih(lead.DATE_CREATE) || new Date()),
      statuMetni: aracIsledi ? 'RANDEVU OLUŞTURANLAR' : 'ankaport reklam (değişmedi)',
      durumMetni,
      ozet: kisalt(ozetMetni, 600),
      sure: m.sure,
    },
  },
];
