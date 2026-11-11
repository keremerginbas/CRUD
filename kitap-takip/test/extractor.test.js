// Sayfa okuyucuyu, gerçek sitelerin yapısına benzeyen küçük örnek sayfalarda dener.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { chromium } = require('playwright');

const ISBN = '9786259756189';
let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function run(html, title = 'Kitap') {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><title>${title}</title></head><body>${html}</body></html>`);
  await page.addScriptTag({ path: path.join(__dirname, '..', 'extractor.js') });
  const out = await page.evaluate((i) => globalThis.__kitapTakipExtract(i), ISBN);
  await page.close();
  return out;
}

async function runAt(url, html, fn) {
  const page = await browser.newPage();
  await page.route('https://ornek.test/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><title>Kitap</title></head><body>${html}</body></html>` }));
  await page.goto(url);
  await page.addScriptTag({ path: path.join(__dirname, '..', 'extractor.js') });
  const out = await page.evaluate(fn, ISBN);
  await page.close();
  return out;
}
const extractFn = (i) => globalThis.__kitapTakipExtract(i);

const carousel = '<section><h3>Benzer kitaplar</h3><div><span>Başka Kitap</span><span>90,00 ₺</span><button>Sepete Ekle</button><em>Tükendi</em></div></section>';

test('yapısal veri (JSON-LD) fiyatı verir; her üründe aynı olan gömülü adet varsayılan sayılır', async () => {
  const others = Array.from({ length: 5 }, (_, i) => `{"stockQuantity":100,"isbn":"97800000000${i}"}`).join(',');
  const out = await run(`
    <script type="application/ld+json">{"@graph":[{"@type":"Book","name":"Özgür'ün Salıncağı","offers":{"@type":"Offer","price":"127.50","priceCurrency":"TRY","availability":"https://schema.org/InStock"}}]}</script>
    <script>self.__data = [{"price":127.5,"stockQuantity":100,"isbn":"${ISBN}"},${others}]</script>
    <main><h1>Özgür'ün Salıncağı</h1><p>127,50 TL</p><input type="number" min="1" max="100"><button>Sepete Ekle</button><p>Yaklaşık 1-3 iş gününde temin</p></main>`);
  // Adet yer tutucu ve sayfa "temin" süresi veriyor: mağaza kendi stokundan satmıyor.
  assert.strictEqual(out.status, 'on_order');
  assert.strictEqual(out.price, 127.5);
  assert.strictEqual(out.currency, 'TRY');
  assert.strictEqual(out.stockQty, 100);
  assert.strictEqual(out.stockQtyPlaceholder, true);
  assert.strictEqual(out.maxOrderQty, 100);
  assert.strictEqual(out.leadTime, '1-3 iş gününde');
});

test('gömülü adet yalnızca bu kitaba özgüyse gerçek kabul edilir', async () => {
  const out = await run(`<script>self.__d = {"isbn":"${ISBN}","stock":7}</script><main><h1>Kitap</h1><p>150,00 ₺</p><button>Sepete Ekle</button></main>`);
  assert.strictEqual(out.stockQty, 7);
  assert.strictEqual(out.stockQtyPlaceholder, false);
});

test('site ayarlarındaki stok bayrakları (NEGATIVE_STOCK gibi) adet sanılmaz', async () => {
  const out = await run(`<script>const SETTINGS = {"NEGATIVE_STOCK":"0","STOCK_BACKUP":0}; var p = {"isbn":"${ISBN}"}; var cnf_negative_stock=0;</script><main><h1>Kitap</h1><p>97,50 TL</p><button>Sepete Ekle</button></main>`);
  assert.strictEqual(out.stockQty, undefined);
});

