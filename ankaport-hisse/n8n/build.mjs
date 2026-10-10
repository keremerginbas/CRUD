#!/usr/bin/env node
// XRE ANKAPORT HİSSE n8n workflow'larını üretir.
//   node build.mjs                      → workflows/*.json (n8n'e içe aktarılacak dosyalar)
//   node build.mjs --test <ayar.json>   → test için: AYARLAR'ı ezer, webhook tetikleyici kullanır
//   node build.mjs --ayar <ayar.json>   → hazir/*.json: AYARLAR'ı gerçek değerlerle doldurur (git'e girmez)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = dirname(fileURLToPath(import.meta.url));
const oku = (p) => readFileSync(join(KOK, p), 'utf8');

const argDosya = (bayrak) => {
  const i = process.argv.indexOf(bayrak);
  return i > -1 ? JSON.parse(readFileSync(resolve(process.argv[i + 1]), 'utf8')) : null;
};
const TEST = argDosya('--test');
const AYAR = TEST || argDosya('--ayar');
const CIKTI = TEST ? join(KOK, '..', 'test', '.build') : AYAR ? join(KOK, 'hazir') : join(KOK, 'workflows');

const LIB = oku('src/lib.js');
let AYARLAR_KODU = oku('src/ayarlar.js');

function ayarYaz(kod, yol, deger) {
  let bas = 0;
  let girinti = '  ';
  for (const [i, anahtar] of yol.entries()) {
    const re = new RegExp(`\\n${girinti}${anahtar}: `, 'g');
    re.lastIndex = bas;
    const m = re.exec(kod);
    if (!m) throw new Error(`AYARLAR'da bulunamadı: ${yol.join('.')}`);
    bas = m.index + m[0].length;
    if (i < yol.length - 1) girinti += '  ';
  }
  // Değerin sonu: dizi/obje ve tırnak içindeki virgüller atlanarak ilk üst düzey virgül
  const satirSonu = kod.indexOf('\n', bas);
  let son = -1;
  let derinlik = 0;
  let tirnak = null;
  for (let i = bas; i < satirSonu; i++) {
    const c = kod[i];
    if (tirnak) {
      if (c === '\\') i++;
      else if (c === tirnak) tirnak = null;
    } else if (c === '"' || c === "'" || c === '`') tirnak = c;
    else if (c === '[' || c === '{') derinlik++;
    else if (c === ']' || c === '}') derinlik--;
    else if (c === ',' && derinlik === 0) {
      son = i;
      break;
    }
  }
  if (son < 0) throw new Error(`AYARLAR'da tek satırlık değer değil: ${yol.join('.')}`);
  return kod.slice(0, bas) + JSON.stringify(deger) + kod.slice(son);
}
function ayarlariYaz(kod, nesne, yol = []) {
  for (const [k, v] of Object.entries(nesne)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) kod = ayarlariYaz(kod, v, [...yol, k]);
    else kod = ayarYaz(kod, [...yol, k], v);
  }
  return kod;
}

if (AYAR && !TEST) {
  AYARLAR_KODU = ayarlariYaz(AYARLAR_KODU, AYAR);
  const sonuc = new Function('$execution', AYARLAR_KODU)({ resumeUrl: '' })[0].json;
  const kontrol = (h, k, yol = []) => {
    for (const [a, v] of Object.entries(k)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) kontrol(h[a], v, [...yol, a]);
      else if (JSON.stringify(h[a]) !== JSON.stringify(v)) throw new Error(`AYARLAR yazılamadı: ${[...yol, a].join('.')}`);
    }
  };
  kontrol(sonuc, AYAR);
} else if (TEST) {
  AYARLAR_KODU = AYARLAR_KODU.replace(
    'return [{ json: AYARLAR }];',
    `const birlestir = (h, k) => { for (const [a, v] of Object.entries(k)) h[a] = v && typeof v === 'object' && !Array.isArray(v) && h[a] && typeof h[a] === 'object' ? birlestir(h[a], v) : v; return h; };\nbirlestir(AYARLAR, ${JSON.stringify(AYAR)});\nreturn [{ json: AYARLAR }];`
  );
}
const kod = (dosya) => `${LIB}\n${oku(`src/nodes/${dosya}`)}`;

