// Kurumsal SMS (CORPORATESMS XML). Kullanıcı adı/şifre sadece .env'de durur:
//   SMS_API_URL, SMS_USERNAME, SMS_PASSWORD, SMS_HEADER (ör. XRE), SMS_TYPE (UC = Türkçe karakterli)
const cdata = (s) => `<![CDATA[${String(s).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
const xmlText = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export function buildSmsXml({ username, password, header, type = 'UC' }, number, message) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CORPORATESMS>
    <HEADER>
        <USERNAME>${xmlText(username)}</USERNAME>
        <PASSWORD>${xmlText(password)}</PASSWORD>
        <SMSHEADER>${cdata(header)}</SMSHEADER>
        <SMSTYPE>${xmlText(type)}</SMSTYPE>
        <SENDTYPE>1:N</SENDTYPE>
    </HEADER>
    <SMS>
        <SMS_MESSAGE>${cdata(message)}</SMS_MESSAGE>
        <NUMBERS>${xmlText(number)}</NUMBERS>
    </SMS>
</CORPORATESMS>`;
}

export function createSmsClient(cfg) {
  const enabled = Boolean(cfg?.url && cfg?.username && cfg?.password);
  return {
    enabled,
    // number: 05XXXXXXXXX biçiminde; { ok, response } döner (firmanın cevabı loga yazılır)
    async send(number, message) {
      if (!enabled) throw new Error('SMS ayarlı değil (SMS_API_URL / SMS_USERNAME / SMS_PASSWORD)');
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8' },
        body: buildSmsXml(cfg, number, message),
        signal: AbortSignal.timeout(15000),
      });
      const response = (await res.text()).slice(0, 500);
      // Firma hata durumunu çoğu zaman 200 ile ve metinde bildirir
      const ok = res.ok && !/(hata|error|fail|invalid|yetki|bakiye)/i.test(response);
      return { ok, response: `${res.status} ${response}`.trim() };
    },
  };
}

// Şablondaki {ad}, {danisman}, {hat}, {tarih} alanlarını doldurur
export function fillTemplate(text, vars) {
  return String(text).replace(/\{(ad|danisman|hat|tarih)\}/g, (_, k) => vars[k] ?? '');
}

export const DEFAULT_SMS_TEMPLATES = [
  { id: 'basvuru', title: 'Başvuru alındı', text: 'Basvurunuz alindi. XRE ekibimiz en kisa surede sizi arayacak. Danismaniniz: {danisman} {hat}' },
  { id: 'ulasamadik', title: 'Ulaşamadık', text: 'Sayin {ad}, sizi aradik ancak ulasamadik. Musait oldugunuzda {hat} numarasindan bize ulasabilirsiniz. XRE' },
  { id: 'randevu', title: 'Randevu bildirimi', text: 'Sayin {ad}, XRE danismaniniz {danisman} sizi {tarih} tarihinde arayacak. Iyi gunler dileriz.' },
];
