#!/usr/bin/env node
// EFAS N-TEPE n8n workflow'larını üretir.
//   node build.mjs                      → workflows/*.json (n8n'e içe aktarılacak dosyalar)
//   node build.mjs --test <ayar.json>   → test için: AYARLAR'ı ezer, zamanlayıcıyı webhook yapar
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
// "KEY: değer," satırını (iç içe anahtarlar için ilgili bloğun içinde) yeni değerle değiştirir
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
  const son = kod.indexOf(',', bas);
  const satirSonu = kod.indexOf('\n', bas);
  if (son < 0 || son > satirSonu) throw new Error(`AYARLAR'da tek satırlık değer değil: ${yol.join('.')}`);
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
      settings: {
        executionOrder: 'v1',
        timezone: 'Europe/Istanbul',
        saveDataErrorExecution: 'all',
        saveDataSuccessExecution: 'all',
        saveManualExecutions: true,
      },
      pinData: {},
      meta: { templateCredsSetupCompleted: false },
    };
  }
}

// ---------- node yardımcıları ----------
const HTTP = 'n8n-nodes-base.httpRequest';
const VAPI_CRED = { httpHeaderAuth: { id: 'EfasVapiApiCredential', name: 'Vapi API' } };
const BITRIX = "={{ $('AYARLAR').first().json.BITRIX_WEBHOOK }}";
const VAPI = "={{ $('AYARLAR').first().json.VAPI_API }}";
const LEAD_ALANLARI = "['ID', 'STATUS_ID', 'NAME', 'LAST_NAME', 'PHONE', 'CONTACT_ID', 'ASSIGNED_BY_ID'].concat(Object.values($('AYARLAR').first().json.ALAN))";

const codeNode = (wf, ad, pos, js) => wf.ekle(ad, 'n8n-nodes-base.code', 2, pos, { jsCode: js });
const ayarlarNode = (wf, pos) => codeNode(wf, 'AYARLAR', pos, AYARLAR_KODU);

const bitrixPost = (wf, ad, pos, metod, govde, ek = {}) =>
  wf.ekle(
    ad,
    HTTP,
    4.2,
    pos,
    {
      method: 'POST',
      url: `${BITRIX}${metod}.json`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: govde,
      options: { timeout: 30000 },
    },
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, ...ek }
  );
const bitrixBatch = (wf, ad, pos, ek = {}) =>
  bitrixPost(wf, ad, pos, 'batch', '={{ JSON.stringify({ halt: 0, cmd: $json.cmd }) }}', ek);

const vapiGet = (wf, ad, pos, yol, sorgu) =>
  wf.ekle(
    ad,
    HTTP,
    4.2,
    pos,
    {
      url: `${VAPI}${yol}`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      queryParameters: { parameters: sorgu.map(([name, value]) => ({ name, value })) },
      options: { timeout: 20000 },
    },
    {
      credentials: VAPI_CRED,
      executeOnce: true,
      alwaysOutputData: true,
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 2000,
      onError: 'continueRegularOutput',
    }
  );

const kosul = (wfAd, ad, sol, operator, sag = '') => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
  conditions: [{ id: uuid(wfAd, ad, sol), leftValue: sol, rightValue: sag, operator }],
  combinator: 'and',
});
const ESITTIR = { type: 'string', operation: 'equals' };
const DOGRU = { type: 'boolean', operation: 'true', singleValue: true };

const ifNode = (wf, ad, pos, sol, operator, sag) =>
  wf.ekle(ad, 'n8n-nodes-base.if', 2.2, pos, { conditions: kosul(wf.ad, ad, sol, operator, sag), options: {} });

const yanitNode = (wf, ad, pos, respondWith) =>
  wf.ekle(ad, 'n8n-nodes-base.respondToWebhook', 1.1, pos, { respondWith, options: {} });

