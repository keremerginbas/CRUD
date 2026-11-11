// Eklentiyi gerçek tarayıcıya yükleyip uçtan uca dener: tarama, kayıt ve Telegram bildirimi.
// İnternete çıkmaz: mağaza ve Telegram adresleri bu testin açtığı yerel sunucuya yönlendirilir,
// böylece eklentinin gerçek ağ çağrıları (izinleriyle birlikte) sınanır.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const EXT = path.join(__dirname, '..');
const ISBN = '9786259756189';
const TOKEN = '111111:TEST-TOKEN';
const TARGET = { id: 'imge', name: 'İmge Kitabevi', url: `https://www.imge.com.tr/urun/ornek-${ISBN}` };
const CONNECTED = { token: TOKEN, chatId: 777, chatName: 'Ada', botName: 'kitap_test_bot' };

// İmge'nin sayfa yapısına benzeyen örnek ürün sayfası: stok adedi sayfa verisinde gömülü.
const productPage = (qty) => `<!doctype html><html><head><meta charset="utf-8"><title>Özgür'ün Salıncağı - Kitap</title></head><body>
<script>window.__NUXT__ = { data: [{ item: { barkod: "${ISBN}", smiktar: ${qty} } }] };</script>
<main><h1>Özgür'ün Salıncağı</h1><p>ISBN : ${ISBN} Baskı : 1</p><p>Liste Fiyatı : 150,00 ₺</p>${qty > 0 ? '<button>Sepete Ekle</button>' : ''}</main></body></html>`;
const challengePage = '<!doctype html><html><head><meta charset="utf-8"><title>Bir dakika lütfen...</title></head><body><p>Güvenlik doğrulaması yapılıyor</p></body></html>';

let ctx, dash, profile, server;
let storeHtml = productPage(2); // mağazanın o an sunduğu sayfa
const tgCalls = []; // eklentiden (arka plan ve panel) Telegram'a giden bütün çağrılar
let tgReplies = {}; // Telegram yöntemine göre dönülecek yanıt

