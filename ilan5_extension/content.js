(() => {
  'use strict';
  if (globalThis.__ilanArchiveContentLoaded) return;
  globalThis.__ilanArchiveContentLoaded = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'ILAN_EXTRACT') return;
    (async () => {
      const extractor = globalThis.IlanExtractor;
      if (!extractor) throw new Error('İlan okuyucu yüklenemedi. Sayfayı yenileyin.');
      if (message.mode === 'list') return extractor.discoverList(message);
      if (message.mode === 'detail') return extractor.extractListing(message);
      if (message.mode === 'status') return extractor.checkStatus(message);
      if (message.mode === 'message') {
        if (!globalThis.IlanMessaging) throw new Error('Mesaj hazırlayıcı yüklenemedi. Sayfayı yenileyin.');
        return globalThis.IlanMessaging.prepare(message);
      }
      return extractor.inspect(message.expectedUrl);
    })().then(sendResponse).catch(error => sendResponse({ok: false, kind: error.kind || 'error', error: error.message || 'Sayfa okunamadı.'}));
    return true;
  });
})();
