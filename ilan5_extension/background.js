/* İlan Arşiv: durable, one-tab MV3 crawler. No CAPTCHA bypass or private API calls. */
/* global IlanCore, IlanDB */
'use strict';

(function (root) {
  const JOB_KEY = 'ilan5.job.v2';
  const STEP_ALARM = 'ilan5.step.v2';
  const WATCH_ALARM = 'ilan5.watch.v2';
  const CATEGORIES = new Set(['arsa', 'arac', 'konut', 'isyeri', 'diger', 'belirsiz']);
  // Page size is a search invariant. Only the page position may change.
  const PAGE_PARAMS = new Set(['page', 'p', 'pagingOffset']);
  const TRACKING = /^(?:utm_.+|gclid|fbclid)$/i;

  function siteUrl(value) {
    let u;
    try { u = new URL(String(value)); } catch (_) { throw new Error('Geçerli bir ilan veya arama adresi girin.'); }
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) {
      throw new Error('Yalnız standart HTTP(S) Hepsiemlak ve Sahibinden adresleri desteklenir.');
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!['hepsiemlak.com', 'sahibinden.com'].includes(host)) {
      throw new Error('Bu sürüm Hepsiemlak ve Sahibinden sayfalarını destekler.');
    }
    // Host permissions are HTTPS-only. Upgrade a pasted legacy HTTP link
    // before navigation, so extraction never needs additional host access.
    u.protocol = 'https:';
    u.hostname = 'www.' + host;
    u.hash = '';
    return {url: u, source: host === 'hepsiemlak.com' ? 'hepsiemlak' : 'sahibinden'};
  }

  function listingRef(value, expectedSource) {
    const {url, source} = siteUrl(value);
    if (expectedSource && expectedSource !== source) throw new Error('Farklı kaynaktaki ilan atlandı.');
    let match;
    if (source === 'hepsiemlak') match = url.pathname.match(/\/(\d+-\d+)\/?$/);
    else match = url.pathname.match(/^\/ilan\/.+-(\d+)\/detay\/?$/);
    if (!match) throw new Error('Adres bir ilan detay sayfası değil.');
    url.search = '';
    url.pathname = url.pathname.replace(/\/$/, '');
    return {id: source + ':' + match[1], listingId: match[1], url: url.href, source};
  }

  function pageKey(value) {
    const {url} = siteUrl(value);
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  }

  function sameNavigationTarget(actualUrl, expectedUrl, kind) {
    try {
      if (kind === 'detail') return listingRef(actualUrl).id === listingRef(expectedUrl).id;
      const actual = siteUrl(actualUrl), expected = siteUrl(expectedUrl);
      if (actual.source !== expected.source || actual.url.pathname.replace(/\/$/, '') !== expected.url.pathname.replace(/\/$/, '')) return false;
      const actualParams = actual.url.searchParams, expectedParams = expected.url.searchParams;
      if (actual.source === 'sahibinden') {
        const size = Number(actualParams.get('pagingSize') || expectedParams.get('pagingSize'));
        const hasOffset = actualParams.has('pagingOffset') || expectedParams.has('pagingOffset');
        if (hasOffset && Number.isSafeInteger(size) && size > 0) {
          const pageNumber = params => params.has('pagingOffset')
            ? Math.floor(Number(params.get('pagingOffset') || 0) / size) + 1
            : Number(params.get('page') || params.get('p') || 1);
          return pageNumber(actualParams) === pageNumber(expectedParams);
        }
        if (actualParams.has('pagingOffset') && expectedParams.has('pagingOffset')) {
          return Number(actualParams.get('pagingOffset') || 0) === Number(expectedParams.get('pagingOffset') || 0);
        }
      }
      const position = params => Number(params.get('page') || params.get('p') || 1);
      return position(actualParams) === position(expectedParams);
    } catch (_) { return false; }
  }

  // A site's relative next link may contain only a page parameter. Preserve all
  // filters from the original search, and reject links that change those filters.
  function nextPageUrl(candidate, currentUrl, searchUrl) {
    const initial = siteUrl(searchUrl);
    const current = siteUrl(currentUrl);
    const next = siteUrl(new URL(candidate, current.url).href);
    if (next.source !== initial.source || next.url.pathname.replace(/\/$/, '') !== initial.url.pathname.replace(/\/$/, '')) {
      throw new Error('Sonraki sayfa arama kapsamından çıkıyor; otomatik geçiş durduruldu.');
    }
    for (const key of new Set(initial.url.searchParams.keys())) {
      if (PAGE_PARAMS.has(key) || TRACKING.test(key)) continue;
      const original = initial.url.searchParams.getAll(key);
      const supplied = next.url.searchParams.getAll(key);
      if (supplied.length && JSON.stringify([...supplied].sort()) !== JSON.stringify([...original].sort())) {
        throw new Error('Sonraki sayfa arama filtresini değiştiriyor: ' + key);
      }
      next.url.searchParams.delete(key);
      original.forEach(value => next.url.searchParams.append(key, value));
    }
    return next.url.href;
  }

  function categoryGate(record, targetCategory) {
    const classification = record.classification || {};
    if (classification.status !== 'verified' || !CATEGORIES.has(classification.category) || classification.category === 'belirsiz') {
      record.archiveStatus = 'review';
      record.quality = {...record.quality, status: 'review'};
      return 'review';
    }
    if (targetCategory !== 'all' && classification.category !== targetCategory) return 'skip';
    record.archiveStatus = 'active';
    return 'save';
  }

  function createEngine(api, core, db, options = {}) {
    const clock = options.now || Date.now;
    let job;
    let chain = Promise.resolve();
    let controlEpoch = 0;
    let wakeTimer = null;
    const timers = options.timers || (!options.now && typeof root.setTimeout === 'function' ? {
      setTimeout: root.setTimeout.bind(root), clearTimeout: root.clearTimeout.bind(root)
    } : null);
    const iso = () => new Date(clock()).toISOString();
    const serial = fn => {
      const result = chain.then(fn, fn);
      chain = result.catch(() => {});
      return result;
    };
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

    async function load() {
      if (job === undefined) {
        job = (await api.storage.local.get(JOB_KEY))[JOB_KEY] || null;
        if (job && migrateTraversal()) await persist();
      }
      return job;
    }
    function migrateTraversal() {
      if (job.traversalVersion === 3) return false;
      // v2 collected every list page first. Its backlog must be consumed before
      // any new list is opened; do not discard URLs or re-save finished details.
      job.traversalVersion = 3;
      job.listingQueue = Array.isArray(job.listingQueue) ? job.listingQueue : [];
      job.visitedPages = Array.isArray(job.visitedPages) ? job.visitedPages : [];
      job.detailIndex = Math.max(0, Math.min(job.listingQueue.length, job.detailIndex || 0));
      job.pageSignatures = [];
      job.searchId = String(job.searchId || '');
      job.baseline = job.baseline !== false;
      job.counts = {...job.counts, newListings: job.counts?.newListings || 0, priceIncreases: job.counts?.priceIncreases || 0, priceDecreases: job.counts?.priceDecreases || 0};
      job.pageStartIndex = 0; job.pageEndIndex = job.listingQueue.length;
      job.pageFound = job.listingQueue.length; job.pageDuplicates = 0;
      job.pendingNextListUrl = null;
      if (job.phase === 'collect' && job.detailIndex < job.listingQueue.length) {
        const deferred = job.current?.kind === 'list' ? job.current.url : job.nextListUrl;
        if (deferred && !job.visitedPages.includes(pageKey(deferred))) job.pendingNextListUrl = deferred;
        else { job.listIncomplete = true; job.listComplete = false; }
        job.phase = 'details';
        if (job.current?.kind === 'list') { job.current = null; job.currentUrl = ''; }
        job.legacyBacklog = true;
        event('Önceki sürümde toplanmış ilan sırası korunuyor; kalan detaylar tamamlanınca sayfa sayfa devam edilecek.');
      }
      job.pageProgress = {currentPage: Math.max(1, job.pages || 1), totalPages: job.listComplete ? (job.pages || null) : null,
        pageFound: job.pageFound, pageProcessed: job.detailIndex, totalProcessed: job.counts.processed || 0,
        totalExpected: job.expectedTotal ?? null, stage: job.phase === 'collect' ? 'list' : job.phase === 'done' ? 'done' : 'details'};
      return true;
    }
    function syncProgress() {
      if (!job?.pageProgress) return;
      job.pageProgress.pageFound = job.pageFound || 0;
      job.pageProgress.pageProcessed = Math.min(job.pageFound || 0, (job.pageDuplicates || 0) + Math.max(0, job.detailIndex - (job.pageStartIndex || 0)));
      job.pageProgress.totalProcessed = job.counts.processed || 0;
      job.pageProgress.totalExpected = job.expectedTotal ?? null;
      job.pageProgress.stage = job.phase === 'collect' ? 'list' : job.phase === 'done' ? 'done' : 'details';
    }
    function event(message) {
      job.message = message;
      job.logs = [...(job.logs || []), {at: iso(), message}].slice(-150);
    }
    async function persist() {
      if (job) { syncProgress(); job.updatedAt = iso(); }
      await api.storage.local.set({[JOB_KEY]: job});
      try {
        const result = api.runtime.sendMessage({type: 'ILAN_JOB_UPDATED', job: clone(job)});
        if (result && result.catch) result.catch(() => {});
      } catch (_) { /* Archive screen may be closed. */ }
    }
    async function clearAlarms() {
      if (wakeTimer !== null) { timers?.clearTimeout(wakeTimer); wakeTimer = null; }
      await api.alarms.clear(STEP_ALARM);
      await api.alarms.clear(WATCH_ALARM);
    }
    async function watch() {
      // The watchdog is durable; Chrome may delay alarms further while asleep.
      await api.alarms.create(WATCH_ALARM, {periodInMinutes: 0.5});
    }
    async function schedule() {
      if (!job || job.status !== 'running') return;
      const when = Math.max(clock() + 50, job.nextDueAt || clock());
      await api.alarms.create(STEP_ALARM, {when});
      await watch();
      // Alarms survive worker suspension but may be delayed. A live worker can
      // honor the selected short delay without depending on the next alarm.
      if (timers) {
        if (wakeTimer !== null) timers.clearTimeout(wakeTimer);
        wakeTimer = timers.setTimeout(() => {
          wakeTimer = null;
          const run = () => serial(tick);
          Promise.resolve(options.onWake ? options.onWake(run) : run()).catch(() => {}); // The durable watchdog retries failures.
        }, Math.max(0, when - clock()));
      }
    }
    async function park(status, message) {
      job.status = status;
      event(message);
      await clearAlarms();
      await persist();
    }
    async function getWorkTab() {
      if (!job || !Number.isInteger(job.workTabId)) return null;
      try { return await api.tabs.get(job.workTabId); } catch (_) { return null; }
    }
    async function ensureWorkTab() {
      let tab = await getWorkTab();
      if (!tab) {
        tab = core.openWorkTab ? await core.openWorkTab(api) : await api.tabs.create({url: 'about:blank', active: false});
        job.workTabId = tab.id;
        await persist();
      }
      return tab;
    }
    async function readTab(tabId, request) {
      try { return await api.tabs.sendMessage(tabId, request); }
      catch (firstError) {
        if (!/receiving end|connection|could not establish/i.test(String(firstError))) throw firstError;
        // Existing tabs opened before installation may lack the static content script.
        await api.scripting.executeScript({target: {tabId}, files: ['extractor.js', 'messaging.js', 'content.js']});
        return await api.tabs.sendMessage(tabId, request);
      }
    }
    function bumpCounter(name, count = 1) {
      job.counts[name] = (job.counts[name] || 0) + count;
    }
    function addFailure(url, message) {
      bumpCounter('errors');
      job.failures = [...(job.failures || []), {url, message, at: iso()}].slice(-500);
    }
    async function complete() {
      if (job.expectedTotal != null && job.counts.discovered !== job.expectedTotal) {
        job.listIncomplete = true; job.listComplete = false;
        event(`Sonuç toplamı uyuşmuyor: görünen ${job.expectedTotal}, bulunan tekil ilan ${job.counts.discovered}.`);
      }
      const incomplete = !job.listComplete || job.listIncomplete || job.limited || job.counts.errors > 0;
      job.status = incomplete ? 'incomplete' : 'completed';
      job.phase = 'done';
      job.current = null;
      job.currentUrl = '';
      job.completedAt = iso();
      event(incomplete ? 'Tarama kısmi kaldı. ' + (job.stopReason || 'Sınır veya okuma uyarılarını kontrol edin.') : 'Tarama tamamlandı.');
      await clearAlarms();
      await persist();
    }
    async function afterCurrent() {
      job.current = null;
      job.currentUrl = '';
      job.nextDueAt = Math.max(clock(), job.lastNavigationAt || 0) + job.delayMs;
      await persist();
      await schedule();
    }
    function finishCollection(reason, completeFlag) {
      job.phase = 'details';
      job.pendingNextListUrl = null;
      job.listComplete = !!completeFlag;
      if (!completeFlag) job.listIncomplete = true;
      if (job.expectedTotal != null && job.counts.discovered !== job.expectedTotal) {
        job.listIncomplete = true; job.listComplete = false;
        reason += ` Görünen toplam ${job.expectedTotal}, bulunan tekil ilan ${job.counts.discovered}.`;
      }
      job.stopReason = reason;
      event(reason + ' Bu sayfanın kalan ilan detayları tamamlanacak.');
    }
    async function knownRecords(ids) {
      const found = new Map();
      if (!db.getMany || !ids.length) return found;
      try { for (const record of await db.getMany(ids)) if (record) found.set(record.id, record); } catch (_) { /* Treat as unknown. */ }
      return found;
    }
    // Skip the detail page only when the result row proves nothing important changed:
    // same price and currency, already seen in this search, phone known, checked within a week.
    function unchangedOnList(old, row) {
      if (!old || !row || old.archiveStatus === 'review' || old.price === null || old.price !== row.price) return false;
      if (row.currency && old.currency && row.currency !== old.currency) return false;
      if (job.searchId && !(old.market?.searchIds || []).includes(job.searchId)) return false;
      if (job.revealPhone && !(old.phones || []).length) return false;
      if (!old.sellerName) return false;
      const updated = Date.parse(old.updatedAt || '');
      return Number.isFinite(updated) && clock() - updated < 7 * 24 * 60 * 60 * 1000;
    }
    async function acceptList(response) {
      const current = job.current;
      const visitedKey = pageKey(current.url);
      if (!job.visitedPages.includes(visitedKey)) {
        job.visitedPages.push(visitedKey);
        job.pages = job.visitedPages.length;
      }
      const known = new Set([...job.listingQueue.map(item => item.id), ...(job.unchangedIds || [])]);
      const pageRefs = new Map();
      for (const value of response.links || []) {
        try { const ref = listingRef(typeof value === 'string' ? value : value.url, job.source); pageRefs.set(ref.id, ref); } catch (_) { /* non-listing links */ }
      }
      const rowPrices = new Map();
      for (const row of response.rows || []) {
        try { if (Number.isFinite(row.price)) rowPrices.set(listingRef(row.url, job.source).id, row); } catch (_) { /* foreign row */ }
      }
      const settings = core.safetySettings ? await core.safetySettings(api) : {};
      const archived = await knownRecords([...pageRefs.keys()]);
      const unchangedNow = [];
      job.pageStartIndex = job.listingQueue.length;
      job.pageFound = pageRefs.size;
      job.pageDuplicates = 0;
      let added = 0;
      for (const ref of pageRefs.values()) {
        if (known.has(ref.id)) { job.pageDuplicates += 1; continue; }
        const old = archived.get(ref.id);
        if (settings.skipKnown !== false && unchangedOnList(old, rowPrices.get(ref.id))) { known.add(ref.id); unchangedNow.push(ref.id); continue; }
        if (job.maxListings && job.listingQueue.length >= job.maxListings) { job.limited = true; continue; }
        known.add(ref.id);
        if (settings.reuseKnownPhone !== false && old?.phones?.length) ref.knownPhones = old.phones.slice(0, 5);
        job.listingQueue.push(ref);
        added += 1;
      }
      if (unchangedNow.length) {
        try { await db.markSeen(unchangedNow, {searchId: job.searchId, listId: job.listId, observedAt: iso()}); } catch (_) { /* Membership refresh is best effort. */ }
        job.unchangedIds = [...(job.unchangedIds || []), ...unchangedNow];
        job.pageDuplicates += unchangedNow.length;
        bumpCounter('unchanged', unchangedNow.length);
      }
      job.pageEndIndex = job.listingQueue.length;
      job.counts.discovered = job.listingQueue.length + (job.unchangedIds || []).length;
      const pagination = response.pagination || {};
      job.paginationStrategy = pagination.strategy || (response.nextUrl ? 'next-link' : 'terminal-check');
      if (Number.isSafeInteger(pagination.expectedTotal) && pagination.expectedTotal >= 0) job.expectedTotal = pagination.expectedTotal;
      const currentPage = Number.isSafeInteger(pagination.currentPage) && pagination.currentPage > 0 ? pagination.currentPage : job.pages;
      const size = Number(pagination.pageSize || siteUrl(job.searchUrl).url.searchParams.get('pagingSize'));
      const lastPage = Number.isSafeInteger(pagination.lastPage) && pagination.lastPage > 0 ? pagination.lastPage : (job.expectedTotal != null && size > 0 ? Math.max(1, Math.ceil(job.expectedTotal / size)) : null);
      job.pageProgress = {currentPage, totalPages: lastPage || job.pageProgress?.totalPages || null, pageFound: job.pageFound, pageProcessed: job.pageDuplicates,
        totalProcessed: job.counts.processed, totalExpected: job.expectedTotal, stage: 'details'};
      job.phase = 'details'; job.pendingNextListUrl = null; job.legacyBacklog = false;
      const signature = [...pageRefs.keys()].sort().join('|');
      const repeatedPage = !!signature && (job.pageSignatures.includes(signature) || (added + unchangedNow.length === 0 && pageRefs.size > 0));
      if (signature) job.pageSignatures.push(signature);
      event(`Liste sayfası ${currentPage}: ${job.pageFound} ilan, ${added} detayı açılacak${unchangedNow.length ? `, ${unchangedNow.length} değişmemiş ilan atlandı` : ''}. Önce bu sayfanın detayları işlenecek.`);
      if (job.maxListings && job.listingQueue.length >= job.maxListings && response.nextUrl) job.limited = true;
      if (job.maxPages && job.pages >= job.maxPages && response.nextUrl) job.limited = true;
      if (repeatedPage) finishCollection('Liste içeriği önceki sayfayı tekrarlıyor; sayfalama durduruldu.', false);
      else if (!pageRefs.size && response.nextUrl) finishCollection('Liste sayfasında doğrulanmış ilan bağlantısı bulunamadı.', false);
      else if (job.limited) finishCollection('Seçilen tarama sınırına ulaşıldı.', false);
      else if (response.nextUrl) {
        try {
          const next = nextPageUrl(response.nextUrl, current.url, job.searchUrl);
          if (job.visitedPages.includes(pageKey(next))) throw new Error('Sayfalama aynı sayfaya dönüyor.');
          job.pendingNextListUrl = next;
        } catch (error) { finishCollection(String(error.message), false); }
      } else {
        finishCollection(pagination.reason || (pagination.complete ? 'Son liste sayfasına ulaşıldı.' : 'Sonraki sayfa doğrulanamadı.'), pagination.complete === true);
      }
      await afterCurrent();
    }
    async function normalizedRecord(raw, targetCategory, sourceSearchUrl) {
      const result = core.normalizeRecord(raw, {targetCategory, sourceSearchUrl});
      return await Promise.resolve(result);
    }
    // Several listings in a row without a core field usually means the site layout changed.
    function checkHealth(record) {
      const health = job.health || (job.health = {streaks: {}, alerted: {}});
      const missing = {title: !record.title, price: record.price === null, phone: job.revealPhone && !(record.phones || []).length};
      for (const [field, absent] of Object.entries(missing)) {
        health.streaks[field] = absent ? (health.streaks[field] || 0) + 1 : 0;
        if (health.streaks[field] < (field === 'phone' ? 8 : 5) || health.alerted[field]) continue;
        health.alerted[field] = true;
        const label = {title: 'başlık', price: 'fiyat', phone: 'telefon'}[field];
        const message = `Art arda ${health.streaks[field]} ilanda ${label} okunamadı. Site sayfa yapısını değiştirmiş veya oturum kapanmış olabilir; son ilanları kaynakla karşılaştırın.`;
        event('UYARI: ' + message);
        if (options.onHealthAlert) Promise.resolve().then(() => options.onHealthAlert(field, message, clone(job))).catch(() => {});
      }
    }
    async function acceptDetail(response) {
      const ref = listingRef(job.current.url, job.source);
      const queued = job.listingQueue[job.detailIndex];
      let raw = response.record;
      if (!raw || typeof raw !== 'object') throw new Error('İlan alanları okunamadı.');
      // The phone button was not pressed because the archive already holds the number.
      if (queued?.knownPhones?.length && !(raw.phones || []).length) raw = {...raw, phones: queued.knownPhones};
      const record = await normalizedRecord({...raw, url: raw.url || ref.url}, job.category, job.searchUrl);
      const actual = listingRef(record.url, job.source);
      if (actual.id !== ref.id) throw new Error('Açılan ilan ile beklenen ilan numarası uyuşmuyor.');
      checkHealth(record);
      const gate = categoryGate(record, job.category);
      if (gate === 'skip') {
        bumpCounter('skipped');
        event(`İlan ${ref.listingId}: seçilen kategoriye uymadığı için arşive alınmadı.`);
      } else {
        const result = await db.upsertMany([record], {origin: 'crawl', searchId: job.searchId, listId: job.listId || '',
          runId: job.id, baseline: job.baseline, observedAt: iso()});
        if (options.onMarketEvents && result?.events?.length) {
          try { await options.onMarketEvents(clone(result.events), clone(job)); } catch (_) { /* Notifications never block the crawl. */ }
        }
        for (const name of ['newListings', 'priceIncreases', 'priceDecreases']) {
          const count = result?.effects?.[name] ?? result?.[name];
          if (Number.isSafeInteger(count) && count > 0) bumpCounter(name, count);
        }
        bumpCounter(gate === 'review' ? 'review' : 'saved');
        event(`İlan ${ref.listingId}: ${gate === 'review' ? 'kategori doğrulanamadı, inceleme arşivine alındı' : 'kaydedildi'}.`);
      }
      bumpCounter('processed');
      job.detailIndex += 1;
      await afterCurrent();
    }
    async function readCurrent(tab) {
      if (!job || job.status !== 'running' || !job.current || tab.id !== job.workTabId) return;
      const current = job.current;
      const epoch = controlEpoch;
      let actual;
      try { actual = siteUrl(tab.url || '').source; } catch (_) {
        await park('paused', 'Çalışma sekmesi desteklenen kaynağın dışına çıktı. Arama adresini kontrol edin.');
        return;
      }
      if (actual !== job.source) { await park('paused', 'Çalışma sekmesi farklı bir kaynağa yönlendi.'); return; }
      if (!sameNavigationTarget(tab.url, current.url, current.kind)) {
        current.needsNavigation = true;
        await park('paused', 'Çalışma sekmesi beklenen sayfada değil. Sıra korundu; Devam aynı sayfayı yeniden açar.');
        return;
      }
      current.stage = 'reading';
      current.readAt = clock();
      await persist();
      let response;
      try {
        response = await readTab(tab.id, {type: 'ILAN_EXTRACT', mode: current.kind, expectedUrl: current.url, revealPhone: job.revealPhone && !(current.kind === 'detail' && job.listingQueue[job.detailIndex]?.knownPhones?.length)});
      } catch (error) {
        // Leave a durable task for a bounded later retry, never an unbounded loop.
        if (epoch !== controlEpoch) { current.stage = 'ready'; await persist(); return; }
        current.readAttempts = (current.readAttempts || 0) + 1;
        if (current.readAttempts < 2) {
          current.stage = 'ready';
          job.nextDueAt = clock() + job.delayMs;
          event('Sayfa henüz okunamadı; bir kez daha kontrol edilecek.');
          await persist();
          await schedule();
          return;
        }
        response = {ok: false, kind: 'error', error: String(error.message || error)};
      }
      if (epoch !== controlEpoch) { current.stage = 'ready'; await persist(); return; }
      const live = await getWorkTab();
      if (!live) {
        current.stage = 'ready'; current.needsNavigation = true;
        await park('paused', 'Çalışma sekmesi bulunamadı. Sıra korundu; Devam ile yeniden açılacak.');
        return;
      }
      if (live.status !== 'complete') {
        current.stage = 'ready'; current.needsNavigation = false;
        current.readAttempts = (current.readAttempts || 0) + 1;
        if (current.readAttempts <= 2) {
          job.nextDueAt = clock() + job.delayMs;
          event('Sayfa okuma sırasında yüklenmeye devam etti. Eski cevap atlandı; yükleme tamamlanınca aynı ilan yeniden okunacak.');
          await persist(); await schedule();
        } else {
          current.needsNavigation = true;
          await park('paused', 'Sayfa okuma sırasında tekrar tekrar yenilendi. İlan sırası korundu; Devam ile aynı ilan yeniden açılacak.');
        }
        return;
      }
      if (!sameNavigationTarget(live.url, current.url, current.kind)) {
        current.stage = 'ready'; current.needsNavigation = true;
        current.changedReadAttempts = (current.changedReadAttempts || 0) + 1;
        if (current.changedReadAttempts <= 2) {
          job.nextDueAt = clock() + job.delayMs;
          event('Çalışma sekmesindeki sayfa okuma sırasında değişti. Eski cevap kaydedilmedi; aynı ilan yeniden açılıp okunacak.');
          await persist(); await schedule();
        } else {
          await park('paused', 'Çalışma sekmesi art arda farklı sayfaya geçti. İlan sırası korundu; tarama sekmesini kontrol edip Devam edin.');
        }
        return;
      }
      if (!response || !response.ok) {
        const kind = response && response.kind;
        const error = response && response.error || 'Sayfadan geçerli cevap alınamadı.';
        if (['blocked', 'login'].includes(kind)) {
          current.stage = 'ready';
          await park('blocked', error + ' Çalışma sekmesini kontrol edin; ardından Devam düğmesine basın.');
          return;
        }
        if (current.kind === 'list' && kind === 'mismatch') {
          current.stage = 'ready'; current.needsNavigation = true;
          await park('paused', error + ' Arama sayfası doğrulanamadı. Sıra korundu; Devam beklenen sayfayı yeniden açar.');
          return;
        }
        if (current.kind === 'list' || kind === 'mismatch') {
          current.stage = 'ready';
          await park('paused', error + ' Tarama doğrulama için duraklatıldı.');
          return;
        }
        addFailure(current.url, error);
        bumpCounter('processed');
        job.detailIndex += 1;
        event('İlan okunamadı: ' + error);
        await afterCurrent();
        return;
      }
      try {
        if (response.kind !== current.kind) throw new Error('Beklenen sayfa türü bulunamadı.');
        const paging = response.pagination || {};
        const expectedOnPage = Number.isSafeInteger(paging.expectedTotal) && paging.expectedTotal > 0 && paging.pageSize > 0 && paging.currentPage > 0
          ? Math.max(0, Math.min(paging.pageSize, paging.expectedTotal - (paging.currentPage - 1) * paging.pageSize)) : null;
        const underfilledPage = expectedOnPage != null && (response.links || []).length < expectedOnPage;
        if (current.kind === 'list' && ((!response.nextUrl && paging.complete !== true) || underfilledPage) && !current.paginationRetried) {
          current.paginationRetried = true; current.stage = 'ready';
          job.nextDueAt = clock() + job.delayMs;
          event('Liste veya sayfalama henüz tamamlanmadı; sayfanın yüklenmesi beklenecek ve bir kez daha okunacak.');
          await persist(); await schedule(); return;
        }
        if (current.kind === 'list' && underfilledPage) {
          job.listIncomplete = true;
          job.stopReason = 'En az bir liste sayfasında beklenen sayıda ilan bağlantısı okunamadı.';
        }
        if (current.kind === 'list') await acceptList(response);
        else await acceptDetail(response);
      } catch (error) {
        if (current.kind === 'list') {
          current.stage = 'ready';
          await park('paused', 'Liste işlenemedi: ' + error.message);
        } else {
          addFailure(current.url, String(error.message || error));
          bumpCounter('processed');
          job.detailIndex += 1;
          event('İlan kaydedilemedi: ' + error.message);
          await afterCurrent();
        }
      }
    }
    async function tick() {
      await load();
      if (!job || job.status !== 'running') return;
      if (!job.current && job.lastNavigationAt) job.nextDueAt = Math.max(job.nextDueAt || 0, job.lastNavigationAt + job.delayMs);
      if ((job.nextDueAt || 0) > clock()) { await schedule(); return; }
      if (job.current) {
        const tab = await getWorkTab();
        if (!tab) { await park('paused', 'Çalışma sekmesi kapatıldı. Devam düğmesi yeni bir sekme açar.'); return; }
        if (job.current.needsNavigation) { await navigateCurrent(tab); return; }
        if (tab.status === 'complete') { await readCurrent(tab); return; }
        if (clock() - job.current.startedAt > 90000) {
          job.current.needsNavigation = true;
          await park('paused', 'Sayfa 90 saniye içinde yüklenmedi. Çalışma sekmesini kontrol edin.');
        }
        return;
      }
      let next;
      if (job.phase === 'details' && job.detailIndex >= job.pageEndIndex) {
        if (job.pendingNextListUrl) {
          job.nextListUrl = job.pendingNextListUrl; job.pendingNextListUrl = null;
          job.phase = 'collect'; job.pageStartIndex = job.detailIndex; job.pageEndIndex = job.detailIndex;
          job.pageFound = 0; job.pageDuplicates = 0;
          job.pageProgress.currentPage += 1;
          event('Bu sayfanın ilanları tamamlandı; sonraki liste sayfasına geçiliyor.');
        } else { await complete(); return; }
      }
      if (job.phase === 'collect') next = {kind: 'list', url: job.nextListUrl};
      else if (job.detailIndex < job.pageEndIndex) next = {kind: 'detail', url: job.listingQueue[job.detailIndex].url};
      else { await complete(); return; }
      if (next.kind === 'detail' && core.takeDailySlot) {
        const slot = await core.takeDailySlot(api, clock());
        if (!slot.allowed) {
          job.nextDueAt = slot.resumeAt; job.waitingUntil = new Date(slot.resumeAt).toISOString();
          event(`Günlük güvenli limit doldu (${slot.limit} ilan). Tarama ${new Date(slot.resumeAt).toLocaleString('tr-TR')} itibarıyla kendiliğinden devam edecek. Limiti panelden değiştirebilirsiniz.`);
          await persist(); await schedule(); return;
        }
      }
      job.waitingUntil = null;
      const tab = await ensureWorkTab();
      job.current = {...next, stage: 'navigating', startedAt: clock(), readAttempts: 0};
      job.currentUrl = next.url;
      job.lastNavigationAt = clock();
      job.nextDueAt = 0;
      event(next.kind === 'list' ? `Liste sayfası ${job.pageProgress.currentPage} açılıyor.` : `Sayfa ${job.pageProgress.currentPage}: ilan ${(job.pageDuplicates || 0) + job.detailIndex - job.pageStartIndex + 1}/${job.pageFound} açılıyor.`);
      await persist();
      await watch();
      await navigateCurrent(tab);
    }
    async function navigateCurrent(tab) {
      const current = job.current;
      current.needsNavigation = false; current.stage = 'navigating'; current.startedAt = clock();
      current.navigationAttempts = (current.navigationAttempts || 0) + 1;
      job.lastNavigationAt = clock(); job.nextDueAt = 0;
      await persist(); await watch();
      try { await api.tabs.update(tab.id, {url: current.url}); }
      catch (error) {
        current.needsNavigation = true; current.stage = 'navigation_retry';
        if (current.navigationAttempts < 2) {
          job.nextDueAt = clock() + job.delayMs;
          event('Sayfa açılamadı; aynı adres bir kez daha denenecek: ' + error.message);
          await persist(); await schedule();
        } else {
          await park('paused', 'Sayfa açılamadı; sıra korundu. Devam ile yeniden deneyin: ' + error.message);
        }
      }
    }
    async function start(message) {
      await load();
      if (job && ['running', 'paused', 'blocked'].includes(job.status)) throw new Error('Mevcut işi önce durdurun veya devam ettirin.');
      const parsed = siteUrl(message.searchUrl);
      try { listingRef(parsed.url.href); throw new Error('Arama sonuç sayfasının adresini girin; tek ilan için “Açık ilanı al” seçeneğini kullanın.'); }
      catch (error) { if (error.message.startsWith('Arama sonuç')) throw error; }
      const category = message.category || 'arsa';
      if (category!=='all' && (!CATEGORIES.has(category) || category === 'belirsiz')) throw new Error('Aranacak ilan kategorisini seçin.');
      const positive = (value, label) => {
        const n = Number(value || 0);
        if (!Number.isSafeInteger(n) || n < 0) throw new Error(label + ' sıfır veya pozitif tam sayı olmalı.');
        return n;
      };
      const delayMs = Number(message.delayMs || 4000);
      if (!Number.isFinite(delayMs) || delayMs < 3000 || delayMs > 3600000) throw new Error('Bekleme süresi 3–3600 saniye arasında olmalı.');
      const oldTab = job && job.workTabId;
      job = {
        version: 2, traversalVersion: 3, id: 'job-' + clock(), searchUrl: parsed.url.href, source: parsed.source,
        searchId: String(message.searchId || ''), listId: String(message.listId || '').slice(0, 100), baseline: message.baseline !== false,
        category, maxListings: positive(message.maxListings, 'İlan sınırı'), maxPages: positive(message.maxPages, 'Sayfa sınırı'),
        delayMs, revealPhone: message.revealPhone !== false, status: 'running', phase: 'collect',
        startedAt: iso(), completedAt: null, updatedAt: iso(), workTabId: oldTab || null,
        nextListUrl: parsed.url.href, visitedPages: [], listingQueue: [], detailIndex: 0,
        pendingNextListUrl: null, pageStartIndex: 0, pageEndIndex: 0, pageFound: 0, pageDuplicates: 0, pageSignatures: [],
        pageProgress: {currentPage: 1, totalPages: null, pageFound: 0, pageProcessed: 0, totalProcessed: 0, totalExpected: null, stage: 'list'},
        current: null, currentUrl: '', nextDueAt: clock(), lastNavigationAt: 0, pages: 0,
        expectedTotal: null, listComplete: false, listIncomplete: false, limited: false,
        counts: {discovered: 0, processed: 0, saved: 0, skipped: 0, review: 0, errors: 0, newListings: 0, priceIncreases: 0, priceDecreases: 0}, failures: [], logs: []
      };
      event('Tarama başladı. Her sayfanın ilan detayları tamamlanınca sonraki sayfaya geçilecek.');
      await persist();
      await tick();
      return {ok: true, job: clone(job)};
    }
    async function startLinks(message) {
      await load();
      if (job && ['running', 'paused', 'blocked'].includes(job.status)) throw new Error('Mevcut işi önce durdurun veya devam ettirin.');
      const inputs = Array.isArray(message.urls) ? message.urls : typeof message.urls === 'string' ? message.urls.split(/\r?\n/) : [];
      const unique = new Map();
      let source = '';
      // Validate the complete batch before changing any job or opening a tab.
      for (const [index, input] of inputs.entries()) {
        if (typeof input !== 'string') throw new Error(`Bağlantı ${index + 1} metin biçiminde olmalı.`);
        const value = input.trim(); if (!value) continue;
        if (/\s/.test(value)) throw new Error(`Bağlantı ${index + 1}: her satıra tek ilan adresi yapıştırın.`);
        let ref;
        try { ref = listingRef(value); } catch (error) { throw new Error(`Bağlantı ${index + 1}: ${error.message}`); }
        if (source && source !== ref.source) throw new Error('Hepsiemlak ve Sahibinden bağlantılarını ayrı işler halinde başlatın. Bu işte yalnız bir kaynak kullanılır.');
        source = ref.source; unique.set(ref.id, ref);
      }
      if (!unique.size) throw new Error('En az bir ilan detay bağlantısı girin. Her satıra bir bağlantı yapıştırabilirsiniz.');
      const category = message.category || 'arsa';
      if (category !== 'all' && (!CATEGORIES.has(category) || category === 'belirsiz')) throw new Error('Aranacak ilan kategorisini seçin.');
      const delayMs = Number(message.delayMs || 4000);
      if (!Number.isFinite(delayMs) || delayMs < 3000 || delayMs > 3600000) throw new Error('Bekleme süresi 3–3600 saniye arasında olmalı.');
      const refs = [...unique.values()], oldTab = job?.workTabId || null;
      if (message.revealPhone !== false && (core.safetySettings ? (await core.safetySettings(api)).reuseKnownPhone !== false : false)) {
        const archived = await knownRecords(refs.map(ref => ref.id));
        for (const ref of refs) if (archived.get(ref.id)?.phones?.length) ref.knownPhones = archived.get(ref.id).phones.slice(0, 5);
      }
      job = {
        version: 2, traversalVersion: 3, id: 'job-' + clock(), mode: 'links', searchUrl: '', source, searchId: '', listId: String(message.listId || '').slice(0, 100), baseline: true,
        category, maxListings: 0, maxPages: 0, delayMs, revealPhone: message.revealPhone !== false, status: 'running', phase: 'details',
        startedAt: iso(), completedAt: null, updatedAt: iso(), workTabId: oldTab,
        nextListUrl: null, visitedPages: [], listingQueue: refs, detailIndex: 0,
        pendingNextListUrl: null, pageStartIndex: 0, pageEndIndex: refs.length, pageFound: refs.length, pageDuplicates: 0, pageSignatures: [],
        pageProgress: {currentPage: 1, totalPages: 1, pageFound: refs.length, pageProcessed: 0, totalProcessed: 0, totalExpected: refs.length, stage: 'details'},
        current: null, currentUrl: '', nextDueAt: clock(), lastNavigationAt: 0, pages: 1,
        expectedTotal: refs.length, listComplete: true, listIncomplete: false, limited: false,
        counts: {discovered: refs.length, processed: 0, saved: 0, skipped: 0, review: 0, errors: 0, newListings: 0, priceIncreases: 0, priceDecreases: 0}, failures: [], logs: []
      };
      event(`${refs.length} tekil ilan bağlantısı sıraya alındı; detaylar sırayla işlenecek.`);
      await persist(); await tick(); return {ok: true, job: clone(job)};
    }
    async function resume() {
      await load();
      if (!job || !['paused', 'blocked', 'stopped'].includes(job.status)) throw new Error('Devam ettirilecek duraklatılmış iş yok.');
      const tab = await getWorkTab();
      // A closed tab is recreated only by an explicit Resume action.
      if (!tab && job.current) {
        job.current = null;
        job.currentUrl = '';
      }
      job.status = 'running';
      if (job.current?.needsNavigation) job.current.navigationAttempts = 0;
      job.nextDueAt = clock();
      event('Tarama devam ediyor.');
      await persist();
      await watch();
      await tick();
      return {ok: true, job: clone(job)};
    }
    async function capture(message) {
      await load();
      const category = message.category || 'arsa';
      if (category!=='all' && (!CATEGORIES.has(category) || category === 'belirsiz')) throw new Error('İlan kategorisini seçin.');
      let tab;
      if (Number.isInteger(message.tabId)) tab = await api.tabs.get(message.tabId);
      else tab = (await api.tabs.query({active: true, currentWindow: true}))[0];
      if (!tab) throw new Error('İlanın bulunduğu tarayıcı sekmesini seçin.');
      if ((tab.url || '').startsWith('chrome-extension://')) {
        const candidates = (await api.tabs.query({currentWindow: true})).filter(candidate => {
          try { listingRef(candidate.url || ''); return true; } catch (_) { return false; }
        });
        if (!candidates.length) throw new Error('Bu pencerede açık bir Hepsiemlak veya Sahibinden ilan detay sekmesi yok.');
        candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        if (candidates.length > 1 && (!candidates[0].lastAccessed || candidates[0].lastAccessed === candidates[1].lastAccessed)) {
          throw new Error('Açık ilan sekmesi belirlenemedi. İlgili ilanı öne getirip eklenti simgesinden “Açık ilanı al” düğmesine basın.');
        }
        tab = candidates[0];
      }
      const ref = listingRef(tab.url || '');
      const epoch = controlEpoch;
      const response = await readTab(tab.id, {type: 'ILAN_EXTRACT', mode: 'detail', expectedUrl: ref.url, revealPhone: message.revealPhone !== false});
      if (epoch !== controlEpoch) throw new Error('İşlem kullanıcı tarafından durduruldu.');
      if (!response || !response.ok || response.kind !== 'detail') throw new Error(response && response.error || 'Açık ilan okunamadı.');
      const record = await normalizedRecord({...response.record, url: response.record.url || ref.url}, category, '');
      if (listingRef(record.url, ref.source).id !== ref.id) throw new Error('İlan numarası doğrulanamadı.');
      const gate = categoryGate(record, category);
      if (gate !== 'skip') await db.upsertMany([record], {origin: 'crawl', baseline: true, runId: 'capture-' + clock(), observedAt: iso(), listId: String(message.listId || '').slice(0, 100)});
      return {ok: true, record, saved: gate === 'save', review: gate === 'review', skipped: gate === 'skip', job: clone(job)};
    }
    async function handle(message) {
      if (!message || typeof message.type !== 'string') return {ok: false, error: 'Geçersiz komut.'};
      if (['ILAN_PAUSE', 'ILAN_STOP'].includes(message.type)) controlEpoch += 1;
      return serial(async () => {
        try {
          await load();
          switch (message.type) {
            case 'ILAN_STATUS': return {ok: true, job: clone(job)};
            case 'ILAN_START': return await start(message);
            case 'ILAN_START_LINKS': return await startLinks(message);
            case 'ILAN_RESUME': return await resume();
            case 'ILAN_CAPTURE_TAB': return await capture(message);
            case 'ILAN_PAUSE':
              if (!job || job.status !== 'running') throw new Error('Çalışan iş yok.');
              await park('paused', 'Tarama duraklatıldı; sıra korundu.');
              return {ok: true, job: clone(job)};
            case 'ILAN_STOP':
              if (!job) throw new Error('Durdurulacak iş yok.');
              await park('stopped', 'Tarama durduruldu; kaydedilmiş ilanlar ve sıra korundu.');
              return {ok: true, job: clone(job)};
            default: return {ok: false, error: 'Bilinmeyen komut.'};
          }
        } catch (error) { return {ok: false, error: String(error.message || error)}; }
      });
    }
    async function onUpdated(tabId, change, tab) {
      if (change.status !== 'complete') return;
      return serial(async () => {
        await load();
        if (job && job.status === 'running' && job.current && job.workTabId === tabId) {
          // A queued event can describe about:blank or the previous page. Read
          // the live tab state after acquiring the serialized job lock.
          const live = await getWorkTab();
          if (live && live.status === 'complete' && !job.current.needsNavigation && (job.nextDueAt || 0) <= clock()) await readCurrent(live);
        }
      });
    }
    async function onRemoved(tabId) {
      return serial(async () => {
        await load();
        if (job && job.workTabId === tabId && ['running', 'blocked', 'paused'].includes(job.status)) {
          job.workTabId = null;
          await park('paused', 'Çalışma sekmesi kapatıldı; sıra korundu. Devam ile yeni sekme açabilirsiniz.');
        }
      });
    }
    async function recover() {
      return serial(async () => {
        await load();
        if (!job || job.status !== 'running') return;
        await watch();
        await tick();
      });
    }
    return {handle, onUpdated, onRemoved, recover, onAlarm: alarm => [STEP_ALARM, WATCH_ALARM].includes(alarm.name) ? serial(tick) : Promise.resolve()};
  }

  const exported = {createEngine, siteUrl, listingRef, nextPageUrl, pageKey, sameNavigationTarget, categoryGate, JOB_KEY, STEP_ALARM, WATCH_ALARM};
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  root.IlanBackground = exported;
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    if (typeof importScripts === 'function') {
      importScripts('core.js', 'database.js');
      // Optional first-install defaults. The token is copied to extension storage on first start.
      try { importScripts('config.private.js'); } catch (_) { /* Token is entered from the panel. */ }
      importScripts('telegram.js', 'monitoring.js', 'searches.js', 'alerts.js');
    }
    const alerts = root.IlanAlerts.createAlerts(chrome, () => telegram);
    const engine = createEngine(chrome, root.IlanCore, root.IlanDB, {
      onWake: task => dispatch(async () => { await task(); await syncSearchJob(); }),
      onMarketEvents: events => alerts.marketEvents(events),
      onHealthAlert: (field, message, job) => alerts.health(field, message, job)
    });
    const telegram = root.IlanTelegram.createClient(chrome, root.IlanDB, root.IlanPrivateConfig?.telegram || {});
    const monitor = root.IlanMonitor.createEngine(chrome, root.IlanCore, root.IlanDB, telegram, {isCrawlerBusy: async () => {
      const running = (await chrome.storage.local.get(JOB_KEY))[JOB_KEY];
      return running?.status === 'running';
    }});
    const getCurrentJob=async()=>((await chrome.storage.local.get(JOB_KEY))[JOB_KEY]||null);
    const searches=root.IlanSearches.createScheduler(chrome,root.IlanCore,{getJob:getCurrentJob,canStart:async()=>true,startSearch:message=>engine.handle(message)});
    const syncSearchJob=async()=>searches.reconcileJob(await getCurrentJob());
    async function prepareMessageItem(item) {
      if (!item?.url) throw new Error('Hazırlanacak mesaj kaydında ilan bağlantısı yok.');
      let tab = null;
      if (Number.isInteger(item.tabId)) { try { tab = await chrome.tabs.get(item.tabId); } catch (_) { tab = null; } }
      if (!tab) tab = await chrome.tabs.create({url: item.url, active: true});
      else await chrome.tabs.update(tab.id, {url: item.url, active: true});
      await root.IlanDB.updateMessageItem(item.id, {status: 'opening', tabId: tab.id, attempts: Number(item.attempts || 0) + 1});
      return new Promise(resolve => {
        const timeout = setTimeout(async () => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve({ok: false, error: 'İlan sayfası zamanında yüklenmedi. Sekmeyi kontrol edip tekrar deneyin.'});
        }, 90000);
        async function listener(tabId, change) {
          if (tabId !== tab.id || change.status !== 'complete') return;
          clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener);
          try {
            let response;
            try { response = await chrome.tabs.sendMessage(tab.id, {type: 'ILAN_EXTRACT', mode: 'message', expectedUrl: item.url, text: item.message}); }
            catch (_) {
              await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['messaging.js', 'content.js']});
              response = await chrome.tabs.sendMessage(tab.id, {type: 'ILAN_EXTRACT', mode: 'message', expectedUrl: item.url, text: item.message});
            }
            if (!response?.ok) {
              await root.IlanDB.updateMessageItem(item.id, {status: 'error', lastError: response?.error || 'Mesaj kutusu hazırlanamadı.', tabId: tab.id});
              resolve({ok: false, error: response?.error || 'Mesaj kutusu hazırlanamadı.'}); return;
            }
            const updated = await root.IlanDB.updateMessageItem(item.id, {status: 'prepared', preparedAt: new Date().toISOString(), tabId: tab.id, lastError: ''});
            resolve({ok: true, item: updated, message: 'Mesaj kutuya yazıldı. Sahibinden sekmesinde kontrol edip gönderin.'});
          } catch (error) {
            await root.IlanDB.updateMessageItem(item.id, {status: 'error', lastError: String(error.message || error), tabId: tab.id});
            resolve({ok: false, error: String(error.message || error)});
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
      });
    }
    async function handleMessaging(message) {
      if (message.type === 'ILAN_MESSAGE_STATUS') return {ok: true, templates: await root.IlanDB.getMessageTemplates(), queue: await root.IlanDB.getMessageQueue({status: message.status || 'all'})};
      if (message.type === 'ILAN_MESSAGE_TEMPLATE') return {ok: true, template: await root.IlanDB.saveMessageTemplate(message.template || {}), templates: await root.IlanDB.getMessageTemplates()};
      if (message.type === 'ILAN_MESSAGE_QUEUE') return {ok: true, ...(await root.IlanDB.createMessageQueue(message))};
      if (message.type === 'ILAN_MESSAGE_DELETE') return {ok: true, ...(await root.IlanDB.deleteMessageItem(message.id))};
      if (message.type === 'ILAN_MESSAGE_CLEAR') return {ok: true, ...(await root.IlanDB.clearMessageQueue())};
      if (message.type === 'ILAN_MESSAGE_PREPARE_NEXT') {
        const item = message.id ? (await root.IlanDB.getMessageQueue({status: 'all'})).find(row => row.id === message.id) : await root.IlanDB.getNextMessageItem();
        if (!item) return {ok: false, error: 'Kuyrukta hazırlanacak mesaj yok.'};
        return await prepareMessageItem(item);
      }
      if (message.type === 'ILAN_MESSAGE_MARK_SENT') return {ok: true, item: await root.IlanDB.updateMessageItem(message.id, {status: 'sent', sentAt: new Date().toISOString(), lastError: ''})};
      if (message.type === 'ILAN_MESSAGE_SKIP') return {ok: true, item: await root.IlanDB.updateMessageItem(message.id, {status: 'skipped', skippedAt: new Date().toISOString(), lastError: message.reason || ''})};
      return {ok: false, error: 'Bilinmeyen mesaj komutu.'};
    }
    // A shared event queue makes tab navigation decisions atomic across both
    // engines. Pause/stop still reach each engine immediately to cancel late reads.
    let eventQueue = Promise.resolve();
    const trustedStorage = chrome.storage.local.setAccessLevel ? chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}) : Promise.resolve();
    const dispatch = task => {const next = eventQueue.then(() => trustedStorage).then(task);eventQueue = next.catch(() => {});return next;};
    async function route(message) {
      if (message.type.startsWith('ILAN_TELEGRAM_')) return telegram.handle(message);
      if (message.type.startsWith('ILAN_ALERTS_') || message.type.startsWith('ILAN_SAFETY_')) return alerts.handle(message);
      if (message.type.startsWith('ILAN_MONITOR_')) return monitor.handle(message);
      if (message.type.startsWith('ILAN_SEARCH_')) return searches.handle(message);
      if (message.type.startsWith('ILAN_MESSAGE_')) return handleMessaging(message);
      const result=await engine.handle(message);if(result.ok&&message.type!=='ILAN_STATUS')await syncSearchJob();return result;
    }
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!/^ILAN_(START|START_LINKS|PAUSE|RESUME|STOP|STATUS|CAPTURE_TAB|ALERTS_(STATUS|CONFIG|SUMMARY_NOW)|SAFETY_(STATUS|CONFIG)|MONITOR_(STATUS|CONFIG|RUN|PAUSE|RESUME)|TELEGRAM_(STATUS|CONFIG|VERIFY|TEST|RETRY)|SEARCH_(STATUS|SAVE|RUN|TOGGLE|REMOVE)|MESSAGE_(STATUS|TEMPLATE|QUEUE|PREPARE_NEXT|MARK_SENT|SKIP|DELETE|CLEAR))$/.test(message && message.type || '')) return false;
      // Controls originate from our popup/archive. Content scripts on a visited
      // website are readers only, and cannot start or modify archive jobs.
      const extensionRoot = chrome.runtime.getURL('');
      if (sender.id !== chrome.runtime.id || !String(sender.url || '').startsWith(extensionRoot)) {
        sendResponse({ok: false, error: 'Geçersiz gönderen.'}); return false;
      }
      const interrupt = ['ILAN_PAUSE','ILAN_STOP','ILAN_MONITOR_PAUSE'].includes(message.type) || message.type==='ILAN_MONITOR_CONFIG'&&message.enabled===false;
      const operation = interrupt ? Promise.resolve(trustedStorage).then(()=>route(message)) : dispatch(()=>route(message));
      operation.then(sendResponse, error => sendResponse({ok: false, error: String(error?.message || error || 'İşlem tamamlanamadı; arşiv veya takip durumunu kontrol edin.')}));
      return true;
    });
    const failed = () => console.warn('İlan5 arka plan işlemi tamamlanamadı; takip ekranını kontrol edin.');
    chrome.alarms.onAlarm.addListener(alarm => { dispatch(async()=>{await engine.onAlarm(alarm);await syncSearchJob();await searches.onAlarm(alarm);await monitor.onAlarm(alarm);await telegram.onAlarm(alarm);await alerts.onAlarm(alarm);}).catch(failed); });
    chrome.storage.onChanged?.addListener?.((changes, area) => { if(area==='local'&&changes['ilan5.archive.updated']) dispatch(()=>monitor.handle({type:'ILAN_MONITOR_NEW_RECORDS'})).catch(failed); });
    chrome.tabs.onUpdated.addListener((id, change, tab) => { dispatch(async()=>{await engine.onUpdated(id,change,tab);await syncSearchJob();await monitor.onUpdated(id,change,tab);}).catch(failed); });
    chrome.tabs.onRemoved.addListener(id => { dispatch(async()=>{await engine.onRemoved(id);await syncSearchJob();await monitor.onRemoved(id);}).catch(failed); });
    const recover = () => dispatch(async()=>{await alerts.scheduleSummary().catch(()=>{});await telegram.recover();await engine.recover();await searches.recover();await monitor.recover();}).catch(failed);
    chrome.runtime.onStartup.addListener(recover);
    chrome.runtime.onInstalled.addListener(recover);
    // A service worker may restart without onStartup (idle termination/update).
    recover();
  }
})(typeof globalThis === 'undefined' ? self : globalThis);
