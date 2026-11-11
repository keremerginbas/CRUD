// Açık olan ürün sayfasından stok, fiyat ve satış işaretlerini okur.
// Sayfanın kendi bağlamına (MAIN world) enjekte edilir; böylece sitenin sayfaya
// gömdüğü ürün kaydına (__NUXT__, PRODUCT_DATA vb.) da bakabilir.
(() => {
  const OUT_RE = /(tükendi|stokta yok|stokta bulunmamaktadır|stokta bulunmuyor|temin edilemiyor|şu anda mevcut değil|satışta değil|satışa kapalı)/i;
  const BLOCK_RE = /(just a moment|bir dakika lütfen|attention required|güvenlik doğrulaması|güvenlik kontrolünü tamamlayın|you have been blocked|robot olmadığınızı|captcha|alışverişe devam etmek için aşağıdaki düğmeye)/i;
  const NOT_LISTED_RE = /(ürün bulunamadı|sonuç bulunamadı|aradığınız ürün bulunamadı|sayfa bulunamadı|aradığınız sayfa mevcut değil)/i;
  const BUY_RE = /^(sepete ekle|sepete at|satın al|hemen al|şimdi al)$/i;
  const PRICE_RE = /(\d[\d.]*(?:,\d{1,2})?)\s*(₺|TL|€|EUR)/;
  const STOCK_KEY_RE = /(?<![\w-])(stockQuantity|stock_quantity|stockCount|stockAmount|stock|inventory)\\?["']?\s*[:=]\s*\\?["']?(\d{1,6})\b/i;
  const SOLD_RE = /([\d.]+)\s*adet\s*satın alınmıştır/i;
  // Sitelerin kendi yazdığı satış / ilgi cümleleri; olduğu gibi saklanır.
  const SIGNAL_RES = [
    /bu üründen\s*[\d.]+\s*adet\s*satın alınmıştır/i,
    /geçen ay[^.!]{0,20}?[\d.]+\+?[^.!]{0,20}?satın alındı/i,
    /son\s*\d+\s*(?:gün|saat)(?:de|te|da|ta)?\s*[\d.,]+\+?\s*(?:B|bin)?\s*(?:kişi\s*)?(?:satın aldı|ürün satıldı|adet satıldı|kişi görüntüledi|kez görüntülendi|görüntülendi)/i,
    /\d+\s*günde\s*[\d.,]+\+?\s*(?:B|bin)?\s*(?:ürün|adet)\s*satıldı/i,
    /[\d.,]+\+?\s*(?:B|bin)?\s*kişi(?:nin)?\s*(?:sepetinde|sepete ekledi|favoriledi|favorisinde|satın aldı)/i,
    /sepette\s*[\d.,]+\+?\s*(?:B|bin)?\s*kişi/i,
  ];
  // Sayfaya gömülü ürün kaydında stok adedini taşıyan alan adları, güven sırasıyla.
  const STATE_KEYS = [
    /^smiktar$/i,
    /^(stockquantity|stock_quantity|stockcount|stock_count|stockamount|stock_amount|stokadedi|stok_adedi|stokmiktari|stok_miktari|stokadet|stok_adet)$/i,
    /^(stock|stok|inventory|inventoryquantity|inventory_quantity|availablestock|available_stock|availablequantity|available_quantity|sellablequantity|saleablequantity)$/i,
  ];
  // Gömülü ürün kaydında satıcı adını taşıyan alanlar.
  const SELLER_KEY_RE = /^(merchantname|merchant_name|sellername|seller_name|storename|store_name|saticiadi|satici_adi)$/i;
  const PRICE_KEY_RE = /^(price|saleprice|sale_price|finalprice|final_price|amount|value)$/i;
  const STATE_ROOTS = ['__NUXT__', '__NEXT_DATA__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APOLLO_STATE__', '__INITIAL_DATA__', '__APP_STATE__', 'PRODUCT_DATA', '__PRODUCT_DETAIL_APP_INITIAL_STATE__', 'productDetailModel', 'productModel', 'utag_data'];
  // Analitik nesneleri sepet adedi ("quantity": 1) taşır, stok değil; bakılmaz.
  const SKIP_ROOT_RE = /^(\$|dataLayer|google|gaGlobal|ga$|gtag|fbq|chrome|webpackChunk|__next_f|__next_s|closure_|_F_|GOOGLE_)/i;

  const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isPlain = (v) => { const t = Object.prototype.toString.call(v); return t === '[object Object]' || t === '[object Array]'; };

  function parseNum(raw) {
    if (raw == null) return null;
    let s = String(raw).replace(/[^\d.,]/g, '');
    if (!s) return null;
    if (s.includes(',') && s.includes('.')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function ldNodes() {
    const roots = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try { roots.push(JSON.parse(el.textContent)); } catch (e) { /* bozuk JSON, atla */ }
    });
    return roots;
  }

  function ldProduct(isbn) {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.offers) found.push(node);
      Object.values(node).forEach((v) => typeof v === 'object' && walk(v));
    };
    ldNodes().forEach(walk);
    return found.find((n) => isbn && JSON.stringify(n).includes(isbn)) || found[0] || null;
  }

  // Ürünün kendi alanı: başlıktan yukarı çıkıp fiyatı içeren en küçük kutu.
  // Böylece sayfadaki "benzer ürünler" şeritlerindeki düğmeler karışmaz.
  function mainArea() {
    const h1 = document.querySelector('h1');
    if (!h1) return document.body;
    let el = h1;
    for (let i = 0; i < 10 && el.parentElement && el.parentElement !== document.documentElement; i++) {
      el = el.parentElement;
      if (PRICE_RE.test(el.innerText || '')) break;
    }
    // Fiyatı bulduktan sonra, az içerik ekleyen üst kutuları da dahil et (düğme yan sütunda olabilir).
    for (let i = 0; i < 3 && el.parentElement && el.parentElement !== document.documentElement; i++) {
      const cur = (el.innerText || '').length;
      const up = (el.parentElement.innerText || '').length;
      if (up > cur * 1.5 + 200) break;
      el = el.parentElement;
    }
    return el;
  }

  function hasBuyButton(area) {
    const nodes = area.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"], span, div');
    for (const n of nodes) {
      const label = squash(n.tagName === 'INPUT' ? n.value : n.textContent);
      if (label.length > 30 || !BUY_RE.test(label)) continue;
      if (n.disabled || n.getAttribute('aria-disabled') === 'true') continue;
      if (n.getClientRects().length === 0) continue;
      return true;
    }
    return false;
  }

  // Ham HTML içinde, ISBN'in yakınındaki stok alanı (sayfa verisi global değişkende değilse).
  function embeddedStock(isbn) {
    if (!isbn) return null;
    const html = document.documentElement.innerHTML;
    let at = html.indexOf(isbn);
    while (at !== -1) {
      const win = html.slice(Math.max(0, at - 400), at + 400);
      const m = win.match(STOCK_KEY_RE);
      if (m) {
        const value = Number(m[2]);
        // Aynı alan sayfadaki diğer ürünlerde de hep aynı değeri taşıyorsa bu gerçek stok değil, varsayılan değerdir.
        const all = [...html.matchAll(new RegExp(STOCK_KEY_RE.source, 'gi'))].filter((x) => x[1].toLowerCase() === m[1].toLowerCase());
        const same = all.filter((x) => Number(x[2]) === value).length;
        return { key: m[1], value, placeholder: value >= 9999 || (all.length >= 4 && same === all.length) };
      }
      at = html.indexOf(isbn, at + 1);
    }
    return null;
  }

  // Sitenin sayfaya gömdüğü veri nesnelerinde bu kitabın kaydını bulur ve stok alanlarını döndürür.
  function mineState(ids) {
    const names = new Set(STATE_ROOTS);
    try {
      for (const n of Object.keys(window)) if (/(state|store|product|nuxt|next_data|initial|preload|model|apollo|redux|props)/i.test(n)) names.add(n);
    } catch (e) { /* erişilemeyen pencere özelliği */ }
    const found = [];
    const roots = [];
    const sellers = [];
    const t0 = performance.now();
    let count = 0;
    const numeric = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d{1,7}$/.test(v) ? Number(v) : null);
    const priceOf = (node) => {
      for (const [k, v] of Object.entries(node)) {
        if (!PRICE_KEY_RE.test(k)) continue;
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && parseNum(v) != null) return parseNum(v);
        if (v && typeof v === 'object') { const inner = [v.value, v.amount, v.price].find((x) => typeof x === 'number'); if (inner != null) return inner; }
      }
      return null;
    };
    // Kitabın kaydının altındaki teklif / satıcı kayıtlarını toplar (sınırlı derinlik).
    const harvest = (record, path, depth) => {
      const local = new Set();
      const q = [[record, 0]];
      for (let i = 0; i < q.length && local.size < 3000; i++) {
        const [node, d] = q[i];
        if (local.has(node)) continue;
        local.add(node);
        let ents;
        try { ents = Object.entries(node); } catch (e) { continue; }
        if (!Array.isArray(node)) {
          let name = null;
          for (const [k, v] of ents) {
            if (SELLER_KEY_RE.test(k) && typeof v === 'string') name = v;
            else if (/^(merchant|seller|store)$/i.test(k) && v && typeof v === 'object' && typeof v.name === 'string') name = v.name;
          }
          name = squash(name);
          if (name.length >= 2 && name.length <= 60 && !sellers.some((x) => x.name === name)) sellers.push({ name, price: priceOf(node) });
          if (d > 0) {
            for (const [k, v] of ents) {
              const n = numeric(v);
              const pri = STATE_KEYS.findIndex((re) => re.test(k));
              if (n != null && pri >= 0) found.push({ path: `${path}…${k}`, key: k, value: n, pri: pri + 10, depth: depth + d });
            }
          }
        }
        if (d < 4) for (const [, v] of ents) if (v && typeof v === 'object' && isPlain(v)) q.push([v, d + 1]);
      }
    };
    for (const name of names) {
      if (SKIP_ROOT_RE.test(name)) continue;
      let root;
      try { root = window[name]; } catch (e) { continue; }
      if (!root || typeof root !== 'object' || !isPlain(root)) continue;
      roots.push(name);
      const seen = new WeakSet();
      const queue = [[root, name, 0]];
      for (let qi = 0; qi < queue.length; qi++) {
        const [o, path, depth] = queue[qi];
        if (seen.has(o)) continue;
        seen.add(o);
        // Çok büyük sayfa verilerinde taramayı sınırla.
        if (++count > 150000 || (count % 2000 === 0 && performance.now() - t0 > 1200)) return { found, roots, sellers };
        let entries;
        try { entries = Object.entries(o); } catch (e) { continue; }
        if (!Array.isArray(o) && entries.some(([, v]) => (typeof v === 'string' || typeof v === 'number') && ids.includes(String(v)))) {
          for (const [k, v] of entries) {
            const n = numeric(v);
            if (n == null) continue;
            let pri = STATE_KEYS.findIndex((re) => re.test(k));
            // T-Soft altyapısında (PRODUCT_DATA) "quantity" stok adedidir.
            if (pri < 0 && name === 'PRODUCT_DATA' && /^quantity$/i.test(k)) pri = STATE_KEYS.length;
            if (pri >= 0) found.push({ path: `${path}.${k}`, key: k, value: n, pri, depth });
          }
          harvest(o, path, depth);
        }
        if (depth < 12) for (const [k, v] of entries) if (v && typeof v === 'object' && isPlain(v)) queue.push([v, `${path}.${k}`, depth + 1]);
      }
    }
    found.sort((a, b) => a.pri - b.pri || a.depth - b.depth);
    return { found, roots, sellers };
  }

  function visibleStock(text) {
    const pats = [/son\s+(\d+)\s+(?:ürün|adet)/i, /sadece\s+(\d+)\s+adet/i, /(\d+)\s+adet\s+kaldı/i, /stok\s*(?:adedi|miktarı|durumu)?\s*:\s*(\d+)/i];
    for (const p of pats) { const m = text.match(p); if (m) return Number(m[1]); }
    return null;
  }

  // "Satıcı: X" satırlarından ya da tek başına "Satıcı" etiketinin altındaki satırdan satıcı adlarını çıkarır.
  function sellerNames(text) {
    const lines = (text || '').split('\n').map(squash).filter(Boolean);
    const names = [];
    for (let i = 0; i < lines.length && names.length < 12; i++) {
      const m = lines[i].match(/^Satıcı\s*:\s*(.+)$/i);
      let name = m ? m[1] : /^Satıcı$/i.test(lines[i]) ? lines[i + 1] || '' : '';
      name = name.replace(/\s+\d+(?:[.,]\d+)?$/, ''); // yanındaki satıcı puanı
      if (name.length >= 2 && name.length <= 60 && !/^\d/.test(name)) names.push(name);
    }
    return names;
  }

  // Yazıdaki ilk ürün fiyatı; kargo / teslimat ücreti olarak yazılan tutarlar atlanır.
  function firstPrice(text) {
    let prevEnd = 0;
    for (const m of text.matchAll(new RegExp(PRICE_RE.source, 'g'))) {
      const end = m.index + m[0].length;
      // Etiket tutarın hemen önünde ya da ardında olur; bir önceki tutarın etiketi bu tutara sayılmaz.
      const label = `${text.slice(Math.max(prevEnd, m.index - 22), m.index)} | ${text.slice(end, end + 14)}`;
      prevEnd = end;
      if (/(kargo|teslimat|gönderim)/i.test(label)) continue;
      return m;
    }
    return null;
  }

  // Amazon ürün sayfasında fiyatın yazdığı bilinen alanlar, öncelik sırasıyla.
  const AMAZON_PRICE_SELECTORS = [
    '#corePrice_feature_div .a-price .a-offscreen', '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen', '#apex_desktop .a-price .a-offscreen',
    '#price_inside_buybox', '#newBuyBoxPrice', '#price', '#tmm-grid-swatch-PAPERBACK .slot-price', '#tmmSwatches .swatchElement.selected .a-color-price',
  ];
  const isAmazon = () => !!document.querySelector('#add-to-cart-button, #productTitle');
  function amazonPrices() {
    const out = {};
    for (const sel of AMAZON_PRICE_SELECTORS) { const el = document.querySelector(sel); if (el && squash(el.textContent)) out[sel] = squash(el.textContent).slice(0, 40); }
    return out;
  }

  function quantityLimit(area) {
    const input = area.querySelector('input[type="number"][max]') || document.querySelector('input[type="number"][max]');
    if (input && Number.isFinite(Number(input.max)) && Number(input.max) > 0) return Number(input.max);
    // Adet seçme kutusu: seçenek sayısı, tek siparişte alınabilecek en yüksek adettir.
    const select = document.querySelector('select#quantity, select[name="quantity"], select[name*="adet" i], select[name*="quantity" i]');
    if (select) {
      const nums = [...select.options].map((o) => parseInt(o.value, 10)).filter((n) => Number.isFinite(n) && n > 0);
      if (nums.length) return Math.max(...nums);
    }
    return null;
  }

  function hits(text, re, pad, max) {
    const out = [];
    for (const m of text.matchAll(re)) {
      const s = squash(text.slice(Math.max(0, m.index - pad), m.index + m[0].length + pad));
      if (!out.includes(s)) out.push(s);
      if (out.length >= max) break;
    }
    return out;
  }

  // Okuyucuyu bir siteye göre ayarlamak için gereken, yalnızca ürünle ilgili sayfa parçaları.
  function buildDiag(area, areaText, body, mined) {
    const html = document.documentElement.innerHTML;
    return {
      url: location.href,
      title: squash(document.title),
      jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 4).map((el) => squash(el.textContent).slice(0, 1500)),
      areaText: areaText.slice(0, 2500),
      textHits: hits(body, /(stok|tükendi|satın alın|satıldı|sıralama|satıcı|temin|baskı|okunma|okur)/gi, 70, 30),
      htmlHits: hits(html, /(stock|stok|quantity|inventory|smiktar|sold|sales|satis)[\w\\"']{0,24}\s*[:=]\s*[^,;<>{}]{1,40}/gi, 0, 40),
      controls: [...document.querySelectorAll('select, input[type="number"]')].slice(0, 12).map((el) => ({ tag: el.tagName, id: el.id, name: el.name, max: el.max || null, options: el.options ? el.options.length : null })),
      buttons: [...new Set([...area.querySelectorAll('button, [role="button"], input[type="submit"]')].map((b) => squash(b.value || b.textContent)).filter((t) => t && t.length < 40))].slice(0, 25),
      state: mined.found.slice(0, 30).map((f) => `${f.path} = ${f.value}`),
      sellers: mined.sellers.slice(0, 10),
      amazon: isAmazon() ? { prices: amazonPrices(), quantityOptions: (document.querySelector('select#quantity') || { options: [] }).options.length } : undefined,
      stateRoots: mined.roots,
    };
  }

  function extract(isbn) {
    const title = squash(document.title);
    const body = squash(document.body ? document.body.innerText : '');
    const out = { status: 'unknown', title: squash((document.querySelector('h1') || {}).innerText) || title };

    if (BLOCK_RE.test(title) || /\|\s*Güvenlik$/i.test(title) || (body.length < 2500 && BLOCK_RE.test(body))) {
      return { ...out, status: 'blocked', note: 'Site doğrulama istiyor. Açık kalan sekmede doğrulamayı tamamlayıp yeniden tarayın.' };
    }

    const ld = ldProduct(isbn);
    // Tek teklif ya da birden çok satıcının teklifini saran toplu kayıt (AggregateOffer).
    const rawOffers = ld ? [].concat(ld.offers || []).filter(Boolean) : [];
    const agg = rawOffers.find((o) => o.offers) || null;
    const offers = agg ? [].concat(agg.offers || []).filter(Boolean) : rawOffers;
    const offer = offers[0] || agg;
    const priceSrc = agg && agg.lowPrice != null ? agg : offer;
    const area = mainArea();
    const areaText = squash(area.innerText);
    out.hasIsbn = !!isbn && document.documentElement.innerHTML.includes(isbn);

    // Fiyat
    if (priceSrc && (priceSrc.price != null || priceSrc.lowPrice != null)) {
      out.price = parseNum(priceSrc.price != null ? priceSrc.price : priceSrc.lowPrice);
      out.currency = priceSrc.priceCurrency || (offer && offer.priceCurrency) || null;
      const spec = [].concat((offer && offer.priceSpecification) || []).map((x) => parseNum(x && x.price)).filter((n) => n != null && n > out.price);
      if (spec.length) out.listPrice = Math.max(...spec);
    } else {
      const meta = document.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"]');
      const amazon = isAmazon() ? Object.values(amazonPrices()).map((t) => t.match(PRICE_RE)).find(Boolean) : null;
      const m = amazon || firstPrice(areaText);
      if (meta) {
        out.price = parseNum(meta.content);
        const cur = document.querySelector('meta[property="product:price:currency"], meta[property="og:price:currency"]');
        out.currency = cur ? cur.content : null;
      } else if (m) {
        out.price = parseNum(m[1]);
        out.currency = /€|EUR/.test(m[2]) ? 'EUR' : 'TRY';
      }
    }

    // Durum (ilk okuma)
    const avail = offer && offer.availability ? String(offer.availability) : '';
    const amazonAvail = squash((document.querySelector('#availability') || {}).innerText);
    const buy = hasBuyButton(area);
    if (/InStock|LimitedAvailability|OnlineOnly/i.test(avail)) out.status = 'in_stock';
    else if (/OutOfStock|SoldOut|Discontinued/i.test(avail)) out.status = 'out_of_stock';
    else if (/PreOrder|BackOrder|PreSale/i.test(avail)) out.status = 'preorder';
    else if (amazonAvail) out.status = OUT_RE.test(amazonAvail) || /mevcut değil/i.test(amazonAvail) ? 'out_of_stock' : 'in_stock';
    else if (!ld && NOT_LISTED_RE.test(body)) out.status = 'not_listed';
    else if (buy) out.status = 'in_stock';
    else if (OUT_RE.test(areaText)) out.status = 'out_of_stock';
    else if (out.price != null) out.status = 'no_buy_button';
    if (amazonAvail) out.availabilityText = amazonAvail;

    // Temin süresi, baskı
    const lead = body.match(/Temin Süresi\s*:\s*(\d+\s*(?:iş\s*)?gün[a-zçğıöşü]*)/i) || body.match(/(\d+\s*-\s*\d+\s*iş gün[a-zçğıöşü]*)\s*(?:içinde\s*)?temin/i);
    if (lead) out.leadTime = squash(lead[1]);
    const ed = body.match(/Baskı(?:\s*Sayısı)?\s*:\s*(\d+)/i) || body.match(/(\d+)\.\s*Bask[ıi]/i);
    if (ed) out.edition = Number(ed[1]);

    // Stok adedi: önce sayfada yazan, sonra sitenin gömdüğü ürün kaydı, en son ham HTML.
    const urlIds = (location.pathname.match(/[A-Za-z0-9]{10,}/g) || []).filter((t) => /\d/.test(t) && /^[A-Z0-9]+$/.test(t));
    const ids = [...new Set([isbn, ...urlIds].filter(Boolean).map(String))];
    const mined = mineState(ids);
    const best = mined.found[0];
    const seen = visibleStock(amazonAvail) ?? visibleStock(areaText);
    const emb = embeddedStock(isbn);
    let onOrder = false;
    if (seen != null) { out.stockQty = seen; out.stockQtySource = 'sayfa metni'; }
    else if (best) {
      // Eksi değer: mağaza stok tutmuyor, sipariş gelince tedarik ediyor.
      onOrder = best.value < 0;
      out.stockQty = Math.max(0, best.value);
      out.stockQtySource = `sayfa verisi (${best.key})`;
      out.stockQtyPlaceholder = best.value >= 9999;
    } else if (emb) { out.stockQty = emb.value; out.stockQtySource = `gömülü veri (${emb.key})`; out.stockQtyPlaceholder = emb.placeholder; }
    const limit = quantityLimit(area);
    if (limit != null) out.maxOrderQty = limit;
    // Amazon'da adet seçici en çok 30'a kadar gider; daha azsa satıcının stoku (ya da sipariş sınırı) o kadardır.
    if (out.stockQty == null && limit != null && limit < 30 && isAmazon() && document.querySelector('select#quantity')) {
      out.stockQty = limit;
      out.stockQtySource = 'adet seçici';
    }
    const realQty = out.stockQty != null && !out.stockQtyPlaceholder ? out.stockQty : null;

    // Durumu gerçek stok bilgisine göre netleştir.
    if (out.status === 'no_buy_button' && realQty === 0) out.status = 'out_of_stock';
    if (out.status === 'in_stock' && (onOrder || realQty === 0 || (out.leadTime && !(realQty > 0)))) out.status = 'on_order';

    // Puan ve yorumlar
    const ratingInfo = ld && ld.aggregateRating;
    if (ratingInfo) {
      out.rating = parseNum(ratingInfo.ratingValue);
      out.reviewCount = parseNum(ratingInfo.reviewCount != null ? ratingInfo.reviewCount : ratingInfo.ratingCount);
    }
    const acr = squash((document.querySelector('#acrCustomerReviewText') || {}).innerText);
    if (acr && out.reviewCount == null) out.reviewCount = parseNum(acr);

    // Satış sıralaması (Amazon) ve satıcı sayısı
    const rank = body.match(/En Çok Satanlar Sıralaması:?\s*.{0,160}?([\d.]+)\s*numara/i) || body.match(/Sıralaması:?\s*#?\s*([\d.]+)/i);
    if (rank) out.rank = parseNum(rank[1]);
    // Satıcılar: öne çıkan satıcı, diğer satıcılar ve toplam satıcı sayısı
    const ldSellers = offers.filter((o) => o.seller && o.seller.name).map((o) => ({ name: squash(o.seller.name), price: parseNum(o.price) }));
    const amazonSeller = squash((document.querySelector('#sellerProfileTriggerId') || document.querySelector('#merchantInfoFeature_feature_div .offer-display-feature-text-message') || {}).textContent);
    const areaSellers = sellerNames(area.innerText);
    const pageSellers = [...new Set(sellerNames(document.body.innerText))];
    const seller = amazonSeller || areaSellers[0] || (pageSellers.length === 1 ? pageSellers[0] : null) || (ldSellers[0] && ldSellers[0].name) || (mined.sellers[0] && mined.sellers[0].name) || null;
    if (seller) out.seller = seller;
    const sellerList = ldSellers.length > 1 ? ldSellers : mined.sellers.length > 1 ? mined.sellers : [];
    if (sellerList.length) out.sellerList = sellerList.slice(0, 8);
    const others = body.match(/(\d+)\s+diğer\s+satıcı/i) || body.match(/Diğer\s+Satıcılar\s*\(\s*(\d+)\s*\)/i);
    const total = body.match(/Yeni\s*\((\d+)\)\s*(?:başlangıç|teklif)/i) || body.match(/(\d+)\s+satıcı/i);
    const listed = sellerList.length + (seller && sellerList.length && !sellerList.some((x) => x.name === seller) ? 1 : 0);
    const sellerCount = Math.max((agg && Number(agg.offerCount)) || 0, listed, others ? Number(others[1]) + 1 : 0, total ? Number(total[1]) : 0);
    if (sellerCount > 0) out.sellers = sellerCount;

    // Sitenin kendi yazdığı satış sayacı ve ilgi cümleleri
    const sold = body.match(SOLD_RE);
    if (sold) out.soldCount = parseNum(sold[1]);
    const signals = [];
    for (const re of SIGNAL_RES) { const m = body.match(re); if (m && !signals.includes(squash(m[0]))) signals.push(squash(m[0]).slice(0, 90)); }
    if (signals.length) out.signals = signals.slice(0, 6);

    // Okur sitelerindeki sayaçlar (okunma, beğeni, inceleme...)
    const counts = {};
    for (const m of body.matchAll(/(\d[\d.,]*)\s*(okunma|okur|beğeni|inceleme|alıntı|değerlendirme|yorum)/gi)) {
      const key = m[2].toLocaleLowerCase('tr');
      if (!(key in counts)) counts[key] = parseNum(m[1]);
    }
    if (Object.keys(counts).length) out.counts = counts;

    out.diag = buildDiag(area, areaText, body, mined);
    return out;
  }

  // Arama sonucu sayfasında kitabın kendi ürün sayfasının adresini bulur.
  function findProductLink(isbn, title) {
    const norm = (s) => (s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
    // Aynı sayfanın başka bir sürümüne (sayfalama, sıralama) giden bağlantılar ürün sayfası değildir.
    const usable = (u) => {
      if (typeof u !== 'string' || !/^https?:/i.test(u)) return false;
      try { return new URL(u).pathname !== location.pathname; } catch (e) { return false; }
    };
    // 1) Yapısal veride ISBN'i taşıyan en içteki kayıt
    let best = null;
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object') return;
      if (!Array.isArray(node) && isbn && usable(node.url) && JSON.stringify(node).includes(isbn) && (!best || depth > best.depth)) best = { url: node.url, depth };
      Object.values(node).forEach((v) => walk(v, depth + 1));
    };
    ldNodes().forEach((r) => walk(r, 0));
    if (best) return best.url;
    // 2) Yazısı kitabın adıyla eşleşen bağlantı
    const want = norm(title);
    if (!want) return null;
    for (const a of document.querySelectorAll('a[href]')) {
      const img = a.querySelector('img');
      const labels = [a.textContent, a.getAttribute('title'), img && img.alt].map(norm);
      if (labels.some((l) => l && l.includes(want)) && usable(a.href)) return a.href;
    }
    return null;
  }

  globalThis.__kitapTakipExtract = extract;
  globalThis.__kitapTakipFindProduct = findProductLink;
  globalThis.__kitapTakipParseNum = parseNum;
})();
