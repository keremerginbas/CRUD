// Gönderilen SMS / WhatsApp / e-postayı lead'in zaman akışına yorum olarak yazar
const KANAL = { sms: '💬 SMS', whatsapp: '🟢 WhatsApp', eposta: '📧 E-posta' };
const cmd = {};
$input.all().forEach((item, i) => {
  const r = item.json || {};
  const plan = $('Mesaj Planı').itemMatching(i).json;
  const leadId = String(plan.leadId || r.lead_id || '');
  if (!/^\d+$/.test(leadId) || !KANAL[plan.kanal]) return;
  const ok = r.sonuc === 'ok';
  const alici = plan.kanal === 'eposta' ? plan.alici : plan.telefon;
  const satirlar = [
    `${KANAL[plan.kanal]} ${ok ? 'gönderildi' : 'GÖNDERİLEMEDİ'} → ${alici || '-'}`,
    plan.icerik || '',
    ok ? '' : `Hata: ${kisalt(r.detay, 300)}`,
  ];
  cmd[`m${i}_${leadId}`] = bitrixKomut('crm.timeline.comment.add', {
    fields: { ENTITY_ID: leadId, ENTITY_TYPE: 'lead', COMMENT: satirlar.filter(Boolean).join('\n') },
  });
});
if (!Object.keys(cmd).length) return [];
return [{ json: { cmd } }];
