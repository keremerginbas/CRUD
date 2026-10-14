// Erccell Kurumsal SMS XML API (POST https://gateway.erccell.com.tr/corporatesms/sendsms/).
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const xmlText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildRequest({ username, password, header, smsType, phone, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CORPORATESMS>
    <HEADER>
        <USERNAME>${xmlText(username)}</USERNAME>
        <PASSWORD>${xmlText(password)}</PASSWORD>
        <SMSHEADER>${cdata(header)}</SMSHEADER>
        <SMSTYPE>${xmlText(smsType)}</SMSTYPE>
        <SENDTYPE>1:N</SENDTYPE>
    </HEADER>
    <SMS>
        <SMS_MESSAGE>${cdata(body)}</SMS_MESSAGE>
        <NUMBERS>90${phone}</NUMBERS>
    </SMS>
</CORPORATESMS>`;
}

// Başarılı yanıt: <CORPORATESMS><RESULT>1</RESULT><MSG_ID>4828300</MSG_ID><MSG_COUNT>1</MSG_COUNT></CORPORATESMS>
// RESULT 1 değilse gönderim başarısızdır. RESULT etiketi hiç yoksa hata ifadesine bakılır.
const ERROR_PATTERN = /<ERROR|hata|error|fail|invalid|geçersiz|gecersiz|yetki|unauthori[sz]ed|denied/i;
const tag = (xml, name) => (new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, 'i').exec(xml) || [])[1];

function parseResponse(text) {
  const result = tag(text, 'RESULT');
  if (result !== undefined) {
    if (result === '1') return { ref: tag(text, 'MSG_ID') || text };
    return { error: `RESULT=${result}` };
  }
  if (!text || ERROR_PATTERN.test(text)) return { error: text ? 'beklenmeyen yanıt' : 'boş yanıt' };
  return { ref: text };
}

function createErccellProvider({
  username,
  password,
  header,
  smsType = 'UC',
  url = 'https://gateway.erccell.com.tr/corporatesms/sendsms/',
  fetchImpl = fetch,
}) {
  if (!username || !password || !header) {
    throw new Error('Erccell için ERCCELL_USERNAME, ERCCELL_PASSWORD ve ERCCELL_HEADER gerekli');
  }
  return {
    name: 'erccell',
    async send(phone, body) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8' },
        body: buildRequest({ username, password, header, smsType, phone, body }),
      });
      const text = (await res.text()).trim();
      const summary = text.replace(/\s+/g, ' ').slice(0, 200);
      if (!res.ok) throw new Error(`Erccell HTTP ${res.status}: ${summary}`);
      const parsed = parseResponse(text);
      if (parsed.error) throw new Error(`Erccell hata (${parsed.error}): ${summary || '-'}`);
      return { ref: parsed.ref === text ? summary : parsed.ref };
    },
  };
}

module.exports = { createErccellProvider, buildRequest, parseResponse };