const webhookNode = (wf, ad, pos, path, responseMode = 'responseNode') =>
  wf.ekle(ad, 'n8n-nodes-base.webhook', 2, pos, { httpMethod: 'POST', path, responseMode, options: {} }, { webhookId: uuid('webhook', path) });

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

// Olay Merkezi'ne (04) bildirim: hata olsa da ana akış devam eder
const olayBildir = (wf, ad, pos, ifade) =>
  wf.ekle(
    ad,
    HTTP,
    4.2,
    pos,
    {
      method: 'POST',
      url: "={{ $('AYARLAR').first().json.OLAY_WEBHOOK_URL }}",
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ olaylar: ${ifade} }) }}`,
      options: { timeout: 10000 },
    },
    { executeOnce: true, onError: 'continueRegularOutput' }
  );

const TABLO = { __rl: true, mode: 'name', value: 'efas_ntepe_olaylar' };
const TABLO_KOLONLARI = [
  ['gun', 'string'],
  ['tur', 'string'],
  ['yon', 'string'],
  ['lead_id', 'string'],
  ['telefon', 'string'],
  ['ad', 'string'],
  ['sonuc', 'string'],
  ['detay', 'string'],
  ['sure_sn', 'number'],
  ['maliyet', 'number'],
];
const tabloEkle = (wf, ad, pos) =>
  wf.ekle(
    ad,
    'n8n-nodes-base.dataTable',
    1,
    pos,
    { resource: 'row', operation: 'insert', dataTableId: TABLO, columns: { mappingMode: 'autoMapInputData', value: {} }, options: {} },
    { onError: 'continueRegularOutput' }
  );

const TELEGRAM_CRED = { telegramApi: { id: 'EfasTelegramBot', name: 'EFAS Telegram Bot' } };
const telegramNode = (wf, ad, pos) =>
  wf.ekle(
    ad,
    'n8n-nodes-base.telegram',
    1.2,
    pos,
    {
      resource: 'message',
      operation: 'sendMessage',
      chatId: "={{ $('AYARLAR').first().json.TELEGRAM.CHAT_ID }}",
      text: '={{ $json.metin }}',
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true, appendAttribution: false },
    },
    { credentials: TELEGRAM_CRED, onError: 'continueRegularOutput' }
  );

const ON = 'EFAS N-TEPE | ';
const dosyalar = {};

// =====================================================================
// 00 — Kurulum ve Kontrol
// =====================================================================
{
  const wf = new Workflow(`${ON}00 Kurulum ve Kontrol`);
  wf.not(
    '## 00 · Kurulum ve Kontrol\nBir kez **elle** çalıştırın (04 aktif edildikten sonra).\n\n1. Bitrix\'te 5 lead alanını oluşturur (UF_CRM_EFAS_AI_*)\n2. Statü kodlarını doğrular\n3. Vapi numaralarını ve asistanlarını kontrol eder\n4. **efas_ntepe_olaylar** veri tablosunu oluşturur\n5. 04 Olay Merkezi webhook\'unu test eder\n\nSonuç: son node\'daki **rapor** alanı.',
    [-60, -260],
    420,
    220
  );
  const tetik = TEST
    ? webhookNode(wf, 'Manuel Başlat', [0, 0], 'test-efas-kurulum', 'lastNode')
    : wf.ekle('Manuel Başlat', 'n8n-nodes-base.manualTrigger', 1, [0, 0], {});
  const ay = ayarlarNode(wf, [220, 0]);
  const plan = codeNode(wf, 'Alan Planı', [440, 0], kod('kurulum-plani.js'));
  const bx = bitrixBatch(wf, 'Bitrix: Alanları Oluştur', [660, 0], { onError: 'continueRegularOutput', alwaysOutputData: true });
  const num = vapiGet(wf, 'Vapi: Telefon Numaraları', [880, 0], '/phone-number', [['limit', '100']]);
  const ast = vapiGet(wf, 'Vapi: Asistanlar', [1100, 0], '/assistant', [['limit', '100']]);
  const tablo = wf.ekle(
    'Tablo: Olay Tablosu',
    'n8n-nodes-base.dataTable',
    1,
    [1320, 0],
    {
      resource: 'table',
      operation: 'create',
      tableName: 'efas_ntepe_olaylar',
      columns: { column: TABLO_KOLONLARI.map(([name, type]) => ({ name, type })) },
      options: { createIfNotExists: true },
    },
    { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' }
  );
  const olayTest = olayBildir(wf, 'Olay Merkezi Testi', [1540, 0], '[]');
  const rap = codeNode(wf, 'Kontrol Raporu', [1760, 0], kod('kontrol-raporu.js'));
  wf.zincir(tetik, ay, plan, bx, num, ast, tablo, olayTest, rap);
  dosyalar['00-kurulum-ve-kontrol.json'] = wf.json();
}

// =====================================================================
// 01 — Outbound Arama Kuyruğu (her 3 dakikada 3 numaradan aynı anda)
// =====================================================================
{
  const wf = new Workflow(`${ON}01 Outbound Arama Kuyruğu`);
  wf.not(
    '## 01 · Outbound Arama Kuyruğu\nHer **3 dakikada** bir çalışır (yalnızca ARAMA_SAATLERI içinde).\n\n• Bitrix\'te **EFAS N-TEPE YAPAY ZEKA** (UC_3W9EXO) statüsündeki lead\'leri okur\n• Boşta olan her numaraya (en fazla 3) bir lead verir, aramaları **aynı anda** başlatır\n• Aranan lead kilitlenir; sonucu **02 Outbound Vapi Sunucu** işler\n• Hakkı biten / numarası geçersiz lead\'leri **OLUMSUZ**\'a taşır\n• Başlayan aramaları 04 Olay Merkezi\'ne bildirir (rapor)\n\nKapasite: AYARLAR > TUR_BASINA_MAX_ARAMA ve HAT_BASINA_ESZAMANLI.\nBitrix\'te bu kuyruk için ayrıca otomasyon kuralı GEREKMEZ.',
    [-60, -320],
    520,
    280
  );
  const tetik = TEST
    ? webhookNode(wf, 'Her 3 Dakikada Bir', [0, 0], 'test-efas-kuyruk', 'lastNode')
    : wf.ekle('Her 3 Dakikada Bir', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], {
        rule: { interval: [{ field: 'minutes', minutesInterval: 3 }] },
      });
  const ay = ayarlarNode(wf, [220, 0]);
  const zaman = codeNode(wf, 'Zaman Kontrolü', [440, 0], kod('zaman-kontrolu.js'));
  const leadler = wf.ekle(
    'Bitrix: Kuyruktaki Leadler',
    HTTP,
    4.2,
    [660, 0],
    {
      method: 'POST',
      url: `${BITRIX}crm.lead.list.json`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ filter: { STATUS_ID: $('AYARLAR').first().json.STATU.YAPAY_ZEKA }, select: ${LEAD_ALANLARI}, order: { ID: 'ASC' }, start: 0 }) }}`,
      options: {
        pagination: {
          pagination: {
            paginationMode: 'updateAParameterInEachRequest',
            parameters: { parameters: [{ type: 'body', name: 'start', value: '={{ $response.body.next }}' }] },
            paginationCompleteWhen: 'other',
            completeExpression: '={{ !$response.body.next }}',
            limitPagesFetched: true,
            maxRequests: 40,
            requestInterval: 500,
          },
        },
        timeout: 30000,
      },
    },
    { executeOnce: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }
  );
  const telsiz = codeNode(wf, 'Telefonsuz Leadler', [660, 220], kod('telefonsuz-leadler.js'));
  const kisiler = bitrixPost(
    wf,
    'Bitrix: Kişi Telefonları',
    [880, 220],
    'crm.contact.list',
    "={{ JSON.stringify({ filter: { ID: $json.kisiIdleri.length ? $json.kisiIdleri : [0] }, select: ['ID', 'PHONE'] }) }}",
    { executeOnce: true, onError: 'continueRegularOutput', alwaysOutputData: true }
  );
  const num = vapiGet(wf, 'Vapi: Telefon Numaraları', [880, 0], '/phone-number', [['limit', '100']]);
  const cagri = vapiGet(wf, 'Vapi: Aktif Çağrılar', [1100, 0], '/call', [
    ['createdAtGt', "={{ $('Zaman Kontrolü').first().json.aktifCagriBaslangic }}"],
    ['limit', '100'],
  ]);
  const asistanlar = vapiGet(wf, 'Vapi: Asistanlar', [1320, 0], '/assistant', [['limit', '100']]);
  const sec = codeNode(wf, 'Aranacakları Seç', [1540, 0], kod('aranacaklari-sec.js'));
  const kilit = bitrixBatch(wf, 'Bitrix: Kilitle / Kapat', [1760, 0]);
  const ayir = codeNode(wf, 'Aramaları Ayır', [1980, 0], kod('aramalari-ayir.js'));
  const baslat = wf.ekle(
    'Vapi: Aramayı Başlat',
    HTTP,
    4.2,
    [2200, 0],
    {
      method: 'POST',
      url: `${VAPI}/call`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.vapiBody) }}',
      options: { timeout: 30000 },
    },
    { credentials: VAPI_CRED, onError: 'continueErrorOutput' }
  );
  const ok = codeNode(wf, 'Başlatılan Aramalar', [2440, -100], kod('baslatilan-aramalar.js'));
  const okBx = bitrixBatch(wf, 'Bitrix: Çağrı ID Yaz', [2660, -100]);
  const okOlay = olayBildir(wf, 'Olay Bildir (Başlayan)', [2880, -100], "$('Başlatılan Aramalar').first().json.olaylar");
  const hata = codeNode(wf, 'Başlatılamayan Aramalar', [2440, 120], kod('baslatilamayan-aramalar.js'));
  const hataBx = bitrixBatch(wf, 'Bitrix: Hata Yaz', [2660, 120]);
  const hataOlay = olayBildir(wf, 'Olay Bildir (Hata)', [2880, 120], "$('Başlatılamayan Aramalar').first().json.olaylar");
  const kapat = codeNode(wf, 'Kapatılanlar', [1980, 220], kod('kapatilanlar.js'));
  const kapatOlay = olayBildir(wf, 'Olay Bildir (Kapatılan)', [2200, 220], '$json.olaylar');

  wf.zincir(tetik, ay, zaman, leadler, telsiz, kisiler, num, cagri, asistanlar, sec, kilit, ayir, baslat);
  wf.bagla(kilit, kapat);
  wf.zincir(kapat, kapatOlay);
  wf.bagla(baslat, ok, 0);
  wf.bagla(baslat, hata, 1);
  wf.zincir(ok, okBx, okOlay);
  wf.zincir(hata, hataBx, hataOlay);
  dosyalar['01-outbound-arama-kuyrugu.json'] = wf.json();
}