function uuid(...parcalar) {
  const h = createHash('sha1').update(parcalar.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

class Workflow {
  constructor(ad) {
    this.ad = ad;
    this.nodes = [];
    this.connections = {};
  }
  ekle(name, type, typeVersion, position, parameters, ek = {}) {
    this.nodes.push({ parameters, id: uuid(this.ad, name), name, type, typeVersion, position, ...ek });
    return name;
  }
  bagla(kaynak, hedef, cikis = 0) {
    this.connections[kaynak] ??= { main: [] };
    const m = this.connections[kaynak].main;
    while (m.length <= cikis) m.push([]);
    m[cikis].push({ node: hedef, type: 'main', index: 0 });
  }
  zincir(...adlar) {
    for (let i = 1; i < adlar.length; i++) this.bagla(adlar[i - 1], adlar[i]);
  }
  not(icerik, position, width, height) {
    this.ekle(`Not ${this.nodes.length}`, 'n8n-nodes-base.stickyNote', 1, position, { content: icerik, width, height });
  }
  json() {
    return {
      ...(TEST ? { id: createHash('sha1').update(this.ad).digest('hex').slice(0, 16) } : {}),
      name: this.ad,
      nodes: this.nodes,
      connections: this.connections,
      active: false,
      settings: { executionOrder: 'v1', timezone: 'Europe/Istanbul', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all', saveManualExecutions: true },
      pinData: {},
      meta: { templateCredsSetupCompleted: false },
    };
  }
}

const HTTP = 'n8n-nodes-base.httpRequest';
const VAPI_CRED = { httpHeaderAuth: { id: 'AnkaportVapiApiCredential', name: 'Vapi API' } };
const BITRIX = "={{ $('AYARLAR').first().json.BITRIX_WEBHOOK }}";
const VAPI = "={{ $('AYARLAR').first().json.VAPI_API }}";
const LEAD_ALANLARI = "['ID', 'STATUS_ID', 'NAME', 'LAST_NAME', 'PHONE', 'EMAIL', 'ASSIGNED_BY_ID', 'DATE_CREATE']";

const codeNode = (wf, ad, pos, js) => wf.ekle(ad, 'n8n-nodes-base.code', 2, pos, { jsCode: js });
const ayarlarNode = (wf, pos) => codeNode(wf, 'AYARLAR', pos, AYARLAR_KODU);

const bitrixPost = (wf, ad, pos, metod, govde, ek = {}) =>
  wf.ekle(ad, HTTP, 4.2, pos, { method: 'POST', url: `${BITRIX}${metod}.json`, sendBody: true, specifyBody: 'json', jsonBody: govde, options: { timeout: 30000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, ...ek });
const bitrixBatch = (wf, ad, pos, ek = {}) => bitrixPost(wf, ad, pos, 'batch', '={{ JSON.stringify({ halt: 0, cmd: $json.cmd }) }}', ek);

const kosul = (wfAd, ad, sol, operator, sag = '') => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
  conditions: [{ id: uuid(wfAd, ad, sol), leftValue: sol, rightValue: sag, operator }],
  combinator: 'and',
});
const ESITTIR = { type: 'string', operation: 'equals' };
const DOGRU = { type: 'boolean', operation: 'true', singleValue: true };
const ifNode = (wf, ad, pos, sol, operator, sag) => wf.ekle(ad, 'n8n-nodes-base.if', 2.2, pos, { conditions: kosul(wf.ad, ad, sol, operator, sag), options: {} });
const yanitNode = (wf, ad, pos, respondWith) => wf.ekle(ad, 'n8n-nodes-base.respondToWebhook', 1.1, pos, { respondWith, options: {} });
const webhookNode = (wf, ad, pos, path, responseMode = 'responseNode', httpMethod = 'POST') => wf.ekle(ad, 'n8n-nodes-base.webhook', 2, pos, { httpMethod, path, responseMode, options: {} }, { webhookId: uuid('webhook', path) });

const mesajTipiNode = (wf, pos) =>
  wf.ekle('Mesaj Tipi', 'n8n-nodes-base.switch', 3.2, pos, {
    rules: {
      values: [
        { conditions: kosul(wf.ad, 'tip1', '={{ $json.tip }}', ESITTIR, 'tool-calls'), renameOutput: true, outputKey: 'Araç çağrısı' },
        { conditions: kosul(wf.ad, 'tip2', '={{ $json.tip }}', ESITTIR, 'end-of-call-report'), renameOutput: true, outputKey: 'Çağrı raporu' },
      ],
    },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'Diğer' },
  });

const TELEGRAM_CRED = { telegramApi: { id: 'XreRaporBotu', name: 'XRE Rapor Botu' } };
const telegramNode = (wf, ad, pos) =>
  wf.ekle(
    ad,
    'n8n-nodes-base.telegram',
    1.2,
    pos,
    { resource: 'message', operation: 'sendMessage', chatId: "={{ $('AYARLAR').first().json.TELEGRAM.CHAT_ID }}", text: '={{ $json.metin }}', additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true, appendAttribution: false } },
    { credentials: TELEGRAM_CRED, onError: 'continueRegularOutput' }
  );

