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

// Gerçek kullanımda görülen hata: adet kutusuna 999 yazıldı ve kitap sepetten çıkarılamadı.
// Bu yüzden adet kutusuna hiçbir koşulda sayı yazılmaz; yalnızca artı düğmesiyle birer birer çıkılır.

test('hem adet kutusu hem artı düğmesi varsa artı düğmesi kullanılır, kutuya yazılmaz', async () => {
  const page = await open(`<h1>Sepetim</h1><ul><li><a href="#">${TITLE}</a>
    <button aria-label="Adedi azalt" onclick="q.value = Number(q.value) - 1">−</button><input id="q" inputmode="numeric" value="1"><button aria-label="Adedi artır" onclick="q.value = Number(q.value) + 1">+</button>
    <button aria-label="Ürünü sil">x</button></li></ul><script>const q = document.getElementById('q');</script>`);
  const before = await cart(page, 'inspect', TITLE, IDS);
  assert.strictEqual(before.control, 'stepper');
  assert.strictEqual(before.supported, true);
  assert.strictEqual((await cart(page, 'raise', TITLE, IDS)).acted, 'click');
  assert.strictEqual(await page.evaluate(() => q.value), '2');
  await page.close();
});

test('yalnızca adet kutusu olan sepette yükseltme yapılmaz', async () => {
  const page = await open(`<h1>Sepetim</h1><div class="row"><span>${TITLE}</span><input type="text" inputmode="numeric" name="quantityBox" value="1"><a href="#">Güncelle</a><button aria-label="Ürünü sil">x</button></div>`);
  const s = await cart(page, 'inspect', TITLE, IDS);
  assert.strictEqual(s.control, 'input');
  assert.strictEqual(s.supported, false);
  assert.strictEqual((await cart(page, 'raise', TITLE, IDS)).acted, 'none');
  assert.strictEqual(await page.evaluate(() => document.querySelector('input').value), '1');
  await page.close();
});

