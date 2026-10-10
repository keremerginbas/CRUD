#!/usr/bin/env node
// XRE FRANCHISE — KURUCU 100 n8n workflow'larını üretir.
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
const VAPI_CRED = { httpHeaderAuth: { id: 'XreFranchiseVapiApiCredential', name: 'Vapi API' } };
const BITRIX = "={{ $('AYARLAR').first().json.BITRIX_WEBHOOK }}";
const VAPI = "={{ $('AYARLAR').first().json.VAPI_API }}";
const LEAD_ALANLARI = "['ID', 'STATUS_ID', 'NAME', 'LAST_NAME', 'PHONE', 'EMAIL', 'ASSIGNED_BY_ID'].concat(Object.values($('AYARLAR').first().json.ALAN))";

const codeNode = (wf, ad, pos, js) => wf.ekle(ad, 'n8n-nodes-base.code', 2, pos, { jsCode: js });
const ayarlarNode = (wf, pos) => codeNode(wf, 'AYARLAR', pos, AYARLAR_KODU);

const bitrixPost = (wf, ad, pos, metod, govde, ek = {}) =>
  wf.ekle(ad, HTTP, 4.2, pos, { method: 'POST', url: `${BITRIX}${metod}.json`, sendBody: true, specifyBody: 'json', jsonBody: govde, options: { timeout: 30000 } }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, ...ek });
const bitrixBatch = (wf, ad, pos, ek = {}) => bitrixPost(wf, ad, pos, 'batch', '={{ JSON.stringify({ halt: 0, cmd: $json.cmd }) }}', ek);

