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

// Yanıt biçimi belgelenmediği için: HTTP hatası veya hata ifadesi içeren yanıt başarısız sayılır,
// aksi halde yanıt (ilk 200 karakter) gönderim referansı olarak saklanır.
const ERROR_PATTERN = /<ERROR|hata|error|fail|invalid|geçersiz|gecersiz|yetki|unauthori[sz]ed|denied/i;

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
      if (!text || ERROR_PATTERN.test(text)) throw new Error(`Erccell hata: ${summary || 'boş yanıt'}`);
      return { ref: summary };
    },
  };
}

module.exports = { createErccellProvider, buildRequest };