// =====================================================================
// 02 / 03 — Vapi Sunucuları (araç çağrıları + çağrı sonu raporu)
// =====================================================================
function sunucu({ ad, dosya, path, aciklama, leadBul, aracPlani, raporPlani }) {
  const wf = new Workflow(`${ON}${ad}`);
  wf.not(aciklama, [-60, -360], 560, 300);
  const wh = webhookNode(wf, 'Vapi Webhook', [0, 0], path);
  const ay = ayarlarNode(wf, [220, 0]);
  const coz = codeNode(wf, 'Mesajı Çöz', [440, 0], kod('mesaji-coz.js'));
  const tip = mesajTipiNode(wf, [660, 0]);
  const hemen = yanitNode(wf, 'Hemen Yanıtla', [900, 120], 'noData');
  const diger = yanitNode(wf, 'Yanıtla (Diğer)', [900, 300], 'noData');
  const [ilkLead, sonLead] = leadBul(wf, 1140);
  const ayrim = ifNode(wf, 'Araç mı Rapor mu?', [1600, 0], "={{ $('Mesajı Çöz').first().json.tip }}", ESITTIR, 'tool-calls');
  const plan = codeNode(wf, 'Araç Planı', [1840, -120], kod(aracPlani));
  const varMi = ifNode(wf, 'Kayıt Var mı?', [2060, -120], '={{ $json.kayitVar }}', DOGRU);
  const aracBx = bitrixBatch(wf, 'Bitrix: Araç Kaydı', [2280, -200], { onError: 'continueRegularOutput', maxTries: 2, waitBetweenTries: 1000 });
  const aracYanit = codeNode(wf, 'Araç Yanıtı', [2500, -120], kod('arac-yaniti.js'));
  const yanitla = wf.ekle('Yanıtla (Araç)', 'n8n-nodes-base.respondToWebhook', 1.1, [2720, -120], {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify({ results: $json.results }) }}',
    options: {},
  });
  const aracOlay = olayBildir(wf, 'Olay Bildir (Araç)', [2940, -120], '$json.olaylar');
  const rapor = codeNode(wf, 'Rapor Planı', [1840, 160], kod(raporPlani));
  const raporBx = bitrixBatch(wf, 'Bitrix: Rapor Kaydı', [2060, 160]);
  const raporOlay = olayBildir(wf, 'Olay Bildir (Rapor)', [2280, 160], "$('Rapor Planı').first().json.olaylar");

  wf.zincir(wh, ay, coz, tip);
  wf.bagla(tip, ilkLead, 0); // araç çağrısı: yanıtı Bitrix kaydından sonra ver
  wf.bagla(tip, hemen, 1); // çağrı raporu: Vapi'yi bekletme, hemen 200 dön
  wf.bagla(tip, diger, 2);
  wf.bagla(hemen, ilkLead);
  wf.bagla(sonLead, ayrim);
  wf.bagla(ayrim, plan, 0);
  wf.bagla(ayrim, rapor, 1);
  wf.zincir(plan, varMi);
  wf.bagla(varMi, aracBx, 0);
  wf.bagla(varMi, aracYanit, 1);
  wf.zincir(aracBx, aracYanit, yanitla, aracOlay);
  wf.zincir(rapor, raporBx, raporOlay);
  dosyalar[dosya] = wf.json();
}