const kanalSwitch = (wf, pos) =>
  wf.ekle('Kanal', 'n8n-nodes-base.switch', 3.2, pos, {
    rules: {
      values: [
        { conditions: kosul(wf.ad, 'k1', '={{ $json.kanal }}', ESITTIR, 'sms'), renameOutput: true, outputKey: 'SMS' },
        { conditions: kosul(wf.ad, 'k2', '={{ $json.kanal }}', ESITTIR, 'eposta'), renameOutput: true, outputKey: 'E-posta' },
        { conditions: kosul(wf.ad, 'k3', '={{ $json.kanal }}', ESITTIR, 'telegram'), renameOutput: true, outputKey: 'Telegram' },
      ],
    },
    options: {},
  });

const ON = 'XRE ANKAPORT HİSSE | ';
const dosyalar = {};

// =====================================================================
// 01 — Form Webhook
// =====================================================================
{
  const wf = new Workflow(`${ON}01 Form`);
  wf.not(
    "## 01 · Form\nBitrix otomasyon kuralı, lead **ankaport reklam** (UC_0RQEPM) statüsüne düşünce burayı çağırır (webhook).\n\nSMS + e-posta (fırsat afişiyle) + Telegram \"form doldu\" bildirimini gönderir, Vapi aramasını başlatır. Arama saatleri dışında form dolarsa (ARAMA_SAATLERI), çağrı Vapi'de bir sonraki pencereye ertelenir.",
    [-60, -420],
    560,
    380
  );

  // ---- Form webhook ----
  const formWh = webhookNode(wf, 'Form Webhook', [0, 0], 'ankaport-hisse-form');
  const ay1 = ayarlarNode(wf, [220, 0]);
  const leadGetir = bitrixPost(wf, 'Bitrix: Lead Getir', [440, 0], 'crm.lead.get', "={{ JSON.stringify({ id: ($('Form Webhook').first().json.body['document_id[2]'] || $('Form Webhook').first().json.body['data[FIELDS][ID]'] || $('Form Webhook').first().json.query.id || $('Form Webhook').first().json.body.id || '0').toString().replace('LEAD_', '') }) }}", { onError: 'continueRegularOutput' });
  const formPlan = codeNode(wf, 'Form Planı', [660, 0], kod('form-plani.js'));
  const formYanit = yanitNode(wf, 'Form: Hemen Yanıtla', [880, 140], 'noData');
  const aranacakMi = ifNode(wf, 'Aranacak mı?', [880, -60], '={{ $json.aramaYapilsin }}', DOGRU);
  const mesajPlan = codeNode(wf, 'Mesaj Planı', [1100, -140], kod('mesaj-plani.js'));
  const kanal = kanalSwitch(wf, [1320, -140]);
  const sms = wf.ekle('SMS Gönder (XML)', HTTP, 4.2, [1540, -220], { method: 'POST', url: "={{ $('AYARLAR').first().json.SMS.API_URL }}", sendHeaders: true, headerParameters: { parameters: [{ name: 'Accept-Encoding', value: 'identity' }] }, sendBody: true, contentType: 'raw', rawContentType: 'text/xml', body: '={{ $json.govde }}', options: { timeout: 20000 } }, { onError: 'continueRegularOutput' });
  const ep = wf.ekle(
    'E-posta Gönder',
    'n8n-nodes-base.emailSend',
    2.1,
    [1540, -140],
    { fromEmail: "={{ $('AYARLAR').first().json.EPOSTA.GONDEREN }}", toEmail: '={{ $json.alici }}', subject: '={{ $json.konu }}', emailFormat: 'both', text: '={{ $json.metin }}', html: '={{ $json.html }}', options: { appendAttribution: false } },
    { credentials: { smtp: { id: 'AnkaportSmtp', name: 'Ankaport SMTP' } }, onError: 'continueRegularOutput' }
  );
  const formTg = telegramNode(wf, 'Telegram: Form Bildirimi', [1540, -60]);
  const vapiAra = wf.ekle(
    'Vapi: Aramayı Başlat',
    HTTP,
    4.2,
    [1100, 60],
    { method: 'POST', url: `${VAPI}/call`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.vapiBody) }}', options: { timeout: 20000 } },
    { credentials: VAPI_CRED, onError: 'continueRegularOutput' }
  );

  wf.zincir(formWh, ay1, leadGetir, formPlan);
  wf.bagla(formPlan, aranacakMi);
  wf.bagla(formPlan, formYanit);
  wf.bagla(aranacakMi, mesajPlan, 0);
  wf.bagla(aranacakMi, vapiAra, 0);
  wf.zincir(mesajPlan, kanal);
  wf.bagla(kanal, sms, 0);
  wf.bagla(kanal, ep, 1);
  wf.bagla(kanal, formTg, 2);

  // Fırsat afişi: GET …/webhook/ankaport-hisse-afis (e-postadaki görsel buradan servis edilir)
  const afisWh = wf.ekle('Afiş Webhook', 'n8n-nodes-base.webhook', 2, [0, 420], { httpMethod: 'GET', path: 'ankaport-hisse-afis', responseMode: 'responseNode', options: {} }, { webhookId: uuid('webhook', 'ankaport-hisse-afis') });
  const afis = codeNode(wf, 'Afiş Görseli', [220, 420], `// ankaport-hisse/eposta/ankaport-firsat.jpg (build sırasında gömülür)\nconst AFIS = '${readFileSync(join(KOK, '..', 'eposta', 'ankaport-firsat.jpg')).toString('base64')}';\nreturn [{ json: {}, binary: { data: { data: AFIS, mimeType: 'image/jpeg', fileName: 'ankaport-firsat.jpg', fileExtension: 'jpg' } } }];\n`);
  const afisYanit = wf.ekle('Afişi Döndür', 'n8n-nodes-base.respondToWebhook', 1.1, [440, 420], { respondWith: 'binary', options: { responseHeaders: { entries: [{ name: 'Cache-Control', value: 'public, max-age=86400' }] } } });
  wf.zincir(afisWh, afis, afisYanit);

  dosyalar['01-form.json'] = wf.json();
}