test('fiyat var ama satın alma düğmesi yoksa "satışa kapalı"; benzer ürün şeridi yanıltmaz', async () => {
  const out = await run(`<main><article><h1>Özgür'ün Salıncağı</h1><p>ISBN : ${ISBN} Baskı : 1</p><p>Liste Fiyatı : 150,00 ₺</p></article></main>${carousel}${'<p>dolgu metni</p>'.repeat(80)}`);
  assert.strictEqual(out.status, 'no_buy_button');
  assert.strictEqual(out.price, 150);
  assert.strictEqual(out.edition, 1);
});

test('düğme var ama temin süresi yazıyorsa "siparişle temin"; euro fiyat okunur', async () => {
  const out = await run(`<main><article><h1>Özgür'ün Salıncağı</h1><p>Ürün Temin Süresi : 7 Gün</p><p>Liste Fiyatı : 6,53 €</p><div class="btn">Sepete Ekle</div></article></main>${carousel}${'<p>dolgu metni</p>'.repeat(80)}`);
  assert.strictEqual(out.status, 'on_order');
  assert.strictEqual(out.price, 6.53);
  assert.strictEqual(out.currency, 'EUR');
  assert.strictEqual(out.leadTime, '7 Gün');
});

test('ürün alanında "Tükendi" yazıyorsa tükendi', async () => {
  const out = await run(`<main><article><h1>Kitap</h1><p>150,00 TL</p><strong>Tükendi</strong><button>Gelince haber ver</button></article></main>${'<p>dolgu metni</p>'.repeat(80)}`);
  assert.strictEqual(out.status, 'out_of_stock');
});

test('"son 3 ürün" uyarısı adet olarak okunur', async () => {
  const out = await run(`<main><h1>Kitap</h1><p>150,00 TL</p><p>Son 3 ürün!</p><button>Sepete Ekle</button><p>4 satıcı</p></main>`);
  assert.strictEqual(out.stockQty, 3);
  assert.strictEqual(out.stockQtySource, 'sayfa metni');
  assert.strictEqual(out.sellers, 4);
});

test('Amazon tarzı stok satırı, sıralama ve yorum sayısı', async () => {
  const out = await run(`<main><h1>Kitap</h1><span>150,00 TL</span><div id="availability">Stokta sadece 2 adet kaldı.</div><span id="acrCustomerReviewText">14 değerlendirme</span><p>En Çok Satanlar Sıralaması: Kitap içinde 12.345 numara</p></main>`);
  assert.strictEqual(out.status, 'in_stock');
  assert.strictEqual(out.stockQty, 2);
  assert.strictEqual(out.reviewCount, 14);
  assert.strictEqual(out.rank, 12345);
});

test('doğrulama sayfası "blocked" döner', async () => {
  assert.strictEqual((await run('<p>Güvenlik doğrulaması yapılıyor</p>', 'Bir dakika lütfen...')).status, 'blocked');
  assert.strictEqual((await run('', 'Hepsiburada | Güvenlik')).status, 'blocked');
});

test('arama sonucu boşsa "listelenmiyor"', async () => {
  const out = await run(`<nav>Menü</nav><p>Aradığınız kriterlere uygun ürün bulunamadı.</p>${carousel}`, `${ISBN} - Arama`);
  assert.strictEqual(out.status, 'not_listed');
});

test('okur sitesi sayaçları okunur', async () => {
  const out = await run('<main><h1>Kitap</h1><p>12 okunma 5 beğeni 3 inceleme</p></main>');
  assert.deepStrictEqual(out.counts, { okunma: 12, beğeni: 5, inceleme: 3 });
});

test('sayı çözümleme Türkçe ve İngilizce biçimleri tanır', async () => {
  const page = await browser.newPage();
  await page.addScriptTag({ path: path.join(__dirname, '..', 'extractor.js') });
  const r = await page.evaluate(() => ['1.250,00', '127.50', '150,00', '12.345', '6,53'].map(globalThis.__kitapTakipParseNum));
  await page.close();
  assert.deepStrictEqual(r, [1250, 127.5, 150, 12345, 6.53]);
});

// --- Sitenin sayfaya gömdüğü ürün kaydı (gerçek stok adedi) ---

