/* Durable public-page status monitoring. No background API or CAPTCHA bypass. */
'use strict';
(function (root) {
  const KEY = 'ilan5.monitor.v1';
  const SCHEDULE = 'ilan5.monitor.schedule.v1';
  const STEP = 'ilan5.monitor.step.v1';
  const WATCH = 'ilan5.monitor.watch.v1';
  const GAP = 15000;
  const MINUTE = 60000;

  function sourceUrl(value) {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !['sahibinden.com','hepsiemlak.com'].includes(host)) throw Error('Geçerli bir Sahibinden veya Hepsiemlak adresi gerekli.');
    url.protocol = 'https:'; url.hostname = 'www.' + host; url.hash = '';
    return url;
  }
  function detail(value) {
    const url = sourceUrl(value);
    const source = url.hostname.includes('hepsiemlak.com') ? 'hepsiemlak' : 'sahibinden';
    const id = source === 'hepsiemlak' ? url.pathname.match(/\/(\d+-\d+)\/?$/)?.[1] : url.pathname.match(/^\/ilan\/.+-(\d+)\/detay\/?$/)?.[1];
    if (!id) throw Error('İlan detay adresi gerekli.');
    url.search = ''; url.pathname = url.pathname.replace(/\/$/, '');
    return {url: url.href, listingId: id, source};
  }
  function eligible(record) {
    if (!record || !record.id || record.deletedAt || record.monitoring?.enabled===false || !['sahibinden','hepsiemlak'].includes(record.source)) return false;
    try { const ref = detail(record.url); return record.source === ref.source && (!record.listingId || String(record.listingId) === ref.listingId); } catch (_) { return false; }
  }
  function validateObservation(response, expected) {
    if (!response || response.ok !== true || response.kind !== 'status' || !['active', 'removed', 'unknown'].includes(response.status)) throw Error('Geçerli ilan durumu alınamadı.');
    if (String(response.listingId || '') !== expected.listingId) throw Error('Durum cevabındaki ilan numarası uyuşmuyor.');
    const actual = sourceUrl(response.url);
    let actualId;
    try { const actualRef=detail(actual.href); if(actualRef.source!==expected.source)throw Error('Farklı ilan kaynağına yönlendirildi.'); actualId = actualRef.listingId; } catch (error) { if(/Farklı ilan kaynağı/.test(String(error)))throw error; actualId = ''; }
    if (actualId && actualId !== expected.listingId) throw Error('Farklı ilan sayfasına yönlendirildi.');
    if (!actualId && response.status !== 'unknown') {
      // A removed page may redirect. A visible notice must still identify the
      // exact listing; an anonymous 404 or an unrelated result is insufficient.
      const evidence = String(response.evidence || '').replace(/İ/g, 'I').replace(/ı/g, 'i');
      const explicitId = new RegExp('(?:ilan\\s*(?:no(?:su)?|numaras[ıi])\\s*[:#-]?\\s*)' + expected.listingId + '(?!\\d)', 'iu');
      if (response.status !== 'removed' || !explicitId.test(evidence)) throw Error('Yönlendirilen sayfada ilan kimliği doğrulanamadı.');
    }
    if (response.status === 'removed' && !String(response.evidence || '').trim()) throw Error('Yayından kaldırılma kanıtı bulunamadı.');
    return {...response, evidence: String(response.evidence || '').slice(0, 1600)};
  }

  function observationPatch(previous, status, now, confirmationMinutes, evidence = '', error = '', recordId = '') {
    const prior = previous || {}, at = new Date(now).toISOString();
    const common = {lastCheckedAt: at, lastCheckStatus: status, lastEvidence: String(evidence).slice(0, 1600), lastError: String(error).slice(0, 1000)};
    if (status === 'active') return {...common, status, lastActiveAt: at, firstMissingAt: null, lastMissingAt: null, missingCount: 0, removedAt: null, removalEventId: null, notificationStatus: null, notificationError: '', notifiedAt: null};
    if (status !== 'removed' && prior.status === 'removed' && prior.removalEventId) return {...common, status: 'removed', lastEvidence: prior.lastEvidence || ''};
    if (status !== 'removed') return {...common, status, firstMissingAt: null, lastMissingAt: null, missingCount: 0};
    if (prior.status === 'removed' && prior.removalEventId) return {...common, status: 'removed', lastMissingAt: at, missingCount: Math.max(2, prior.missingCount || 2)};
    const first = Date.parse(prior.firstMissingAt || '');
    if (prior.status !== 'suspected' || !Number.isFinite(first) || !prior.missingCount) return {...common, status: 'suspected', firstMissingAt: at, lastMissingAt: at, missingCount: 1};
    if (now - first < confirmationMinutes * MINUTE) return {...common, status: 'suspected', missingCount: 1};
    const eventId = prior.removalEventId || `${recordId}:removed:${at}`;
    return {...common, status: 'removed', firstMissingAt: prior.firstMissingAt, lastMissingAt: at, missingCount: 2, removedAt: prior.removedAt || at, removalEventId: eventId, notificationStatus: prior.removalEventId ? (prior.notificationStatus || 'pending') : 'pending', notifiedAt: prior.removalEventId ? (prior.notifiedAt || null) : null};
  }

  function createEngine(api, core, db, telegram, options = {}) {
    const clock = options.now || Date.now;
    const crawlerBusy = options.isCrawlerBusy || (async () => false);
    let state, chain = Promise.resolve(), epoch = 0;
    const iso = () => new Date(clock()).toISOString();
    const copy = x => x == null ? x : JSON.parse(JSON.stringify(x));
    const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
    async function load() {
      if (state === undefined) state = (await api.storage.local.get(KEY))[KEY] || {
        version: 1, enabled: true, intervalMinutes: 360, confirmationMinutes: 15,
        paused: false, status: 'idle', phase: 'idle', message: 'İzleme hazır.',
        lastRun: null, lastCompletedAt: null, nextDueAt: clock(), nextFullAt: clock(),
        workTabId: null, queue: [], index: 0, current: null, currentUrl: '',
        lastNavigationAt: 0, nextStepAt: 0, runChecked: 0, counts: {}, logs: []
      };
      return state;
    }
    function event(message) { state.message = message; state.logs = [...(state.logs || []), {at: iso(), message}].slice(-100); }
    function phase(value) { state.status = value; state.phase = value; }
    async function records() { return (await db.getAll()).filter(eligible); }
    async function aggregate() {
      const rows = await records();
      const counts = {tracked: rows.length, active: 0, suspected: 0, removed: 0, unknown: 0, blocked: 0, error: 0, checked: state.runChecked || 0, pending: Math.max(0, (state.queue || []).length - (state.index || 0))};
      rows.forEach(row => { const key = row.monitoring?.status || 'unknown'; counts[Object.hasOwn(counts, key) ? key : 'unknown'] += 1; });
      state.counts = counts; return rows;
    }
    function publicState() {
      return copy({enabled: state.enabled, intervalMinutes: state.intervalMinutes, confirmationMinutes: state.confirmationMinutes,
        status: state.status, phase: state.phase, message: state.message, lastRun: state.lastRun, lastCompletedAt: state.lastCompletedAt,
        nextDue: state.enabled && !state.paused && state.nextDueAt ? new Date(state.nextDueAt).toISOString() : null,
        workTabId: state.workTabId, currentUrl: state.currentUrl || '', counts: state.counts || {}, logs: state.logs || []});
    }
    async function persist() {
      state.updatedAt = iso();
      await api.storage.local.set({[KEY]: state});
      try { const p = api.runtime.sendMessage({type: 'ILAN_MONITOR_UPDATED', monitor: publicState()}); p?.catch?.(() => {}); } catch (_) {}
    }
    async function clearAlarms() { for (const name of [SCHEDULE, STEP, WATCH]) await api.alarms.clear(name); }
    async function watch() { await api.alarms.create(WATCH, {periodInMinutes: 0.5}); }
    async function scheduleStep() {
      if (state.paused || !['running', 'waiting_crawler'].includes(state.phase)) return;
      await api.alarms.create(STEP, {when: Math.max(clock() + 50, state.nextStepAt || clock())}); await watch();
    }
    async function scheduleNext() {
      await api.alarms.clear(STEP); await api.alarms.clear(WATCH);
      if (!state.enabled || state.paused) { await api.alarms.clear(SCHEDULE); return; }
      const rows = await records();
      const confirmations = rows.filter(row => row.monitoring?.status === 'suspected').map(row => Date.parse(row.monitoring.firstMissingAt || '') + state.confirmationMinutes * MINUTE).filter(Number.isFinite);
      state.nextDueAt = Math.max(clock() + GAP, Math.min(state.nextFullAt || clock(), ...confirmations));
      phase('waiting');
      await api.alarms.create(SCHEDULE, {when: state.nextDueAt}); await persist();
    }
    async function park(value, message) {
      phase(value); state.paused = true; event(message); await clearAlarms(); await persist();
    }
    async function tab() { if (!Number.isInteger(state.workTabId)) return null; try { return await api.tabs.get(state.workTabId); } catch (_) { return null; } }
    async function ensureTab() { let current = await tab(); if (!current) { current = core.openWorkTab ? await core.openWorkTab(api) : await api.tabs.create({url: 'about:blank', active: false}); state.workTabId = current.id; await persist(); } return current; }
    async function readTab(tabId, request) {
      try { return await api.tabs.sendMessage(tabId, request); }
      catch (error) {
        if (!/receiving end|connection|could not establish/i.test(String(error))) throw error;
        await api.scripting.executeScript({target: {tabId}, files: ['extractor.js', 'content.js']});
        return api.tabs.sendMessage(tabId, request);
      }
    }
    async function notifyRemoval(record) {
      const monitoring = record.monitoring || {};
      if (monitoring.status !== 'removed' || !monitoring.removalEventId || monitoring.notifiedAt || !['pending', 'queued', null, undefined, 'queue_error'].includes(monitoring.notificationStatus)) return;
      try {
        const result = await telegram.enqueueRemoval(record, monitoring.removalEventId);
        if (!result || !['queued', 'sending', 'sent', 'uncertain', 'failed', 'cancelled'].includes(result.status)) throw Error('Bildirim kuyruğu sonucu doğrulanamadı.');
        // Outbox may have already written 'sent'. Never downgrade a newer state.
        const fresh = await db.get(record.id);
        if (fresh?.monitoring?.removalEventId !== monitoring.removalEventId || fresh.monitoring.status !== 'removed') return;
        if (fresh.monitoring.notificationStatus === 'sent') return;
        await db.patchMonitoring(record.id, {notificationStatus: result.status});
      } catch (error) {
        // The confirmed event is already durable; recover will queue the same ID.
        event('Kaldırılma kaydedildi; bildirim kuyruğu daha sonra yeniden denenecek.');
        try { await db.patchMonitoring(record.id, {notificationStatus: 'queue_error'}); } catch (_) {}
      }
    }
    async function reconcile() {
      for (const record of await records()) if (record.monitoring?.status === 'removed') await notifyRemoval(record);
    }
    async function enqueueNewRecords() {
      await load();
      if (!state.enabled || state.paused) return 0;
      const rows = await records();
      const alreadyQueued = new Set([...(state.queue || []).slice(state.index || 0).map(item => item.id), state.current?.id].filter(Boolean));
      const fresh = rows.filter(record => !record.monitoring?.lastCheckedAt && !alreadyQueued.has(record.id));
      if (!fresh.length) return 0;
      fresh.sort((a, b) => String(a.firstSeenAt || a.capturedAt || a.createdAt || '').localeCompare(String(b.firstSeenAt || b.capturedAt || b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
      const additions = fresh.map(record => ({id: record.id, ...detail(record.url)}));
      const hasPending = Boolean(state.current || (state.queue || []).length > (state.index || 0));
      if (!hasPending && clock() >= (state.nextFullAt || 0)) { await beginRun(false); return additions.length; }
      if (hasPending) state.queue.push(...additions);
      else { state.queue = additions; state.index = 0; state.current = null; state.currentUrl = ''; state.runChecked = 0; state.lastRun = iso(); }
      state.paused = false;
      phase('running'); state.nextStepAt = Math.min(state.nextStepAt || clock(), clock());
      event(`${additions.length} yeni ilan otomatik yayın kontrolü sırasına eklendi.`);
      await aggregate(); await persist(); await scheduleStep(); await tick();
      return additions.length;
    }
    async function finishItem() {
      state.index += 1; state.runChecked += 1; state.current = null; state.currentUrl = '';
      state.nextStepAt = Math.max(clock(), state.lastNavigationAt || 0) + GAP;
      await aggregate(); await persist(); await scheduleStep();
    }
    async function saveObservation(record, status, evidence, error) {
      const patch = observationPatch(record.monitoring, status, clock(), state.confirmationMinutes, evidence, error, record.id);
      // Preserve all archive fields and commit the event before enqueuing alerts.
      await db.patchMonitoring(record.id, patch);
      const fresh = await db.get(record.id);
      if (!fresh || !eligible(fresh)) throw Error('İzleme sonucu arşivde doğrulanamadı.');
      if (status === 'removed' && patch.status === 'removed') await notifyRemoval(fresh);
      event(`İlan ${detail(record.url).listingId}: ${({active: 'yayında', suspected: 'ilk kaldırılma işareti; ikinci kontrol beklenecek', removed: 'kaldırılma doğrulandı', unknown: 'durum doğrulanamadı', blocked: 'doğrulama bekleniyor', error: 'kontrol hatası'})[patch.status]}.`);
    }
    async function readCurrent(liveTab) {
      if (!state.current || state.paused || liveTab.id !== state.workTabId) return;
      const current = state.current, startedEpoch = epoch;
      const record = await db.get(current.id);
      if (!eligible(record) || detail(record.url).listingId !== current.listingId) { await finishItem(); return; }
      current.stage = 'reading'; await persist();
      let response;
      try { response = await readTab(liveTab.id, {type: 'ILAN_EXTRACT', mode: 'status', expectedUrl: current.url, revealPhone: false}); }
      catch (error) { response = {ok: false, kind: 'error', error: String(error.message || error)}; }
      if (startedEpoch !== epoch) { current.stage = 'ready'; await persist(); return; }
      try {
        if (!response?.ok && ['blocked', 'login'].includes(response?.kind)) {
          await saveObservation(record, 'blocked', '', response.error || 'Tarayıcı doğrulaması gerekli.');
          current.stage = 'ready';
          await aggregate(); await park('blocked', 'İzleme durdu. Çalışma sekmesinde doğrulamayı tamamlayıp Devam düğmesine basın.'); return;
        }
        if (!response?.ok) await saveObservation(record, response?.kind === 'mismatch' ? 'unknown' : 'error', '', response?.error || 'Durum cevabı alınamadı.');
        else {
          let observation;
          try { observation = validateObservation(response, current); }
          catch (error) { await saveObservation(record, 'unknown', '', error.message); }
          if (observation) await saveObservation(record, observation.status, observation.evidence, '');
        }
      } catch (error) {
        current.stage = 'ready';
        await park('paused', 'İzleme sonucu kaydedilemedi; bildirim gönderilmedi. ' + String(error.message || error)); return;
      }
      await finishItem();
    }
    async function beginRun(manual = false) {
      if (state.current || (state.queue.length && state.index < state.queue.length)) {
        state.paused = false; phase('running'); state.nextStepAt = clock(); await persist(); await tick(); return;
      }
      const rows = await records();
      const full = manual || clock() >= (state.nextFullAt || 0);
      const due = full ? rows : rows.filter(record => record.monitoring?.status === 'suspected' && clock() >= Date.parse(record.monitoring.firstMissingAt || '') + state.confirmationMinutes * MINUTE);
      due.sort((a, b) => (Date.parse(a.monitoring?.lastCheckedAt || '') || 0) - (Date.parse(b.monitoring?.lastCheckedAt || '') || 0) || String(a.id).localeCompare(String(b.id)));
      const seen = new Set();
      state.queue = due.map(record => ({id: record.id, ...detail(record.url)})).filter(ref => { const key=ref.source+':'+ref.listingId;if (seen.has(key)) return false; seen.add(key); return true; });
      state.index = 0; state.runChecked = 0; state.paused = false; state.current = null; state.currentUrl = '';
      state.lastRun = iso(); state.nextStepAt = clock();
      if (full) state.nextFullAt = clock() + state.intervalMinutes * MINUTE;
      phase('running'); event(state.queue.length ? `${state.queue.length} arşiv ilanının durumu kontrol edilecek.` : 'Kontrol zamanı gelen arşiv ilanı yok.');
      await aggregate(); await persist(); await tick();
    }
    async function tick() {
      await load();
      if (state.paused || !['running', 'waiting_crawler'].includes(state.phase)) return;
      if (await crawlerBusy()) {
        phase('waiting_crawler'); state.nextStepAt = clock() + 30000;
        event('İlan toplama işi sürüyor; izleme sırası bekliyor.'); await persist(); await scheduleStep(); return;
      }
      phase('running');
      if (!state.current) state.nextStepAt = Math.max(state.nextStepAt || 0, (state.lastNavigationAt || 0) + GAP);
      if (state.nextStepAt > clock()) { await scheduleStep(); return; }
      if (state.current) {
        const live = await tab();
        if (!live) { await park('paused', 'İzleme sekmesi kapatıldı. Devam düğmesi yeni bir sekme açar.'); return; }
        if (live.status === 'complete') { await readCurrent(live); return; }
        if (clock() - state.current.startedAt > 90000) {
          const record = await db.get(state.current.id);
          try { if (eligible(record)) await saveObservation(record, 'error', '', 'Sayfa 90 saniye içinde yüklenmedi.'); await finishItem(); }
          catch (error) { await park('paused', 'İzleme sonucu kaydedilemedi: ' + error.message); }
        }
        return;
      }
      while (state.index < state.queue.length) {
        const ref = state.queue[state.index], fresh = await db.get(ref.id);
        if (eligible(fresh) && detail(fresh.url).listingId === ref.listingId) break;
        state.index += 1;
      }
      if (state.index >= state.queue.length) {
        state.lastCompletedAt = iso(); state.currentUrl = ''; state.queue = []; state.index = 0;
        phase('idle'); event('İzleme turu tamamlandı.'); await aggregate(); await persist(); await scheduleNext(); return;
      }
      const live = await ensureTab();
      state.current = {...state.queue[state.index], stage: 'navigating', startedAt: clock()};
      state.currentUrl = state.current.url; state.lastNavigationAt = clock();
      event(`Durum kontrolü ${state.index + 1}/${state.queue.length}: ${state.current.listingId}`);
      await persist(); await watch();
      try { await api.tabs.update(live.id, {url: state.current.url}); }
      catch (error) { await park('paused', 'İzleme sayfası açılamadı: ' + error.message); }
    }
    async function handle(message) {
      if (['ILAN_MONITOR_PAUSE', 'ILAN_MONITOR_CONFIG'].includes(message?.type)) epoch += 1;
      return serial(async () => {
        try {
          await load();
          switch (message?.type) {
            case 'ILAN_MONITOR_STATUS': await aggregate(); break;
            case 'ILAN_MONITOR_NEW_RECORDS': await enqueueNewRecords(); break;
            case 'ILAN_MONITOR_CONFIG': {
              const interval = Number(message.intervalMinutes ?? state.intervalMinutes), confirmation = Number(message.confirmationMinutes ?? state.confirmationMinutes);
              if (!Number.isFinite(interval) || interval < 10 || interval > 43200) throw Error('Kontrol aralığı 10–43200 dakika arasında olmalı.');
              if (!Number.isFinite(confirmation) || confirmation < 10 || confirmation > 10080) throw Error('Kaldırılma doğrulama aralığı en az 10 dakika olmalı.');
              state.intervalMinutes = interval; state.confirmationMinutes = confirmation;
              if (message.enabled != null) state.enabled = !!message.enabled;
              if (!state.enabled) { await park('paused', 'Otomatik izleme kapatıldı; kayıtlar korundu.'); break; }
              state.paused = false; state.nextFullAt = Math.min(state.nextFullAt || clock(), clock() + interval * MINUTE);
              if (state.current || state.index < state.queue.length) { phase('running'); state.nextStepAt = clock(); await persist(); await scheduleStep(); }
              else { event('İzleme ayarları kaydedildi.'); await scheduleNext(); }
              break;
            }
            case 'ILAN_MONITOR_RUN': state.paused = false; await beginRun(true); break;
            case 'ILAN_MONITOR_PAUSE': await park('paused', 'İzleme duraklatıldı; sıra korundu.'); break;
            case 'ILAN_MONITOR_RESUME': {
              state.enabled = true; state.paused = false;
              if (state.current && !(await tab())) { state.current = null; state.currentUrl = ''; }
              await enqueueNewRecords();
              if (state.current || state.index < state.queue.length) { state.paused = false; phase('running'); state.nextStepAt = clock(); await persist(); await scheduleStep(); await tick(); }
              else await beginRun(false);
              break;
            }
            default: throw Error('Bilinmeyen izleme komutu.');
          }
          return {ok: true, monitor: publicState()};
        } catch (error) { return {ok: false, error: String(error.message || error)}; }
      });
    }
    async function onAlarm(alarm) {
      if (![SCHEDULE, STEP, WATCH].includes(alarm.name)) return;
      return serial(async () => {
        await load();
        if (state.paused) return;
        if (alarm.name === SCHEDULE) { if (state.enabled && clock() >= state.nextDueAt) await beginRun(false); }
        else await tick();
      });
    }
    async function onUpdated(id, change) {
      if (change.status !== 'complete') return;
      return serial(async () => {
        await load();
        if (!state.paused && state.phase === 'waiting_crawler' && !(await crawlerBusy())) { state.nextStepAt = clock(); await tick(); return; }
        if (state.paused || !state.current || state.workTabId !== id) return;
        if (await crawlerBusy()) { state.nextStepAt = clock() + 30000; phase('waiting_crawler'); await persist(); await scheduleStep(); return; }
        const live = await tab(); if (live?.status === 'complete') await readCurrent(live);
      });
    }
    async function onRemoved(id) {
      return serial(async () => { await load(); if (state.workTabId === id) { state.workTabId = null; if (state.current) await park('paused', 'İzleme sekmesi kapatıldı; sıra korundu.'); else await persist(); } });
    }
    async function recover() {
      return serial(async () => {
        await load(); await reconcile(); await aggregate();
        if (state.paused) { await clearAlarms(); await persist(); return; }
        await enqueueNewRecords();
        if (state.current || state.index < state.queue.length) { phase('running'); await watch(); await tick(); }
        else if (state.enabled) { if (clock() >= state.nextDueAt) await beginRun(false); else await scheduleNext(); }
      });
    }
    async function isBusy() { await load(); return !state.paused && state.phase === 'running' && (!!state.current || state.index < state.queue.length); }
    return {handle, onAlarm, onUpdated, onRemoved, recover, isBusy};
  }
  const exported = {createEngine, eligible, detail, validateObservation, observationPatch, KEY, SCHEDULE, STEP, WATCH};
  root.IlanMonitor = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof globalThis === 'undefined' ? self : globalThis);
