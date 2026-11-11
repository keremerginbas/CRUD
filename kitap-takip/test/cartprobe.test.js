// Sepet sınırı ölçümünün sayfa tarafı: düğmeleri bulma, adedi yükseltme, satırı silme.
// Sayfalar gerçek sitelerden alınmadı; yaygın sepet düzenlerine göre kuruldu.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { chromium } = require('playwright');

const TITLE = "Özgür'ün Salıncağı";
const IDS = ['9786259756189', '6259756186'];
let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function open(html, title = 'Sepetim') {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><title>${title}</title></head><body>${html}</body></html>`);
  await page.addScriptTag({ path: path.join(__dirname, '..', 'cartprobe.js') });
  return page;
}
const cart = (page, fn, ...args) => page.evaluate(([f, a]) => globalThis.__kitapTakipCart[f](...a), [fn, args]);

// İki satırlı sepet: bizim kitap ve kullanıcının başka bir ürünü. Artı/eksi düğmeli düzen.
const stepperCart = (stock) => `
  <script>
    const state = { ours: 1, other: 2 };
    function render() { for (const k of Object.keys(state)) { const li = document.getElementById(k); if (state[k] <= 0) { li.remove(); continue; } li.querySelector('.qty').textContent = state[k]; } document.querySelector('#ours .plus') && (document.querySelector('#ours .plus').disabled = state.ours >= ${stock}); }
    function inc(k) { const max = k === 'ours' ? ${stock} : 99; if (state[k] < max) state[k]++; else document.getElementById('toast').textContent = 'Bu üründen en fazla ' + max + ' adet alabilirsiniz'; render(); }
    function dec(k) { state[k]--; render(); }
    function ask(k) { window.pending = k; document.getElementById('dlg').hidden = false; }
    function yes() { state[window.pending] = 0; document.getElementById('dlg').hidden = true; render(); }
  </script>
  <h1>Sepetim</h1>
  <ul>
    <li id="other"><a href="#">Başka Bir Kitap</a><button class="minus" aria-label="Adedi azalt" onclick="dec('other')">−</button><span class="qty">2</span><button class="plus" aria-label="Adedi artır" onclick="inc('other')">+</button><button aria-label="Ürünü sil" onclick="ask('other')">x</button></li>
    <li id="ours"><a href="#">Bilim ve Sanat Yayınları Özgür\`ün Salıncağı - Başak Çalışkan Kabiloğlu</a><button class="minus" aria-label="Adedi azalt" onclick="dec('ours')">−</button><span class="qty">1</span><button class="plus" aria-label="Adedi artır" onclick="inc('ours')">+</button><button aria-label="Ürünü sil" onclick="ask('ours')">x</button></li>
  </ul>
  <div id="toast" role="alert"></div>
  <div id="dlg" role="dialog" hidden><p>Ürünü sepetten silmek istiyor musunuz?</p><button onclick="document.getElementById('dlg').hidden = true">Vazgeç</button><button onclick="yes()">Sil</button></div>
  <button onclick="window.checkedOut = true">Alışverişi tamamla</button>`;

// --- Ürün sayfasında sepete ekleme ---

test('ürünün kendi "Sepete ekle" düğmesine basılır; benzer ürünlerinkine ve "Hemen al"a basılmaz', async () => {
  const page = await open(`<script>window.clicks = [];</script>
    <section><div>Benzer Kitap <button onclick="clicks.push('carousel')">Sepete ekle</button></div></section>
    <main><div><h1>${TITLE}</h1><p>150,00 TL</p></div><div><button onclick="clicks.push('buy-now')">Hemen al</button><button onclick="clicks.push('main')">Sepete ekle</button></div></main>`, 'Kitap');
  const res = await cart(page, 'addToCart');
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(await page.evaluate(() => window.clicks), ['main']);
  await page.close();
});

test('yalnızca "Şimdi Al" varsa hiçbir düğmeye basılmaz', async () => {
  const page = await open(`<script>window.clicks = [];</script><main><h1>${TITLE}</h1><input type="submit" id="buy-now-button" value="Şimdi Al" onclick="clicks.push('buy-now')"></main>`, 'Kitap');
  const res = await cart(page, 'addToCart');
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(await page.evaluate(() => window.clicks), []);
  await page.close();
});

// --- Sepette satırı bulma ve okuma ---

test('sepette kitabın satırı adından bulunur; adet ve denetim türü okunur', async () => {
  const page = await open(stepperCart(4));
  const s = await cart(page, 'inspect', TITLE, IDS);
  assert.strictEqual(s.page, 'cart');
  assert.strictEqual(s.found, true);
  assert.strictEqual(s.qty, 1);
  assert.strictEqual(s.control, 'stepper');
  await page.close();
});

test('kitap sepette yoksa bulunamadı döner ve başka satıra dokunulmaz', async () => {
  const page = await open(stepperCart(4));
  await page.evaluate(() => document.getElementById('ours').remove());
  assert.strictEqual((await cart(page, 'inspect', TITLE, IDS)).found, false);
  assert.strictEqual((await cart(page, 'raise', TITLE, IDS, 999)).acted, 'none');
  assert.strictEqual((await cart(page, 'remove', TITLE, IDS)).acted, 'none');
  assert.strictEqual(await page.evaluate(() => state.other), 2);
  await page.close();
});

test('artı düğmesiyle yükseltme yalnızca kitabın satırını değiştirir ve sınırda durur', async () => {
  const page = await open(stepperCart(4));
  for (let i = 0; i < 8; i++) await cart(page, 'raise', TITLE, IDS, 999);
  const s = await cart(page, 'inspect', TITLE, IDS);
  assert.strictEqual(s.qty, 4);
  assert.strictEqual(s.plusDisabled, true);
  assert.strictEqual(await page.evaluate(() => state.other), 2);
  assert.strictEqual(await page.evaluate(() => window.checkedOut), undefined);
  await page.close();
});

test('adet kutusuna büyük sayı yazılınca sitenin düzelttiği değer ve uyarısı okunur', async () => {
  const page = await open(`<h1>Sepetim</h1>
    <div class="row"><span>${TITLE}</span><input type="text" inputmode="numeric" name="quantityBox" value="1"><a href="#" id="upd">Güncelle</a><span class="msg" role="alert"></span></div>
    <script>
      const input = document.querySelector('input'); let typed = '1';
      input.addEventListener('input', () => { typed = input.value; });
      document.getElementById('upd').addEventListener('click', (e) => { e.preventDefault(); if (Number(typed) > 7) { input.value = '7'; document.querySelector('.msg').textContent = 'Bu satıcının bu üründen yalnızca 7 adedi mevcut.'; } });
    </script>`);
  assert.strictEqual((await cart(page, 'raise', TITLE, IDS, 999)).acted, 'input');
  const s = await cart(page, 'inspect', TITLE, IDS);
  assert.strictEqual(s.qty, 7);
  assert.deepStrictEqual(s.messages, ['Bu satıcının bu üründen yalnızca 7 adedi mevcut.']);
  await page.close();
});

test('açılır listede "10+" seçeneği varsa önce o seçilir', async () => {
  const page = await open(`<h1>Sepetim</h1><div class="sc-list-item" data-asin="6259756186" data-quantity="1"><span>Kitap</span>
    <select name="quantity">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}">${n}</option>`).join('')}<option value="10">10+</option></select></div>
    <script>document.querySelector('select').addEventListener('change', (e) => { window.chosen = e.target.value; });</script>`);
  const before = await cart(page, 'inspect', TITLE, IDS);
  assert.strictEqual(before.control, 'select');
  assert.strictEqual(before.selectOpen, true);
  assert.strictEqual((await cart(page, 'raise', TITLE, IDS, 999)).acted, 'select-open');
  assert.strictEqual(await page.evaluate(() => window.chosen), '10');
  await page.close();
});

test('ürün kodu olan satırlardan etkin sepetteki seçilir, "sonra al" listesindeki değil', async () => {
  const page = await open(`<h1>Sepetim</h1>
    <div id="sc-saved-cart"><div class="sc-list-item" data-asin="6259756186" data-quantity="3"><select name="quantity"><option>1</option><option>2</option><option selected>3</option></select></div></div>
    <div id="sc-active-cart"><div class="sc-list-item" data-asin="6259756186" data-quantity="1"><select name="quantity"><option selected>1</option><option>2</option><option>3</option></select></div></div>`);
  assert.strictEqual((await cart(page, 'inspect', TITLE, IDS)).qty, 1);
  await page.close();
});

// --- Sepetten çıkarma ---

test('silme düğmesi ve onay penceresiyle kitap sepetten çıkar, diğer ürün kalır', async () => {
  const page = await open(stepperCart(4));
  assert.strictEqual((await cart(page, 'remove', TITLE, IDS)).acted, 'delete');
  assert.strictEqual((await cart(page, 'confirm')).acted, true);
  assert.strictEqual((await cart(page, 'inspect', TITLE, IDS)).found, false);
  assert.strictEqual(await page.evaluate(() => state.other), 2);
  await page.close();
});

test('silme düğmesi yoksa eksi düğmesiyle azaltılır', async () => {
  const page = await open(stepperCart(4));
  await page.evaluate(() => document.querySelector('#ours [aria-label="Ürünü sil"]').remove());
  assert.strictEqual((await cart(page, 'remove', TITLE, IDS)).acted, 'minus');
  assert.strictEqual((await cart(page, 'inspect', TITLE, IDS)).found, false);
  await page.close();
});

// --- Sepet sayfası açılmadıysa ---

test('giriş ya da doğrulama sayfası sepet sanılmaz', async () => {
  const login = await open('<h1>Giriş yap</h1><form><input type="email"><input type="password"><button>Giriş yap</button></form>', 'Giriş');
  assert.strictEqual((await cart(login, 'inspect', TITLE, IDS)).page, 'login');
  await login.close();
  const challenge = await open('<p>Güvenlik doğrulaması yapılıyor</p>', 'Bir dakika lütfen...');
  assert.strictEqual((await cart(challenge, 'inspect', TITLE, IDS)).page, 'blocked');
  await challenge.close();
});

test('silme düğmesi işe yaramıyorsa istenince eksi düğmesi kullanılır', async () => {
  const page = await open(stepperCart(4));
  assert.strictEqual((await cart(page, 'remove', TITLE, IDS, 'minus')).acted, 'minus');
  assert.strictEqual(await page.evaluate(() => document.getElementById('dlg').hidden), true);
  await page.close();
});

test('sepetteki satır sayısı bildirilir; böylece yeni eklenen satır doğrulanabilir', async () => {
  const page = await open(stepperCart(4));
  assert.strictEqual((await cart(page, 'inspect', TITLE, IDS)).groups, 2);
  await page.evaluate(() => document.getElementById('ours').remove());
  assert.strictEqual((await cart(page, 'inspect', TITLE, IDS)).groups, 1);
  await page.close();
});