// =====================================================================
// 02 — Outbound Vapi Sunucu
// =====================================================================
{
  const wf = new Workflow(`${ON}02 Outbound`);
  wf.not(
    "## 02 · Outbound Vapi Sunucu\n**ANKAPORT HİSSE - OUTBOUND** asistanının Server URL'i ve `randevu_olustur` aracının URL'i bu webhook'tur.\n\nRandevu oluşursa lead **RANDEVU OLUŞTURANLAR**'a taşınır (sorumlu DEĞİŞMEZ); oluşmazsa **ankaport reklam**'da kalır, satışçı kendisi arar (otomatik tekrar deneme YOK). Sonuç Telegram'a bildirilir.",
    [-60, -300],
    520,
    260
  );
  const obWh = webhookNode(wf, 'Vapi Webhook', [0, 0], 'ankaport-hisse-outbound');
  const ay2 = ayarlarNode(wf, [220, 0]);
  const coz = codeNode(wf, 'Mesajı Çöz', [440, 0], kod('mesaji-coz.js'));
  const tip = mesajTipiNode(wf, [660, 0]);
  const obHemen = yanitNode(wf, 'Hemen Yanıtla', [900, 120], 'noData');
  const obDiger = yanitNode(wf, 'Yanıtla (Diğer)', [900, 300], 'noData');

  const obLeadGetir1 = bitrixPost(wf, 'Bitrix: Lead Getir (Araç)', [1140, -120], 'crm.lead.get', "={{ JSON.stringify({ id: $('Mesajı Çöz').first().json.leadId || 0 }) }}", { onError: 'continueRegularOutput' });
  const aracPlan = codeNode(wf, 'Araç Planı', [1380, -120], kod('outbound-arac-plani.js'));
  const varMi = ifNode(wf, 'Kayıt Var mı?', [1600, -120], '={{ $json.kayitVar }}', DOGRU);
  const aracBx = bitrixBatch(wf, 'Bitrix: Araç Kaydı', [1820, -200], { onError: 'continueRegularOutput', maxTries: 2, waitBetweenTries: 1000 });
  const aracYanit = codeNode(wf, 'Araç Yanıtı', [2040, -120], kod('arac-yaniti.js'));
  const aracYanitla = wf.ekle('Yanıtla (Araç)', 'n8n-nodes-base.respondToWebhook', 1.1, [2260, -120], { respondWith: 'json', responseBody: '={{ JSON.stringify({ results: $json.results }) }}', options: {} });

  const obLeadGetir2 = bitrixPost(wf, 'Bitrix: Lead Getir (Rapor)', [1140, 200], 'crm.lead.get', "={{ JSON.stringify({ id: $('Mesajı Çöz').first().json.leadId || 0 }) }}", { onError: 'continueRegularOutput' });
  const raporPlan = codeNode(wf, 'Rapor Planı', [1380, 200], kod('outbound-rapor-plani.js'));
  const raporBx = bitrixBatch(wf, 'Bitrix: Rapor Kaydı', [1600, 200], { onError: 'continueRegularOutput' });
  const sorumluKullanici = bitrixPost(wf, 'Bitrix: Sorumlu Kullanıcı', [1820, 200], 'user.get', "={{ JSON.stringify({ ID: $('Rapor Planı').first().json.sorumluId || 0 }) }}", { onError: 'continueRegularOutput' });
  const tgSonucKod = codeNode(wf, 'Telegram Sonuç Metni', [2040, 200], kod('telegram-sonuc.js'));
  const tgSonuc = telegramNode(wf, 'Telegram: Sonucu Gönder', [2260, 200]);

  wf.zincir(obWh, ay2, coz, tip);
  wf.bagla(tip, obLeadGetir1, 0);
  wf.bagla(tip, obHemen, 1);
  wf.bagla(tip, obDiger, 2);
  wf.bagla(obHemen, obLeadGetir2);
  wf.zincir(obLeadGetir1, aracPlan, varMi);
  wf.bagla(varMi, aracBx, 0);
  wf.bagla(varMi, aracYanit, 1);
  wf.zincir(aracBx, aracYanit, aracYanitla);
  wf.zincir(obLeadGetir2, raporPlan, raporBx, sorumluKullanici, tgSonucKod, tgSonuc);

  dosyalar['02-outbound.json'] = wf.json();
}

