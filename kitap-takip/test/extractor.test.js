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

const carousel = '<section><h3>Benzer kitaplar</h3><div><span>Başka Kitap</span><span>90,00 ₺</span><button>Sepete Ekle</button><em>Tükendi</em></div></section>';

test('yapısal veri (JSON-LD) stokta ve fiyatı verir; her üründe aynı olan gömülü adet varsayılan sayılır', async () => {
  const others = Array.from({ length: 5 }, (_, i) => `{"stockQuantity":100,"isbn":"97800000000${i}"}`).join(',');
  const out = await run(`
    <script type="application/ld+json">{"@graph":[{"@type":"Book","name":"Özgür'ün Salıncağı","offers":{"@type":"Offer","price":"127.50","priceCurrency":"TRY","availability":"https://schema.org/InStock"}}]}</script>
    <script>self.__data = [{"price":127.5,"stockQuantity":100,"isbn":"${ISBN}"},${others}]</script>
    <main><h1>Özgür'ün Salıncağı</h1><p>127,50 TL</p><input type="number" min="1" max="100"><button>Sepete Ekle</button><p>Yaklaşık 1-3 iş gününde temin</p></main>`);
  assert.strictEqual(out.status, 'in_stock');
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

test('düğme varsa stokta; temin süresi ve euro fiyat okunur', async () => {
  const out = await run(`<main><article><h1>Özgür'ün Salıncağı</h1><p>Ürün Temin Süresi : 7 Gün</p><p>Liste Fiyatı : 6,53 €</p><div class="btn">Sepete Ekle</div></article></main>${carousel}${'<p>dolgu metni</p>'.repeat(80)}`);
  assert.strictEqual(out.status, 'in_stock');
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