sunucu({
  ad: '02 Outbound Vapi Sunucu',
  dosya: '02-outbound-vapi-sunucu.json',
  path: 'efas-ntepe-outbound',
  aciklama:
    "## 02 · Outbound Vapi Sunucu\n**EFAS N-TEPE - OUTBOUND** asistanının Server URL'i ve araçlarının URL'i bu webhook'tur.\n\n**Araçlar (görüşme sırasında):**\n• `randevu_olustur` → lead **YAPAY ZEKA RANDEVU OLUŞTURANLAR** (UC_ML92HM) + sorumluya randevu görevi\n• `geri_arama_planla` → lead kuyrukta kalır, istenen saatte tekrar aranır\n• `olumsuz_kaydet` → lead **EFAS N-TEPE OLUMSUZ** (UC_PTDA4Y)\n\n**Çağrı sonu raporu:** ulaşılamadıysa tekrar planlar, hakkı bittiyse OLUMSUZ'a taşır; özet + ses kaydını lead'e yorum olarak ekler.",
  leadBul: (wf, x) => {
    const n = bitrixPost(wf, 'Bitrix: Lead Getir', [x, 0], 'crm.lead.get', "={{ JSON.stringify({ id: $('Mesajı Çöz').first().json.leadId || 0 }) }}", {
      onError: 'continueRegularOutput',
      alwaysOutputData: true,
      maxTries: 2,
      waitBetweenTries: 1000,
    });
    return [n, n];
  },
  aracPlani: 'outbound-arac-plani.js',
  raporPlani: 'outbound-rapor-plani.js',
});