// =====================================================================
// 03 — Inbound Vapi Sunucu
// =====================================================================
{
  const wf = new Workflow(`${ON}03 Inbound`);
  wf.not(
    "## 02 · Inbound Vapi Sunucu\n**ANKAPORT HİSSE - INBOUND** asistanının Server URL'i ve `randevu_olustur` aracının URL'i bu webhook'tur.\n\nArayan numara Bitrix'te aranır (crm.duplicate.findbycomm): bulunursa mevcut lead'in sorumlusu korunur; bulunamazsa VARSAYILAN_SORUMLU_ID ile yeni lead açılır. Randevu oluşursa **RANDEVU OLUŞTURANLAR**'a taşınır. Sonuç Telegram'a bildirilir.",
    [-60, -300],
    520,
    260
  );
  const wh = webhookNode(wf, 'Vapi Webhook', [0, 0], 'ankaport-hisse-inbound');
  const ay = ayarlarNode(wf, [220, 0]);
  const coz = codeNode(wf, 'Mesajı Çöz', [440, 0], kod('mesaji-coz.js'));
  const tip = mesajTipiNode(wf, [660, 0]);
  const hemen = yanitNode(wf, 'Hemen Yanıtla', [900, 120], 'noData');
  const diger = yanitNode(wf, 'Yanıtla (Diğer)', [900, 300], 'noData');

  const leadAra = (ad, pos) => bitrixPost(wf, ad, pos, 'crm.duplicate.findbycomm', "={{ JSON.stringify({ entity_type: 'LEAD', type: 'PHONE', values: $('Mesajı Çöz').first().json.telefonVaryantlari.length ? $('Mesajı Çöz').first().json.telefonVaryantlari : ['0'] }) }}", { onError: 'continueRegularOutput', alwaysOutputData: true, maxTries: 2, waitBetweenTries: 1000 });
  const leadDetay = (ad, pos) => bitrixPost(wf, ad, pos, 'crm.lead.list', `={{ JSON.stringify({ filter: { ID: ($json.result && $json.result.LEAD && $json.result.LEAD.length) ? $json.result.LEAD : [0] }, select: ${LEAD_ALANLARI}, order: { ID: 'DESC' } }) }}`, { onError: 'continueRegularOutput', alwaysOutputData: true, maxTries: 2, waitBetweenTries: 1000 });

  const ara1 = leadAra('Bitrix: Telefonla Ara (Araç)', [1140, -140]);
  const detay1 = leadDetay('Bitrix: Lead Detayları (Araç)', [1360, -140]);
  const aracPlan = codeNode(wf, 'Araç Planı', [1580, -140], kod('inbound-arac-plani.js'));
  const varMi = ifNode(wf, 'Kayıt Var mı?', [1800, -140], '={{ $json.kayitVar }}', DOGRU);
  const aracBx = bitrixBatch(wf, 'Bitrix: Araç Kaydı', [2020, -220], { onError: 'continueRegularOutput', maxTries: 2, waitBetweenTries: 1000 });
  const aracYanit = codeNode(wf, 'Araç Yanıtı', [2240, -140], kod('arac-yaniti.js'));
  const aracYanitla = wf.ekle('Yanıtla (Araç)', 'n8n-nodes-base.respondToWebhook', 1.1, [2460, -140], { respondWith: 'json', responseBody: '={{ JSON.stringify({ results: $json.results }) }}', options: {} });

  const ara2 = leadAra('Bitrix: Telefonla Ara (Rapor)', [1140, 180]);
  const detay2 = leadDetay('Bitrix: Lead Detayları (Rapor)', [1360, 180]);
  const raporPlan = codeNode(wf, 'Inbound Rapor Planı', [1580, 180], kod('inbound-rapor-plani.js'));
  const raporBx = bitrixBatch(wf, 'Bitrix: Rapor Kaydı', [1800, 180], { onError: 'continueRegularOutput' });
  const sorumluKullanici = bitrixPost(wf, 'Bitrix: Sorumlu Kullanıcı', [2020, 180], 'user.get', "={{ JSON.stringify({ ID: $('Inbound Rapor Planı').first().json.sorumluId || 0 }) }}", { onError: 'continueRegularOutput' });
  const tgSonucKod = codeNode(wf, 'Telegram Sonuç Metni', [2240, 180], kod('telegram-sonuc.js').replace("$('Rapor Planı')", "$('Inbound Rapor Planı')"));
  const tgSonuc = telegramNode(wf, 'Telegram: Sonucu Gönder', [2460, 180]);

  wf.zincir(wh, ay, coz, tip);
  wf.bagla(tip, ara1, 0);
  wf.bagla(tip, hemen, 1);
  wf.bagla(tip, diger, 2);
  wf.bagla(hemen, ara2);
  wf.zincir(ara1, detay1, aracPlan, varMi);
  wf.bagla(varMi, aracBx, 0);
  wf.bagla(varMi, aracYanit, 1);
  wf.zincir(aracBx, aracYanit, aracYanitla);
  wf.zincir(ara2, detay2, raporPlan, raporBx, sorumluKullanici, tgSonucKod, tgSonuc);

  dosyalar['03-inbound.json'] = wf.json();
}

mkdirSync(CIKTI, { recursive: true });
for (const [ad, icerik] of Object.entries(dosyalar)) {
  writeFileSync(join(CIKTI, ad), JSON.stringify(icerik, null, 2) + '\n');
  console.log('yazıldı:', join(CIKTI, ad));
}