test('açılır listede "10+" seçeneği seçilmez; en yüksek sabit seçenek seçilir', async () => {
  const page = await open(`<h1>Sepetim</h1><div class="sc-list-item" data-asin="6259756186" data-quantity="1"><span>Kitap</span>
    <select name="quantity">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}">${n}</option>`).join('')}<option value="10">10+</option></select></div>
    <script>document.querySelector('select').addEventListener('change', (e) => { window.chosen = e.target.value; });</script>`);
  assert.strictEqual((await cart(page, 'raise', TITLE, IDS)).acted, 'select-max');
  assert.strictEqual(await page.evaluate(() => window.chosen), '9');
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

// --- Hepsiburada sepetinin gerçek yapısı (kullanıcının paylaştığı sayfa yapısından) ---
// Satır: li[data-sku] > … > div.product_quantities > [sol düğme] [input type=number name=quantity] [button aria-label="Ürünü Arttır"].
// Adet 1 iken sol düğme "Sepetten Çıkar"dır. Adet 1'den büyükken sol düğmenin adı bilinmiyor;
// bu yüzden örnekte adsız bırakıldı: ölçüm adına değil, konumuna güvenmeli.
const ICON = '<svg width="12" height="12" fill="none"><path d="M0 0h12v12H0z"></path></svg>';
const hbLine = (id, sku, name) => `<li class="basket_items_3C53o" id="${id}" data-listingid="l-${id}" data-sku="${sku}"><div class="product_box_3WUDZ"><div class="product_area_VUdcT">
  <div class="product_img_3OYFY"><div class="edit_mode_radio_XiXVr"><label><input id="selectedCheckBox-${id}" name="selection-0-0" type="checkbox" checked></label></div>
    <div class="product_img_area_3q2qL"><figure><a href="#"><img alt="${name} 32 Sayfa Türkçe Çocuk Kitabı"></a></figure></div></div>
  <div class="product_details_1sAZ1"><div class="product_properties_dAsFN"><a href="#">${name}</a></div>
    <div class="product_price_box_1vvtm"><div class="product_counter_1EztL"><div class="product_quantities_1LpFc"></div></div><div class="pricebox_right_wrapper_TzkAv">158,81 TL</div></div></div>
</div></div></li>`;
const hbCart = ({ stock = 4, dialogYes = 'Sepetten çıkar', extra = '' } = {}) => `
  <div><h1>Sepetim</h1><button type="button" onclick="window.deletedAll = true">Ürünleri sil</button></div>
  <ul class="item_list_1NnvG">${hbLine('other', 'HBCV00000OTHER1', 'Başka Bir Kitap')}${hbLine('ours', 'HBCV0000A6M7ZQ', "Bilim ve Sanat Yayınları Özgür'ün Salıncağı Başak Çalışkan Kabiloğlu")}</ul>
  <div class="cta_3vBFp"><button id="continue_step_btn" onclick="window.checkedOut = true">Alışverişi tamamla</button></div>
  <div id="toast" role="alert"></div>
  <div id="dlg" class="co-modal" role="dialog" hidden><p>Ürünü sepetinizden çıkarmak istediğinize emin misiniz?</p><button id="no">Vazgeç</button><button id="fav">Sil ve favorilere ekle</button><button id="yes">${dialogYes}</button></div>
  ${extra}
  <script>
    const state = { ours: 1, other: 2 }; const max = { ours: ${stock}, other: 99 }; window.typed = [];
    function render() {
      for (const k of Object.keys(state)) {
        const li = document.getElementById(k);
        if (!li) continue;
        if (state[k] <= 0) { li.remove(); continue; }
        const left = state[k] === 1 ? '<button type="button" aria-label="Sepetten Çıkar" class="co-clickable delete_button_1lHhf">${ICON}</button>' : '<button type="button" class="co-clickable">${ICON}</button>';
        const box = li.querySelector('.product_quantities_1LpFc');
        box.innerHTML = left + '<input type="number" name="quantity" value="' + state[k] + '">' + '<button type="button" class="co-clickable" aria-label="Ürünü Arttır">${ICON}</button>';
        const [l, input, r] = box.children;
        input.oninput = () => window.typed.push(input.value);
        r.onclick = () => { if (state[k] < max[k]) state[k]++; else document.getElementById('toast').textContent = 'Bu üründen en fazla ' + max[k] + ' adet alabilirsiniz'; render(); };
        l.onclick = () => { if (state[k] > 1) { state[k]--; render(); } else { window.pending = k; document.getElementById('dlg').hidden = false; } };
      }
    }
    document.getElementById('no').onclick = () => { document.getElementById('dlg').hidden = true; };
    document.getElementById('fav').onclick = () => { window.favorited = true; };
    document.getElementById('yes').onclick = () => { state[window.pending] = 0; document.getElementById('dlg').hidden = true; render(); };
    render();
  </script>`;
const flags = (page) => page.evaluate(() => ({ other: state.other, ours: state.ours, typed: window.typed, deletedAll: window.deletedAll, checkedOut: window.checkedOut, favorited: window.favorited, subscribed: window.subscribed, cookies: window.cookies }));
const UNTOUCHED = { deletedAll: undefined, checkedOut: undefined, favorited: undefined, subscribed: undefined, cookies: undefined };

test('Hepsiburada satırı: adet, artı düğmesi ve çıkarma yolu tanınır', async () => {
  const page = await open(hbCart());
  const s = await cart(page, 'inspect', TITLE, ['9786259756189', 'HBC0000A6M7ZP']);
  assert.deepStrictEqual({ found: s.found, qty: s.qty, control: s.control, supported: s.supported, canRemove: s.canRemove, groups: s.groups }, { found: true, qty: 1, control: 'stepper', supported: true, canRemove: true, groups: 2 });
  await page.close();
});

test('Hepsiburada satırı: artırma ve (adsız sol düğmeyle) azaltma yalnızca kitabın satırında çalışır', async () => {
  const page = await open(hbCart());
  assert.strictEqual((await cart(page, 'raise', TITLE, IDS)).acted, 'click');
  assert.strictEqual((await cart(page, 'inspect', TITLE, IDS)).qty, 2);
  assert.strictEqual((await cart(page, 'lower', TITLE, IDS)).acted, 'click');
  assert.strictEqual((await cart(page, 'inspect', TITLE, IDS)).qty, 1);
  assert.deepStrictEqual(await flags(page), { other: 2, ours: 1, typed: [], ...UNTOUCHED });
  await page.close();
});

test('adet 1 iken azaltma yapılmaz (sol düğme o anda "Sepetten Çıkar"dır)', async () => {
  const page = await open(hbCart());
  assert.strictEqual((await cart(page, 'lower', TITLE, IDS)).acted, 'none');
  assert.strictEqual(await page.evaluate(() => document.getElementById('dlg').hidden), true);
  await page.close();
});

test('Hepsiburada satırı: sınıra kadar çıkılır, sonra azaltılıp çıkarılır; başka hiçbir şeye dokunulmaz', async () => {
  const page = await open(hbCart({ stock: 4 }));
  for (let i = 0; i < 10; i++) await cart(page, 'raise', TITLE, IDS);
  assert.strictEqual((await cart(page, 'inspect', TITLE, IDS)).qty, 4);
  for (let i = 0; i < 10; i++) { await cart(page, 'remove', TITLE, IDS); await cart(page, 'confirm'); }
  assert.strictEqual((await cart(page, 'inspect', TITLE, IDS)).found, false);
  assert.deepStrictEqual(await flags(page), { other: 2, ours: 0, typed: [], ...UNTOUCHED });
  await page.close();
});

for (const label of ['Sil', 'Sepetten çıkar', 'Evet, sil']) {
  test(`çıkarma onayı "${label}" düğmesiyle verilir; "favorilere ekle" seçeneğine basılmaz`, async () => {
    const page = await open(hbCart({ dialogYes: label }));
    assert.strictEqual((await cart(page, 'remove', TITLE, IDS)).acted, 'delete');
    assert.strictEqual((await cart(page, 'confirm')).acted, true);
    assert.deepStrictEqual(await flags(page), { other: 2, ours: 0, typed: [], ...UNTOUCHED });
    await page.close();
  });
}

test('çıkarmayla ilgisi olmayan pencerelerde (üyelik teklifi, çerez izni) hiçbir düğmeye basılmaz', async () => {
  const page = await open(hbCart({ extra: `
    <div class="oneclick_tp_modal" role="dialog"><p>Premium'a geç, kargo bedava ve %3 Hepsipara avantajları ile tasarruf et.</p><button onclick="window.subscribed = true">Onayla</button><button onclick="window.subscribed = true">Tamam</button></div>
    <div class="cookie-popup"><p>İzin Tercihlerinizi Özelleştirelim. Çerez tercihlerinizi çerez ayarları kısmından yönetebilir, kaldırabilirsiniz.</p><button onclick="window.cookies = true">Kabul Et</button><button onclick="window.cookies = true">Tamam</button></div>` }));
  assert.strictEqual((await cart(page, 'confirm')).acted, false);
  assert.deepStrictEqual(await flags(page), { other: 2, ours: 1, typed: [], ...UNTOUCHED });
  await page.close();
});
