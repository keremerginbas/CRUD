// Tek seferlik "Vapi Güncelleme" workflow'unu üretir:  node n8n/araclar/vapi-guncelleme.mjs
// Promptlar vapi/*.md, araç tanımı vapi/araclar-outbound.json, sonuç açıklaması
// vapi/yapilandirilmis-cikti-outbound.json dosyasından alınır.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const KOK = dirname(fileURLToPath(import.meta.url));
const oku = (p) => readFileSync(join(KOK, p), 'utf8');
const N8N_ADRESI = 'https://xre111.shop';
const ASISTAN = { out: '010eabaa-0838-42b0-af4d-ba3a30a8373d', in: 'b723ba5d-b1f4-4c97-bc5a-65a71317d85e' };
const CRED = { httpHeaderAuth: { id: '5Pl6muHFf8RtSDsb', name: 'efas ntepe vapi' } };

const arac = JSON.parse(oku('../../vapi/araclar-outbound.json')).find((t) => t.function?.name === 'satisa_aktar');
arac.server.url = `${N8N_ADRESI}/webhook/efas-ntepe-outbound`;
const sonucAciklama = JSON.parse(oku('../../vapi/yapilandirilmis-cikti-outbound.json')).schema.properties.sonuc.description;
const sonucAciklamaIn = JSON.parse(oku('../../vapi/yapilandirilmis-cikti-inbound.json')).schema.properties.sonuc.description;
const randevuFn = (dosya) => JSON.parse(oku(`../../vapi/${dosya}`)).find((t) => t.function?.name === 'randevu_olustur').function;

const kod = oku('vapi-guncelleme-kod.js')
  .replace('__PROMPT_OUT__', JSON.stringify(oku('../../vapi/outbound-sistem-promptu.md')))
  .replace('__PROMPT_IN__', JSON.stringify(oku('../../vapi/inbound-sistem-promptu.md')))
  .replace('__SONUC_ACIKLAMA__', JSON.stringify(sonucAciklama))
  .replace('__SONUC_ACIKLAMA_IN__', JSON.stringify(sonucAciklamaIn))
  .replace('__RANDEVU_OUT__', JSON.stringify(randevuFn('araclar-outbound.json'), null, 2))
  .replace('__RANDEVU_IN__', JSON.stringify(randevuFn('araclar-inbound.json'), null, 2));

const uuid = (s) => {
  const h = createHash('sha1').update(`vapi-guncelleme|${s}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const nodes = [];
const ekle = (name, type, typeVersion, position, parameters, ek = {}) => nodes.push({ parameters, id: uuid(name), name, type, typeVersion, position, ...ek });
const vapiGet = (name, pos, yol) =>
  ekle(name, 'n8n-nodes-base.httpRequest', 4.2, pos, { url: `https://api.vapi.ai${yol}`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: {} }, { credentials: CRED, executeOnce: true });

ekle('Başlat', 'n8n-nodes-base.manualTrigger', 1, [0, 0], {});
vapiGet('Vapi: Outbound Asistan', [220, 0], `/assistant/${ASISTAN.out}`);
vapiGet('Vapi: Inbound Asistan', [440, 0], `/assistant/${ASISTAN.in}`);
vapiGet('Vapi: Structured Outputs', [660, 0], '/structured-output?limit=100');
vapiGet('Vapi: Araçlar', [880, 0], '/tool?limit=100');
ekle('Araç Kontrol', 'n8n-nodes-base.code', 2, [1100, 0], {
  jsCode: `// satisa_aktar aracı Vapi'de var mı?\nconst ARAC = ${JSON.stringify(arac, null, 2)};\nconst mevcut = $('Vapi: Araçlar').all().map((i) => i.json).find((t) => t && t.function && t.function.name === 'satisa_aktar');\nreturn [{ json: { var: !!mevcut, id: mevcut ? mevcut.id : '', govde: ARAC } }];\n`,
});
ekle('Araç Var mı?', 'n8n-nodes-base.if', 2.2, [1320, 0], {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: uuid('kosul'), leftValue: '={{ $json.var }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});
ekle(
  'Vapi: Araç Oluştur',
  'n8n-nodes-base.httpRequest',
  4.2,
  [1540, 120],
  { method: 'POST', url: 'https://api.vapi.ai/tool', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.govde) }}', options: {} },
  { credentials: CRED }
);
ekle('Güncellemeleri Hazırla', 'n8n-nodes-base.code', 2, [1760, 0], { jsCode: kod });
ekle(
  'Vapi: Güncelle',
  'n8n-nodes-base.httpRequest',
  4.2,
  [1980, 0],
  { method: 'PATCH', url: '=https://api.vapi.ai/{{ $json.yol }}/{{ $json.id }}', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.govde) }}', options: {} },
  { credentials: CRED }
);
ekle('Not', 'n8n-nodes-base.stickyNote', 1, [0, -300], {
  content:
    '## Vapi güncellemesi (tek seferlik)\n• Outbound + inbound prompt: açılış bir kez söylenir, "kimsin" sorusuna kısa cevap, "yatırım mı" sorusu yok, bilgi isteyen satışa aktarılır\n• Outbound\'a **satisa_aktar** aracı eklenir (yoksa oluşturulur)\n• **randevu_olustur** araçları: gün/saat sorulmaz, randevu saatsiz açılır\n• Structured Output\'lar: **bilgi_istiyor** ve saatsiz randevu tanımı\n\nCredential: **efas ntepe vapi** (farklıysa HTTP node\'larında seçin) → **Execute workflow**.\n"Güncellemeleri Hazırla" çıktısındaki kontrol alanları hep **true** olmalı.',
  height: 280,
  width: 560,
});

const bagla = (a, b, cikis = 0) => {
  connections[a] ??= { main: [] };
  connections[a].main[cikis] ??= [];
  connections[a].main[cikis].push({ node: b, type: 'main', index: 0 });
};
const connections = {};
bagla('Başlat', 'Vapi: Outbound Asistan');
bagla('Vapi: Outbound Asistan', 'Vapi: Inbound Asistan');
bagla('Vapi: Inbound Asistan', 'Vapi: Structured Outputs');
bagla('Vapi: Structured Outputs', 'Vapi: Araçlar');
bagla('Vapi: Araçlar', 'Araç Kontrol');
bagla('Araç Kontrol', 'Araç Var mı?');
bagla('Araç Var mı?', 'Güncellemeleri Hazırla', 0);
bagla('Araç Var mı?', 'Vapi: Araç Oluştur', 1);
bagla('Vapi: Araç Oluştur', 'Güncellemeleri Hazırla');
bagla('Güncellemeleri Hazırla', 'Vapi: Güncelle');

const wf = { name: 'EFAS N-TEPE | Vapi Güncelleme (tek seferlik)', nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} };
writeFileSync(join(KOK, 'vapi-guncelleme.json'), JSON.stringify(wf, null, 2) + '\n');
console.log('yazıldı: n8n/araclar/vapi-guncelleme.json');
