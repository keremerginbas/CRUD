/*
 * Blog Panel arayüz davranışları.
 * Kütüphaneler (assets/vendor): Motion (framer-motion'ın JS sürümü), GSAP + ScrollTrigger, Lucide ikonları, canvas-confetti.
 * Biri yüklenemezse panel animasyonsuz çalışmaya devam eder.
 */
(() => {
  const root = document.documentElement;
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const toasts = document.querySelector('[data-toasts]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const M = !reduced && window.Motion ? window.Motion : null;
  const gsap = !reduced && window.gsap ? window.gsap : null;
  const ease = [0.22, 1, 0.36, 1];

  /* ---------------- İkonlar (Lucide) ---------------- */
  function iconSvg(name, extra = '') {
    const body = window.LucideIcons?.[name];
    if (!body) return '';
    return '<svg class="' + ('icon ' + extra).trim() + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  /* ---------------- Bildirimler ---------------- */
  function toast(message, ok = true) {
    if (!toasts) return alert(message);
    const ttl = ok ? 6000 : 12000;
    const el = document.createElement('div');
    el.className = 'toast' + (ok ? '' : ' err');
    el.setAttribute('role', ok ? 'status' : 'alert');
    el.innerHTML = iconSvg(ok ? 'circle-check' : 'circle-x')
      + '<div class="toast-msg"></div><button class="toast-close" type="button" aria-label="Kapat">' + iconSvg('x') + '</button><span class="toast-bar"></span>';
    el.querySelector('.toast-msg').textContent = message;
    toasts.appendChild(el);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      if (!M) return el.remove();
      M.animate(el, { opacity: 0, x: 48, scale: 0.96 }, { duration: 0.28, ease }).then(() => el.remove());
    };
    el.querySelector('.toast-close').addEventListener('click', close);
    if (M) {
      M.animate(el, { opacity: [0, 1], y: [24, 0], scale: [0.94, 1] }, { type: 'spring', bounce: 0.28, duration: 0.55 });
      M.animate(el.querySelector('.toast-bar'), { scaleX: [1, 0] }, { duration: ttl / 1000, ease: 'linear' });
    }
    setTimeout(close, ttl);
  }

  /* ---------------- Onay penceresi (AlertDialog) ---------------- */
  function confirmDialog({ message, confirmLabel = 'Onayla', danger = false }) {
    if (typeof HTMLDialogElement !== 'function') return Promise.resolve(window.confirm(message));
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'dialog' + (danger ? ' danger' : '');
      dlg.innerHTML = '<div class="dialog-body"><div class="dialog-icon">' + iconSvg(danger ? 'triangle-alert' : 'circle-help') + '</div>'
        + '<h3>' + (danger ? 'Bu işlem geri alınamaz' : 'Onaylıyor musunuz?') + '</h3><p></p></div>'
        + '<div class="dialog-foot"><button class="btn" type="button" value="0">Vazgeç</button><button class="btn btn-primary" type="button" value="1"></button></div>';
      dlg.querySelector('p').textContent = message;
      dlg.querySelector('[value="1"]').textContent = confirmLabel;
      document.body.appendChild(dlg);
      dlg.showModal();
      dlg.querySelector('[value="1"]').focus();
      if (M) M.animate(dlg, { opacity: [0, 1], scale: [0.94, 1], y: [8, 0] }, { type: 'spring', bounce: 0.25, duration: 0.45 });

      let done = false;
      const finish = (answer) => {
        if (done) return;
        done = true;
        const remove = () => { dlg.close(); dlg.remove(); resolve(answer); };
        if (!M) return remove();
        M.animate(dlg, { opacity: 0, scale: 0.96 }, { duration: 0.16, ease }).then(remove);
      };
      dlg.addEventListener('click', (e) => {
        const btn = e.target.closest('button[value]');
        if (btn) finish(btn.value === '1');
        else if (e.target === dlg) finish(false);
      });
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    });
  }
  const labelOf = (btn) => btn.textContent.trim().replace(/\s+/g, ' ') || 'Onayla';

  /* ---------------- Konfeti ---------------- */
  function celebrate(btn, big = false) {
    if (!window.confetti) return;
    const r = btn?.getBoundingClientRect();
    const origin = r ? { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight } : { x: 0.5, y: 0.4 };
    const colors = ['#818cf8', '#6366f1', '#a78bfa', '#34d399', '#f0abfc', '#ffffff'];
    const fire = (ratio, opts) => window.confetti({ origin, colors, disableForReducedMotion: true, zIndex: 80, particleCount: Math.round((big ? 220 : 70) * ratio), ...opts });
    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    if (big) {
      fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
      fire(0.1, { spread: 120, startVelocity: 45 });
    }
  }

  /* ---------------- AJAX işlemleri ---------------- */
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

  function setLoading(btn, on) {
    if (on) {
      btn.dataset.html = btn.innerHTML;
      btn.style.width = btn.offsetWidth + 'px';
      btn.classList.add('is-loading');
      btn.disabled = true;
      btn.innerHTML = (iconSvg('loader-circle', 'spin') || '') + 'Bekleyin…';
    } else {
      btn.innerHTML = btn.dataset.html || btn.innerHTML;
      btn.style.width = '';
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    e.preventDefault();
    const action = btn.dataset.action;
    const form = btn.closest('form');
    if (form && form.dataset.dirty && action.startsWith('test_')) {
      toast('Test kayıtlı ayarları kullanır. Önce sayfanın altındaki "Kaydet" butonuna basın, sonra tekrar test edin.', false);
      return;
    }
    if (btn.dataset.confirm && !(await confirmDialog({ message: btn.dataset.confirm, confirmLabel: labelOf(btn) }))) return;
    setLoading(btn, true);
    try {
      const json = await runAction(action, btn.dataset.id ? { id: btn.dataset.id } : {});
      toast(json.message || 'Tamam');
      if (action === 'trigger') celebrate(btn, true);
      else if (action.startsWith('test_') || action === 'sync_whm') celebrate(btn);
      if (json.reload) setTimeout(() => location.reload(), 1400);
    } catch (err) {
      toast(err.message, false);
      if (M) M.animate(btn, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.4 });
    } finally {
      setLoading(btn, false);
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

  // Form gönderen tehlikeli butonlar: önce onay penceresi, sonra aynı butonla gönder (name/value korunur)
  document.querySelectorAll('[data-confirm-submit]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      if (btn.dataset.confirmed) { delete btn.dataset.confirmed; return; }
      e.preventDefault();
      const ok = await confirmDialog({
        message: btn.dataset.confirmSubmit,
        confirmLabel: labelOf(btn),
        danger: btn.classList.contains('btn-danger') || 'danger' in btn.dataset,
      });
      if (!ok) return;
      btn.dataset.confirmed = '1';
      if (btn.form?.requestSubmit) btn.form.requestSubmit(btn); else btn.click();
    });
  });

  document.querySelector('[data-generate-secret]')?.addEventListener('click', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const input = document.querySelector('[data-secret]');
    input.type = 'text';
    input.value = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    if (input.form) input.form.dataset.dirty = '1';
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

  /* ---------------- Kartlarda imleci takip eden ışık ---------------- */
  document.querySelectorAll('.card, .auth-card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', e.clientX - r.left + 'px');
      card.style.setProperty('--my', e.clientY - r.top + 'px');
    });
  });

  /* ---------------- Menüde kayan vurgu ---------------- */
  const glideNav = document.querySelector('[data-glide]');
  const glider = glideNav?.querySelector('[data-glider]');
  if (glideNav && glider && M) {
    let visible = false;
    glideNav.querySelectorAll('a').forEach((a) => a.addEventListener('pointerenter', () => {
      M.animate(glider, { top: a.offsetTop + 'px', height: a.offsetHeight + 'px', opacity: 1 },
        visible ? { type: 'spring', bounce: 0.18, duration: 0.4 } : { duration: 0 });
      visible = true;
    }));
    glideNav.addEventListener('pointerleave', () => {
      M.animate(glider, { opacity: 0 }, { duration: 0.25 });
      visible = false;
    });
  }

  /* ---------------- Sayfa girişi (Motion) ---------------- */
  const main = document.querySelector('main.container, main.auth-card');
  if (M && main) {
    const targets = [];
    const isGroup = (el) => el.matches('.stats, .grid-2.gap, .grid-side, form:not(.card)');
    const collect = (parent) => [...parent.children].forEach((el) => {
      if (el.matches('script, input[type=hidden]')) return;
      if (isGroup(el)) collect(el); else targets.push(el);
    });
    collect(main);
    targets.forEach((el) => { el.style.opacity = '0'; });
    root.classList.remove('js-motion');
    M.animate(targets, { opacity: [0, 1], y: [18, 0], filter: ['blur(6px)', 'blur(0px)'] },
      { duration: 0.7, delay: M.stagger(0.06, { startDelay: 0.05 }), ease });

    // Tablo satırları görünür olunca sırayla gelir
    document.querySelectorAll('main tbody').forEach((tbody) => {
      const rows = [...tbody.rows].slice(0, 30);
      rows.forEach((r) => { r.style.opacity = '0'; });
      M.inView(tbody, () => {
        M.animate(rows, { opacity: [0, 1], x: [-8, 0] }, { duration: 0.45, delay: M.stagger(0.035, { startDelay: 0.25 }), ease });
      }, { amount: 0.1 });
    });

    // İstatistik sayıları sıfırdan sayar ("3 / 8" gibi değerlerde ilk sayı)
    document.querySelectorAll('[data-count]').forEach((el) => {
      const m = el.textContent.trim().match(/^(\d+)(.*)$/);
      if (!m || +m[1] === 0) return;
      const to = +m[1];
      el.textContent = '0' + m[2];
      M.animate(0, to, { duration: 1.2, delay: 0.35, ease, onUpdate: (v) => { el.textContent = Math.round(v) + m[2]; } });
    });
  } else {
    root.classList.remove('js-motion');
  }

  /* ---------------- Paralaks (GSAP + ScrollTrigger) ---------------- */
  if (gsap && window.ScrollTrigger) {
    gsap.registerPlugin(window.ScrollTrigger);
    document.querySelectorAll('[data-parallax]').forEach((el) => {
      const speed = parseFloat(el.dataset.parallax) || 0;
      gsap.to(el, {
        y: () => Math.min(900, document.documentElement.scrollHeight - innerHeight) * speed,
        ease: 'none',
        scrollTrigger: { start: 0, end: 'max', scrub: 0.8, invalidateOnRefresh: true },
      });
    });
    const head = document.querySelector('[data-head]');
    if (head) {
      gsap.to(head, { y: 36, opacity: 0.25, ease: 'none', scrollTrigger: { trigger: head, start: 'top 72px', end: 'bottom top', scrub: 0.6 } });
    }
    // Giriş ekranı: arka plan imleçle derinlik hissi verir, kart hafifçe eğilir
    const mouseEls = [...document.querySelectorAll('[data-mouse]')].map((el) => ({
      f: parseFloat(el.dataset.mouse) || 0,
      x: gsap.quickTo(el, 'x', { duration: 1.2, ease: 'power3' }),
      y: gsap.quickTo(el, 'y', { duration: 1.2, ease: 'power3' }),
    }));
    const tilt = document.querySelector('[data-tilt]');
    if (tilt) gsap.set(tilt, { transformPerspective: 1000 });
    const rx = tilt && gsap.quickTo(tilt, 'rotationX', { duration: 0.8, ease: 'power3' });
    const ry = tilt && gsap.quickTo(tilt, 'rotationY', { duration: 0.8, ease: 'power3' });
    if (mouseEls.length || tilt) {
      addEventListener('pointermove', (e) => {
        const nx = e.clientX / innerWidth - 0.5;
        const ny = e.clientY / innerHeight - 0.5;
        mouseEls.forEach((m) => { m.x(nx * m.f * 2); m.y(ny * m.f * 2); });
        if (tilt) { rx(-ny * 5); ry(nx * 5); }
      });
    }
  }
})();
