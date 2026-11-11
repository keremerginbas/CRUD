// Açık olan ürün sayfasından stok, fiyat ve diğer işaretleri okur.
// Sayfaya enjekte edilir; sonucu __kitapTakipExtract(isbn) döndürür.
(() => {
  const OUT_RE = /(tükendi|stokta yok|stokta bulunmamaktadır|stokta bulunmuyor|temin edilemiyor|şu anda mevcut değil|satışta değil|satışa kapalı)/i;
  const BLOCK_RE = /(just a moment|bir dakika lütfen|attention required|güvenlik doğrulaması|you have been blocked|robot olmadığınızı|captcha|alışverişe devam etmek için aşağıdaki düğmeye)/i;
  const NOT_LISTED_RE = /(ürün bulunamadı|sonuç bulunamadı|aradığınız ürün bulunamadı|sayfa bulunamadı|aradığınız sayfa mevcut değil)/i;
  const BUY_RE = /^(sepete ekle|sepete at|satın al|hemen al|şimdi al)$/i;
  const PRICE_RE = /(\d[\d.]*(?:,\d{1,2})?)\s*(₺|TL|€|EUR)/;
  const STOCK_KEY_RE = /(?<![\w-])(stockQuantity|stock_quantity|stockCount|stockAmount|stock|inventory)\\?["']?\s*[:=]\s*\\?["']?(\d{1,6})\b/i;

  const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();

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

  function ldProduct(isbn) {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.offers) found.push(node);
      Object.values(node).forEach((v) => typeof v === 'object' && walk(v));
    };
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try { walk(JSON.parse(el.textContent)); } catch (e) { /* bozuk JSON, atla */ }
    });
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

  function visibleStock(text) {
    const pats = [/son\s+(\d+)\s+(?:ürün|adet)/i, /sadece\s+(\d+)\s+adet/i, /(\d+)\s+adet\s+kaldı/i, /stok\s*(?:adedi|miktarı|durumu)?\s*:\s*(\d+)/i];
    for (const p of pats) { const m = text.match(p); if (m) return Number(m[1]); }
    return null;
  }

  function extract(isbn) {
    const title = squash(document.title);
    const body = squash(document.body ? document.body.innerText : '');
    const out = { status: 'unknown', title: squash((document.querySelector('h1') || {}).innerText) || title };

    if (BLOCK_RE.test(title) || /\|\s*Güvenlik$/i.test(title) || (body.length < 2500 && BLOCK_RE.test(body))) {
      return { ...out, status: 'blocked', note: 'Site doğrulama istiyor. Açık kalan sekmede doğrulamayı tamamlayıp yeniden tarayın.' };
    }

    const ld = ldProduct(isbn);
    const offer = ld ? (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers) : null;
    const area = mainArea();
    const areaText = squash(area.innerText);

    // Fiyat
    if (offer && (offer.price != null || offer.lowPrice != null)) {
      out.price = parseNum(offer.price != null ? offer.price : offer.lowPrice);
      out.currency = offer.priceCurrency || null;
      const spec = [].concat(offer.priceSpecification || []).map((x) => parseNum(x && x.price)).filter((n) => n != null && n > out.price);
      if (spec.length) out.listPrice = Math.max(...spec);
    } else {
      const meta = document.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"]');
      const m = areaText.match(PRICE_RE);
      if (meta) {
        out.price = parseNum(meta.content);
        const cur = document.querySelector('meta[property="product:price:currency"], meta[property="og:price:currency"]');
        out.currency = cur ? cur.content : null;
      } else if (m) {
        out.price = parseNum(m[1]);
        out.currency = /€|EUR/.test(m[2]) ? 'EUR' : 'TRY';
      }
    }

    // Durum
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

    // Stok adedi işaretleri
    const seen = visibleStock(amazonAvail) ?? visibleStock(areaText);
    const emb = embeddedStock(isbn);
    if (seen != null) { out.stockQty = seen; out.stockQtySource = 'sayfa metni'; }
    else if (emb) { out.stockQty = emb.value; out.stockQtySource = `gömülü veri (${emb.key})`; out.stockQtyPlaceholder = emb.placeholder; }
    const qtyInput = area.querySelector('input[type="number"][max]') || document.querySelector('input[type="number"][max]');
    if (qtyInput && Number.isFinite(Number(qtyInput.max)) && Number(qtyInput.max) > 0) out.maxOrderQty = Number(qtyInput.max);

    // Temin süresi, baskı
    const lead = body.match(/Temin Süresi\s*:\s*(\d+\s*(?:iş\s*)?gün[a-zçğıöşü]*)/i) || body.match(/(\d+\s*-\s*\d+\s*iş gün[a-zçğıöşü]*)\s*(?:içinde\s*)?temin/i);
    if (lead) out.leadTime = squash(lead[1]);
    const ed = body.match(/Baskı(?:\s*Sayısı)?\s*:\s*(\d+)/i) || body.match(/(\d+)\.\s*Bask[ıi]/i);
    if (ed) out.edition = Number(ed[1]);

    // Puan ve yorumlar
    const agg = ld && ld.aggregateRating;
    if (agg) {
      out.rating = parseNum(agg.ratingValue);
      out.reviewCount = parseNum(agg.reviewCount != null ? agg.reviewCount : agg.ratingCount);
    }
    const acr = squash((document.querySelector('#acrCustomerReviewText') || {}).innerText);
    if (acr && out.reviewCount == null) out.reviewCount = parseNum(acr);

    // Satış sıralaması (Amazon) ve satıcı sayısı
    const rank = body.match(/En Çok Satanlar Sıralaması:?\s*.{0,160}?([\d.]+)\s*numara/i) || body.match(/Sıralaması:?\s*#?\s*([\d.]+)/i);
    if (rank) out.rank = parseNum(rank[1]);
    const sellers = body.match(/(\d+)\s+(?:diğer\s+)?satıcı/i);
    if (sellers) out.sellers = Number(sellers[1]);

    // Okur sitelerindeki sayaçlar (okunma, beğeni, inceleme...)
    const counts = {};
    for (const m of body.matchAll(/(\d[\d.,]*)\s*(okunma|okur|beğeni|inceleme|alıntı|değerlendirme|yorum)/gi)) {
      const key = m[2].toLocaleLowerCase('tr');
      if (!(key in counts)) counts[key] = parseNum(m[1]);
    }
    if (Object.keys(counts).length) out.counts = counts;

    return out;
  }

  globalThis.__kitapTakipExtract = extract;
  globalThis.__kitapTakipParseNum = parseNum;
})();
