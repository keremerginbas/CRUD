/* Visible-DOM extractors. No private API calls, JSON state, or challenge bypasses. */
(() => {
  'use strict';
  if (globalThis.IlanExtractor) return;

  const EXCLUDE = 'footer,[role="contentinfo"],[class*="recommend"],[class*="similar"],[class*="Similar"],.relatedAds,.related-classifieds,.banner';
  const SELLERS = '.classifiedUserBox,.classifiedOtherBox,.user-info-wrapper,.username-info-area,.classifiedUser,.user-info-box,[class*="owner"],[class*="seller"],[class*="realtor"],[class*="contact-card"],[class*="consultant"]';
  const PHONE_REGIONS = '#phoneInfoPart,.userContactInfo,.user-info-phones,.pretty-phone-part,.encrypted-phone-part,.phone-number,[class*="phone-number"],a[href^="tel:"]';
  const DESCRIPTION = '#classifiedDescription,.classifiedDescription,#ilanAciklamasi,[class*="description" i],[id*="description" i],[class*="aciklama" i],[id*="aciklama" i],[contenteditable="true"]';
  const DETAIL_TITLE = '.classifiedDetailTitle,.classified-title,[class*="detail-title"],[class*="listing-title"]';
  const OTHER_TAXONOMIES = ['ikinci-el-ve-sifir-alisveris','is-makineleri-sanayi','yedek-parca-aksesuar-donanim-tuning','hayvanlar-alemi','ozel-ders-verenler','yardimci-arayanlar','ustalar-ve-hizmetler','is-ilanlari'];
  const OTHER_LABELS = ['ikinci el ve sifir alisveris','is makineleri ve sanayi','is makineleri sanayi','yedek parca aksesuar donanim tuning','hayvanlar alemi','ozel ders verenler','yardimci arayanlar','ustalar ve hizmetler','is ilanlari'];
  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  const fold = value => clean(value).toLocaleLowerCase('tr-TR').replace(/[ıİ]/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const unique = values => [...new Set(values.filter(Boolean))];
  function visible(el) {
    if (!el?.isConnected || !el.getClientRects().length) return false;
    for (let p = el; p?.nodeType === 1; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (p.hidden || p.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  }
  const text = el => visible(el) ? clean(el.innerText) : '';
  const allowed = el => visible(el) && !el.closest(EXCLUDE) && !(el.closest('header') && !el.closest('main,.classifiedDetailContent,.classifiedDetail'));
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(allowed);
  const firstText = (selectors, root = document) => {
    for (const selector of selectors) {
      const value = all(selector, root).map(text).find(Boolean);
      if (value) return value;
    }
    return '';
  };
  function sourceFor(url = location.href) {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'hepsiemlak.com' || host.endsWith('.hepsiemlak.com')) return 'hepsiemlak';
    if (host === 'sahibinden.com' || host.endsWith('.sahibinden.com')) return 'sahibinden';
    return '';
  }
  function listingId(url) {
    let path;
    try { path = new URL(url, location.href).pathname; } catch { return ''; }
    return path.match(/\/(\d+-\d+)\/?$/)?.[1] || path.match(/-(\d+)\/detay\/?$/)?.[1] || '';
  }
  function canonicalListing(url) {
    try {
      const parsed = new URL(url, location.href);
      if (!/^https?:$/.test(parsed.protocol) || sourceFor(parsed.href) !== sourceFor() || !listingId(parsed.href)) return '';
      parsed.hash = ''; parsed.search = '';
      return parsed.href;
    } catch { return ''; }
  }
  function parseNumber(value) {
    const matches = clean(value).match(/\d[\d. ,]*/g);
    if (!matches?.length) return null;
    let s = matches[0].trim().replace(/\s/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const number = Number(s);
    return Number.isFinite(number) ? number : null;
  }
  function normalizePhone(value) {
    let digits = String(value).replace(/\D/g, '');
    if (digits.startsWith('0090')) digits = digits.slice(2);
    if (/^0[2-5]\d{9}$/.test(digits)) digits = '90' + digits.slice(1);
    if (/^[2-5]\d{9}$/.test(digits)) digits = '90' + digits;
    return /^90[2-5]\d{9}$/.test(digits) ? digits : '';
  }
  function phoneNumbers(value) {
    return unique((clean(value).match(/(?<!\d)(?:(?:\+|00)?90[\s().-]*)?0?[2-5]\d{2}[\s().-]*\d{3}[\s().-]*\d{2}[\s().-]*\d{2}(?!\d)/g) || []).map(normalizePhone));
  }
  function screenProblem() {
    const title = fold(document.title);
    const headings = all('h1').map(text).join(' ');
    const body = text(document.body);
    const shortPage = body.length < 2600;
    const challenge = /just a moment|attention required|security verification|verify you are human|access denied|checking your browser/.test(title) ||
      /guvenlik dogrulamasi|erisim engellendi|robot olmadiginizi|insan oldugunuzu dogrulayin/.test(fold(headings)) ||
      (shortPage && /verify you are human|checking your browser|guvenlik kontrolunden|insan oldugunuzu dogrulayin|olagandisi erisim|erisim engellendi/.test(fold(body)));
    if (challenge) return {ok: false, kind: 'blocked', error: 'Site doğrulama veya erişim engeli gösteriyor. İşlem durduruldu; sayfayı kendiniz kontrol edin.'};
    const password = all('input[type="password"]');
    if (password.length && !all('.classifiedInfoList,table,[class*="detail-info"]').length &&
      /giris yap|uye girisi|sign in|login/.test(fold(headings + ' ' + title + ' ' + body.slice(0, 1200)))) {
      return {ok: false, kind: 'login', error: 'Site giriş yapmanızı istiyor. Girişi tarayıcıda kendiniz tamamlayın.'};
    }
    return null;
  }
  function inspect(expectedUrl) {
    if (!sourceFor()) return {ok: false, kind: 'unsupported', error: 'Bu sayfa için Hepsiemlak veya Sahibinden desteği bulunmuyor.'};
    const problem = screenProblem();
    if (problem) return problem;
    if (expectedUrl) {
      const wanted = new URL(expectedUrl);
      const actual = new URL(location.href);
      const wantedId = listingId(wanted.href);
      if (sourceFor(wanted.href) !== sourceFor(actual.href) || (wantedId && wantedId !== listingId(actual.href))) {
        return {ok: false, kind: 'mismatch', error: 'Beklenen ilan yerine farklı bir sayfa açıldı; bu sayfa arşivlenmedi.'};
      }
      if (!wantedId) {
        const relevant = ['page', 'p', 'pagingOffset'];
        // Sahibinden may represent the same result page as either a numbered
        // page or a pagingOffset. Compare logical positions when page size is
        // known, while keeping all search filters and path fixed.
        const size = Number(wanted.searchParams.get('pagingSize') || actual.searchParams.get('pagingSize'));
        const hasOffset = wanted.searchParams.has('pagingOffset') || actual.searchParams.has('pagingOffset');
        const pageNumber = params => params.has('pagingOffset') && Number.isSafeInteger(size) && size > 0
          ? Math.floor(Number(params.get('pagingOffset') || 0) / size) + 1
          : Number(params.get('page') || params.get('p') || 1);
        const samePage = hasOffset && Number.isSafeInteger(size) && size > 0
          ? pageNumber(wanted.searchParams) === pageNumber(actual.searchParams)
          : relevant.every(key => (wanted.searchParams.get(key) || '') === (actual.searchParams.get(key) || ''));
        const sameFilters = [...wanted.searchParams].filter(([key]) => !relevant.includes(key) && !/^utm_|^(?:gclid|fbclid)$/.test(key)).every(([key, value]) => actual.searchParams.getAll(key).includes(value)) &&
          [...actual.searchParams].filter(([key]) => !relevant.includes(key) && !/^utm_|^(?:gclid|fbclid)$/.test(key)).every(([key, value]) => wanted.searchParams.getAll(key).includes(value));
        if (wanted.pathname.replace(/\/$/, '') !== actual.pathname.replace(/\/$/, '') || !samePage || !sameFilters) {
          return {ok: false, kind: 'mismatch', error: 'Liste adresi veya sayfa numarası değişti. Tarama durduruldu; filtreleri kontrol edin.'};
        }
      }
    }
    return {ok: true, kind: listingId(location.href) ? 'detail' : 'list', source: sourceFor(), url: location.href};
  }
  function removalNotice() {
    const selector = 'h1,h2,h3,[role="alert"],[role="status"],.error-message,.errorMessage,.classifiedError,.classified-error,.classifiedStatus,.classified-status,[class*="status-message"],[class*="removed" i],[class*="not-found"],[class*="notFound"],[class*="alert"]';
    const patterns = [
      /\b(?:bu |aradiginiz |ilgili )?ilan(?: ilan sahibi tarafindan| sahibi tarafindan)? yayindan kaldiril(?:mistir|di)(?:[.!]|$)/,
      /\b(?:bu |aradiginiz |ilgili )?ilan(?: artik)? yayinda degil(?:dir)?(?:[.!]|$)/,
      /\bilan(?:in)?(?: yayin)? suresi dol(?:mustur|du)(?:[.!]|$)/,
      /\b(?:bu |aradiginiz |ilgili )?ilan silin(?:mistir|di)(?:[.!]|$)/,
      /\b(?:bu |aradiginiz |ilgili )?ilan pasif durumdadir(?:[.!]|$)/
    ];
    const matches = [];
    for (const el of all(selector)) {
      if (el.closest(DESCRIPTION + ',' + SELLERS + ',' + DETAIL_TITLE + ',nav')) continue;
      const value = text(el);
      if (!value || value.length > 1000) continue;
      const normalized = fold(value).replace(/\s+/g, ' ');
      if (/olabilir|muhtemel|belki|eger | ornek|ornegin|nasil |\?/.test(normalized)) continue;
      if (!patterns.some(pattern => pattern.test(normalized))) continue;
      const heading = /^H[1-3]$/.test(el.tagName);
      // A heading's enclosing notice may carry the requested visible ID.
      const parent = el.closest('[role="alert"],[role="status"],.classifiedError,.classified-error,.error-message,.errorMessage,[class*="removed" i],[class*="not-found"],[class*="notFound"]');
      const evidence = parent && text(parent).length <= 1000 ? text(parent) : value;
      const idMatch = fold(evidence).match(/ilan\s*(?:no(?:su)?|numarasi)\s*[:#：-]?\s*(\d+(?:-\d+)?)(?!\d)/);
      matches.push({text: evidence, visibleId: idMatch?.[1] || '', dedicated: !heading || Boolean(parent)});
    }
    return matches.sort((a, b) => Number(b.dedicated) - Number(a.dedicated) || Number(Boolean(b.visibleId)) - Number(Boolean(a.visibleId)));
  }
  function checkStatus({expectedUrl = location.href} = {}) {
    const checkedAt = new Date().toISOString();
    let expected, actual;
    try { expected = new URL(expectedUrl); actual = new URL(location.href); }
    catch { return {ok: false, kind: 'mismatch', error: 'Durum kontrolü için geçerli ilan adresi gerekli.'}; }
    const expectedId = listingId(expected.href), actualId = listingId(actual.href);
    const result = (status, evidence) => ({ok: true, kind: 'status', status, url: actual.href, listingId: expectedId, evidence, checkedAt});
    if (!sourceFor()) return {ok: false, kind: 'unsupported', error: 'Bu kaynak için ilan durum kontrolü desteklenmiyor.'};
    const problem = screenProblem();
    if (problem) return problem;
    if (!expectedId || sourceFor(expected.href) !== sourceFor(actual.href)) return {ok: false, kind: 'mismatch', error: 'Beklenen ilan kaynağı veya numarası doğrulanamadı.'};
    if (actualId && actualId !== expectedId) return {ok: false, kind: 'mismatch', error: 'Farklı bir ilanın sayfası açıldı; izlenen ilanın durumu değiştirilmedi.'};
    const exactDetailPath = expected.origin === actual.origin && expected.pathname.replace(/\/$/, '') === actual.pathname.replace(/\/$/, '');
    const fields = readFields({excludeDescription: true});
    const visibleId = getField(fields, ['İlan No','İlan Numarası']);
    const comparableId = value => String(value).split('-').at(-1).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const idMatches = Boolean(visibleId) && comparableId(visibleId) === comparableId(expectedId);
    const title = all('.classifiedDetailTitle h1,h1').filter(el => !el.closest(DESCRIPTION + ',' + SELLERS + ',nav')).map(text).find(Boolean) || '';
    const activeDetail = actualId === expectedId && idMatches && Boolean(title) && Object.keys(fields).length >= 2;
    const notices = removalNotice();
    // No redirect endpoint is guessed to mean removed. A redirected page must
    // visibly identify this exact listing inside the explicit removal notice.
    for (const notice of notices) {
      const noticeIdMatches = notice.visibleId && comparableId(notice.visibleId) === comparableId(expectedId);
      if (notice.visibleId && !noticeIdMatches) continue;
      if ((exactDetailPath || noticeIdMatches) && (!activeDetail || notice.dedicated)) return result('removed', notice.text);
    }
    if (visibleId && !idMatches && actualId === expectedId) return {ok: false, kind: 'mismatch', error: 'Sayfadaki ilan numarası izlenen ilanla uyuşmuyor; durum değiştirilmedi.'};
    if (notices.length) return result('unknown', 'Kaldırılma metni görüldü fakat izlenen ilanla bağlantısı veya aktif detayla çelişkisi doğrulanamadı.');
    if (activeDetail) return result('active', 'İlan No: ' + visibleId + ' — eşleşen ilan başlığı ve bilgi alanları görünür.');
    if (!exactDetailPath) return result('unknown', 'Sayfa başka bir adrese yönlendi; bu ilana ait açık kaldırılma bildirimi doğrulanamadı.');
    return result('unknown', 'Eşleşen aktif ilan detayı veya açık kaldırılma bildirimi bulunamadı. Boş sayfa ve genel hata sayfası kaldırıldı kabul edilmez.');
  }
  function readFields({excludeDescription = false} = {}) {
    const fields = {};
    const root = document.querySelector('main,.classifiedDetailContent,.classifiedDetail') || document.body;
    function put(label, value) {
      label = clean(label).replace(/[:：]\s*$/, ''); value = clean(value);
      if (!label || !value || label.length > 110 || value.length > 4000) return;
      // Tooltip copies can repeat exactly the same property name.
      const halves = label.match(/^(.+?)\s+\1$/i);
      if (halves) label = halves[1];
      if (!fields[label]) fields[label] = value;
      else if (fields[label] !== value && !fields[label].split(' | ').includes(value)) fields[label] += ' | ' + value;
    }
    for (const row of all('tr', root)) {
      if (row.closest(SELLERS) || (excludeDescription && row.closest(DESCRIPTION))) continue;
      const cells = [...row.children].filter(el => /^(TH|TD)$/.test(el.tagName) && visible(el));
      if (cells.length === 2) put(text(cells[0]), text(cells[1]));
      else for (let i = 0; i + 1 < cells.length; i += 2) put(text(cells[i]), text(cells[i + 1]));
    }
    for (const dt of all('dt', root)) {
      if (excludeDescription && dt.closest(DESCRIPTION)) continue;
      const dd = dt.nextElementSibling;
      if (dd?.tagName === 'DD') put(text(dt), text(dd));
    }
    for (const row of all('.classifiedInfoList li,.classified-info-list li,[class*="spec-item"],[class*="detail-info"] li,[class*="detail-info"] > div,[class*="specification"] > div', root)) {
      if (row.closest('table,dl') || row.closest(SELLERS) || (excludeDescription && row.closest(DESCRIPTION))) continue;
      const children = [...row.children].filter(visible);
      const label = children.find(el => /^(STRONG|LABEL|DT)$/.test(el.tagName)) || children[0];
      const values = children.filter(el => el !== label);
      if (label && values.length && children.length <= 5) put(text(label), values.map(text).join(' '));
    }
    // Hepsiemlak can render labelled rows in generic li/div containers.
    const known = /^(ilan no|ilan numarasi|son guncelleme|ilan tarihi|ilan durumu|arsa tipi|imar durumu|metrekare|metrekare birim fiyati|tapu durumu|ada\s*\/\s*parsel no|ada no|parsel no|pafta no|kaks\s*\(emsal\)|emsal|gabari|kat karsiligi|krediye uygunluk|ilgili belediye|takas|kimden|emlak tipi|marka|model|seri|yil|yakit tipi|vites|km|renk|kasa tipi|motor gucu|motor hacmi|arac durumu|oda sayisi)$/;
    for (const row of all('li,[class*="spec"],[class*="detail-info"]', root)) {
      if (row.closest('table,dl') || row.closest(SELLERS) || (excludeDescription && row.closest(DESCRIPTION))) continue;
      const children = [...row.children].filter(visible);
      if (children.length === 2 && known.test(fold(text(children[0])))) put(text(children[0]), text(children[1]));
    }
    return fields;
  }
  function getField(fields, labels) {
    for (const label of labels) {
      const key = Object.keys(fields).find(k => fold(k) === fold(label));
      if (key) return fields[key];
    }
    return '';
  }
  function breadcrumbTexts() {
    const roots = all('[class*="breadcrumb"],[class*="Breadcrumb"],[aria-label*="breadcrumb" i],[aria-label*="kategori" i],#breadCrumb');
    return unique(roots.flatMap(root => {
      const children = all('a,li,[itemprop="name"]', root).filter(el => !el.querySelector('a,li,[itemprop="name"]'));
      return (children.length ? children : [root]).map(text).filter(x => x.length < 240);
    }));
  }
  function categoriesForLabel(value) {
    const s = fold(value).replace(/[_/\-]+/g, ' ');
    if (OTHER_LABELS.includes(s.replace(/[,&]/g, ' ').replace(/\s+/g, ' '))) return ['diger'];
    if (/\b(arsa|tarla|bag|bahce|zeytinlik|orman|imarli konut|imarli ticari|imarli sanayi|imarli villa|konutticaret|turistik arsa|depo antrepo izinli)\b/.test(s)) return ['arsa'];
    if (/\b(vasita|otomobil|arac|arazi suv|motosiklet|minibus|kamyon|kamyonet|otobus|traktor|ticari arac)\b/.test(s)) return ['arac'];
    if (/\b(isyeri|is yeri|dukkan|ofis|buro|magaza|fabrika|atolye|depo|akaryakit istasyonu|plaza)\b/.test(s)) return ['isyeri'];
    if (/\b(konut|daire|villa|mustakil ev|rezidans|residence|yazlik|ciftlik evi)\b/.test(s)) return ['konut'];
    return [];
  }
  function categoryEvidence(fields) {
    const evidence = [];
    function add(category, source, value) { evidence.push({category, source, text: clean(value).slice(0, 400)}); }
    // URL taxonomy segments are useful; the free-form listing title slug is not.
    const path = decodeURIComponent(location.pathname).toLowerCase();
    const otherTaxonomy = sourceFor() === 'sahibinden' ? OTHER_TAXONOMIES.find(prefix => path.startsWith('/ilan/' + prefix + '-')) : '';
    const crumbs = breadcrumbTexts();
    const hasOtherRoot = Boolean(otherTaxonomy) || crumbs.some(crumb => categoriesForLabel(crumb).includes('diger'));
    if (sourceFor() === 'sahibinden') {
      if (/^\/ilan\/emlak-arsa-/.test(path) || /^\/(?:satilik|kiralik)-arsa(?:\/|$)/.test(path)) add('arsa', 'url', path);
      else if (/^\/ilan\/vasita-/.test(path)) add('arac', 'url', path);
      else if (/^\/ilan\/emlak-(?:is-yeri|isyeri)-/.test(path)) add('isyeri', 'url', path);
      else if (/^\/ilan\/emlak-konut-/.test(path)) add('konut', 'url', path);
      else if (otherTaxonomy) add('diger', 'url', otherTaxonomy);
    } else {
      const segments = path.split('/').filter(Boolean);
      const subtype = segments.length >= 3 ? segments.at(-2) : '';
      for (const c of categoriesForLabel(subtype)) add(c, 'url', subtype);
    }
    for (const crumb of crumbs) {
      // Ignore broad concatenated ancestor containers; individual breadcrumb labels suffice.
      if (crumb.length > 65 || crumb.includes('\n')) continue;
      for (const c of categoriesForLabel(crumb)) {
        // Product subcategories such as Bahçe/Ofis or Araç Aksesuarları do
        // not change a recognized shopping/services top-level category.
        if (!hasOtherRoot || c === 'diger') add(c, 'breadcrumb', crumb);
      }
    }
    for (const [label, value] of Object.entries(fields)) {
      const key = fold(label);
      if (/^(arsa tipi|imar durumu)$/.test(key)) add('arsa', 'field', label + ': ' + value);
      if (/^(konut tipi)$/.test(key)) add('konut', 'field', label + ': ' + value);
      if (/^(emlak tipi|kategori|ilan kategorisi|gayrimenkul tipi)$/.test(key)) for (const c of categoriesForLabel(value)) add(c, 'field', label + ': ' + value);
    }
    if (!hasOtherRoot && getField(fields, ['Marka']) && getField(fields, ['Yakıt Tipi','Vites','KM','Kilometre','Kasa Tipi','Araç Durumu','Motor Hacmi'])) add('arac', 'field', 'Marka ve araca özgü teknik alanlar mevcut');
    return evidence.filter((item, i, list) => list.findIndex(x => x.category === item.category && x.source === item.source && x.text === item.text) === i);
  }
  function readPrice(fields) {
    let candidates = [getField(fields, ['Fiyat', 'Satış Fiyatı'])].filter(Boolean);
    for (const selector of ['.classifiedInfo > h3','.classifiedInfo h3','.classified-price','[itemprop="price"]','[class*="price"]','[class*="Price"]']) {
      for (const el of all(selector)) {
        if (el.closest('table,dl') || el.closest(SELLERS) || /unit|per-square|m2|square-meter/i.test(el.className)) continue;
        const value = text(el);
        if (value.length < 100 && !/\/\s*m[²2]|birim|m[²2]\s*fiyat/i.test(value)) candidates.push(value);
      }
    }
    const h1 = all('h1')[0];
    let parent = h1?.parentElement;
    for (let i = 0; i < 3 && parent && !parent.matches('body,main'); i++, parent = parent.parentElement) {
      if (parent.querySelector('table,dl,.classifiedInfoList') || text(parent).length > 800) break;
      const matches = text(parent).match(/\d[\d., ]*\s*(?:TL|₺|EUR|USD|€|\$|GBP|£)/g) || [];
      candidates.push(...matches);
    }
    candidates = unique(candidates);
    const raw = candidates.find(v => /(?:TL|₺|EUR|USD|€|\$|GBP|£)/i.test(v)) || candidates.find(v => /^\s*[\d., ]+\s*$/.test(v)) || '';
    const currency = /€|EUR/i.test(raw) ? 'EUR' : /\$|USD/i.test(raw) ? 'USD' : /£|GBP/i.test(raw) ? 'GBP' : /TL|₺/i.test(raw) ? 'TRY' : '';
    return {price: raw ? parseNumber(raw) : null, currency, originalPrice: raw};
  }
  function readLocation(fields) {
    const city = getField(fields, ['İl', 'Şehir']);
    const district = getField(fields, ['İlçe']);
    const neighborhood = getField(fields, ['Mahalle', 'Semt / Mahalle']);
    const selectors = ['.classifiedInfo h2','.classified-location','[class*="location"]','[class*="Location"]','[itemprop="address"]'];
    let parts = [];
    for (const selector of selectors) {
      for (const root of all(selector)) {
        if (root.closest(SELLERS)) continue;
        const anchors = all('a', root).map(text).filter(x => x && x.length < 80);
        if (anchors.length >= 2 && anchors.length <= 4) { parts = anchors; break; }
        const value = text(root);
        if (value.length < 180 && /\s[/>|]\s|\n/.test(value)) {
          const candidate = value.split(/\s*[/>|\n]\s*/).map(clean).filter(Boolean);
          if (candidate.length >= 2 && candidate.length <= 4) { parts = candidate; break; }
        }
      }
      if (parts.length) break;
    }
    return {city: city || parts[0] || '', district: district || parts[1] || '', neighborhood: neighborhood || parts[2] || ''};
  }
  function readDescription() {
    const descriptions = [];
    for (const selector of ['#classifiedDescription','.classifiedDescription','#ilanAciklamasi','#description','#description-section','[class*="description-content"]','[class*="descriptionContent"]','[itemprop="description"]']) {
      descriptions.push(...all(selector).map(text));
    }
    if (!descriptions.some(Boolean)) {
      for (const heading of all('h2,h3,h4')) {
        if (!/^ilan aciklamasi$/.test(fold(text(heading)))) continue;
        const parts = [];
        for (let sibling = heading.nextElementSibling; sibling && !/^H[1-4]$/.test(sibling.tagName); sibling = sibling.nextElementSibling) {
          if (allowed(sibling)) parts.push(text(sibling));
        }
        descriptions.push(parts.join('\n'));
      }
    }
    return unique(descriptions).sort((a, b) => b.length - a.length)[0] || '';
  }
  async function revealDescription() {
    if (readDescription()) return;
    const tabs = all('button,[role="tab"],a[href^="#"]').filter(el => /^ilan aciklamasi$/.test(fold(text(el))));
    if (!tabs.length) return;
    tabs[0].click();
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  function readFeatures() {
    const features = [];
    const groups = all('#classifiedProperties,.classifiedProperties,[class*="features"],[class*="Features"],[class*="property-features"]');
    for (const group of groups) {
      const selected = all('li.selected,li.checked,li.active,li:has(input:checked),[aria-checked="true"]', group);
      features.push(...selected.map(text));
    }
    for (const heading of all('h2,h3,h4')) {
      if (!/^(altyapi|manzara|ulasim|genel ozellikler|ic ozellikler|dis ozellikler|guvenlik|ic donanim|dis donanim|multimedya)$/.test(fold(text(heading)))) continue;
      const container = heading.nextElementSibling;
      if (!container || !allowed(container)) continue;
      // In checkbox-style lists only explicit selected items are facts.
      const items = all('li', container);
      const checkboxList = items.some(el => el.matches('.selected,.checked,.active,.disabled,.unselected') || el.querySelector('input[type="checkbox"]') || el.hasAttribute('aria-checked'));
      const accepted = checkboxList ? items.filter(el => el.matches('.selected,.checked,.active,[aria-checked="true"]') || el.querySelector('input:checked')) : items;
      features.push(...accepted.map(el => text(heading) + ': ' + text(el)));
    }
    return unique(features).filter(x => x.length < 600);
  }
  function sellerRoots(scope) {
    const roots = scope?.isConnected && allowed(scope) ? [scope] : all(SELLERS).filter(el => text(el).length < 5000);
    if (!scope) roots.push(...all('.username,.user-name,.store-name,.classifiedUserName,.classified-user-name').filter(el => el.closest('aside')));
    return unique(roots).filter(el => !el.closest('footer,header,nav,' + DESCRIPTION) && !/destek|musteri hizmetleri|customer support/.test(fold(el.id + ' ' + el.className))).sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.x - ra.x || ra.y - rb.y;
    });
  }
  function decodeCSSString(value) {
    // CSS escapes are text, never JavaScript. Hex escapes consume at most one
    // following whitespace character; escaped line breaks render no character.
    return value.replace(/\\(?:\r\n|[\n\r\f])/g, '').replace(/\\([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?|\\([^\n\r\f])/gi, (_, hex, literal) => {
      if (!hex) return literal || '';
      const code = parseInt(hex, 16);
      return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
    });
  }
  function cssContentText(value, el) {
    const css = String(value || '').trim();
    if (!css || /^(none|normal)$/i.test(css) || css.length > 1500) return '';
    let offset = 0, result = '';
    while (offset < css.length) {
      if (/\s/.test(css[offset])) { offset++; continue; }
      if (css[offset] === '/') break; // Accessibility alternative is not painted text.
      if (css[offset] === '"' || css[offset] === "'") {
        const quote = css[offset++];
        let raw = '', closed = false;
        while (offset < css.length) {
          const char = css[offset++];
          if (char === quote) { closed = true; break; }
          if (char === '\\' && offset < css.length) raw += char + css[offset++];
          else raw += char;
        }
        if (!closed) return '';
        result += decodeCSSString(raw);
        continue;
      }
      const attr = css.slice(offset).match(/^attr\(\s*([-_a-z][-_a-z0-9]*)\s*(?:,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))?\s*\)/i);
      if (!attr) return ''; // Images, counters and unsupported CSS are not text.
      // Only this visible pseudo-element's explicit attr() reference is read;
      // unrelated title/data/JSON attributes are never searched for values.
      const displayed = el.getAttribute(attr[1]);
      result += displayed !== null ? displayed : attr[2] ? decodeCSSString(attr[2].slice(1, -1)) : '';
      offset += attr[0].length;
    }
    return result;
  }
  function transparentColor(value) {
    const color = String(value || '').replace(/\s+/g, '').toLowerCase();
    return color === 'transparent' || /^rgba\([^,]+,[^,]+,[^,]+,0(?:\.0+)?\)$/.test(color) || /\/0(?:\.0+)?%?\)$/.test(color);
  }
  function opaqueAncestors(el) {
    for (let node = el; node; node = node.parentElement) if (getComputedStyle(node).opacity === '0') return false;
    return true;
  }
  function textIsPainted(style) {
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0' &&
      style.fontSize !== '0px' && !transparentColor(style.color) && !transparentColor(style.webkitTextFillColor);
  }
  function paintedPseudoText(el, pseudo) {
    let style;
    try { style = getComputedStyle(el, pseudo); } catch { return ''; }
    return style && textIsPainted(style) ? cssContentText(style.content, el) : '';
  }
  function renderedNameText(el) {
    if (!allowed(el) || !opaqueAncestors(el) || el.matches('script,style,template,input,textarea,select,button')) return '';
    const ownStyle = getComputedStyle(el);
    let value = paintedPseudoText(el, '::before');
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { if (textIsPainted(ownStyle)) value += child.nodeValue; }
      else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.tagName === 'BR' && allowed(child)) value += ' ';
        else value += renderedNameText(child);
      }
    }
    return value + paintedPseudoText(el, '::after');
  }
  function validSellerName(value) {
    const name = clean(value), key = fold(name);
    if (!name || name.length > 160 || (name.match(/\p{L}/gu) || []).length < 2 || phoneNumbers(name).length) return false;
    // Masked/initially hidden attributes are not used to reconstruct a name.
    if (/[*＊•●◦]|\.{3}|…|[\uE000-\uF8FF\uFFFD]/u.test(name)) return false;
    if (/telefon|iletisim|giris yap|mesaj gonder|uyelik|uye ol|hesabim|tum ilanlari|diger ilanlari|favori|sikayet|guvenlik/.test(key)) return false;
    if (/^(satici bilgileri|satici|ilan sahibi|sahibinden ilan|magaza|kurumsal uye|bireysel uye|danisman bilgileri|kullanici bilgileri|uye profili)$/.test(key)) return false;
    return true;
  }
  function readSellerName(roots) {
    const selectors = ['.username-info-area h5,.username-info-area h4',
      '.store-name,.username,.user-name,.userName,.classified-user-name,.classifiedUserName,.seller-name,.sellerName,.owner-name,.ownerName,[data-testid="seller-name"],[data-testid="user-name"]',
      '[itemprop="name"]','h2,h3,h4,h5','.username-info-area'];
    for (const root of roots) {
      for (const selector of selectors) {
        const candidates = (root.matches(selector) ? [root] : []).concat(all(selector, root));
        for (const candidate of unique(candidates)) {
          if (!allowed(candidate) || candidate.closest(DESCRIPTION + ',nav,footer')) continue;
          // An area made only of inline name fragments is supported; controls
          // and member metadata are not folded into a guessed full name.
          const areaFallback = selector === '.username-info-area';
          if (areaFallback && [...candidate.querySelectorAll('*')].some(el => !/^(SPAN|A|B|I|EM|STRONG|U|BR)$/.test(el.tagName))) continue;
          if (areaFallback && candidate.querySelector('a[href^="tel:"],[class*="member"],[class*="membership"],[class*="register"]')) continue;
          const name = clean(renderedNameText(candidate));
          if (areaFallback && /hesap acma|hesap olusturma|kayit tarihi|katilim tarihi|uye oldugu|uyelik|son gorulme|dogrulanmis/.test(fold(name))) continue;
          if (validSellerName(name)) return name;
        }
      }
    }
    return '';
  }
  function contactScope(button) {
    const known = button.closest(SELLERS);
    if (known && text(known).length < 5000) return known;
    let fallback = button.parentElement;
    for (let node = button.parentElement, i = 0; node && i < 7; node = node.parentElement, i++) {
      if (/^(BODY|MAIN|HTML)$/.test(node.tagName) || text(node).length > 3500 || node.querySelector('table,.classifiedInfoList')) break;
      if (/sahibinden ilan|emlak ofisi|danisman|ilan sahibi/.test(fold(text(node))) && node.querySelector('h2,h3,h4,h5')) return node;
      if (node.matches('aside,[class*="contact"],[class*="user"]')) fallback = node;
    }
    return fallback;
  }
  function renderedPhoneNumbers(root) {
    const regions = (root.matches(PHONE_REGIONS) ? [root] : []).concat(all(PHONE_REGIONS, root));
    const elements = unique(regions.flatMap(region => [region, ...all('*', region)]));
    const values = [];
    for (const el of elements) {
      if (!allowed(el) || !opaqueAncestors(el) || el.closest(DESCRIPTION + ',nav,footer') || el.matches('script,style,template,input,textarea,select,button')) continue;
      for (const pseudo of ['::before', '::after']) {
        const displayed = paintedPseudoText(el, pseudo);
        // Treat each painted value independently. Masked alternatives or
        // partial fragments must never be joined into an invented number.
        if (!displayed || /[*＊•●◦…]|\.{3}|[xX]/.test(displayed)) continue;
        values.push(...phoneNumbers(displayed));
      }
    }
    return unique(values);
  }
  function readContact(scope, dialogs = false, originalDialogs = []) {
    const roots = sellerRoots(scope);
    if (dialogs) {
      for (const dialog of all('[role="dialog"],dialog[open]')) {
        if (!originalDialogs.includes(dialog) && /telefon|iletisim/.test(fold(text(dialog))) && text(dialog).length < 2500) roots.push(dialog);
      }
    }
    const numbers = [];
    for (const root of roots) {
      // DOM text plus actually painted CSS text in the seller's phone region.
      // Masked hrefs, hidden inputs, JSON and unused data attributes stay out.
      numbers.push(...phoneNumbers(text(root)));
      numbers.push(...renderedPhoneNumbers(root));
    }
    return {phones: unique(numbers), sellerName: readSellerName(roots)};
  }
  async function contact(revealPhone) {
    let result = readContact(null);
    if (result.phones.length) return {...result, phoneStatus: 'Görünür numara alındı'};
    // The full-number region can appear before its CSS attr() value arrives.
    // Wait briefly for that existing visible region; do not reload or click it.
    const pendingRegion = sellerRoots(null).some(root => all('.pretty-phone-part.show-part', root).length > 0);
    if (pendingRegion) {
      const until = Date.now() + 1200;
      while (Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 150));
        const problem = screenProblem();
        if (problem) throw Object.assign(new Error(problem.error), {kind: problem.kind});
        const latest = readContact(null);
        result = {...latest, sellerName: latest.sellerName || result.sellerName};
        if (result.phones.length) return {...result, phoneStatus: 'Görünür numara yüklenince alındı'};
      }
    }
    if (!revealPhone) return {...result, phoneStatus: 'Telefon açma kapalı; görünür numara bulunamadı'};
    const candidates = all('button,a,[role="button"],span,div').filter(el => {
      if (!/^telefon(?:u| numarasini)?\s+goster$/.test(fold(text(el)))) return false;
      if (el.querySelector('button,a,[role="button"]')) return false;
      if (/^(tel:|sms:|https?:\/\/(?:wa\.me|api\.whatsapp))/i.test(el.getAttribute('href') || '')) return false;
      return !el.closest('nav,header,footer');
    }).sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.x - ra.x || ra.y - rb.y;
    });
    if (!candidates.length) return {...result, phoneStatus: 'Görünür telefon düğmesi bulunamadı'};
    const button = candidates[0];
    const scope = contactScope(button);
    const scoped = readContact(scope);
    result = {...scoped, sellerName: scoped.sellerName || result.sellerName};
    const existingDialogs = all('[role="dialog"],dialog[open]');
    button.click();
    const stop = Date.now() + 6000;
    while (Date.now() < stop) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const problem = screenProblem();
      if (problem) throw Object.assign(new Error(problem.error), {kind: problem.kind});
      const latest = readContact(scope, true, existingDialogs);
      if (latest.phones.length) return {...latest, sellerName: latest.sellerName || result.sellerName, phoneStatus: 'Telefonu Göster düğmesiyle alındı'};
      if (!result.sellerName && latest.sellerName) result.sellerName = latest.sellerName;
    }
    return {...result, phoneStatus: 'Düğmeye basıldı; numara açılmadı veya ek giriş/doğrulama gerekiyor'};
  }
  function listingImages(title) {
    const roots = all('.classifiedDetailMainPhoto,.classifiedDetailPhotos,.classifiedDetailPhoto,.gallery,[class*="gallery"],[class*="Gallery"],[class*="photo-gallery"]');
    const images = roots.flatMap(root => all('img', root));
    if (!images.length && sourceFor() === 'hepsiemlak') images.push(...all('img').filter(img => fold(img.alt) === fold(title) && title));
    return unique(images.map(img => img.currentSrc || img.src).filter(url => /^https?:\/\//i.test(url))).slice(0, 80);
  }
  async function extractListing({revealPhone = false, expectedUrl} = {}) {
    const info = inspect(expectedUrl);
    if (!info.ok) return info;
    if (info.kind !== 'detail') return {ok: false, kind: 'mismatch', error: 'Bu sayfa ilan detayı değil.'};
    const fields = readFields();
    const title = firstText(['.classifiedDetailTitle h1','h1']);
    if (!title || !Object.keys(fields).length) return {ok: false, kind: 'incomplete', error: 'İlan başlığı veya bilgi tablosu okunamadı. Sayfa henüz yüklenmemiş veya yapısı değişmiş olabilir.'};
    // Snapshot facts before clicking a tab or contact control: either can hide
    // the original detail panel. Only the description needs its own tab.
    const evidence = categoryEvidence(fields);
    const categoryPath = breadcrumbTexts();
    const price = readPrice(fields);
    const initialLocation = readLocation(fields);
    const initialImages = listingImages(title);
    const initialFeatures = readFeatures();
    const initialDescription = readDescription();
    const actualId = getField(fields, ['İlan No','İlan no','İlan Numarası']) || listingId(location.href);
    const idDigits = value => String(value).split('-').at(-1).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (idDigits(actualId) !== idDigits(listingId(location.href))) {
      return {ok: false, kind: 'mismatch', error: 'Sayfadaki ilan numarası adresle uyuşmuyor; kayıt yapılmadı.'};
    }
    const contactResult = await contact(revealPhone);
    await revealDescription();
    const description = readDescription() || initialDescription;
    // Extra fields in the second panel are retained, without overwriting the
    // directly observed values from the original information panel.
    for (const [label, value] of Object.entries(readFields())) if (!fields[label]) fields[label] = value;
    for (const item of categoryEvidence(fields)) {
      if (!evidence.some(old => old.category === item.category && old.source === item.source && old.text === item.text)) evidence.push(item);
    }
    const categories = unique(evidence.map(item => item.category));
    const afterLocation = readLocation(fields);
    const capturedLocation = Object.fromEntries(Object.keys(initialLocation).map(key => [key, initialLocation[key] || afterLocation[key]]));
    const warnings = [];
    if (!contactResult.phones.length) warnings.push(contactResult.phoneStatus);
    if (categories.length > 1) warnings.push('Kategori kanıtları birbiriyle çelişiyor; elle kontrol gerekli.');
    const record = {
      source: sourceFor(), url: canonicalListing(location.href), listingId: actualId,
      title, ...price,
      area: parseNumber(getField(fields, ['Metrekare','m²','m2','m² (Brüt)','Brüt m²','Arsa Alanı'])),
      location: capturedLocation, sellerName: contactResult.sellerName,
      phones: contactResult.phones, description, images: unique([...initialImages, ...listingImages(title)]),
      rawDetails: fields, features: unique([...initialFeatures, ...readFeatures()]), capturedAt: new Date().toISOString(),
      category: categories.length === 1 ? categories[0] : 'belirsiz', categoryEvidence: evidence,
      categoryPath,
      phoneStatus: contactResult.phoneStatus, warnings, missing: []
    };
    if (price.price === null) record.missing.push('Fiyat');
    if (!description) record.missing.push('Açıklama');
    if (!record.phones.length) record.missing.push('Telefon');
    return {ok: true, kind: 'detail', record};
  }
  function pageNumber(url, inferredSize) {
    const u = new URL(url, location.href);
    const p = u.searchParams.get('page') || u.searchParams.get('p');
    if (p && /^\d+$/.test(p)) return Number(p);
    const offset = u.searchParams.get('pagingOffset');
    const size = Number(u.searchParams.get('pagingSize')) || inferredSize || 20;
    return offset && /^\d+$/.test(offset) ? Math.floor(Number(offset) / size) + 1 : 1;
  }
  function nextListUrl(anchor) {
    const raw = anchor.getAttribute('href') || anchor.getAttribute('data-href') || anchor.getAttribute('data-url');
    if (!raw || raw === '#' || /^javascript:/i.test(raw)) return '';
    try {
      const target = new URL(raw, location.href), current = new URL(location.href);
      if (target.origin !== current.origin || listingId(target.href)) return '';
      if (target.pathname !== current.pathname) return '';
      // Relative paging links sometimes omit the existing search filters.
      for (const key of new Set(current.searchParams.keys())) {
        if (['page','p','pagingOffset'].includes(key)) continue;
        const values = current.searchParams.getAll(key);
        if (!target.searchParams.has(key)) values.forEach(value => target.searchParams.append(key, value));
        else if (JSON.stringify([...target.searchParams.getAll(key)].sort()) !== JSON.stringify([...values].sort())) return '';
      }
      target.hash = '';
      return target.href;
    } catch { return ''; }
  }
  function listPageText(root) {
    // Parent innerText can include recommendations; inspect visible text nodes
    // so their counts/empty messages cannot terminate the actual result list.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) if (allowed(walker.currentNode.parentElement)) parts.push(walker.currentNode.nodeValue);
    return clean(parts.join(' '));
  }
  function resultTotal(root) {
    const summaries = all('.searchResultsTitle,.searchResultsTitleValue,.search-results-title,.result-text,[class*="result-count" i],[class*="resultCount"],[class*="list-count" i],[class*="listing-count" i]');
    const parse = (value, dedicated) => {
      const normalized = fold(value);
      const count = '([\\d.,\\u00a0 ]+?)';
      const matches = normalized.match(new RegExp(count + '\\s+(?:adet\\s+)?ilan\\s+(?:bulundu|listelen|mevcut|icerisinden)')) ||
        normalized.match(new RegExp('toplam\\s*:?\\s*' + count + '\\s+(?:adet\\s+)?(?:ilan|sonuc)')) ||
        (dedicated && normalized.match(new RegExp(count + '\\s+(?:adet\\s+)?(?:ilan|sonuc)\\b')));
      const number = matches ? Number(matches[1].replace(/\D/g, '')) : null;
      return Number.isSafeInteger(number) && number >= 0 ? number : null;
    };
    for (const summary of summaries) {
      const total = parse(listPageText(summary), true);
      if (total !== null) return total;
    }
    // The search summary is often a sibling of the results table, not inside it.
    return parse(listPageText(root === document.body ? root : document.body), false);
  }
  function pagingSize(anchors, count, expectedTotal) {
    const current = new URL(location.href);
    const positive = value => /^\d+$/.test(String(value || '')) && Number(value) > 0 && Number(value) <= 1000 ? Number(value) : null;
    const configured = positive(current.searchParams.get('pagingSize'));
    if (configured) return {value: configured, evidence: 'url'};
    const candidates = [];
    for (const anchor of anchors) {
      const url = nextListUrl(anchor);
      if (!url) continue;
      const target = new URL(url);
      const size = positive(target.searchParams.get('pagingSize'));
      if (size) candidates.push(size);
      const label = Number(text(anchor));
      const offset = Number(target.searchParams.get('pagingOffset'));
      if (Number.isInteger(label) && label > 1 && offset > 0 && Number.isInteger(offset / (label - 1))) candidates.push(offset / (label - 1));
      const nextLabel = fold(text(anchor) + ' ' + (anchor.getAttribute('rel') || '') + ' ' + (anchor.getAttribute('aria-label') || '') + ' ' + (anchor.getAttribute('title') || '') + ' ' + anchor.className);
      const increment = offset - Number(current.searchParams.get('pagingOffset') || 0);
      if (/sonraki|next|ileri/.test(nextLabel) && increment > 0) candidates.push(increment);
    }
    const sizes = unique(candidates).filter(value => value > 0 && value <= 1000);
    if (sizes.length === 1) return {value: sizes[0], evidence: 'pager'};
    for (const control of all('select[name="pagingSize"],select#pagingSize,[data-paging-size][aria-selected="true"],.pageSize .selected,.pagingSize .selected')) {
      const size = positive(control.value || control.getAttribute('data-paging-size') || text(control));
      if (size) return {value: size, evidence: 'selected-size'};
    }
    // Only a full, customary page supplies a useful count-based size. A partly
    // hydrated list or a short final page must not change the offset increment.
    if ([20,24,30,50,100].includes(count) && (expectedTotal === null || expectedTotal >= count)) return {value: count, evidence: 'visible-results'};
    return {value: null, evidence: null};
  }
  function generatedListUrl(pageSize, currentPage, parameter) {
    if (!pageSize) return '';
    const target = new URL(location.href);
    if (sourceFor() === 'sahibinden') {
      const offset = Number(target.searchParams.get('pagingOffset') || 0);
      if (!Number.isSafeInteger(offset) || offset < 0) return '';
      target.searchParams.set('pagingOffset', String(offset + pageSize));
      target.searchParams.set('pagingSize', String(pageSize));
      target.searchParams.delete('page'); target.searchParams.delete('p');
    } else if (sourceFor() === 'hepsiemlak' && parameter) {
      target.searchParams.set(parameter, String(currentPage + 1));
    } else return '';
    target.hash = '';
    return target.href;
  }
  const currencyOf = raw => /€|EUR/i.test(raw) ? 'EUR' : /\$|USD/i.test(raw) ? 'USD' : /£|GBP/i.test(raw) ? 'GBP' : /TL|₺/i.test(raw) ? 'TRY' : '';
  // Price shown on each search-result row. A row is used only when it holds exactly one
  // listing, and only a value with a currency mark counts, so m² or area numbers are never taken.
  function listRows(root) {
    const rows = new Map();
    for (const anchor of all('a[href]', root)) {
      const url = canonicalListing(anchor.href);
      if (!url || rows.has(url)) continue;
      const row = anchor.closest('tr,li,article,[class*="listing-item" i],[class*="searchResultsItem" i],[class*="list-item" i],[class*="card" i]');
      if (!row || row === root || unique([...row.querySelectorAll('a[href]')].map(el => canonicalListing(el.href))).length !== 1) continue;
      const candidates = [...row.querySelectorAll('[class*="price" i],[class*="Price"]')]
        .filter(el => !/unit|per-square|m2|square/i.test(el.className)).map(text).filter(v => v && v.length < 60 && !/\/\s*m[²2]/i.test(v));
      candidates.push(...(text(row).match(/\d[\d., ]*\s*(?:TL|₺|EUR|USD|€|\$|GBP|£)/g) || []));
      const raw = candidates.find(v => currencyOf(v));
      const price = raw ? parseNumber(raw) : null;
      if (price !== null && price > 0) rows.set(url, {url, price, currency: currencyOf(raw)});
    }
    return [...rows.values()];
  }
  function discoverList({expectedUrl} = {}) {
    const info = inspect(expectedUrl);
    if (!info.ok) return info;
    if (info.kind !== 'list') return {ok: false, kind: 'mismatch', error: 'Bu sayfa arama sonuç listesi değil.'};
    const root = document.querySelector('#searchResultsTable,.listing-container,.list-view') || document.querySelector('main') || document.body;
    const links = unique(all('a[href]', root).map(el => canonicalListing(el.href)));
    const pagers = all('[class*="pagination" i],[class*="paging" i],.pageNaviButtons,.page-navigation,[aria-label*="sayfa" i],[aria-label*="pagination" i]');
    const anchors = unique([...all('a[rel="next"],a[rel="last"]'), ...pagers.flatMap(pager => all('a[href],[data-href],[data-url]', pager))]);
    const expectedTotal = resultTotal(root);
    const size = pagingSize(anchors, links.length, expectedTotal), pageSize = size.value;
    const currentPage = pageNumber(location.href, pageSize);
    const numbered = anchors.map(anchor => ({anchor, number: Number(text(anchor)), url: nextListUrl(anchor)})).filter(x => Number.isInteger(x.number) && x.number > 0 && x.url);
    let nextUrl = '';
    const disabled = el => Boolean(el.closest('[disabled],[aria-disabled="true"],.disabled,.inactive')) || /(?:^|\s)(?:disabled|inactive)(?:\s|$)/i.test(el.className);
    const isNext = el => {
      const label = fold(text(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('rel') || '') + ' ' + el.className);
      return /sonraki|next|ileri/.test(label);
    };
    const controls = unique([...all('a[rel="next"]'), ...pagers.flatMap(p => all('a,button,li,[role="button"]', p))]);
    const next = controls.find(el => isNext(el) && !disabled(el) && (el.matches('a,button,[role="button"]') || !el.querySelector('a,button,[role="button"]')));
    if (next) nextUrl = nextListUrl(next);
    if (!nextUrl) nextUrl = numbered.find(x => x.number === currentPage + 1)?.url || '';
    if (nextUrl && pageNumber(nextUrl, pageSize) <= currentPage) nextUrl = '';
    const hasActualNext = Boolean(next || numbered.some(x => x.number === currentPage + 1));
    const body = listPageText(document.body);
    const empty = /(?:ilan|sonuc)\s+bulunamadi|kriterlerinize uygun ilan bulunmamaktadir/.test(fold(body));
    const disabledNext = controls.some(el => isNext(el) && disabled(el));
    const totalPages = pageSize !== null && expectedTotal !== null ? Math.max(1, Math.ceil(expectedTotal / pageSize)) : null;
    const lastAnchor = anchors.find(el => el.getAttribute('rel') === 'last' || /^(son|son sayfa|last|last page)$/.test(fold(text(el) || el.getAttribute('aria-label') || el.getAttribute('title'))));
    const explicitLastUrl = lastAnchor ? nextListUrl(lastAnchor) : '';
    const explicitLastNumber = explicitLastUrl ? pageNumber(explicitLastUrl, pageSize) : null;
    // A sliding pager's highest visible number is not its global last page.
    const lastPage = totalPages ?? explicitLastNumber ?? (disabledNext && !hasActualNext ? currentPage : null);
    const contradictsTotal = totalPages !== null && currentPage < totalPages;
    let strategy = nextUrl ? 'link' : 'none';
    const nextRaw = next && (next.getAttribute('href') || next.getAttribute('data-href') || next.getAttribute('data-url'));
    const unsafeTarget = nextRaw && nextRaw !== '#' && !/^javascript:/i.test(nextRaw) && !nextListUrl(next);
    const current = new URL(location.href);
    const pageParameter = ['page','p'].find(key => current.searchParams.has(key) || numbered.some(item => new URL(item.url).searchParams.has(key)));
    if (!nextUrl && links.length && !unsafeTarget && (hasActualNext || contradictsTotal)) {
      nextUrl = generatedListUrl(pageSize, currentPage, pageParameter);
      if (nextUrl) strategy = sourceFor() === 'sahibinden' ? 'generated-offset' : 'generated-page';
    }
    // Carry a proven Sahibinden page size so a short final page cannot be
    // misread using the historical default of 20 results.
    if (nextUrl && sourceFor() === 'sahibinden' && pageSize) {
      const target = new URL(nextUrl);
      if (!target.searchParams.has('pagingSize')) target.searchParams.set('pagingSize', String(pageSize));
      nextUrl = target.href;
    }
    const explicitLast = (disabledNext && !contradictsTotal) || (lastPage === currentPage && !hasActualNext) || (expectedTotal !== null && expectedTotal <= links.length && currentPage === 1);
    const complete = !nextUrl && !hasActualNext && ((explicitLast && (links.length > 0 || expectedTotal === 0)) || (empty && !contradictsTotal));
    let reason = nextUrl ? (strategy === 'link' ? 'Sonraki sayfa bağlantısı bulundu.' : 'Sayfa boyutu ve ilerleme işareti doğrulandı; filtreler korunarak sonraki sayfa adresi oluşturuldu.') : complete ? 'Görünür son sayfa veya boş sonuç bilgisi bulundu.' : 'Sonraki sayfa bağlantısı doğrulanamadı; tarama tam kabul edilmedi.';
    if (unsafeTarget && !nextUrl) reason = 'Sonraki sayfa bağlantısı arama filtrelerini değiştiriyor; tarama durduruldu.';
    else if (next && !nextUrl && !complete) reason = 'Sonraki sayfa kontrolü var fakat sayfa boyutu veya filtreleri koruyan adres doğrulanamadı; tarama tamamlanmış sayılmadı.';
    else if (!nextUrl && disabledNext && contradictsTotal) reason = 'Sonraki sayfa kapalı görünüyor fakat ilan toplamı daha fazla sayfa gerektiriyor; tarama tamamlanmış sayılmadı.';
    return {ok: true, kind: 'list', source: sourceFor(), url: location.href, links, rows: listRows(root),
      nextUrl: nextUrl || null, pagination: {currentPage, lastPage, expectedTotal, pageSize, pageSizeEvidence: size.evidence, strategy, inPageCount: links.length, hasActualNext, complete, reason}};
  }
  globalThis.IlanExtractor = Object.freeze({inspect, checkStatus, extractListing, discoverList, parseNumber, normalizePhone, categoryEvidence});
})();
