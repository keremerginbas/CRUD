// Inbound çağrı bitti (end-of-call-report): sonucu Bitrix'e işle.
const A = $('AYARLAR').first().json;
const m = $('Mesajı Çöz').first().json;
const r = $input.first().json;
const lead = (Array.isArray(r.result) ? r.result : []).sort((a, b) => Number(b.ID) - Number(a.ID))[0] || null;

const aracIsledi = !!lead && lead.STATUS_ID === A.STATU.RANDEVU && !!m.callId;
const y = m.yapi || {};
const cmd = {};
let durumMetni;
let ozetMetni = m.ozet || y.ozet || '';

if (aracIsledi) {
  durumMetni = 'Randevu Oluşturuldu ✅';
} else if (String(y.sonuc || '').toLowerCase() === 'ilgilenmiyor') {
  durumMetni = 'Görüştü, İlgilenmiyor ❌';
} else if (!lead) {
  durumMetni = 'Görüşüldü (lead eşleşmedi)';
} else {
  durumMetni = 'Görüştü, Randevu Alınamadı';
}

if (lead) {
  cmd.rapor = bitrixKomut('crm.timeline.comment.add', {
    fields: {
      ENTITY_ID: lead.ID,
      ENTITY_TYPE: 'lead',
      COMMENT: [
        `☎ ${A.PROJE_ADI} yapay zeka inbound görüşmesi — ${durumMetni}`,
        `Süre: ${sureMetni(m.sure)} | Bitiş: ${m.endedReason || '-'}`,
        ozetMetni ? `Özet: ${kisalt(ozetMetni, 1500)}` : '',
        m.kayit ? `Ses kaydı: ${m.kayit}` : '',
        m.callId ? `Vapi Call ID: ${m.callId}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  });
}

return [
  {
    json: {
      cmd,
      leadId: lead ? String(lead.ID) : '',
      ad: lead ? isimDuzelt([lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ')) : '',
      telefon: m.telefon,
      sorumluId: lead ? String(lead.ASSIGNED_BY_ID || '') : '',
      formTarihi: lead ? trMetin(bitrixTarih(lead.DATE_CREATE) || new Date()) : trMetin(new Date()),
      statuMetni: aracIsledi ? 'RANDEVU OLUŞTURANLAR' : lead ? 'ankaport reklam (değişmedi)' : 'eşleşen lead yok',
      durumMetni,
      ozet: kisalt(ozetMetni, 600),
      sure: m.sure,
    },
  },
];
