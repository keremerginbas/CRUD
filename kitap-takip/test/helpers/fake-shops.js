// Test için sahte pazaryerleri. Gerçek sitelerin kopyası değildir; iki yaygın sepet düzenini canlandırır:
// - "hb": ürün sayfasında "Sepete ekle" düğmesi, ayrı adreste artı/eksi düğmeli ve onaylı silmeli sepet.
// - "amz": form ile sepete ekleme, açılır listeli ("10+" seçenekli) ve sayfayı yenileyen sepet.
const TITLE = "Özgür'ün Salıncağı";
const HOSTS = ['www.hepsiburada.com', 'checkout.hepsiburada.com', 'www.amazon.com.tr'];

function createShops() {
  const s = {};
  const reset = () => Object.assign(s, { hbOurs: 0, hbOther: 2, hbStock: 4, hbRemoveWorks: true, hbLowerWorks: true, hbAddWorks: true, hbViewed: false, hbLayout: 'stepper', hbTyped: [], hbMaxSeen: 0, deletedAll: false, subscribed: false, undone: false, amzQty: 0, amzStock: 7, amzMessage: '', boughtNow: false, log: [] });
  reset();

  const page = (res, title, body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`); };
  const json = (res, obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const redirect = (res, to) => { res.writeHead(303, { Location: to }); res.end(); };
  const hbState = (message = '') => ({ ours: s.hbOurs, other: s.hbOther, stock: s.hbStock, layout: s.hbLayout, message });

  const hbProduct = () => `
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: TITLE, gtin13: '9786259756189', offers: { '@type': 'Offer', price: '120.00', priceCurrency: 'TRY', availability: 'https://schema.org/InStock', seller: { '@type': 'Organization', name: 'A Kitap' } } })}</script>
    <main><div><h1>${TITLE}</h1><p>Satıcı: <a href="#">A Kitap</a></p><p>120,00 TL</p></div>
    <div><button onclick="fetch('/api/buy-now', { method: 'POST' })">Hemen al</button><button onclick="fetch('/api/add', { method: 'POST' })">Sepete ekle</button></div></main>`;

  // Sepet sayfası, gerçek Hepsiburada sepetinin yapısını izler: li[data-sku] satırları; adet kutusunun
  // solunda (adet 1 iken "Sepetten Çıkar", daha fazlayken adsız azaltma) ve sağında ("Ürünü Arttır")
  // simge düğmeler; çıkarma için onay penceresi; sayfada ayrıca toplu silme, alışverişi tamamlama ve
  // üyelik teklifi düğmeleri.
  const hbCart = () => `
    <div><h1>Sepetim</h1><button type="button" onclick="fetch('/api/delete-all', { method: 'POST' })">Ürünleri sil</button></div>
    <ul class="item_list_1NnvG" id="list"></ul><div id="toast" role="alert"></div>
    ${s.hbViewed ? `<aside><h2>Son gezdikleriniz</h2><div><a href="#">${TITLE}</a> <button>Sepete ekle</button></div></aside>` : ''}
    <div id="toasts" class="hb-toast-notifier-container hb-toast-notifier-position-top-right"></div>
    <div class="oneclick_tp_1CWe3" role="dialog"><p>Premium'a geç, kargo bedava ve %3 Hepsipara avantajları ile tasarruf et.</p><button onclick="fetch('/api/subscribe', { method: 'POST' })">Onayla</button></div>
    <div class="cta_3vBFp"><button id="continue_step_btn" onclick="fetch('/api/buy-now', { method: 'POST' })">Alışverişi tamamla</button></div>
    <script>
      const ICON = '<svg width="12" height="12" fill="none"><path d="M0 0h12v12H0z"></path></svg>';
      const api = async (path, body) => (await fetch(path, { method: 'POST', body: JSON.stringify(body || {}) })).json();
      function render(st) {
        const list = document.getElementById('list');
        list.innerHTML = '';
        for (const [key, sku, name, qty] of [['other', 'HBCV00000OTHER1', 'Başka Bir Kitap', st.other], ['ours', 'HBCV0000A6M7ZQ', 'Bilim ve Sanat Yayınları ${TITLE.replace(/'/g, "\\'")} Başak Çalışkan Kabiloğlu', st.ours]]) {
          if (qty <= 0) continue;
          const li = document.createElement('li');
          li.className = 'basket_items_3C53o'; li.dataset.sku = sku; li.dataset.listingid = 'l-' + key;
          const stepper = st.layout === 'stepper';
          const left = qty === 1 || !stepper ? '<button type="button" aria-label="Sepetten Çıkar" class="co-clickable delete_button_1lHhf">' + ICON + '</button>' : '<button type="button" class="co-clickable">' + ICON + '</button>';
          li.innerHTML = '<div class="product_box_3WUDZ"><div class="product_area_VUdcT"><div class="product_details_1sAZ1"><div class="product_properties_dAsFN"><a href="#"></a></div>'
            + '<div class="product_price_box_1vvtm"><div class="product_counter_1EztL"><div class="product_quantities_1LpFc">' + left + '<input type="number" name="quantity">'
            + (stepper ? '<button type="button" class="co-clickable" aria-label="Ürünü Arttır">' + ICON + '</button>' : '') + '</div></div><div class="pricebox_right_wrapper_TzkAv">158,81 TL</div></div></div></div></div>';
          li.querySelector('a').textContent = name;
          const box = li.querySelector('.product_quantities_1LpFc');
          const input = box.querySelector('input');
          input.value = qty;
          input.oninput = () => api('/api/typed', { key, value: input.value });
          // Gerçek sitedeki gibi: çıkarma onay sormaz; ürün hemen çıkar ve "Geri al" bildirimi görünür.
          box.firstElementChild.onclick = async () => {
            if (qty > 1 && stepper) return render(await api('/api/qty', { key, delta: -1 }));
            const after = await api('/api/remove', { key });
            render(after);
            if (after[key] === 0) document.getElementById('toasts').innerHTML = '<div class="hb-toast-notifier-box hb-toast-notifier-type-success"><div class="hb-toast-text">Ürün sepetinizden kaldırıldı</div><div class="hb-toast-message"><a id="hb-toast-link-undo" class="hb-toast-link" href="#">Geri al</a></div></div>';
            const undo = document.getElementById('hb-toast-link-undo');
            if (undo) undo.onclick = (e) => { e.preventDefault(); fetch('/api/undo', { method: 'POST' }); };
          };
          if (stepper) box.lastElementChild.onclick = async () => render(await api('/api/qty', { key, delta: 1 }));
          list.append(li);
        }
        document.getElementById('toast').textContent = st.message || '';
        // Sepet boşken, gerçek sitedeki gibi başka ürünler listelenir (kendi düğmeleriyle).
        if (!list.children.length) list.insertAdjacentHTML('afterend', '<section id="recs"><h2>Şu an en çok bakılan ürünler</h2><div>Oyuncu Klavyesi <button type="button" aria-label="Adedi artır">+</button><input inputmode="numeric" value="1"></div></section>');
        else if (document.getElementById('recs')) document.getElementById('recs').remove();
      }
      api('/api/cart').then(render);
    </script>`;

  const amzProduct = () => `
    <div id="centerCol"><h1 id="title"><span id="productTitle">${TITLE}</span></h1><div id="price">150,00 TL</div></div>
    <div id="rightCol"><div id="availability"><span>Stokta var.</span></div>
      <form method="post" action="/cart/add">
        <select id="quantity" name="quantity">${Array.from({ length: Math.min(s.amzStock, 30) }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select>
        <input type="submit" id="add-to-cart-button" value="Sepete Ekle"><input type="submit" id="buy-now-button" formaction="/buy-now" value="Şimdi Al">
      </form>
      <div id="merchantInfoFeature_feature_div"><span>Satıcı</span> <a id="sellerProfileTriggerId" href="#">Kitapsan</a></div></div>`;

  const amzCart = () => `
    <h1>Alışveriş Sepeti</h1>${s.amzMessage ? `<div class="a-alert" role="alert">${s.amzMessage}</div>` : ''}
    <div id="sc-active-cart">${s.amzQty > 0 ? `<div class="sc-list-item" data-asin="6259756186" data-quantity="${s.amzQty}"><span class="title">${TITLE}</span>
      <form method="post" action="/cart/update">
        <select name="quantity" onchange="if (this.value === '10') { this.hidden = true; this.form.quantityBox.hidden = false; this.form.querySelector('[data-action=update]').hidden = false; } else { this.form.submit(); }">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}"${n === Math.min(s.amzQty, 9) ? ' selected' : ''}>${n}</option>`).join('')}<option value="10">10+</option></select>
        <input name="quantityBox" inputmode="numeric" value="${s.amzQty}" hidden>
        <a href="#" data-action="update" hidden onclick="event.preventDefault(); this.closest('form').submit();">Güncelle</a>
        <input type="submit" data-action="delete" formaction="/cart/delete" value="Sil">
      </form></div>` : '<p>Amazon sepetiniz boş.</p>'}</div>
    <form method="post" action="/buy-now"><input type="submit" value="Alışverişi Tamamla"></form>`;

  // İstek bu sahte mağazalara aitse yanıtlar ve true döner.
  function handle(host, req, raw, res) {
    if (!HOSTS.includes(host)) return false;
    const url = new URL(req.url, `https://${host}`);
    const route = `${req.method} ${url.pathname}`;
    s.log.push(`${host} ${route}`);
    if (route === 'POST /api/buy-now' || route === 'POST /buy-now') { s.boughtNow = true; json(res, {}); return true; }
    if (route === 'POST /api/delete-all') { s.deletedAll = true; json(res, {}); return true; }
    if (route === 'POST /api/subscribe') { s.subscribed = true; json(res, {}); return true; }
    if (route === 'POST /api/undo') { s.undone = true; json(res, {}); return true; }

    if (host === 'www.hepsiburada.com') {
      // Sepete ekleme denemesinden sonra kitap, sepet sayfasındaki "son gezdikleriniz" şeridinde de görünür.
      if (route === 'POST /api/add') { s.hbViewed = true; if (s.hbAddWorks && s.hbOurs < s.hbStock) s.hbOurs++; json(res, hbState()); } else page(res, `${TITLE} - Hepsiburada`, hbProduct());
      return true;
    }
    if (host === 'checkout.hepsiburada.com') {
      const body = raw ? JSON.parse(raw) : {};
      if (route === 'GET /sepetim') page(res, 'Sepetim - Hepsiburada', hbCart());
      else if (route === 'POST /api/cart') json(res, hbState());
      else if (route === 'POST /api/typed') { s.hbTyped.push(body.value); json(res, hbState()); }
      else if (route === 'POST /api/qty') {
        let message = '';
        if (body.key === 'ours') {
          const next = s.hbOurs + body.delta;
          if (next > s.hbStock) message = `Bu üründen en fazla ${s.hbStock} adet alabilirsiniz`;
          else if (body.delta > 0 || (s.hbLowerWorks && next >= 1)) s.hbOurs = next;
          s.hbMaxSeen = Math.max(s.hbMaxSeen, s.hbOurs);
        } else s.hbOther = Math.max(0, s.hbOther + body.delta);
        json(res, hbState(message));
      } else if (route === 'POST /api/remove') {
        if (body.key === 'ours') { if (s.hbRemoveWorks) s.hbOurs = 0; } else s.hbOther = 0;
        json(res, hbState());
      } else { res.writeHead(404); res.end(); }
      return true;
    }

    // www.amazon.com.tr
    const form = new URLSearchParams(raw || '');
    if (route === 'POST /cart/add') { s.amzQty = Math.min(s.amzQty + 1, s.amzStock); redirect(res, '/added'); }
    else if (route === 'GET /added') page(res, 'Sepete eklendi', '<h1>Sepete eklendi</h1>');
    else if (route === 'GET /gp/cart/view.html') { page(res, 'Amazon.com.tr Alışveriş Sepeti', amzCart()); s.amzMessage = ''; }
    else if (route === 'POST /cart/update') {
      const wanted = Number(form.get('quantity') === '10' ? form.get('quantityBox') : form.get('quantity')) || 0;
      if (wanted > s.amzStock) s.amzMessage = `Bu satıcının bu üründen yalnızca ${s.amzStock} adedi mevcut.`;
      s.amzQty = Math.min(wanted, s.amzStock);
      redirect(res, '/gp/cart/view.html');
    } else if (route === 'POST /cart/delete') { s.amzQty = 0; redirect(res, '/gp/cart/view.html'); }
    else page(res, `${TITLE} : Amazon.com.tr: Kitap`, amzProduct());
    return true;
  }

  return { state: s, reset, handle, HOSTS };
}

module.exports = { createShops };
