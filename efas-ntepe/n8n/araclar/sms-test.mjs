// Tek seferlik SMS teşhis workflow'unu üretir:  node n8n/araclar/sms-test.mjs [--ayar n8n/ayarlar.local.json]
// Aynı SMS'i 3 numara biçimiyle (5…, 05…, 905…) gönderir; hangisinin ulaştığı ve Erccell'in
// döndürdüğü <RESULT> kodu "Sonuçlar" node'unda görünür. --ayar verilirse kullanıcı/şifre doldurulur
// (bu dosya gitignored n8n/hazir/ altına yazılır).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--ayar');
const ayar = i > -1 ? JSON.parse(readFileSync(resolve(process.argv[i + 1]), 'utf8')) : null;
const sms = (ayar && ayar.SMS) || {};

const kod = `// 1) TEST_NUMARA'ya kendi cep numaranızı yazın, 2) Execute workflow.
//    Telefonunuza en fazla 3 SMS gelir; hangisi geldiyse o biçim doğrudur.
const TEST_NUMARA = '05XXXXXXXXX';
const KULLANICI = ${JSON.stringify(sms.KULLANICI || 'SMS_KULLANICI_ADI')};
const SIFRE = ${JSON.stringify(sms.SIFRE || 'SMS_SIFRE')};
const BASLIK = ${JSON.stringify(sms.BASLIK || 'XRE')};
const API_URL = 'https://gateway.erccell.com.tr/corporatesms/sendsms/';

const rakam = TEST_NUMARA.replace(/\\D/g, '');
const yerel = rakam.slice(-10);
if (!/^5\\d{9}$/.test(yerel)) throw new Error('TEST_NUMARA geçerli bir cep numarası olmalı (ör. 05321234567).');
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const govde = (no, bicim) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CORPORATESMS>',
    '  <HEADER>',
    \`    <USERNAME>\${x(KULLANICI)}</USERNAME>\`,
    \`    <PASSWORD>\${x(SIFRE)}</PASSWORD>\`,
    \`    <SMSHEADER><![CDATA[\${BASLIK}]]></SMSHEADER>\`,
    '    <SMSTYPE>UC</SMSTYPE>',
    '    <SENDTYPE>1:N</SENDTYPE>',
    '  </HEADER>',
    '  <SMS>',
    \`    <SMS_MESSAGE><![CDATA[EFAS SMS testi - bicim \${bicim}]]></SMS_MESSAGE>\`,
    \`    <NUMBERS>\${no}</NUMBERS>\`,
    '  </SMS>',
    '</CORPORATESMS>',
  ].join('\\n');

return [
  { bicim: '5', numara: yerel },
  { bicim: '05', numara: '0' + yerel },
  { bicim: '905', numara: '90' + yerel },
].map((t) => ({ json: { ...t, url: API_URL, govde: govde(t.numara, t.bicim) } }));
`;

const sonucKod = `// Her biçim için Erccell yanıtı. Telefona gelen SMS'in "bicim" değerini ve RESULT kodunu not edin.
return $input.all().map((item, i) => {
  const t = $('Test Ayarları').itemMatching(i).json;
  const yanit = typeof item.json.data === 'string' ? item.json.data : JSON.stringify(item.json);
  return { json: { bicim: t.bicim, numara: t.numara, RESULT: (/<RESULT>([^<]*)<\\/RESULT>/i.exec(yanit) || [])[1] || '', yanit } };
});
`;

const wf = {
  name: 'EFAS N-TEPE | SMS Testi (tek seferlik)',
  nodes: [
    { parameters: {}, id: '5a1b2c3d-0000-4000-8000-000000000001', name: 'Başlat', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0] },
    { parameters: { jsCode: kod }, id: '5a1b2c3d-0000-4000-8000-000000000002', name: 'Test Ayarları', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0] },
    {
      parameters: {
        method: 'POST',
        url: '={{ $json.url }}',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'Accept-Encoding', value: 'identity' }] },
        sendBody: true,
        contentType: 'raw',
        rawContentType: 'text/xml',
        body: '={{ $json.govde }}',
        options: { response: { response: { responseFormat: 'text' } }, timeout: 20000 },
      },
      id: '5a1b2c3d-0000-4000-8000-000000000003',
      name: 'Erccell: SMS Gönder',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [440, 0],
      onError: 'continueRegularOutput',
    },
    { parameters: { jsCode: sonucKod }, id: '5a1b2c3d-0000-4000-8000-000000000004', name: 'Sonuçlar', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 0] },
  ],
  connections: {
    Başlat: { main: [[{ node: 'Test Ayarları', type: 'main', index: 0 }]] },
    'Test Ayarları': { main: [[{ node: 'Erccell: SMS Gönder', type: 'main', index: 0 }]] },
    'Erccell: SMS Gönder': { main: [[{ node: 'Sonuçlar', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
  pinData: {},
};

const hedef = ayar ? join(KOK, '..', 'hazir', 'sms-test.json') : join(KOK, 'sms-test.json');
mkdirSync(dirname(hedef), { recursive: true });
writeFileSync(hedef, JSON.stringify(wf, null, 2) + '\n');
console.log('yazıldı:', hedef);
