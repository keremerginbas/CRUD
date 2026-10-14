// Netgsm HTTP GET SMS API. Başarılı yanıt "00 <jobid>" (veya 01/02) biçimindedir.
const ERRORS = {
  20: 'Mesaj metni hatalı veya çok uzun',
  30: 'Geçersiz kullanıcı adı/şifre veya API erişim izni yok',
  40: 'Mesaj başlığı (gönderici adı) sistemde tanımlı değil',
  50: 'Abone hesabından İYS kontrollü gönderim yapılamıyor',
  51: 'Aboneliğinize tanımlı İYS marka bilgisi bulunamadı',
  70: 'Hatalı sorgu, parametre eksik',
  80: 'Gönderim sınır aşımı',
  85: 'Mükerrer gönderim sınır aşımı',
};

function createNetgsmProvider({
  usercode,
  password,
  header,
  iysFilter = '11', // 11: bireysel (B2C) ticari ileti, 12: tacir (B2B), boş: bilgilendirme
  baseUrl = 'https://api.netgsm.com.tr/sms/send/get',
  fetchImpl = fetch,
}) {
  if (!usercode || !password || !header) {
    throw new Error('Netgsm için NETGSM_USERCODE, NETGSM_PASSWORD ve NETGSM_HEADER gerekli');
  }
  return {
    name: 'netgsm',
    async send(phone, body) {
      const params = new URLSearchParams({
        usercode,
        password,
        gsmno: phone,
        message: body,
        msgheader: header,
        dil: 'TR',
      });
      if (iysFilter) params.set('iysfilter', iysFilter);
      const res = await fetchImpl(`${baseUrl}?${params}`);
      const text = (await res.text()).trim();
      const [code, ref] = text.split(/\s+/);
      if (!['00', '01', '02'].includes(code)) {
        throw new Error(`Netgsm hata ${code}: ${ERRORS[Number(code)] || text}`);
      }
      return { ref };
    },
  };
}

module.exports = { createNetgsmProvider };
