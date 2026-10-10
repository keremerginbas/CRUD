// WhatsApp video gönderim sonucuna göre: başarılıysa Video Gönderildi → Asistan Arayacak + insan görevi
const A = $('AYARLAR').first().json;
const p = $('Mesaj Planı').first().json;
const r = $input.first().json;
const basarili = !r.error && !!r.messages && !!r.messages[0] && !!r.messages[0].id;
const simdi = new Date();

const cmd = {};
if (basarili) {
  cmd.upd = bitrixKomut('crm.lead.update', {
    id: p.leadId,
    fields: { STATUS_ID: A.STATU.ASISTAN_ARAYACAK, ASSIGNED_BY_ID: A.FRANCHISE_ASISTAN_SORUMLU_ID || undefined },
  });
  cmd.not = bitrixKomut('crm.timeline.comment.add', {
    fields: { ENTITY_ID: p.leadId, ENTITY_TYPE: 'lead', COMMENT: `✉ Franchise tanıtım videosu WhatsApp'tan gönderildi (${p.telefon}). Aday ilgileniyor — arayıp sunum görüşmesi planlayın.` },
  });
  if (A.FRANCHISE_ASISTAN_SORUMLU_ID) {
    cmd.todo = bitrixKomut('crm.activity.todo.add', {
      ownerTypeId: 1,
      ownerId: p.leadId,
      deadline: trIso(dakikaEkle(simdi, 60)),
      title: kisalt(`XRE Franchise — video gönderildi, arayın: ${p.ad || p.telefon}`, 250),
      description: `Aday yapay zeka görüşmesinde ilgi gösterdi, WhatsApp'tan tanıtım videosu gönderildi. Arayıp 15 dk'lık sunum görüşmesi planlayın.\nTelefon: ${p.telefon}`,
      responsibleId: A.FRANCHISE_ASISTAN_SORUMLU_ID,
    });
  }
} else {
  cmd.not = bitrixKomut('crm.timeline.comment.add', {
    fields: { ENTITY_ID: p.leadId, ENTITY_TYPE: 'lead', COMMENT: `⚠ Franchise tanıtım videosu gönderilemedi (${p.telefon}): ${kisalt(JSON.stringify(r.error || r), 300)}` },
  });
}

return [{ json: { cmd } }];
