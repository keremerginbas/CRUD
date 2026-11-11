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
const { createShops } = require('./helpers/fake-shops.js');

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
const shops = createShops(); // sepet ölçümü testleri için sahte pazaryerleri
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
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (shops.handle(host, req, raw, res)) return;
      if (host !== 'api.telegram.org') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(storeHtml);
        return;
      }
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
      `--host-resolver-rules=${['www.imge.com.tr', 'api.telegram.org', ...shops.HOSTS].map((h) => `MAP ${h} 127.0.0.1:${port}`).join(', ')}`,
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

// Taramayı başlatır (varsayılan: tam tarama) ve yeni kayıt gelip tarama bitene kadar bekler.
async function scanAndWait(start = () => dash.evaluate(() => chrome.runtime.sendMessage({ type: 'scan' }))) {
  const before = ((await read(['snapshots'])).snapshots || []).length;
  await start();
  for (let i = 0; i < 480; i++) {
    await dash.waitForTimeout(500);
    const s = await read(['snapshots', 'scanState']);
    if ((s.snapshots || []).length > before && s.scanState && !s.scanState.running) return s.snapshots[s.snapshots.length - 1];
  }
  throw new Error('tarama zamanında bitmedi');
}

async function reset(extra = {}) {
  shops.reset();
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

// --- Sepet sınırıyla stok ölçümü ---

const HB = { id: 'hepsiburada', name: 'Hepsiburada', url: 'https://www.hepsiburada.com/ornek-kitap-pm-HBC0000A6M7ZP' };
const AMZ = { id: 'amazon', name: 'Amazon', url: 'https://www.amazon.com.tr/dp/6259756186' };
const cartActivity = () => shops.state.log.filter((l) => /sepetim|\/api\/(add|qty|remove|cart|typed)|\/cart\/|\/gp\/cart/.test(l));
const PROBE_HB = { cartProbe: 2 }; // kullanıcının geçerli ölçüm sürümü (2) için verdiği onay
const untouched = () => ({ boughtNow: shops.state.boughtNow, deletedAll: shops.state.deletedAll, subscribed: shops.state.subscribed, typed: shops.state.hbTyped });
const UNTOUCHED = { boughtNow: false, deletedAll: false, subscribed: false, typed: [] };
const closeTabs = async (re) => { for (const p of ctx.pages()) if (re.test(p.url())) await p.close(); };

test('ölçüm kapalıyken sepete hiç dokunulmaz; satıcı adı yine okunur', async () => {
  await reset({ targets: [HB] });
  const snap = await scanAndWait();
  assert.strictEqual(snap.status, 'in_stock');
  assert.strictEqual(snap.seller, 'A Kitap');
  assert.strictEqual(snap.cartLimit, undefined);
  assert.deepStrictEqual(cartActivity(), []);
});

test('artı/eksi düğmeli sepette stok sınırı bulunur, kitap sepetten çıkarılır, diğer ürüne dokunulmaz', async () => {
  await reset({ targets: [HB], settings: PROBE_HB });
  const snap = await scanAndWait();
  assert.strictEqual(snap.cartLimit, 4);
  assert.strictEqual(snap.cartLimitCapped, false);
  assert.strictEqual(snap.stockQty, 4);
  assert.strictEqual(snap.stockQtySource, 'sepet sınırı');
  assert.strictEqual(snap.cartWarning, undefined);
  assert.strictEqual(shops.state.hbOurs, 0, 'kitap sepette kalmamalı');
  assert.strictEqual(shops.state.hbOther, 2, 'kullanıcının diğer ürünü değişmemeli');
  assert.deepStrictEqual(untouched(), UNTOUCHED, 'satın alma, toplu silme, üyelik düğmelerine ve adet kutusuna dokunulmamalı');
  assert.deepStrictEqual(ctx.pages().filter((p) => /hepsiburada/.test(p.url())).map((p) => p.url()), []);
});

test('Amazon düzeninde sepete dokunulmaz; sınır ürün sayfasındaki adet seçiciden okunur', async () => {
  await reset({ targets: [AMZ], settings: PROBE_HB });
  const snap = await scanAndWait();
  assert.strictEqual(snap.seller, 'Kitapsan');
  assert.strictEqual(snap.stockQty, 7);
  assert.strictEqual(snap.stockQtySource, 'adet seçici');
  assert.deepStrictEqual(cartActivity(), []);
  assert.strictEqual(shops.state.amzQty, 0);
});

test('önceki ölçüm sürümü için verilmiş onay yeni ölçümü çalıştırmaz', async () => {
  await reset({ targets: [HB], settings: { cartProbe: true } });
  const snap = await scanAndWait();
  assert.strictEqual(snap.cartLimit, undefined);
  assert.deepStrictEqual(cartActivity(), []);
});

test('adet azaltılamıyorsa ölçüm 2 adette durur ve uyarır; daha fazla eklenmez', async () => {
  await reset({ targets: [HB], settings: PROBE_HB });
  shops.state.hbLowerWorks = false;
  const snap = await scanAndWait();
  assert.strictEqual(shops.state.hbMaxSeen, 2, 'sepetteki adet hiçbir an 2\'yi geçmemeli');
  assert.strictEqual(snap.cartLimit, undefined);
  assert.match(snap.cartNote, /güvenle yapılamıyor/);
  assert.match(snap.cartWarning, /sepetinizden çıkarılamadı/);
  assert.deepStrictEqual(untouched(), UNTOUCHED);
  await closeTabs(/hepsiburada/);
});

test('ölçüm adet kutusuna hiçbir şey yazmaz', async () => {
  await reset({ targets: [HB], settings: PROBE_HB });
  const snap = await scanAndWait();
  assert.strictEqual(snap.cartLimit, 4);
  assert.deepStrictEqual(shops.state.hbTyped, []);
});

test('yalnızca adet kutusu olan sepette adet yükseltilmez; kitap sepetten çıkarılır', async () => {
  await reset({ targets: [HB], settings: PROBE_HB });
  shops.state.hbLayout = 'input';
  const snap = await scanAndWait();
  assert.match(snap.cartNote, /güvenle yapılamıyor/);
  assert.strictEqual(snap.cartLimit, undefined);
  assert.strictEqual(snap.cartWarning, undefined);
  assert.deepStrictEqual(shops.state.hbTyped, []);
  assert.strictEqual(shops.state.hbOurs, 0, 'kitap sepette kalmamalı');
  assert.strictEqual(shops.state.hbOther, 2);
});

test('"Sepet sayfasını incele" hiçbir düğmeye basmadan sepetin yapısını tanı kaydına yazar', async () => {
  await reset({ targets: [HB] });
  shops.state.hbOurs = 1;
  await dash.click('#cart-inspect');
  await dash.waitForFunction(() => /incelendi/.test(document.getElementById('cart-status').innerText), null, { timeout: 90000 });
  const { diag } = await read(['diag']);
  assert.strictEqual(diag.hepsiburada.cart.line.found, true);
  assert.strictEqual(diag.hepsiburada.cart.line.qty, 1);
  assert.match(diag.hepsiburada.cart.lineHtml, /Ürünü Arttır/);
  assert.ok(!shops.state.log.some((l) => /\/api\/(add|qty|remove|typed)$/.test(l)), shops.state.log.join(' | '));
  assert.strictEqual(shops.state.hbOurs, 1);
});

test('kitap zaten sepetteyse ölçüm yapılmaz ve sepet değişmez', async () => {
  await reset({ targets: [HB], settings: PROBE_HB });
  shops.state.hbOurs = 2;
  const snap = await scanAndWait();
  assert.match(snap.cartNote, /zaten sepetinizde/);
  assert.strictEqual(snap.cartLimit, undefined);
  assert.strictEqual(shops.state.hbOurs, 2);
  assert.ok(!shops.state.log.some((l) => /\/api\/(add|qty|remove)$/.test(l)), shops.state.log.join(' | '));
});

test('aynı gün ikinci taramada yeniden ölçülmez; son ölçüm kayda taşınır', async () => {
  await reset({ targets: [HB], settings: PROBE_HB });
  const first = await scanAndWait();
  shops.state.log.length = 0;
  const second = await scanAndWait();
  assert.deepStrictEqual(cartActivity(), []);
  assert.strictEqual(second.stockQty, 4);
  assert.strictEqual(second.cartCheckedAt, first.cartCheckedAt);
});

test('kitap sepetten çıkarılamazsa uyarı kaydedilir, Telegram\'a yazılır ve sepet sekmesi açık kalır', async () => {
  await reset({ targets: [HB], settings: PROBE_HB, telegram: CONNECTED });
  shops.state.hbRemoveWorks = false;
  const snap = await scanAndWait();
  assert.match(snap.cartWarning, /sepetinizden çıkarılamadı/);
  assert.strictEqual(sends().length, 1);
  assert.match(sends()[0].body.text, /Hepsiburada: Ölçümden sonra kitap sepetinizden çıkarılamadı/);
  assert.ok(ctx.pages().some((p) => p.url().startsWith('https://checkout.hepsiburada.com/sepetim')), 'sepet sekmesi açık kalmalı');
  await closeTabs(/hepsiburada/);
});

test('kitap sepete eklenemediyse ve adı sepet sayfasında başka yerde geçiyorsa başka ürüne dokunulmaz', async () => {
  await reset({ targets: [HB], settings: PROBE_HB });
  shops.state.hbAddWorks = false; // "Sepete ekle" sessizce işe yaramıyor; sepette yalnızca kullanıcının diğer ürünü var
  const snap = await scanAndWait();
  assert.strictEqual(shops.state.hbOther, 2, 'kullanıcının ürününün adedi değişmemeli');
  assert.ok(!shops.state.log.some((l) => /\/api\/(qty|remove)$/.test(l)), shops.state.log.join(' | '));
  assert.match(snap.cartNote, /sepete eklenemedi/);
  assert.strictEqual(snap.cartLimit, undefined);
  assert.strictEqual(snap.cartWarning, undefined);
});

test('panelden ölçüm açılır; "Şimdi ölç" yalnızca sepetli siteleri, bugün ölçülmüş olsa da yeniden ölçer', async () => {
  await reset({ targets: [HB, TARGET] });
  assert.strictEqual(await dash.locator('#cart-now').isDisabled(), true);
  await dash.check('#cart-probe');
  assert.strictEqual((await read(['settings'])).settings.cartProbe, 2);
  await scanAndWait(() => dash.click('#cart-now'));
  shops.state.log.length = 0;
  await scanAndWait(() => dash.click('#cart-now'));
  const { snapshots } = await read(['snapshots']);
  assert.deepStrictEqual(snapshots.map((x) => [x.targetId, x.cartLimit]), [['hepsiburada', 4], ['hepsiburada', 4]]);
  assert.ok(cartActivity().length > 0, 'ikinci basışta da ölçüm yapılmalı');
  const row = await dash.locator('#now tbody tr', { hasText: 'Hepsiburada' }).innerText();
  assert.match(row, /4 adet/);
  assert.match(row, /sepet sınırı/);
  assert.match(row, /A Kitap/);
});

test('kitap sepette kaldıysa uyarı panelde ilgili satırda görünür', async () => {
  await reset({ targets: [HB], snapshots: [{ targetId: 'hepsiburada', ts: Date.now(), status: 'in_stock', price: 120, currency: 'TRY', cartCheckedAt: Date.now(), cartWarning: 'Ölçümden sonra kitap sepetinizden çıkarılamadı; sepetinizi kontrol edin.' }] });
  await dash.waitForFunction(() => /sepetinizden çıkarılamadı/.test(document.querySelector('#now tbody').innerText));
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
