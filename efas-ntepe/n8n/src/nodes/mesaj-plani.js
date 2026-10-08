// Olaylara göre müşteriye SMS / WhatsApp / e-posta ve gruba anlık Telegram mesajlarını hazırlar
const A = $('AYARLAR').first().json;
const olaylar = ($('Olay Webhook').first().json.body || {}).olaylar || [];
const out = [];

const xml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cdata = (s) => String(s || '').replace(/]]>/g, ']]]]><![CDATA[>');
// +905321234567 → AYARLAR.SMS.NUMARA_BICIMI'ne göre 5321234567 / 05321234567 / 905321234567
const smsNumarasi = (e164) => {
  const yerel = e164.slice(3);
  const b = String(A.SMS.NUMARA_BICIMI || '5');
  return b === '905' ? '90' + yerel : b === '05' ? '0' + yerel : yerel;
};
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

// Afiş görseli: ayarda adres yoksa 04 workflow'unun kendi afiş webhook'u
const gorselUrl = (A.EPOSTA && A.EPOSTA.GORSEL_URL) || String(A.OLAY_WEBHOOK_URL || '').replace(/efas-ntepe-olay$/, 'efas-ntepe-afis');
const epostaHtml = (sablon) => {
  const E = A.EPOSTA;
  const p = (t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#2b2b2b">${html(t)}</p>`;
  const buton = (url, yazi) =>
    `<a href="${html(url)}" style="display:inline-block;margin:4px 6px 4px 0;padding:12px 22px;background:#a8742e;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:15px">${html(yazi)}</a>`;
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f4f1ec">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec"><tr><td align="center" style="padding:20px 10px">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">',
    gorselUrl ? `<tr><td><a href="${html(E.FORM_URL)}"><img src="${html(gorselUrl)}" width="600" alt="Yeni Yaşamkent - EFAS En Tepe, 3.150.000 TL'den başlayan fiyatlarla" style="display:block;width:100%;height:auto;border:0"></a></td></tr>` : '',
    '<tr><td style="padding:28px 28px 8px">',
    ...sablon.paragraflar.map(p),
    `<p style="margin:0 0 18px">${buton(E.FORM_URL, 'Başvuru Formu')}${buton(E.PROJE_URL, 'Proje Detayı')}</p>`,
    `<p style="margin:0 0 6px;font-size:15px;color:#2b2b2b">📞 <a href="tel:${html(String(A.PROJE_TELEFON).replace(/\s/g, ''))}" style="color:#a8742e;font-weight:bold;text-decoration:none">${html(A.PROJE_TELEFON)}</a></p>`,
    '</td></tr>',
    '<tr><td style="padding:16px 28px 24px;font-size:12px;color:#8a8a8a">XRE Project · X Real Estate Global</td></tr>',
    '</table></td></tr></table></body></html>',
  ].join('');
};

for (const o of olaylar) {
  if (o.tur === 'randevu' && A.TELEGRAM.AKTIF && A.TELEGRAM.ANLIK_RANDEVU_BILDIRIMI) {
    out.push({
      kanal: 'telegram',
      metin: [
        `🎉 <b>Yeni randevu</b> — ${o.yon === 'inbound' ? 'gelen arama' : 'yapay zeka araması'}`,
        `👤 ${html(o.ad || '-')} · ${html(o.telefon || '-')}`,
        o.talep ? '📅 <i>Gün/saat belirlenmedi — satış temsilcisi arayacak</i>' : `📅 ${html(o.tarih || '-')}${o.teyit ? ' ⚠️ <i>saat teyit edilmeli</i>' : ''}`,
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

  const eSablon = A.EPOSTA && A.EPOSTA.SABLON && A.EPOSTA.SABLON[o.mesaj];
  if (A.EPOSTA && A.EPOSTA.AKTIF && eSablon && o.eposta) {
    out.push({
      kanal: 'eposta',
      mesaj: o.mesaj,
      leadId: o.leadId || '',
      telefon: o.telefon || '',
      ad: o.ad || '',
      alici: o.eposta,
      konu: eSablon.konu,
      html: epostaHtml(eSablon),
      metin: [...eSablon.paragraflar, A.EPOSTA.FORM_URL, A.EPOSTA.PROJE_URL, A.PROJE_TELEFON].join('\n\n'),
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
      govde: smsXml(doldur(smsMetni, o), smsNumarasi(tel)),
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