sunucu({
  ad: '03 Inbound Vapi Sunucu',
  dosya: '03-inbound-vapi-sunucu.json',
  path: 'efas-ntepe-inbound',
  aciklama:
    "## 03 · Inbound Vapi Sunucu\n**EFAS N-TEPE - INBOUND** asistanının Server URL'i ve `randevu_olustur` aracının URL'i bu webhook'tur.\n\nArayan numara Bitrix'te aranır (bu projeye ait en yeni lead):\n• **Randevu** → mevcut lead güncellenir ya da yeni lead açılır → **YAPAY ZEKA RANDEVU OLUŞTURANLAR** + sorumluya görev\n• **Bilgi aldı / sonra aranmak istiyor** → sorumluya dönüş görevi (yeni arayansa lead açılır)\n• **Olumsuz** → kuyruktaki lead **OLUMSUZ**'a taşınır\n\nÖzet ve ses kaydı lead'e yorum olarak eklenir.",
  leadBul: (wf, x) => {
    const ara = bitrixPost(
      wf,
      'Bitrix: Telefonla Ara',
      [x, 0],
      'crm.duplicate.findbycomm',
      "={{ JSON.stringify({ entity_type: 'LEAD', type: 'PHONE', values: $('Mesajı Çöz').first().json.telefonVaryantlari.length ? $('Mesajı Çöz').first().json.telefonVaryantlari : ['0'] }) }}",
      { onError: 'continueRegularOutput', alwaysOutputData: true, maxTries: 2, waitBetweenTries: 1000 }
    );
    const detay = bitrixPost(
      wf,
      'Bitrix: Lead Detayları',
      [x + 220, 0],
      'crm.lead.list',
      `={{ JSON.stringify({ filter: { ID: ($json.result && $json.result.LEAD && $json.result.LEAD.length) ? $json.result.LEAD : [0] }, select: ${LEAD_ALANLARI}, order: { ID: 'DESC' } }) }}`,
      { onError: 'continueRegularOutput', alwaysOutputData: true, maxTries: 2, waitBetweenTries: 1000 }
    );
    wf.zincir(ara, detay);
    return [ara, detay];
  },
  aracPlani: 'inbound-arac-plani.js',
  raporPlani: 'inbound-rapor-plani.js',
});

