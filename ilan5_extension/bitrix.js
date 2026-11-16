/* Bitrix24 aktarımı: seçilen ilanlar, kullanıcının n8n akışına (Webhook) gönderilir.
   Bitrix webhook adresi ve anahtarı eklentiye hiç girmez; yalnız n8n akışının adresi saklanır.
   Satırlar, mevcut Google Sheets akışlarının beklediği sütun adlarıyla hazırlanır. */
(function (root) {
  'use strict';
  const KEY = 'ilan5.bitrix.v1';
  const TARGETS = Object.freeze([
    {id: 'arsa', name: 'XRE Arsa', hint: 'Arsa ilanları → XRE ARSA hattı'},
    {id: 'barter', name: 'XRE Barter', hint: 'Barter ilanları → XRE BARTER hattı'},
    {id: 'auto', name: 'XRE Auto', hint: 'Araç ilanları → XRE AUTO hattı'}
  ]);
  const CHUNK = 5;
  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const core = () => root.IlanCore || require('./core.js');
  const sites = () => root.IlanSites || require('./sites.js');

  /** Accepts https addresses, and http only for this computer (self-hosted n8n). */
  function webhookUrl(value) {
    const text = clean(value);
    if (!text) return '';
    let url;
    try { url = new URL(text); } catch (_) { throw Error('Geçerli bir n8n webhook adresi girin.'); }
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.username || url.password) throw Error('Adreste kullanıcı adı veya şifre olmamalı.');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw Error('n8n adresi https:// ile başlamalı.');
    if (/bitrix24\./i.test(url.hostname)) throw Error('Buraya Bitrix adresi değil, n8n akışındaki Webhook düğümünün adresi girilir.');
    url.hash = '';
    return url.href;
  }
  /** Host permission pattern for a webhook address (requested from the user once). */
  function originPattern(value) { const url = new URL(webhookUrl(value)); return url.protocol + '//' + url.hostname + '/*'; }
  function normalizeConfig(raw) {
    const targets = {};
    for (const target of TARGETS) {
      let url = '';
      try { url = webhookUrl(raw?.targets?.[target.id]?.url); } catch (_) { url = ''; }
      targets[target.id] = {url};
    }
    return {targets};
  }

  const detail = (r, ...names) => core().detailGet(r.rawDetails || {}, ...names) || '';
  function adaParsel(r) {
    let ada = detail(r, 'Ada No', 'Ada'), parsel = detail(r, 'Parsel No', 'Parsel');
    const both = detail(r, 'Ada/Parsel No', 'Ada / Parsel', 'Ada/Parsel', 'Ada Parsel');
    if (both && (!ada || !parsel)) { const [a, p] = both.split(/\s*[\/\-]\s*/); ada = ada || clean(a); parsel = parsel || clean(p); }
    return {ada, parsel};
  }
  const num = v => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '' : String(Math.round(Number(v)));
  const phoneOf = r => (r.phones || [])[0] || '';
  function note(r) {
    const extra = (r.phones || []).slice(1);
    const head = [`${sites().name(r.source)} ilanı: ${r.url}`, r.title ? 'Başlık: ' + r.title : '', extra.length ? 'Diğer telefonlar: ' + extra.join(', ') : ''].filter(Boolean);
    const body = String(r.description || '').trim().slice(0, 3000);
    return head.join('\n') + (body ? '\n\n' + body : '');
  }
  const ppa = r => (Number(r.price) > 0 && Number(r.area) > 0) ? num(Number(r.price) / Number(r.area)) : '';

  /** One row per listing, with the column names the matching n8n flow already reads. */
  function rowFor(targetId, r, index = 0) {
    const loc = r.location || {}, {ada, parsel} = adaParsel(r), base = {row_number: index + 2, ilan5_id: r.id};
    if (targetId === 'arsa') return {...base,
      'AD SOYAD': clean(r.sellerName), 'TELEFON': phoneOf(r), 'ŞEHİR': clean(loc.city), 'İLÇE': clean(loc.district), 'MAHALLE': clean(loc.neighborhood),
      'ADA NO': ada, 'PARSEL NO': parsel, 'M2': num(r.area), 'M2 FİYATI': ppa(r), 'KAKS EMSAL': detail(r, 'Kaks (Emsal)', 'KAKS', 'Emsal', 'İmar Emsali'),
      'TAPU DURUMU': detail(r, 'Tapu Durumu'), 'TARİH': detail(r, 'İlan Tarihi'), 'İLAN NO': clean(r.listingId), 'FİYAT': num(r.price),
      'BİZİM FİYATIMIZ': '', 'AÇIKLAMA': note(r)};
    if (targetId === 'barter') return {...base,
      'İlan No': clean(r.listingId), 'İlan Başlığı': clean(r.title), 'Fiyat (TL)': num(r.price), 'Ada No': ada, 'Parsel No': parsel,
      'm²': num(r.area), 'm² Fiyatı': ppa(r), 'Tapu Durumu': detail(r, 'Tapu Durumu'), 'Mağaza Adı': detail(r, 'Mağaza Adı', 'Ofis Adı', 'Firma'),
      'İsim': clean(r.sellerName), 'Telefon Numarası': phoneOf(r), 'İl': clean(loc.city), 'İlçe': clean(loc.district), 'Mahalle': clean(loc.neighborhood),
      'Takas': detail(r, 'Takas', 'Takaslı'), 'RESMİ İLAN LİNKİ': r.url, 'Sorumlu Kişi': '', 'Kaynak': sites().name(r.source),
      'Açıklama': [(r.phones || []).length > 1 ? 'Diğer telefonlar: ' + r.phones.slice(1).join(', ') : '', String(r.description || '').trim().slice(0, 3000)].filter(Boolean).join('\n')};
    return {...base,
      'İlan No': clean(r.listingId), 'İlan Başlığı': clean(r.title), 'Fiyat': num(r.price), 'Marka': detail(r, 'Marka'), 'Seri': detail(r, 'Seri'),
      'Model': detail(r, 'Model'), 'Yıl': detail(r, 'Yıl', 'Model Yılı'), 'KM': detail(r, 'KM', 'Kilometre'), 'Yakıt Tipi': detail(r, 'Yakıt Tipi', 'Yakıt'),
      'Vites Tipi': detail(r, 'Vites Tipi', 'Vites'), 'Renk': detail(r, 'Renk'), 'İl': clean(loc.city), 'İlçe': clean(loc.district),
      'İsim': clean(r.sellerName), 'Telefon': phoneOf(r), 'İlan Linki': r.url, 'Kaynak': sites().name(r.source), 'Açıklama': note(r)};
  }
  const payload = (targetId, records) => ({source: 'ilan5', target: targetId, sentAt: new Date().toISOString(), rows: records.map((r, i) => rowFor(targetId, r, i))});

  /** n8n answers with one item per row: {"İlan No", "Durum", "Deal ID", "Hata"}. */
  function statusOf(item) {
    const durum = clean(item?.Durum ?? item?.durum ?? item?.status);
    const dealId = clean(item?.['Deal ID'] ?? item?.dealId ?? '').replace(/\D/g, '');
    const status = /zaten var|mükerrer|atland/i.test(durum) ? 'duplicate' : /eklendi|added|ok/i.test(durum) && dealId ? 'added' : 'error';
    return {listingId: clean(item?.['İlan No'] ?? item?.ilanNo ?? '').replace(/\.0+$/, ''), status, dealId, message: clean(item?.Hata || (status === 'error' ? durum : '')).slice(0, 300)};
  }
  function parseResponse(body) {
    const items = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.results) ? body.results : body && typeof body === 'object' ? [body] : [];
    return items.map(item => statusOf(item?.json || item));
  }

  /** Sends records in small chunks; returns one result per record (matched by listing number). */
  async function send(fetchFn, url, targetId, records, {onProgress, chunk = CHUNK} = {}) {
    const address = webhookUrl(url);
    if (!address) throw Error('Bu hat için n8n webhook adresi girilmemiş (Ayarlar → Bitrix aktarımı).');
    const results = [];
    for (let i = 0; i < records.length; i += chunk) {
      const part = records.slice(i, i + chunk);
      let answers = [], failure = '';
      try {
        const response = await fetchFn(address, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload(targetId, part))});
        const text = await response.text();
        if (!response.ok) failure = `n8n ${response.status} döndü` + (text ? ': ' + clean(text).slice(0, 160) : '');
        else { try { answers = parseResponse(text ? JSON.parse(text) : []); } catch (_) { failure = 'n8n cevabı okunamadı (Respond to Webhook düğümü JSON dönmeli).'; } }
      } catch (error) { failure = 'n8n adresine ulaşılamadı: ' + clean(error?.message || error); }
      part.forEach((record, k) => {
        const hit = answers.find(a => a.listingId && a.listingId === clean(record.listingId)) || (answers.length === part.length ? answers[k] : null);
        results.push({id: record.id, listingId: record.listingId, ...(hit ? {status: hit.status, dealId: hit.dealId, message: hit.message} : {status: 'error', dealId: '', message: failure || 'Bu ilan için n8n cevabı gelmedi.'})});
      });
      if (onProgress) onProgress(Math.min(i + chunk, records.length), records.length);
    }
    return results;
  }
  /** Connection test: the flow answers {"ok": true} to {"test": true} without touching Bitrix. */
  async function ping(fetchFn, url, targetId) {
    const response = await fetchFn(webhookUrl(url), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({source: 'ilan5', target: targetId, test: true, rows: []})});
    const text = await response.text();
    if (!response.ok) throw Error(`n8n ${response.status} döndü. Akış aktif mi, adres “Production URL” mi?`);
    let body = null; try { body = JSON.parse(text); } catch (_) { body = null; }
    const item = Array.isArray(body) ? body[0] : body;
    if (!(item?.ok === true || item?.json?.ok === true)) throw Error('n8n cevap verdi ama İlan5 akışı değil gibi görünüyor (test cevabı {"ok": true} olmalı).');
    return true;
  }
  const api = {KEY, TARGETS, CHUNK, webhookUrl, originPattern, normalizeConfig, rowFor, payload, parseResponse, send, ping};
  root.IlanBitrix = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = root.IlanBitrix;
})(typeof globalThis === 'undefined' ? self : globalThis);