const nuxt = (smiktar) => `<script>window.__NUXT__ = { data: [{ item: { barkod: "${ISBN}", stokcins: "Kitap", smiktar: ${smiktar}, product_json: { barkod: "${ISBN}", smiktar: ${smiktar}, sepet_miktar: 0 } } }], state: { cart: { items: [] } } };</script>`;

test('gömülü ürün kaydındaki stok alanı (smiktar) gerçek adet olarak okunur', async () => {
  const out = await run(`${nuxt(3)}<main><h1>Kitap</h1><p>Liste Fiyatı : 150,00 ₺</p><button>Sepete Ekle</button></main>`);
  assert.strictEqual(out.status, 'in_stock');
  assert.strictEqual(out.stockQty, 3);
  assert.strictEqual(out.stockQtySource, 'sayfa verisi (smiktar)');
  assert.ok(!out.stockQtyPlaceholder);
});

test('gömülü stok 0 ve satın alma düğmesi yoksa "tükendi"', async () => {
  const out = await run(`${nuxt(0)}<main><h1>Kitap</h1><p>Liste Fiyatı : 150,00 ₺</p></main>`);
  assert.strictEqual(out.status, 'out_of_stock');
  assert.strictEqual(out.stockQty, 0);
});

test('gömülü stok eksi ise mağaza stok tutmuyor: "siparişle temin", adet 0', async () => {
  const out = await run(`${nuxt(-1)}<main><h1>Kitap</h1><p>Liste Fiyatı : 6,53 €</p><button>Sepete Ekle</button></main>`);
  assert.strictEqual(out.status, 'on_order');
  assert.strictEqual(out.stockQty, 0);
});

test('analitik nesneleri (dataLayer) stok kaynağı olarak taranmaz', async () => {
  const out = await run(`<script>window.dataLayer = [{ product: { code: "${ISBN}", stockQuantity: 1 } }];</script><main><h1>Kitap</h1><p>150,00 TL</p><button>Sepete Ekle</button></main>`);
  assert.notStrictEqual(out.stockQtySource, 'sayfa verisi (stockQuantity)');
});

test('analitik verisindeki sepet adedi (quantity: 1) stok sanılmaz', async () => {
  const out = await run(`<script>window.dataLayer = [{ ecommerce: { items: [{ item_id: "${ISBN}", quantity: 1 }] } }];</script><main><h1>Kitap</h1><p>150,00 TL</p><button>Sepete Ekle</button></main>`);
  assert.strictEqual(out.stockQty, undefined);
  assert.strictEqual(out.status, 'in_stock');
});

test('PRODUCT_DATA: 999999 yer tutucudur, küçük sayı gerçek stoktur', async () => {
  const page = (q) => `<script>var PRODUCT_DATA = [{ id: "1", barcode: "${ISBN}", quantity: ${q}, available: true }];</script><main><h1>Kitap</h1><p>97,50 TL</p><button>Sepete Ekle</button></main>`;
  const fake = await run(page(999999));
  assert.strictEqual(fake.stockQtyPlaceholder, true);
  assert.strictEqual(fake.status, 'in_stock');
  const real = await run(page(12));
  assert.strictEqual(real.stockQty, 12);
  assert.ok(!real.stockQtyPlaceholder);
});

test('ürün kodu adresten alınır ve gömülü kayıtla eşleştirilir', async () => {
  const out = await runAt('https://ornek.test/kitap-adi-pm-HBC0000A6M7ZP',
    '<script>window.__INITIAL_STATE__ = { product: { sku: "HBC0000A6M7ZP", stockQuantity: 4 }, other: { sku: "HBX1", stockQuantity: 77 } };</script><main><h1>Kitap</h1><p>120,00 TL</p><button>Sepete Ekle</button></main>', extractFn);
  assert.strictEqual(out.stockQty, 4);
});