// =====================================================================
// 04 — Olay ve Mesaj Merkezi (kayıt + SMS + WhatsApp + anlık Telegram)
// =====================================================================
{
  const wf = new Workflow(`${ON}04 Olay ve Mesaj Merkezi`);
  wf.not(
    "## 04 · Olay ve Mesaj Merkezi\n01/02/03 workflow'ları her olayı buraya gönderir (OLAY_WEBHOOK_URL).\n\n1. Olaylar **efas_ntepe_olaylar** veri tablosuna yazılır (raporun kaynağı)\n2. Müşteriye mesaj:\n   • randevu → SMS + WhatsApp teyidi\n   • ilk aramada ulaşılamadı → tanıtım SMS + WhatsApp + e-posta (afişli; İYS onayı olanlara!)\n   • görüştü, karar vermedi / bilgi istedi → WhatsApp bilgi\n3. Her randevu Telegram grubuna anlık düşer\n\nKanallar AYARLAR'da SMS/WHATSAPP/EPOSTA/TELEGRAM → AKTIF ile açılır.\nE-posta için \"EFAS SMTP\" credential'ını seçin. Afiş: GET …/webhook/efas-ntepe-afis",
    [-60, -380],
    560,
    320
  );
  const wh = webhookNode(wf, 'Olay Webhook', [0, 0], 'efas-ntepe-olay', 'onReceived');
  const ay = ayarlarNode(wf, [220, 0]);
  const kayit = codeNode(wf, 'Olay Kayıtları', [440, 0], kod('olay-kayitlari.js'));
  const tablo = tabloEkle(wf, 'Tablo: Olayları Kaydet', [660, 0]);
  const plan = codeNode(wf, 'Mesaj Planı', [880, 0], kod('mesaj-plani.js'));
  const kanal = wf.ekle('Kanal', 'n8n-nodes-base.switch', 3.2, [1100, 0], {
    rules: {
      values: [
        { conditions: kosul(wf.ad, 'k1', '={{ $json.kanal }}', ESITTIR, 'sms'), renameOutput: true, outputKey: 'SMS' },
        { conditions: kosul(wf.ad, 'k2', '={{ $json.kanal }}', ESITTIR, 'whatsapp'), renameOutput: true, outputKey: 'WhatsApp' },
        { conditions: kosul(wf.ad, 'k3', '={{ $json.kanal }}', ESITTIR, 'telegram'), renameOutput: true, outputKey: 'Telegram' },
        { conditions: kosul(wf.ad, 'k4', '={{ $json.kanal }}', ESITTIR, 'eposta'), renameOutput: true, outputKey: 'E-posta' },
      ],
    },
    options: {},
  });
  const sms = wf.ekle(
    'SMS Gönder (XML)',
    HTTP,
    4.2,
    [1340, -160],
    {
      method: 'POST',
      url: "={{ $('AYARLAR').first().json.SMS.API_URL }}",
      // Erccell yanıtı brotli sıkıştırmalı gelince <RESULT> okunamıyordu; sıkıştırmasız iste
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept-Encoding', value: 'identity' }] },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'text/xml',
      body: '={{ $json.govde }}',
      options: { timeout: 20000 },
    },
    { onError: 'continueRegularOutput' }
  );
  const wa = wf.ekle(
    'WhatsApp: Şablon Gönder',
    HTTP,
    4.2,
    [1340, 0],
    {
      method: 'POST',
      url: "={{ $('AYARLAR').first().json.WHATSAPP.API_URL }}/{{ $('AYARLAR').first().json.WHATSAPP.TELEFON_NUMARASI_ID }}/messages",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.govde) }}',
      options: { timeout: 20000 },
    },
    { credentials: { httpHeaderAuth: { id: 'EfasWhatsAppApi', name: 'WhatsApp API' } }, onError: 'continueRegularOutput' }
  );
  const tg = telegramNode(wf, 'Telegram: Anlık Bildirim', [1340, 160]);
  const ep = wf.ekle(
    'E-posta Gönder',
    'n8n-nodes-base.emailSend',
    2.1,
    [1340, 320],
    {
      fromEmail: "={{ $('AYARLAR').first().json.EPOSTA.GONDEREN }}",
      toEmail: '={{ $json.alici }}',
      subject: '={{ $json.konu }}',
      emailFormat: 'both',
      text: '={{ $json.metin }}',
      html: '={{ $json.html }}',
      options: { appendAttribution: false },
    },
    { credentials: { smtp: { id: 'EfasSmtp', name: 'EFAS SMTP' } }, onError: 'continueRegularOutput' }
  );
  const sonuc = codeNode(wf, 'Mesaj Sonuçları', [1580, -80], kod('mesaj-sonucu.js'));

  // E-postadaki afiş görseli bu webhook'tan yayınlanır: GET …/webhook/efas-ntepe-afis
  const afisWh = wf.ekle(
    'Afiş Webhook',
    'n8n-nodes-base.webhook',
    2,
    [0, 520],
    { httpMethod: 'GET', path: 'efas-ntepe-afis', responseMode: 'responseNode', options: {} },
    { webhookId: uuid('webhook', 'efas-ntepe-afis') }
  );
  const afis = codeNode(
    wf,
    'Afiş Görseli',
    [220, 520],
    `// efas-ntepe/eposta/efas-afis.jpg (build sırasında gömülür)\nconst AFIS = '${readFileSync(join(KOK, '..', 'eposta', 'efas-afis.jpg')).toString('base64')}';\nreturn [{ json: {}, binary: { data: { data: AFIS, mimeType: 'image/jpeg', fileName: 'efas-afis.jpg', fileExtension: 'jpg' } } }];\n`
  );
  const afisYanit = wf.ekle('Afişi Döndür', 'n8n-nodes-base.respondToWebhook', 1.1, [440, 520], {
    respondWith: 'binary',
    options: { responseHeaders: { entries: [{ name: 'Cache-Control', value: 'public, max-age=86400' }] } },
  });
  wf.zincir(afisWh, afis, afisYanit);
  const tablo2 = tabloEkle(wf, 'Tablo: Mesajları Kaydet', [1800, -80]);

  wf.zincir(wh, ay, kayit, tablo, plan, kanal);
  wf.bagla(kanal, sms, 0);
  wf.bagla(kanal, wa, 1);
  wf.bagla(kanal, tg, 2);
  wf.bagla(kanal, ep, 3);
  wf.bagla(sms, sonuc);
  wf.bagla(wa, sonuc);
  wf.bagla(ep, sonuc);
  wf.zincir(sonuc, tablo2);
  dosyalar['04-olay-ve-mesaj-merkezi.json'] = wf.json();
}

