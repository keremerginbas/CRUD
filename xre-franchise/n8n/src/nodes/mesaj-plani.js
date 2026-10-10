// Video isteyen adaya WhatsApp şablonu gönderim gövdesini hazırlar
const A = $('AYARLAR').first().json;
const p = $('Rapor Planı').first().json;
if (!p.whatsappGonder || !A.WHATSAPP.AKTIF) return [];

const tel = telefonNormalize(p.telefon);
if (!tel) return [];

const sablon = A.WHATSAPP.SABLON;
const parametreler = (sablon.parametreler || []).map((k) => ({ type: 'text', text: String({ isim: p.ad || 'Merhaba' }[k] || '-') }));

return [
  {
    json: {
      leadId: p.leadId,
      ad: p.ad,
      telefon: tel,
      govde: {
        messaging_product: 'whatsapp',
        to: tel.slice(1),
        type: 'template',
        template: {
          name: sablon.ad,
          language: { code: A.WHATSAPP.DIL },
          ...(parametreler.length ? { components: [{ type: 'body', parameters: parametreler }] } : {}),
        },
      },
    },
  },
];
