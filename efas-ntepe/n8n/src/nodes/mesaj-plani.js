// Olaylara göre müşteriye SMS / WhatsApp ve gruba anlık Telegram mesajlarını hazırlar
const A = $('AYARLAR').first().json;
const olaylar = ($('Olay Webhook').first().json.body || {}).olaylar || [];
const out = [];

const xml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cdata = (s) => String(s || '').replace(/]]>/g, ']]]]><![CDATA[>');
const smsXml = (metin, no) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CORPORATESMS>',
    '  <HEADER>',
    `    <USERNAME>${xml(A.SMS.KULLANICI)}</USERNAME>`,
    `    <PASSWORD>${xml(A.SMS.SIFRE)}</PASSWORD>`,
    `    <SMSHEADER><![CDATA[${cdata(A.SMS.BASLIK)}]]></SMSHEADER>`,
    '    <SMSTYPE>UC</SMSTYPE>',
    '    <SENDTYPE>1:N</SENDTYPE>',
    '  </HEADER>',
    '  <SMS>',
    `    <SMS_MESSAGE><![CDATA[${cdata(metin)}]]></SMS_MESSAGE>`,
    `    <NUMBERS>${no}</NUMBERS>`,
    '  </SMS>',
    '</CORPORATESMS>',
  ].join('\n');
const html = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mobil = (t) => {
  const e = telefonNormalize(t);
  return e && /^\+905\d{9}$/.test(e) ? e : null; // SMS/WhatsApp yalnızca TR cep numaralarına
};
const degerler = (o) => ({ ad: o.ad || 'Değerli müşterimiz', tarih: o.tarih || '', telefon: A.PROJE_TELEFON });
const doldur = (metin, o) => metin.replace(/\{(ad|tarih|telefon)\}/g, (_, k) => degerler(o)[k]);
const bitrixAdresi = (/^(https?:\/\/[^/]+)/.exec(A.BITRIX_WEBHOOK || '') || [])[1] || '';

for (const o of olaylar) {
  if (o.tur === 'randevu' && A.TELEGRAM.AKTIF && A.TELEGRAM.ANLIK_RANDEVU_BILDIRIMI) {
    out.push({
      kanal: 'telegram',
      metin: [
        `🎉 <b>Yeni randevu</b> — ${o.yon === 'inbound' ? 'gelen arama' : 'yapay zeka araması'}`,
        `👤 ${html(o.ad || '-')} · ${html(o.telefon || '-')}`,
        `📅 ${html(o.tarih || '-')}${o.teyit ? ' ⚠️ <i>saat teyit edilmeli</i>' : ''}`,
        o.detay ? `🏠 ${html(o.detay)}` : '',
        o.leadId && bitrixAdresi ? `🔗 ${bitrixAdresi}/crm/lead/details/${o.leadId}/` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  if (o.tur === 'bilgi' && A.TELEGRAM.AKTIF && A.TELEGRAM.ANLIK_RANDEVU_BILDIRIMI) {
    out.push({
      kanal: 'telegram',
      metin: [
        `📞 <b>Bilgi istiyor</b> — satış temsilcisine devredildi (${o.yon === 'inbound' ? 'gelen arama' : 'yapay zeka araması'})`,
        `👤 ${html(o.ad || '-')} · ${html(o.telefon || '-')}`,
        o.detay ? `🏠 ${html(o.detay)}` : '',
        o.leadId && /^\d+$/.test(o.leadId) && bitrixAdresi ? `🔗 ${bitrixAdresi}/crm/lead/details/${o.leadId}/` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  const tel = mobil(o.telefon);
  if (!o.mesaj || !tel) continue;

  const smsMetni = A.SMS.METIN && A.SMS.METIN[o.mesaj];
  if (A.SMS.AKTIF && smsMetni) {
    out.push({
      kanal: 'sms',
      mesaj: o.mesaj,
      leadId: o.leadId || '',
      telefon: tel,
      ad: o.ad || '',
      govde: smsXml(doldur(smsMetni, o), tel.slice(3)), // numara 5XXXXXXXXX
    });
  }

  const sablon = A.WHATSAPP.SABLON && A.WHATSAPP.SABLON[o.mesaj];
  if (A.WHATSAPP.AKTIF && sablon && sablon.ad) {
    const p = (sablon.parametreler || []).map((k) => ({ type: 'text', text: String(degerler(o)[k] || '-') }));
    out.push({
      kanal: 'whatsapp',
      mesaj: o.mesaj,
      leadId: o.leadId || '',
      telefon: tel,
      ad: o.ad || '',
      govde: {
        messaging_product: 'whatsapp',
        to: tel.slice(1),
        type: 'template',
        template: {
          name: sablon.ad,
          language: { code: A.WHATSAPP.DIL },
          ...(p.length ? { components: [{ type: 'body', parameters: p }] } : {}),
        },
      },
    });
  }
}

return out.map((json) => ({ json }));