test.before(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kitap-takip-test-'));
  const key = path.join(profile, 'key.pem');
  const cert = path.join(profile, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=kitap-takip-test'], { stdio: 'ignore' });
  server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    if (host !== 'api.telegram.org') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(storeHtml);
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const method = req.url.split('/').pop();
      tgCalls.push({ url: `https://${host}${req.url}`, method: req.method, body: raw ? JSON.parse(raw) : null });
      const reply = tgReplies[method] || { status: 500, body: { ok: false, error_code: 500, description: 'yanıt tanımlı değil' } };
      res.writeHead(reply.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  ctx = await chromium.launchPersistentContext(path.join(profile, 'chrome'), {
    channel: 'chromium', headless: true, locale: 'tr-TR', acceptDownloads: true,
    args: [
      `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
      `--host-resolver-rules=MAP www.imge.com.tr 127.0.0.1:${port}, MAP api.telegram.org 127.0.0.1:${port}`,
      '--ignore-certificate-errors', '--no-proxy-server',
    ],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  dash = await ctx.newPage();
  await dash.goto(`chrome-extension://${sw.url().split('/')[2]}/dashboard.html`);
});

test.after(async () => {
  if (ctx) await ctx.close();
  if (server) server.close();
  fs.rmSync(profile, { recursive: true, force: true });
});

const store = (items) => dash.evaluate((x) => chrome.storage.local.set(x), items);
const read = (keys) => dash.evaluate((k) => chrome.storage.local.get(k), keys);

const SENT = { status: 200, body: { ok: true, result: { message_id: 1, date: 1794380100, chat: { id: 777, first_name: 'Ada', type: 'private' }, text: '' } } };
const sends = () => tgCalls.filter((c) => c.url.endsWith('/sendMessage')).map((c) => ({ url: c.url, body: c.body }));

async function scanAndWait() {
  const before = ((await read(['snapshots'])).snapshots || []).length;
  await dash.evaluate(() => chrome.runtime.sendMessage({ type: 'scan' }));
  for (let i = 0; i < 120; i++) {
    await dash.waitForTimeout(500);
    const s = await read(['snapshots', 'scanState']);
    if ((s.snapshots || []).length > before && s.scanState && !s.scanState.running) return s.snapshots[s.snapshots.length - 1];
  }
  throw new Error('tarama zamanında bitmedi');
}

async function reset(extra = {}) {
  tgCalls.length = 0;
  tgReplies = { sendMessage: SENT };
  await dash.evaluate(() => chrome.storage.local.clear());
  await store({ targets: [TARGET], scanState: { running: false }, ...extra });
}
const yesterday = () => Date.now() - 86400000;
const previous = (fields) => ({ targetId: 'imge', ts: yesterday(), status: 'in_stock', stockQty: 2, stockQtySource: 'sayfa verisi (smiktar)', price: 150, currency: 'TRY', edition: 1, ...fields });

// --- Tarama sonrası bildirim ---

test('stok tükenince tarama sonunda bağlı sohbete tek mesaj gider', async () => {
  await reset({ snapshots: [previous()], telegram: CONNECTED });
  storeHtml = productPage(0);
  const snap = await scanAndWait();
  assert.strictEqual(snap.status, 'out_of_stock');
  assert.deepStrictEqual(sends(), [{
    url: `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    body: { chat_id: 777, text: "Özgür'ün Salıncağı\nİmge Kitabevi: Stok tükendi\nİmge Kitabevi: Stoktan 2 adet düştü (kalan: 0)" },
  }]);
});

test('değişiklik yoksa mesaj gönderilmez', async () => {
  await reset({ snapshots: [previous()], telegram: CONNECTED });
  storeHtml = productPage(2);
  await scanAndWait();
  assert.deepStrictEqual(sends(), []);
});

test('Telegram bağlı değilse tarama hiçbir yere mesaj göndermez', async () => {
  await reset({ snapshots: [previous()] });
  storeHtml = productPage(0);
  await scanAndWait();
  assert.deepStrictEqual(tgCalls, []);
});

test('gönderim başarısız olursa neden panelde gösterilmek üzere kaydedilir', async () => {
  await reset({ snapshots: [previous()], telegram: CONNECTED });
  storeHtml = productPage(0);
  tgReplies = { sendMessage: { status: 403, body: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } } };
  await scanAndWait();
  const { telegram } = await read(['telegram']);
  assert.match(telegram.lastError.message, /Bot bu sohbete yazamıyor/);
  await dash.waitForTimeout(300);
  assert.match(await dash.locator('#tg-status').innerText(), /Bot bu sohbete yazamıyor/);
});

test('site doğrulama isterse bildirim gider, aynı gün ikinci kez gitmez', async () => {
  await reset({ snapshots: [previous()], telegram: CONNECTED });
  storeHtml = challengePage;
  await scanAndWait();
  assert.strictEqual(sends().length, 1);
  assert.match(sends()[0].body.text, /Doğrulama gerekiyor: İmge Kitabevi\./);
  await scanAndWait();
  assert.strictEqual(sends().length, 1);
  for (const p of ctx.pages()) if (p.url().startsWith('https://www.imge.com.tr/')) await p.close();
});

// --- Panelde bağlanma ---

const me = { ok: true, result: { id: 111111, is_bot: true, first_name: 'Kitap', username: 'kitap_test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } };
const startUpdate = { update_id: 1, message: { message_id: 1, from: { id: 777, is_bot: false, first_name: 'Ada', language_code: 'tr' }, chat: { id: 777, first_name: 'Ada', type: 'private' }, date: 1794380000, text: '/start', entities: [{ offset: 0, length: 6, type: 'bot_command' }] } };

test('geçersiz token bağlanmaz ve nedenini söyler', async () => {
  await reset();
  tgReplies = { getMe: { status: 401, body: { ok: false, error_code: 401, description: 'Unauthorized' } } };
  await dash.fill('#tg-token', 'yanlis-token');
  await dash.click('#tg-connect');
  await dash.waitForFunction(() => /Token geçersiz/.test(document.getElementById('tg-status').innerText));
  assert.strictEqual((await read(['telegram'])).telegram, undefined);
});

test('geçerli token ile bağlanınca bot ve sohbet adı görünür, ayar kaydedilir', async () => {
  await reset();
  tgReplies = { getMe: { body: me }, getUpdates: { body: { ok: true, result: [startUpdate] } } };
  await dash.fill('#tg-token', TOKEN);
  await dash.click('#tg-connect');
  await dash.waitForFunction(() => /kitap_test_bot/.test(document.getElementById('tg-status').innerText));
  assert.match(await dash.locator('#tg-status').innerText(), /Ada/);
  const { telegram } = await read(['telegram']);
  assert.deepStrictEqual({ token: telegram.token, chatId: telegram.chatId, chatName: telegram.chatName, botName: telegram.botName }, CONNECTED);
  assert.strictEqual(await dash.locator('#tg-token').isVisible(), false);
});

test('deneme mesajı bağlı sohbete gider', async () => {
  await reset({ telegram: CONNECTED });
  await dash.click('#tg-test');
  await dash.waitForFunction(() => /gönderildi/.test(document.getElementById('tg-status').innerText));
  assert.strictEqual(sends().length, 1);
  assert.strictEqual(sends()[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.strictEqual(sends()[0].body.chat_id, 777);
  assert.match(sends()[0].body.text, /Özgür'ün Salıncağı/);
});

test('bağlantı kaldırılınca token silinir ve dışa aktarılan dosyalarda yer almaz', async () => {
  await reset({ telegram: CONNECTED });
  const [download] = await Promise.all([dash.waitForEvent('download'), dash.click('#diag')]);
  const exported = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(!exported.includes(TOKEN), 'tanı dosyası token içermemeli');
  await dash.click('#tg-disconnect');
  await dash.waitForFunction(() => document.getElementById('tg-token').offsetParent !== null);
  assert.strictEqual((await read(['telegram'])).telegram, undefined);
});
