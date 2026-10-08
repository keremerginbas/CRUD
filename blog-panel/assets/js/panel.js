(() => {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const toasts = document.querySelector('[data-toasts]');

  function toast(message, ok = true) {
    if (!toasts) return alert(message);
    const el = document.createElement('div');
    el.className = 'toast' + (ok ? '' : ' err');
    el.textContent = message;
    toasts.appendChild(el);
    setTimeout(() => el.remove(), ok ? 6000 : 12000);
  }

  async function runAction(action, data = {}) {
    const body = new FormData();
    body.append('action', action);
    body.append('_csrf', csrf);
    Object.entries(data).forEach(([k, v]) => body.append(k, v));
    const res = await fetch('api/action.php', { method: 'POST', body, headers: { 'X-CSRF-Token': csrf } });
    let json;
    try { json = await res.json(); } catch { throw new Error('Sunucu beklenmeyen yanıt döndü (HTTP ' + res.status + ').'); }
    if (!json.ok) throw new Error(json.error || 'İşlem başarısız.');
    return json;
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    e.preventDefault();
    const form = btn.closest('form');
    if (form && form.dataset.dirty && btn.dataset.action.startsWith('test_')) {
      toast('Test kayıtlı ayarları kullanır. Önce sayfanın altındaki "Kaydet" butonuna basın, sonra tekrar test edin.', false);
      return;
    }
    if (btn.dataset.confirm && !confirm(btn.dataset.confirm)) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Bekleyin…';
    try {
      const json = await runAction(btn.dataset.action, btn.dataset.id ? { id: btn.dataset.id } : {});
      toast(json.message || 'Tamam');
      if (json.reload) setTimeout(() => location.reload(), 1200);
    } catch (err) {
      toast(err.message, false);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  document.addEventListener('change', async (e) => {
    const input = e.target.closest('input[type=checkbox][data-action]');
    if (!input) return;
    input.disabled = true;
    try {
      const json = await runAction(input.dataset.action, { id: input.dataset.id, value: input.checked ? '1' : '' });
      toast(json.message);
    } catch (err) {
      input.checked = !input.checked;
      toast(err.message, false);
    } finally {
      input.disabled = false;
    }
  });

  document.querySelectorAll('form.form').forEach((f) => {
    f.addEventListener('input', () => { f.dataset.dirty = '1'; });
  });

  document.querySelectorAll('[data-confirm-submit]').forEach((btn) => {
    btn.addEventListener('click', (e) => { if (!confirm(btn.dataset.confirmSubmit)) e.preventDefault(); });
  });

  document.querySelector('[data-generate-secret]')?.addEventListener('click', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const input = document.querySelector('[data-secret]');
    input.type = 'text';
    input.value = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    toast('Yeni anahtar üretildi. Kaydetmeyi ve n8n credential\'ını güncellemeyi unutmayın.');
  });

  const methodSelect = document.querySelector('[data-method-select]');
  if (methodSelect) {
    const sync = () => document.querySelectorAll('[data-method]').forEach((el) => {
      el.hidden = !el.dataset.method.split(' ').includes(methodSelect.value);
    });
    methodSelect.addEventListener('change', sync);
    sync();
  }

  document.querySelectorAll('[data-nav-toggle]').forEach((btn) => btn.addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  }));
})();
