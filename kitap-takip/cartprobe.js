// Sepet sınırı ölçümü, sayfa tarafı. Kitabı sepete ekleyip adedi yükseltince sitenin izin verdiği
// en yüksek adet, satıcının stoku (ya da sipariş sınırı) hakkında bilgi verir.
//
// Güvenlik kuralları:
// - Yalnızca "Sepete ekle", adet artır/azalt ve sepetten çıkar düğmelerine basılır; satın alma,
//   ödeme, üyelik ya da "bütün ürünleri sil" düğmelerine hiçbir koşulda basılmaz.
// - Adet kutusuna hiçbir şey yazılmaz; adet yalnızca düğmelerle, birer birer değişir.
// - Sepette yalnızca bu kitabın satırına dokunulur.
// - Onay pencerelerinde yalnızca ürünü sepetten çıkarmayı soran pencere onaylanır.
(() => {
  const ADD_RE = /^sepete (ekle|at)$/i;
  const DANGER_RE = /(satın al|şimdi al|hemen al|alışverişi tamamla|sipariş|ödeme|ödemeye|checkout|buy now|tek tıkla|one ?click|premium|üye ol|abone|ürünleri sil|tümünü sil|hepsini sil|sepeti (boşalt|temizle)|geri al)/i;
  const BLOCK_RE = /(just a moment|bir dakika lütfen|attention required|güvenlik doğrulaması|güvenlik kontrolünü tamamlayın|you have been blocked|robot olmadığınızı|captcha)/i;
  const PLUS_RE = /(art[ıi]r|arttır|increase|increment|\bplus\b)/i;
  const MINUS_RE = /(azalt|eksilt|decrease|decrement|\bminus\b)/i;
  const DELETE_LABEL_RE = /^(sil|kaldır|çıkar|ürünü (sil|kaldır|çıkar)|sepetten (sil|çıkar|kaldır))$/i;
  const DELETE_ATTR_RE = /(\bsil\b|kaldır|çıkar|delete|remove|trash)/i;
  // Onay penceresi: yalnızca ürünü çıkarmayı soran, başka bir işe (üyelik, ödeme) değinmeyen pencere.
  const REMOVAL_TEXT_RE = /(sepet\S*\s+(sil|çıkar|kaldır)|silmek|çıkarmak|kaldırmak|silinsin|silinecek)/i;
  const UNSAFE_DIALOG_RE = /(premium|üyelik|abonelik|ödeme|satın al|sipariş|taksit|çerez)/i;
  const DECLINE_RE = /(vazgeç|iptal|hayır|favori|liste|kapat|geri al)/i;
  // Sepet satırlarını açıkça işaretleyen siteler: satır sayısı buradan sayılır. Boş sepet sayfasında
  // gösterilen önerilen ürünlerin düğmeleri böylece satır sanılmaz.
  const ROW_SELECTORS = { 'checkout.hepsiburada.com': 'li[data-sku][data-listingid]' };
  const REMOVE_VERB_RE = /(^|[\s,])(sil|kaldır|çıkar)$/i;
  const LIMIT_MSG_RE = /(en fazla|yalnızca|sadece|stok|limit|sınır|mevcut)/i;
  const CLICKABLE = 'button, a, [role="button"], input[type="submit"], input[type="button"]';

  const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => (s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
  const visible = (el) => el.getClientRects().length > 0;
  const isDisabled = (el) => !!el.disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/i.test(String(el.className || ''));
  const textOf = (el) => squash(el.tagName === 'INPUT' ? el.value : el.textContent);
  const attrsOf = (el) => ['aria-label', 'title', 'data-a-selector', 'data-action', 'data-test-id', 'data-testid', 'name', 'id'].map((a) => el.getAttribute(a) || '').concat(String(el.className || '')).join(' ');
  const labelOf = (el) => textOf(el) || squash(el.getAttribute('aria-label')) || squash(el.getAttribute('title'));
  const isQtyInput = (i) => visible(i) && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'search', 'password', 'email'].includes(i.type) && /^\d{1,4}$/.test(i.value || '');

  // Tıklamadan önce son denetim: satın alma, ödeme, üyelik ya da toplu silme düğmesine asla basılmaz.
  function safeClick(el) {
    if (DANGER_RE.test(`${textOf(el)} ${attrsOf(el)}`)) return false;
    el.click();
    return true;
  }

  // Ürün sayfasında, başlığa en yakın "Sepete ekle" düğmesine basar.
  function addToCart() {
    const usable = (el) => ADD_RE.test(labelOf(el)) && !isDisabled(el) && visible(el);
    const known = document.querySelector('#add-to-cart-button');
    let button = known && usable(known) ? known : null;
    const h1 = document.querySelector('h1');
    for (let scope = h1 && h1.parentElement; !button && scope; scope = scope.parentElement) {
      button = [...scope.querySelectorAll(CLICKABLE)].find(usable) || null;
    }
    if (!button && !h1) button = [...document.querySelectorAll(CLICKABLE)].find(usable) || null;
    if (!button) return { ok: false, reason: 'no_add_button' };
    return safeClick(button) ? { ok: true, label: labelOf(button) } : { ok: false, reason: 'no_add_button' };
  }

  // Adet kutusunun hemen solundaki ve sağındaki, yalnızca simge taşıyan düğmeler. Düğmelerin adı
  // siteden siteye ve adede göre değişir (adet 1 iken soldaki "sepetten çıkar" olur); konumu değişmez.
  function neighbours(input) {
    if (!input || !input.parentElement) return {};
    const sibs = [...input.parentElement.children];
    const at = sibs.indexOf(input);
    const iconButton = (el) => (el && el.matches(CLICKABLE) && visible(el) && textOf(el) === '' && el.querySelector('svg, img, i') ? el : null);
    const left = iconButton(sibs[at - 1]);
    const right = iconButton(sibs[at + 1]);
    return left && right ? { left, right } : {};
  }

  // Bir satırın adet denetimleri ve sepetten çıkarma düğmesi.
  function controls(root) {
    const input = [...root.querySelectorAll('input')].find(isQtyInput) || null;
    const select = [...root.querySelectorAll('select')].find((sel) => visible(sel) && [...sel.options].filter((o) => /^\d+\s*\+?$/.test(squash(o.textContent))).length >= 2) || null;
    const clickables = [...root.querySelectorAll(CLICKABLE)].filter(visible);
    const { left, right } = neighbours(input);
    const plus = clickables.find((el) => textOf(el) === '+' || PLUS_RE.test(attrsOf(el)) || PLUS_RE.test(textOf(el))) || right || null;
    const namedMinus = clickables.find((el) => ['-', '−', '–'].includes(textOf(el)) || MINUS_RE.test(attrsOf(el)) || MINUS_RE.test(textOf(el))) || null;
    const del = clickables.find((el) => el !== plus && el !== namedMinus && (DELETE_LABEL_RE.test(textOf(el)) || DELETE_ATTR_RE.test(attrsOf(el)))) || null;
    const minus = namedMinus || (left && left !== del ? left : null);
    return { input, select, plus, minus, del };
  }

  // Kutu birden çok sepet satırını kapsıyorsa (birden çok adet denetimi) satır sayılmaz.
  function controlGroups(root) {
    const inputs = [...root.querySelectorAll('input')].filter(isQtyInput).length;
    const selects = [...root.querySelectorAll('select')].filter(visible).length;
    const pluses = [...root.querySelectorAll(CLICKABLE)].filter((el) => visible(el) && (textOf(el) === '+' || PLUS_RE.test(attrsOf(el)))).length;
    return Math.max(inputs, selects, pluses);
  }

  // Sepette bu kitabın satırı: önce ürün koduyla, yoksa adıyla aranır.
  function findLine(title, ids) {
    for (const id of ids || []) {
      const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '');
      if (!safe) continue;
      const els = [...document.querySelectorAll(`[data-asin="${safe}"], [data-sku="${safe}"], [data-product-id="${safe}"]`)].filter(visible);
      const active = els.find((el) => el.closest('#sc-active-cart, [data-name="Active Items"]')) || els.find((el) => !el.closest('#sc-saved-cart, [data-name="Saved Items"]'));
      if (active) return active;
    }
    const want = norm(title);
    if (!want) return null;
    const hits = [...document.querySelectorAll('a, span, p, h2, h3, h4, h5, div, li, td, strong, b')]
      .filter((el) => visible(el) && norm(el.textContent).includes(want) && ![...el.children].some((c) => norm(c.textContent).includes(want)));
    for (const hit of hits) {
      // Site satırı açıkça işaretlediyse (ürün kodu taşıyan liste öğesi) doğrudan o alınır.
      const row = hit.closest('li[data-sku], [data-listingid]');
      if (row && controlGroups(row) === 1) return row;
      let el = hit;
      for (let i = 0; i < 8 && el.parentElement && el.parentElement !== document.documentElement; i++) {
        el = el.parentElement;
        if (squash(el.textContent).length > 1500) break; // bir sepet satırı için fazla büyük bir kutu
        const groups = controlGroups(el);
        if (groups > 1) break;
        if (groups === 1) return el;
      }
    }
    return null;
  }

  function readQty(line, c) {
    if (c.input && /^\d+$/.test(c.input.value)) return Number(c.input.value);
    if (c.select && /^\d+$/.test(c.select.value)) return Number(c.select.value);
    const spin = line.querySelector('[role="spinbutton"][aria-valuenow]');
    if (spin && /^\d+$/.test(spin.getAttribute('aria-valuenow'))) return Number(spin.getAttribute('aria-valuenow'));
    // Artı/eksi düğmeli düzende sayı düğmelerin yanında yazar.
    for (let scope = c.plus && c.plus.parentElement, i = 0; scope && i < 3 && line.contains(scope); scope = scope.parentElement, i++) {
      const num = [...scope.querySelectorAll('span, div, p, output, b, strong')].find((el) => el.children.length === 0 && /^\d{1,4}$/.test(squash(el.textContent)));
      if (num) return Number(squash(num.textContent));
    }
    const ds = line.dataset ? line.dataset.quantity : null;
    return ds && /^\d+$/.test(ds) ? Number(ds) : null;
  }

  // Sitenin gösterdiği sınır uyarıları (olduğu gibi).
  function messages(line) {
    const out = [];
    const nodes = [line, ...document.querySelectorAll('[role="alert"], [class*="toast" i], [class*="alert" i], [class*="warning" i], [class*="error" i], [class*="message" i], [class*="msg" i]')];
    for (const n of nodes) {
      const candidates = n === line ? [...n.querySelectorAll('span, p, div, li')].filter((el) => el.children.length === 0) : [n];
      for (const el of candidates) {
        const t = squash(el.textContent);
        if (t.length > 4 && t.length <= 200 && /\d/.test(t) && LIMIT_MSG_RE.test(t) && visible(el) && !out.includes(t)) out.push(t);
        if (out.length >= 3) return out;
      }
    }
    return out;
  }

  function pageKind() {
    const title = squash(document.title);
    const body = squash(document.body ? document.body.innerText : '');
    if (BLOCK_RE.test(title) || (body.length < 2500 && BLOCK_RE.test(body))) return 'blocked';
    if ([...document.querySelectorAll('input[type="password"]')].some(visible)) return 'login';
    return 'cart';
  }

  // Okuyucuyu siteye göre ayarlamak için sepet sayfasının özeti.
  function cartDiag(title, ids) {
    const line = title ? findLine(title, ids) : null;
    return {
      // Kitabın satırının yapısı: düğme ve alan adlarını görmek için (yalnızca bu satır).
      lineHtml: line ? line.outerHTML.replace(/\s+/g, ' ').slice(0, 2500) : null,
      url: location.href,
      title: squash(document.title),
      text: squash(document.body ? document.body.innerText : '').slice(0, 1500),
      controls: [...document.querySelectorAll('select, input')].filter(visible).slice(0, 15).map((el) => ({ tag: el.tagName, type: el.type || null, name: el.name || null, value: String(el.value || '').slice(0, 20) })),
      buttons: [...new Set([...document.querySelectorAll(CLICKABLE)].filter(visible).map((el) => `${labelOf(el)} [${squash(attrsOf(el)).slice(0, 60)}]`))].slice(0, 40),
      dialogs: [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [class*="modal" i]')].filter(visible).slice(0, 3).map((d) => squash(d.textContent).slice(0, 300)),
    };
  }

  function inspect(title, ids) {
    const page = pageKind();
    if (page !== 'cart') return { page };
    // Sayfadaki sepet satırı sayısı: arka plan, kitabı ekledikten sonra tam bir satır arttığını doğrular.
    const rows = ROW_SELECTORS[location.hostname];
    const groups = rows ? [...document.querySelectorAll(rows)].filter(visible).length : controlGroups(document.body);
    const line = findLine(title, ids);
    if (!line) return { page, found: false, groups };
    const c = controls(line);
    const nums = c.select ? [...c.select.options].map((o) => squash(o.textContent)).filter((t) => /^\d+$/.test(t)).map(Number) : [];
    // Desteklenen düzenler: artı düğmesi ya da sabit seçenekli açılır liste. Adet kutusuna yazılmaz.
    const control = c.plus ? 'stepper' : nums.length >= 2 ? 'select' : c.input ? 'input' : null;
    return {
      page, found: true, groups,
      qty: readQty(line, c),
      control,
      supported: control === 'stepper' || control === 'select',
      selectMax: nums.length ? Math.max(...nums) : null,
      plusDisabled: c.plus ? isDisabled(c.plus) : null,
      canRemove: !!(c.del || c.minus),
      messages: messages(line),
    };
  }

  // Adedi bir adım yükseltir; arka plan, site izin vermeyene kadar yineler.
  function raise(title, ids) {
    const line = findLine(title, ids);
    if (!line) return { acted: 'none' };
    const c = controls(line);
    if (c.plus) return { acted: !isDisabled(c.plus) && safeClick(c.plus) ? 'click' : 'none' };
    if (c.select) {
      const highest = [...c.select.options].filter((o) => /^\d+$/.test(squash(o.textContent))).sort((x, y) => Number(squash(y.textContent)) - Number(squash(x.textContent)))[0];
      if (!highest || c.select.value === highest.value) return { acted: 'none' };
      c.select.value = highest.value;
      c.select.dispatchEvent(new Event('change', { bubbles: true }));
      return { acted: 'select-max' };
    }
    return { acted: 'none' };
  }

  // Adedi bir azaltır. Adet 1 iken hiçbir şey yapmaz: o anda aynı düğme ürünü sepetten çıkarır.
  function lower(title, ids) {
    const line = findLine(title, ids);
    if (!line) return { acted: 'none' };
    const c = controls(line);
    const qty = readQty(line, c);
    if (!(qty > 1) || !c.minus || isDisabled(c.minus)) return { acted: 'none' };
    return { acted: safeClick(c.minus) ? 'click' : 'none' };
  }

  // Kitabı sepetten çıkarmak için tek bir adım atar: çıkarma düğmesi varsa ona, yoksa azaltma
  // düğmesine basar. mode 'minus' ise çıkarma düğmesi atlanır.
  function remove(title, ids, mode) {
    const line = findLine(title, ids);
    if (!line) return { acted: 'none' };
    const c = controls(line);
    if (mode !== 'minus' && c.del && safeClick(c.del)) return { acted: 'delete' };
    if (c.minus && !isDisabled(c.minus) && safeClick(c.minus)) return { acted: 'minus' };
    return { acted: 'none' };
  }

  // Ürünü sepetten çıkarmayı soran pencere açıldıysa onaylar; başka hiçbir pencereye dokunmaz.
  function confirm() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [class*="modal" i], [class*="popup" i], [class*="dialog" i], [class*="sheet" i]')].filter(visible);
    for (const d of dialogs) {
      const text = squash(d.textContent);
      if (text.length > 600 || !REMOVAL_TEXT_RE.test(text) || UNSAFE_DIALOG_RE.test(text)) continue;
      const buttons = [...d.querySelectorAll(CLICKABLE)].filter((el) => visible(el) && !DECLINE_RE.test(labelOf(el)));
      const yes = buttons.find((el) => REMOVE_VERB_RE.test(labelOf(el))) || buttons.find((el) => /^(evet|onayla|tamam)$/i.test(labelOf(el)));
      if (yes && safeClick(yes)) return { acted: true };
    }
    return { acted: false };
  }

  globalThis.__kitapTakipCart = { addToCart, inspect, raise, lower, remove, confirm, diag: cartDiag };
})();
