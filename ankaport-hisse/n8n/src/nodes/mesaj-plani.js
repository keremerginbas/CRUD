// Form planından (form-plani.js) gelen bilgiyle gönderilecek SMS / e-posta / Telegram "form doldu" bildirimini hazırlar.
// Bu mesajlar aramanın SONUCUNU beklemez; form dolar dolmaz gider.
const A = $('AYARLAR').first().json;
const p = $('Form Planı').first().json;
if (!p.aramaYapilsin) return [];

const out = [];

if (p.smsGovde) {
  out.push({ json: { kanal: 'sms', leadId: p.leadId, telefon: p.telefon, ad: p.ad, govde: p.smsGovde, icerik: A.SMS.METIN } });
}

if (p.epostaVarMi) {
  const gorselUrl = A.EPOSTA.GORSEL_URL || `${A.N8N_TABAN_URL}/webhook/ankaport-hisse-afis`;
  const paragraflarHtml = A.EPOSTA.PARAGRAFLAR.map((p) => `<p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.5;">${p}</p>`).join('');
  const html = `<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;">
${paragraflarHtml}
<img src="${gorselUrl}" alt="AnkaPort Saray Fırsatlar" style="width:100%;max-width:560px;border-radius:8px;margin:12px 0;" />
<p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:14px;color:#555;">📞 ${A.PROJE_TELEFON} &nbsp;·&nbsp; ${A.PROJE_URL}</p>
</div>`;
  out.push({
    json: {
      kanal: 'eposta',
      leadId: p.leadId,
      alici: p.eposta,
      icerik: `Konu: ${A.EPOSTA.KONU}`,
      konu: A.EPOSTA.KONU,
      html,
      metin: [...A.EPOSTA.PARAGRAFLAR, A.PROJE_URL, A.PROJE_TELEFON].join('\n\n'),
    },
  });
}

if (A.TELEGRAM.AKTIF) {
  const h = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  out.push({
    json: {
      kanal: 'telegram',
      metin: [
        `📝 <b>Yeni ANKAPORT Hisse Talebi</b>`,
        `👤 ${h(p.ad || '-')} · ${h(p.telefon || '-')}`,
        `🕐 Form tarihi: ${h(p.formTarihi)}`,
        `🤖 Yapay zeka asistanı aranıyor…`,
      ].join('\n'),
    },
  });
}

return out;