// =====================================================================
// 05 — Günlük Rapor (Telegram grubuna)
// =====================================================================
{
  const wf = new Workflow(`${ON}05 Günlük Rapor (Telegram)`);
  wf.not(
    '## 05 · Günlük Rapor\nHer gün **13:30** (ara rapor) ve **19:30** (gün sonu) Telegram grubuna:\narama · ulaşılan · randevu · olumsuz · SMS · WhatsApp · konuşma süresi · Vapi maliyeti · kuyrukta kalan + günün randevu listesi.\n\nSaatleri tetikleyicideki cron ifadesinden değiştirin.',
    [-60, -300],
    480,
    240
  );
  const tetik = TEST
    ? webhookNode(wf, 'Rapor Saati', [0, 0], 'test-efas-rapor', 'lastNode')
    : wf.ekle('Rapor Saati', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], {
        rule: { interval: [{ field: 'cronExpression', expression: '30 13,19 * * *' }] },
      });
  const ay = ayarlarNode(wf, [220, 0]);
  const kuyruk = bitrixPost(
    wf,
    'Bitrix: Kuyruk Sayısı',
    [440, 0],
    'crm.lead.list',
    "={{ JSON.stringify({ filter: { STATUS_ID: $('AYARLAR').first().json.STATU.YAPAY_ZEKA }, select: ['ID'], start: 0 }) }}",
    { executeOnce: true, onError: 'continueRegularOutput' }
  );
  const olaylar = wf.ekle(
    'Tablo: Bugünün Olayları',
    'n8n-nodes-base.dataTable',
    1,
    [660, 0],
    {
      resource: 'row',
      operation: 'get',
      dataTableId: TABLO,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'gun', condition: 'eq', keyValue: '={{ new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10) }}' }] },
      returnAll: true,
    },
    { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' }
  );
  const metin = codeNode(wf, 'Rapor Metni', [880, 0], kod('rapor-metni.js'));
  const tg = telegramNode(wf, 'Telegram: Raporu Gönder', [1100, 0]);
  wf.zincir(tetik, ay, kuyruk, olaylar, metin, tg);
  dosyalar['05-gunluk-rapor-telegram.json'] = wf.json();
}

mkdirSync(CIKTI, { recursive: true });
for (const [ad, icerik] of Object.entries(dosyalar)) {
  writeFileSync(join(CIKTI, ad), JSON.stringify(icerik, null, 2) + '\n');
  console.log('yazıldı:', join(CIKTI, ad));
}