const vapiGet = (wf, ad, pos, yol, sorgu) =>
  wf.ekle(
    ad,
    HTTP,
    4.2,
    pos,
    { url: `${VAPI}${yol}`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendQuery: true, queryParameters: { parameters: sorgu.map(([name, value]) => ({ name, value })) }, options: { timeout: 20000 } },
    { credentials: VAPI_CRED, executeOnce: true, alwaysOutputData: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput' }
  );

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

const ON = 'XRE FRANCHISE | ';
const dosyalar = {};

// =====================================================================
// 00 — Kurulum ve Kontrol
// =====================================================================
{
  const wf = new Workflow(`${ON}00 Kurulum ve Kontrol`);
  wf.not(
    "## 00 · Kurulum ve Kontrol\nBir kez **elle** çalıştırın.\n\n1. Bitrix'te 4 lead alanını oluşturur (UF_CRM_XFR_AI_*)\n2. 9 statü kodunu doğrular (önce Bitrix'te oluşturup AYARLAR'a kodlarını yazmanız gerekir)\n3. Vapi numaralarını ve outbound asistanını kontrol eder\n\nSonuç: son node'daki **rapor** alanı.",
    [-60, -260],
    440,
    220
  );
  const tetik = TEST
    ? webhookNode(wf, 'Manuel Başlat', [0, 0], 'test-xfr-kurulum', 'lastNode')
    : wf.ekle('Manuel Başlat', 'n8n-nodes-base.manualTrigger', 1, [0, 0], {});
  const ay = ayarlarNode(wf, [220, 0]);
  const plan = codeNode(wf, 'Alan Planı', [440, 0], kod('kurulum-plani.js'));
  const bx = bitrixBatch(wf, 'Bitrix: Alanları Oluştur', [660, 0], { onError: 'continueRegularOutput', alwaysOutputData: true });
  const num = vapiGet(wf, 'Vapi: Telefon Numaraları', [880, 0], '/phone-number', [['limit', '100']]);
  const ast = vapiGet(wf, 'Vapi: Asistanlar', [1100, 0], '/assistant', [['limit', '100']]);
  const rap = codeNode(wf, 'Kontrol Raporu', [1320, 0], kod('kontrol-raporu.js'));
  wf.zincir(tetik, ay, plan, bx, num, ast, rap);
  dosyalar['00-kurulum-ve-kontrol.json'] = wf.json();
}

// =====================================================================
// 01 — Arama Kuyruğu
// =====================================================================
{
  const wf = new Workflow(`${ON}01 Arama Kuyruğu`);
  wf.not(
    "## 01 · Arama Kuyruğu\nHer **3 dakikada** bir çalışır (yalnızca ARAMA_SAATLERI içinde).\n\n• Bitrix'te **Aranacak** statüsündeki adayları okur\n• Boşta olan her numaraya (en fazla TUR_BASINA_MAX_ARAMA) bir aday verir, aramaları aynı anda başlatır\n• Aranan aday kilitlenir; sonucu **02 Outbound** işler\n• Deneme hakkı biten / numarası geçersiz adayları **AI Görüştü**'ye taşır (bir daha aranmaz)\n\n140K'lık hacim için ARAYAN_NUMARALAR'a birden fazla hat ekleyin.",
    [-60, -320],
    520,
    260
  );
  const tetik = TEST
    ? webhookNode(wf, 'Her 3 Dakikada Bir', [0, 0], 'test-xfr-kuyruk', 'lastNode')
    : wf.ekle('Her 3 Dakikada Bir', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'minutes', minutesInterval: 3 }] } });
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
      jsonBody: `={{ JSON.stringify({ filter: { STATUS_ID: $('AYARLAR').first().json.STATU.ARANACAK }, select: ${LEAD_ALANLARI}, order: { ID: 'ASC' }, start: 0 }) }}`,
      options: {
        pagination: {
          pagination: {
            paginationMode: 'updateAParameterInEachRequest',
            parameters: { parameters: [{ type: 'body', name: 'start', value: '={{ $response.body.next }}' }] },
            paginationCompleteWhen: 'other',
            completeExpression: '={{ !$response.body.next }}',
            limitPagesFetched: true,
            maxRequests: 400,
            requestInterval: 300,
          },
        },
        timeout: 30000,
      },
    },
    { executeOnce: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }
  );
  const num = vapiGet(wf, 'Vapi: Telefon Numaraları', [660, -220], '/phone-number', [['limit', '100']]);
  const cagri = vapiGet(wf, 'Vapi: Aktif Çağrılar', [880, -220], '/call', [['createdAtGt', "={{ $('Zaman Kontrolü').first().json.aktifCagriBaslangic }}"], ['limit', '100']]);
  const asistanlar = vapiGet(wf, 'Vapi: Asistanlar', [1100, -220], '/assistant', [['limit', '100']]);
  const sec = codeNode(wf, 'Aranacakları Seç', [1320, 0], kod('aranacaklari-sec.js'));
  const kilit = bitrixBatch(wf, 'Bitrix: Kilitle / Kapat', [1540, 0]);
  const ayir = codeNode(wf, 'Aramaları Ayır', [1760, 0], kod('aramalari-ayir.js'));
  const baslat = wf.ekle(
    'Vapi: Aramayı Başlat',
    HTTP,
    4.2,
    [1980, 0],
    { method: 'POST', url: `${VAPI}/call`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.vapiBody) }}', options: { timeout: 30000 } },
    { credentials: VAPI_CRED, onError: 'continueErrorOutput' }
  );
  const ok = codeNode(wf, 'Başlatılan Aramalar', [2200, -100], kod('baslatilan-aramalar.js'));
  const okBx = bitrixBatch(wf, 'Bitrix: Çağrı ID Yaz', [2420, -100], { onError: 'continueRegularOutput' });
  const hata = codeNode(wf, 'Başlatılamayan Aramalar', [2200, 120], kod('baslatilamayan-aramalar.js'));
  const hataBx = bitrixBatch(wf, 'Bitrix: Hata Yaz', [2420, 120], { onError: 'continueRegularOutput' });

  wf.zincir(tetik, ay, zaman, leadler, num, cagri, asistanlar, sec, kilit, ayir, baslat);
  wf.bagla(baslat, ok, 0);
  wf.bagla(baslat, hata, 1);
  wf.zincir(ok, okBx);
  wf.zincir(hata, hataBx);
  dosyalar['01-arama-kuyrugu.json'] = wf.json();
}

