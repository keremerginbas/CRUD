// İndirilen ses kaydını Bitrix yorumuna dosya olarak ekler (indirilemediyse rapor yorumundaki link yeterli)
const s = $('Ses Kaydı Hazırla').first().json;
const bin = ($input.first().binary || {}).data;
if (!bin) return [];
let tampon;
try {
  tampon = await this.helpers.getBinaryDataBuffer(0, 'data');
} catch (e) {
  return [];
}
if (!tampon || !tampon.length || tampon.length > 25 * 1024 * 1024) return [];
const uzanti = ((/\.(mp3|wav|m4a|ogg)(\?|$)/i.exec(s.url) || [])[1] || (/mpeg|mp3/.test(bin.mimeType || '') ? 'mp3' : 'wav')).toLowerCase();
return [
  {
    json: {
      govde: {
        fields: {
          ENTITY_ID: s.leadId,
          ENTITY_TYPE: 'lead',
          COMMENT: bitrixMetni(s.baslik),
          FILES: [[`${s.dosyaAdi}.${uzanti}`, tampon.toString('base64')]],
        },
      },
    },
  },
];
