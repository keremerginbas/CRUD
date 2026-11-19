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

// Numarayı firmanın beklediği biçime getirir: 0 → 05XXXXXXXXX, 10 → 5XXXXXXXXX, 90 → 905XXXXXXXXX
export function formatSmsNumber(number, format = '0') {
  const ten = String(number).replace(/\D/g, '').slice(-10);
  return format === '10' ? ten : format === '90' ? `90${ten}` : `0${ten}`;
}

// Firmanın cevabı: <RESULT>...</RESULT>. Kısa sayısal kodlar (ör. 081) hata, uzun sayı ya da OK mesaj kimliğidir.
// Firma hangi kodu başarı saydığını belgelerse SMS_SUCCESS_CODES ile eklenebilir (virgülle)
export function parseSmsResult(httpOk, body, successCodes = []) {
  const code = /<RESULT>\s*([^<]*?)\s*<\/RESULT>/i.exec(body)?.[1];
  if (!httpOk) return false;
  if (code !== undefined) return successCodes.includes(code) || /^\d{6,}$/.test(code) || /^ok/i.test(code);
  return !/(hata|error|fail|invalid|yetki|bakiye)/i.test(body);
}

export function createSmsClient(cfg) {
  const enabled = Boolean(/^https?:\/\//.test(cfg?.url ?? '') && cfg?.username && cfg?.password);
  const successCodes = String(cfg?.successCodes ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    enabled,
    // number: 05XXXXXXXXX biçiminde; { ok, response } döner (firmanın cevabı loga yazılır)
    async send(number, message, format = cfg?.numberFormat) {
      if (!enabled) throw new Error('SMS ayarlı değil (SMS_API_URL / SMS_USERNAME / SMS_PASSWORD)');
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8' },
        body: buildSmsXml(cfg, formatSmsNumber(number, format), message),
        signal: AbortSignal.timeout(15000),
      });
      const response = (await res.text()).slice(0, 500);
      // Firma hata durumunu 200 ile ve RESULT kodunda bildirir
      const ok = parseSmsResult(res.ok, response, successCodes);
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