// =====================================================================
// 02 — Outbound Vapi Sunucu
// =====================================================================
{
  const wf = new Workflow(`${ON}02 Outbound`);
  wf.not(
    "## 02 · Outbound Vapi Sunucu\n**XRE FRANCHISE - OUTBOUND** asistanının Server URL'i bu webhook'tur (bu asistanda araç/tool YOK, sonuç çağrı sonu analizinden okunur).\n\n• DNC / yanlış kişi / olumsuz / ulaşılamadı (tükendi) → **AI Görüştü**\n• Ulaşılamadı (deneme kaldıysa) / geri aranacak → tekrar **Aranacak**'ta kalır\n• Randevu / ilgileniyor → **İlgileniyor**; video istediyse WhatsApp'tan tanıtım videosu gönderilir, başarılıysa **Video Gönderildi** → **Asistan Arayacak** + insan görevi",
    [-60, -300],
    560,
    260
  );
  const wh = webhookNode(wf, 'Vapi Webhook', [0, 0], 'xre-franchise-outbound');
  const ay = ayarlarNode(wf, [220, 0]);
  const coz = codeNode(wf, 'Mesajı Çöz', [440, 0], kod('mesaji-coz.js'));
  const hemen = yanitNode(wf, 'Hemen Yanıtla', [660, 0], 'noData');
  const leadGetir = bitrixPost(wf, 'Bitrix: Lead Getir', [880, 0], 'crm.lead.get', "={{ JSON.stringify({ id: $('Mesajı Çöz').first().json.leadId || 0 }) }}", { onError: 'continueRegularOutput' });
  const raporPlan = codeNode(wf, 'Rapor Planı', [1100, 0], kod('outbound-rapor-plani.js'));
  const raporBx = bitrixBatch(wf, 'Bitrix: Rapor Kaydı', [1320, 0], { onError: 'continueRegularOutput' });
  const mesajPlan = codeNode(wf, 'Mesaj Planı', [1540, 0], kod('mesaj-plani.js'));
  const whatsapp = wf.ekle(
    'WhatsApp: Video Gönder',
    HTTP,
    4.2,
    [1760, 0],
    { method: 'POST', url: "={{ $('AYARLAR').first().json.WHATSAPP.API_URL }}/{{ $('AYARLAR').first().json.WHATSAPP.TELEFON_NUMARASI_ID }}/messages", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.govde) }}', options: { timeout: 20000 } },
    { credentials: { httpHeaderAuth: { id: 'XreFranchiseWhatsAppApi', name: 'WhatsApp API' } }, onError: 'continueRegularOutput' }
  );
  const videoSonuc = codeNode(wf, 'Video Sonucu', [1980, 0], kod('video-sonuc.js'));
  const videoBx = bitrixBatch(wf, 'Bitrix: Video Sonucu Kaydı', [2200, 0], { onError: 'continueRegularOutput' });

  wf.zincir(wh, ay, coz, hemen, leadGetir, raporPlan, raporBx, mesajPlan, whatsapp, videoSonuc, videoBx);
  dosyalar['02-outbound.json'] = wf.json();
}

// =====================================================================
// 05 — Günlük Huni Raporu (Telegram)
// =====================================================================
{
  const wf = new Workflow(`${ON}05 Günlük Rapor`);
  wf.not('## 05 · Günlük Rapor\nHer gün **09:30** ve **18:30** Telegram grubuna 9 statüdeki aday sayılarını (huni) gönderir.\n\nSaatleri tetikleyicideki cron ifadesinden değiştirin.', [-60, -260], 460, 200);
  const tetik = TEST
    ? webhookNode(wf, 'Rapor Saati', [0, 0], 'test-xfr-rapor', 'lastNode')
    : wf.ekle('Rapor Saati', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'cronExpression', expression: '30 9,18 * * *' }] } });
  const ay = ayarlarNode(wf, [220, 0]);
  const sayimKod = codeNode(wf, 'Sayım Komutları', [440, 0], kod('sayim-komutlari.js'));
  const sayim = bitrixBatch(wf, 'Bitrix: Statü Sayıları', [660, 0], { executeOnce: true, onError: 'continueRegularOutput' });
  const metin = codeNode(wf, 'Rapor Metni', [880, 0], kod('rapor-metni.js'));
  const tg = telegramNode(wf, 'Telegram: Raporu Gönder', [1100, 0]);
  wf.zincir(tetik, ay, sayimKod, sayim, metin, tg);
  dosyalar['05-gunluk-rapor.json'] = wf.json();
}

mkdirSync(CIKTI, { recursive: true });
for (const [ad, icerik] of Object.entries(dosyalar)) {
  writeFileSync(join(CIKTI, ad), JSON.stringify(icerik, null, 2) + '\n');
  console.log('yazıldı:', join(CIKTI, ad));
}
