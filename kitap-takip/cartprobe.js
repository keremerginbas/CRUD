// Sepet sınırı ölçümü, sayfa tarafı. Kitabı sepete ekleyip adedi yükseltince sitenin izin verdiği
// en yüksek adet, satıcının stoku (ya da sipariş sınırı) hakkında bilgi verir.
//
// Güvenlik kuralları:
// - Yalnızca "Sepete ekle", adet artır/azalt ve sil düğmelerine basılır; satın alma ya da ödeme
//   düğmelerine hiçbir koşulda basılmaz.
// - Sepette yalnızca bu kitabın satırına dokunulur.
(() => {
  const ADD_RE = /^sepete (ekle|at)$/i;
  const DANGER_RE = /(satın al|şimdi al|hemen al|alışverişi tamamla|sipariş|ödeme|ödemeye|checkout|buy now|tek tıkla)/i;
  const BLOCK_RE = /(just a moment|bir dakika lütfen|attention required|güvenlik doğrulaması|güvenlik kontrolünü tamamlayın|you have been blocked|robot olmadığınızı|captcha)/i;
  const PLUS_RE = /(art[ıi]r|arttır|increase|increment|\bplus\b)/i;
  const MINUS_RE = /(azalt|eksilt|decrease|decrement|\bminus\b)/i;
  const DELETE_LABEL_RE = /^(sil|kaldır|ürünü sil|ürünü kaldır|sepetten (sil|çıkar|kaldır))$/i;
  const DELETE_ATTR_RE = /(\bsil\b|kaldır|delete|remove|trash)/i;
  const CONFIRM_RE = /^(sil|evet|onayla|kaldır|tamam|ürünü sil)$/i;
  const UPDATE_RE = /^(güncelle|uygula|update)$/i;
  const LIMIT_MSG_RE = /(en fazla|yalnızca|sadece|stok|limit|sınır|mevcut)/i;
  const CLICKABLE = 'button, a, [role="button"], input[type="submit"], input[type="button"]';

  const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => (s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
  const visible = (el) => el.getClientRects().length > 0;
  const isDisabled = (el) => !!el.disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/i.test(String(el.className || ''));
  const textOf = (el) => squash(el.tagName === 'INPUT' ? el.value : el.textContent);
  const attrsOf = (el) => ['aria-label', 'title', 'data-a-selector', 'data-action', 'data-test-id', 'data-testid', 'name', 'id'].map((a) => el.getAttribute(a) || '').concat(String(el.className || '')).join(' ');
  const labelOf = (el) => textOf(el) || squash(el.getAttribute('aria-label')) || squash(el.getAttribute('title'));

  // Tıklamadan önce son denetim: satın alma / ödeme düğmesine asla basılmaz.
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

  // Bir kutunun içindeki adet denetimleri ve silme düğmesi.
  function controls(root) {
    const input = [...root.querySelectorAll('input')].find((i) => visible(i) && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'search', 'password', 'email'].includes(i.type) && /^\d{1,4}$/.test(i.value || '')) || null;
    const select = [...root.querySelectorAll('select')].find((sel) => visible(sel) && [...sel.options].filter((o) => /^\d+\s*\+?$/.test(squash(o.textContent))).length >= 2) || null;
    const clickables = [...root.querySelectorAll(CLICKABLE)].filter(visible);
    const plus = clickables.find((el) => textOf(el) === '+' || PLUS_RE.test(attrsOf(el)) || PLUS_RE.test(textOf(el))) || null;
    const minus = clickables.find((el) => ['-', '−', '–'].includes(textOf(el)) || MINUS_RE.test(attrsOf(el)) || MINUS_RE.test(textOf(el))) || null;
    const del = clickables.find((el) => el !== plus && el !== minus && (DELETE_LABEL_RE.test(textOf(el)) || DELETE_ATTR_RE.test(attrsOf(el)))) || null;
    return { input, select, plus, minus, del };
  }

  // Kutu birden çok sepet satırını kapsıyorsa (birden çok adet denetimi) satır sayılmaz.
  function controlGroups(root) {
    const inputs = [...root.querySelectorAll('input')].filter((i) => visible(i) && /^\d{1,4}$/.test(i.value || '') && !['hidden', 'checkbox', 'radio'].includes(i.type)).length;
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

  // Satır bulunamadığında okuyucuyu siteye göre ayarlamak için sepet sayfasının özeti.
  function cartDiag() {
    return {
      url: location.href,
      title: squash(document.title),
      text: squash(document.body ? document.body.innerText : '').slice(0, 1500),
      controls: [...document.querySelectorAll('select, input')].filter(visible).slice(0, 15).map((el) => ({ tag: el.tagName, type: el.type || null, name: el.name || null, value: String(el.value || '').slice(0, 20) })),
      buttons: [...new Set([...document.querySelectorAll(CLICKABLE)].filter(visible).map((el) => `${labelOf(el)} [${squash(attrsOf(el)).slice(0, 60)}]`))].slice(0, 40),
    };
  }

  function inspect(title, ids) {
    const page = pageKind();
    if (page !== 'cart') return { page };
    // Sayfadaki sepet satırı sayısı: arka plan, kitabı ekledikten sonra tam bir satır arttığını doğrular.
    const groups = controlGroups(document.body);
    const line = findLine(title, ids);
    if (!line) return { page, found: false, groups };
    const c = controls(line);
    const nums = c.select ? [...c.select.options].map((o) => parseInt(squash(o.textContent), 10)).filter(Number.isFinite) : [];
    return {
      page, found: true, groups,
      qty: readQty(line, c),
      control: c.input ? 'input' : c.select ? 'select' : c.plus ? 'stepper' : null,
      selectMax: nums.length ? Math.max(...nums) : null,
      selectOpen: c.select ? [...c.select.options].some((o) => /\d\s*\+$/.test(squash(o.textContent))) : false,
      plusDisabled: c.plus ? isDisabled(c.plus) : null,
      canRemove: !!(c.del || c.minus || c.input),
      messages: messages(line),
    };
  }

  function typeInto(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Adedi yükseltmek için tek bir adım atar; arka plan, sonuç değişmeyene kadar yineler.
  function raise(title, ids, big) {
    const line = findLine(title, ids);
    if (!line) return { acted: 'none' };
    const c = controls(line);
    if (c.input) {
      typeInto(c.input, big);
      for (const type of ['keydown', 'keyup']) c.input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      c.input.dispatchEvent(new Event('blur', { bubbles: true }));
      const update = [...line.querySelectorAll(CLICKABLE)].find((el) => visible(el) && UPDATE_RE.test(labelOf(el)));
      if (update) safeClick(update);
      return { acted: 'input' };
    }
    if (c.select) {
      const options = [...c.select.options];
      const open = options.find((o) => /\d\s*\+$/.test(squash(o.textContent)));
      const highest = options.filter((o) => /^\d+$/.test(squash(o.textContent))).sort((a, b) => Number(squash(b.textContent)) - Number(squash(a.textContent)))[0];
      const pick = open || highest;
      if (!pick || c.select.value === pick.value) return { acted: 'none' };
      c.select.value = pick.value;
      c.select.dispatchEvent(new Event('change', { bubbles: true }));
      return { acted: open ? 'select-open' : 'select-max' };
    }
    if (c.plus && !isDisabled(c.plus)) return { acted: safeClick(c.plus) ? 'click' : 'none' };
    return { acted: 'none' };
  }

  // Kitabı sepetten çıkarmak için tek bir adım atar. mode 'minus' ise silme düğmesi atlanır
  // (silme düğmesi işe yaramadığında adedi eksi düğmesiyle sıfırlamak için).
  function remove(title, ids, mode) {
    const line = findLine(title, ids);
    if (!line) return { acted: 'none' };
    const c = controls(line);
    if (mode !== 'minus' && c.del && safeClick(c.del)) return { acted: 'delete' };
    if (c.minus && !isDisabled(c.minus) && safeClick(c.minus)) return { acted: 'minus' };
    if (c.input) { typeInto(c.input, 0); c.input.dispatchEvent(new Event('blur', { bubbles: true })); return { acted: 'zero' }; }
    return { acted: 'none' };
  }

  // Silme onayı isteyen pencere açıldıysa onaylar.
  function confirm() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [class*="modal" i], [class*="popup" i], [class*="dialog" i]')].filter(visible);
    for (const d of dialogs) {
      const yes = [...d.querySelectorAll(CLICKABLE)].find((el) => visible(el) && CONFIRM_RE.test(labelOf(el)));
      if (yes && safeClick(yes)) return { acted: true };
    }
    return { acted: false };
  }

  globalThis.__kitapTakipCart = { addToCart, inspect, raise, remove, confirm, diag: cartDiag };
})();