test('döngülü ve çok büyük sayfa verisi taramayı kilitlemez', async () => {
  const t0 = Date.now();
  const out = await run(`<script>const a = { list: [] }; a.self = a; for (let i = 0; i < 300000; i++) a.list.push({ i, child: { j: i } }); window.__INITIAL_STATE__ = a;</script><main><h1>Kitap</h1><p>150,00 TL</p><button>Sepete Ekle</button></main>`);
  assert.strictEqual(out.status, 'in_stock');
  assert.ok(Date.now() - t0 < 15000);
});

test('adet seçme kutusundaki en yüksek değer sipariş sınırı olarak okunur', async () => {
  const out = await run(`<main><h1>Kitap</h1><p>150,00 TL</p><select id="quantity">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}">${n}</option>`).join('')}</select><button>Sepete Ekle</button></main>`);
  assert.strictEqual(out.maxOrderQty, 7);
});

// --- Sitenin kendi yazdığı satış sayacı ve ilgi cümleleri ---

test('"Bu üründen N adet satın alınmıştır" satış sayacı olarak okunur', async () => {
  const out = await run('<main><h1>Kitap</h1><p>127,50 TL</p><button>Sepete Ekle</button><p>Bu üründen 1.027 adet satın alınmıştır.</p></main>');
  assert.strictEqual(out.soldCount, 1027);
  assert.deepStrictEqual(out.signals, ['Bu üründen 1.027 adet satın alınmıştır']);
});

test('satış ve ilgi cümleleri olduğu gibi saklanır', async () => {
  const out = await run('<main><h1>Kitap</h1><p>150,00 TL</p><button>Sepete Ekle</button><p>Geçen ay 50+ adet satın alındı</p><p>Son 24 saatte 49 kişi görüntüledi</p><p>120 kişinin sepetinde</p></main>');
  assert.deepStrictEqual(out.signals, ['Geçen ay 50+ adet satın alındı', 'Son 24 saatte 49 kişi görüntüledi', '120 kişinin sepetinde']);
});

// --- Arama sayfasından ürün sayfasını bulma ---

const findFn = (i) => globalThis.__kitapTakipFindProduct(i, "Özgür'ün Salıncağı");

test('arama sayfasında yapısal veriden ürün adresi bulunur', async () => {
  const ld = { '@type': 'SearchResultsPage', url: `https://ornek.test/arama?q=${ISBN}`, mainEntity: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, item: { '@type': 'Book', isbn: ISBN, url: 'https://ornek.test/ozgurun-salincagi', offers: { url: 'https://ornek.test/ozgurun-salincagi' } } }] } };
  const link = await runAt(`https://ornek.test/arama?q=${ISBN}`, `<script type="application/ld+json">${JSON.stringify(ld)}</script><a href="/arama?q=${ISBN}&sayfa=2">2</a>`, findFn);
  assert.strictEqual(link, 'https://ornek.test/ozgurun-salincagi');
});

test('arama sayfasında adı eşleşen bağlantı bulunur; yazım farkları ve başka kitaplar yanıltmaz', async () => {
  const link = await runAt(`https://ornek.test/index.php?route=product/search&filter_name=${ISBN}`,
    `<a href="/index.php?route=product/search&filter_name=${ISBN}&sort=price">Özgür'ün Salıncağı için sırala</a><a href="/kitap/baska-kitap/1.html">Başka Kitap</a><div class="name"><a href="/kitap/ozgurun-salincagi/712345.html"><span>ÖZGÜR\`ÜN SALINCAĞI</span></a></div>`, findFn);
  assert.strictEqual(link, 'https://ornek.test/kitap/ozgurun-salincagi/712345.html');
});

test('eşleşen ürün yoksa adres dönmez', async () => {
  const link = await runAt(`https://ornek.test/arama?q=${ISBN}`, '<p>Aradığınız kriterlere uygun ürün bulunamadı.</p><a href="/kitap/baska-kitap/1.html">Başka Kitap</a>', findFn);
  assert.strictEqual(link, null);
});
