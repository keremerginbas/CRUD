/* İlan5 message campaign panel. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const state = {queue: [], templates: [], busy: false};
  function toast(message, error = false) {
    const node = $('toast'); if (!node) return;
    node.textContent = message; node.classList.toggle('error', error); node.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, error ? 8500 : 4500);
  }
  async function runtime(type, config = {}) {
    if (!globalThis.chrome?.runtime?.sendMessage) throw Error('Bu ekranı kurulu İlan5 eklentisi üzerinden açın.');
    const result = await chrome.runtime.sendMessage({type, ...config});
    if (!result?.ok) throw Error(result?.error || 'İşlem tamamlanamadı.');
    return result;
  }
  function statusText(status) {
    return {queued:'Bekliyor',opening:'Açılıyor',prepared:'Hazırlandı',sent:'Gönderildi',skipped:'Atlandı',error:'Hata'}[status] || status || 'Bekliyor';
  }
  function counts() {
    const c = {queued:0, prepared:0, sent:0, skipped:0, error:0};
    for (const item of state.queue) if (Object.hasOwn(c, item.status)) c[item.status] += 1;
    $('messageQueued').textContent = c.queued.toLocaleString('tr-TR');
    $('messageQueuedNav').textContent = c.queued.toLocaleString('tr-TR');
    $('messagePrepared').textContent = c.prepared.toLocaleString('tr-TR');
    $('messageSent').textContent = c.sent.toLocaleString('tr-TR');
    $('messageSkipped').textContent = c.skipped.toLocaleString('tr-TR');
    $('messageErrors').textContent = c.error.toLocaleString('tr-TR');
    $('messageReadyBadge').textContent = c.queued ? `${c.queued.toLocaleString('tr-TR')} mesaj bekliyor` : c.prepared ? 'Hazırlanan mesaj var' : 'Hazır';
    $('prepareNextMessageBtn').disabled = state.busy || !c.queued;
    $('markPreparedSentBtn').disabled = state.busy || !c.prepared;
    $('sentAndNextMessageBtn').disabled = state.busy || !c.prepared;
  }
  function renderQueue() {
    counts();
    const body = $('messageQueueBody'); body.replaceChildren();
    const rows = state.queue.slice().sort((a,b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).slice(0, 80);
    $('messageEmpty').hidden = Boolean(rows.length);
    for (const item of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="message-status ${esc(item.status)}">${esc(statusText(item.status))}</span>${item.lastError?`<small class="message-error">${esc(item.lastError)}</small>`:''}</td><td><strong>${esc(item.title || 'Başlık yok')}</strong><small>${esc(item.listingId || '')}</small></td><td>${esc(item.sellerName || 'Satıcı okunmadı')}</td><td><span class="message-preview">${esc(item.message || '')}</span></td><td><div class="message-actions"><button class="button compact secondary" data-prepare="${esc(item.id)}">Hazırla</button><button class="button compact secondary" data-sent="${esc(item.id)}">Gönderildi</button><button class="button compact plain" data-skip="${esc(item.id)}">Atla</button><button class="button compact plain message-delete" data-delete="${esc(item.id)}" aria-label="Mesaj kaydını sil">Sil</button></div></td>`;
      body.append(tr);
    }
  }
  async function refresh() {
    try {
      const result = await runtime('ILAN_MESSAGE_STATUS', {status: 'all'});
      state.queue = result.queue || []; state.templates = result.templates || [];
      const template = state.templates[0];
      if (template) { $('messageTemplateName').value = template.name || ''; $('messageTemplateBody').value = template.body || ''; }
      renderQueue();
    } catch (error) { toast(error.message, true); }
  }
  async function action(fn) {
    if (state.busy) return; state.busy = true; counts();
    try { await fn(); await refresh(); }
    catch (error) { toast(error.message, true); }
    finally { state.busy = false; counts(); }
  }
  function bind() {
    const togglePanel = open => { $('messagePanelBody').hidden = !open; $('messagePanel').dataset.collapsed=String(!open); $('toggleMessagePanelBtn').setAttribute('aria-expanded',String(open)); $('toggleMessagePanelBtn').textContent = open ? 'Kampanyayı kapat' : 'Kampanyayı aç'; if(open)$('messagePanel').scrollIntoView({behavior:'smooth',block:'start'}); };
    $('navMessageBtn')?.addEventListener('click', () => togglePanel(true));
    $('toggleMessagePanelBtn')?.addEventListener('click', () => togglePanel($('messagePanelBody').hidden));
    $('clearMessageQueueBtn')?.addEventListener('click', () => action(async () => {
      if(!confirm('Mesaj kuyruğundaki kayıtları temizleyeyim mi? İlan arşiviniz ve şablonunuz korunur.'))return;
      const result=await runtime('ILAN_MESSAGE_CLEAR');
      toast(`${Number(result.deleted||0).toLocaleString('tr-TR')} mesaj kaydı silindi.${result.protectedCount?` ${result.protectedCount} hazırlanmakta olan kayıt korundu.`:''}`);
    }));
    $('messageTemplateForm').addEventListener('submit', event => action(async () => {
      event.preventDefault();
      await runtime('ILAN_MESSAGE_TEMPLATE', {template: {id: state.templates[0]?.id || 'default-arsa', name: $('messageTemplateName').value, body: $('messageTemplateBody').value}});
      toast('Mesaj şablonu kaydedildi.');
    }));
    $('messageQueueForm').addEventListener('submit', event => action(async () => {
      event.preventDefault();
      const result = await runtime('ILAN_MESSAGE_QUEUE', {category: $('messageCategory').value, limit: Number($('messageLimit').value || 0), skipSameSeller: $('messageSkipSeller').checked, templateId: state.templates[0]?.id});
      toast(`${Number(result.created || 0).toLocaleString('tr-TR')} mesaj kuyruğa eklendi.${result.skippedContacted ? ` Daha önce yazılan veya kuyrukta olan satıcıya ait ${Number(result.skippedContacted).toLocaleString('tr-TR')} ilan atlandı.` : ''}`);
    }));
    $('prepareNextMessageBtn').addEventListener('click', () => action(async () => {
      const result = await runtime('ILAN_MESSAGE_PREPARE_NEXT');
      toast(result.message || 'Mesaj hazırlandı; Sahibinden sekmesini kontrol edin.');
    }));
    $('markPreparedSentBtn').addEventListener('click', () => action(async () => {
      const item = state.queue.find(row => row.status === 'prepared');
      if (!item) throw Error('Gönderildi işaretlenecek hazırlanmış mesaj yok.');
      await runtime('ILAN_MESSAGE_MARK_SENT', {id: item.id});
      toast('Hazırlanan mesaj gönderildi olarak işaretlendi.');
    }));
    $('sentAndNextMessageBtn').addEventListener('click', () => action(async () => {
      const item = state.queue.find(row => row.status === 'prepared');
      if (!item) throw Error('Önce bir mesaj hazırlayın, Sahibinden’de gönderin, sonra bu düğmeye basın.');
      await runtime('ILAN_MESSAGE_MARK_SENT', {id: item.id});
      const next = state.queue.find(row => row.status === 'queued' && row.id !== item.id);
      if (!next) { toast('Gönderildi olarak işaretlendi. Kuyrukta sıradaki mesaj yok.'); return; }
      const result = await runtime('ILAN_MESSAGE_PREPARE_NEXT', {id: next.id});
      toast(result.message || 'Gönderildi kaydedildi; sıradaki mesaj hazırlandı.');
    }));
    $('messageQueueBody').addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      const id = button.dataset.prepare || button.dataset.sent || button.dataset.skip || button.dataset.delete;
      if (!id) return;
      action(async () => {
        if (button.dataset.prepare) { const result = await runtime('ILAN_MESSAGE_PREPARE_NEXT', {id}); toast(result.message || 'Mesaj hazırlandı.'); }
        if (button.dataset.sent) { await runtime('ILAN_MESSAGE_MARK_SENT', {id}); toast('Mesaj gönderildi olarak işaretlendi.'); }
        if (button.dataset.skip) { await runtime('ILAN_MESSAGE_SKIP', {id, reason: 'Panelden atlandı'}); toast('Mesaj atlandı.'); }
        if (button.dataset.delete) { if(!confirm('Bu mesaj kampanyası kaydı silinsin mi? İlan arşivinde değişiklik yapılmaz.'))return; await runtime('ILAN_MESSAGE_DELETE',{id}); toast('Mesaj kaydı silindi.'); }
      });
    });
  }
  document.addEventListener('DOMContentLoaded', () => { bind(); refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 8000); });
})();
